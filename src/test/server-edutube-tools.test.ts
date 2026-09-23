import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { createServer } from "../server.js";
import { createConnectedInMemoryClient } from "./test-helpers.js";

const unusedService = {
  async analyzeShort(): Promise<never> {
    throw new Error("Not used");
  },
  async analyzeAudio(): Promise<never> {
    throw new Error("Not used");
  },
  async analyzeLong(): Promise<never> {
    throw new Error("Not used");
  },
  async continueLong(): Promise<never> {
    throw new Error("Not used");
  },
  async getYouTubeMetadata(): Promise<never> {
    throw new Error("Not used");
  },
  async getYouTubeFrame(): Promise<never> {
    throw new Error("Not used");
  },
};

function validLesson(lessonNo: number): Record<string, unknown> {
  const quiz: Array<Record<string, unknown>> = [];
  for (let i = 0; i < 4; i += 1) {
    quiz.push({
      type: "multiple_choice",
      question: `سؤال ${i + 1}`,
      word_to_speak: null,
      options: ["أ", "ب", "ج", "د"],
      answer: "أ",
      explanation_ar: "الشرح بالعربية.",
    });
  }
  for (let i = 0; i < 3; i += 1) {
    quiz.push({
      type: "true_false",
      question: `صح وخطأ ${i + 1}`,
      word_to_speak: null,
      options: ["صحيح", "خطأ"],
      answer: "صحيح",
      explanation_ar: "الشرح بالعربية.",
    });
  }
  for (let i = 0; i < 3; i += 1) {
    quiz.push({
      type: "written",
      question: `سؤال كتابي ${i + 1}`,
      word_to_speak: null,
      options: null,
      answer: "Boarding pass",
      explanation_ar: "الشرح بالعربية.",
    });
  }

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
        { speaker: "Woman", en: "Here you are.", ar: "تفضل." },
        { speaker: "Staff", en: "Boarding pass, please.", ar: "بطاقة الصعود من فضلك." },
        { speaker: "Staff", en: "Enjoy your flight.", ar: "رحلة سعيدة." },
      ],
      key_expressions: [
        {
          expression_en: "Boarding pass",
          expression_ar: "بطاقة الصعود",
          usage_ar: "تُستخدم عند تقديم وثيقة الصعود.",
        },
      ],
    },
    global_vocabulary: [
      { word: "Flight", meaning: "رحلة", example_en: "Enjoy your flight.", example_ar: "رحلة سعيدة." },
    ],
    lesson_notes: ["ملاحظة ثقافية بالعربية."],
    quiz,
  };
}

export async function run(): Promise<void> {
  const outputDir = await mkdtemp(path.join(tmpdir(), "edutube-server-"));
  await writeFile(path.join(outputDir, "lesson-01.json"), JSON.stringify(validLesson(1), null, 2));

  const broken = validLesson(2) as Record<string, unknown>;
  broken.quiz = [];
  (broken.lesson_notes as string[]).length = 0;
  await writeFile(path.join(outputDir, "lesson-02.json"), JSON.stringify(broken, null, 2));

  const server = createServer({ service: unusedService });
  const client = await createConnectedInMemoryClient(server);

  try {
    const tools = await client.listTools();
    const names = tools.tools.map((tool) => tool.name);
    for (const expected of [
      "start_edutube_extraction",
      "get_edutube_job_status",
      "get_edutube_job_result",
      "cancel_edutube_job",
      "validate_edutube_lessons",
      "get_edutube_curriculum",
    ]) {
      assert.ok(names.includes(expected), `missing tool ${expected}`);
    }
    assert.equal(names.length, 17, `expected 17 tools, got ${names.length}: ${names.join(", ")}`);

    const startSchema = tools.tools.find((tool) => tool.name === "start_edutube_extraction");
    const courseEnum = (
      startSchema?.inputSchema as { properties?: { course?: { enum?: string[] } } }
    )?.properties?.course?.enum;
    assert.deepEqual(courseEnum, [
      "conversation",
      "phonetics",
      "writing",
      "grammar",
      "vocabulary",
      "reading",
      "listening",
    ]);

    const validation = await client.callTool({
      name: "validate_edutube_lessons",
      arguments: { outputDir, course: "conversation" },
    });
    assert.equal(validation.isError, undefined);
    const validationContent = validation.structuredContent as {
      totals: { lessons: number; valid: number; invalid: number };
      lessons: Array<{ lesson_no: number | null; valid: boolean; issues: unknown[] }>;
      coverage: { courses: Array<{ course_id: string }> };
    };
    assert.equal(validationContent.totals.lessons, 2);
    assert.equal(validationContent.totals.valid, 1);
    assert.equal(validationContent.totals.invalid, 1);
    assert.equal(validationContent.coverage.courses[0].course_id, "conversation");
    const brokenReport = validationContent.lessons.find((lesson) => lesson.lesson_no === 2);
    assert.ok(brokenReport && brokenReport.valid === false);
    assert.ok(brokenReport.issues.length > 0);

    // repair=true rewrites the fixable parts but cannot invent the missing quiz.
    const repaired = await client.callTool({
      name: "validate_edutube_lessons",
      arguments: { outputDir, course: "conversation", repair: true },
    });
    assert.equal(repaired.isError, undefined);

    const curriculum = await client.callTool({
      name: "get_edutube_curriculum",
      arguments: { outputDir },
    });
    assert.equal(curriculum.isError, undefined);
    const curriculumContent = curriculum.structuredContent as {
      courses: Array<{ course_id: string; course_name_ar: string }>;
      lessonsFound: number;
      coverage: { totals: { lessons: number; completion: number } };
    };
    assert.equal(curriculumContent.courses.length, 7);
    assert.equal(curriculumContent.lessonsFound, 2);
    assert.equal(curriculumContent.coverage.totals.lessons, 2);
    assert.equal(curriculumContent.coverage.totals.completion, 0.5);

    // A missing directory is a clean, structured error rather than a crash.
    const missing = await client.callTool({
      name: "validate_edutube_lessons",
      arguments: { outputDir: path.join(outputDir, "does-not-exist") },
    });
    assert.equal(missing.isError, true);
  } finally {
    await client.close();
    await server.close();
    await rm(outputDir, { recursive: true, force: true });
  }
}
