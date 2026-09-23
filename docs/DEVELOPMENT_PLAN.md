# وثيقة تطوير مشروع Edutube MCP
### Development Plan — استكمال استخراج منهج «ذا أمريكان إنجلش» بالكامل دون أخطاء

| | |
|---|---|
| **المشروع** | `engmohammeda/edutube-mcp` — حزمة `@engmohammeda/edutube-mcp` + نواة `@engmohammeda/edutube-core` |
| **الإصدار المستهدف** | 0.5.0 |
| **تاريخ الوثيقة** | 2026-09-23 |
| **الفرع** | `arena/01a0ccec-edutube-mcp` |
| **الهدف** | استخراج كامل لمنهج ذا أمريكان إنجلش (ZAmericanEnglish) عبر كل الكورسات والمستويات، بمخرجات مُدقَّقة آليًا وقابلة للاستيراد في LMS دون تدخل يدوي |

---

## 1. الملخص التنفيذي

المشروع اليوم **يُنتج دروسًا جيدة لكن بلا بوابة جودة**: لا يوجد أي كود داخل خط الإنتاج يتحقق من صحة الدرس قبل كتابته على القرص. قواعد الفحص كانت موجودة في سكربتَي Python منفصلَين (`agent-tests/validate_phonetics.py`, `agent-tests/validate_writing.py`) لا يستدعيهما أي مسار في البرمجية، ولا يغطيان كورس المحادثة أصلًا.

نتيجة ذلك ملموسة وقابلة للقياس: عند تشغيل المدقِّق الجديد على الدروس المستخرجة سابقًا والموجودة في `examples/` تبيّن أن **5 من 9 دروس محادثة (55%) ودرسًا واحدًا من 14 في الصوتيات تحتوي أخطاءً تمنع عرضها بشكل صحيح في التطبيق** — تحديدًا أسئلة `true_false` بقيمة `options: null`، وأسئلة خيارات مكررة، وأسئلة موسومة `true_false` بينما خياراتها ليست نعم/لا (`['بسيط','مركب']`).

ما نُفِّذ في هذه الجولة (كله مُختبَر ومُمرَّر):

1. **سجل منهج مركزي** (`curriculum.ts`) — كتالوج 7 كورسات بدل 3، مع سياسة اختبار وقواعد محتوى لكل كورس.
2. **بوابة جودة رسمية** (`lesson-validation.ts`) — مُصلِح حتمي (`repairLesson`) + مدقِّق (`validateLesson`) + تقرير (`createValidationReport`)، بأكثر من 30 قاعدة ورمز خطأ موحّد.
3. **خط إنتاج مُعاد بناؤه** (`edutube-runner.ts`) — إصلاح ← تدقيق ← إعادة محاولة بتغذية تصحيحية، حالة استئناف (`curriculum-state.json`)، تشغيل متوازٍ، كشف التكرار، وتقرير تغطية المنهج.
4. **4 كورسات جديدة** — القواعد، المفردات، القراءة، الاستماع (مخططات JSON + أوامر استخراج مخصصة).
5. **واجهة CLI احترافية** — `extract`, `validate`, `curriculum`, `courses`, `setup` مع أكواد خروج مناسبة لـ CI.
6. **أداتان جديدتان في MCP** — `validate_edutube_lessons` و`get_edutube_curriculum` (العدد الكلي 17 أداة).
7. **اختبارات حقيقية** — 3 حزم اختبار للنواة + حزمتان للخادم؛ المجموع 22 حزمة كلها PASS.

---

## 2. تدقيق الوضع الراهن (أرقام مُتحقَّق منها في هذه الجولة)

### 2.1 حجم المشروع

| المنطقة | الأسطر |
|---|---|
| `packages/video-analysis-core/src` | 9179 |
| `examples/` (دروس مستخرجة) | 9911 |
| `src/` (خادم MCP) | 2958 |
| `docs/` | 587 |
| `bin/` (CLI) | 406 |
| `web/` (موقع GitHub Pages) | 293 |
| `agent-tests/` | 104 |

### 2.2 ما تم استخراجه فعلًا حتى الآن

| الكورس | الدروس | الملف |
|---|---|---|
| المحادثة (`conversation`) | 9 | `examples/lessons-all.json` |
| الصوتيات (`phonetics`) | 14 | `examples/phonetics-lessons-all.json` |
| الكتابة (`writing`) | 12 | `examples/writing-lessons-all.json` |
| **المجموع** | **35** | |

### 2.3 الأخطاء الفعلية في المخرجات السابقة

أُنتج هذا الجدول بتشغيل `node bin/edutube-mcp.js validate` على نفس الملفات (قبل/بعد الإصلاح الآلي):

| الكورس | قبل الإصلاح | بعد `--repair` | الأخطاء المتبقية |
|---|---|---|---|
| المحادثة (9) | **4 صالحة / 5 معيبة** | 9 صالحة / 0 معيبة | لا شيء |
| الصوتيات (14) | 13 صالحة / 1 معيبة | 13 صالحة / 1 معيبة | `lesson-07`: `quiz.true_false_not_boolean` |
| الكتابة (12) | 12 صالحة | 12 صالحة | تحذيران فقط (`quiz.duplicate_options`, `content.below_minimum`) |

أمثلة حقيقية من البيانات:

```jsonc
// examples/lessons-all.json — الدرس 3 (كان يُعتبر "ناجحًا")
{ "type": "true_false", "options": null, "answer": "False" }        // ← لا يوجد خيارات ليعرضها التطبيق
// examples/phonetics-lessons-all.json — الدرس 7
{ "type": "true_false", "options": ["بسيط", "مركب"], "answer": "مركب" }  // ← ليس سؤال صح/خطأ أصلًا
```

### 2.4 عيوب هندسية رُصدت في الكود (وقد عولجت)

| # | العيب | الأثر | المعالجة |
|---|---|---|---|
| 1 | `edutube-runner.ts` كان يستدعي `lessonLooksValid(parsed)` **بدون تمرير الكورس** عند الاستئناف | أي تشغيل استئنافي للصوتيات/الكتابة يعتبر كل الدروس المخزنة غير صالحة ويعيد استخراجها → إهدار كامل للحصة | الفحص الآن يعتمد `validateLesson` مع الكورس والمستوى ورقم الدرس |
| 2 | لا يوجد تحقق بعد الاستخراج؛ `normalizeLesson` يقصّ الاختبار إلى 10 فقط | أخطاء تمر إلى التطبيق مباشرة | بوابة جودة + إعادة محاولة + تقرير |
| 3 | `metadata.level` مثبّت على `1` في `normalizeLesson` | استحالة تمثيل منهج متعدد المستويات | خيار `level` يمر من MCP/CLI إلى الميتاداتا |
| 4 | `SERVER_INFO` = `youtube-analyzer-gemini` إصدار `0.3.0` بينما الحزمة `0.4.0` | هوية خاطئة للخادم أمام عميل MCP | توحيد على `edutube-mcp` + اختبار `server-info` يمنع الانحراف |
| 5 | `docs/tools.md` يذكر "eleven MCP tools" والـREADME "15" بينما العدد الفعلي الآن 17 | توثيق مضلِّل | تحديث التوثيق + جرد الأدوات في الوثيقة |
| 6 | `bin/edutube-mcp.js` يعيد تنفيذ منطق مسار الإعداد (`~/.edutube-mcp`) خلافًا للنواة (`~/.config/edutube-mcp`) | ملفا إعداد مختلفان حسب طريقة التشغيل | CLI يستخدم `getUserConfigPath`/`readUserConfigFile` من النواة |
| 7 | نص المساعدة في CLI يذكر `--course conversation\|phonetics` فقط | الكتابة (و4 كورسات جديدة) غير مكتشفة | مساعدة مولّدة من الكتالوج |
| 8 | الترتيب في `lessons-all.json` يعتمد ترتيب الإدخال | دروس غير مرتبة عند التشغيل المتوازي | ترتيب رقمي صريح حسب `lesson_no` |
| 9 | لا كشف لتكرار الفيديو داخل قائمة التشغيل | استخراج مكرر لنفس الفيديو (ملاحظ في الصوتيات: عنوانين متطابقين) | حالة `duplicate` + `duplicated_titles` في تقرير التغطية |
| 10 | قواعد الفحص مكررة في Python خارج خط الإنتاج | مصدر حقيقة مزدوج | النواة هي المصدر الوحيد؛ السكربتات تبقى للاختبار السريع |

---

## 3. المعمارية بعد التطوير

```
                    ┌──────────────────────────────┐
   playlist URL ───▶│  playlist.ts                 │  YouTube Data API → (fallback) yt-dlp
                    │  + startIndex + maxVideos    │
                    └──────────────┬───────────────┘
                                   ▼
                    ┌──────────────────────────────┐
                    │  curriculum.ts               │  كتالوج 7 كورسات · سياسة الاختبار
                    │  (سجل المنهج + التغطية)       │  · مفارقة manifest المستخدم
                    └──────────────┬───────────────┘
                                   ▼
        ┌──────────────────────────────────────────────────┐
        │  edutube-runner.ts  (تشغيل متوازٍ + استئناف)       │
        │                                                  │
        │   لكل فيديو:                                      │
        │   ┌────────────────────────────────────────┐     │
        │   │ extractLessonFromVideo  (lesson.ts)     │     │
        │   │   1) مسار الفيديو الكامل + مخطط الكورس    │     │
        │   │   2) فشل/حصة ← نوافذ 150 ثانية + دمج     │     │
        │   └───────────────┬────────────────────────┘     │
        │                   ▼                              │
        │   repairLesson ──▶ validateLesson ──┬─ صالح ▶ اكتب lesson-NN.json
        │        (lesson-validation.ts)       │
        │                   ▲                 └─ مرفوض ▶ أعد المحاولة
        │                   └──── buildCorrectivePrompt (تغذية تصحيحية)
        └──────────────────────────┬───────────────────────┘
                                   ▼
   lesson-NN.json · lessons-all.json · lessons-index.json
   summary.json · curriculum-state.json · validation-report.json
```

**مبدأ التصميم:** لا يُكتب أي درس على القرص إلا بعد المرور بالإصلاح الحتمي ثم التدقيق. الدرس المرفوض يُحفظ (للمراجعة) ويُعلَّم `invalid` في الحالة، ويمكن إعادة استخراجه وحده بـ `--only-failed`.

---

## 4. عقد البيانات (Data Contract)

### 4.1 الغلاف الموحّد لكل كورس

```jsonc
{
  "metadata": { "course_id": "...", "course_name_ar": "...", "level": 1, "lesson_no": 1, "title": "..." },
  "lesson_content": { /* يختلف حسب الكورس — الجدول التالي */ },
  "global_vocabulary": [ { "word": "", "meaning": "", "example_en": "", "example_ar": "" } ],
  "lesson_notes": [ "…بالعربية…" ],
  "quiz": [ { "type": "", "question": "", "word_to_speak": null, "options": null, "answer": "", "explanation_ar": "" } ]
}
```

### 4.2 محتوى كل كورس وسياسة الاختبار (من `curriculum.ts`)

| الكورس | الاسم العربي | مفاتيح المحتوى | سياسة الاختبار (10 أسئلة) |
|---|---|---|---|
| `conversation` | المحادثة | `dialogue`, `key_expressions` | 3–6 اختياري · 2–4 صح/خطأ · 1–4 كتابي |
| `phonetics` | الصوتيات | `focus_sounds`, `minimal_pairs`, `practice_scripts` | 5–9 `audio_quiz` · 2–4 صح/خطأ |
| `writing` | الكتابة | `topic_*`, `brainstorming_questions`, `guided_sentences`, `final_draft` | 3–6 كتابي · 2–5 اختياري · 1–4 صح/خطأ |
| `grammar` | القواعد | `topic_*`, `rules`, `structures`, `common_mistakes` | 4–7 اختياري · 2–4 كتابي · 1–3 صح/خطأ |
| `vocabulary` | المفردات | `theme_*`, `target_words`, `collocations` | 3–7 `audio_quiz` · 2–5 اختياري · 1–4 كتابي |
| `reading` | القراءة | `passage_title_*`, `passage_en/ar`, `comprehension_points` | 4–7 اختياري · 2–4 صح/خطأ · 1–3 كتابي |
| `listening` | الاستماع | `audio_topic_*`, `transcript`, `listening_tasks` | 3–7 `audio_quiz` · 2–5 اختياري · 1–3 صح/خطأ |

### 4.3 قواعد بوابة الجودة (رموز الأخطاء)

| الرمز | الخطورة | المعنى |
|---|---|---|
| `content.empty` | خطأ | لا يوجد محتوى مطلوب للكورس |
| `content.item_incomplete` | خطأ | عنصر ينقصه حقل إلزامي |
| `content.below_minimum` | تحذير | عدد العناصر أقل من الحد الأدنى للكورس |
| `lang.arabic_missing` / `notes.not_arabic` | خطأ | حقل `*_ar` ليس بالعربية |
| `vocab.orphan` | خطأ | كلمة بلا معنى أو بلا مثال مترجم |
| `quiz.length` | خطأ | عدد الأسئلة ≠ 10 |
| `quiz.type_mix` | خطأ | نوع مطلوب ناقص أو تنويع أقل من المطلوب |
| `quiz.options_missing` / `quiz.options_invalid` | خطأ | خيارات ناقصة أو ≠ 4 (أو ≠ 2 لصح/خطأ) |
| `quiz.answer_not_in_options` | خطأ | الإجابة ليست ضمن الخيارات |
| `quiz.true_false_not_boolean` | خطأ | سؤال صح/خطأ بخيارات غير نعم/لا |
| `quiz.written_options` | خطأ | سؤال كتابي بخيارات (يجب `null`) |
| `quiz.audio_word_missing` | خطأ | `audio_quiz` بلا `word_to_speak` |
| `quiz.explanation_missing` | خطأ | شرح غير عربي أو مفقود |
| `quiz.duplicate_question` / `quiz.duplicate_options` | تحذير | تكرار |
| `metadata.missing` / `metadata.course_mismatch` / `metadata.lesson_no_mismatch` / `metadata.level_invalid` | خطأ | ميتاداتا ناقصة أو متعارضة |

**الإصلاح الحتمي** (`repairLesson`) لا يخترع محتوى أبدًا: تقليم المسافات، حذف الصفوف الفارغة، إزالة التكرار، توحيد أنواع الأسئلة (`MC`→`multiple_choice`)، توحيد `صحيح/خطأ` (يشمل `صح/صواب/True/نعم` → `صحيح`)، تفريغ `options` في الكتابي و`word_to_speak` في غير الصوتي، وقصّ الاختبار إلى 10. أي سؤال لا يمكن توحيده دون فقدان معنى يُترك كما هو ويُبلَّغ عنه (درس مُستفاد من خطأ حقيقي اكتُشف أثناء التطوير — انظر §7).

---

## 5. سجل المنهج والتغطية

### 5.1 ملف `manifest` (يحرره المستخدم — الروابط لا تُخمَّن برمجيًا)

```jsonc
// examples/curriculum.zamericanenglish.json
{
  "curriculum_id": "zamericanenglish",
  "curriculum_name_ar": "منهج ذا أمريكان إنجلش",
  "courses": [
    { "course_id": "phonetics",    "level": 1, "playlist_url": "https://www.youtube.com/playlist?list=PL…", "expected_lessons": 14 },
    { "course_id": "conversation", "level": 1, "playlist_url": "https://www.youtube.com/playlist?list=PL…", "expected_lessons": 9 },
    { "course_id": "writing",      "level": 1, "playlist_url": "https://www.youtube.com/playlist?list=PL…", "expected_lessons": 12 },
    { "course_id": "grammar",      "level": 1, "playlist_url": "https://www.youtube.com/playlist?list=PL…" },
    { "course_id": "vocabulary",   "level": 1, "playlist_url": "https://www.youtube.com/playlist?list=PL…" },
    { "course_id": "reading",      "level": 1, "playlist_url": "https://www.youtube.com/playlist?list=PL…" },
    { "course_id": "listening",    "level": 2, "playlist_url": "https://www.youtube.com/playlist?list=PL…" }
  ]
}
```

### 5.2 تقرير التغطية

`computeCurriculumCoverage` يحسب لكل (كورس، مستوى): `extracted`, `valid`, `invalid`, **`missing_lesson_nos`** (أرقام الدروس الناقصة)، `duplicated_lesson_nos`, `duplicated_titles`, و`completion`. هذا هو المؤشر الوحيد المعتمد للحكم على "اكتمال المنهج".

مثال مخرَج حقيقي (تشغيل مُختبَر):

```json
{ "course_id": "conversation", "extracted": 9, "valid": 9, "expected_lessons": 9,
  "missing_lesson_nos": [], "completion": 1.0 }
```

---

## 6. خطة التنفيذ على مراحل

### المرحلة 0 — أساس الجودة ✅ **مكتملة ومُختبَرة**
- [x] سجل المنهج + 4 كورسات جديدة (`grammar`, `vocabulary`, `reading`, `listening`)
- [x] بوابة الجودة (إصلاح + تدقيق + تقرير)
- [x] خط إنتاج معاد بناؤه: استئناف صحيح، إعادة محاولة، تشغيل متوازٍ، كشف تكرار
- [x] مخرجات تشغيلية: `curriculum-state.json`, `validation-report.json`, `lessons-index.json`
- [x] CLI: `extract` / `validate` / `curriculum` / `courses`
- [x] MCP: `validate_edutube_lessons`, `get_edutube_curriculum` (+ تمرير `course`, `level`, `concurrency`, `maxAttempts`, `strict`, `onlyFailed`, `force`, `startIndex`, `expectedLessons`)
- [x] 22 حزمة اختبار PASS · بناء نظيف للحزمتين

**معيار القبول (مُحقق):** `npm test` → 22 PASS؛ `edutube-mcp validate` على بيانات حقيقية يكتشف 6 دروس معيبة ويصلح 5 منها آليًا.

### المرحلة 1 — ترميم الرصيد الحالي (لا تحتاج مفاتيح API)
- [ ] تشغيل `edutube-mcp validate <dir> --repair` على كل مجلدات الإخراج الموجودة وإيداع النتائج.
- [ ] إعادة استخراج الدروس المرفوضة فقط: `edutube-mcp extract <playlist> --only-failed --course phonetics`.
- [ ] إيداع `validation-report.json` لكل كورس في `examples/` كدليل جودة.
- **معيار القبول:** `invalid = 0` و`errors = 0` في الكورسات الثلاثة الحالية.

### المرحلة 2 — استكمال المنهج (تحتاج `GEMINI_API_KEY`)
- [ ] تعبئة `examples/curriculum.zamericanenglish.json` بروابط قوائم التشغيل الرسمية + `expected_lessons`.
- [ ] استخراج كل كورس على حدة بمستواه: `--course X --level N --expected M`.
- [ ] إدارة الحصة: `--concurrency 1` + مفاتيح متعددة عبر `GEMINI_API_KEYS` (التدوير موجود ومُختبَر).
- [ ] تشغيل `edutube-mcp curriculum --manifest …` بعد كل دفعة ومراقبة `missing_lesson_nos`.
- **معيار القبول:** `completion = 1.0` لكل كورس/مستوى، و`missing_lesson_nos = []`.

### المرحلة 3 — ضبط الجودة المتقدم
- [ ] فحص تقاطعي: تكرار المفردات بين الدروس، وتقدّم مستوى الصعوبة.
- [ ] عينة تدقيق بشرية (10%) ومقارنتها بالفيديو، مع تسجيل الانحراف في `docs/qa-sampling.md`.
- [ ] ربط `validate` في CI (GitHub Actions) كشرط دمج.

### المرحلة 4 — تجربة الاستخدام
- [ ] تحديث مستكشف الدروس في `web/index.html` ليقرأ `lessons-index.json` بدل البيانات المدمجة.
- [ ] نشر تقارير التغطية على موقع GitHub Pages.

---

## 7. سجل المخاطر والدروس المستفادة

| الخطر | الاحتمال | الأثر | التخفيف |
|---|---|---|---|
| استنفاد حصة Gemini المجانية أثناء دفعة كبيرة | عالٍ | توقف التشغيل | تدوير النماذج/المفاتيح (موجود)، `--concurrency 1`، استئناف من الحالة، `--only-failed` |
| فيديو طويل جدًا يفشل في المسار الكامل | متوسط | درس ناقص | بديل نوافذ 150 ثانية + دمج وإزالة تكرار (موجود ومُختبَر) |
| النموذج يُخرج محتوى مُختلَق بدل المسموع | متوسط | درس غير أمين | قواعد `lang.*` + `content.*` + عينة تدقيق بشرية (المرحلة 3) |
| إصلاح آلي يُتلف سؤالًا غير نمطي | **حدث فعلًا** | فساد بيانات | الاختبار الانحداري `lesson-validation.test.ts` يثبّت أن الخيارات غير النعم/لائية لا تُمَس |
| انحراف إصدار بين الحزمة وهوية الخادم | **حدث فعلًا (0.3.0 vs 0.4.0)** | عميل MCP يرى اسمًا قديمًا | اختبار `server-info` يفشل عند أي انحراف |
| روابط قوائم تشغيل متغيرة/محذوفة | منخفض | فشل الدفعة | `manifest` قابل للتحديث + `startIndex` لاستئناف منتصف القائمة |

---

## 8. دليل التشغيل (Runbook)

```bash
# 0) التجهيز مرة واحدة
npm install && npm run build
node bin/edutube-mcp.js setup            # يحفظ المفاتيح في ~/.config/edutube-mcp/config.json

# 1) استخراج كورس كامل
node bin/edutube-mcp.js extract "https://www.youtube.com/playlist?list=PL…" \
  --out ./out/phonetics-l1 --course phonetics --level 1 --expected 14

# 2) تدقيق + إصلاح آلي
node bin/edutube-mcp.js validate ./out/phonetics-l1 --course phonetics --repair

# 3) إعادة استخراج الفاشل فقط
node bin/edutube-mcp.js extract "https://www.youtube.com/playlist?list=PL…" \
  --out ./out/phonetics-l1 --course phonetics --level 1 --only-failed

# 4) تغطية المنهج
node bin/edutube-mcp.js curriculum ./out --manifest examples/curriculum.zamericanenglish.json

# 5) الفحص الكامل (22 حزمة)
npm test
```

أكواد الخروج: `0` نجاح · `2` وُجدت دروس معيبة/فاشلة · `1` خطأ تشغيلي — مناسبة للربط في CI.

---

## 9. ما تم التحقق منه فعليًا في هذه البيئة

| الفحص | الأمر | النتيجة |
|---|---|---|
| بناء الحزمتين | `npm run build` | نجح بلا أخطاء TypeScript |
| حزم اختبار النواة | `npx tsx packages/video-analysis-core/src/test/index.ts` | 10/10 PASS (تشمل `lesson-validation`, `curriculum`, `edutube-runner`) |
| حزم اختبار الخادم | `npm test` | 22/22 PASS (تشمل `edutube-tools` و`server-info`) |
| المدقِّق على بيانات حقيقية | `edutube-mcp validate examples/… ` | 9+14+12 درسًا؛ اكتُشفت 6 دروس معيبة؛ `--repair` أصلح 5 وبقي 1 يحتاج إعادة استخراج |
| CLI | `--help`, `courses`, `validate`, `curriculum` | تعمل وتُخرج JSON نظيفًا على stdout |
| عدد أدوات MCP | اختبار `edutube-tools` | 17 أداة مُسجَّلة |

## 10. ما لا يمكن التحقق منه هنا (بصراحة)

- **لا يوجد `GEMINI_API_KEY`** في هذه البيئة (`env | grep GEMINI_API_KEY` → لا شيء)، لذلك **لم يُنفَّذ استخراج حي من يوتيوب**؛ مسار الاستخراج مُختبَر بحقن بديل (`extractLesson` / `resolveEntries`) وليس بنداء حقيقي للنموذج.
- **`yt-dlp` و`ffmpeg` غير مثبتين** هنا، فلم يُختبر تنزيل الوسائط أو مسار النوافذ على فيديو فعلي.
- **روابط قوائم تشغيل المنهج لم تُتحقَّق**؛ لهذا صُمم `manifest` ليحرره المستخدم بدل تخمين المعرفات.
- الاختبار الحي الأول يجب أن يكون صغيرًا: `--max 2 --course phonetics` ثم `validate` قبل أي دفعة كاملة.

---

## 11. معايير "الاحترافية" المعتمدة في هذا المشروع

1. **مصدر حقيقة واحد** — الكتالوج في `curriculum.ts` يخدم الاستخراج والتدقيق والتغطية والـCLI معًا.
2. **لا صمت عند الفشل** — كل رفض يُسجَّل برمز وموقع ومسار (`quiz[4].options`) في `validation-report.json`.
3. **إمكانية الاستئناف** — الحالة على القرص، والاستئناف يفهم الكورس والمستوى ولا يهدر الحصة.
4. **قابلية الاختبار** — حقن التبعيات في خط الإنتاج، فكل المنطق مُختبَر بلا شبكة ولا مفاتيح.
5. **عدم تلف البيانات** — الإصلاح حتمي ومحافظ ومُغطّى باختبار انحداري.
6. **توثيق مطابق للواقع** — أرقام هذه الوثيقة كلها من أوامر نُفِّذت على المستودع.
