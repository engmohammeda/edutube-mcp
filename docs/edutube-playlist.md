# Playlist Lessons (Edutube pipeline)

Paste a YouTube playlist URL (or playlist id, or a single video URL) and Edutube extracts one structured lesson JSON per video.

## MCP workflow

1. Call `start_edutube_extraction` with:
   - `url` (required): playlist URL / id / video URL
   - `outputDir` (optional): defaults to `EDUTUBE_OUTPUT_DIR` or `./edutube-output`
   - `course` (optional): `conversation` (default), `phonetics`, `writing`, `grammar`, `vocabulary`, `reading`, `listening`
   - `level` (optional): curriculum level written to `metadata.level` (default 1)
   - `maxVideos` / `startIndex` (optional): playlist window to process
   - `concurrency` (optional): videos extracted in parallel (default 1)
   - `maxAttempts` (optional): extraction attempts per video (default 2)
   - `strict` / `onlyFailed` / `force` / `expectedLessons` (optional): quality gate and run control
   - `model` / `chunkModel` / `finalModel` (optional): preferred Gemini models
   - `analysisPrompt` (optional): replace the built-in LMS prompt with your own schema-driven prompt (pair with nothing else — the built-in schema is used unless you rely on `analyze_*` tools with `responseSchemaJson`).
2. Poll `get_edutube_job_status` with the returned `jobId`.
3. Fetch `get_edutube_job_result` when `status == "done"` — it contains `totals`, per-entry statuses and `outputDir`.
4. Cancel any time with `cancel_edutube_job`.

## Quality gate

Each extracted lesson is repaired deterministically (trim, dedupe, quiz-type normalization,
`صحيح/خطأ` wording, `options=null` for written questions, quiz capped at 10) and then validated
against the course policy. A rejected lesson is retried once with corrective feedback listing
the exact failing paths. If it still fails, the best attempt is kept on disk and the entry is
reported `invalid`, so `--only-failed` can re-extract just that video later.

## Output files (in `outputDir`)

- `lesson-01.json … lesson-NN.json` — per-video lesson in the unified schema:
  `metadata {course_id, course_name_ar, level, lesson_no, title}`,
  `lesson_content {dialogue[{speaker,en,ar}], key_expressions[{expression_en,expression_ar,usage_ar}]}`,
  `global_vocabulary[{word,meaning,example_en,example_ar}]`, `lesson_notes[]`, `quiz[]` (10 questions).
- `lessons-all.json` — all lessons sorted by `lesson_no`, ready for direct LMS import.
- `lessons-index.json` — compact catalog (lesson_no, title, file, valid).
- `summary.json` — run report (source, playlistId, totals, validation totals, coverage, entries).
- `curriculum-state.json` — resume state per video (status, attempts, strategy, score).
- `validation-report.json` — per-lesson issues with codes and JSON paths.

## Behavior

- Playlist entries resolve via YouTube Data API when `YOUTUBE_API_KEY` is present, otherwise via `yt-dlp --flat-playlist` (keyless).
- Each video uses the long-video single pass first; on failure or empty dialogue it automatically falls back to 150s windowed extraction with merge/dedupe (Zero-Orphan vocabulary, deduped expressions/notes/quiz, quiz capped at 10).
- Already-valid lesson files are skipped → interrupted runs resume cheaply (the resume check is course-aware).
- Duplicate playlist entries are extracted once and reported as `duplicate`.
- `edutube-mcp validate <dir> --repair` re-checks (and structurally fixes) any output directory afterwards.
- Automatic Gemini model rotation applies on quota errors (see [model-rotation.md](model-rotation.md)).
