#!/usr/bin/env node
// Edutube Studio — professional web GUI for the Edutube extraction pipeline.
// Zero-dependency Node HTTP server that wraps @engmohammeda/edutube-core:
//   POST /api/jobs            start an extraction job (playlist/video/CSV)
//   GET  /api/jobs            list jobs
//   GET  /api/jobs/:id        live status + progress + activity log
//   POST /api/jobs/:id/cancel abort a job
//   GET  /api/lessons         browse extracted lesson files
//   GET  /api/lesson          full lesson JSON
//   POST /api/validate        strict preset validation report
//   GET/PUT /api/config       runtime settings (keys stored in ~/.edutube-mcp/config.json)
//   GET  /api/health          runtime capabilities
import http from "node:http";
import { promises as fs } from "node:fs";
import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { config as loadDotenv } from "dotenv";

loadDotenv();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, "public");
const PORT = Number(process.env.EDUTUBE_GUI_PORT || 4173);
const HOST = process.env.EDUTUBE_GUI_HOST || "0.0.0.0";
const CONFIG_PATH = path.join(os.homedir(), ".edutube-mcp", "config.json");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

/* ----------------------------- user config ----------------------------- */

async function readUserConfig() {
  try {
    return JSON.parse(await fs.readFile(CONFIG_PATH, "utf8"));
  } catch {
    return {};
  }
}

async function writeUserConfig(patch) {
  const current = await readUserConfig();
  const next = { ...current };
  for (const [k, v] of Object.entries(patch)) {
    if (v === null || v === "") delete next[k];
    else next[k] = v;
  }
  await fs.mkdir(path.dirname(CONFIG_PATH), { recursive: true });
  await fs.writeFile(CONFIG_PATH, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  // apply to this process so new jobs pick the values up
  for (const [k, v] of Object.entries(next)) {
    if (typeof v === "string" && v.length > 0) process.env[k] = v;
  }
  for (const [k, v] of Object.entries(patch)) {
    if (v === null || v === "") delete process.env[k];
  }
  return next;
}

// apply saved config once at boot
{
  const saved = await readUserConfig();
  for (const [k, v] of Object.entries(saved)) {
    if (!process.env[k] && typeof v === "string" && v.length > 0) process.env[k] = v;
  }
}

/* ------------------------------- job store ------------------------------ */

const jobs = new Map();

function newJobId() {
  return `job-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function jobView(job) {
  return {
    jobId: job.jobId,
    status: job.status,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    input: job.publicInput,
    progress: job.progress,
    log: job.log.slice(-200),
    totals: job.totals,
    entries: job.entries,
    error: job.error,
    outputDir: job.publicInput?.outputDir ?? null,
  };
}

async function listLessonFiles(dir) {
  try {
    const names = (await fs.readdir(dir)).filter((f) => /^lesson-.*\.json$/i.test(f));
    names.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    return names;
  } catch {
    return [];
  }
}

async function detectRuntime() {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const run = promisify(execFile);
  const probe = async (cmd, args = ["--version"]) => {
    try {
      await run(cmd, args, { timeout: 4000 });
      return true;
    } catch {
      return false;
    }
  };
  return {
    ytDlp: await probe(process.env.YT_DLP_PATH || "yt-dlp"),
    ffmpeg: await probe("ffmpeg", ["-version"]),
  };
}

/* ----------------------------- core imports ----------------------------- */

const core = await import("@engmohammeda/edutube-core");

/* -------------------------------- helpers ------------------------------- */

function json(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(data);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (c) => {
      raw += c;
      if (raw.length > 5_000_000) reject(new Error("Body too large"));
    });
    req.on("end", () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

const COURSES = ["conversation", "phonetics", "writing"];

/* ------------------------------- job runner ----------------------------- */

async function startJob(input) {
  const jobId = newJobId();
  const outputDir = path.resolve(
    input.outputDir || process.env.EDUTUBE_OUTPUT_DIR || path.join(process.cwd(), "edutube-output")
  );
  const job = {
    jobId,
    status: "running",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    controller: new AbortController(),
    progress: { progress: 0, total: 0, message: "Starting…" },
    log: [],
    totals: null,
    entries: [],
    error: null,
    publicInput: {
      url: input.url,
      course: input.course || "conversation",
      outputDir,
      maxVideos: input.maxVideos ?? 50,
      model: input.model || null,
      analysisPrompt: input.analysisPrompt || null,
      schemaJson: input.schemaJson || null,
    },
  };
  jobs.set(jobId, job);

  const push = (level, message) => {
    job.log.push({ ts: new Date().toISOString(), level, message });
    job.updatedAt = new Date().toISOString();
    if (job.log.length > 500) job.log.splice(0, job.log.length - 500);
  };

  push("info", `Job started → ${job.publicInput.url} (${job.publicInput.course})`);
  push("info", `Output directory: ${outputDir}`);

  void (async () => {
    try {
      const ai = core.createAiClient();
      const result = await core.runLessonExtraction(
        ai,
        new core.InMemoryAnalysisSessionStore(),
        {
          url: job.publicInput.url,
          outputDir,
          course: job.publicInput.course,
          maxVideos: job.publicInput.maxVideos,
          model: job.publicInput.model || undefined,
          analysisPrompt: job.publicInput.analysisPrompt || undefined,
          schemaJson: job.publicInput.schemaJson || undefined,
        },
        {
          logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
          tool: "edutube-gui",
          abortSignal: job.controller.signal,
          reportProgress: async (update) => {
            job.progress = {
              progress: update.progress,
              total: update.total,
              message: update.message,
            };
            job.updatedAt = new Date().toISOString();
            push("progress", `${update.progress}/${update.total ?? "?"} ${update.message ?? ""}`.trim());
          },
        }
      );
      job.totals = result.totals;
      job.entries = result.entries;
      job.status = "done";
      job.progress = {
        progress: job.progress.total || 1,
        total: job.progress.total || 1,
        message: `Done — ok=${result.totals.ok} skipped=${result.totals.skipped} failed=${result.totals.failed}`,
      };
      push("success", `Completed: ok=${result.totals.ok} skipped=${result.totals.skipped} failed=${result.totals.failed}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (job.controller.signal.aborted) {
        job.status = "cancelled";
        push("warn", "Job cancelled.");
      } else {
        job.status = "error";
        job.error = message.slice(0, 800);
        push("error", message.slice(0, 500));
      }
    } finally {
      job.updatedAt = new Date().toISOString();
    }
  })();

  return job;
}

/* -------------------------------- routing ------------------------------- */

async function handleApi(req, res, url) {
  const { pathname } = url;

  if (req.method === "GET" && pathname === "/api/health") {
    const runtime = await detectRuntime();
    return json(res, 200, {
      ok: true,
      name: "edutube-studio",
      version: "0.5.0",
      hasGeminiKey: Boolean(process.env.GEMINI_API_KEY),
      hasYoutubeKey: Boolean(process.env.YOUTUBE_API_KEY),
      runtime,
    });
  }

  if (req.method === "GET" && pathname === "/api/config") {
    return json(res, 200, {
      hasGeminiKey: Boolean(process.env.GEMINI_API_KEY),
      hasYoutubeKey: Boolean(process.env.YOUTUBE_API_KEY),
      GEMINI_MODEL: process.env.GEMINI_MODEL || "",
      EDUTUBE_OUTPUT_DIR: process.env.EDUTUBE_OUTPUT_DIR || "",
      YT_DLP_PATH: process.env.YT_DLP_PATH || "",
      configPath: CONFIG_PATH,
    });
  }

  if (req.method === "PUT" && pathname === "/api/config") {
    const body = await readBody(req);
    const patch = {};
    for (const key of ["GEMINI_API_KEY", "YOUTUBE_API_KEY", "GEMINI_MODEL", "EDUTUBE_OUTPUT_DIR", "YT_DLP_PATH"]) {
      if (key in body) patch[key] = typeof body[key] === "string" ? body[key].trim() : "";
    }
    await writeUserConfig(patch);
    return json(res, 200, { ok: true, hasGeminiKey: Boolean(process.env.GEMINI_API_KEY) });
  }

  if (req.method === "POST" && pathname === "/api/jobs") {
    const body = await readBody(req);
    if (!body.url || typeof body.url !== "string") return json(res, 400, { error: "url is required" });
    if (!process.env.GEMINI_API_KEY) {
      return json(res, 400, {
        error: "GEMINI_API_KEY is not set. Add it in Settings first.",
        code: "GEMINI_API_KEY_MISSING",
      });
    }
    if (body.course && !COURSES.includes(body.course)) {
      return json(res, 400, { error: `course must be one of ${COURSES.join(", ")}` });
    }
    if (body.schemaJson) {
      try {
        JSON.parse(body.schemaJson);
      } catch {
        return json(res, 400, { error: "schemaJson is not valid JSON" });
      }
    }
    const job = await startJob(body);
    return json(res, 202, { jobId: job.jobId, status: job.status });
  }

  if (req.method === "GET" && pathname === "/api/jobs") {
    return json(res, 200, { jobs: [...jobs.values()].map(jobView).reverse() });
  }

  const jobMatch = pathname.match(/^\/api\/jobs\/([^/]+)(\/cancel)?$/);
  if (jobMatch) {
    const job = jobs.get(jobMatch[1]);
    if (!job) return json(res, 404, { error: "job not found" });
    if (req.method === "GET") return json(res, 200, jobView(job));
    if (req.method === "POST" && jobMatch[2]) {
      job.controller.abort();
      if (job.status === "running") {
        job.status = "cancelled";
        job.updatedAt = new Date().toISOString();
      }
      return json(res, 200, { ok: true, status: job.status });
    }
    return json(res, 405, { error: "method not allowed" });
  }

  if (req.method === "GET" && pathname === "/api/jobs-files") {
    // live file listing for a job's output dir (lessons appearing during a run)
    const dir = url.searchParams.get("dir");
    if (!dir) return json(res, 400, { error: "dir is required" });
    const files = await listLessonFiles(path.resolve(dir));
    return json(res, 200, { dir, files });
  }

  if (req.method === "GET" && pathname === "/api/lessons") {
    const dir = path.resolve(url.searchParams.get("dir") || process.env.EDUTUBE_OUTPUT_DIR || "edutube-output");
    const files = await listLessonFiles(dir);
    const lessons = [];
    for (const file of files) {
      try {
        const parsed = JSON.parse(await fs.readFile(path.join(dir, file), "utf8"));
        const meta = parsed.metadata ?? {};
        const content = parsed.lesson_content ?? {};
        lessons.push({
          file,
          title: meta.title ?? "",
          lesson_no: meta.lesson_no ?? null,
          course_id: meta.course_id ?? null,
          quiz: Array.isArray(parsed.quiz) ? parsed.quiz.length : 0,
          vocab: Array.isArray(parsed.global_vocabulary) ? parsed.global_vocabulary.length : 0,
          notes: Array.isArray(parsed.lesson_notes) ? parsed.lesson_notes.length : 0,
          contentSummary: Object.fromEntries(
            Object.entries(content).map(([k, v]) => [k, Array.isArray(v) ? v.length : typeof v === "object" && v ? 1 : String(v ?? "").length ? 1 : 0])
          ),
        });
      } catch {
        lessons.push({ file, error: "unreadable" });
      }
    }
    // aggregate if present
    let all = null;
    try {
      all = JSON.parse(await fs.readFile(path.join(dir, "lessons-all.json"), "utf8"));
      if (!Array.isArray(all)) all = null;
    } catch {
      all = null;
    }
    return json(res, 200, { dir, count: lessons.length, lessons, allCount: all ? all.length : 0 });
  }

  if (req.method === "GET" && pathname === "/api/lesson") {
    const dir = path.resolve(url.searchParams.get("dir") || "edutube-output");
    const file = url.searchParams.get("file") || "";
    if (!/^lesson-[\w.-]+\.json$/i.test(file)) return json(res, 400, { error: "invalid file name" });
    try {
      const parsed = JSON.parse(await fs.readFile(path.join(dir, file), "utf8"));
      return json(res, 200, { dir, file, lesson: parsed });
    } catch (error) {
      return json(res, 404, { error: `Cannot read ${file}: ${error instanceof Error ? error.message : String(error)}` });
    }
  }

  if (req.method === "POST" && pathname === "/api/validate") {
    const body = await readBody(req);
    const dir = path.resolve(body.dir || "edutube-output");
    const course = body.course && COURSES.includes(body.course) ? body.course : "conversation";
    const files = await listLessonFiles(dir);
    if (files.length === 0) return json(res, 404, { error: `No lesson-*.json files found in ${dir}` });
    const reports = [];
    for (const file of files) {
      try {
        const lesson = JSON.parse(await fs.readFile(path.join(dir, file), "utf8"));
        const match = file.match(/lesson-0*(\d+)/i);
        const expectLessonNo = match ? Number(match[1]) : undefined;
        const problems = core.validateLesson(lesson, { course, expectLessonNo });
        reports.push({ file, ok: problems.length === 0, problems });
      } catch (error) {
        reports.push({ file, ok: false, problems: [`Unreadable: ${error instanceof Error ? error.message : String(error)}`] });
      }
    }
    const failed = reports.filter((r) => !r.ok).length;
    return json(res, 200, { dir, course, total: reports.length, ok: reports.length - failed, failed, reports });
  }

  if (req.method === "GET" && pathname === "/api/runtime-key") {
    // The browser runner calls Gemini directly from the user's browser; it
    // needs the stored key for the x-goog-api-key header (user's own machine).
    return json(res, 200, {
      GEMINI_API_KEY: process.env.GEMINI_API_KEY || "",
      YOUTUBE_API_KEY: process.env.YOUTUBE_API_KEY || "",
    });
  }

  if (req.method === "GET" && pathname === "/api/course-files") {
    const dir = path.resolve(url.searchParams.get("dir") || "courses/english-from-zero-level1");
    const readMaybe = async (name) => {
      try {
        return await fs.readFile(path.join(dir, name), "utf8");
      } catch {
        return null;
      }
    };
    return json(res, 200, {
      dir,
      prompt: await readMaybe("prompt.txt"),
      schema: await readMaybe("schema.json"),
      csv: await readMaybe("playlist.csv"),
    });
  }

  if (req.method === "POST" && pathname === "/api/save-lesson") {
    const body = await readBody(req);
    const dir = path.resolve(body.dir || "edutube-output");
    const file = String(body.file || "");
    if (!/^lesson-[\w.-]+\.json$/i.test(file)) return json(res, 400, { error: "invalid file name" });
    if (!body.lesson || typeof body.lesson !== "object" || Array.isArray(body.lesson)) {
      return json(res, 400, { error: "lesson must be a JSON object" });
    }
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, file), `${JSON.stringify(body.lesson, null, 2)}\n`, "utf8");
    return json(res, 200, { ok: true, dir, file });
  }

  if (req.method === "POST" && pathname === "/api/save-aggregate") {
    const body = await readBody(req);
    const dir = path.resolve(body.dir || "edutube-output");
    const files = await listLessonFiles(dir);
    const lessons = [];
    for (const file of files) {
      try {
        lessons.push(JSON.parse(await fs.readFile(path.join(dir, file), "utf8")));
      } catch {
        /* skip unreadable */
      }
    }
    await fs.writeFile(path.join(dir, "lessons-all.json"), `${JSON.stringify(lessons, null, 2)}\n`, "utf8");
    const summary = {
      source: body.source ?? null,
      course: body.course ?? null,
      outputDir: dir,
      totals: {
        ok: lessons.length,
        skipped: 0,
        failed: files.length - lessons.length,
      },
      entries: files.map((file) => ({ file })),
    };
    await fs.writeFile(path.join(dir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
    return json(res, 200, { ok: true, dir, lessons: lessons.length });
  }

  return json(res, 404, { error: "not found" });
}

/* ------------------------------ static files ---------------------------- */

async function serveStatic(req, res, url) {
  let rel = url.pathname === "/" ? "index.html" : url.pathname.replace(/^\/+/, "");
  if (rel.includes("..")) return json(res, 400, { error: "bad path" });
  const file = path.join(PUBLIC_DIR, rel);
  if (!file.startsWith(PUBLIC_DIR) || !existsSync(file)) {
    // SPA fallback
    const index = path.join(PUBLIC_DIR, "index.html");
    res.writeHead(200, { "content-type": MIME[".html"] });
    res.end(readFileSync(index));
    return;
  }
  const ext = path.extname(file).toLowerCase();
  res.writeHead(200, { "content-type": MIME[ext] || "application/octet-stream" });
  res.end(readFileSync(file));
}

/* --------------------------------- server ------------------------------- */

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  try {
    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url);
    } else {
      await serveStatic(req, res, url);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    json(res, 500, { error: message });
  }
});

/* bootstrap: saved config (e.g. GEMINI_API_KEY) must survive restarts */
const bootstrapConfig = await readUserConfig();
for (const [k, v] of Object.entries(bootstrapConfig)) {
  if (typeof v === "string" && v.length > 0 && process.env[k] === undefined) process.env[k] = v;
}

server.listen(PORT, HOST, () => {
  console.log(`Edutube Studio running at http://${HOST}:${PORT}`);
  console.log(`Config: ${CONFIG_PATH}`);
  console.log(`Gemini key: ${process.env.GEMINI_API_KEY ? "set" : "NOT SET"} · YouTube key: ${process.env.YOUTUBE_API_KEY ? "set" : "not set"}`);
});
