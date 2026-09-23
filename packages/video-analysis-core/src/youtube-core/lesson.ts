// Edutube feature: structured lesson extraction pipeline with course presets.
// 1) Tries the full-video long-analysis path with the preset LMS JSON schema.
// 2) Validates the result through the quality gate (lesson-validation.ts).
// 3) Falls back to 150s windowed extraction + merge/dedupe when the long path
//    fails (quota, deadlines, very long videos).
//
// Course presets cover the full curriculum: المحادثة، الصوتيات، الكتابة،
// القواعد، المفردات، القراءة، الاستماع.
import type { GoogleGenAI } from "@google/genai";

import {
  analyzeLongVideo,
  analyzeShortVideo,
  type AnalysisExecutionContext,
} from "./analysis.js";
import {
  getCourseDefinition,
  type CourseDefinition,
  type CourseId,
} from "./curriculum.js";
import { validateLesson } from "./lesson-validation.js";
import { fetchLongVideoMetadata } from "./youtube-metadata.js";
import type { AnalysisSessionStore } from "./session-store.js";
import type { JsonObject } from "../lib/types.js";

export const LESSON_WINDOW_SECONDS = 150;

/** Course presets accepted by the extraction pipeline (see curriculum registry). */
export type CoursePreset = CourseId;

/* ------------------------------ shared schema parts ----------------------- */

const METADATA_SCHEMA: JsonObject = {
  type: "object",
  properties: {
    course_id: { type: "string" },
    course_name_ar: { type: "string" },
    level: { type: "integer" },
    lesson_no: { type: "integer" },
    title: { type: "string" },
  },
  required: ["course_id", "course_name_ar", "level", "lesson_no", "title"],
};

const GLOBAL_VOCABULARY_SCHEMA: JsonObject = {
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
};

const QUIZ_SCHEMA: JsonObject = {
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
};

function buildLessonSchema(
  contentProperties: JsonObject,
  requiredContent: string[]
): JsonObject {
  return {
    type: "object",
    properties: {
      metadata: METADATA_SCHEMA,
      lesson_content: {
        type: "object",
        properties: contentProperties,
        required: requiredContent,
      },
      global_vocabulary: GLOBAL_VOCABULARY_SCHEMA,
      lesson_notes: { type: "array", items: { type: "string" } },
      quiz: QUIZ_SCHEMA,
    },
    required: ["metadata", "lesson_content", "global_vocabulary", "lesson_notes", "quiz"],
  };
}

/* ------------------------------ conversation ------------------------------ */

export const LESSON_SCHEMA: JsonObject = buildLessonSchema(
  {
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
  ["dialogue", "key_expressions"]
);

export const DEFAULT_LESSON_PROMPT = `You are a Senior Educational Data Extractor and Conversation Architect. The video is a lesson from an English conversation course (Arabic teaching commentary + English dialogues).
Fill the JSON schema completely:
- dialogue: EVERY spoken line in order (speaker name, exact English sentence, accurate Arabic translation). Must not be empty.
- key_expressions: phrases/idioms the teacher highlights; expression_en, expression_ar, usage_ar.
- global_vocabulary: highlighted words with meaning, example_en (preferably from the dialogue), example_ar. No orphan words.
- lesson_notes: cultural notes and pronunciation tricks, in clear Arabic.
- quiz: EXACTLY 10 questions mixing multiple_choice (4 options), true_false, written (options=null); every question has explanation_ar.
- metadata: course_id "conversation", course_name_ar "المحادثة", level 1, lesson_no and title from the video.`;

/* -------------------------------- phonetics -------------------------------- */

export const PHONETICS_SCHEMA: JsonObject = buildLessonSchema(
  {
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
  ["focus_sounds", "minimal_pairs", "practice_scripts"]
);

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

export const WRITING_SCHEMA: JsonObject = buildLessonSchema(
  {
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
  ["topic_en", "topic_ar", "brainstorming_questions", "guided_sentences", "final_draft"]
);

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

/* --------------------------------- grammar --------------------------------- */

export const GRAMMAR_SCHEMA: JsonObject = buildLessonSchema(
  {
    topic_en: { type: "string" },
    topic_ar: { type: "string" },
    rules: {
      type: "array",
      items: {
        type: "object",
        properties: {
          rule_en: { type: "string" },
          rule_ar: { type: "string" },
          example_en: { type: "string" },
          example_ar: { type: "string" },
        },
        required: ["rule_en", "rule_ar", "example_en", "example_ar"],
      },
    },
    structures: {
      type: "array",
      items: {
        type: "object",
        properties: {
          form: { type: "string" },
          pattern: { type: "string" },
          example_en: { type: "string" },
          example_ar: { type: "string" },
        },
        required: ["form", "pattern", "example_en", "example_ar"],
      },
    },
    common_mistakes: {
      type: "array",
      items: {
        type: "object",
        properties: {
          wrong_en: { type: "string" },
          correct_en: { type: "string" },
          explanation_ar: { type: "string" },
        },
        required: ["wrong_en", "correct_en", "explanation_ar"],
      },
    },
  },
  ["topic_en", "topic_ar", "rules", "structures", "common_mistakes"]
);

export const GRAMMAR_LESSON_PROMPT = `You are a Senior Educational Data Extractor and Grammar Curriculum Architect. The source is THE ACTUAL VIDEO provided with this request (spoken audio + on-screen text). The video is a lesson from the "Grammar" (القواعد) English course by Ibrahim Adel (ZAmericanEnglish), where a rule is explained in Arabic with many worked examples.
Fill the JSON schema completely:
- topic_en / topic_ar: the grammar topic exactly as the teacher names it (e.g. "Present Simple" / "المضارع البسيط").
- rules: every rule stated in the lesson. rule_en = the rule in clear English, rule_ar = the teacher's Arabic explanation, example_en/example_ar = a worked example the teacher actually used.
- structures: the sentence formulas taught. form = the structure name, pattern = the formula (e.g. "S + V(s/es) + O"), plus one example in both languages.
- common_mistakes: wrong_en = the mistake learners make, correct_en = the corrected sentence, explanation_ar = why it is wrong, in Arabic.
- global_vocabulary: grammar terminology and new words with meaning + example_en + example_ar. No orphan words.
- lesson_notes: exceptions, word-order traps and Arabic-speaker pitfalls, in clear Arabic.
- quiz: EXACTLY 10 questions; at least 4 multiple_choice (error correction / choose the correct form, 4 options), at least 2 written (write the correct form or translate; options=null), and 1-3 true_false about the rule; EVERY question has explanation_ar.
- metadata: course_id "grammar", course_name_ar "القواعد", level from the lesson (default 1), lesson_no and title from the video.`;

/* -------------------------------- vocabulary ------------------------------- */

export const VOCABULARY_SCHEMA: JsonObject = buildLessonSchema(
  {
    theme_en: { type: "string" },
    theme_ar: { type: "string" },
    target_words: {
      type: "array",
      items: {
        type: "object",
        properties: {
          word: { type: "string" },
          part_of_speech: { type: "string" },
          meaning: { type: "string" },
          example_en: { type: "string" },
          example_ar: { type: "string" },
          pronunciation_note_ar: { type: "string" },
        },
        required: ["word", "part_of_speech", "meaning", "example_en", "example_ar", "pronunciation_note_ar"],
      },
    },
    collocations: {
      type: "array",
      items: {
        type: "object",
        properties: {
          collocation_en: { type: "string" },
          meaning: { type: "string" },
          example_en: { type: "string" },
        },
        required: ["collocation_en", "meaning", "example_en"],
      },
    },
  },
  ["theme_en", "theme_ar", "target_words", "collocations"]
);

export const VOCABULARY_LESSON_PROMPT = `You are a Senior Educational Data Extractor and Lexis Architect. The source is THE ACTUAL VIDEO provided with this request (spoken audio + on-screen text). The video is a vocabulary lesson from the English course by Ibrahim Adel (ZAmericanEnglish): a themed word list is taught with pronunciation, meaning and usage.
Fill the JSON schema completely:
- theme_en / theme_ar: the vocabulary theme of the lesson (e.g. "At the airport" / "في المطار").
- target_words: EVERY word the teacher teaches in this lesson, in the order taught. word = the headword, part_of_speech = noun/verb/adjective…, meaning = the Arabic meaning the teacher gave, example_en = the teacher's example sentence (or a simple A1 sentence), example_ar = its Arabic translation, pronunciation_note_ar = any pronunciation hint the teacher gave (write "لا يوجد" when none was given).
- collocations: fixed expressions and word partnerships taught with the words (collocation_en, Arabic meaning, example_en).
- global_vocabulary: the most important words repeated here with meaning + example_en + example_ar (subset of target_words is fine).
- lesson_notes: memorisation tips, false friends and Arabic-speaker mistakes, in Arabic.
- quiz: EXACTLY 10 questions; 3-6 audio_quiz (question "استمع واختر الكلمة الصحيحة التي سمعتها", word_to_speak = the headword, 4 similar-looking options, answer included), 2-4 multiple_choice (meaning/usage), 1-3 written (translate or complete the sentence; options=null); EVERY question has explanation_ar.
- metadata: course_id "vocabulary", course_name_ar "المفردات", level from the lesson (default 1), lesson_no and title from the video.`;

/* --------------------------------- reading --------------------------------- */

export const READING_SCHEMA: JsonObject = buildLessonSchema(
  {
    passage_title_en: { type: "string" },
    passage_title_ar: { type: "string" },
    passage_en: { type: "string" },
    passage_ar: { type: "string" },
    comprehension_points: {
      type: "array",
      items: {
        type: "object",
        properties: { point_en: { type: "string" }, point_ar: { type: "string" } },
        required: ["point_en", "point_ar"],
      },
    },
  },
  ["passage_title_en", "passage_title_ar", "passage_en", "passage_ar", "comprehension_points"]
);

export const READING_LESSON_PROMPT = `You are a Senior Educational Data Extractor and Reading Comprehension Architect. The source is THE ACTUAL VIDEO provided with this request (spoken audio + on-screen text). The video is a reading lesson from the English course by Ibrahim Adel (ZAmericanEnglish): a short text is read aloud, translated and discussed.
Fill the JSON schema completely:
- passage_title_en / passage_title_ar: the title of the text.
- passage_en: the FULL text as it appears on screen / as read by the teacher, preserving sentence order and punctuation. Do not summarise.
- passage_ar: an accurate, natural Arabic translation of the whole passage.
- comprehension_points: the main ideas and details the teacher highlights (point_en + point_ar).
- global_vocabulary: new words from the passage with meaning + example_en (from the passage) + example_ar. No orphan words.
- lesson_notes: reading strategies (skimming/scanning/guessing from context) and pronunciation notes, in Arabic.
- quiz: EXACTLY 10 questions about the passage; at least 4 multiple_choice (4 options), 2-3 true_false, 1-3 written (answer in one short sentence; options=null); EVERY question has explanation_ar quoting the relevant part of the passage.
- metadata: course_id "reading", course_name_ar "القراءة", level from the lesson (default 1), lesson_no and title from the video.`;

/* -------------------------------- listening -------------------------------- */

export const LISTENING_SCHEMA: JsonObject = buildLessonSchema(
  {
    audio_topic_en: { type: "string" },
    audio_topic_ar: { type: "string" },
    transcript: {
      type: "array",
      items: {
        type: "object",
        properties: { speaker: { type: "string" }, en: { type: "string" }, ar: { type: "string" } },
        required: ["speaker", "en", "ar"],
      },
    },
    listening_tasks: {
      type: "array",
      items: {
        type: "object",
        properties: {
          task_en: { type: "string" },
          answer_en: { type: "string" },
          answer_ar: { type: "string" },
        },
        required: ["task_en", "answer_en", "answer_ar"],
      },
    },
  },
  ["audio_topic_en", "audio_topic_ar", "transcript", "listening_tasks"]
);

export const LISTENING_LESSON_PROMPT = `You are a Senior Educational Data Extractor and Listening Skills Architect. The source is THE ACTUAL VIDEO provided with this request (spoken audio + on-screen text). The video is a listening lesson from the English course by Ibrahim Adel (ZAmericanEnglish): an audio clip is played (often more than once, slow then fast) and then explained.
Fill the JSON schema completely:
- audio_topic_en / audio_topic_ar: what the audio clip is about.
- transcript: EVERY spoken line of the audio clip in order (speaker, exact English, accurate Arabic). Include the slow and the fast repetition only once.
- listening_tasks: every question/task the teacher asks about the clip, with the expected answer in English and Arabic.
- global_vocabulary: words from the clip the teacher explains, with meaning + example_en + example_ar. No orphan words.
- lesson_notes: connected-speech phenomena the teacher points out (linking, weak forms, reductions) and listening strategies, in Arabic.
- quiz: EXACTLY 10 questions; 3-6 audio_quiz (question "استمع واختر الكلمة الصحيحة التي سمعتها", word_to_speak = a word from the clip, 4 options, answer included), 2-4 multiple_choice about the clip, 1-3 true_false; EVERY question has explanation_ar.
- metadata: course_id "listening", course_name_ar "الاستماع", level from the lesson (default 1), lesson_no and title from the video.`;

/* --------------------------------- presets --------------------------------- */

export interface LessonPreset {
  schema: JsonObject;
  prompt: string;
  courseId: string;
  courseNameAr: string;
  definition: CourseDefinition;
}

export function getLessonPreset(course: CoursePreset): LessonPreset {
  const definition = getCourseDefinition(course);
  switch (definition.id) {
    case "writing":
      return {
        schema: WRITING_SCHEMA,
        prompt: WRITING_LESSON_PROMPT,
        courseId: "writing",
        courseNameAr: definition.nameAr,
        definition,
      };
    case "phonetics":
      return {
        schema: PHONETICS_SCHEMA,
        prompt: PHONETICS_LESSON_PROMPT,
        courseId: "phonetics",
        courseNameAr: definition.nameAr,
        definition,
      };
    case "grammar":
      return {
        schema: GRAMMAR_SCHEMA,
        prompt: GRAMMAR_LESSON_PROMPT,
        courseId: "grammar",
        courseNameAr: definition.nameAr,
        definition,
      };
    case "vocabulary":
      return {
        schema: VOCABULARY_SCHEMA,
        prompt: VOCABULARY_LESSON_PROMPT,
        courseId: "vocabulary",
        courseNameAr: definition.nameAr,
        definition,
      };
    case "reading":
      return {
        schema: READING_SCHEMA,
        prompt: READING_LESSON_PROMPT,
        courseId: "reading",
        courseNameAr: definition.nameAr,
        definition,
      };
    case "listening":
      return {
        schema: LISTENING_SCHEMA,
        prompt: LISTENING_LESSON_PROMPT,
        courseId: "listening",
        courseNameAr: definition.nameAr,
        definition,
      };
    default:
      return {
        schema: LESSON_SCHEMA,
        prompt: DEFAULT_LESSON_PROMPT,
        courseId: "conversation",
        courseNameAr: definition.nameAr,
        definition,
      };
  }
}

/** Removes `metadata` from a course schema so windows only return content. */
export function windowSchemaFor(course: CoursePreset): JsonObject {
  const base = getLessonPreset(course).schema as { properties: Record<string, unknown> };
  return {
    ...base,
    properties: Object.fromEntries(Object.entries(base.properties).filter(([k]) => k !== "metadata")),
    required: ["lesson_content", "global_vocabulary", "lesson_notes", "quiz"],
  } as JsonObject;
}

/** @deprecated kept for backwards compatibility; use {@link windowSchemaFor}. */
export const LESSON_WINDOW_SCHEMA: JsonObject = windowSchemaFor("conversation");

/* ------------------------------- window merge ------------------------------ */

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
  rules: Array<Record<string, unknown>>;
  structures: Array<Record<string, unknown>>;
  common_mistakes: Array<Record<string, unknown>>;
  theme_en: string | null;
  theme_ar: string | null;
  target_words: Array<Record<string, unknown>>;
  collocations: Array<Record<string, unknown>>;
  passage_title_en: string | null;
  passage_title_ar: string | null;
  passage_en: string | null;
  passage_ar: string | null;
  comprehension_points: Array<Record<string, unknown>>;
  audio_topic_en: string | null;
  audio_topic_ar: string | null;
  transcript: Array<Record<string, unknown>>;
  listening_tasks: Array<Record<string, unknown>>;
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
    rules: [],
    structures: [],
    common_mistakes: [],
    theme_en: null,
    theme_ar: null,
    target_words: [],
    collocations: [],
    passage_title_en: null,
    passage_title_ar: null,
    passage_en: null,
    passage_ar: null,
    comprehension_points: [],
    audio_topic_en: null,
    audio_topic_ar: null,
    transcript: [],
    listening_tasks: [],
    global_vocabulary: [],
    lesson_notes: [],
    quiz: [],
  };
}

const ARRAY_MERGE_SPECS: Array<{
  key: keyof LessonWindow;
  keyOf: (item: Record<string, unknown>) => string;
}> = [
  { key: "dialogue", keyOf: (i) => `${String(i.speaker ?? "")}|${String(i.en ?? "")}`.toLowerCase() },
  { key: "transcript", keyOf: (i) => `${String(i.speaker ?? "")}|${String(i.en ?? "")}`.toLowerCase() },
  { key: "key_expressions", keyOf: (i) => String(i.expression_en ?? "").toLowerCase() },
  { key: "focus_sounds", keyOf: (i) => String(i.symbol ?? "").toLowerCase() },
  { key: "minimal_pairs", keyOf: (i) => `${String(i.word1 ?? "")}|${String(i.word2 ?? "")}`.toLowerCase() },
  { key: "brainstorming_questions", keyOf: (i) => String(i.question_en ?? "").toLowerCase() },
  { key: "guided_sentences", keyOf: (i) => String(i.en ?? "").toLowerCase() },
  { key: "rules", keyOf: (i) => String(i.rule_en ?? "").toLowerCase() },
  { key: "structures", keyOf: (i) => `${String(i.form ?? "")}|${String(i.pattern ?? "")}`.toLowerCase() },
  { key: "common_mistakes", keyOf: (i) => String(i.wrong_en ?? "").toLowerCase() },
  { key: "target_words", keyOf: (i) => String(i.word ?? "").toLowerCase() },
  { key: "collocations", keyOf: (i) => String(i.collocation_en ?? "").toLowerCase() },
  { key: "comprehension_points", keyOf: (i) => String(i.point_en ?? "").toLowerCase() },
  { key: "listening_tasks", keyOf: (i) => String(i.task_en ?? "").toLowerCase() },
];

const TEXT_MERGE_SPECS: Array<{ key: keyof LessonWindow; longestWins?: boolean }> = [
  { key: "topic_en" },
  { key: "topic_ar" },
  { key: "theme_en" },
  { key: "theme_ar" },
  { key: "passage_title_en" },
  { key: "passage_title_ar" },
  { key: "passage_en", longestWins: true },
  { key: "passage_ar", longestWins: true },
  { key: "audio_topic_en" },
  { key: "audio_topic_ar" },
];

function recordArray(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is Record<string, unknown> =>
      Boolean(item) && typeof item === "object" && !Array.isArray(item)
  );
}

/**
 * Merges per-window extractions into one lesson: dedupes every content array by
 * a stable key, keeps the longest passage/draft, and concatenates notes/quiz
 * (the runner re-caps the quiz and re-validates afterwards).
 */
export function mergeLessonWindows(windows: LessonWindow[]): LessonWindow {
  const merged = emptyLessonWindow();
  const seen: Record<string, Set<string>> = {};
  const seenKey = (name: string): Set<string> => (seen[name] ??= new Set<string>());

  for (const window of windows) {
    for (const spec of ARRAY_MERGE_SPECS) {
      const target = merged[spec.key] as Array<Record<string, unknown>>;
      const bucket = seenKey(spec.key as string);
      for (const item of recordArray(window[spec.key])) {
        const key = spec.keyOf(item);
        if (!key) continue;
        if (bucket.has(key)) continue;
        bucket.add(key);
        target.push(item);
      }
    }

    for (const spec of TEXT_MERGE_SPECS) {
      const value = window[spec.key];
      if (typeof value !== "string" || value.trim().length === 0) continue;
      const current = merged[spec.key];
      if (typeof current !== "string" || current.length === 0) {
        (merged[spec.key] as string | null) = value;
        continue;
      }
      if (spec.longestWins && value.length > current.length) {
        (merged[spec.key] as string | null) = value;
      }
    }

    for (const script of Array.isArray(window.practice_scripts) ? window.practice_scripts : []) {
      if (typeof script === "string" && script.trim() && !seenKey("practice_scripts").has(script)) {
        seenKey("practice_scripts").add(script);
        merged.practice_scripts.push(script);
      }
    }

    const draft = window.final_draft;
    if (
      draft &&
      typeof draft.en === "string" &&
      (!merged.final_draft || draft.en.length > merged.final_draft.en.length)
    ) {
      merged.final_draft = draft;
    }

    const wordBucket = seenKey("global_vocabulary");
    for (const item of recordArray(window.global_vocabulary)) {
      const key = String(item.word ?? "").toLowerCase();
      if (!key || wordBucket.has(key)) continue;
      wordBucket.add(key);
      merged.global_vocabulary.push(item);
    }

    const noteBucket = seenKey("lesson_notes");
    for (const note of Array.isArray(window.lesson_notes) ? window.lesson_notes : []) {
      if (typeof note !== "string" || !note.trim() || noteBucket.has(note)) continue;
      noteBucket.add(note);
      merged.lesson_notes.push(note);
    }

    const quizBucket = seenKey("quiz");
    for (const item of recordArray(window.quiz)) {
      const key =
        String(item.question ?? "").slice(0, 80).toLowerCase() + "|" + String(item.word_to_speak ?? "");
      if (!key || quizBucket.has(key)) continue;
      quizBucket.add(key);
      merged.quiz.push(item);
    }
  }

  return merged;
}

/** Builds `lesson_content` for a course from merged window data. */
export function buildLessonContent(course: CoursePreset, merged: LessonWindow): Record<string, unknown> {
  const definition = getCourseDefinition(course);
  const content: Record<string, unknown> = {};
  for (const key of definition.contentKeys) {
    const value = (merged as unknown as Record<string, unknown>)[key];
    if (value === undefined) continue;
    if (Array.isArray(value) && value.length === 0 && !definition.requiredContentKeys.includes(key)) {
      continue;
    }
    content[key] = value;
  }
  return content;
}

export function normalizeLesson(
  lesson: Record<string, unknown>,
  options: {
    position?: number;
    fallbackTitle?: string;
    courseId?: string;
    courseNameAr?: string;
    level?: number;
  }
): Record<string, unknown> {
  const definition = getCourseDefinition(options.courseId);
  const metadata =
    lesson.metadata && typeof lesson.metadata === "object"
      ? ({ ...(lesson.metadata as Record<string, unknown>) } as Record<string, unknown>)
      : {};
  metadata.course_id = options.courseId ?? definition.id;
  metadata.course_name_ar = options.courseNameAr ?? definition.nameAr;
  metadata.level = options.level ?? 1;
  if (options.position !== undefined) metadata.lesson_no = options.position;
  else if (typeof metadata.lesson_no !== "number") metadata.lesson_no = options.position ?? 1;
  if (!metadata.title && options.fallbackTitle) metadata.title = options.fallbackTitle;

  const quizLength = definition.quizPolicy.exactLength;
  const quiz = Array.isArray(lesson.quiz) ? (lesson.quiz as unknown[]).slice(0, quizLength) : [];
  return { ...lesson, metadata, quiz };
}

/**
 * Cheap structural sanity check used by the resume logic. The authoritative
 * gate is {@link validateLesson}; this keeps backwards-compatible behaviour for
 * callers that only need "is there any usable content?".
 */
export function lessonLooksValid(lesson: unknown, course: CoursePreset = "conversation"): boolean {
  if (!lesson || typeof lesson !== "object") return false;
  const result = validateLesson(lesson, { course });
  if (result.valid) return true;
  // Accept lessons that are content-complete but have quiz-policy deviations.
  const blocking = result.issues.filter(
    (issue) => issue.severity === "error" && !issue.code.startsWith("quiz.")
  );
  return blocking.length === 0;
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
    level?: number;
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
          level: params.level,
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
  const windowInstruction = (start: number, end: number) =>
    `\n\nIMPORTANT: analyze ONLY the clip window ${start}s-${end}s of the video; content and quiz must cover this window only (max 3 quiz questions${course === "phonetics" || course === "listening" || course === "vocabulary" ? ", audio_quiz preferred" : ""}).`;
  const factory =
    params.windowPromptFactory ??
    ((start: number, end: number) =>
      params.analysisPrompt
        ? `${params.analysisPrompt}${windowInstruction(start, end)}`
        : `${preset.prompt}${windowInstruction(start, end)}`);

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
    const source = (short.analysis ?? {}) as Record<string, unknown>;
    const content = (source.lesson_content ?? source) as Record<string, unknown>;
    const window = emptyLessonWindow();
    for (const [key, value] of Object.entries(window)) {
      const incoming = content[key] ?? source[key];
      if (incoming === undefined || incoming === null) continue;
      if (Array.isArray(value)) {
        if (Array.isArray(incoming)) {
          (window as unknown as Record<string, unknown>)[key] = incoming;
        }
        continue;
      }
      (window as unknown as Record<string, unknown>)[key] = incoming;
    }
    windows.push(window);
  }

  const merged = mergeLessonWindows(windows);
  const lesson: Record<string, unknown> = {
    lesson_content: buildLessonContent(course, merged),
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
      level: params.level,
    }),
    strategyUsed: "windowed_fallback",
    windowsProcessed: windows.length,
  };
}
