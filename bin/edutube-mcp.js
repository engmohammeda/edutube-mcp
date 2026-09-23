#!/usr/bin/env node

// Edutube MCP command line.
//   edutube-mcp                     start the MCP stdio server
//   edutube-mcp setup               save reusable config (~/.config/edutube-mcp/config.json)
//   edutube-mcp extract <url>       extract structured lessons from a playlist/video
//   edutube-mcp validate <dir>      run the lesson quality gate over extracted lessons
//   edutube-mcp curriculum [dir]    course catalog + curriculum coverage report
//   edutube-mcp courses             list the supported course presets
import process from "node:process";
import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";

import { config as loadDotenv } from "dotenv";

const defaultModel = "gemini-2.5-flash";

const COURSES = [
  "conversation",
  "phonetics",
  "writing",
  "grammar",
  "vocabulary",
  "reading",
  "listening",
];

function printUsage() {
  console.log(
    [
      "edutube-mcp — YouTube playlists → structured LMS lessons",
      "",
      "Usage:",
      "  edutube-mcp                        Start the MCP stdio server",
      "  edutube-mcp setup                  Save config for npm/global usage",
      "  edutube-mcp courses                List supported course presets",
      "  edutube-mcp extract <url> [opts]   Extract lessons from a playlist/video",
      "  edutube-mcp validate <dir> [opts]  Run the quality gate over extracted lessons",
      "  edutube-mcp curriculum [dir]       Course catalog + coverage report",
      "  edutube-mcp --help                 Show this help",
      "",
      "extract options:",
      "  --out DIR            Output directory (default: $EDUTUBE_OUTPUT_DIR or ./edutube-output)",
      "  --course NAME        " + COURSES.join(" | "),
      "  --level N            Curriculum level written into metadata.level (default 1)",
      "  --max N              Cap the number of playlist videos (default 50)",
      "  --start-index N      1-based playlist position to start from",
      "  --model NAME         Preferred Gemini model (rotation still applies on quota errors)",
      "  --concurrency N      Videos extracted in parallel (default 1)",
      "  --attempts N         Extraction attempts per video before reporting invalid (default 2)",
      "  --strict             Treat quality warnings as errors",
      "  --only-failed        Re-extract only videos marked failed/invalid in curriculum-state.json",
      "  --force              Ignore cached lessons and re-extract everything",
      "  --expected N         Expected lesson count for the coverage report",
      "  --manifest FILE      Curriculum manifest (curriculum_id + courses[] with playlist urls)",
      "",
      "validate options:  --course NAME  --strict  --repair",
      "curriculum options: --manifest FILE  --json",
      "",
      "Stdout is always clean JSON (progress and logs go to stderr).",
    ].join("\n")
  );
}

function flagValue(argv, flag) {
  const i = argv.indexOf(flag);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : undefined;
}

function hasFlag(argv, flag) {
  return argv.includes(flag);
}

function positional(argv) {
  return argv.find((a) => !a.startsWith("--"));
}

function intFlag(argv, flag) {
  const raw = flagValue(argv, flag);
  if (raw === undefined) return undefined;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value < 1) {
    throw new Error(`${flag} expects a positive integer (got "${raw}").`);
  }
  return value;
}

async function loadCore() {
  const core = await import("@engmohammeda/edutube-core");
  return core;
}

function createContext(tool = "edutube-cli") {
  const logLine = (level) => (event, fields) =>
    console.error(`[edutube:${level}] ${event}${fields ? " " + JSON.stringify(fields) : ""}`);
  return {
    logger: {
      requestId: "cli",
      tool,
      child: () => createContext(tool).logger,
      info: logLine("info"),
      warn: logLine("warn"),
      error: logLine("error"),
    },
    tool,
    reportProgress: async (update) =>
      console.error(`[progress ${update.progress}/${update.total ?? "?"}] ${update.message}`),
  };
}

/* --------------------------------- setup ---------------------------------- */

async function loadRuntimeConfig(core) {
  loadDotenv();
  const configPath = core.getUserConfigPath();
  const userConfig = await core.readUserConfigFile(configPath);
  core.applyUserConfigToEnv(userConfig);
  return { configPath, userConfig };
}

function missingApiKeyMessage(configPath) {
  return [
    "Missing GEMINI_API_KEY.",
    "",
    "Set GEMINI_API_KEY in the environment or run:",
    "  edutube-mcp setup",
    "",
    `Config file path: ${configPath}`,
  ].join("\n");
}

async function promptValue(rl, label, currentValue, { required = false, help } = {}) {
  const suffix = currentValue ? ` [${currentValue}]` : "";
  const hint = help ? ` (${help})` : "";
  for (;;) {
    const answer = await rl.question(`${label}${suffix}${hint}: `);
    const normalized = answer.trim();
    if (normalized === "-") return undefined;
    if (normalized) return normalized;
    if (currentValue) return currentValue;
    if (!required) return undefined;
    console.log(`${label} is required.`);
  }
}

async function runSetup() {
  const core = await loadCore();
  const { configPath, userConfig } = await loadRuntimeConfig(core);
  const rl = createInterface({ input, output });

  try {
    console.log(`Config will be saved to ${configPath}`);
    console.log("Press Enter to keep a value. Type - to clear an optional field.");
    console.log("");

    const values = {
      GEMINI_API_KEY: await promptValue(rl, "Gemini API key", process.env.GEMINI_API_KEY || userConfig.GEMINI_API_KEY, {
        required: true,
      }),
      GEMINI_API_KEYS: await promptValue(rl, "Extra Gemini keys", process.env.GEMINI_API_KEYS || userConfig.GEMINI_API_KEYS, {
        help: "comma separated, each adds its own quota pools",
      }),
      YOUTUBE_API_KEY: await promptValue(rl, "YouTube API key", process.env.YOUTUBE_API_KEY || userConfig.YOUTUBE_API_KEY, {
        help: "optional, metadata + faster playlist import",
      }),
      GEMINI_MODEL: await promptValue(rl, "Gemini model", process.env.GEMINI_MODEL || userConfig.GEMINI_MODEL || defaultModel, {
        help: `default ${defaultModel}`,
      }),
      GEMINI_MODEL_ROTATION: await promptValue(
        rl,
        "Model rotation order",
        process.env.GEMINI_MODEL_ROTATION || userConfig.GEMINI_MODEL_ROTATION,
        { help: "optional, comma separated" }
      ),
      EDUTUBE_OUTPUT_DIR: await promptValue(
        rl,
        "Default output dir",
        process.env.EDUTUBE_OUTPUT_DIR || userConfig.EDUTUBE_OUTPUT_DIR,
        { help: "optional" }
      ),
      YT_DLP_PATH: await promptValue(rl, "yt-dlp path", process.env.YT_DLP_PATH || userConfig.YT_DLP_PATH, {
        help: "optional, PATH or python -m yt_dlp",
      }),
    };

    const cleaned = Object.fromEntries(
      Object.entries(values).filter(([, value]) => typeof value === "string" && value.length > 0)
    );
    await core.writeUserConfigFile(configPath, cleaned);

    console.log("");
    console.log(`Saved config to ${configPath}`);
    console.log("You can now run `edutube-mcp` without exporting those variables each time.");
  } finally {
    rl.close();
  }
}

/* -------------------------------- courses --------------------------------- */

async function runCourses() {
  const core = await loadCore();
  const courses = core.listCourseDefinitions().map((course) => ({
    course_id: course.id,
    course_name_ar: course.nameAr,
    course_name_en: course.nameEn,
    description_ar: course.descriptionAr,
    content_keys: course.contentKeys,
    required_content_keys: course.requiredContentKeys,
    quiz_length: course.quizPolicy.exactLength,
    quiz_rules: course.quizPolicy.rules,
    min_counts: course.minCounts,
  }));
  console.log(JSON.stringify({ courses }, null, 2));
}

/* -------------------------------- extract --------------------------------- */

async function runExtract(argv) {
  const url = positional(argv);
  if (!url) {
    throw new Error("Usage: edutube-mcp extract <playlist-or-video-url> [--out DIR] [--course NAME] [--max N]");
  }

  const core = await loadCore();
  const { configPath } = await loadRuntimeConfig(core);
  if (!process.env.GEMINI_API_KEY) {
    throw new Error(missingApiKeyMessage(configPath));
  }

  const course = flagValue(argv, "--course");
  if (course && !COURSES.includes(course)) {
    throw new Error(`--course must be one of: ${COURSES.join(", ")}.`);
  }

  let manifest = null;
  const manifestPath = flagValue(argv, "--manifest");
  if (manifestPath) {
    manifest = await core.loadCurriculumManifestFile(manifestPath);
  }

  const ai = core.createAiClient();
  const result = await core.runLessonExtraction(
    ai,
    new core.InMemoryAnalysisSessionStore(),
    {
      url,
      outputDir: flagValue(argv, "--out") || process.env.EDUTUBE_OUTPUT_DIR || "edutube-output",
      course,
      level: intFlag(argv, "--level"),
      maxVideos: intFlag(argv, "--max") ?? 50,
      startIndex: intFlag(argv, "--start-index"),
      model: flagValue(argv, "--model"),
      concurrency: intFlag(argv, "--concurrency"),
      maxAttempts: intFlag(argv, "--attempts"),
      strict: hasFlag(argv, "--strict"),
      onlyFailed: hasFlag(argv, "--only-failed"),
      force: hasFlag(argv, "--force"),
      expectedLessons: intFlag(argv, "--expected"),
      manifest,
    },
    createContext("edutube-cli-extract")
  );

  console.log(
    JSON.stringify(
      {
        outputDir: result.outputDir,
        source: result.source,
        playlistId: result.playlistId,
        course: result.course,
        level: result.level,
        totals: result.totals,
        validation: result.validation.totals,
        coverage: result.coverage.totals,
        files: result.files,
        entries: result.entries.map((entry) => ({
          lesson_no: entry.lessonNo,
          video_id: entry.videoId,
          title: entry.title,
          status: entry.status,
          file: entry.file,
          attempts: entry.attempts,
          score: entry.validation?.score ?? null,
          issues: entry.validation?.issues.length ?? 0,
          error: entry.error ?? null,
        })),
      },
      null,
      2
    )
  );

  if (result.totals.failed > 0 || result.validation.totals.invalid > 0) {
    process.exitCode = 2;
  }
}

/* -------------------------------- validate -------------------------------- */

async function runValidate(argv) {
  const core = await loadCore();
  await loadRuntimeConfig(core);
  const outputDir = positional(argv) || process.env.EDUTUBE_OUTPUT_DIR || "edutube-output";
  const course = flagValue(argv, "--course");
  if (course && !COURSES.includes(course)) {
    throw new Error(`--course must be one of: ${COURSES.join(", ")}.`);
  }

  const result = await core.validateLessonDirectory({
    outputDir,
    course,
    strict: hasFlag(argv, "--strict"),
    repair: hasFlag(argv, "--repair"),
  });

  console.log(
    JSON.stringify(
      {
        outputDir: result.outputDir,
        course: result.course,
        totals: result.report.totals,
        repairedFiles: result.repairedFiles,
        coverage: result.coverage,
        lessons: result.report.lessons,
      },
      null,
      2
    )
  );

  if (result.report.totals.invalid > 0) process.exitCode = 2;
}

/* ------------------------------- curriculum ------------------------------- */

async function runCurriculum(argv) {
  const core = await loadCore();
  await loadRuntimeConfig(core);
  const outputDir = positional(argv) || process.env.EDUTUBE_OUTPUT_DIR || "edutube-output";

  let manifest = null;
  const manifestPath = flagValue(argv, "--manifest");
  if (manifestPath) {
    manifest = await core.loadCurriculumManifestFile(manifestPath);
  }

  let result = null;
  try {
    result = await core.validateLessonDirectory({ outputDir, manifest });
  } catch {
    result = null;
  }

  const coverage =
    result?.coverage ??
    core.computeCurriculumCoverage({ records: [], manifest });

  console.log(
    JSON.stringify(
      {
        outputDir,
        courses: core.listCourseDefinitions().map((course) => ({
          course_id: course.id,
          course_name_ar: course.nameAr,
          quiz_rules: course.quizPolicy.rules,
        })),
        totals: coverage.totals,
        coverage: coverage.courses,
      },
      null,
      2
    )
  );
}

/* ---------------------------------- main ---------------------------------- */

async function run() {
  const command = process.argv[2];

  if (command === "--help" || command === "-h" || command === "help") {
    printUsage();
    return;
  }
  if (command === "setup") return runSetup();
  if (command === "courses") return runCourses();
  if (command === "extract") return runExtract(process.argv.slice(3));
  if (command === "validate") return runValidate(process.argv.slice(3));
  if (command === "curriculum") return runCurriculum(process.argv.slice(3));

  const core = await loadCore();
  const { configPath } = await loadRuntimeConfig(core);
  if (!process.env.GEMINI_API_KEY) {
    throw new Error(missingApiKeyMessage(configPath));
  }

  const { main } = await import("../dist/mcp-server-main.js");
  await main();
}

run().catch((error) => {
  const message = error instanceof Error ? error.stack || error.message : String(error);
  console.error(message);
  process.exit(1);
});
