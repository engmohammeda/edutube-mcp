# Video Analysis Core

Reusable TypeScript core for YouTube/video analysis and lesson-extraction workflows.

This package (`@engmohammeda/edutube-core`) contains the transport-agnostic logic used by the **Edutube MCP** server:

- YouTube URL normalization, playlist resolution (YouTube Data API / yt-dlp / **CSV files**) and metadata helpers.
- **Structured lesson extraction** with course presets (`conversation`, `phonetics`, `writing`), long-video-first / windowed-fallback pipeline, merge & dedupe, resume-safe batch runner.
- **Strict lesson validation** (`validateLesson` / `validateLessons`) enforcing the preset contract.
- High-resolution YouTube frame extraction helpers.
- Gemini-backed video, audio, and long-video analysis with automatic model rotation.
- Long-video strategy planning for URL chunking and uploaded-file workflows.
- Chunk planning and synthesis helpers.
- Shared schemas, diagnostics, progress types, and session-store interfaces.

It intentionally does not register MCP tools, define SaaS routes, manage user auth, or own queue/database infrastructure. Host applications should provide those adapter layers.

## Install

```bash
npm install @engmohammeda/edutube-core
```

## Basic Usage

```ts
import { createVideoAnalysisService, runLessonExtraction, validateLesson } from "@engmohammeda/edutube-core";

const service = createVideoAnalysisService();

const result = await service.analyzeShort({
  youtubeUrl: "https://www.youtube.com/watch?v=...",
  analysisPrompt: "Summarize with timestamps.",
});

// Lesson extraction (playlist URL / video URL / CSV path)
const run = await runLessonExtraction(ai, sessionStore, {
  url: "./my-course.csv",
  outputDir: "./lessons",
  course: "writing",
}, context);

// Strict preset-compliance validation
const problems = validateLesson(lessonJson, { course: "writing", expectLessonNo: 1 });
```

Set `GEMINI_API_KEY` in the environment before using the default Gemini client.

## Development

```bash
npm run test --workspace @engmohammeda/edutube-core
npm run build --workspace @engmohammeda/edutube-core
```

The core test suite avoids network and provider calls by focusing on deterministic planning, parsing, validation, and normalization behavior.

## Long Videos

Use the core runtime helpers to inspect local support for long-video strategies:

```ts
import { getLongVideoRuntimeCapabilities } from "@engmohammeda/edutube-core/youtube/runtime";

const capabilities = await getLongVideoRuntimeCapabilities("uploaded_file");
```

Applications can then choose whether to run uploaded-file analysis, URL chunking, a remote worker, or their own queue/job wrapper.
