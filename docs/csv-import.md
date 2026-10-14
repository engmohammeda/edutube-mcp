# CSV Playlist Import

Instead of a YouTube playlist URL you can feed Edutube a **local CSV file** listing the videos to extract. This is the recommended path for curated course runs: it needs no playlist resolution, works offline for planning, and lets you pin exact `lesson_no` values that override run order.

## Usage

```bash
# CLI
edutube-mcp extract ./my-course.csv --out ./lessons --course writing
```

```jsonc
// MCP (start_edutube_extraction)
{ "url": "./my-course.csv", "outputDir": "./lessons", "course": "writing" }
```

The path must end with `.csv` (and must not be an `http(s)` URL). Rows are processed top-to-bottom; `maxVideos` caps how many are taken.

## Format

```csv
url,title,lesson_no
https://www.youtube.com/watch?v=VIDEO_ID_1,مقدمة الكورس وكتابة موضوع عن تمثال الحرية,1
https://www.youtube.com/watch?v=VIDEO_ID_2,Writing About My Family,2
https://youtu.be/VIDEO_ID_3,,3
```

| Column | Required | Accepted header names | Meaning |
|---|---|---|---|
| 1 — url | yes | `url`, `video_url`, `videoUrl`, `link`, `video`, `id`, `video_id` | video URL or bare 11-char video id |
| 2 — title | no | `title`, `name`, `video_title`, `lesson_title` | lesson title fallback (else the YouTube title is used) |
| 3 — lesson_no | no | `lesson_no`, `lesson`, `no`, `#`, `num`, `number`, `index`, `position`, `order` | exact `metadata.lesson_no` and `lesson-NN.json` number |

Rules:

- **Header row is optional.** If the first row's first cell is not a recognized column name it is treated as data and the column order `url[,title[,lesson_no]]` is assumed.
- Quoted fields (`"Hello, world"`), escaped quotes (`""`), BOM, LF and CRLF are all supported.
- Cells wrapped in markdown links (`[https://…](https://…)`), HTML entities (`&amp;`), or extra comma-fields are tolerated — common in playlist CSV exports. Example of a supported export header: `#,title,videoUrl,videoId,publishedAt,position`.
- `lesson_no` pins both the file name (`lesson-03.json`) and `metadata.lesson_no`. Sparse numbers are fine (`1,2,7` → `lesson-01/02/07.json`). When omitted, positions run 1..N in row order.
- Bad rows (no extractable video id) fail the whole run with a clear error — fix the CSV and rerun.
- Resume works the same as with playlists: existing valid `lesson-NN.json` files are skipped.

## Example files

- [`examples/playlist-template.csv`](../examples/playlist-template.csv) — ready-to-copy template.
- [`courses/english-from-zero-level1/playlist.csv`](../courses/english-from-zero-level1/playlist.csv) — real 25-lesson course import (cleaned) with its [`raw-export`](../courses/english-from-zero-level1/raw-export.md) source preserved.

## Related

- [Course presets](course-presets.md) — what each extracted lesson contains.
- [Validation](validation.md) — check the output batch against the preset contract.
- [Playlist lessons](edutube-playlist.md) — pipeline behavior and output files.
