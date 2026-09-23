# agent-tests

Quick, dependency-free sanity scripts for ad-hoc checks by agents.

> **The authoritative validator is the TypeScript pipeline**, not these scripts:
> `packages/video-analysis-core/src/youtube-core/lesson-validation.ts`, exposed through
>
> ```bash
> edutube-mcp validate <dir> [--course NAME] [--strict] [--repair]
> ```
>
> or the MCP tool `validate_edutube_lessons`. It covers all 7 courses, produces stable issue
> codes and writes `validation-report.json`. The Python scripts below only cover `phonetics`
> and `writing`, and they hard-code `level = 1`.

| Script | Use |
|---|---|
| `validate_phonetics.py [dir]` | fast check of `lesson-*.json` in a phonetics output directory |
| `validate_writing.py [dir]` | fast check of `lesson-*.json` in a writing output directory |

Prefer the CLI: it applies the same rules the extractor enforces, can repair files in place,
and reports curriculum coverage.
