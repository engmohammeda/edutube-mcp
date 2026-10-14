# Changelog

All notable changes to this project are documented here.

This project follows semantic versioning where practical.

## 0.5.1 — Browser runner, custom-schema course package

### Added

- **Browser-side extraction** (GUI): the 🌐 card in the Extract tab calls Gemini directly from the browser with YouTube URLs (`file_data`) — no yt-dlp/ffmpeg needed; lessons are saved server-side (`POST /api/save-lesson`), resumable, quota-aware (429 backoff). New endpoints: `GET /api/course-files`, `GET /api/runtime-key`, `POST /api/save-lesson`, `POST /api/save-aggregate`.
- `courses/english-from-zero-level1/` custom course package: the owner's «من الصفر» extraction prompt (`prompt.txt`) and JSON schema (`schema.json` — `metadata` + `global_vocabulary` with bilingual examples + `lesson_notes` + 10-item mixed quiz) alongside the 25-lesson `playlist.csv`.
- GUI test suite `gui/test.mjs` (7 tests) with isolated HOME so the user config is never touched.

### Fixed

- Saved settings (`GEMINI_API_KEY` etc.) are now bootstrapped into `process.env` at GUI startup — the key used to vanish on every restart.
- Custom-schema windowed fallback now backfills `metadata` (lesson_no / title / level) after merging windows.

## 0.5.0 — Professional overhaul: presets, CSV import, strict validation

### Added

- **Edutube Studio (Web GUI)**: `npm run gui` launches a bilingual (AR/EN, RTL-aware) web interface on port 4173 — start extraction jobs (playlist/video/CSV) with course-preset cards, live progress + activity log + cancel, a course-aware lesson viewer (dialogue / phonetics / writing shapes), one-click strict validation reports, and key/settings management backed by `~/.edutube-mcp/config.json`. Includes a small JSON API (`/api/jobs`, `/api/lessons`, `/api/validate`, `/api/config`, `/api/health`) for scripting. See `docs/gui.md`.
- **CSV playlist import**: `start_edutube_extraction` / `edutube-mcp extract` accept a local `.csv` file (`url[,title[,lesson_no]]`, flexible headers, quoted fields, BOM/CRLF). `lesson_no` pins both `lesson-NN.json` numbering and `metadata.lesson_no`. Tolerates real-world playlist exports (markdown-wrapped cells, `&amp;` entities, `#,title,videoUrl,videoId,publishedAt,position` headers). See `docs/csv-import.md` and `examples/playlist-template.csv`.
- **GitHub Actions extraction runner** (`ci/extract-lessons.yml` template — copy to `.github/workflows/` to activate): run `edutube-mcp extract` + `validate` on CI runners with full internet via `workflow_dispatch`, lessons delivered as artifacts (requires `GEMINI_API_KEY` repo secret).
- `courses/english-from-zero-level1/` — first real course import (ZAmericanEnglish 25-lesson playlist, cleaned + full CSVs).
- **Strict lesson validator**: `validateLesson` / `validateLessons` in `@engmohammeda/edutube-core` plus the `edutube-mcp validate <dir> [--course …]` CLI command — enforces the full preset contract (metadata, Arabic translations, zero-orphan vocabulary, exact quiz shape and mix) with a CI-friendly JSON report and non-zero exit on failure. Supersedes the standalone Python validators (kept for compatibility). See `docs/validation.md`.
- **Custom schema support for lesson extraction**: `schemaJson` (MCP) / `--schema-file` (CLI) fully replaces the preset schema; windowed fallback merges custom windows generically and lessons are stored as-is. `--prompt-file` (CLI) loads a custom extraction prompt from a file.
- `customLessonLooksValid`, `mergeGenericLessonWindows`, `stripMetadataFromSchema` core helpers.
- New tests: `csv-playlist`, `lesson-validator`, `server-edutube-tools` suites; extended `lesson-merge` coverage.
- Docs: `docs/course-presets.md`, `docs/csv-import.md`, `docs/validation.md`; rewritten `docs/tools.md` and `docs/cli.md`.

### Fixed

- **Resume bug**: cached `lesson-NN.json` files were validated against the conversation contract only, so valid `writing`/`phonetics` lessons were re-extracted on every run. Cached files are now validated against the chosen course (or generically for custom schemas).
- `normalizeLesson` forced `level: 1` even when a level was present; it now preserves valid explicit levels.
- CLI `--course` accepted unknown values silently and its help omitted `writing`; it is now validated against `conversation | phonetics | writing`.
- `SERVER_INFO` still reported the pre-rebrand name `youtube-analyzer-gemini` and version `0.3.0`; it now reports `edutube-mcp` `0.5.0`.
- `true_false` quiz validation now accepts the real-world contract (`options: null` **or** a 2-option pair containing the answer) instead of requiring `null`.
- Edutube entry results now count preset-relevant `contentItems` (dialogue/expressions, sounds/pairs/scripts, sentences/draft) instead of dialogue-only.

### Changed

- `edutubeStartInputSchema`: `url` documents CSV paths, `course` documents all three presets; new optional `schemaJson`.
- `EdutubeRunResult` gains `course` and per-entry `contentItems`; `source` now includes `csv_file`.
- Extraction aborts promptly when the job signal fires (mid-batch), instead of finishing remaining videos.
- Version bump: root `0.5.0`, `@engmohammeda/edutube-core` `0.2.0`.

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
