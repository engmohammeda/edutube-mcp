/* Edutube Studio — GUI API tests. Run: node gui/test.mjs */
import { spawn } from "node:child_process";
import { mkdir, writeFile, readFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const PORT = 4177;
const BASE = `http://127.0.0.1:${PORT}`;
const TEST_KEY = "TEST.KEY.for.gui.tests";
const HOME = await mkdir(path.join(os.tmpdir(), "edutube-gui-test"), { recursive: true }).then(() =>
  path.join(os.tmpdir(), "edutube-gui-test")
);
const CONFIG_PATH = path.join(HOME, ".edutube-mcp", "config.json");

let passed = 0, failed = 0;
function ok(name, cond, extra = "") {
  if (cond) { passed++; console.log(`PASS ${name}`); }
  else { failed++; console.log(`FAIL ${name} ${extra}`); }
}

async function get(p) {
  const r = await fetch(`${BASE}${p}`);
  return r.json();
}
async function req(method, p, body) {
  const r = await fetch(`${BASE}${p}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  return r.json();
}

async function waitReady() {
  for (let i = 0; i < 50; i++) {
    try { return await get("/api/health"); } catch { await new Promise((r) => setTimeout(r, 200)); }
  }
  throw new Error("server did not start");
}

async function main() {
  // isolated HOME so the user's real config/key is never touched
  await mkdir(path.dirname(CONFIG_PATH), { recursive: true });
  await writeFile(CONFIG_PATH, JSON.stringify({ GEMINI_API_KEY: TEST_KEY, GEMINI_MODEL: "gemini-test" }, null, 2));

  const env = { ...process.env, EDUTUBE_GUI_PORT: String(PORT), HOME };
  delete env.GEMINI_API_KEY; // force bootstrap from the isolated config
  const proc = spawn("node", ["gui/server.mjs"], { env, stdio: "ignore" });

  try {
    await waitReady();

    const health = await get("/api/health");
    ok("health hasGeminiKey (bootstrapped from config)", health.hasGeminiKey === true);

    const key = await get("/api/runtime-key");
    ok("runtime-key returns stored key", key.GEMINI_API_KEY === TEST_KEY);

    const files = await get("/api/course-files?dir=" + encodeURIComponent("courses/english-from-zero-level1"));
    ok("course-files prompt+schema+csv", Boolean(files.prompt && files.schema && files.csv));

    const dir = "gui/.test-course/lessons";
    const lesson = {
      metadata: { course: "من الصفر", level: 1, lesson_no: 99, title: "t" },
      global_vocabulary: [], lesson_notes: [], quiz: [],
    };
    const w = await req("POST", "/api/save-lesson", { dir, file: "lesson-99.json", lesson });
    ok("save-lesson writes file", w.ok === true && w.file === "lesson-99.json");
    const bad = await req("POST", "/api/save-lesson", { dir, file: "../evil.json", lesson });
    ok("save-lesson rejects traversal names", String(bad.error || "").includes("invalid file name"));
    const agg = await req("POST", "/api/save-aggregate", { dir, course: "من الصفر" });
    ok("save-aggregate builds lessons-all", agg.lessons === 1);
    const list = await get("/api/lessons?dir=" + encodeURIComponent(dir));
    ok("lessons lists saved lesson", list.count === 1 && list.lessons[0].lesson_no === 99);

    await rm(path.join("gui", ".test-course"), { recursive: true, force: true });
  } finally {
    proc.kill();
  }

  console.log(`\n${passed}/${passed + failed} GUI tests passed`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
