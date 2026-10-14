# Edutube Studio (Web GUI)

**Edutube Studio** is the official web interface for the extraction pipeline: start lesson-extraction jobs from a playlist/video URL or CSV, watch live progress, browse extracted lessons with a course-aware viewer, and run strict preset validation — all without an MCP client.

## Start

```bash
npm run build   # once
npm run gui     # → http://localhost:4173
```

Options (environment):

| Variable | Default | Meaning |
|---|---|---|
| `EDUTUBE_GUI_PORT` | `4173` | HTTP port |
| `EDUTUBE_GUI_HOST` | `0.0.0.0` | bind address (0.0.0.0 for remote access) |

The studio reuses the same config as the CLI/MCP server (`~/.edutube-mcp/config.json`, `.env`), so keys saved via the **Settings** tab apply everywhere.

## Screens

### 🚀 Extract

- **Source**: playlist URL / playlist id / single video URL / local `.csv` ([CSV format](csv-import.md)).
- **Course preset** cards: `conversation` (المحادثة) · `phonetics` (الصوتيات) · `writing` (الكتابة) — see [course presets](course-presets.md).
- Output directory, max videos, and advanced options: preferred model, custom extraction prompt, custom JSON schema.
- Live job panel: progress bar, status chip, and a terminal-style activity log with per-lesson updates. Cancel any running job with one click.

### 📚 Lessons

Browse `lesson-NN.json` files from any output directory. The viewer is **course-aware**:

- conversation → dialogue lines + key expressions
- phonetics → focus sounds + minimal pairs + practice scripts
- writing → topic + brainstorming + guided sentences + final draft

plus shared sections (vocabulary, teacher notes, quiz) and a raw-JSON toggle.

### ✅ Validate

Runs the [strict validator](validation.md) over a directory and shows a summary (passing / need review / total) with the exact problem list per file — the same rules `edutube-mcp validate` enforces.

### ⚙️ Settings

- **Keys**: `GEMINI_API_KEY` (required), `YOUTUBE_API_KEY` (optional) — saved to `~/.edutube-mcp/config.json`, never displayed again.
- **Runtime**: `GEMINI_MODEL`, `EDUTUBE_OUTPUT_DIR`, `YT_DLP_PATH`.

## API (for scripting)

The studio exposes a small JSON API under `/api/`:

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | runtime status (keys, yt-dlp, ffmpeg) |
| GET/PUT | `/api/config` | read/update settings |
| POST | `/api/jobs` | start extraction `{url, course, outputDir, maxVideos, model, analysisPrompt, schemaJson}` |
| GET | `/api/jobs`, `/api/jobs/:id` | list / poll jobs (status, progress, log, entries) |
| POST | `/api/jobs/:id/cancel` | cancel a job |
| GET | `/api/lessons?dir=` · `/api/lesson?dir=&file=` | browse / read lessons |
| POST | `/api/validate` | `{dir, course}` → validation report |
| GET | `/api/course-files?dir=` | read a course package (`prompt.txt`, `schema.json`, `playlist.csv`) |
| GET | `/api/runtime-key` | stored Gemini key for the browser runner |
| POST | `/api/save-lesson` | `{dir, file, lesson}` → persist one lesson JSON |
| POST | `/api/save-aggregate` | `{dir, course, source}` → rebuild `lessons-all.json` + `summary.json` |

## Browser-side extraction (no yt-dlp / ffmpeg)

The **🌐 الاستخراج المباشر عبر المتصفح** card in the Extract tab calls the Gemini API
directly from your browser (`generativelanguage.googleapis.com`) with YouTube URLs as
`file_data` — Gemini fetches the video server-side, so no local download tools are needed.

1. Fill **مجلد حزمة الكورس** (a package like `courses/english-from-zero-level1` containing
   `prompt.txt` + `schema.json` + `playlist.csv`) and click **تحميل الحزمة**.
2. Click **🚀 ابدأ الاستخراج عبر المتصفح**. Each lesson is extracted with the package's
   custom prompt and schema, saved under `<package>/lessons/lesson-NN.json`, and listed
   in the Browse tab immediately. Completed files are skipped on re-runs (resume).
3. Lesson metadata is pinned from the CSV (`lesson_no`, `title`) plus the fixed
   `course` / `level` hint appended to the prompt.

Notes: the stored `GEMINI_API_KEY` is sent to Google from your browser for these calls
(see [Configuration](configuration.md)); quota limits follow your Gemini plan — 429s wait
and retry automatically. On a locked-down network, if the browser also cannot reach
`generativelanguage.googleapis.com`, use the CLI/GUI server path or GitHub Actions instead.

## Notes

- The studio runs the exact same pipeline as the MCP tool and CLI: long-video pass → 150s windowed fallback, resume-safe skipping, automatic model rotation.
- Requires Node.js ≥ 20; `yt-dlp` + `ffmpeg` are recommended (bigger videos, frames).
- Media, URLs and prompts are sent to Google Gemini — same privacy terms as the rest of the project.

## Running extraction on GitHub Actions

When your local machine lacks the tools or you prefer CI execution, `ci/extract-lessons.yml` is a ready-to-activate workflow template: copy it to `.github/workflows/extract-lessons.yml`, set the `GEMINI_API_KEY` repository secret, then trigger it from the Actions tab (or `gh workflow run`) with a CSV path / playlist URL and course preset. The extracted lessons and the validation report arrive as a downloadable artifact.
