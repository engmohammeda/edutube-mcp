import assert from "node:assert/strict";
import type { GoogleGenAI } from "@google/genai";
import { refineFrameTimestampWithGemini } from "../lib/gemini.js";
import { parseSchema } from "../lib/schemas.js";
import { createAdaptiveBatchPlan, createAdaptiveChunkPlan } from "../youtube-core/chunk-planner.js";
import { normalizeYouTubeUrl } from "../youtube-core/youtube.js";

async function runYouTubeUrlTests(): Promise<void> {
  assert.equal(
    normalizeYouTubeUrl("https://www.youtube.com/watch?v=wXY6izdYFBo&si=hURjSLY_IVrYrtPs"),
    "https://www.youtube.com/watch?v=wXY6izdYFBo"
  );
  assert.equal(
    normalizeYouTubeUrl("youtu.be/wXY6izdYFBo?si=hURjSLY_IVrYrtPs"),
    "https://www.youtube.com/watch?v=wXY6izdYFBo"
  );
  assert.equal(
    normalizeYouTubeUrl("https://www.youtube.com/live/wXY6izdYFBo?si=hURjSLY_IVrYrtPs"),
    "https://www.youtube.com/watch?v=wXY6izdYFBo"
  );
  assert.equal(
    normalizeYouTubeUrl("https://www.youtube.com/shorts/wXY6izdYFBo"),
    "https://www.youtube.com/watch?v=wXY6izdYFBo"
  );
  assert.equal(
    normalizeYouTubeUrl("https://www.youtube.com/embed/wXY6izdYFBo"),
    "https://www.youtube.com/watch?v=wXY6izdYFBo"
  );
  assert.equal(normalizeYouTubeUrl("https://example.com/watch?v=wXY6izdYFBo"), null);
  assert.equal(normalizeYouTubeUrl("https://www.youtube.com/watch"), null);
}

async function runChunkPlannerTests(): Promise<void> {
  const chunks = await createAdaptiveChunkPlan({
    durationSeconds: 100,
    overlapSeconds: 5,
    minChunkDurationSeconds: 30,
    canFitChunk: async (start, end) => end - start <= 45,
  });

  assert.deepEqual(chunks, [
    { index: 0, startOffsetSeconds: 0, endOffsetSeconds: 45 },
    { index: 1, startOffsetSeconds: 40, endOffsetSeconds: 85 },
    { index: 2, startOffsetSeconds: 80, endOffsetSeconds: 100 },
  ]);

  await assert.rejects(
    () =>
      createAdaptiveChunkPlan({
        durationSeconds: 120,
        overlapSeconds: 10,
        minChunkDurationSeconds: 60,
        canFitChunk: async () => false,
      }),
    /Unable to find a viable chunk/
  );
}

async function runBatchPlannerTests(): Promise<void> {
  const batches = await createAdaptiveBatchPlan({
    totalItems: 7,
    canFitBatch: async (start, end) => end - start <= 3,
  });

  assert.deepEqual(batches, [
    { index: 0, startIndex: 0, endIndex: 3 },
    { index: 1, startIndex: 3, endIndex: 6 },
    { index: 2, startIndex: 6, endIndex: 7 },
  ]);
}

async function runSchemaTests(): Promise<void> {
  const fallback = { type: "object", properties: { summary: { type: "string" } } };
  assert.equal(parseSchema(undefined, fallback), fallback);
  assert.deepEqual(parseSchema('{"type":"object","properties":{"items":{"type":"array"}}}'), {
    type: "object",
    properties: { items: { type: "array" } },
  });
  assert.throws(() => parseSchema("[]"), /Schema must be a JSON object/);
  assert.throws(() => parseSchema("{"), /Invalid responseSchemaJson/);
}

async function runFrameTimestampRefinementTests(): Promise<void> {
  const calls: unknown[] = [];
  const ai = {
    models: {
      generateContent: async (params: unknown) => {
        calls.push(params);
        return {
          text: JSON.stringify({
            timestampSeconds: 42.25,
            reason: "The visual cue appears at this moment.",
            confidence: 0.8,
          }),
        };
      },
    },
  } as unknown as GoogleGenAI;

  const result = await refineFrameTimestampWithGemini(
    ai,
    {
      model: "gemini-test",
      normalizedYoutubeUrl: "https://www.youtube.com/watch?v=test",
      timestampSeconds: 40,
      windowSeconds: 10,
      refinementPrompt: "Find the title card.",
    },
    {
      logger: {
        requestId: "test-request",
        tool: "test-tool",
        child: () => undefined as never,
        info: () => undefined,
        warn: () => undefined,
        error: () => undefined,
      },
      tool: "get_youtube_video_frame",
      stage: "timestamp_refinement",
      code: "GEMINI_TIMESTAMP_REFINEMENT_FAILED",
      failureMessage: "Failed to refine timestamp.",
      inputMode: "youtube_url",
      responseMode: "schema_json",
    }
  );

  assert.equal(calls.length, 1);
  assert.deepEqual(result, {
    timestampSeconds: 42.25,
    reason: "The visual cue appears at this moment.",
  });
}

async function runPlaylistParseTests(): Promise<void> {
  const { parsePlaylistId, isPlaylistUrl, extractVideoId } = await import("../youtube-core/playlist.js");
  assert.equal(
    parsePlaylistId("https://www.youtube.com/watch?v=82a1udwePtk&list=PLp22-4PivYmKp2aC7PI7K0POsf812xLBN&index=1"),
    "PLp22-4PivYmKp2aC7PI7K0POsf812xLBN"
  );
  assert.equal(parsePlaylistId("PLp22-4PivYmKp2aC7PI7K0POsf812xLBN"), "PLp22-4PivYmKp2aC7PI7K0POsf812xLBN");
  assert.equal(parsePlaylistId("https://www.youtube.com/watch?v=jNQXAC9IVRw"), null);
  assert.equal(isPlaylistUrl("https://www.youtube.com/playlist?list=PLabc"), true);
  assert.equal(isPlaylistUrl("https://www.youtube.com/watch?v=jNQXAC9IVRw"), false);
  assert.equal(extractVideoId("https://youtu.be/jNQXAC9IVRw"), "jNQXAC9IVRw");
  assert.equal(extractVideoId("https://www.youtube.com/watch?v=jNQXAC9IVRw"), "jNQXAC9IVRw");
  assert.equal(extractVideoId("jNQXAC9IVRw"), "jNQXAC9IVRw");
}

async function runLessonMergeTests(): Promise<void> {
  const {
    mergeLessonWindows,
    mergeGenericLessonWindows,
    normalizeLesson,
    lessonLooksValid,
    customLessonLooksValid,
    emptyLessonWindow,
  } = await import("../youtube-core/lesson.js");
  const w1 = emptyLessonWindow();
  w1.dialogue.push({ speaker: "A", en: "Hi", ar: "مرحبا" });
  w1.key_expressions.push({ expression_en: "Take care", expression_ar: "اعتنِ بنفسك", usage_ar: "للوداع" });
  w1.global_vocabulary.push({ word: "Holiday", meaning: "عطلة", example_en: "Nice holiday", example_ar: "عطلة جميلة" });
  w1.lesson_notes.push("ملاحظة 1");
  w1.quiz.push({ type: "true_false", question: "Q1", word_to_speak: null, options: null, answer: "True", explanation_ar: "ش" });

  const w2 = emptyLessonWindow();
  w2.dialogue.push({ speaker: "B", en: "Hello", ar: "أهلا" });
  w2.key_expressions.push({ expression_en: "take care", expression_ar: "duplicate", usage_ar: "dup" });
  w2.global_vocabulary.push({ word: "holiday", meaning: "dup", example_en: "x", example_ar: "y" });
  w2.lesson_notes.push("ملاحظة 1");
  w2.quiz.push({ type: "written", question: "Q1", word_to_speak: null, options: null, answer: "x", explanation_ar: "ش" });
  w2.quiz.push({ type: "multiple_choice", question: "Q2", word_to_speak: null, options: ["a"], answer: "a", explanation_ar: "ش" });

  const merged = mergeLessonWindows([w1, w2]);
  assert.equal(merged.dialogue.length, 2);
  assert.equal(merged.key_expressions.length, 1);
  assert.equal(merged.global_vocabulary.length, 1);
  assert.equal(merged.lesson_notes.length, 1);
  assert.equal(merged.quiz.length, 2);

  const lesson = { lesson_content: { dialogue: merged.dialogue, key_expressions: [] }, quiz: merged.quiz };
  assert.equal(lessonLooksValid(lesson), false); // quiz < 5
  const normalized = normalizeLesson(
    { ...lesson, quiz: Array.from({ length: 12 }, (_, i) => merged.quiz[i % 2]) },
    { position: 7, fallbackTitle: "الطقس" }
  );
  const meta = normalized.metadata as Record<string, unknown>;
  assert.equal(meta.lesson_no, 7);
  assert.equal(meta.course_id, "conversation");
  assert.equal(meta.title, "الطقس");
  assert.equal((normalized.quiz as unknown[]).length, 10);

  // normalizeLesson preserves an explicit valid level and defaults to 1.
  const withLevel = normalizeLesson({ ...lesson, metadata: { level: 3 }, quiz: merged.quiz }, { position: 2 });
  assert.equal((withLevel.metadata as Record<string, unknown>).level, 3);
  const noLevel = normalizeLesson({ ...lesson, quiz: merged.quiz }, { position: 2 });
  assert.equal((noLevel.metadata as Record<string, unknown>).level, 1);

  // lessonLooksValid must respect the course: a valid writing lesson has no dialogue.
  const writingLesson = {
    lesson_content: {
      topic_en: "The Sea",
      topic_ar: "البحر",
      brainstorming_questions: [{ question_en: "q", suggested_answer_en: "a" }],
      guided_sentences: [{ en: "s", ar: "س" }],
      final_draft: { en: "draft", ar: "مسودة" },
    },
    quiz: Array.from({ length: 6 }, (_, i) => ({ type: "written", question: `Q${i}` })),
  };
  assert.equal(lessonLooksValid(writingLesson, "writing"), true);
  assert.equal(lessonLooksValid(writingLesson), false); // default conversation requires dialogue

  // customLessonLooksValid: needs >= 3 keys and some actual content.
  assert.equal(customLessonLooksValid({ a: [1], b: "x", c: null }), true);
  assert.equal(customLessonLooksValid({ a: [], b: "", c: "" }), false);
  assert.equal(customLessonLooksValid({ a: 1 }), false);

  // mergeGenericLessonWindows: arrays dedupe, objects deep-merge, longest string wins.
  const generic = mergeGenericLessonWindows([
    { title: "short", tags: ["a", "b"], nested: { x: 1, y: null } },
    { title: "a much longer title", tags: ["b", "c"], nested: { y: 2 } },
  ]);
  assert.equal(generic.title, "a much longer title");
  assert.deepEqual(generic.tags, ["a", "b", "c"]);
  assert.deepEqual(generic.nested, { x: 1, y: 2 });
}

async function runCsvPlaylistTests(): Promise<void> {
  const { parseCsvPlaylist, parseCsvRows, isCsvPlaylistPath, extractVideoId } = await import(
    "../youtube-core/playlist.js"
  );

  // RFC-4180 quoting + CRLF + BOM.
  const rows = parseCsvRows('\uFEFFurl,title\r\n"https://youtu.be/jNQXAC9IVRw","Hello, ""quoted"""\r\n');
  assert.deepEqual(rows, [
    ["url", "title"],
    ["https://youtu.be/jNQXAC9IVRw", 'Hello, "quoted"'],
  ]);

  // Headered CSV with flexible columns and lesson_no.
  const headered = parseCsvPlaylist(
    [
      "video_url,lesson_title,lesson_no",
      "https://www.youtube.com/watch?v=jNQXAC9IVRw,Lesson One,1",
      "https://youtu.be/wXY6izdYFBo,Lesson Two,2",
    ].join("\n")
  );
  assert.equal(headered.entries.length, 2);
  assert.equal(headered.entries[0].videoId, "jNQXAC9IVRw");
  assert.equal(headered.entries[0].title, "Lesson One");
  assert.equal(headered.entries[0].lessonNo, 1);
  assert.equal(headered.entries[1].videoId, "wXY6izdYFBo");
  assert.equal(headered.entries[1].lessonNo, 2);

  // Header-less CSV: url[,title[,lesson_no]].
  const bare = parseCsvPlaylist(
    "dQw4w9WgXcQ,Intro,5\nhttps://www.youtube.com/watch?v=jNQXAC9IVRw"
  );
  assert.equal(bare.entries.length, 2);
  assert.equal(bare.entries[0].lessonNo, 5);
  assert.equal(bare.entries[0].title, "Intro");
  assert.equal(bare.entries[1].lessonNo, null);

  assert.throws(() => parseCsvPlaylist("url,title\n"), /no data rows/);
  assert.throws(() => parseCsvPlaylist("url\nhttps://example.com/not-youtube"), /cannot extract a YouTube video id/i);

  assert.equal(isCsvPlaylistPath("playlist.csv"), true);
  assert.equal(isCsvPlaylistPath("https://example.com/playlist.csv"), false);
  assert.equal(extractVideoId("https://www.youtube.com/watch?v=jNQXAC9IVRw&list=PLx"), "jNQXAC9IVRw");
}

async function runLessonValidatorTests(): Promise<void> {
  const { validateLesson, hasArabic } = await import("../youtube-core/lesson-validator.js");

  assert.equal(hasArabic("مرحبا"), true);
  assert.equal(hasArabic("hello"), false);

  const quizFor = (types: string[]) =>
    types.map((type, i) => ({
      type,
      question: `سؤال ${i}`,
      word_to_speak: type === "audio_quiz" ? `word${i}` : null,
      options: type === "multiple_choice" || type === "audio_quiz" ? ["a", "b", "c", "d"] : null,
      answer: type === "multiple_choice" || type === "audio_quiz" ? "a" : "صحيح",
      explanation_ar: "شرح بالعربية",
    }));

  const baseMeta = (course: string, name: string) => ({
    course_id: course,
    course_name_ar: name,
    level: 1,
    lesson_no: 3,
    title: "درس تجريبي",
  });

  const vocab = [{ word: "apple", meaning: "تفاحة", example_en: "I eat an apple", example_ar: "آكل تفاحة" }];

  // A fully valid conversation lesson.
  const conversation = {
    metadata: baseMeta("conversation", "المحادثة"),
    lesson_content: {
      dialogue: [{ speaker: "A", en: "Hello", ar: "مرحبا" }],
      key_expressions: [{ expression_en: "take care", expression_ar: "اعتنِ بنفسك", usage_ar: "للوداع" }],
    },
    global_vocabulary: vocab,
    lesson_notes: ["ملاحظة نطق"],
    quiz: quizFor(["multiple_choice", "true_false", "written", "multiple_choice", "true_false", "written", "multiple_choice", "true_false", "written", "multiple_choice"]),
  };
  assert.deepEqual(validateLesson(conversation, { course: "conversation", expectLessonNo: 3 }), []);

  // lesson_no mismatch and wrong course metadata are reported.
  const mismatched = validateLesson(conversation, { course: "conversation", expectLessonNo: 4 });
  assert.ok(mismatched.some((p) => p.includes("lesson_no")));

  // Orphan vocabulary and English-only notes are reported.
  const badVocab = {
    ...conversation,
    global_vocabulary: [{ word: "apple", meaning: "", example_en: "x", example_ar: "y" }],
    lesson_notes: ["english only note"],
  };
  const vocabProblems = validateLesson(badVocab, { course: "conversation" });
  assert.ok(vocabProblems.some((p) => p.includes("global_vocabulary[0].meaning")));
  assert.ok(vocabProblems.some((p) => p.includes("must be written in Arabic")));

  // Quiz length must be exactly 10 and written questions must have options=null.
  const badQuiz = {
    ...conversation,
    quiz: [
      ...quizFor(["multiple_choice", "true_false"]),
      { type: "written", question: "q", options: ["x"], answer: "x", explanation_ar: "شرح" },
    ],
  };
  const quizProblems = validateLesson(badQuiz, { course: "conversation" });
  assert.ok(quizProblems.some((p) => p.includes("exactly 10")));
  assert.ok(quizProblems.some((p) => p.includes("options=null")));

  // Phonetics rules: >=5 audio_quiz and 2-4 true_false.
  const phonetics = {
    metadata: baseMeta("phonetics", "الصوتيات"),
    lesson_content: {
      focus_sounds: [{ symbol: "/p/", description: "الشفتان تضغطان ثم ينطلق الهواء" }],
      minimal_pairs: [{ word1: "pack", word2: "back" }],
      practice_scripts: ["Peter picked a pair of packs."],
    },
    global_vocabulary: vocab,
    lesson_notes: ["احذر نطق الحاء عيناً"],
    quiz: quizFor(["audio_quiz", "audio_quiz", "audio_quiz", "audio_quiz", "audio_quiz", "true_false", "true_false", "audio_quiz", "audio_quiz", "true_false"]),
  };
  assert.deepEqual(validateLesson(phonetics, { course: "phonetics" }), []);
  const weakPhonetics = { ...phonetics, quiz: quizFor(["true_false", "true_false", "true_false", "true_false", "true_false", "true_false", "true_false", "true_false", "true_false", "true_false"]) };
  const phoneticsProblems = validateLesson(weakPhonetics, { course: "phonetics" });
  assert.ok(phoneticsProblems.some((p) => p.includes("at least 5 audio_quiz")));
  assert.ok(phoneticsProblems.some((p) => p.includes("2-4 true_false")));

  // Writing rules: topic, brainstorming, guided sentences, final draft, written-heavy quiz.
  const writing = {
    metadata: baseMeta("writing", "الكتابة"),
    lesson_content: {
      topic_en: "The Statue of Liberty",
      topic_ar: "تمثال الحرية",
      brainstorming_questions: [{ question_en: "Where is it?", suggested_answer_en: "In New York." }],
      guided_sentences: [{ en: "It is in New York.", ar: "إنه في نيويورك." }],
      final_draft: { en: "It is in New York and it is tall.", ar: "إنه في نيويورك وهو طويل." },
    },
    global_vocabulary: vocab,
    lesson_notes: ["الجملة تبدأ بحرف كبير"],
    quiz: quizFor(["written", "written", "written", "written", "written", "multiple_choice", "multiple_choice", "true_false", "true_false", "written"]),
  };
  assert.deepEqual(validateLesson(writing, { course: "writing" }), []);
  const emptyWriting = {
    ...writing,
    lesson_content: { ...writing.lesson_content, final_draft: { en: "", ar: "" } },
  };
  const writingProblems = validateLesson(emptyWriting, { course: "writing" });
  assert.ok(writingProblems.some((p) => p.includes("final_draft.en")));
  assert.ok(writingProblems.some((p) => p.includes("final_draft.ar")));
}

const suites = [
  ["youtube-url", runYouTubeUrlTests],
  ["playlist-parse", runPlaylistParseTests],
  ["csv-playlist", runCsvPlaylistTests],
  ["lesson-merge", runLessonMergeTests],
  ["lesson-validator", runLessonValidatorTests],
  ["chunk-planner", runChunkPlannerTests],
  ["batch-planner", runBatchPlannerTests],
  ["schema", runSchemaTests],
  ["frame-timestamp-refinement", runFrameTimestampRefinementTests],
] as const;

async function main(): Promise<void> {
  for (const [name, run] of suites) {
    await run();
    console.log(`PASS core:${name}`);
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.stack || error.message : String(error);
  console.error(message);
  process.exit(1);
});
