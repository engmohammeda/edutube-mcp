// Authoritative lesson quality gate.
//
// Every lesson that reaches disk passes through `repairLesson` (deterministic
// structural cleanup) and then `validateLesson` (policy check driven by the
// curriculum registry). The runner uses the result to decide whether to accept
// the lesson, retry extraction with corrective feedback, or report the lesson
// as defective. This replaces the ad-hoc per-course scripts that used to live
// outside the pipeline.
import { getCourseDefinition, type CourseId } from "./curriculum.js";

export type ValidationSeverity = "error" | "warning";

export type ValidationIssue = {
  code: string;
  severity: ValidationSeverity;
  path: string;
  message: string;
};

export type LessonValidationResult = {
  valid: boolean;
  score: number;
  errors: number;
  warnings: number;
  issues: ValidationIssue[];
  counts: Record<string, number>;
};

export type LessonRepairResult = {
  lesson: Record<string, unknown>;
  repairs: string[];
};

export type ValidationReport = {
  generated_at: string;
  totals: { lessons: number; valid: number; invalid: number; errors: number; warnings: number };
  lessons: Array<{
    file: string | null;
    lesson_no: number | null;
    title: string | null;
    course_id: string | null;
    valid: boolean;
    score: number;
    issues: ValidationIssue[];
  }>;
};

const ARABIC_RANGE = /[\u0600-\u06ff\u0750-\u077f\u08a0-\u08ff]/;
const LATIN_RANGE = /[A-Za-z]/;

export function containsArabic(value: unknown): boolean {
  return typeof value === "string" && ARABIC_RANGE.test(value);
}

export function containsLatin(value: unknown): boolean {
  return typeof value === "string" && LATIN_RANGE.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asRecordArray(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function quizTypeOf(question: Record<string, unknown>): string {
  return str(question.type).toLowerCase().replace(/[\s-]+/g, "_");
}

const QUIZ_TYPE_ALIASES: Record<string, string> = {
  mc: "multiple_choice",
  multi: "multiple_choice",
  multiple: "multiple_choice",
  choice: "multiple_choice",
  tf: "true_false",
  true_or_false: "true_false",
  boolean: "true_false",
  audio: "audio_quiz",
  listening: "audio_quiz",
  listen: "audio_quiz",
  write: "written",
  writing: "written",
  open: "written",
  open_ended: "written",
  fill_blank: "written",
};

export function normalizeQuizType(value: unknown): string {
  const raw = quizTypeOf({ type: value });
  return QUIZ_TYPE_ALIASES[raw] ?? raw;
}

const TRUE_AR = "صحيح";
const FALSE_AR = "خطأ";

const TRUE_FALSE_SYNONYMS: Record<string, string> = {
  "صحيح": TRUE_AR,
  "صح": TRUE_AR,
  "صواب": TRUE_AR,
  "true": TRUE_AR,
  "yes": TRUE_AR,
  "yeah": TRUE_AR,
  "yup": TRUE_AR,
  "نعم": TRUE_AR,
  "أيوه": TRUE_AR,
  "ايوه": TRUE_AR,
  "right": TRUE_AR,
  "correct": TRUE_AR,
  "1": TRUE_AR,
  "خطأ": FALSE_AR,
  "خطا": FALSE_AR,
  "غلط": FALSE_AR,
  "false": FALSE_AR,
  "no": FALSE_AR,
  "nope": FALSE_AR,
  "لا": FALSE_AR,
  "wrong": FALSE_AR,
  "incorrect": FALSE_AR,
  "0": FALSE_AR,
};

/**
 * Maps a yes/no answer or option onto the canonical Arabic pair. Returns null
 * when the text is not a boolean (e.g. a two-option choice like بسيط/مركب) —
 * callers must then leave the question untouched instead of corrupting it.
 */
export function canonicalTrueFalse(value: string): string | null {
  const cleaned = value.trim().toLowerCase().replace(/[.!?؟،,]+$/g, "");
  if (!cleaned) return null;
  if (TRUE_FALSE_SYNONYMS[cleaned]) return TRUE_FALSE_SYNONYMS[cleaned];
  const first = cleaned.split(/[\s،,]+/)[0];
  return TRUE_FALSE_SYNONYMS[first] ?? null;
}

/* --------------------------------- repair --------------------------------- */

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function trimStringsDeep(value: unknown): void {
  if (Array.isArray(value)) {
    value.forEach(trimStringsDeep);
    return;
  }
  if (isRecord(value)) {
    for (const [key, item] of Object.entries(value)) {
      if (typeof item === "string") value[key] = item.trim();
      else trimStringsDeep(item);
    }
  }
}

function dedupeArray<T>(items: T[], keyOf: (item: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const key = keyOf(item);
    if (!key) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function hasKeys(item: Record<string, unknown>, keys: string[]): boolean {
  return keys.every((key) => str(item[key]).length > 0);
}

type CleanSpec = {
  path: string;
  keys: string[];
  keyOf: (item: Record<string, unknown>) => string;
};

const CONTENT_CLEAN_SPECS: CleanSpec[] = [
  { path: "dialogue", keys: ["en"], keyOf: (i) => `${str(i.speaker)}|${str(i.en)}`.toLowerCase() },
  { path: "transcript", keys: ["en"], keyOf: (i) => `${str(i.speaker)}|${str(i.en)}`.toLowerCase() },
  {
    path: "key_expressions",
    keys: ["expression_en"],
    keyOf: (i) => str(i.expression_en).toLowerCase(),
  },
  { path: "focus_sounds", keys: ["symbol"], keyOf: (i) => str(i.symbol).toLowerCase() },
  {
    path: "minimal_pairs",
    keys: ["word1", "word2"],
    keyOf: (i) => `${str(i.word1)}|${str(i.word2)}`.toLowerCase(),
  },
  {
    path: "brainstorming_questions",
    keys: ["question_en"],
    keyOf: (i) => str(i.question_en).toLowerCase(),
  },
  { path: "guided_sentences", keys: ["en"], keyOf: (i) => str(i.en).toLowerCase() },
  { path: "rules", keys: ["rule_en"], keyOf: (i) => str(i.rule_en).toLowerCase() },
  {
    path: "structures",
    keys: ["form"],
    keyOf: (i) => `${str(i.form)}|${str(i.pattern)}`.toLowerCase(),
  },
  {
    path: "common_mistakes",
    keys: ["wrong_en", "correct_en"],
    keyOf: (i) => str(i.wrong_en).toLowerCase(),
  },
  { path: "target_words", keys: ["word"], keyOf: (i) => str(i.word).toLowerCase() },
  { path: "collocations", keys: ["collocation_en"], keyOf: (i) => str(i.collocation_en).toLowerCase() },
  { path: "comprehension_points", keys: ["point_en"], keyOf: (i) => str(i.point_en).toLowerCase() },
  { path: "listening_tasks", keys: ["task_en"], keyOf: (i) => str(i.task_en).toLowerCase() },
];

function cleanQuiz(items: unknown, repairs: string[]): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  const seen = new Set<string>();

  for (const raw of Array.isArray(items) ? items : []) {
    if (!isRecord(raw)) continue;
    const question = cloneJson(raw) as Record<string, unknown>;
    const type = normalizeQuizType(question.type);
    if (!type || !str(question.question) || !str(question.answer)) {
      repairs.push("quiz: dropped a question missing type/question/answer");
      continue;
    }

    question.type = type;
    question.question = str(question.question);
    question.answer = str(question.answer);
    question.explanation_ar = str(question.explanation_ar);

    if (type === "audio_quiz") {
      question.word_to_speak = str(question.word_to_speak) || null;
    } else {
      if (question.word_to_speak !== null && question.word_to_speak !== undefined) {
        repairs.push(`quiz: cleared word_to_speak on ${type} question`);
      }
      question.word_to_speak = null;
    }

    if (type === "written") {
      if (question.options !== null && question.options !== undefined) {
        repairs.push("quiz: cleared options on written question");
      }
      question.options = null;
    } else {
      const options = Array.isArray(question.options)
        ? question.options.map((o) => str(o)).filter(Boolean)
        : [];
      question.options = options.length > 0 ? options : null;
    }

    if (type === "true_false") {
      const answer = question.answer as string;
      const canonicalAnswer = canonicalTrueFalse(answer);
      const options = Array.isArray(question.options) ? (question.options as string[]) : [];
      const mapped = options.map((option) => canonicalTrueFalse(option));
      const optionsAreBoolean = options.length > 0 && mapped.every((option) => option !== null);

      if (options.length === 0) {
        // Nothing to lose: a true/false question always offers the same pair.
        if (canonicalAnswer) {
          question.options = [TRUE_AR, FALSE_AR];
          if (canonicalAnswer !== answer) {
            repairs.push(`quiz: normalized true_false answer "${answer}" to ${canonicalAnswer}`);
          }
          question.answer = canonicalAnswer;
        }
      } else if (optionsAreBoolean) {
        const complete =
          mapped.length === 2 &&
          new Set(mapped).size === 2 &&
          mapped.includes(TRUE_AR) &&
          mapped.includes(FALSE_AR);
        if (!complete) {
          repairs.push("quiz: normalized true_false options to صحيح/خطأ");
          question.options = [TRUE_AR, FALSE_AR];
        } else {
          question.options = mapped as string[];
        }
        if (canonicalAnswer) {
          if (canonicalAnswer !== answer) {
            repairs.push(`quiz: normalized true_false answer "${answer}" to ${canonicalAnswer}`);
          }
          question.answer = canonicalAnswer;
        }
      }
      // Otherwise the question is not really boolean (e.g. options بسيط/مركب):
      // leave it untouched and let the validator report it for re-extraction.
    }

    const key = `${question.question}|${str(question.word_to_speak)}`.toLowerCase();
    if (seen.has(key)) {
      repairs.push("quiz: removed a duplicate question");
      continue;
    }
    seen.add(key);
    out.push(question);
  }

  return out;
}

/**
 * Deterministic, content-preserving cleanup: whitespace, empty rows,
 * duplicates, quiz-type canonicalisation and true/false option consistency.
 * It never invents missing content — that is the job of a re-extraction.
 */
export function repairLesson(
  lesson: unknown,
  options: {
    course?: CourseId | string;
    lessonNo?: number;
    fallbackTitle?: string;
    quizLength?: number;
  } = {}
): LessonRepairResult {
  const repairs: string[] = [];
  if (!isRecord(lesson)) {
    return { lesson: {}, repairs: ["lesson: replaced non-object payload with empty object"] };
  }

  const out = cloneJson(lesson) as Record<string, unknown>;
  trimStringsDeep(out);

  const course = getCourseDefinition(options.course);
  const content = isRecord(out.lesson_content) ? cloneJson(out.lesson_content) : {};

  for (const spec of CONTENT_CLEAN_SPECS) {
    const items = asRecordArray(content[spec.path]);
    if (!Array.isArray(content[spec.path]) && items.length === 0) continue;
    const kept = dedupeArray(
      items.filter((item) => hasKeys(item, spec.keys)),
      spec.keyOf
    );
    const dropped = items.length - kept.length;
    if (dropped > 0) repairs.push(`${spec.path}: dropped/deduped ${dropped} item(s)`);
    content[spec.path] = kept;
  }

  const scripts = asStringArray(content.practice_scripts).map((s) => s.trim()).filter(Boolean);
  if (Array.isArray(content.practice_scripts)) {
    const deduped = dedupeArray(scripts, (s) => s.toLowerCase());
    if (deduped.length !== scripts.length) repairs.push("practice_scripts: deduped");
    content.practice_scripts = deduped;
  }

  const finalDraft = isRecord(content.final_draft) ? content.final_draft : undefined;
  if (finalDraft) {
    if (!str(finalDraft.en) && !str(finalDraft.ar)) {
      delete content.final_draft;
      repairs.push("final_draft: removed empty draft");
    }
  }

  const vocabulary = asRecordArray(out.global_vocabulary);
  if (Array.isArray(out.global_vocabulary)) {
    const kept = dedupeArray(
      vocabulary.filter((item) => str(item.word).length > 0),
      (item) => str(item.word).toLowerCase()
    );
    const dropped = vocabulary.length - kept.length;
    if (dropped > 0) repairs.push(`global_vocabulary: dropped/deduped ${dropped} item(s)`);
    out.global_vocabulary = kept;
  }

  const notes = asStringArray(out.lesson_notes).map((n) => n.trim()).filter(Boolean);
  if (Array.isArray(out.lesson_notes)) {
    const deduped = dedupeArray(notes, (n) => n.toLowerCase());
    if (deduped.length !== notes.length) repairs.push("lesson_notes: deduped");
    out.lesson_notes = deduped;
  }

  const quizLength = options.quizLength ?? course.quizPolicy.exactLength;
  const quiz = cleanQuiz(out.quiz, repairs);
  if (quiz.length > quizLength) {
    repairs.push(`quiz: capped ${quiz.length} questions to ${quizLength}`);
  }
  out.quiz = quiz.slice(0, quizLength);
  out.lesson_content = content;

  const metadata = isRecord(out.metadata) ? cloneJson(out.metadata) : {};
  metadata.course_id = course.id;
  metadata.course_name_ar = course.nameAr;
  if (typeof metadata.level !== "number" || !Number.isFinite(metadata.level)) metadata.level = 1;
  if (options.lessonNo !== undefined) metadata.lesson_no = options.lessonNo;
  else if (typeof metadata.lesson_no !== "number") metadata.lesson_no = 1;
  if (!str(metadata.title) && options.fallbackTitle) metadata.title = options.fallbackTitle;
  out.metadata = metadata;

  return { lesson: out, repairs };
}

/* -------------------------------- validation ------------------------------- */

type Ctx = {
  issues: ValidationIssue[];
  counts: Record<string, number>;
};

function addError(ctx: Ctx, code: string, path: string, message: string): void {
  ctx.issues.push({ code, severity: "error", path, message });
}

function addWarning(ctx: Ctx, code: string, path: string, message: string): void {
  ctx.issues.push({ code, severity: "warning", path, message });
}

function requireText(
  ctx: Ctx,
  value: unknown,
  path: string,
  code: string,
  label: string
): boolean {
  if (!str(value)) {
    addError(ctx, code, path, `${label} is empty.`);
    return false;
  }
  return true;
}

function requireArabic(
  ctx: Ctx,
  value: unknown,
  path: string,
  code: string,
  label: string
): boolean {
  if (!requireText(ctx, value, path, code, label)) return false;
  if (!containsArabic(value)) {
    addError(ctx, code, path, `${label} must be written in Arabic.`);
    return false;
  }
  return true;
}

function requireLatin(ctx: Ctx, value: unknown, path: string, code: string, label: string): boolean {
  if (!requireText(ctx, value, path, code, label)) return false;
  if (!containsLatin(value)) {
    addError(ctx, code, path, `${label} must contain English text.`);
    return false;
  }
  return true;
}

function validateDialogueLike(
  ctx: Ctx,
  items: Array<Record<string, unknown>>,
  path: string,
  label: string
): void {
  items.forEach((item, index) => {
    const at = `${path}[${index}]`;
    requireText(ctx, item.speaker, `${at}.speaker`, "content.item_incomplete", `${label} speaker`);
    requireLatin(ctx, item.en, `${at}.en`, "content.item_incomplete", `${label} English line`);
    requireArabic(ctx, item.ar, `${at}.ar`, "lang.arabic_missing", `${label} Arabic translation`);
  });
}

function validatePairs(
  ctx: Ctx,
  items: Array<Record<string, unknown>>,
  path: string,
  fields: Array<{ key: string; arabic?: boolean; label: string }>
): void {
  items.forEach((item, index) => {
    for (const field of fields) {
      const at = `${path}[${index}].${field.key}`;
      if (field.arabic) requireArabic(ctx, item[field.key], at, "lang.arabic_missing", field.label);
      else requireText(ctx, item[field.key], at, "content.item_incomplete", field.label);
    }
  });
}

function validateContentForCourse(
  ctx: Ctx,
  course: ReturnType<typeof getCourseDefinition>,
  content: Record<string, unknown>
): void {
  const nonEmptyRequired = course.requiredContentKeys.some((key) => {
    const value = content[key];
    if (Array.isArray(value)) return value.length > 0;
    if (isRecord(value)) return Object.values(value).some((v) => str(v).length > 0);
    return str(value).length > 0;
  });

  if (!nonEmptyRequired) {
    addError(
      ctx,
      "content.empty",
      "lesson_content",
      `lesson_content has no usable ${course.requiredContentKeys.join(" / ")} content.`
    );
  }

  switch (course.id) {
    case "conversation": {
      const dialogue = asRecordArray(content.dialogue);
      ctx.counts.dialogue = dialogue.length;
      validateDialogueLike(ctx, dialogue, "lesson_content.dialogue", "dialogue");
      const expressions = asRecordArray(content.key_expressions);
      ctx.counts.key_expressions = expressions.length;
      validatePairs(ctx, expressions, "lesson_content.key_expressions", [
        { key: "expression_en", label: "expression_en" },
        { key: "expression_ar", arabic: true, label: "expression_ar" },
        { key: "usage_ar", arabic: true, label: "usage_ar" },
      ]);
      break;
    }
    case "listening": {
      const transcript = asRecordArray(content.transcript);
      ctx.counts.transcript = transcript.length;
      validateDialogueLike(ctx, transcript, "lesson_content.transcript", "transcript");
      const tasks = asRecordArray(content.listening_tasks);
      ctx.counts.listening_tasks = tasks.length;
      validatePairs(ctx, tasks, "lesson_content.listening_tasks", [
        { key: "task_en", label: "task_en" },
        { key: "answer_en", label: "answer_en" },
        { key: "answer_ar", arabic: true, label: "answer_ar" },
      ]);
      if (str(content.audio_topic_en)) requireLatin(ctx, content.audio_topic_en, "lesson_content.audio_topic_en", "content.item_incomplete", "audio_topic_en");
      if (str(content.audio_topic_ar)) requireArabic(ctx, content.audio_topic_ar, "lesson_content.audio_topic_ar", "lang.arabic_missing", "audio_topic_ar");
      break;
    }
    case "phonetics": {
      const sounds = asRecordArray(content.focus_sounds);
      ctx.counts.focus_sounds = sounds.length;
      validatePairs(ctx, sounds, "lesson_content.focus_sounds", [
        { key: "symbol", label: "symbol" },
        { key: "description", arabic: true, label: "description" },
      ]);
      const pairs = asRecordArray(content.minimal_pairs);
      ctx.counts.minimal_pairs = pairs.length;
      validatePairs(ctx, pairs, "lesson_content.minimal_pairs", [
        { key: "word1", label: "word1" },
        { key: "word2", label: "word2" },
      ]);
      const scripts = asStringArray(content.practice_scripts);
      ctx.counts.practice_scripts = scripts.length;
      scripts.forEach((script, index) =>
        requireText(ctx, script, `lesson_content.practice_scripts[${index}]`, "content.item_incomplete", "practice_script")
      );
      break;
    }
    case "writing": {
      const questions = asRecordArray(content.brainstorming_questions);
      ctx.counts.brainstorming_questions = questions.length;
      validatePairs(ctx, questions, "lesson_content.brainstorming_questions", [
        { key: "question_en", label: "question_en" },
        { key: "suggested_answer_en", label: "suggested_answer_en" },
      ]);
      const guided = asRecordArray(content.guided_sentences);
      ctx.counts.guided_sentences = guided.length;
      validatePairs(ctx, guided, "lesson_content.guided_sentences", [
        { key: "en", label: "en" },
        { key: "ar", arabic: true, label: "ar" },
      ]);
      const draft = isRecord(content.final_draft) ? content.final_draft : {};
      ctx.counts.final_draft_words = str(draft.en).split(/\s+/).filter(Boolean).length;
      if (Object.keys(draft).length > 0) {
        requireLatin(ctx, draft.en, "lesson_content.final_draft.en", "content.item_incomplete", "final_draft.en");
        requireArabic(ctx, draft.ar, "lesson_content.final_draft.ar", "lang.arabic_missing", "final_draft.ar");
      }
      if (str(content.topic_en)) requireLatin(ctx, content.topic_en, "lesson_content.topic_en", "content.item_incomplete", "topic_en");
      if (str(content.topic_ar)) requireArabic(ctx, content.topic_ar, "lesson_content.topic_ar", "lang.arabic_missing", "topic_ar");
      if (!str(content.topic_en) && !str(content.topic_ar)) {
        addWarning(ctx, "content.topic_missing", "lesson_content.topic_en", "Lesson topic is missing.");
      }
      break;
    }
    case "grammar": {
      const rules = asRecordArray(content.rules);
      ctx.counts.rules = rules.length;
      validatePairs(ctx, rules, "lesson_content.rules", [
        { key: "rule_en", label: "rule_en" },
        { key: "rule_ar", arabic: true, label: "rule_ar" },
        { key: "example_en", label: "example_en" },
        { key: "example_ar", arabic: true, label: "example_ar" },
      ]);
      const structures = asRecordArray(content.structures);
      ctx.counts.structures = structures.length;
      validatePairs(ctx, structures, "lesson_content.structures", [
        { key: "form", label: "form" },
        { key: "example_en", label: "example_en" },
        { key: "example_ar", arabic: true, label: "example_ar" },
      ]);
      const mistakes = asRecordArray(content.common_mistakes);
      ctx.counts.common_mistakes = mistakes.length;
      validatePairs(ctx, mistakes, "lesson_content.common_mistakes", [
        { key: "wrong_en", label: "wrong_en" },
        { key: "correct_en", label: "correct_en" },
        { key: "explanation_ar", arabic: true, label: "explanation_ar" },
      ]);
      break;
    }
    case "vocabulary": {
      const words = asRecordArray(content.target_words);
      ctx.counts.target_words = words.length;
      validatePairs(ctx, words, "lesson_content.target_words", [
        { key: "word", label: "word" },
        { key: "meaning", arabic: true, label: "meaning" },
        { key: "example_en", label: "example_en" },
        { key: "example_ar", arabic: true, label: "example_ar" },
      ]);
      const collocations = asRecordArray(content.collocations);
      ctx.counts.collocations = collocations.length;
      validatePairs(ctx, collocations, "lesson_content.collocations", [
        { key: "collocation_en", label: "collocation_en" },
        { key: "meaning", arabic: true, label: "meaning" },
      ]);
      break;
    }
    case "reading": {
      const passage = str(content.passage_en);
      ctx.counts.passage_words = passage.split(/\s+/).filter(Boolean).length;
      if (str(content.passage_en)) requireLatin(ctx, content.passage_en, "lesson_content.passage_en", "content.item_incomplete", "passage_en");
      if (str(content.passage_ar)) requireArabic(ctx, content.passage_ar, "lesson_content.passage_ar", "lang.arabic_missing", "passage_ar");
      const points = asRecordArray(content.comprehension_points);
      ctx.counts.comprehension_points = points.length;
      validatePairs(ctx, points, "lesson_content.comprehension_points", [
        { key: "point_en", label: "point_en" },
        { key: "point_ar", arabic: true, label: "point_ar" },
      ]);
      break;
    }
    default:
      break;
  }

  for (const [key, min] of Object.entries(course.minCounts)) {
    const actual = ctx.counts[key];
    if (typeof actual === "number" && actual < min) {
      addWarning(
        ctx,
        "content.below_minimum",
        `lesson_content.${key}`,
        `${key} has ${actual} item(s); the ${course.id} course expects at least ${min}.`
      );
    }
  }
}

function validateVocabulary(ctx: Ctx, value: unknown): void {
  const items = asRecordArray(value);
  ctx.counts.global_vocabulary = items.length;
  items.forEach((item, index) => {
    const at = `global_vocabulary[${index}]`;
    requireText(ctx, item.word, `${at}.word`, "vocab.orphan", "vocabulary word");
    requireText(ctx, item.meaning, `${at}.meaning`, "vocab.orphan", "vocabulary meaning");
    requireText(ctx, item.example_en, `${at}.example_en`, "vocab.orphan", "vocabulary example_en");
    requireArabic(ctx, item.example_ar, `${at}.example_ar`, "vocab.orphan", "vocabulary example_ar");
  });
  if (items.length === 0) {
    addWarning(ctx, "vocab.empty", "global_vocabulary", "No vocabulary entries were extracted.");
  }
}

function validateNotes(ctx: Ctx, value: unknown): void {
  const notes = asStringArray(value);
  ctx.counts.lesson_notes = notes.length;
  notes.forEach((note, index) => {
    if (!containsArabic(note)) {
      addError(ctx, "notes.not_arabic", `lesson_notes[${index}]`, "Lesson notes must be written in Arabic.");
    }
  });
  if (notes.length === 0) {
    addWarning(ctx, "notes.empty", "lesson_notes", "No lesson notes were extracted.");
  }
}

function validateQuiz(
  ctx: Ctx,
  value: unknown,
  course: ReturnType<typeof getCourseDefinition>
): void {
  const items = asRecordArray(value);
  ctx.counts.quiz = items.length;
  const policy = course.quizPolicy;

  if (items.length !== policy.exactLength) {
    addError(
      ctx,
      "quiz.length",
      "quiz",
      `quiz has ${items.length} question(s); exactly ${policy.exactLength} are required.`
    );
  }

  const typeCounts = new Map<string, number>();
  const seenQuestions = new Set<string>();

  items.forEach((item, index) => {
    const at = `quiz[${index}]`;
    const type = normalizeQuizType(item.type);
    if (!type) {
      addError(ctx, "quiz.type_missing", `${at}.type`, "Question type is missing.");
      return;
    }
    typeCounts.set(type, (typeCounts.get(type) ?? 0) + 1);

    if (!requireText(ctx, item.question, `${at}.question`, "quiz.question_empty", "question")) return;
    const answer = str(item.answer);
    if (!answer) {
      addError(ctx, "quiz.answer_empty", `${at}.answer`, "Answer is empty.");
      return;
    }
    requireArabic(ctx, item.explanation_ar, `${at}.explanation_ar`, "quiz.explanation_missing", "explanation_ar");

    const questionKey = `${str(item.question)}|${str(item.word_to_speak)}`.toLowerCase();
    if (seenQuestions.has(questionKey)) {
      addWarning(ctx, "quiz.duplicate_question", at, "Duplicate question text.");
    }
    seenQuestions.add(questionKey);

    const options = Array.isArray(item.options)
      ? (item.options as unknown[]).map((o) => str(o)).filter(Boolean)
      : null;

    if (type === "written") {
      if (options !== null) {
        addError(ctx, "quiz.written_options", `${at}.options`, "written questions must have options=null.");
      }
      return;
    }

    if (type === "audio_quiz" && !str(item.word_to_speak)) {
      addError(ctx, "quiz.audio_word_missing", `${at}.word_to_speak`, "audio_quiz requires word_to_speak.");
    }

    if (!options || options.length === 0) {
      addError(ctx, "quiz.options_missing", `${at}.options`, `${type} question has no options.`);
      return;
    }

    if (type === "true_false" && options.some((option) => canonicalTrueFalse(option) === null)) {
      addError(
        ctx,
        "quiz.true_false_not_boolean",
        `${at}.options`,
        `true_false question offers non-boolean options (${options.join(" / ")}); rewrite it as a multiple_choice question or use صحيح/خطأ.`
      );
    }

    const expectedLength = type === "true_false" ? 2 : 4;
    if (options.length !== expectedLength) {
      addError(
        ctx,
        "quiz.options_invalid",
        `${at}.options`,
        `${type} question must have exactly ${expectedLength} options (found ${options.length}).`
      );
    }
    if (!options.includes(answer)) {
      addError(ctx, "quiz.answer_not_in_options", `${at}.answer`, "Answer is not one of the options.");
    }
    if (new Set(options).size !== options.length) {
      addWarning(ctx, "quiz.duplicate_options", `${at}.options`, "Options contain duplicates.");
    }
  });

  ctx.counts.quiz_types = typeCounts.size;

  if (typeCounts.size < policy.minDistinctTypes) {
    addError(
      ctx,
      "quiz.type_mix",
      "quiz",
      `quiz must mix at least ${policy.minDistinctTypes} question types (found ${typeCounts.size}).`
    );
  }

  for (const rule of policy.rules) {
    const count = typeCounts.get(rule.type) ?? 0;
    if (count < rule.min) {
      addError(
        ctx,
        "quiz.type_mix",
        "quiz",
        `quiz needs at least ${rule.min} "${rule.type}" question(s) for the ${course.id} course (found ${count}).`
      );
      continue;
    }
    if (rule.max !== undefined && count > rule.max) {
      addWarning(
        ctx,
        "quiz.type_imbalance",
        "quiz",
        `quiz has ${count} "${rule.type}" question(s); the recommended maximum is ${rule.max}.`
      );
    }
  }
}

/**
 * Full policy check for one lesson. `valid` is true only when no error-severity
 * issue was found — warnings never block a lesson but are always reported.
 */
export function validateLesson(
  lesson: unknown,
  options: { course?: CourseId | string; lessonNo?: number; strict?: boolean } = {}
): LessonValidationResult {
  const ctx: Ctx = { issues: [], counts: {} };
  const course = getCourseDefinition(options.course);

  if (!isRecord(lesson)) {
    addError(ctx, "lesson.not_object", "$", "Lesson payload is not a JSON object.");
    return finalize(ctx);
  }

  const metadata = isRecord(lesson.metadata) ? lesson.metadata : {};
  const courseId = str(metadata.course_id);
  if (!courseId) addError(ctx, "metadata.missing", "metadata.course_id", "metadata.course_id is missing.");
  else if (courseId !== course.id) {
    addError(
      ctx,
      "metadata.course_mismatch",
      "metadata.course_id",
      `metadata.course_id is "${courseId}" but the run targets "${course.id}".`
    );
  }
  if (!containsArabic(metadata.course_name_ar)) {
    addError(ctx, "metadata.missing", "metadata.course_name_ar", "metadata.course_name_ar must be Arabic.");
  }
  const level = metadata.level;
  if (typeof level !== "number" || !Number.isInteger(level) || level < 1) {
    addError(ctx, "metadata.level_invalid", "metadata.level", "metadata.level must be an integer >= 1.");
  }
  const lessonNo = metadata.lesson_no;
  if (typeof lessonNo !== "number" || !Number.isInteger(lessonNo) || lessonNo < 1) {
    addError(ctx, "metadata.missing", "metadata.lesson_no", "metadata.lesson_no must be an integer >= 1.");
  } else if (options.lessonNo !== undefined && lessonNo !== options.lessonNo) {
    addError(
      ctx,
      "metadata.lesson_no_mismatch",
      "metadata.lesson_no",
      `metadata.lesson_no is ${lessonNo} but this video is lesson ${options.lessonNo}.`
    );
  }
  if (!str(metadata.title)) {
    addError(ctx, "metadata.missing", "metadata.title", "metadata.title is missing.");
  }

  const content = isRecord(lesson.lesson_content) ? lesson.lesson_content : {};
  if (!isRecord(lesson.lesson_content)) {
    addError(ctx, "content.empty", "lesson_content", "lesson_content is missing.");
  }

  validateContentForCourse(ctx, course, content);
  validateVocabulary(ctx, lesson.global_vocabulary);
  validateNotes(ctx, lesson.lesson_notes);
  validateQuiz(ctx, lesson.quiz, course);

  if (options.strict) {
    // Strict mode promotes quality warnings to errors (used by `validate --strict`).
    for (const issue of ctx.issues) {
      if (issue.severity === "warning") issue.severity = "error";
    }
  }

  return finalize(ctx);
}

function finalize(ctx: Ctx): LessonValidationResult {
  const errors = ctx.issues.filter((i) => i.severity === "error").length;
  const warnings = ctx.issues.filter((i) => i.severity === "warning").length;
  const score = Math.max(0, 100 - errors * 10 - warnings * 3);
  return { valid: errors === 0, score, errors, warnings, issues: ctx.issues, counts: ctx.counts };
}

/** Human/agent-friendly one-line summary of the most important problems. */
export function summarizeIssues(result: LessonValidationResult, limit = 6): string {
  const errors = result.issues.filter((i) => i.severity === "error");
  const picked = (errors.length > 0 ? errors : result.issues).slice(0, limit);
  if (picked.length === 0) return "no issues";
  return picked.map((i) => `${i.code} @ ${i.path}: ${i.message}`).join(" | ");
}

/**
 * Turns corrective feedback into prompt text the model can act on. Used by the
 * runner for a second extraction attempt on the same video.
 */
export function buildCorrectivePrompt(result: LessonValidationResult): string {
  const lines = result.issues
    .filter((issue) => issue.severity === "error")
    .slice(0, 12)
    .map((issue) => `- ${issue.path}: ${issue.message}`);
  if (lines.length === 0) return "";
  return [
    "",
    "THE PREVIOUS ATTEMPT WAS REJECTED BY THE QUALITY GATE. Fix every item below in this attempt:",
    ...lines,
    "Rules that must always hold: every *_ar field is real Arabic; every quiz question has explanation_ar;",
    "multiple_choice and audio_quiz questions have exactly 4 options and the answer is one of them;",
    "written questions have options=null; audio_quiz questions set word_to_speak; no orphan vocabulary.",
  ].join("\n");
}

export function createValidationReport(
  entries: Array<{
    file?: string | null;
    lessonNo?: number | null;
    title?: string | null;
    courseId?: string | null;
    result: LessonValidationResult;
  }>
): ValidationReport {
  const lessons = entries.map((entry) => ({
    file: entry.file ?? null,
    lesson_no: entry.lessonNo ?? null,
    title: entry.title ?? null,
    course_id: entry.courseId ?? null,
    valid: entry.result.valid,
    score: entry.result.score,
    issues: entry.result.issues,
  }));

  return {
    generated_at: new Date().toISOString(),
    totals: {
      lessons: lessons.length,
      valid: lessons.filter((l) => l.valid).length,
      invalid: lessons.filter((l) => !l.valid).length,
      errors: lessons.reduce((sum, l) => sum + l.issues.filter((i) => i.severity === "error").length, 0),
      warnings: lessons.reduce((sum, l) => sum + l.issues.filter((i) => i.severity === "warning").length, 0),
    },
    lessons,
  };
}
