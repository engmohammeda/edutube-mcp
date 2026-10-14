// Edutube feature: strict lesson JSON validation for QA and CI.
// `lessonLooksValid` (lesson.ts) answers "can this file resume a batch?".
// `validateLesson` here answers "does this lesson fully comply with the course
// preset contract?" — the same rules the extraction prompts demand (metadata,
// Arabic translations, vocabulary completeness, quiz shape and mix).
import type { CoursePreset } from "./lesson.js";

export type LessonValidationOptions = {
  course?: CoursePreset;
  /** When set, metadata.lesson_no must equal this number (usually the file position). */
  expectLessonNo?: number;
};

const ARABIC_RE = /[\u0600-\u06FF]/;

export function hasArabic(value: unknown): boolean {
  return typeof value === "string" && ARABIC_RE.test(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function expectObject(value: unknown, label: string, problems: string[]): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    problems.push(`${label} must be an object.`);
    return null;
  }
  return value as Record<string, unknown>;
}

function expectArray(value: unknown, label: string, problems: string[]): unknown[] | null {
  if (!Array.isArray(value)) {
    problems.push(`${label} must be an array.`);
    return null;
  }
  return value;
}

function validateVocabulary(lesson: Record<string, unknown>, problems: string[]): void {
  const vocab = expectArray(lesson.global_vocabulary, "global_vocabulary", problems);
  if (!vocab) return;
  for (const [i, item] of vocab.entries()) {
    const v = expectObject(item, `global_vocabulary[${i}]`, problems);
    if (!v) continue;
    for (const field of ["word", "meaning", "example_en", "example_ar"] as const) {
      if (!isNonEmptyString(v[field])) {
        problems.push(`global_vocabulary[${i}].${field} must be a non-empty string (orphan vocabulary is not allowed).`);
      }
    }
  }
}

function validateNotes(lesson: Record<string, unknown>, problems: string[]): void {
  const notes = expectArray(lesson.lesson_notes, "lesson_notes", problems);
  if (!notes) return;
  for (const [i, note] of notes.entries()) {
    if (!isNonEmptyString(note)) {
      problems.push(`lesson_notes[${i}] must be a non-empty string.`);
    } else if (!hasArabic(note)) {
      problems.push(`lesson_notes[${i}] must be written in Arabic.`);
    }
  }
}

const QUIZ_TYPES = new Set(["multiple_choice", "true_false", "written", "audio_quiz"]);

type QuizTypeCounts = { multiple_choice: number; true_false: number; written: number; audio_quiz: number };

function validateQuizItems(quiz: unknown[], problems: string[]): QuizTypeCounts {
  const counts: QuizTypeCounts = { multiple_choice: 0, true_false: 0, written: 0, audio_quiz: 0 };
  for (const [i, item] of quiz.entries()) {
    const q = expectObject(item, `quiz[${i}]`, problems);
    if (!q) continue;
    const type = q.type;
    if (!isNonEmptyString(type) || !QUIZ_TYPES.has(type)) {
      problems.push(`quiz[${i}].type must be one of ${[...QUIZ_TYPES].join(", ")}.`);
      continue;
    }
    counts[type as keyof QuizTypeCounts] += 1;
    if (!isNonEmptyString(q.question)) problems.push(`quiz[${i}].question must be a non-empty string.`);
    if (!isNonEmptyString(q.answer)) problems.push(`quiz[${i}].answer must be a non-empty string.`);
    if (!isNonEmptyString(q.explanation_ar)) {
      problems.push(`quiz[${i}].explanation_ar must be a non-empty Arabic explanation.`);
    } else if (!hasArabic(q.explanation_ar)) {
      problems.push(`quiz[${i}].explanation_ar must be written in Arabic.`);
    }

    const options = q.options;
    if (type === "multiple_choice" || type === "audio_quiz") {
      if (!Array.isArray(options) || options.length !== 4) {
        problems.push(`quiz[${i}] (${type}) must have exactly 4 options.`);
      } else if (!options.some((o) => o === q.answer)) {
        problems.push(`quiz[${i}] answer must be one of the options.`);
      }
      if (type === "audio_quiz" && !isNonEmptyString(q.word_to_speak)) {
        problems.push(`quiz[${i}] (audio_quiz) must set word_to_speak to the word the app will synthesize.`);
      }
    } else if (type === "written") {
      if (options !== null && options !== undefined) {
        problems.push(`quiz[${i}] (written) must have options=null.`);
      }
    } else if (type === "true_false") {
      // Binary choice: options is either null (answer is the text itself) or a
      // 2-string pair such as ["صحيح","خطأ"] / ["نعم","لا"] containing the answer.
      if (options !== null && options !== undefined) {
        if (!Array.isArray(options) || options.length !== 2) {
          problems.push(`quiz[${i}] (true_false) must have options=null or exactly 2 options.`);
        } else if (!options.some((o) => o === q.answer)) {
          problems.push(`quiz[${i}] answer must be one of the options.`);
        }
      }
    }
  }
  return counts;
}

function validateMetadata(lesson: Record<string, unknown>, course: CoursePreset, options: LessonValidationOptions, problems: string[]): void {
  const expected = {
    conversation: { course_id: "conversation", course_name_ar: "المحادثة" },
    phonetics: { course_id: "phonetics", course_name_ar: "الصوتيات" },
    writing: { course_id: "writing", course_name_ar: "الكتابة" },
  }[course];
  const metadata = expectObject(lesson.metadata, "metadata", problems);
  if (!metadata) return;
  if (metadata.course_id !== expected.course_id) {
    problems.push(`metadata.course_id must be "${expected.course_id}".`);
  }
  if (metadata.course_name_ar !== expected.course_name_ar) {
    problems.push(`metadata.course_name_ar must be "${expected.course_name_ar}".`);
  }
  if (!Number.isInteger(metadata.level) || Number(metadata.level) < 1) {
    problems.push("metadata.level must be a positive integer.");
  }
  if (!Number.isInteger(metadata.lesson_no) || Number(metadata.lesson_no) < 1) {
    problems.push("metadata.lesson_no must be a positive integer.");
  } else if (options.expectLessonNo !== undefined && metadata.lesson_no !== options.expectLessonNo) {
    problems.push(`metadata.lesson_no must be ${options.expectLessonNo} (got ${metadata.lesson_no}).`);
  }
  if (!isNonEmptyString(metadata.title)) {
    problems.push("metadata.title must be a non-empty string.");
  }
}

function validateConversationContent(content: Record<string, unknown>, problems: string[]): void {
  const dialogue = expectArray(content.dialogue, "lesson_content.dialogue", problems);
  if (dialogue) {
    if (dialogue.length === 0) problems.push("lesson_content.dialogue must not be empty.");
    for (const [i, item] of dialogue.entries()) {
      const d = expectObject(item, `dialogue[${i}]`, problems);
      if (!d) continue;
      if (!isNonEmptyString(d.speaker)) problems.push(`dialogue[${i}].speaker must be a non-empty string.`);
      if (!isNonEmptyString(d.en)) problems.push(`dialogue[${i}].en must be a non-empty English line.`);
      if (!hasArabic(d.ar)) problems.push(`dialogue[${i}].ar must be an accurate Arabic translation.`);
    }
  }
  const expressions = expectArray(content.key_expressions, "lesson_content.key_expressions", problems);
  if (expressions) {
    for (const [i, item] of expressions.entries()) {
      const e = expectObject(item, `key_expressions[${i}]`, problems);
      if (!e) continue;
      if (!isNonEmptyString(e.expression_en)) problems.push(`key_expressions[${i}].expression_en must be a non-empty string.`);
      if (!hasArabic(e.expression_ar)) problems.push(`key_expressions[${i}].expression_ar must be in Arabic.`);
      if (!hasArabic(e.usage_ar)) problems.push(`key_expressions[${i}].usage_ar must be in Arabic.`);
    }
  }
}

function validatePhoneticsContent(content: Record<string, unknown>, problems: string[]): void {
  const sounds = expectArray(content.focus_sounds, "lesson_content.focus_sounds", problems) ?? [];
  const pairs = expectArray(content.minimal_pairs, "lesson_content.minimal_pairs", problems) ?? [];
  const scripts = expectArray(content.practice_scripts, "lesson_content.practice_scripts", problems) ?? [];
  if (sounds.length === 0 && pairs.length === 0 && scripts.length === 0) {
    problems.push("lesson_content must contain focus_sounds, minimal_pairs or practice_scripts.");
  }
  for (const [i, item] of sounds.entries()) {
    const s = expectObject(item, `focus_sounds[${i}]`, problems);
    if (!s) continue;
    if (!isNonEmptyString(s.symbol)) problems.push(`focus_sounds[${i}].symbol must be a non-empty string.`);
    if (!hasArabic(s.description)) problems.push(`focus_sounds[${i}].description must be a clear Arabic explanation.`);
  }
  for (const [i, item] of pairs.entries()) {
    const p = expectObject(item, `minimal_pairs[${i}]`, problems);
    if (!p) continue;
    if (!isNonEmptyString(p.word1) || !isNonEmptyString(p.word2)) {
      problems.push(`minimal_pairs[${i}] must set word1 and word2.`);
    }
  }
  for (const [i, script] of scripts.entries()) {
    if (!isNonEmptyString(script)) problems.push(`practice_scripts[${i}] must be a non-empty string.`);
  }
}

function validateWritingContent(content: Record<string, unknown>, problems: string[]): void {
  if (!isNonEmptyString(content.topic_en)) problems.push("lesson_content.topic_en must be a non-empty string.");
  if (!hasArabic(content.topic_ar)) problems.push("lesson_content.topic_ar must be in Arabic.");

  const bq = expectArray(content.brainstorming_questions, "lesson_content.brainstorming_questions", problems);
  if (bq) {
    if (bq.length === 0) problems.push("lesson_content.brainstorming_questions must not be empty.");
    for (const [i, item] of bq.entries()) {
      const b = expectObject(item, `brainstorming_questions[${i}]`, problems);
      if (!b) continue;
      if (!isNonEmptyString(b.question_en) || !isNonEmptyString(b.suggested_answer_en)) {
        problems.push(`brainstorming_questions[${i}] must set question_en and suggested_answer_en.`);
      }
    }
  }

  const gs = expectArray(content.guided_sentences, "lesson_content.guided_sentences", problems);
  if (gs) {
    if (gs.length === 0) problems.push("lesson_content.guided_sentences must not be empty.");
    for (const [i, item] of gs.entries()) {
      const g = expectObject(item, `guided_sentences[${i}]`, problems);
      if (!g) continue;
      if (!isNonEmptyString(g.en)) problems.push(`guided_sentences[${i}].en must be a non-empty sentence.`);
      if (!hasArabic(g.ar)) problems.push(`guided_sentences[${i}].ar must be an Arabic translation.`);
    }
  }

  const draft = expectObject(content.final_draft, "lesson_content.final_draft", problems);
  if (draft) {
    if (!isNonEmptyString(draft.en)) problems.push("lesson_content.final_draft.en must be a non-empty text.");
    if (!hasArabic(draft.ar)) problems.push("lesson_content.final_draft.ar must be an Arabic translation.");
  }
}

function validateQuizMix(course: CoursePreset, counts: QuizTypeCounts, problems: string[]): void {
  if (course === "phonetics") {
    if (counts.audio_quiz < 5) {
      problems.push(`phonetics quiz must contain at least 5 audio_quiz questions (got ${counts.audio_quiz}).`);
    }
    if (counts.true_false < 2 || counts.true_false > 4) {
      problems.push(`phonetics quiz must contain 2-4 true_false questions (got ${counts.true_false}).`);
    }
    return;
  }
  if (course === "writing") {
    if (counts.written < 1) problems.push("writing quiz must contain at least one written question.");
    if (counts.multiple_choice < 1) problems.push("writing quiz must contain at least one multiple_choice question.");
    if (counts.true_false < 1) problems.push("writing quiz must contain at least one true_false question.");
    return;
  }
  // conversation
  if (counts.multiple_choice < 1) problems.push("conversation quiz must contain at least one multiple_choice question.");
  if (counts.true_false < 1) problems.push("conversation quiz must contain at least one true_false question.");
  if (counts.written < 1) problems.push("conversation quiz must contain at least one written question.");
}

/**
 * Strict preset-compliance validation. Returns the list of problems; an empty
 * list means the lesson fully complies with the course contract.
 */
export function validateLesson(lesson: unknown, options: LessonValidationOptions = {}): string[] {
  const problems: string[] = [];
  const course = options.course ?? "conversation";
  const l = expectObject(lesson, "lesson", problems);
  if (!l) return problems;

  validateMetadata(l, course, options, problems);

  const content = expectObject(l.lesson_content, "lesson_content", problems);
  if (content) {
    if (course === "phonetics") validatePhoneticsContent(content, problems);
    else if (course === "writing") validateWritingContent(content, problems);
    else validateConversationContent(content, problems);
  }

  validateVocabulary(l, problems);
  validateNotes(l, problems);

  const quiz = expectArray(l.quiz, "quiz", problems);
  if (quiz) {
    if (quiz.length !== 10) problems.push(`quiz must contain exactly 10 questions (got ${quiz.length}).`);
    const counts = validateQuizItems(quiz, problems);
    validateQuizMix(course, counts, problems);
  }

  return problems;
}

export type LessonValidationReport = {
  file: string;
  ok: boolean;
  problems: string[];
};

/** Convenience: validate a list of { file, lesson } pairs and return per-file reports. */
export function validateLessons(
  items: Array<{ file: string; lesson: unknown }>,
  options: LessonValidationOptions | ((file: string, index: number) => LessonValidationOptions) = {}
): LessonValidationReport[] {
  return items.map((item, index) => {
    const opts = typeof options === "function" ? options(item.file, index) : options;
    const problems = validateLesson(item.lesson, opts);
    return { file: item.file, ok: problems.length === 0, problems };
  });
}
