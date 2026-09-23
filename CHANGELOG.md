# Changelog

All notable changes to this project are documented here.

This project follows semantic versioning where practical.

## 0.5.0 — Quality gate, full-curriculum support

### Added

- **Curriculum registry** (`curriculum.ts`): 7 course presets — `conversation`, `phonetics`, `writing`, plus new `grammar`, `vocabulary`, `reading`, `listening` — each with its own JSON schema, extraction prompt, required content keys and quiz policy.
- **Lesson quality gate** (`lesson-validation.ts`): deterministic `repairLesson` + policy `validateLesson` (30+ rules with stable codes: `quiz.options_missing`, `quiz.true_false_not_boolean`, `vocab.orphan`, `lang.arabic_missing`, `metadata.lesson_no_mismatch`, …) and `createValidationReport`.
- **Rebuilt extraction runner**: repair → validate → retry with corrective feedback, course-aware resume, bounded concurrency, duplicate-video detection, `curriculum-state.json`, `validation-report.json`, `lessons-index.json`, and a curriculum coverage report (missing lesson numbers, duplicated titles, completion %).
- **CLI**: `validate`, `curriculum`, `courses` commands; `extract` gained `--course`, `--level`, `--concurrency`, `--attempts`, `--strict`, `--only-failed`, `--force`, `--expected`, `--manifest`, `--start-index`; CI-friendly exit codes (2 = defective lessons present).
- **MCP tools**: `validate_edutube_lessons` and `get_edutube_curriculum` (17 tools total); `start_edutube_extraction` accepts the new run-control inputs.
- Curriculum manifest support (`examples/curriculum.zamericanenglish.json`) — playlist ids stay user-provided, never guessed.
- Tests: `lesson-validation`, `curriculum`, `edutube-runner`, `edutube-tools`, `server-info` (22 suites).

### Fixed

- Resume check ignored the course preset, so phonetics/writing runs re-extracted every cached lesson (wasting quota).
- Defective lessons were written as successes: real data contained `true_false` questions with `options: null` and non-boolean options labelled `true_false`.
- `SERVER_INFO` advertised `youtube-analyzer-gemini` 0.3.0 while the package was 0.4.0; now `edutube-mcp` and guarded by a test.
- CLI duplicated config-path logic (`~/.edutube-mcp`) instead of using the core helper (`~/.config/edutube-mcp`), and its `--course` help omitted `writing`.
- `lessons-all.json` ordering now follows `lesson_no` numerically instead of insertion order.
- `docs/tools.md` claimed eleven tools.

## 0.4.0 — Edutube rebrand

Project renamed to **Edutube MCP** (`@engmohammeda/edutube-mcp`, core `@engmohammeda/edutube-core`, binary `edutube-mcp`) and re-documented (bilingual README, new docs pages).

### Added

- `start_edutube_extraction`: paste a playlist URL / playlist id / single video URL → background job that writes `lesson-NN.json`, `lessons-all.json` and `summary.json` (dialogue with Arabic translations, key expressions, vocabulary, Arabic notes, 10-question quiz). Resume-safe.
- `get_edutube_job_status`, `get_edutube_job_result`, `cancel_edutube_job` job controls.
- Playlist import via YouTube Data API with keyless `yt-dlp --flat-playlist` fallback.
- Lesson pipeline: long-video single pass first, automatic 150s windowed fallback with merge/dedupe; `normalizeLesson` fixes course metadata and quiz caps.
- Automatic cross-model rotation across Gemini free-tier quota pools with live model discovery (`model-rotation.ts`); `GEMINI_MODEL_ROTATION` env override; rotation embedded in `generateStructuredJson` and `countTokens`.
- CLI: `edutube-mcp extract <url> [--out DIR] [--max N] [--model M]` with clean JSON stdout.
- New unit tests: `playlist-parse`, `lesson-merge`.
- Docs: `docs/edutube-playlist.md`, `docs/model-rotation.md`, `docs/cli.md`.

### Fixed

- `.env` values such as `GEMINI_MODEL` were ignored (dotenv loaded after module-scope reads) — server import now deferred until after dotenv.
- Long-video metadata no longer hard-requires `YOUTUBE_API_KEY` (yt-dlp fallback).
- Modern separate-stream YouTube formats now download (`bv*+ba` selector + `--merge-output-format mp4`).

## Unreleased

### Added

- `get_youtube_video_frame`, a new MCP tool for extracting a high-resolution JPEG frame from a YouTube video timestamp.
- Reusable core frame extraction support using `yt-dlp` and `ffmpeg`.
- Optional Gemini timestamp refinement for frame extraction; Gemini returns JSON timestamps only, while the frame bytes still come from `yt-dlp` and `ffmpeg`.

## 0.3.0 - 2026-05-18

### Added

- Long-video and VOD analysis through MCP tasks.
- Follow-up questions for reusable long-video sessions.
- Capability inspection for long-video strategy selection.
- Audio-focused analysis tool for speech-heavy videos.
- CLI setup flow for reusable local configuration.

### Changed

- Expanded README with install, MCP client config, tool, long-video, and publishing guidance.
- Improved runtime guidance for `yt-dlp`, `ffmpeg`, and long-video strategies.
- Long-video tools now require MCP task execution so synchronous clients with fixed timeouts fail fast instead of timing out mid-analysis.
- Added compatibility background job tools for long-video analysis clients that do not support MCP tasks.
- Started the npm workspace monorepo split with reusable `@ludylops/video-analysis-core` package consumed by the MCP server.

### Notes

- `GEMINI_API_KEY` is required for analysis.
- `YOUTUBE_API_KEY` is optional and only required for metadata lookup.
- Best long-video support requires `yt-dlp`, `ffmpeg`, and a writable temp directory.

## 0.2.0 - Previous Release

### Added

- Core MCP stdio server for YouTube analysis with Gemini.
- Short-video analysis.
- YouTube metadata lookup.
- Local test suite.
