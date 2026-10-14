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

export type CoursePreset = "conversation" | "phonetics" | "writing";

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

/* --------------------------------- writing --------------------------------- */

export const WRITING_SCHEMA: JsonObject = {
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
        topic_en: { type: "string" },
        topic_ar: { type: "string" },
        brainstorming_questions: {
          type: "array",
          items: {
            type: "object",
            properties: { question_en: { type: "string" }, suggested_answer_en: { type: "string" } },
            required: ["question_en", "suggested_answer_en"],
          },
        },
        guided_sentences: {
          type: "array",
          items: {
            type: "object",
            properties: { en: { type: "string" }, ar: { type: "string" } },
            required: ["en", "ar"],
          },
        },
        final_draft: {
          type: "object",
          properties: { en: { type: "string" }, ar: { type: "string" } },
          required: ["en", "ar"],
        },
      },
      required: ["topic_en", "topic_ar", "brainstorming_questions", "guided_sentences", "final_draft"],
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

export const WRITING_LESSON_PROMPT = `You are a Senior Educational Data Extractor and Writing Instructor Architect. The source is THE ACTUAL VIDEO provided with this request (spoken audio + on-screen text). The video is a lesson from the "Writing" (الكتابة) English course by Ibrahim Adel (ZAmericanEnglish), focused on brainstorming ideas, writing guided sentences, and combining them into a final paragraph or essay.
Fill the JSON schema completely:
- topic_en and topic_ar: the main subject the student is learning to write about.
- brainstorming_questions: the specific questions the teacher asks to generate ideas, each with the suggested English answer (question_en, suggested_answer_en).
- guided_sentences: the individual sentences constructed during the lesson before combining (en + accurate ar).
- final_draft: the fully combined paragraph/story at the end of the lesson in both en and ar.
- global_vocabulary: new words or transition words the teacher highlights (First, Then, Because…); always include example_en (preferably from the final draft) and example_ar. No orphan words.
- lesson_notes: rules about punctuation (capitalization, full stops), sentence structure (Subject-Verb-Object), or common writing mistakes, in clear Arabic.
- quiz: EXACTLY 10 questions testing sentence structure, punctuation, and vocabulary from the final draft; mix multiple_choice (4 options), true_false, and written (translate Arabic→English or reorder jumbled sentences; options=null); written questions are the most important — include several; EVERY question has explanation_ar.
- metadata: course_id "writing", course_name_ar "الكتابة", level 1, lesson_no and the main topic/title from the video.`;

/* --------------------------------- presets --------------------------------- */

export interface LessonPreset {
  schema: JsonObject;
  prompt: string;
  courseId: string;
  courseNameAr: string;
}

export function getLessonPreset(course: CoursePreset): LessonPreset {
  if (course === "writing") {
    return {
      schema: WRITING_SCHEMA,
      prompt: WRITING_LESSON_PROMPT,
      courseId: "writing",
      courseNameAr: "الكتابة",
    };
  }
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
  topic_en: string | null;
  topic_ar: string | null;
  brainstorming_questions: Array<Record<string, unknown>>;
  guided_sentences: Array<Record<string, unknown>>;
  final_draft: { en: string; ar: string } | null;
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
    topic_en: null,
    topic_ar: null,
    brainstorming_questions: [],
    guided_sentences: [],
    final_draft: null,
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
    bq: new Set<string>(),
    gs: new Set<string>(),
  };
  let topicEn: string | null = null;
  let topicAr: string | null = null;
  let finalDraft: { en: string; ar: string } | null = null;
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
    for (const b of w.brainstorming_questions || []) {
      const key = String(b.question_en || "").toLowerCase();
      if (key && !seen.bq.has(key)) {
        seen.bq.add(key);
        merged.brainstorming_questions.push(b);
      }
    }
    for (const g of w.guided_sentences || []) {
      const key = String(g.en || "").toLowerCase();
      if (key && !seen.gs.has(key)) {
        seen.gs.add(key);
        merged.guided_sentences.push(g);
      }
    }
    if (!topicEn && w.topic_en) topicEn = w.topic_en;
    if (!topicAr && w.topic_ar) topicAr = w.topic_ar;
    if (w.final_draft && (!finalDraft || w.final_draft.en.length > finalDraft.en.length)) {
      finalDraft = w.final_draft;
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
  merged.topic_en = topicEn;
  merged.topic_ar = topicAr;
  merged.final_draft = finalDraft;
  return merged;
}

/**
 * Remove a top-level `metadata` property from a response schema so windowed
 * extraction never re-asks the model for per-window metadata.
 */
export function stripMetadataFromSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const properties = schema.properties;
  if (!properties || typeof properties !== "object" || Array.isArray(properties)) return schema;
  const { metadata: _metadata, ...rest } = properties as Record<string, unknown>;
  return {
    ...schema,
    properties: rest,
    required: Array.isArray(schema.required)
      ? (schema.required as unknown[]).filter((k) => k !== "metadata")
      : schema.required,
  };
}

/**
 * Generic deep merge for custom-schema windowed extraction: arrays are
 * concatenated with JSON dedupe, objects merge recursively, and the first
 * non-null scalar wins (longest string for text).
 */
export function mergeGenericLessonWindows(windows: Array<Record<string, unknown>>): Record<string, unknown> {
  const merged: Record<string, unknown> = {};
  const seenArrays = new Map<string, Set<string>>();

  const mergeInto = (target: Record<string, unknown>, source: Record<string, unknown>): void => {
    for (const [key, value] of Object.entries(source)) {
      if (value === null || value === undefined) continue;
      const existing = target[key];
      if (Array.isArray(value)) {
        const seen = seenArrays.get(key) ?? new Set<string>();
        seenArrays.set(key, seen);
        const list = Array.isArray(existing) ? (existing as unknown[]) : [];
        for (const item of value) {
          const dedupeKey = JSON.stringify(item ?? null);
          if (!seen.has(dedupeKey)) {
            seen.add(dedupeKey);
            list.push(item);
          }
        }
        target[key] = list;
      } else if (value && typeof value === "object") {
        const obj =
          existing && typeof existing === "object" && !Array.isArray(existing)
            ? (existing as Record<string, unknown>)
            : {};
        mergeInto(obj, value as Record<string, unknown>);
        target[key] = obj;
      } else if (typeof value === "string") {
        if (typeof existing !== "string" || value.length > existing.length) target[key] = value;
      } else if (existing === null || existing === undefined) {
        target[key] = value;
      }
    }
  };

  for (const w of windows) mergeInto(merged, w);
  return merged;
}

/**
 * After a custom-schema windowed merge, backfill `metadata` fields the schema
 * declares but windows cannot know (lesson_no, title, level) so the final
 * lesson still carries a complete identity.
 */
export function fillCustomMetadata(
  lesson: Record<string, unknown>,
  options: {
    schema: Record<string, unknown>;
    position?: number;
    fallbackTitle?: string;
  }
): void {
  const schemaProps =
    options.schema.properties && typeof options.schema.properties === "object"
      ? (options.schema.properties as Record<string, unknown>)
      : {};
  const metaSchema = schemaProps.metadata;
  const metaProps =
    metaSchema && typeof metaSchema === "object"
      ? (((metaSchema as Record<string, unknown>).properties as Record<string, unknown>) ?? {})
      : {};
  if (Object.keys(metaProps).length === 0) return;

  const metadata =
    lesson.metadata && typeof lesson.metadata === "object" && !Array.isArray(lesson.metadata)
      ? (lesson.metadata as Record<string, unknown>)
      : {};
  if (metaProps.lesson_no !== undefined && (metadata.lesson_no === null || metadata.lesson_no === undefined) && options.position !== undefined) {
    metadata.lesson_no = options.position;
  }
  if (metaProps.title !== undefined && !metadata.title && options.fallbackTitle) {
    metadata.title = options.fallbackTitle;
  }
  if (metaProps.level !== undefined && (metadata.level === null || metadata.level === undefined)) {
    metadata.level = 1;
  }
  lesson.metadata = metadata;
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
  if (!Number.isInteger(metadata.level) || Number(metadata.level) < 1) metadata.level = 1;
  if (options.position !== undefined) metadata.lesson_no = options.position;
  else if (typeof metadata.lesson_no !== "number") metadata.lesson_no = options.position ?? 1;
  if (!metadata.title && options.fallbackTitle) metadata.title = options.fallbackTitle;

  const quiz = Array.isArray(lesson.quiz) ? (lesson.quiz as unknown[]).slice(0, 10) : [];
  return { ...lesson, metadata, quiz };
}

/**
 * Generic validity check for custom-schema extractions: the result must be a
 * JSON object that carries some actual content (non-empty arrays/objects or at
 * least three populated keys).
 */
export function customLessonLooksValid(lesson: unknown): boolean {
  if (!lesson || typeof lesson !== "object" || Array.isArray(lesson)) return false;
  const record = lesson as Record<string, unknown>;
  const values = Object.values(record);
  if (values.length < 3) return false;
  return values.some((v) => {
    if (Array.isArray(v)) return v.length > 0;
    if (v && typeof v === "object") return Object.values(v as Record<string, unknown>).some((x) => x != null && x !== "");
    return typeof v === "string" && v.trim().length > 0;
  });
}

export function lessonLooksValid(lesson: unknown, course: CoursePreset = "conversation"): boolean {
  if (!lesson || typeof lesson !== "object") return false;
  const l = lesson as Record<string, unknown>;
  const content = (l.lesson_content ?? {}) as Record<string, unknown>;
  const quiz = l.quiz;
  if (!Array.isArray(quiz) || quiz.length < 5) return false;
  if (course === "writing") {
    const topic = typeof content.topic_en === "string" && content.topic_en.length > 0;
    const draft = content.final_draft as { en?: string } | undefined;
    const guided = content.guided_sentences;
    return topic || (Array.isArray(guided) && guided.length > 0) || Boolean(draft?.en);
  }
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
    /** Optional custom JSON-schema override (for fully custom lesson shapes). */
    responseSchemaJson?: string;
    windowPromptFactory?: (start: number, end: number) => string;
    windowSeconds?: number;
  },
  context: AnalysisExecutionContext
): Promise<LessonExtractionResult> {
  const course: CoursePreset = params.course ?? "conversation";
  const preset = getLessonPreset(course);
  const model = params.model || "gemini-2.5-flash";
  const customSchemaJson = params.responseSchemaJson?.trim() || null;
  const responseSchemaJson = customSchemaJson ?? JSON.stringify(preset.schema);
  const isCustom = Boolean(customSchemaJson);
  const looksValid = (analysis: unknown): boolean =>
    isCustom ? customLessonLooksValid(analysis) : lessonLooksValid(analysis, course);

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
        responseSchemaJson,
      },
      context
    );
    const analysis = longResult.analysis as Record<string, unknown> | undefined;
    if (analysis && looksValid(analysis)) {
      return {
        lesson: isCustom
          ? analysis
          : normalizeLesson(analysis, {
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

  const windowSchemaJson = isCustom
    ? JSON.stringify(stripMetadataFromSchema(JSON.parse(customSchemaJson as string)))
    : JSON.stringify(windowSchemaFor(course));

  if (isCustom) {
    const windowResults: Array<Record<string, unknown>> = [];
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
          responseSchemaJson: windowSchemaJson,
        },
        context
      );
      windowResults.push((short.analysis ?? {}) as Record<string, unknown>);
    }
    const mergedCustom = mergeGenericLessonWindows(windowResults);
    fillCustomMetadata(mergedCustom, {
      schema: JSON.parse(customSchemaJson as string) as Record<string, unknown>,
      position: params.position,
      fallbackTitle: params.fallbackTitle,
    });
    return {
      lesson: mergedCustom,
      strategyUsed: "windowed_fallback",
      windowsProcessed: windowResults.length,
    };
  }

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
        responseSchemaJson: windowSchemaJson,
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
      topic_en: a.topic_en ?? null,
      topic_ar: a.topic_ar ?? null,
      brainstorming_questions: (a.brainstorming_questions || []) as Array<Record<string, unknown>>,
      guided_sentences: (a.guided_sentences || []) as Array<Record<string, unknown>>,
      final_draft: a.final_draft ?? null,
      global_vocabulary: (a.global_vocabulary || []) as Array<Record<string, unknown>>,
      lesson_notes: (a.lesson_notes || []) as string[],
      quiz: (a.quiz || []) as Array<Record<string, unknown>>,
    });
  }

  const merged = mergeLessonWindows(windows);
  const lesson: Record<string, unknown> =
    course === "writing"
      ? {
          lesson_content: {
            topic_en: merged.topic_en ?? "",
            topic_ar: merged.topic_ar ?? "",
            brainstorming_questions: merged.brainstorming_questions,
            guided_sentences: merged.guided_sentences,
            final_draft: merged.final_draft ?? { en: "", ar: "" },
          },
          global_vocabulary: merged.global_vocabulary,
          lesson_notes: merged.lesson_notes,
          quiz: merged.quiz,
        }
      : course === "phonetics"
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
