// Edutube feature: playlist-aware lesson extraction runner.
// Resolves a playlist (or single video) URL, extracts a structured lesson per
// video with the long-path-first / windowed-fallback pipeline, runs every lesson
// through the quality gate (repair → validate → retry with corrective feedback),
// writes lesson-NN.json + lessons-all.json + lessons-index.json + summary.json +
// curriculum-state.json + validation-report.json, and reports coverage for the
// whole curriculum. Interrupted runs resume from the state manifest.
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

import type { GoogleGenAI } from "@google/genai";

import type { AnalysisExecutionContext } from "./analysis.js";
import {
  computeCurriculumCoverage,
  getCourseDefinition,
  isCourseId,
  parseCurriculumManifest,
  type CourseId,
  type CurriculumCoverage,
  type CurriculumManifest,
  type LessonCoverageRecord,
} from "./curriculum.js";
import {
  extractLessonFromVideo,
  getLessonPreset,
  normalizeLesson,
  type CoursePreset,
} from "./lesson.js";
import {
  buildCorrectivePrompt,
  createValidationReport,
  repairLesson,
  summarizeIssues,
  validateLesson,
  type LessonValidationResult,
  type ValidationIssue,
  type ValidationReport,
} from "./lesson-validation.js";
import {
  resolvePlaylistEntries,
  type PlaylistEntry,
  type PlaylistInfo,
} from "./playlist.js";
import type { AnalysisSessionStore } from "./session-store.js";

export const STATE_FILE_NAME = "curriculum-state.json";
export const VALIDATION_REPORT_FILE_NAME = "validation-report.json";
export const LESSONS_INDEX_FILE_NAME = "lessons-index.json";
export const SUMMARY_FILE_NAME = "summary.json";
export const LESSONS_ALL_FILE_NAME = "lessons-all.json";

export type EdutubeEntryStatus =
  | "ok"
  | "extracted"
  | "cached"
  | "skipped"
  | "duplicate"
  | "invalid"
  | "failed";

export type EdutubeEntryResult = {
  index: number;
  lessonNo: number;
  videoId: string;
  title: string | null;
  status: EdutubeEntryStatus;
  file?: string;
  strategyUsed?: string;
  attempts?: number;
  durationMs?: number;
  /** @deprecated use `counts.dialogue`. */
  dialogue?: number;
  /** @deprecated use `counts.quiz`. */
  quiz?: number;
  counts?: Record<string, number>;
  repairs?: string[];
  validation?: {
    valid: boolean;
    score: number;
    errors: number;
    warnings: number;
    issues: ValidationIssue[];
  };
  error?: string;
};

export type EdutubeRunTotals = {
  ok: number;
  skipped: number;
  cached: number;
  duplicate: number;
  invalid: number;
  failed: number;
};

export type EdutubeRunResult = {
  playlistId: string | null;
  source: string;
  outputDir: string;
  course: CourseId;
  level: number;
  entries: EdutubeEntryResult[];
  totals: EdutubeRunTotals;
  validation: ValidationReport;
  coverage: CurriculumCoverage;
  files: Record<string, string>;
};

export type EdutubeRunOptions = {
  url: string;
  outputDir: string;
  course?: CoursePreset;
  level?: number;
  maxVideos?: number;
  /** 1-based playlist position to start from. */
  startIndex?: number;
  model?: string;
  chunkModel?: string;
  finalModel?: string;
  analysisPrompt?: string;
  /** Videos processed in parallel. Default 1 (quota-friendly). */
  concurrency?: number;
  /** Extraction attempts per video before the lesson is reported invalid. */
  maxAttempts?: number;
  /** Treat quality warnings as errors. */
  strict?: boolean;
  /** Re-extract only entries recorded as failed/invalid in the state manifest. */
  onlyFailed?: boolean;
  /** Ignore cached lesson files and re-extract everything. */
  force?: boolean;
  manifest?: CurriculumManifest | null;
  expectedLessons?: number | null;
  /** Dependency injection points (used by tests and by callers with their own resolvers). */
  resolveEntries?: (options: {
    url: string;
    maxVideos?: number;
  }) => Promise<PlaylistInfo>;
  extractLesson?: typeof extractLessonFromVideo;
};

export type LessonStateRecord = {
  lesson_no: number;
  video_id: string;
  title: string | null;
  file: string;
  status: EdutubeEntryStatus;
  strategy_used?: string;
  attempts: number;
  validation: { valid: boolean; score: number; errors: number; warnings: number };
  repairs: string[];
  extracted_at: string;
  error?: string | null;
};

export type LessonStateManifest = {
  schema_version: number;
  generated_at: string;
  course: CourseId;
  course_name_ar: string;
  level: number;
  playlist_id: string | null;
  source: string;
  output_dir: string;
  lessons: LessonStateRecord[];
  totals: EdutubeRunTotals;
};

export function lessonFileName(position: number): string {
  return `lesson-${String(position).padStart(2, "0")}.json`;
}

export function lessonFile(outputDir: string, position: number): string {
  return path.join(outputDir, lessonFileName(position));
}

export function lessonPositionFromFileName(fileName: string): number | null {
  const match = /^lesson-(\d+)\.json$/.exec(fileName);
  return match ? Number.parseInt(match[1], 10) : null;
}

function sortByLessonNo<T>(items: T[], noOf: (item: T) => number): T[] {
  return [...items].sort((a, b) => noOf(a) - noOf(b));
}

async function readJsonFile(file: string): Promise<Record<string, unknown> | null> {
  try {
    const raw = await readFile(file, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

async function writeJson(file: string, value: unknown): Promise<void> {
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function readStateManifest(outputDir: string): Promise<LessonStateManifest | null> {
  const parsed = await readJsonFile(path.join(outputDir, STATE_FILE_NAME));
  if (!parsed || !Array.isArray(parsed.lessons)) return null;
  return parsed as unknown as LessonStateManifest;
}

export async function loadCurriculumManifestFile(file: string): Promise<CurriculumManifest> {
  const raw = await readFile(file, "utf8");
  return parseCurriculumManifest(JSON.parse(raw));
}

/** Throws a clear, actionable error when the output directory does not exist. */
export async function assertReadableDir(outputDir: string): Promise<void> {
  try {
    await readdir(outputDir);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Output directory not found or unreadable: ${outputDir} (${reason})`);
  }
}

/** Lists lesson files in a directory, ordered by lesson number. */
export async function listLessonFiles(outputDir: string): Promise<Array<{ file: string; lessonNo: number }>> {
  const names = await readdir(outputDir).catch(() => [] as string[]);
  return sortByLessonNo(
    names
      .map((name) => ({ file: path.join(outputDir, name), lessonNo: lessonPositionFromFileName(name) }))
      .filter((entry): entry is { file: string; lessonNo: number } => entry.lessonNo !== null),
    (entry) => entry.lessonNo
  );
}

export type DirectoryValidationResult = {
  outputDir: string;
  course: CourseId | null;
  report: ValidationReport;
  coverage: CurriculumCoverage;
  repairedFiles: string[];
};

/**
 * Validates (and optionally repairs) every lesson file in an output directory.
 * Backs `edutube-mcp validate` and the `validate_edutube_lessons` MCP tool.
 */
export async function validateLessonDirectory(options: {
  outputDir: string;
  course?: CourseId | string;
  strict?: boolean;
  repair?: boolean;
  manifest?: CurriculumManifest | null;
}): Promise<DirectoryValidationResult> {
  await assertReadableDir(options.outputDir);
  const files = await listLessonFiles(options.outputDir);
  const entries: Array<{
    file: string | null;
    lessonNo: number | null;
    title: string | null;
    courseId: string | null;
    result: LessonValidationResult;
  }> = [];
  const coverageRecords: LessonCoverageRecord[] = [];
  const repairedFiles: string[] = [];
  let detectedCourse: CourseId | null = isCourseId(options.course) ? options.course : null;

  for (const entry of files) {
    const lesson = await readJsonFile(entry.file);
    if (!lesson) {
      entries.push({
        file: entry.file,
        lessonNo: entry.lessonNo,
        title: null,
        courseId: null,
        result: {
          valid: false,
          score: 0,
          errors: 1,
          warnings: 0,
          issues: [
            {
              code: "lesson.unreadable",
              severity: "error",
              path: entry.file,
              message: "Lesson file is missing or is not a JSON object.",
            },
          ],
          counts: {},
        },
      });
      coverageRecords.push({
        metadata: { lesson_no: entry.lessonNo, course_id: detectedCourse ?? "conversation", level: 1 },
        file: entry.file,
        valid: false,
        issues: 1,
      });
      continue;
    }

    const metadata = (lesson.metadata ?? {}) as Record<string, unknown>;
    const courseId = typeof metadata.course_id === "string" ? metadata.course_id : options.course;
    if (!detectedCourse && isCourseId(courseId)) detectedCourse = courseId;
    const courseForLesson = courseId ?? detectedCourse ?? "conversation";

    let candidate = lesson;
    let repairs: string[] = [];
    if (options.repair) {
      const repaired = repairLesson(lesson, {
        course: courseForLesson,
        lessonNo: entry.lessonNo,
        fallbackTitle: typeof metadata.title === "string" ? metadata.title : undefined,
      });
      candidate = repaired.lesson;
      repairs = repaired.repairs;
      if (repairs.length > 0) {
        await writeJson(entry.file, candidate);
        repairedFiles.push(entry.file);
      }
    }

    const result = validateLesson(candidate, {
      course: courseForLesson,
      lessonNo: entry.lessonNo,
      strict: options.strict,
    });

    entries.push({
      file: entry.file,
      lessonNo: entry.lessonNo,
      title: typeof metadata.title === "string" ? metadata.title : null,
      courseId: courseForLesson,
      result,
    });
    coverageRecords.push({
      metadata: (candidate.metadata ?? metadata) as Record<string, unknown>,
      file: entry.file,
      valid: result.valid,
      issues: result.issues.length,
      status: repairs.length > 0 ? "repaired" : "validated",
    });
  }

  return {
    outputDir: options.outputDir,
    course: detectedCourse,
    report: createValidationReport(entries),
    coverage: computeCurriculumCoverage({ records: coverageRecords, manifest: options.manifest ?? null }),
    repairedFiles,
  };
}

async function mapAsync<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  const limit = Math.max(1, Math.min(concurrency, items.length || 1));
  let cursor = 0;

  const runners = Array.from({ length: limit }, async () => {
    for (;;) {
      const current = cursor;
      cursor += 1;
      if (current >= items.length) return;
      results[current] = await worker(items[current], current);
    }
  });

  await Promise.all(runners);
  return results;
}

export async function runLessonExtraction(
  ai: GoogleGenAI,
  sessionStore: AnalysisSessionStore,
  options: EdutubeRunOptions,
  context: AnalysisExecutionContext
): Promise<EdutubeRunResult> {
  await mkdir(options.outputDir, { recursive: true });

  const course: CourseId = isCourseId(options.course) ? options.course : "conversation";
  const definition = getCourseDefinition(course);
  const level = options.level ?? 1;
  const maxAttempts = Math.max(1, options.maxAttempts ?? 2);
  const concurrency = Math.max(1, options.concurrency ?? 1);
  const extract = options.extractLesson ?? extractLessonFromVideo;

  const info = await (options.resolveEntries ?? resolvePlaylistEntries)({
    url: options.url,
    maxVideos: options.maxVideos ?? 50,
    startIndex: options.startIndex,
  });

  const previousState = options.onlyFailed ? await readStateManifest(options.outputDir) : null;
  const previousByVideo = new Map<string, LessonStateRecord>(
    (previousState?.lessons ?? []).map((record) => [record.video_id, record])
  );

  // Duplicate playlist entries (the same video listed twice) are extracted once.
  const seenVideoIds = new Set<string>();
  const plan = info.entries.map((entry, index) => {
    const duplicate = seenVideoIds.has(entry.videoId);
    if (!duplicate) seenVideoIds.add(entry.videoId);
    return { entry, position: index + 1, duplicate };
  });

  await context.reportProgress?.({
    progress: 0,
    total: plan.length + 1,
    message: `Resolved ${plan.length} video(s) via ${info.source} · course=${course} level=${level}.`,
  });

  const results = new Array<EdutubeEntryResult | null>(plan.length);
  let completed = 0;

  await mapAsync(plan, concurrency, async ({ entry, position, duplicate }) => {
    const file = lessonFile(options.outputDir, position);
    const startedAt = Date.now();

    if (duplicate) {
      results[position - 1] = {
        index: entry.index,
        lessonNo: position,
        videoId: entry.videoId,
        title: entry.title,
        status: "duplicate",
        file,
        error: "Playlist contains this video more than once; extracted once.",
      };
      return;
    }

    const previous = previousByVideo.get(entry.videoId);
    if (options.onlyFailed && previous && previous.status !== "failed" && previous.status !== "invalid") {
      const cached = await readJsonFile(file);
      results[position - 1] = {
        index: entry.index,
        lessonNo: position,
        videoId: entry.videoId,
        title: entry.title ?? previous.title,
        status: "cached",
        file,
        strategyUsed: previous.strategy_used,
        attempts: previous.attempts,
        counts: cached ? countLesson(cached) : undefined,
        validation: { ...previous.validation, issues: [] },
      };
      return;
    }

    if (!options.force && !options.onlyFailed) {
      const cached = await readJsonFile(file);
      if (cached) {
        const cachedValidation = validateLesson(cached, { course, lessonNo: position });
        if (cachedValidation.valid) {
          results[position - 1] = {
            index: entry.index,
            lessonNo: position,
            videoId: entry.videoId,
            title: entry.title ?? titleOf(cached),
            status: "cached",
            file,
            attempts: 0,
            counts: countLesson(cached),
            validation: { ...cachedValidation, issues: cachedValidation.issues },
          };
          return;
        }
        context.logger.warn("edutube.cached_invalid", {
          file,
          score: cachedValidation.score,
          summary: summarizeIssues(cachedValidation, 3),
        });
      }
    }

    let lastError: string | undefined;
    let lastValidation: LessonValidationResult | undefined;
    let best:
      | { lesson: Record<string, unknown>; repairs: string[]; validationScore: number }
      | undefined;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      if (context.abortSignal?.aborted) {
        lastError = "Request aborted.";
        break;
      }
      try {
        const prompt =
          attempt === 1
            ? options.analysisPrompt
            : `${options.analysisPrompt ?? getLessonPreset(course).prompt}${buildCorrectivePrompt(
                lastValidation ?? { issues: [], valid: false, score: 0, errors: 0, warnings: 0, counts: {} }
              )}`;

        const extracted = await extract(
          ai,
          sessionStore,
          {
            youtubeUrl: `https://www.youtube.com/watch?v=${entry.videoId}`,
            position,
            fallbackTitle: entry.title ?? undefined,
            course,
            level,
            model: options.model,
            chunkModel: options.chunkModel,
            finalModel: options.finalModel,
            analysisPrompt: prompt,
          },
          context
        );

        const repaired = repairLesson(extracted.lesson, {
          course,
          lessonNo: position,
          fallbackTitle: entry.title ?? undefined,
        });
        const normalized = normalizeLesson(repaired.lesson, {
          position,
          fallbackTitle: entry.title ?? undefined,
          courseId: course,
          courseNameAr: definition.nameAr,
          level,
        });
        const validation = validateLesson(normalized, {
          course,
          lessonNo: position,
          strict: options.strict,
        });

        lastValidation = validation;
        if (!best || validation.score > best.validationScore) {
          best = { lesson: normalized, repairs: repaired.repairs, validationScore: validation.score };
        }

        if (validation.valid) {
          await writeJson(file, normalized);
          results[position - 1] = {
            index: entry.index,
            lessonNo: position,
            videoId: entry.videoId,
            title: titleOf(normalized) ?? entry.title,
            status: "extracted",
            file,
            strategyUsed: extracted.strategyUsed,
            attempts: attempt,
            durationMs: Date.now() - startedAt,
            counts: countLesson(normalized),
            repairs: repaired.repairs,
            validation: toValidationSummary(validation),
          };
          return;
        }

        context.logger.warn("edutube.lesson_rejected", {
          file,
          attempt,
          score: validation.score,
          summary: summarizeIssues(validation, 4),
        });
        lastError = summarizeIssues(validation, 4);
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        context.logger.warn("edutube.lesson_attempt_failed", {
          file,
          attempt,
          error: lastError.slice(0, 200),
        });
      }
    }

    // Every attempt failed the gate: keep the best attempt on disk for review
    // and report it so the operator can re-run just this lesson.
    if (best) {
      await writeJson(file, best.lesson);
      results[position - 1] = {
        index: entry.index,
        lessonNo: position,
        videoId: entry.videoId,
        title: titleOf(best.lesson) ?? entry.title,
        status: "invalid",
        file,
        attempts: maxAttempts,
        durationMs: Date.now() - startedAt,
        counts: countLesson(best.lesson),
        repairs: best.repairs,
        validation: lastValidation ? toValidationSummary(lastValidation) : undefined,
        error: lastError,
      };
      return;
    }

    results[position - 1] = {
      index: entry.index,
      lessonNo: position,
      videoId: entry.videoId,
      title: entry.title,
      status: "failed",
      attempts: maxAttempts,
      durationMs: Date.now() - startedAt,
      error: (lastError ?? "Extraction failed.").slice(0, 500),
    };
  });

  const entries = results.filter((entry): entry is EdutubeEntryResult => entry !== null);

  // Aggregate every lesson on disk (cached + new) into the LMS-ready bundle.
  const lessons: Array<Record<string, unknown>> = [];
  const coverageRecords: LessonCoverageRecord[] = [];
  for (const entry of sortByLessonNo(entries, (e) => e.lessonNo)) {
    if (!entry.file) continue;
    const lesson = await readJsonFile(entry.file);
    if (!lesson) continue;
    lessons.push(lesson);
    coverageRecords.push({
      metadata: lesson.metadata as Record<string, unknown>,
      videoId: entry.videoId,
      file: entry.file,
      valid: entry.status !== "invalid" && entry.status !== "failed" && entry.validation?.valid !== false,
      issues: entry.validation?.issues.length ?? 0,
      status: entry.status,
    });
  }

  const expected = options.expectedLessons ?? manifestExpected(options.manifest, course, level);
  const coverage = computeCurriculumCoverage({
    records: coverageRecords,
    manifest: options.manifest
      ? {
          ...options.manifest,
          courses: options.manifest.courses.map((c) =>
            c.course_id === course && c.level === level && expected
              ? { ...c, expected_lessons: expected }
              : c
          ),
        }
      : expected
        ? {
            curriculum_id: "single-run",
            curriculum_name_ar: "تشغيل مفرد",
            courses: [{ course_id: course, level, expected_lessons: expected }],
          }
        : null,
  });

  const reportEntries = entries
    .filter((entry) => entry.validation)
    .map((entry) => ({
      file: entry.file ?? null,
      lessonNo: entry.lessonNo,
      title: entry.title,
      courseId: course,
      result: {
        valid: entry.validation?.valid ?? false,
        score: entry.validation?.score ?? 0,
        errors: entry.validation?.errors ?? 0,
        warnings: entry.validation?.warnings ?? 0,
        issues: entry.validation?.issues ?? [],
        counts: entry.counts ?? {},
      },
    }));
  const validationReport = createValidationReport(reportEntries);

  const totals: EdutubeRunTotals = {
    ok: entries.filter((e) => e.status === "extracted").length,
    cached: entries.filter((e) => e.status === "cached").length,
    skipped: entries.filter((e) => e.status === "cached").length,
    duplicate: entries.filter((e) => e.status === "duplicate").length,
    invalid: entries.filter((e) => e.status === "invalid").length,
    failed: entries.filter((e) => e.status === "failed").length,
  };

  const generatedAt = new Date().toISOString();
  const state: LessonStateManifest = {
    schema_version: 1,
    generated_at: generatedAt,
    course,
    course_name_ar: definition.nameAr,
    level,
    playlist_id: info.playlistId,
    source: info.source,
    output_dir: options.outputDir,
    lessons: entries.map((entry) => ({
      lesson_no: entry.lessonNo,
      video_id: entry.videoId,
      title: entry.title,
      file: entry.file ? path.basename(entry.file) : lessonFileName(entry.lessonNo),
      status: entry.status,
      strategy_used: entry.strategyUsed,
      attempts: entry.attempts ?? 0,
      validation: {
        valid: entry.validation?.valid ?? false,
        score: entry.validation?.score ?? 0,
        errors: entry.validation?.errors ?? 0,
        warnings: entry.validation?.warnings ?? 0,
      },
      repairs: entry.repairs ?? [],
      extracted_at: generatedAt,
      error: entry.error ?? null,
    })),
    totals,
  };

  const summary = {
    generated_at: generatedAt,
    playlistId: info.playlistId,
    source: info.source,
    outputDir: options.outputDir,
    course,
    course_name_ar: definition.nameAr,
    level,
    totals,
    validation: validationReport.totals,
    coverage,
    entries,
  };

  const lessonsIndex = {
    generated_at: generatedAt,
    curriculum_id: coverage.curriculum_id,
    curriculum_name_ar: coverage.curriculum_name_ar,
    course,
    course_name_ar: definition.nameAr,
    level,
    lesson_count: lessons.length,
    lessons: lessons.map((lesson, i) => {
      const metadata = (lesson.metadata ?? {}) as Record<string, unknown>;
      return {
        lesson_no: metadata.lesson_no ?? i + 1,
        title: metadata.title ?? null,
        file: lessonFileName(Number(metadata.lesson_no ?? i + 1)),
        valid: validationReport.lessons.find((l) => l.lesson_no === (metadata.lesson_no ?? i + 1))?.valid ?? true,
      };
    }),
  };

  const files: Record<string, string> = {};
  const lessonsAllPath = path.join(options.outputDir, LESSONS_ALL_FILE_NAME);
  const summaryPath = path.join(options.outputDir, SUMMARY_FILE_NAME);
  const statePath = path.join(options.outputDir, STATE_FILE_NAME);
  const reportPath = path.join(options.outputDir, VALIDATION_REPORT_FILE_NAME);
  const indexPath = path.join(options.outputDir, LESSONS_INDEX_FILE_NAME);

  await writeJson(lessonsAllPath, lessons);
  await writeJson(summaryPath, summary);
  await writeJson(statePath, state);
  await writeJson(reportPath, validationReport);
  await writeJson(indexPath, lessonsIndex);
  files.lessonsAll = lessonsAllPath;
  files.summary = summaryPath;
  files.state = statePath;
  files.validationReport = reportPath;
  files.index = indexPath;

  await context.reportProgress?.({
    progress: plan.length + 1,
    total: plan.length + 1,
    message:
      `Done. extracted=${totals.ok} cached=${totals.cached} invalid=${totals.invalid} ` +
      `failed=${totals.failed} duplicate=${totals.duplicate} · ` +
      `valid=${validationReport.totals.valid}/${validationReport.totals.lessons} · ` +
      `coverage=${Math.round(coverage.totals.completion * 100)}%.`,
  });

  return {
    playlistId: info.playlistId,
    source: info.source,
    outputDir: options.outputDir,
    course,
    level,
    entries,
    totals,
    validation: validationReport,
    coverage,
    files,
  };
}

function manifestExpected(
  manifest: CurriculumManifest | null | undefined,
  course: CourseId,
  level: number
): number | null {
  const entry = manifest?.courses.find((c) => c.course_id === course && c.level === level);
  return entry?.expected_lessons ?? null;
}

function titleOf(lesson: Record<string, unknown>): string | null {
  const metadata = lesson.metadata as Record<string, unknown> | undefined;
  return typeof metadata?.title === "string" && metadata.title.trim() ? metadata.title : null;
}

function countLesson(lesson: Record<string, unknown>): Record<string, number> {
  const content = (lesson.lesson_content ?? {}) as Record<string, unknown>;
  const counts: Record<string, number> = {};
  for (const [key, value] of Object.entries(content)) {
    if (Array.isArray(value)) counts[key] = value.length;
  }
  counts.global_vocabulary = Array.isArray(lesson.global_vocabulary) ? lesson.global_vocabulary.length : 0;
  counts.lesson_notes = Array.isArray(lesson.lesson_notes) ? lesson.lesson_notes.length : 0;
  counts.quiz = Array.isArray(lesson.quiz) ? lesson.quiz.length : 0;
  return counts;
}

function toValidationSummary(result: LessonValidationResult): EdutubeEntryResult["validation"] {
  return {
    valid: result.valid,
    score: result.score,
    errors: result.errors,
    warnings: result.warnings,
    issues: result.issues,
  };
}

export type { PlaylistEntry };
