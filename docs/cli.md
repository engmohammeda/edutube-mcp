# CLI

The published binary is `edutube-mcp` (from source: `node bin/edutube-mcp.js`).

```bash
edutube-mcp                     # start the MCP stdio server
edutube-mcp setup               # interactive config saved to ~/.edutube-mcp/config.json
edutube-mcp extract <url> [flags]
```

## `extract`

Extract structured lessons from a playlist or a single video without an MCP client.

| Flag | Meaning |
|---|---|
| `<url>` | playlist URL, playlist id, or video URL |
| `--out DIR` | output directory (default `EDUTUBE_OUTPUT_DIR` or `./edutube-output`) |
| `--max N` | cap playlist videos (default 50) |
| `--model M` | preferred Gemini model (rotation still applies) |

Stdout prints a single JSON report (`outputDir`, `source`, `playlistId`, `totals`, `entries`); progress lines go to stderr, so piping is safe:

```bash
edutube-mcp extract "https://www.youtube.com/playlist?list=PL..." --out ./lessons | jq .totals
```

Re-running the same command resumes: valid `lesson-NN.json` files are skipped.
