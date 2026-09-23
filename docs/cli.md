# CLI

The published binary is `edutube-mcp` (from source: `node bin/edutube-mcp.js`).

```bash
edutube-mcp                        # start the MCP stdio server
edutube-mcp setup                  # interactive config → ~/.config/edutube-mcp/config.json
edutube-mcp courses                # list the supported course presets (JSON)
edutube-mcp extract <url> [flags]  # extract structured lessons
edutube-mcp validate <dir> [flags] # run the quality gate over extracted lessons
edutube-mcp curriculum [dir]       # course catalog + curriculum coverage report
edutube-mcp --help
```

Stdout is always clean JSON; progress and logs go to stderr, so piping is safe.

Exit codes: `0` success · `2` invalid or failed lessons are present · `1` runtime error.
They are designed for CI use (`validate` fails a build when a lesson is defective).

## `extract`

| Flag | Meaning |
|---|---|
| `<url>` | playlist URL, playlist id, or video URL |
| `--out DIR` | output directory (default `EDUTUBE_OUTPUT_DIR` or `./edutube-output`) |
| `--course NAME` | `conversation` \| `phonetics` \| `writing` \| `grammar` \| `vocabulary` \| `reading` \| `listening` |
| `--level N` | curriculum level written to `metadata.level` (default 1) |
| `--max N` | cap playlist videos (default 50) |
| `--start-index N` | 1-based playlist position to start from |
| `--model M` | preferred Gemini model (rotation still applies on quota errors) |
| `--concurrency N` | videos extracted in parallel (default 1, safest for free-tier quota) |
| `--attempts N` | extraction attempts per video before it is reported `invalid` (default 2) |
| `--strict` | treat quality warnings as errors |
| `--only-failed` | re-extract only videos marked `failed`/`invalid` in `curriculum-state.json` |
| `--force` | ignore cached lessons and re-extract everything |
| `--expected N` | expected lesson count, used by the coverage report |
| `--manifest FILE` | curriculum manifest (`curriculum_id` + `courses[]` with playlist URLs) |

```bash
edutube-mcp extract "https://www.youtube.com/playlist?list=PL..." \
  --out ./out/phonetics-l1 --course phonetics --level 1 --expected 14 | jq .totals
```

Every lesson goes through `repair → validate → retry with corrective feedback` before it is
written. Compliant lessons are cached, so re-running the same command resumes cheaply.

### Output files

| File | Purpose |
|---|---|
| `lesson-NN.json` | one lesson per video, in the unified LMS schema |
| `lessons-all.json` | all lessons sorted by `lesson_no` — ready for direct LMS import |
| `lessons-index.json` | compact catalog (lesson_no, title, file, valid) |
| `summary.json` | run report: totals, validation totals, coverage, per-entry status |
| `curriculum-state.json` | resume state: per-video status, attempts, strategy, score |
| `validation-report.json` | per-lesson issues with codes and paths |

## `validate`

Runs the quality gate over an output directory without re-extracting anything.

| Flag | Meaning |
|---|---|
| `<dir>` | directory containing `lesson-NN.json` (default `EDUTUBE_OUTPUT_DIR`) |
| `--course NAME` | course used for lessons whose `metadata.course_id` is missing |
| `--strict` | treat warnings as errors |
| `--repair` | rewrite files after deterministic cleanup (trim, dedupe, true/false normalization, quiz cap) |

```bash
edutube-mcp validate ./out/phonetics-l1 --course phonetics --repair
```

`--repair` never invents content: it fixes structure (whitespace, duplicates, quiz type
aliases, `صحيح/خطأ` wording, `options=null` for written questions). A question that cannot be
normalized losslessly — e.g. a `true_false` question whose options are `بسيط/مركب` — is left
untouched and reported as `quiz.true_false_not_boolean` so it can be re-extracted.

## `curriculum`

Prints the course catalog and the coverage report (extracted / valid / missing lesson numbers /
completion %) for one output directory, optionally against a whole-curriculum manifest.

```bash
edutube-mcp curriculum ./out --manifest examples/curriculum.zamericanenglish.json
```

## `courses`

Lists every course preset with its content keys and quiz policy — the same registry the
extractor and the validator use, so the CLI can never drift from the pipeline.

## `setup`

Interactive config saved to `~/.config/edutube-mcp/config.json`
(`%APPDATA%\edutube-mcp\config.json` on Windows). Stored keys: `GEMINI_API_KEY`,
`GEMINI_API_KEYS`, `YOUTUBE_API_KEY`, `GEMINI_MODEL`, `GEMINI_MODEL_ROTATION`,
`EDUTUBE_OUTPUT_DIR`, `YT_DLP_PATH`, `MCP_LOG_LEVEL`. Environment variables always win.
