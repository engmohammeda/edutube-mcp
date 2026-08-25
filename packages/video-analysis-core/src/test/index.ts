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
  const { mergeLessonWindows, normalizeLesson, lessonLooksValid, emptyLessonWindow } = await import(
    "../youtube-core/lesson.js"
  );
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
}

const suites = [
  ["youtube-url", runYouTubeUrlTests],
  ["playlist-parse", runPlaylistParseTests],
  ["lesson-merge", runLessonMergeTests],
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
