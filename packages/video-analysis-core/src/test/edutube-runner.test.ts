import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { GoogleGenAI } from "@google/genai";

import {
  LESSONS_ALL_FILE_NAME,
  LESSONS_INDEX_FILE_NAME,
  STATE_FILE_NAME,
  SUMMARY_FILE_NAME,
  VALIDATION_REPORT_FILE_NAME,
  listLessonFiles,
  runLessonExtraction,
  validateLessonDirectory,
  type EdutubeRunOptions,
} from "../youtube-core/edutube-runner.js";
import type { AnalysisExecutionContext } from "../youtube-core/analysis.js";
import type { AnalysisSessionStore } from "../youtube-core/session-store.js";
import type { PlaylistInfo } from "../youtube-core/playlist.js";
import { makeQuiz, makeValidConversationLesson } from "./lesson-validation.test.js";

const silentLogger = {
  requestId: "test-request",
  tool: "edutube-test",
  child: () => silentLogger,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

const context: AnalysisExecutionContext = { logger: silentLogger, tool: "edutube-test" };
const fakeAi = {} as GoogleGenAI;
const fakeSessionStore: AnalysisSessionStore = {
  async get() {
    return null;
  },
  async set() {
    return undefined;
  },
};

function playlistOf(videoIds: string[]): PlaylistInfo {
  return {
    playlistId: "PLtest",
    source: "yt_dlp",
    entries: videoIds.map((videoId, index) => ({ index, videoId, title: `حلقة ${index + 1}` })),
  };
}

async function readJson(file: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>;
}

export async function run(): Promise<void> {
  const outputDir = await mkdtemp(path.join(tmpdir(), "edutube-runner-"));
  const promptsSeen: string[] = [];
  const callsPerVideo = new Map<string, number>();

  // vid-b fails the gate on the first attempt and passes on the retry.
  // vid-c never produces a compliant lesson.
  const extractLesson = async (
    _ai: GoogleGenAI,
    _store: AnalysisSessionStore,
    params: Parameters<typeof import("../youtube-core/lesson.js").extractLessonFromVideo>[2],
    _context: AnalysisExecutionContext
  ) => {
    const videoId = /v=([\w-]+)/.exec(params.youtubeUrl)?.[1] ?? "unknown";
    const attempt = (callsPerVideo.get(videoId) ?? 0) + 1;
    callsPerVideo.set(videoId, attempt);
    promptsSeen.push(params.analysisPrompt ?? "");

    const position = params.position ?? 1;
    if (videoId === "vid-b" && attempt === 1) {
      const broken = makeValidConversationLesson(position);
      broken.quiz = makeQuiz({ multipleChoice: 2 });
      return { lesson: broken, strategyUsed: "long_single_pass" as const };
    }
    if (videoId === "vid-c") {
      const broken = makeValidConversationLesson(position);
      broken.lesson_content = { dialogue: [], key_expressions: [] };
      (broken.lesson_notes as string[]).length = 0;
      return { lesson: broken, strategyUsed: "windowed_fallback" as const, windowsProcessed: 2 };
    }
    return { lesson: makeValidConversationLesson(position), strategyUsed: "long_single_pass" as const };
  };

  const baseOptions: Omit<EdutubeRunOptions, "url" | "outputDir"> = {
    course: "conversation",
    level: 1,
    maxAttempts: 2,
    expectedLessons: 3,
    resolveEntries: async () => playlistOf(["vid-a", "vid-b", "vid-c", "vid-a"]),
    extractLesson: extractLesson as never,
  };

  const first = await runLessonExtraction(
    fakeAi,
    fakeSessionStore,
    { ...baseOptions, url: "https://www.youtube.com/playlist?list=PLtest", outputDir },
    context
  );

  // Duplicate playlist entry is detected instead of being extracted twice.
  assert.equal(first.entries.length, 4);
  assert.deepEqual(
    first.entries.map((entry) => entry.status),
    ["extracted", "extracted", "invalid", "duplicate"]
  );
  assert.equal(first.totals.ok, 2);
  assert.equal(first.totals.invalid, 1);
  assert.equal(first.totals.duplicate, 1);
  assert.equal(first.course, "conversation");
  assert.equal(first.level, 1);

  // The rejected video was retried with corrective feedback.
  assert.equal(callsPerVideo.get("vid-b"), 2);
  assert.ok(
    promptsSeen.some((prompt) => prompt.includes("QUALITY GATE")),
    "expected a corrective retry prompt"
  );

  // vid-c stayed invalid but its best attempt was kept for review.
  const invalidEntry = first.entries[2];
  assert.equal(invalidEntry.status, "invalid");
  assert.equal(invalidEntry.validation?.valid, false);
  assert.ok(invalidEntry.validation?.issues.length);
  assert.ok(invalidEntry.file);

  // Every artefact is written.
  for (const name of [
    LESSONS_ALL_FILE_NAME,
    SUMMARY_FILE_NAME,
    STATE_FILE_NAME,
    VALIDATION_REPORT_FILE_NAME,
    LESSONS_INDEX_FILE_NAME,
  ]) {
    await readFile(path.join(outputDir, name), "utf8");
  }

  const lessonsAll = JSON.parse(
    await readFile(path.join(outputDir, LESSONS_ALL_FILE_NAME), "utf8")
  ) as Array<Record<string, unknown>>;
  assert.equal(lessonsAll.length, 3);
  assert.deepEqual(
    lessonsAll.map((lesson) => (lesson.metadata as Record<string, unknown>).lesson_no),
    [1, 2, 3]
  );
  assert.equal((lessonsAll[0].quiz as unknown[]).length, 10);

  const summary = await readJson(path.join(outputDir, SUMMARY_FILE_NAME));
  assert.equal((summary.totals as Record<string, number>).ok, 2);
  assert.equal((summary.coverage as Record<string, unknown>).curriculum_id, "single-run");
  const coverage = summary.coverage as { totals: { completion: number } };
  assert.equal(coverage.totals.completion, 2 / 3);

  const state = await readJson(path.join(outputDir, STATE_FILE_NAME));
  assert.equal((state.lessons as unknown[]).length, 4);
  assert.equal(state.course, "conversation");
  const stateLessons = state.lessons as Array<Record<string, unknown>>;
  assert.equal(stateLessons[1].attempts, 2);
  assert.equal(stateLessons[2].status, "invalid");

  const report = await readJson(path.join(outputDir, VALIDATION_REPORT_FILE_NAME));
  const reportTotals = report.totals as Record<string, number>;
  assert.equal(reportTotals.lessons, 3);
  assert.equal(reportTotals.valid, 2);
  assert.equal(reportTotals.invalid, 1);

  const index = await readJson(path.join(outputDir, LESSONS_INDEX_FILE_NAME));
  assert.equal((index.lessons as unknown[]).length, 3);

  // Second run: valid lessons are cached, the invalid one is retried only.
  const callsBefore = callsPerVideo.get("vid-a") ?? 0;
  const second = await runLessonExtraction(
    fakeAi,
    fakeSessionStore,
    { ...baseOptions, url: "https://www.youtube.com/playlist?list=PLtest", outputDir, onlyFailed: true },
    context
  );
  assert.equal(callsPerVideo.get("vid-a"), callsBefore, "cached video must not be re-extracted");
  assert.deepEqual(
    second.entries.map((entry) => entry.status),
    ["cached", "cached", "invalid", "duplicate"]
  );

  // Force re-extracts everything.
  const third = await runLessonExtraction(
    fakeAi,
    fakeSessionStore,
    { ...baseOptions, url: "https://www.youtube.com/playlist?list=PLtest", outputDir, force: true },
    context
  );
  assert.equal(third.totals.ok, 2);
  assert.equal(third.totals.cached, 0);

  // Standalone directory validation (backs `edutube-mcp validate`).
  const directoryCheck = await validateLessonDirectory({ outputDir, course: "conversation" });
  assert.equal(directoryCheck.report.totals.lessons, 3);
  assert.equal(directoryCheck.report.totals.valid, 2);
  assert.equal(directoryCheck.course, "conversation");
  assert.equal(directoryCheck.repairedFiles.length, 0);
  assert.equal(directoryCheck.coverage.courses[0].course_id, "conversation");

  const files = await listLessonFiles(outputDir);
  assert.deepEqual(files.map((file) => file.lessonNo), [1, 2, 3]);

  // Repairing the invalid lesson cannot invent content, so it stays invalid.
  const repairedCheck = await validateLessonDirectory({
    outputDir,
    course: "conversation",
    repair: true,
    strict: true,
  });
  assert.equal(repairedCheck.report.totals.lessons, 3);
  assert.equal(repairedCheck.report.totals.invalid >= 1, true);

  await rm(outputDir, { recursive: true, force: true });
}
