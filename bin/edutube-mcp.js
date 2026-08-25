#!/usr/bin/env node

import process from "node:process";
import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

import { config as loadDotenv } from "dotenv";

const defaultModel = "gemini-2.5-pro";

function getUserConfigPath() {
  return join(homedir(), ".edutube-mcp", "config.json");
}

async function readUserConfigFile(path) {
  try {
    const content = await readFile(path, "utf8");
    const parsed = JSON.parse(content);
    return typeof parsed === "object" && parsed ? parsed : {};
  } catch {
    return {};
  }
}

async function writeUserConfigFile(path, data) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function applyUserConfigToEnv(config) {
  for (const [key, value] of Object.entries(config)) {
    if (!process.env[key] && typeof value === "string" && value.length > 0) {
      process.env[key] = value;
    }
  }
}

function formatMissingApiKeyGuidance(configPath) {
  return [
    "Missing GEMINI_API_KEY.",
    "",
    "Set GEMINI_API_KEY in the environment or run:",
    "  edutube-mcp setup",
    "",
    `Config file path: ${configPath}`,
  ].join("\n");
}

function printUsage() {
  console.log([
    "edutube-mcp",
    "",
    "Usage:",
    "  edutube-mcp          Start the MCP stdio server",
    "  edutube-mcp setup    Save config for npm/global usage",
    "  edutube-mcp extract <playlist-or-video-url> [--out DIR] [--max N] [--model M]",
    "                       Extract structured lessons from a playlist/video without an MCP client",
    "  edutube-mcp --help   Show this help",
  ].join("\n"));
}

function flagValue(argv, flag) {
  const i = argv.indexOf(flag);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : undefined;
}

async function runExtract(argv) {
  const url = argv.find((a) => !a.startsWith("--"));
  if (!url) {
    throw new Error("Usage: edutube-mcp extract <playlist-or-video-url> [--out DIR] [--max N] [--model M]");
  }
  const { configPath } = await loadRuntimeConfig();
  if (!process.env.GEMINI_API_KEY) {
    throw new Error(formatMissingApiKeyGuidance(configPath));
  }

  const core = await import("@engmohammeda/edutube-core");
  const ai = core.createAiClient();
  const logLine = (level) => (event, fields) =>
    console.error(`[edutube:${level}] ${event}${fields ? " " + JSON.stringify(fields) : ""}`);
  const context = {
    logger: { info: logLine("info"), warn: logLine("warn"), error: logLine("error"), debug: () => {} },
    tool: "edutube-cli",
    reportProgress: async (update) =>
      console.error(`[progress ${update.progress}/${update.total ?? "?"}] ${update.message}`),
  };

  const result = await core.runLessonExtraction(
    ai,
    new core.InMemoryAnalysisSessionStore(),
    {
      url,
      outputDir: flagValue(argv, "--out") || process.env.EDUTUBE_OUTPUT_DIR || "edutube-output",
      maxVideos: Number(flagValue(argv, "--max") || 50),
      model: flagValue(argv, "--model"),
    },
    context
  );

  console.log(
    JSON.stringify(
      { outputDir: result.outputDir, source: result.source, playlistId: result.playlistId, totals: result.totals, entries: result.entries },
      null,
      2
    )
  );
}

function normalizePromptValue(value) {
  const trimmed = value.trim();
  return trimmed || undefined;
}

async function loadRuntimeConfig() {
  loadDotenv();
  const configPath = getUserConfigPath();
  const userConfig = await readUserConfigFile(configPath);
  applyUserConfigToEnv(userConfig);
  return { configPath, userConfig };
}

async function promptRequiredValue(rl, label, currentValue) {
  while (true) {
    const suffix = currentValue ? ` [${currentValue}]` : "";
    const answer = await rl.question(`${label}${suffix}: `);
    const normalized = normalizePromptValue(answer);
    if (normalized) {
      return normalized;
    }
    if (currentValue) {
      return currentValue;
    }
    console.log(`${label} is required.`);
  }
}

async function promptOptionalValue(rl, label, currentValue, helpText) {
  const suffix = currentValue ? ` [${currentValue}]` : "";
  const prompt = helpText ? `${label}${suffix} (${helpText}): ` : `${label}${suffix}: `;
  const answer = await rl.question(prompt);
  const normalized = normalizePromptValue(answer);

  if (normalized === "-") {
    return undefined;
  }

  return normalized ?? currentValue;
}

async function runSetup() {
  const { configPath, userConfig } = await loadRuntimeConfig();
  const rl = createInterface({ input, output });

  try {
    console.log(`Config will be saved to ${configPath}`);
    console.log("Press Enter to keep the current value. Type - for an optional field to clear it.");
    console.log("");

    const geminiApiKey = await promptRequiredValue(
      rl,
      "Gemini API key",
      process.env.GEMINI_API_KEY || userConfig.GEMINI_API_KEY
    );
    const youtubeApiKey = await promptOptionalValue(
      rl,
      "YouTube API key",
      process.env.YOUTUBE_API_KEY || userConfig.YOUTUBE_API_KEY,
      "optional, required only for get_youtube_video_metadata"
    );
    const geminiModel = await promptOptionalValue(
      rl,
      "Gemini model",
      process.env.GEMINI_MODEL || userConfig.GEMINI_MODEL || defaultModel,
      `optional, default is ${defaultModel}`
    );
    const ytDlpPath = await promptOptionalValue(
      rl,
      "yt-dlp path",
      process.env.YT_DLP_PATH || userConfig.YT_DLP_PATH,
      "optional, use PATH or python -m yt_dlp when blank"
    );

    await writeUserConfigFile(configPath, {
      GEMINI_API_KEY: geminiApiKey,
      ...(youtubeApiKey ? { YOUTUBE_API_KEY: youtubeApiKey } : {}),
      ...(geminiModel && geminiModel !== defaultModel ? { GEMINI_MODEL: geminiModel } : {}),
      ...(ytDlpPath ? { YT_DLP_PATH: ytDlpPath } : {}),
    });

    console.log("");
    console.log(`Saved config to ${configPath}`);
    console.log("You can now run `edutube-mcp` without exporting those variables each time.");
  } finally {
    rl.close();
  }
}

async function run() {
  const command = process.argv[2];

  if (command === "--help" || command === "-h" || command === "help") {
    printUsage();
    return;
  }

  if (command === "setup") {
    await runSetup();
    return;
  }

  if (command === "extract") {
    await runExtract(process.argv.slice(3));
    return;
  }

  const { configPath } = await loadRuntimeConfig();
  if (!process.env.GEMINI_API_KEY) {
    throw new Error(formatMissingApiKeyGuidance(configPath));
  }

  const { main } = await import("../dist/mcp-server-main.js");
  await main();
}

run().catch((error) => {
  const message = error instanceof Error ? error.stack || error.message : String(error);
  console.error(message);
  process.exit(1);
});
