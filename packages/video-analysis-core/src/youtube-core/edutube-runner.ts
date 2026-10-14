// Edutube feature: playlist-aware lesson extraction runner.
// Resolves a playlist (URL, id, single video, or CSV file), extracts a
// structured lesson per video with the long-path-first / windowed-fallback
// pipeline, writes lesson-NN.json files + a unified lessons-all.json, skips
// already-valid outputs (resume), and reports progress through the execution
// context.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type { GoogleGenAI } from "@google/genai";

import type { AnalysisExecutionContext } from "./analysis.js";
import {
  customLessonLooksValid,
  extractLessonFromVideo,
  lessonLooksValid,
  type CoursePreset,
} from "./lesson.js";
import { resolvePlaylistEntries, type PlaylistEntry, type PlaylistSource } from "./playlist.js";
import type { AnalysisSessionStore } from "./session-store.js";

export type EdutubeEntryResult = {
  index: number;
  videoId: string;
  title: string | null;
  status: "ok" | "skipped" | "failed";
  file?: string;
  strategyUsed?: string;
  /** Number of primary content items (dialogue lines / sounds+pairs+scripts / sentences+draft). */
  contentItems?: number;
  /** Kept for backward compatibility: dialogue line count (conversation lessons). */
  dialogue?: number;
  quiz?: number;
  error?: string;
};

export type EdutubeRunResult = {
  playlistId: string | null;
  source: PlaylistSource | string;
  outputDir: string;
  course: CoursePreset | "custom";
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
  /** Optional custom JSON schema; when set the preset schema is replaced entirely. */
  schemaJson?: string;
};

function lessonFile(outputDir: string, position: number): string {
  return path.join(outputDir, `lesson-${String(position).padStart(2, "0")}.json`);
}

/** Count the preset's primary content items inside lesson_content. */
export function countLessonContentItems(
  lesson: Record<string, unknown>,
  course: CoursePreset | "custom"
): number {
  const content = (lesson.lesson_content ?? {}) as Record<string, unknown>;
  const len = (v: unknown): number => (Array.isArray(v) ? v.length : 0);
  if (course === "phonetics") {
    return len(content.focus_sounds) + len(content.minimal_pairs) + len(content.practice_scripts);
  }
  if (course === "writing") {
    return (
      len(content.brainstorming_questions) +
      len(content.guided_sentences) +
      (content.final_draft && (content.final_draft as { en?: string }).en ? 1 : 0)
    );
  }
  if (course === "conversation") {
    return len(content.dialogue) + len(content.key_expressions);
  }
  return Object.values(content).reduce<number>((sum, v) => sum + (Array.isArray(v) ? v.length : 0), 0);
}

function cachedLessonLooksValid(lesson: unknown, options: EdutubeRunOptions): boolean {
  if (options.schemaJson?.trim()) return customLessonLooksValid(lesson);
  return lessonLooksValid(lesson, options.course ?? "conversation");
}

export async function runLessonExtraction(
  ai: GoogleGenAI,
  sessionStore: AnalysisSessionStore,
  options: EdutubeRunOptions,
  context: AnalysisExecutionContext
): Promise<EdutubeRunResult> {
  await mkdir(options.outputDir, { recursive: true });

  const course = options.course ?? "conversation";
  const isCustom = Boolean(options.schemaJson?.trim());
  const info = await resolvePlaylistEntries({ url: options.url, maxVideos: options.maxVideos ?? 50 });

  await context.reportProgress?.({
    progress: 0,
    total: info.entries.length + 1,
    message: `Resolved ${info.entries.length} video(s) via ${info.source}.`,
  });

  const entries: EdutubeEntryResult[] = [];
  const allLessons: unknown[] = [];

  for (const entry of info.entries) {
    if (context.abortSignal?.aborted) {
      throw new Error("Edutube extraction aborted.");
    }

    const position = resolvePosition(entry);
    const file = lessonFile(options.outputDir, position);

    try {
      const existing = await readFile(file, "utf8").catch(() => null);
      if (existing) {
        const parsed = JSON.parse(existing) as Record<string, unknown>;
        if (cachedLessonLooksValid(parsed, options)) {
          entries.push({
            index: entry.index,
            videoId: entry.videoId,
            title: entry.title,
            status: "skipped",
            file,
            contentItems: countLessonContentItems(parsed, isCustom ? "custom" : course),
            dialogue: Array.isArray((parsed.lesson_content as { dialogue?: unknown[] } | undefined)?.dialogue)
              ? ((parsed.lesson_content as { dialogue?: unknown[] }).dialogue as unknown[]).length
              : 0,
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
          responseSchemaJson: options.schemaJson,
        },
        context
      );

      await writeFile(file, JSON.stringify(result.lesson, null, 2));
      allLessons.push(result.lesson);
      const contentItems = countLessonContentItems(result.lesson, isCustom ? "custom" : course);
      const content = result.lesson.lesson_content as { dialogue?: unknown[] } | undefined;
      entries.push({
        index: entry.index,
        videoId: entry.videoId,
        title: entry.title,
        status: "ok",
        file,
        strategyUsed: result.strategyUsed,
        contentItems,
        dialogue: Array.isArray(content?.dialogue) ? content.dialogue.length : 0,
        quiz: Array.isArray(result.lesson.quiz) ? (result.lesson.quiz as unknown[]).length : 0,
      });
      await context.reportProgress?.({
        progress: entries.length,
        total: info.entries.length + 1,
        message: `Lesson ${position}: extracted via ${result.strategyUsed}.`,
      });
    } catch (error) {
      if (context.abortSignal?.aborted) {
        throw new Error("Edutube extraction aborted.");
      }
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
    course: isCustom ? "custom" : course,
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

  return {
    playlistId: info.playlistId,
    source: info.source,
    outputDir: options.outputDir,
    course: isCustom ? "custom" : course,
    entries,
    totals,
  };
}

/** CSV playlists can pin explicit lesson numbers; fall back to run order. */
function resolvePosition(entry: PlaylistEntry): number {
  return entry.lessonNo && entry.lessonNo > 0 ? entry.lessonNo : entry.index + 1;
}
