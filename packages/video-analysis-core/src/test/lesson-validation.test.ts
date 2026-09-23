import assert from "node:assert/strict";

import {
  buildCorrectivePrompt,
  containsArabic,
  createValidationReport,
  normalizeQuizType,
  repairLesson,
  summarizeIssues,
  validateLesson,
} from "../youtube-core/lesson-validation.js";
import { getCourseDefinition } from "../youtube-core/curriculum.js";

export type QuizQuestion = Record<string, unknown>;

export function makeQuiz(options: {
  multipleChoice?: number;
  trueFalse?: number;
  written?: number;
  audio?: number;
}): QuizQuestion[] {
  const questions: QuizQuestion[] = [];
  const mc = options.multipleChoice ?? 0;
  const tf = options.trueFalse ?? 0;
  const written = options.written ?? 0;
  const audio = options.audio ?? 0;

  for (let i = 0; i < mc; i += 1) {
    questions.push({
      type: "multiple_choice",
      question: `سؤال اختيار ${i + 1}`,
      word_to_speak: null,
      options: ["أ", "ب", "ج", "د"],
      answer: "أ",
      explanation_ar: "الشرح بالعربية.",
    });
  }
  for (let i = 0; i < tf; i += 1) {
    questions.push({
      type: "true_false",
      question: `سؤال صح وخطأ ${i + 1}`,
      word_to_speak: null,
      options: ["صحيح", "خطأ"],
      answer: "صحيح",
      explanation_ar: "الشرح بالعربية.",
    });
  }
  for (let i = 0; i < written; i += 1) {
    questions.push({
      type: "written",
      question: `سؤال كتابي ${i + 1}`,
      word_to_speak: null,
      options: null,
      answer: "Boarding pass",
      explanation_ar: "الشرح بالعربية.",
    });
  }
  for (let i = 0; i < audio; i += 1) {
    questions.push({
      type: "audio_quiz",
      question: "استمع واختر الكلمة الصحيحة التي سمعتها",
      word_to_speak: ["pack", "back", "pick", "peek"][i % 4],
      options: ["Pack", "Back", "Pick", "Peek"],
      answer: "Pack",
      explanation_ar: "الشرح بالعربية.",
    });
  }
  return questions;
}

export function makeValidConversationLesson(lessonNo: number): Record<string, unknown> {
  return {
    metadata: {
      course_id: "conversation",
      course_name_ar: "المحادثة",
      level: 1,
      lesson_no: lessonNo,
      title: "في المطار",
    },
    lesson_content: {
      dialogue: [
        { speaker: "Staff", en: "Good evening.", ar: "مساء الخير." },
        { speaker: "Staff", en: "Boarding pass, please.", ar: "بطاقة الصعود، من فضلك." },
        { speaker: "Woman", en: "Here you are.", ar: "تفضل." },
        { speaker: "Staff", en: "Enjoy your flight.", ar: "رحلة سعيدة." },
      ],
      key_expressions: [
        {
          expression_en: "Boarding pass",
          expression_ar: "بطاقة الصعود",
          usage_ar: "تُستخدم عند تقديم وثيقة الصعود للموظف.",
        },
      ],
    },
    global_vocabulary: [
      {
        word: "Flight",
        meaning: "رحلة",
        example_en: "Enjoy your flight.",
        example_ar: "استمتع برحلتك.",
      },
    ],
    lesson_notes: ["في الثقافة العربية يُتبع التحيةَ السؤالُ عن الحال."],
    quiz: makeQuiz({ multipleChoice: 4, trueFalse: 3, written: 3 }),
  };
}

export function makeValidPhoneticsLesson(lessonNo: number): Record<string, unknown> {
  return {
    metadata: {
      course_id: "phonetics",
      course_name_ar: "الصوتيات",
      level: 1,
      lesson_no: lessonNo,
      title: "الفرق بين P و B",
    },
    lesson_content: {
      focus_sounds: [
        { symbol: "/p/", description: "صوت مهموس، تنطبق الشفتان ثم يندفع الهواء فجأة." },
        { symbol: "/b/", description: "صوت مجهور، نفس وضع الشفتين مع اهتزاز الحبال الصوتية." },
      ],
      minimal_pairs: [{ word1: "Pack", word2: "Back" }],
      practice_scripts: ["Peter Piper picked a peck of pickled peppers."],
    },
    global_vocabulary: [
      { word: "Pepper", meaning: "فلفل", example_en: "I like pepper.", example_ar: "أحب الفلفل." },
    ],
    lesson_notes: ["العرب يخلطون بين P و B لأن حرف P غير موجود في العربية."],
    quiz: makeQuiz({ audio: 8, trueFalse: 2 }),
  };
}

export async function run(): Promise<void> {
  assert.equal(containsArabic("مساء الخير"), true);
  assert.equal(containsArabic("Good evening"), false);
  assert.equal(normalizeQuizType("MC"), "multiple_choice");
  assert.equal(normalizeQuizType("open_ended"), "written");
  assert.equal(normalizeQuizType("listening"), "audio_quiz");

  const validConversation = validateLesson(makeValidConversationLesson(3), {
    course: "conversation",
    lessonNo: 3,
  });
  assert.equal(validConversation.valid, true, summarizeIssues(validConversation));
  assert.equal(validConversation.errors, 0);
  assert.equal(validConversation.counts.quiz, 10);

  const validPhonetics = validateLesson(makeValidPhoneticsLesson(2), {
    course: "phonetics",
    lessonNo: 2,
  });
  assert.equal(validPhonetics.valid, true, summarizeIssues(validPhonetics));

  // Wrong lesson number, non-Arabic notes, orphan vocabulary, broken quiz.
  const broken = makeValidConversationLesson(9) as Record<string, unknown>;
  (broken.metadata as Record<string, unknown>).lesson_no = 4;
  (broken.lesson_notes as string[]).push("This note is not Arabic.");
  (broken.global_vocabulary as Array<Record<string, unknown>>).push({ word: "Gate" });
  broken.quiz = makeQuiz({ multipleChoice: 2, trueFalse: 1 });
  const brokenResult = validateLesson(broken, { course: "conversation", lessonNo: 9 });
  assert.equal(brokenResult.valid, false);
  const codes = new Set(brokenResult.issues.map((issue) => issue.code));
  for (const expected of [
    "metadata.lesson_no_mismatch",
    "notes.not_arabic",
    "vocab.orphan",
    "quiz.length",
    "quiz.type_mix",
  ]) {
    assert.ok(codes.has(expected), `missing expected issue ${expected}`);
  }
  assert.ok(brokenResult.score < 100);
  assert.match(buildCorrectivePrompt(brokenResult), /QUALITY GATE/);

  // Course mismatch is an error: a phonetics lesson cannot be filed as writing.
  const mismatched = validateLesson(makeValidPhoneticsLesson(1), { course: "writing" });
  assert.equal(mismatched.valid, false);
  assert.ok(mismatched.issues.some((issue) => issue.code === "metadata.course_mismatch"));

  // Repair: normalizes true/false wording, dedupes, caps the quiz.
  const messy = makeValidConversationLesson(1) as Record<string, unknown>;
  const quiz = makeQuiz({ multipleChoice: 4, trueFalse: 3, written: 5 });
  quiz.push({
    type: "MC",
    question: "سؤال اختيار 1",
    word_to_speak: "leftover",
    options: ["أ", "ب", "ج", "د"],
    answer: "أ",
    explanation_ar: "الشرح بالعربية.",
  });
  (quiz[4] as QuizQuestion).options = ["True", "False"];
  (quiz[4] as QuizQuestion).answer = "True";
  messy.quiz = quiz;
  (messy.global_vocabulary as Array<Record<string, unknown>>).push({
    word: "flight",
    meaning: "مكرر",
    example_en: "x",
    example_ar: "ص",
  });
  // exact duplicate of the note already present in the lesson
  (messy.lesson_notes as string[]).push("في الثقافة العربية يُتبع التحيةَ السؤالُ عن الحال.");

  const repaired = repairLesson(messy, { course: "conversation", lessonNo: 1 });
  assert.ok(repaired.repairs.length > 0);
  assert.equal((repaired.lesson.quiz as unknown[]).length, 10);
  assert.equal((repaired.lesson.global_vocabulary as unknown[]).length, 1);
  assert.equal((repaired.lesson.lesson_notes as unknown[]).length, 1);
  const tfQuestion = (repaired.lesson.quiz as QuizQuestion[]).find((q) => q.type === "true_false");
  assert.deepEqual(tfQuestion?.options, ["صحيح", "خطأ"]);
  assert.equal(tfQuestion?.answer, "صحيح");
  const repairedValidation = validateLesson(repaired.lesson, { course: "conversation", lessonNo: 1 });
  assert.equal(repairedValidation.valid, true, summarizeIssues(repairedValidation));

  // Regression: a true_false question whose options are NOT yes/no
  // (e.g. بسيط/مركب) must never be overwritten by the repair pass.
  const notBoolean = makeValidConversationLesson(1) as Record<string, unknown>;
  const tfQuiz = makeQuiz({ multipleChoice: 5, trueFalse: 2, written: 3 });
  (tfQuiz[5] as QuizQuestion).options = ["بسيط", "مركب"];
  (tfQuiz[5] as QuizQuestion).answer = "مركب";
  (tfQuiz[6] as QuizQuestion).options = ["نعم", "لا، يمكن وضعه خلف الأسنان"];
  (tfQuiz[6] as QuizQuestion).answer = "لا، يمكن وضعه خلف الأسنان";
  notBoolean.quiz = tfQuiz;

  const repairedBoolean = repairLesson(notBoolean, { course: "conversation", lessonNo: 1 });
  const kept = (repairedBoolean.lesson.quiz as QuizQuestion[]).filter((q) => q.type === "true_false");
  assert.deepEqual(kept[0].options, ["بسيط", "مركب"], "non-boolean options must be preserved");
  assert.equal(kept[0].answer, "مركب");
  assert.deepEqual(kept[1].options, ["صحيح", "خطأ"], "yes/no wording is canonicalized");
  assert.equal(kept[1].answer, "خطأ");

  const notBooleanResult = validateLesson(repairedBoolean.lesson, { course: "conversation", lessonNo: 1 });
  assert.equal(notBooleanResult.valid, false);
  assert.ok(
    notBooleanResult.issues.some((issue) => issue.code === "quiz.true_false_not_boolean"),
    summarizeIssues(notBooleanResult)
  );

  // Report aggregation.
  const report = createValidationReport([
    { file: "lesson-01.json", lessonNo: 1, result: validConversation },
    { file: "lesson-02.json", lessonNo: 2, result: brokenResult },
  ]);
  assert.equal(report.totals.lessons, 2);
  assert.equal(report.totals.valid, 1);
  assert.equal(report.totals.invalid, 1);
  assert.ok(report.totals.errors > 0);

  // Every catalogue course has a coherent quiz policy.
  for (const id of ["conversation", "phonetics", "writing", "grammar", "vocabulary", "reading", "listening"]) {
    const definition = getCourseDefinition(id);
    assert.equal(definition.quizPolicy.exactLength, 10, `${id} quiz length`);
    assert.ok(definition.contentKeys.length > 0, `${id} content keys`);
    assert.ok(definition.requiredContentKeys.length > 0, `${id} required content`);
  }
}
