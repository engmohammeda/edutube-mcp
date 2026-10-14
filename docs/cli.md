# CLI

The published binary is `edutube-mcp` (from source: `node bin/edutube-mcp.js`).

```bash
edutube-mcp                          # start the MCP stdio server
edutube-mcp setup                    # interactive config saved to ~/.edutube-mcp/config.json
edutube-mcp extract <src> [flags]    # extract structured lessons (no MCP client needed)
edutube-mcp validate <dir> [flags]   # strict preset-compliance validation
edutube-mcp --help                   # usage
```

## `extract`

Extract structured lessons from a playlist URL, a single video URL, or a local CSV playlist file.

| Flag | Meaning |
|---|---|
| `<src>` | playlist URL / playlist id / video URL / `playlist.csv` (see [CSV import](csv-import.md)) |
| `--out DIR` | output directory (default `EDUTUBE_OUTPUT_DIR` or `./edutube-output`) |
| `--max N` | cap playlist videos (default 50) |
| `--model M` | preferred Gemini model (rotation still applies) |
| `--course NAME` | `conversation` (default) \| `phonetics` \| `writing` — see [course presets](course-presets.md) |
| `--prompt-file FILE` | custom extraction prompt loaded from a text file (keeps the preset schema) |
| `--schema-file FILE` | custom JSON schema file that replaces the preset schema entirely |

```bash
# whole playlist as writing lessons
edutube-mcp extract "https://www.youtube.com/playlist?list=PL..." --out ./writing-lessons --course writing

# curated CSV with pinned lesson numbers, custom prompt
edutube-mcp extract ./my-course.csv --out ./lessons --course phonetics --prompt-file ./my-prompt.txt

# pipe the report; progress goes to stderr
edutube-mcp extract "https://www.youtube.com/watch?v=VIDEO_ID" --out ./lessons | jq .totals
```

Stdout prints a single JSON report (`outputDir`, `source`, `playlistId`, `course`, `totals`, `entries`); progress lines go to stderr, so piping is safe. Re-running the same command **resumes**: valid `lesson-NN.json` files are skipped (checked against the chosen course).

## `validate`

Strict preset-compliance validation of an extracted batch — see [validation](validation.md) for the full rule set.

| Flag | Meaning |
|---|---|
| `<dir>` | directory containing `lesson-NN.json` files |
| `--course NAME` | preset whose contract to enforce (default `conversation`) |

```bash
edutube-mcp validate ./writing-lessons --course writing | jq '{ok, failed}'
```

Prints a JSON report and exits non-zero when any lesson fails (`metadata.lesson_no` is also checked against the file number).
