# Playlist Lessons (Edutube pipeline)

Paste a YouTube playlist URL (or playlist id, or a single video URL, or a local CSV file) and Edutube extracts one structured lesson JSON per video.

## MCP workflow

1. Call `start_edutube_extraction` with:
   - `url` (required): playlist URL / id / video URL / local `.csv` file ([CSV format](csv-import.md))
   - `outputDir` (optional): defaults to `EDUTUBE_OUTPUT_DIR` or `./edutube-output`
   - `course` (optional): `conversation` (default) | `phonetics` | `writing` — see [course presets](course-presets.md)
   - `maxVideos` (optional): cap playlist length
   - `model` / `chunkModel` / `finalModel` (optional): preferred Gemini models
   - `analysisPrompt` (optional): replace the built-in preset prompt (schema kept)
   - `schemaJson` (optional): replace the schema entirely (lessons stored as-is)
2. Poll `get_edutube_job_status` with the returned `jobId`.
3. Fetch `get_edutube_job_result` when `status == "done"` — it contains `totals`, per-entry statuses and `outputDir`.
4. Cancel any time with `cancel_edutube_job`.
5. Run `edutube-mcp validate <outputDir> --course <preset>` before publishing — see [validation](validation.md).

## Output files (in `outputDir`)

- `lesson-01.json … lesson-NN.json` — per-video lesson in the preset schema (shared envelope: `metadata`, `lesson_content`, `global_vocabulary`, `lesson_notes`, `quiz` of 10 questions). Full field reference: [course presets](course-presets.md).
- `lessons-all.json` — array of all lessons, ready for direct LMS import.
- `summary.json` — run report (`source`, `playlistId`, `course`, `totals`, `entries` with `strategyUsed` and `contentItems` per lesson).

## Behavior

- Playlist entries resolve via YouTube Data API when `YOUTUBE_API_KEY` is present, otherwise via `yt-dlp --flat-playlist` (keyless). CSV files skip resolution entirely and can pin exact `lesson_no` values.
- Each video uses the long-video single pass first; on failure or empty content it automatically falls back to 150s windowed extraction with merge/dedupe (zero-orphan vocabulary, deduped expressions/notes/quiz, quiz capped at 10).
- Already-valid lesson files are skipped → interrupted runs resume cheaply. Validity is checked **against the chosen course** (a writing lesson without dialogue still resumes).
- Automatic Gemini model rotation applies on quota errors (see [model-rotation.md](model-rotation.md)).
