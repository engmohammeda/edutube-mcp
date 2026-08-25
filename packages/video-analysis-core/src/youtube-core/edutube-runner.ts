// Edutube feature: playlist-aware lesson extraction runner.
// Resolves a playlist (or single video) URL, extracts a structured lesson per
// video with the long-path-first / windowed-fallback pipeline, writes
// lesson-NN.json files + a unified lessons-all.json, skips already-valid
// outputs (resume), and reports progress through the execution context.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type { GoogleGenAI } from "@google/genai";

import type { AnalysisExecutionContext } from "./analysis.js";
import { extractLessonFromVideo, lessonLooksValid, type CoursePreset } from "./lesson.js";
import { resolvePlaylistEntries, type PlaylistEntry } from "./playlist.js";
import type { AnalysisSessionStore } from "./session-store.js";

export type EdutubeEntryResult = {
  index: number;
  videoId: string;
  title: string | null;
  status: "ok" | "skipped" | "failed";
  file?: string;
  strategyUsed?: string;
  dialogue?: number;
  quiz?: number;
  error?: string;
};

export type EdutubeRunResult = {
  playlistId: string | null;
  source: string;
  outputDir: string;
  entries: EdutubeEntryResult[];
  totals: { ok: number; skipped: number; failed: number };
};

export type EdutubeRunOptions = {
  url: string;
  outputDir: string;
  course?: CoursePreset;
  maxVideos?: number;
  model?: string;
  chunkModel?: string;
  finalModel?: string;
  analysisPrompt?: string;
};

function lessonFile(outputDir: string, position: number): string {
  return path.join(outputDir, `lesson-${String(position).padStart(2, "0")}.json`);
}

export async function runLessonExtraction(
  ai: GoogleGenAI,
  sessionStore: AnalysisSessionStore,
  options: EdutubeRunOptions,
  context: AnalysisExecutionContext
): Promise<EdutubeRunResult> {
  await mkdir(options.outputDir, { recursive: true });

  const info = await resolvePlaylistEntries({ url: options.url, maxVideos: options.maxVideos ?? 50 });

  await context.reportProgress?.({
    progress: 0,
    total: info.entries.length + 1,
    message: `Resolved ${info.entries.length} video(s) via ${info.source}.`,
  });

  const entries: EdutubeEntryResult[] = [];
  const allLessons: unknown[] = [];

  for (const entry of info.entries) {
    const position = entry.index + 1;
    const file = lessonFile(options.outputDir, position);

    try {
      const existing = await readFile(file, "utf8").catch(() => null);
      if (existing) {
        const parsed = JSON.parse(existing) as Record<string, unknown>;
        if (lessonLooksValid(parsed)) {
          const content = parsed.lesson_content as { dialogue?: unknown[] } | undefined;
          entries.push({
            index: entry.index,
            videoId: entry.videoId,
            title: entry.title,
            status: "skipped",
            file,
            dialogue: content?.dialogue?.length ?? 0,
            quiz: Array.isArray(parsed.quiz) ? (parsed.quiz as unknown[]).length : 0,
          });
          allLessons.push(parsed);
          await context.reportProgress?.({
            progress: entries.length,
            total: info.entries.length + 1,
            message: `Lesson ${position}: cached, skipped.`,
          });
          continue;
        }
      }

      const result = await extractLessonFromVideo(
        ai,
        sessionStore,
        {
          youtubeUrl: `https://www.youtube.com/watch?v=${entry.videoId}`,
          position,
          fallbackTitle: entry.title ?? undefined,
          course: options.course,
          model: options.model,
          chunkModel: options.chunkModel,
          finalModel: options.finalModel,
          analysisPrompt: options.analysisPrompt,
        },
        context
      );

      await writeFile(file, JSON.stringify(result.lesson, null, 2));
      allLessons.push(result.lesson);
      const content = result.lesson.lesson_content as { dialogue?: unknown[] } | undefined;
      entries.push({
        index: entry.index,
        videoId: entry.videoId,
        title: entry.title,
        status: "ok",
        file,
        strategyUsed: result.strategyUsed,
        dialogue: content?.dialogue?.length ?? 0,
        quiz: Array.isArray(result.lesson.quiz) ? (result.lesson.quiz as unknown[]).length : 0,
      });
      await context.reportProgress?.({
        progress: entries.length,
        total: info.entries.length + 1,
        message: `Lesson ${position}: extracted via ${result.strategyUsed}.`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      entries.push({ index: entry.index, videoId: entry.videoId, title: entry.title, status: "failed", error: message.slice(0, 500) });
      await context.reportProgress?.({
        progress: entries.length,
        total: info.entries.length + 1,
        message: `Lesson ${position}: failed (${message.slice(0, 120)}).`,
      });
    }
  }

  await writeFile(path.join(options.outputDir, "lessons-all.json"), JSON.stringify(allLessons, null, 2));

  const totals = {
    ok: entries.filter((e) => e.status === "ok").length,
    skipped: entries.filter((e) => e.status === "skipped").length,
    failed: entries.filter((e) => e.status === "failed").length,
  };
  const summary = {
    playlistId: info.playlistId,
    source: info.source,
    outputDir: options.outputDir,
    totals,
    entries,
  };
  await writeFile(path.join(options.outputDir, "summary.json"), JSON.stringify(summary, null, 2));
  await context.reportProgress?.({
    progress: info.entries.length + 1,
    total: info.entries.length + 1,
    message: `Done. ok=${totals.ok} skipped=${totals.skipped} failed=${totals.failed}.`,
  });

  return { playlistId: info.playlistId, source: info.source, outputDir: options.outputDir, entries, totals };
}
