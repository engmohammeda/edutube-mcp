# Tools

This server exposes **fifteen** MCP tools in four groups:

1. **Edutube lesson extraction** — playlist/video/CSV → structured lesson JSON files.
2. **Video analysis** — Gemini multimodal, audio-first, and long-VOD analysis.
3. **Frames & metadata** — exact JPEG frames and normalized YouTube metadata.
4. **Runtime & compatibility** — capability probing and legacy job workflows.

---

## Edutube lesson extraction

### `start_edutube_extraction`

**The main entry point.** Paste a source and get one structured lesson JSON per video.

- **Input:** `url` (playlist URL / playlist id / video URL / local `.csv` file), `outputDir`, `course` (`conversation` | `phonetics` | `writing`), `maxVideos`, `model` / `chunkModel` / `finalModel`, `analysisPrompt`, `schemaJson`.
- **Returns:** `{ jobId, status: "queued" }` — a background job.
- Writes `lesson-NN.json`, `lessons-all.json`, `summary.json` into `outputDir`.
- Long-video single pass first; automatic 150s windowed fallback with merge & dedupe.
- Resume-safe: already-valid lesson files are skipped (checked against the chosen course).
- Automatic Gemini model rotation on quota errors.

Use it when: you want LMS-ready lessons from a course playlist — see [playlist lessons](edutube-playlist.md), [course presets](course-presets.md), [CSV import](csv-import.md).

### `get_edutube_job_status` / `get_edutube_job_result` / `cancel_edutube_job`

Job controls for `start_edutube_extraction`:

- `get_edutube_job_status` — `{ jobId, status, progress, statusMessage, createdAt, updatedAt }`.
- `get_edutube_job_result` — when `status == "done"`: the run summary (`source`, `course`, `outputDir`, `totals {ok, skipped, failed}`, per-entry results with `strategyUsed` and `contentItems`).
- `cancel_edutube_job` — aborts a queued/running job.

---

## Video analysis

### `analyze_youtube_video`

Multimodal analysis (audio + visuals) of a public YouTube video.

Use it when: the video fits a normal tool call, you want visual + audio understanding, bounded clips (`startOffsetSeconds`/`endOffsetSeconds`), or structured JSON via a custom `responseSchemaJson`.

### `analyze_youtube_video_audio`

Speech-first analysis with transcript-like segments.

Use it when: spoken content matters most (claims, arguments, action items, quotes) and the model must not rely on visual-only evidence.

### `analyze_long_youtube_video`

Long videos and VODs as a **required MCP task**; returns a reusable `sessionId`.

Use it when: the video is too long for a synchronous call and your client supports MCP tasks. Call `get_youtube_analyzer_capabilities` first. Do **not** call from clients with fixed synchronous timeouts (e.g. 120s) — use `start_long_youtube_analysis` instead.

### `continue_long_video_analysis`

Follow-up questions against a cached long-video session (`sessionId`), without re-analyzing the video.

---

## Frames & metadata

### `get_youtube_video_frame`

Exact high-resolution JPEG frame at a timestamp (via `yt-dlp` + `ffmpeg`).

- Returns base64 JPEG in structured content **and** an `image/jpeg` content item.
- Optional Gemini **timestamp refinement**: pass `timestampRefinementPrompt` when `timestampSeconds` is approximate — Gemini inspects a bounded window and returns a refined timestamp; the JPEG bytes still come only from local extraction.

Use it when: you need a visual reference, a thumbnail candidate, or the exact frame for downstream work.

### `get_youtube_video_metadata`

Normalized public metadata (title, channel, duration, publish date) via the YouTube Data API. Requires `YOUTUBE_API_KEY` (yt-dlp fallback covers the extraction pipeline itself).

---

## Runtime & compatibility

### `get_youtube_analyzer_capabilities`

Inspects the local runtime (`yt-dlp`, `ffmpeg`, temp storage) and recommends the long-video strategy (`uploaded_file` vs `url_chunks`). Call before long analysis.

### `start_long_youtube_analysis` / `get_long_youtube_analysis_status` / `get_long_youtube_analysis_result` / `cancel_long_youtube_analysis`

Compatibility background-job workflow for clients that cannot run MCP tasks but can poll. Same analysis engine as `analyze_long_youtube_video`, wrapped in job handles.

---

## Choosing the right tool

| Goal | Tool |
|---|---|
| Course playlist → lesson JSON files | `start_edutube_extraction` (+ job controls) |
| One short video, visuals + audio | `analyze_youtube_video` |
| One short video, speech only | `analyze_youtube_video_audio` |
| Long VOD, task-capable client | `analyze_long_youtube_video` |
| Long VOD, poll-only client | `start_long_youtube_analysis` (+ job controls) |
| Follow-up on an analyzed VOD | `continue_long_video_analysis` |
| Exact frame at a timestamp | `get_youtube_video_frame` |
| Title/duration/channel | `get_youtube_video_metadata` |
| Check local tooling | `get_youtube_analyzer_capabilities` |
