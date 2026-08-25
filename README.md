# Edutube MCP

**Turn YouTube playlists and videos into structured lessons, analyses, frames and quizzes — with Google Gemini and automatic model rotation.**

MCP stdio server + CLI for AI agents and LMS pipelines. Paste a playlist URL and get back per-lesson JSON: verbatim dialogue with Arabic translations, key expressions, vocabulary, cultural/pronunciation notes, and a 10-question quiz — extracted from the actual audio **and** visuals, not just captions.

```
playlist URL ──▶ Edutube ──▶ lesson-01.json … lesson-NN.json + lessons-all.json
```

## Features

- **Playlist import by URL** — paste any YouTube playlist URL (or playlist id, or a single video URL). Entries resolve via the YouTube Data API when `YOUTUBE_API_KEY` is set, otherwise automatically via `yt-dlp --flat-playlist` (no extra key needed).
- **Structured lesson extraction** — built-in LMS schema (dialogue / key_expressions / global_vocabulary / lesson_notes / quiz) with a custom-schema option for your own format.
- **Long-video pipeline with windowed fallback** — full-video pass first; if that fails (quota, deadlines, very long VODs) it automatically switches to 150-second windowed extraction with merge & dedupe.
- **Automatic model rotation** — every Gemini model has its own free-tier quota pool. On `429 RESOURCE_EXHAUSTED` the same request transparently retries on the next available model. The model catalogue is discovered live from the Gemini API, so new models (e.g. `gemini-3.6-flash`, `gemini-3.7-*`) join the rotation without code changes.
- **Multimodal analysis tools** — `analyze_youtube_video` (audio + visuals), `analyze_youtube_video_audio` (speech-first), exact JPEG frame extraction with `yt-dlp` + `ffmpeg`, metadata via YouTube Data API.
- **Long VODs & sessions** — task-based `analyze_long_youtube_video`, reusable `sessionId` follow-ups, and compatibility background jobs (`start_long_youtube_analysis` → poll → result → cancel).
- **Resume-safe batches** — already-valid lesson files are skipped; interrupted runs continue where they stopped.
- **CLI mode** — `edutube-mcp extract <url>` works without any MCP client.

## Requirements

- Node.js ≥ 20
- A Google Gemini API key (`GEMINI_API_KEY`)
- Optional: `YOUTUBE_API_KEY` (metadata tool + faster playlist import)
- Optional but recommended: `yt-dlp` and `ffmpeg` on PATH (or `YT_DLP_PATH`)

## Quick Start (MCP client)

```json
{
  "mcpServers": {
    "edutube": {
      "command": "npx",
      "args": ["-y", "@engmohammeda/edutube-mcp"],
      "env": {
        "GEMINI_API_KEY": "your_gemini_key_here",
        "YOUTUBE_API_KEY": "optional_youtube_key_here"
      }
    }
  }
}
```

From source:

```bash
git clone https://github.com/engmohammeda/edutube-mcp.git
cd edutube-mcp
npm install && npm run build
cp .env.example .env   # fill GEMINI_API_KEY
npm start              # MCP stdio server
```

## Quick Start (CLI)

```bash
# extract a whole playlist into ./edutube-output
edutube-mcp extract "https://www.youtube.com/playlist?list=PL..." --out ./edutube-output --max 20

# or a single video
edutube-mcp extract "https://www.youtube.com/watch?v=VIDEO_ID" --out ./lessons
```

Stdout is clean JSON (progress goes to stderr), so it pipes straight into scripts and LMS importers.

## Tools (15)

| Tool | Purpose |
|---|---|
| `start_edutube_extraction` | **Paste a playlist/video URL** → background job that writes structured lessons to `outputDir` |
| `get_edutube_job_status` / `get_edutube_job_result` / `cancel_edutube_job` | Poll, fetch, cancel edutube jobs |
| `analyze_youtube_video` | Multimodal analysis (audio + visuals), custom prompts & JSON schemas, clip windows |
| `analyze_youtube_video_audio` | Speech-first analysis with transcript segments |
| `get_youtube_video_frame` | Exact high-res JPEG frame at a timestamp (optional Gemini timestamp refinement) |
| `get_youtube_video_metadata` | Normalized metadata via YouTube Data API |
| `get_youtube_analyzer_capabilities` | Inspect local yt-dlp/ffmpeg/temp support |
| `analyze_long_youtube_video` | Long VODs as an MCP task; returns reusable `sessionId` |
| `continue_long_video_analysis` | Follow-up questions against a cached session |
| `start_long_youtube_analysis` / `get_long_..._status` / `get_long_..._result` / `cancel_long_...` | Compatibility job workflow for clients with fixed timeouts |

## Configuration

| Variable | Purpose |
|---|---|
| `GEMINI_API_KEY` | required |
| `YOUTUBE_API_KEY` | optional (metadata + playlist via Data API) |
| `GEMINI_MODEL` | preferred model (default `gemini-2.5-flash` recommended on free tier) |
| `GEMINI_MODEL_ROTATION` | optional explicit rotation order, comma-separated |
| `EDUTUBE_OUTPUT_DIR` | default lesson output directory |
| `YT_DLP_PATH` | explicit yt-dlp executable |

## Client Integrations

**Claude Code**

```bash
claude mcp add edutube --transport stdio -- node /path/to/edutube-mcp/dist/index.js
```

**Cursor** (`~/.cursor/mcp.json`)

```json
{
  "mcpServers": {
    "edutube": {
      "command": "node",
      "args": ["/path/to/edutube-mcp/dist/index.js"],
      "env": { "GEMINI_API_KEY": "..." }
    }
  }
}
```

**Codex** (`~/.codex/config.toml`)

```toml
[mcp_servers.edutube]
command = "node"
args = ["/path/to/edutube-mcp/dist/index.js"]
env = { GEMINI_API_KEY = "..." }
```

## Documentation

- [Installation](docs/installation.md)
- [Configuration](docs/configuration.md)
- [Tools](docs/tools.md)
- [Playlist lessons (Edutube pipeline)](docs/edutube-playlist.md)
- [Model rotation](docs/model-rotation.md)
- [CLI](docs/cli.md)
- [Long videos](docs/long-videos.md)
- [Changelog](CHANGELOG.md)

## Privacy & Limits

Media, URLs and prompts are sent to Google Gemini. Free-tier keys have small per-model daily quotas (~20 requests/day/model); automatic rotation spreads work across all models on your key. For production batches use a paid (pay-as-you-go) key. Private, age-restricted, DRM or region-blocked videos may fail. You are responsible for complying with YouTube and Gemini terms.

## License

MIT — see [LICENSE](LICENSE).

---

## العربية

**Edutube MCP** — حوِّل قوائم تشغيل وفيديوهات يوتيوب إلى دروس مهيكلة جاهزة للاستيراد في LMS: حوار كامل مع الترجمة العربية، التعبيرات المفتاحية، المفردات مع أمثلة إلزامية، ملاحظات ثقافية/نطق بالعربية، واختبار من 10 أسئلة بأنواع متعددة — مستخرج من الصوت **والصورة** فعليًا وليس من الترجمة النصية فقط.

أبرز الميزات:
- **استيراد قائمة تشغيل بلصق الرابط فقط** عبر أداة `start_edutube_extraction` (أو أمر CLI ‏`edutube-mcp extract`)، مع استئناف تلقائي يتخطى الدروس المكتملة.
- **تدوير تلقائي بين نماذج Gemini**: عند استنفاد حصة أي نموذج (429) يُعاد الطلب على النموذج التالي تلقائيًا، مع اكتشاف ديناميكي لأي نماذج جديدة متاحة لمفتاحك.
- مسار فيديو طويل + بديل نوافذ 150 ثانية عند الفشل، ودمج وإزالة تكرار.
- 15 أداة MCP تشمل التحليل متعدد الوسائط، استخراج إطارات JPEG دقيقة، البيانات الوصفية، والوظائف الخلفية للعملاء ذات المهل الثابتة.

التشغيل السريع: انسخ `.env.example` إلى `.env` وضع `GEMINI_API_KEY`، ثم `npm install && npm run build && npm start`، أو استخدم الـCLI مباشرة. راجع التوثيق أعلاه للتفاصيل والربط مع Claude Code وCursor وCodex.
