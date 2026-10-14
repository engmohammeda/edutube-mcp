# Validation

Edutube ships a **strict lesson validator** that checks every extracted lesson against its course preset contract — metadata, Arabic translations, zero-orphan vocabulary, and the exact quiz shape. Use it before importing lessons into an LMS or publishing a course batch.

## One command

```bash
edutube-mcp validate <dir> [--course conversation|phonetics|writing]
```

```bash
# examples
edutube-mcp validate ./lessons --course phonetics
edutube-mcp validate ./writing-output --course writing
```

- Reads every `lesson-*.json` in `<dir>` (natural numeric order).
- Checks `metadata.lesson_no` against the file number (`lesson-03.json` → must be `3`).
- Prints a JSON report (`{ dir, course, total, ok, failed, reports: [{ file, ok, problems }] }`) and exits non-zero when anything fails — CI-friendly.

```jsonc
// excerpt of the report
{
  "dir": "./lessons", "course": "writing", "total": 12, "ok": 12, "failed": 0,
  "reports": [ { "file": "lesson-01.json", "ok": true, "problems": [] } ]
}
```

## What is checked

### Shared (every preset)

- `metadata`: `course_id` and `course_name_ar` match the preset, `level` ≥ 1, `lesson_no` ≥ 1 (and equals the file number), `title` non-empty.
- `global_vocabulary`: **zero orphans** — `word`, `meaning`, `example_en`, `example_ar` all non-empty.
- `lesson_notes`: non-empty strings containing Arabic.
- `quiz`: **exactly 10 questions**; every question has `question`, `answer`, Arabic `explanation_ar`; `multiple_choice` and `audio_quiz` need exactly 4 options with `answer` among them; `written` needs `options: null`; `true_false` is `options: null` **or** a 2-option pair containing the answer; `audio_quiz` must set `word_to_speak`.

### Preset-specific

| Preset | `lesson_content` rules | Quiz mix rules |
|---|---|---|
| `conversation` | non-empty `dialogue` (`speaker`, `en`, Arabic `ar` per line) + `key_expressions` (Arabic `expression_ar`/`usage_ar`) | ≥1 `multiple_choice`, ≥1 `true_false`, ≥1 `written` |
| `phonetics` | `focus_sounds` (Arabic `description`), `minimal_pairs`, `practice_scripts` — at least one non-empty | ≥5 `audio_quiz`, 2–4 `true_false` |
| `writing` | `topic_en` + Arabic `topic_ar`; non-empty `brainstorming_questions`; non-empty `guided_sentences` (Arabic `ar`); `final_draft` with `en` + Arabic `ar` | ≥1 `written`, ≥1 `multiple_choice`, ≥1 `true_false` |

## Programmatic API

The validator is part of `@engmohammeda/edutube-core`:

```ts
import { validateLesson, validateLessons, hasArabic } from "@engmohammeda/edutube-core";

const problems = validateLesson(lessonJson, { course: "phonetics", expectLessonNo: 7 });
// → [] when compliant, otherwise a list of precise issue strings

const reports = validateLessons(items, { course: "writing" });
```

Two tiers, two purposes:

| Check | Purpose | Strictness |
|---|---|---|
| `lessonLooksValid` (internal) | resume: "can this cached file skip re-extraction?" | loose — non-empty core content + ≥5 quiz |
| `validateLesson` | QA: "does this lesson fully comply?" | strict — every rule above |

## Legacy Python validators

The original standalone validators still work and are useful in Python-only environments:

```bash
python3 agent-tests/validate_phonetics.py /path/to/phonetics-output
python3 agent-tests/validate_writing.py /path/to/writing-output
```

Prefer `edutube-mcp validate` for new pipelines: it covers all three presets, reports every problem per file, and matches the extraction prompts exactly.

## Related

- [Course presets](course-presets.md) — the full field/quiz contract per preset.
- [CLI](cli.md) — `extract` and `validate` command reference.
