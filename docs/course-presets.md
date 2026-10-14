# Course Presets

Edutube extracts one structured lesson JSON per video. The **course preset** selects the JSON schema, the default extraction prompt, the quiz mix, and the validation rules. Presets were built around the ZAmericanEnglish (إبراهيم عادل) course style — Arabic teaching commentary + English lesson content — and work for any course taught the same way.

| Preset | `course` | `course_id` | `course_name_ar` | Lesson shape | Quiz style |
|---|---|---|---|---|---|
| Conversation | `conversation` (default) | `conversation` | المحادثة | dialogue + key expressions | mixed |
| Phonetics | `phonetics` | `phonetics` | الصوتيات | focus sounds + minimal pairs + practice scripts | audio-first |
| Writing | `writing` | `writing` | الكتابة | brainstorming + guided sentences + final draft | written-heavy |

Real extracted samples for every preset live in [`examples/`](../examples/):
[`lessons-all.json`](../examples/lessons-all.json) (conversation),
[`phonetics-lessons-all.json`](../examples/phonetics-lessons-all.json),
[`writing-lessons-all.json`](../examples/writing-lessons-all.json).

---

## Shared envelope (all presets)

Every lesson file is one JSON object with five top-level keys:

```json
{
  "metadata": { "course_id": "…", "course_name_ar": "…", "level": 1, "lesson_no": 1, "title": "…" },
  "lesson_content": { "…preset-specific…" },
  "global_vocabulary": [ { "word": "…", "meaning": "…", "example_en": "…", "example_ar": "…" } ],
  "lesson_notes": [ "ملاحظة بالعربية…" ],
  "quiz": [ { "type": "…", "question": "…", "word_to_speak": null, "options": null, "answer": "…", "explanation_ar": "…" } ]
}
```

### `metadata`

| Field | Rule |
|---|---|
| `course_id` | preset id (`conversation` / `phonetics` / `writing`) |
| `course_name_ar` | preset Arabic name (`المحادثة` / `الصوتيات` / `الكتابة`) |
| `level` | positive integer (default `1`) |
| `lesson_no` | positive integer — the lesson position in the course |
| `title` | non-empty; falls back to the YouTube video title |

### `global_vocabulary`

Zero-orphan rule: every entry has `word`, `meaning`, `example_en`, `example_ar` — all non-empty. Only words the teacher explicitly teaches; `example_en` should preferably come from the lesson itself.

### `lesson_notes`

Arabic strings only (cultural notes, pronunciation warnings, grammar rules). Every note must contain Arabic text.

### `quiz`

- **Exactly 10 questions** per lesson (windowed runs collect more and are capped at 10).
- Every question has: `type`, `question`, `answer`, `explanation_ar` (Arabic, non-empty).
- Types:

| `type` | `options` | `word_to_speak` | Notes |
|---|---|---|---|
| `multiple_choice` | exactly 4 strings, `answer` ∈ options | `null` | |
| `true_false` | `null` **or** exactly 2 strings (`["صحيح","خطأ"]`, `["نعم","لا"]`…) with `answer` ∈ options | `null` | |
| `written` | `null` | `null` | translation / reorder / open answer |
| `audio_quiz` | exactly 4 strings, `answer` ∈ options | the word the app synthesizes | phonetics preset |

---

## Conversation (`conversation`)

For dialogue-based courses: everyday conversations with Arabic teaching commentary.

```json
"lesson_content": {
  "dialogue": [ { "speaker": "A", "en": "Hello!", "ar": "مرحباً!" } ],
  "key_expressions": [ { "expression_en": "take care", "expression_ar": "اعتنِ بنفسك", "usage_ar": "تُستخدم عند الوداع" } ]
}
```

| Field | Rule |
|---|---|
| `dialogue` | non-empty; **every spoken line in order** with `speaker`, exact `en`, accurate Arabic `ar` |
| `key_expressions` | phrases/idioms the teacher highlights: `expression_en`, `expression_ar` (Arabic), `usage_ar` (Arabic) |

Quiz mix: at least one `multiple_choice`, one `true_false` and one `written`.

---

## Phonetics (`phonetics`)

For pronunciation courses: mouth physiology, sound contrasts, shadowing.

```json
"lesson_content": {
  "focus_sounds": [ { "symbol": "/p/", "description": "الشفتان تضغطان معاً ثم ينطلق الهواء…" } ],
  "minimal_pairs": [ { "word1": "pack", "word2": "back" } ],
  "practice_scripts": [ "Peter picked a pair of packs." ]
}
```

| Field | Rule |
|---|---|
| `focus_sounds` | sounds taught (`symbol` like `/p/`, Arabic `description` of lips/tongue/air/voicing) |
| `minimal_pairs` | contrasting pairs (`word1`, `word2`), e.g. Pack/Back |
| `practice_scripts` | sentences / tongue twisters for speed-shadowing |

At least one of the three arrays must be non-empty.

Quiz mix: **≥ 5 `audio_quiz`** (question `استمع واختر الكلمة الصحيحة التي سمعتها`, `word_to_speak` set, tricky minimal-pair options) and **2–4 `true_false`** about mouth physiology.

---

## Writing (`writing`)

For composition courses: brainstorm → guided sentences → final draft.

```json
"lesson_content": {
  "topic_en": "The Statue of Liberty",
  "topic_ar": "تمثال الحرية",
  "brainstorming_questions": [ { "question_en": "Where is it?", "suggested_answer_en": "It is in New York." } ],
  "guided_sentences": [ { "en": "It is in New York.", "ar": "إنه في نيويورك." } ],
  "final_draft": { "en": "…full paragraph…", "ar": "…الفقرة الكاملة بالعربية…" }
}
```

| Field | Rule |
|---|---|
| `topic_en` / `topic_ar` | the subject the student learns to write about (Arabic for `topic_ar`) |
| `brainstorming_questions` | teacher's idea questions: `question_en`, `suggested_answer_en` |
| `guided_sentences` | sentences built during the lesson: `en` + Arabic `ar` |
| `final_draft` | the combined paragraph/essay: `en` + Arabic `ar` |

Quiz mix: written-heavy — **≥ 1 `written`** (translate, reorder jumbled sentences), plus at least one `multiple_choice` and one `true_false` covering sentence structure, punctuation, and the final draft's vocabulary.

---

## Custom prompts and schemas

- `analysisPrompt` (MCP) / `--prompt-file` (CLI) replaces the preset prompt **but keeps the preset schema** — use this to steer tone, terminology, or translation rules.
- `schemaJson` (MCP) / `--schema-file` (CLI) replaces the schema **entirely**. With a custom schema:
  - lessons are stored as returned (no metadata normalization),
  - resume checks become generic (non-empty content),
  - `edutube-mcp validate` preset rules do not apply — validate your own shape downstream.

## Related

- [Validation](validation.md) — enforce every rule above in one command.
- [CSV import](csv-import.md) — feed hand-curated playlists with pinned `lesson_no`.
- [Playlist lessons](edutube-playlist.md) — the extraction pipeline and resume behavior.
