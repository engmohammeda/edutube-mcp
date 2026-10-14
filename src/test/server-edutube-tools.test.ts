import assert from "node:assert/strict";

import { LongAnalysisJobStore } from "../long-analysis-job-store.js";
import { createServer } from "../server.js";
import type { EdutubeRunOptions, EdutubeRunResult } from "@engmohammeda/edutube-core";
import { createConnectedInMemoryClient } from "./test-helpers.js";

type InMemoryClient = Awaited<ReturnType<typeof createConnectedInMemoryClient>>;

function waitForTerminalJob(client: InMemoryClient, jobId: string): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const poll = async () => {
      try {
        const result = await client.callTool({
          name: "get_edutube_job_result",
          arguments: { jobId },
        });
        const output = result.structuredContent as Record<string, unknown>;
        if (["done", "error", "cancelled"].includes(String(output.status))) {
          resolve(output);
          return;
        }
        if (Date.now() - startedAt > 5000) {
          reject(new Error("Timed out waiting for edutube job."));
          return;
        }
        setTimeout(poll, 20);
      } catch (error) {
        reject(error);
      }
    };
    void poll();
  });
}

function mockResult(overrides: Partial<EdutubeRunResult> = {}): EdutubeRunResult {
  return {
    playlistId: null,
    source: "single_video",
    outputDir: "/tmp/edutube-test",
    course: "writing",
    entries: [
      { index: 0, videoId: "test", title: "Lesson", status: "ok", file: "/tmp/edutube-test/lesson-01.json", contentItems: 6, dialogue: 0, quiz: 10 },
    ],
    totals: { ok: 1, skipped: 0, failed: 0 },
    ...overrides,
  };
}

export async function run(): Promise<void> {
  const longAnalysisJobStore = new LongAnalysisJobStore();
  const capturedOptions: EdutubeRunOptions[] = [];
  let releaseExtraction: (() => void) | undefined;

  const server = createServer({
    longAnalysisJobStore,
    lessonExtractor: async (options, context) => {
      capturedOptions.push(options);
      await context.reportProgress?.({ progress: 1, total: 2, message: "Extracting." });
      if (options.maxVideos === 1) {
        // blocking extractor for the cancel path
        await new Promise<void>((resolve) => {
          releaseExtraction = resolve;
          context.abortSignal?.addEventListener("abort", () => resolve(), { once: true });
        });
        throw new Error("Cancelled by test");
      }
      await context.reportProgress?.({ progress: 2, total: 2, message: "Done." });
      return mockResult();
    },
    service: {
      async analyzeShort() {
        throw new Error("Not used");
      },
      async analyzeAudio() {
        throw new Error("Not used");
      },
      async analyzeLong() {
        throw new Error("Not used");
      },
      async continueLong() {
        throw new Error("Not used");
      },
      async getYouTubeMetadata() {
        throw new Error("Not used");
      },
      async getYouTubeFrame() {
        throw new Error("Not used");
      },
    },
  });

  const client = await createConnectedInMemoryClient(server);

  try {
    // ---- happy path: start → status → result --------------------------------
    const startResult = await client.callTool({
      name: "start_edutube_extraction",
      arguments: {
        url: "https://www.youtube.com/watch?v=test",
        outputDir: "/tmp/edutube-test",
        course: "writing",
        analysisPrompt: "Custom prompt",
        schemaJson: "{\"type\":\"object\"}",
      },
    });
    assert.equal(startResult.isError, undefined);
    const startOutput = startResult.structuredContent as Record<string, unknown>;
    assert.equal(startOutput.status, "queued");
    const jobId = String(startOutput.jobId);
    assert.ok(jobId.length > 0);

    const finalOutput = await waitForTerminalJob(client, jobId);
    assert.equal(finalOutput.status, "done");
    const resultPayload = (finalOutput.result ?? finalOutput) as Record<string, unknown>;
    const totals = (resultPayload.totals ?? (finalOutput as { totals?: unknown }).totals) as
      | { ok: number; skipped: number; failed: number }
      | undefined;
    assert.ok(totals);
    assert.equal(totals.ok, 1);
    assert.equal(totals.failed, 0);

    // options passed through to the extractor
    assert.equal(capturedOptions.length, 1);
    assert.equal(capturedOptions[0].course, "writing");
    assert.equal(capturedOptions[0].analysisPrompt, "Custom prompt");
    assert.equal(capturedOptions[0].schemaJson, "{\"type\":\"object\"}");
    assert.equal(capturedOptions[0].outputDir, "/tmp/edutube-test");

    // status tool reports done
    const statusResult = await client.callTool({ name: "get_edutube_job_status", arguments: { jobId } });
    assert.equal((statusResult.structuredContent as Record<string, unknown>).status, "done");

    // ---- unknown job id ----------------------------------------------------
    const missing = await client.callTool({ name: "get_edutube_job_status", arguments: { jobId: "missing" } });
    assert.equal(missing.isError, true);

    // ---- cancel path -------------------------------------------------------
    const cancelStart = await client.callTool({
      name: "start_edutube_extraction",
      arguments: {
        url: "https://www.youtube.com/watch?v=test",
        outputDir: "/tmp/edutube-test",
        maxVideos: 1,
      },
    });
    const cancelJobId = String((cancelStart.structuredContent as Record<string, unknown>).jobId);

    // give the blocking extractor a moment to start, then cancel
    await new Promise((resolve) => setTimeout(resolve, 30));
    const cancelResult = await client.callTool({ name: "cancel_edutube_job", arguments: { jobId: cancelJobId } });
    assert.equal(cancelResult.isError, undefined);
    assert.equal((cancelResult.structuredContent as Record<string, unknown>).status, "cancelled");
    releaseExtraction?.();

    const cancelledFinal = await waitForTerminalJob(client, cancelJobId);
    assert.ok(["cancelled", "error"].includes(String(cancelledFinal.status)));
  } finally {
    releaseExtraction?.();
    await client.close();
    await server.close();
  }
}
