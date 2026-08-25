// Edutube feature: structured lesson extraction pipeline with course presets.
// 1) Tries the full-video long-analysis path with the preset LMS JSON schema.
// 2) Validates the result (content arrays must not be empty).
// 3) Falls back to 150s windowed extraction + merge/dedupe when the long path
//    fails (quota, deadlines, very long videos).
import type { GoogleGenAI } from "@google/genai";

import {
  analyzeLongVideo,
  analyzeShortVideo,
  type AnalysisExecutionContext,
} from "./analysis.js";
import { fetchLongVideoMetadata } from "./youtube-metadata.js";
import type { AnalysisSessionStore } from "./session-store.js";
import type { JsonObject } from "../lib/types.js";

export const LESSON_WINDOW_SECONDS = 150;

export type CoursePreset = "conversation" | "phonetics";

/* ------------------------------ conversation ------------------------------ */

export const LESSON_SCHEMA: JsonObject = {
  type: "object",
  properties: {
    metadata: {
      type: "object",
      properties: {
        course_id: { type: "string" },
        course_name_ar: { type: "string" },
        level: { type: "integer" },
        lesson_no: { type: "integer" },
        title: { type: "string" },
      },
      required: ["course_id", "course_name_ar", "level", "lesson_no", "title"],
    },
    lesson_content: {
      type: "object",
      properties: {
        dialogue: {
          type: "array",
          items: {
            type: "object",
            properties: {
              speaker: { type: "string" },
              en: { type: "string" },
              ar: { type: "string" },
            },
            required: ["speaker", "en", "ar"],
          },
        },
        key_expressions: {
          type: "array",
          items: {
            type: "object",
            properties: {
              expression_en: { type: "string" },
              expression_ar: { type: "string" },
              usage_ar: { type: "string" },
            },
            required: ["expression_en", "expression_ar", "usage_ar"],
          },
        },
      },
      required: ["dialogue", "key_expressions"],
    },
    global_vocabulary: {
      type: "array",
      items: {
        type: "object",
        properties: {
          word: { type: "string" },
          meaning: { type: "string" },
          example_en: { type: "string" },
          example_ar: { type: "string" },
        },
        required: ["word", "meaning", "example_en", "example_ar"],
      },
    },
    lesson_notes: { type: "array", items: { type: "string" } },
    quiz: {
      type: "array",
      items: {
        type: "object",
        properties: {
          type: { type: "string" },
          question: { type: "string" },
          word_to_speak: { type: "string", nullable: true },
          options: { type: "array", items: { type: "string" }, nullable: true },
          answer: { type: "string" },
          explanation_ar: { type: "string" },
        },
        required: ["type", "question", "word_to_speak", "options", "answer", "explanation_ar"],
      },
    },
  },
  required: ["metadata", "lesson_content", "global_vocabulary", "lesson_notes", "quiz"],
};

export const DEFAULT_LESSON_PROMPT = `You are a Senior Educational Data Extractor and Conversation Architect. The video is a lesson from an English conversation course (Arabic teaching commentary + English dialogues).
Fill the JSON schema completely:
- dialogue: EVERY spoken line in order (speaker name, exact English sentence, accurate Arabic translation). Must not be empty.
- key_expressions: phrases/idioms the teacher highlights; expression_en, expression_ar, usage_ar.
- global_vocabulary: highlighted words with meaning, example_en (preferably from the dialogue), example_ar. No orphan words.
- lesson_notes: cultural notes and pronunciation tricks, in clear Arabic.
- quiz: EXACTLY 10 questions mixing multiple_choice (4 options), true_false, written (options=null); every question has explanation_ar.
- metadata: course_id "conversation", course_name_ar "المحادثة", level 1, lesson_no and title from the video.`;

/* -------------------------------- phonetics -------------------------------- */

export const PHONETICS_SCHEMA: JsonObject = {
  type: "object",
  properties: {
    metadata: {
      type: "object",
      properties: {
        course_id: { type: "string" },
        course_name_ar: { type: "string" },
        level: { type: "integer" },
        lesson_no: { type: "integer" },
        title: { type: "string" },
      },
      required: ["course_id", "course_name_ar", "level", "lesson_no", "title"],
    },
    lesson_content: {
      type: "object",
      properties: {
        focus_sounds: {
          type: "array",
          items: {
            type: "object",
            properties: { symbol: { type: "string" }, description: { type: "string" } },
            required: ["symbol", "description"],
          },
        },
        minimal_pairs: {
          type: "array",
          items: {
            type: "object",
            properties: { word1: { type: "string" }, word2: { type: "string" } },
            required: ["word1", "word2"],
          },
        },
        practice_scripts: { type: "array", items: { type: "string" } },
      },
      required: ["focus_sounds", "minimal_pairs", "practice_scripts"],
    },
    global_vocabulary: {
      type: "array",
      items: {
        type: "object",
        properties: {
          word: { type: "string" },
          meaning: { type: "string" },
          example_en: { type: "string" },
          example_ar: { type: "string" },
        },
        required: ["word", "meaning", "example_en", "example_ar"],
      },
    },
    lesson_notes: { type: "array", items: { type: "string" } },
    quiz: {
      type: "array",
      items: {
        type: "object",
        properties: {
          type: { type: "string" },
          question: { type: "string" },
          word_to_speak: { type: "string", nullable: true },
          options: { type: "array", items: { type: "string" }, nullable: true },
          answer: { type: "string" },
          explanation_ar: { type: "string" },
        },
        required: ["type", "question", "word_to_speak", "options", "answer", "explanation_ar"],
      },
    },
  },
  required: ["metadata", "lesson_content", "global_vocabulary", "lesson_notes", "quiz"],
};

export const PHONETICS_LESSON_PROMPT = `You are a Senior Educational Data Extractor and Phonetics Architect. The source is THE ACTUAL VIDEO provided with this request (spoken audio + on-screen text). The video is a lesson from the "Phonetics" (الصوتيات) English course by Ibrahim Adel (ZAmericanEnglish), focused on pronunciation, mouth physiology, distinguishing similar sounds, and shadowing practice.
Fill the JSON schema completely:
- focus_sounds: the specific sounds taught (e.g. "/p/"); description = very clear Arabic explanation of how to physically produce the sound (lips/tongue/air/voicing), exactly as the teacher explained.
- minimal_pairs: contrasting word pairs used to compare sounds (word1, word2), e.g. Pack/Back.
- practice_scripts: long sentences or tongue twisters given for speed/shadowing practice.
- global_vocabulary: ONLY words whose meaning the teacher explicitly explains as new vocabulary; always include example_en and example_ar (generate a simple A1 example if needed).
- lesson_notes: warnings about common pronunciation mistakes Arab speakers make, in Arabic.
- quiz: EXACTLY 10 questions; MOST must be type "audio_quiz" with question "استمع واختر الكلمة الصحيحة التي سمعتها", word_to_speak set to the word the app must synthesize, and tricky minimal-pair options (4 options, answer included); include 2-3 true_false questions about mouth physiology; EVERY question has explanation_ar.
- metadata: course_id "phonetics", course_name_ar "الصوتيات", level 1, lesson_no and title from the video.`;

/* --------------------------------- presets --------------------------------- */

export interface LessonPreset {
  schema: JsonObject;
  prompt: string;
  courseId: string;
  courseNameAr: string;
}

export function getLessonPreset(course: CoursePreset): LessonPreset {
  if (course === "phonetics") {
    return {
      schema: PHONETICS_SCHEMA,
      prompt: PHONETICS_LESSON_PROMPT,
      courseId: "phonetics",
      courseNameAr: "الصوتيات",
    };
  }
  return {
    schema: LESSON_SCHEMA,
    prompt: DEFAULT_LESSON_PROMPT,
    courseId: "conversation",
    courseNameAr: "المحادثة",
  };
}

export const LESSON_WINDOW_SCHEMA: JsonObject = {
  ...(LESSON_SCHEMA as Record<string, unknown>),
  properties: Object.fromEntries(
    Object.entries((LESSON_SCHEMA as { properties: Record<string, unknown> }).properties).filter(
      ([key]) => key !== "metadata"
    )
  ),
  required: ["lesson_content", "global_vocabulary", "lesson_notes", "quiz"],
} as JsonObject;

export function windowSchemaFor(course: CoursePreset): JsonObject {
  const base = getLessonPreset(course).schema as { properties: Record<string, unknown> };
  return {
    ...base,
    properties: Object.fromEntries(Object.entries(base.properties).filter(([k]) => k !== "metadata")),
    required: ["lesson_content", "global_vocabulary", "lesson_notes", "quiz"],
  } as JsonObject;
}

export type LessonWindow = {
  dialogue: Array<Record<string, unknown>>;
  key_expressions: Array<Record<string, unknown>>;
  focus_sounds: Array<Record<string, unknown>>;
  minimal_pairs: Array<Record<string, unknown>>;
  practice_scripts: string[];
  global_vocabulary: Array<Record<string, unknown>>;
  lesson_notes: string[];
  quiz: Array<Record<string, unknown>>;
};

export function emptyLessonWindow(): LessonWindow {
  return {
    dialogue: [],
    key_expressions: [],
    focus_sounds: [],
    minimal_pairs: [],
    practice_scripts: [],
    global_vocabulary: [],
    lesson_notes: [],
    quiz: [],
  };
}

export function mergeLessonWindows(windows: LessonWindow[]): LessonWindow {
  const merged = emptyLessonWindow();
  const seen = {
    expr: new Set<string>(),
    word: new Set<string>(),
    note: new Set<string>(),
    quiz: new Set<string>(),
    sound: new Set<string>(),
    pair: new Set<string>(),
    script: new Set<string>(),
  };
  for (const w of windows) {
    merged.dialogue.push(...(w.dialogue || []));
    for (const k of w.key_expressions || []) {
      const key = String(k.expression_en || "").toLowerCase();
      if (key && !seen.expr.has(key)) {
        seen.expr.add(key);
        merged.key_expressions.push(k);
      }
    }
    for (const s of w.focus_sounds || []) {
      const key = String(s.symbol || "").toLowerCase();
      if (key && !seen.sound.has(key)) {
        seen.sound.add(key);
        merged.focus_sounds.push(s);
      }
    }
    for (const p of w.minimal_pairs || []) {
      const key = [p.word1, p.word2].map((x) => String(x || "").toLowerCase()).sort().join("|");
      if (key && !seen.pair.has(key)) {
        seen.pair.add(key);
        merged.minimal_pairs.push(p);
      }
    }
    for (const sc of w.practice_scripts || []) {
      if (sc && !seen.script.has(sc)) {
        seen.script.add(sc);
        merged.practice_scripts.push(sc);
      }
    }
    for (const v of w.global_vocabulary || []) {
      const key = String(v.word || "").toLowerCase();
      if (key && !seen.word.has(key)) {
        seen.word.add(key);
        merged.global_vocabulary.push(v);
      }
    }
    for (const n of w.lesson_notes || []) {
      if (n && !seen.note.has(n)) {
        seen.note.add(n);
        merged.lesson_notes.push(n);
      }
    }
    for (const q of w.quiz || []) {
      const key = String(q.question || "").slice(0, 80) + "|" + String(q.word_to_speak || "");
      if (key && !seen.quiz.has(key)) {
        seen.quiz.add(key);
        merged.quiz.push(q);
      }
    }
  }
  return merged;
}

export function normalizeLesson(
  lesson: Record<string, unknown>,
  options: {
    position?: number;
    fallbackTitle?: string;
    courseId?: string;
    courseNameAr?: string;
  }
): Record<string, unknown> {
  const metadata =
    lesson.metadata && typeof lesson.metadata === "object"
      ? ({ ...(lesson.metadata as Record<string, unknown>) } as Record<string, unknown>)
      : {};
  metadata.course_id = options.courseId ?? "conversation";
  metadata.course_name_ar = options.courseNameAr ?? "المحادثة";
  metadata.level = 1;
  if (options.position !== undefined) metadata.lesson_no = options.position;
  else if (typeof metadata.lesson_no !== "number") metadata.lesson_no = options.position ?? 1;
  if (!metadata.title && options.fallbackTitle) metadata.title = options.fallbackTitle;

  const quiz = Array.isArray(lesson.quiz) ? (lesson.quiz as unknown[]).slice(0, 10) : [];
  return { ...lesson, metadata, quiz };
}

export function lessonLooksValid(lesson: unknown, course: CoursePreset = "conversation"): boolean {
  if (!lesson || typeof lesson !== "object") return false;
  const l = lesson as Record<string, unknown>;
  const content = (l.lesson_content ?? {}) as Record<string, unknown>;
  const quiz = l.quiz;
  if (!Array.isArray(quiz) || quiz.length < 5) return false;
  if (course === "phonetics") {
    const sounds = content.focus_sounds;
    const pairs = content.minimal_pairs;
    const scripts = content.practice_scripts;
    return (
      (Array.isArray(sounds) && sounds.length > 0) ||
      (Array.isArray(pairs) && pairs.length > 0) ||
      (Array.isArray(scripts) && scripts.length > 0)
    );
  }
  const dialogue = content.dialogue;
  return Array.isArray(dialogue) && dialogue.length > 0;
}

export const DEFAULT_WINDOW_PROMPT = (start: number, end: number) =>
  `You are a Senior Educational Data Extractor. Analyze ONLY the clip window ${start}s-${end}s of this conversation-course lesson.
- dialogue: EVERY spoken line in this window, in order (speaker, exact English, accurate Arabic translation).
- key_expressions: expressions/idioms highlighted in this window (expression_en, expression_ar, usage_ar).
- global_vocabulary: new words highlighted here with meaning + example_en + example_ar.
- lesson_notes: cultural/pronunciation notes from this window, in Arabic.
- quiz: at most 3 questions about THIS window only (mix multiple_choice/true_false/written) with explanation_ar.`;

export type LessonExtractionResult = {
  lesson: Record<string, unknown>;
  strategyUsed: "long_single_pass" | "windowed_fallback";
  windowsProcessed?: number;
};

export async function extractLessonFromVideo(
  ai: GoogleGenAI,
  sessionStore: AnalysisSessionStore,
  params: {
    youtubeUrl: string;
    position?: number;
    fallbackTitle?: string;
    course?: CoursePreset;
    model?: string;
    chunkModel?: string;
    finalModel?: string;
    analysisPrompt?: string;
    windowPromptFactory?: (start: number, end: number) => string;
    windowSeconds?: number;
  },
  context: AnalysisExecutionContext
): Promise<LessonExtractionResult> {
  const course: CoursePreset = params.course ?? "conversation";
  const preset = getLessonPreset(course);
  const model = params.model || "gemini-2.5-flash";

  try {
    const longResult = await analyzeLongVideo(
      ai,
      sessionStore,
      {
        youtubeUrl: params.youtubeUrl,
        strategy: "auto",
        chunkModel: params.chunkModel ?? model,
        finalModel: params.finalModel ?? model,
        analysisPrompt: params.analysisPrompt ?? preset.prompt,
        responseSchemaJson: JSON.stringify(preset.schema),
      },
      context
    );
    const analysis = longResult.analysis as Record<string, unknown> | undefined;
    if (analysis && lessonLooksValid(analysis, course)) {
      return {
        lesson: normalizeLesson(analysis, {
          position: params.position,
          fallbackTitle: params.fallbackTitle,
          courseId: preset.courseId,
          courseNameAr: preset.courseNameAr,
        }),
        strategyUsed: "long_single_pass",
      };
    }
  } catch {
    // fall through to windowed extraction
  }

  const metadata = await fetchLongVideoMetadata({
    youtubeUrl: params.youtubeUrl,
    normalizedYoutubeUrl: params.youtubeUrl,
    signal: context.abortSignal,
  });
  const duration = Math.ceil(metadata.durationSeconds);
  const step = params.windowSeconds ?? LESSON_WINDOW_SECONDS;
  const factory =
    params.windowPromptFactory ??
    (params.analysisPrompt
      ? (start: number, end: number) =>
          `${params.analysisPrompt}\n\nIMPORTANT: analyze ONLY the clip window ${start}s-${end}s of the video; content and quiz must cover this window only (max 3 quiz questions).`
      : course === "phonetics"
        ? (start: number, end: number) =>
            `${preset.prompt}\n\nIMPORTANT: analyze ONLY the clip window ${start}s-${end}s of the video; content and quiz must cover this window only (max 3 quiz questions, audio_quiz preferred).`
        : DEFAULT_WINDOW_PROMPT);

  const windows: LessonWindow[] = [];
  for (let start = 0; start < duration; start += step) {
    const end = Math.min(start + step, duration);
    const short = await analyzeShortVideo(
      ai,
      {
        youtubeUrl: params.youtubeUrl,
        startOffsetSeconds: start,
        endOffsetSeconds: end,
        model,
        analysisPrompt: factory(start, end),
        responseSchemaJson: JSON.stringify(windowSchemaFor(course)),
      },
      context
    );
    const a = (short.analysis ?? {}) as Partial<LessonWindow>;
    windows.push({
      dialogue: (a.dialogue || []) as Array<Record<string, unknown>>,
      key_expressions: (a.key_expressions || []) as Array<Record<string, unknown>>,
      focus_sounds: (a.focus_sounds || []) as Array<Record<string, unknown>>,
      minimal_pairs: (a.minimal_pairs || []) as Array<Record<string, unknown>>,
      practice_scripts: (a.practice_scripts || []) as string[],
      global_vocabulary: (a.global_vocabulary || []) as Array<Record<string, unknown>>,
      lesson_notes: (a.lesson_notes || []) as string[],
      quiz: (a.quiz || []) as Array<Record<string, unknown>>,
    });
  }

  const merged = mergeLessonWindows(windows);
  const lesson: Record<string, unknown> =
    course === "phonetics"
      ? {
          lesson_content: {
            focus_sounds: merged.focus_sounds,
            minimal_pairs: merged.minimal_pairs,
            practice_scripts: merged.practice_scripts,
          },
          global_vocabulary: merged.global_vocabulary,
          lesson_notes: merged.lesson_notes,
          quiz: merged.quiz,
        }
      : {
          lesson_content: {
            dialogue: merged.dialogue,
            key_expressions: merged.key_expressions,
          },
          global_vocabulary: merged.global_vocabulary,
          lesson_notes: merged.lesson_notes,
          quiz: merged.quiz,
        };
  return {
    lesson: normalizeLesson(lesson, {
      position: params.position,
      fallbackTitle: params.fallbackTitle,
      courseId: preset.courseId,
      courseNameAr: preset.courseNameAr,
    }),
    strategyUsed: "windowed_fallback",
    windowsProcessed: windows.length,
  };
}
