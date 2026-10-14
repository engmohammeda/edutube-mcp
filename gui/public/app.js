/* Edutube Studio — frontend app (zero-dependency, bilingual AR/EN) */
(function () {
  "use strict";

  /* ------------------------------ i18n ------------------------------ */
  var I18N = {
    ar: {
      tagline: "منصة استخراج الدروس", checking: "فحص…",
      api_ok: "المفاتيح جاهزة", api_missing: "مفتاح Gemini غير مضبوط",
      hero_h: "حوِّل قوائم يوتيوب إلى <span class='grad'>دروس JSON منظمة</span>",
      hero_p: "استخرج دروس الكورسات بصيغة LMS جاهزة: حوار بالترجمة العربية، تعبيرات مفتاحية، مفردات، ملاحظات، واختبار من 10 أسئلة — مع تحقق صارم من الجودة، واستئناف تلقائي، وتدوير بين نماذج Gemini.",
      tab_extract: "🚀 الاستخراج", tab_lessons: "📚 الدروس", tab_validate: "✅ التحقق", tab_settings: "⚙️ الإعدادات",
      ex_h: "مهمة استخراج جديدة", ex_sub: "الصق رابط قائمة تشغيل أو فيديو، أو مسار ملف CSV، ثم اختر قاعدة الكورس.",
      ex_src: "المصدر", ex_src_hint: "يدعم: رابط قائمة تشغيل، معرف قائمة، رابط فيديو واحد، أو ملف CSV محلي.",
      ex_course: "قاعدة الكورس",
      p_conv_t: "المحادثة", p_conv_d: "حوار كامل + تعبيرات مفتاحية + مفردات + اختبار متنوع.",
      p_phon_t: "الصوتيات", p_phon_d: "أصوات مستهدفة + أزواج أدنى + تمارين نطق + اختبار صوتي.",
      p_wr_t: "الكتابة", p_wr_d: "عصف ذهني + جمل موجهة + مسودة نهائية + اختبار كتابي.",
      ex_out: "مجلد الإخراج", ex_max: "أقصى عدد فيديوهات", ex_adv: "خيارات متقدمة (نموذج، برومبت مخصص، مخطط مخصص)",
      ex_model: "نموذج Gemini", ex_prompt: "برومبت استخراج مخصص (اختياري)", ex_schema: "مخطط JSON مخصص (اختياري)",
      ex_start: "🚀 ابدأ الاستخراج", ex_cancel: "إلغاء",
      ex_nokey: "⚠️ مفتاح GEMINI_API_KEY غير مضبوط — أضفه من تبويب الإعدادات قبل التشغيل.",
      job_h: "حالة المهمة", job_idle: "بانتظار البدء", job_log: "سجل النشاط",
      job_running: "قيد التنفيذ", job_done: "اكتملت", job_error: "فشلت", job_cancelled: "أُلغيت",
      ls_dir: "مجلد الدروس", ls_load: "📚 تحميل الدروس", ls_list: "قائمة الدروس", ls_view: "عارض الدرس",
      ls_empty: "لا توجد دروس بعد.", ls_pick: "اختر درساً من القائمة لعرض محتواه.",
      val_h: "التحقق الصارم من الدروس", val_sub: "يفحص كل درس مقابل عقد القاعدة: البيانات الوصفية، الترجمات العربية، المفردات، وشكل الاختبار.",
      val_dir: "مجلد الدروس", val_course: "قاعدة الكورس", val_run: "✅ تشغيل التحقق",
      set_h: "المفاتيح والاتصال", set_sub: "تُحفظ في ملف الإعدادات المحلي ولا تُعرض بعد الحفظ.",
      set_save: "💾 حفظ المفاتيح", set_h2: "إعدادات التشغيل", set_save2: "💾 حفظ الإعدادات",
      saved: "تم الحفظ ✅", job_started: "بدأت المهمة 🚀", need_url: "أدخل رابط المصدر أولاً",
      need_dir: "أدخل مسار المجلد أولاً", no_lessons: "لم يُعثر على ملفات دروس في هذا المجلد",
      quiz: "أسئلة", vocab: "مفردات", notes: "ملاحظات",
      sec_dialogue: "الحوار", sec_expr: "التعبيرات المفتاحية", sec_sounds: "الأصوات المستهدفة",
      sec_pairs: "الأزواج الأدنى", sec_scripts: "تمارين النطق", sec_topic: "الموضوع",
      sec_brain: "العصف الذهني", sec_guided: "الجمل الموجهة", sec_draft: "المسودة النهائية",
      sec_vocab: "المفردات", sec_notes: "ملاحظات المعلم", sec_quiz: "الاختبار",
      q_question: "السؤال", q_answer: "الإجابة", q_explain: "الشرح",
      reports_pass: "مطابق", reports_fail: "يحتاج مراجعة", reports_total: "إجمالي",
      view_json: "عرض JSON الخام"
    },
    en: {
      tagline: "Lesson extraction studio", checking: "checking…",
      api_ok: "keys ready", api_missing: "Gemini key missing",
      hero_h: "Turn YouTube playlists into <span class='grad'>structured lesson JSON</span>",
      hero_p: "Extract LMS-ready course lessons: dialogue with Arabic translations, key expressions, vocabulary, notes, and a 10-question quiz — with strict quality validation, resume-safe batches, and automatic Gemini model rotation.",
      tab_extract: "🚀 Extract", tab_lessons: "📚 Lessons", tab_validate: "✅ Validate", tab_settings: "⚙️ Settings",
      ex_h: "New extraction job", ex_sub: "Paste a playlist or video URL (or a CSV path), then pick the course preset.",
      ex_src: "Source", ex_src_hint: "Supports: playlist URL, playlist id, single video URL, or a local CSV file.",
      ex_course: "Course preset",
      p_conv_t: "Conversation", p_conv_d: "Full dialogue + key expressions + vocabulary + mixed quiz.",
      p_phon_t: "Phonetics", p_phon_d: "Focus sounds + minimal pairs + practice scripts + audio quiz.",
      p_wr_t: "Writing", p_wr_d: "Brainstorming + guided sentences + final draft + written quiz.",
      ex_out: "Output directory", ex_max: "Max videos", ex_adv: "Advanced (model, custom prompt, custom schema)",
      ex_model: "Gemini model", ex_prompt: "Custom extraction prompt (optional)", ex_schema: "Custom JSON schema (optional)",
      ex_start: "🚀 Start extraction", ex_cancel: "Cancel",
      ex_nokey: "⚠️ GEMINI_API_KEY is not set — add it in Settings before running.",
      job_h: "Job status", job_idle: "waiting", job_log: "Activity log",
      job_running: "running", job_done: "done", job_error: "failed", job_cancelled: "cancelled",
      ls_dir: "Lessons directory", ls_load: "📚 Load lessons", ls_list: "Lesson list", ls_view: "Lesson viewer",
      ls_empty: "No lessons yet.", ls_pick: "Pick a lesson to view its content.",
      val_h: "Strict lesson validation", val_sub: "Checks every lesson against the preset contract: metadata, Arabic translations, vocabulary, and quiz shape.",
      val_dir: "Lessons directory", val_course: "Course preset", val_run: "✅ Run validation",
      set_h: "Keys & connectivity", set_sub: "Stored in the local config file and never displayed after saving.",
      set_save: "💾 Save keys", set_h2: "Runtime settings", set_save2: "💾 Save settings",
      saved: "Saved ✅", job_started: "Job started 🚀", need_url: "Enter a source URL first",
      need_dir: "Enter a directory path first", no_lessons: "No lesson files found in this directory",
      quiz: "questions", vocab: "words", notes: "notes",
      sec_dialogue: "Dialogue", sec_expr: "Key expressions", sec_sounds: "Focus sounds",
      sec_pairs: "Minimal pairs", sec_scripts: "Practice scripts", sec_topic: "Topic",
      sec_brain: "Brainstorming", sec_guided: "Guided sentences", sec_draft: "Final draft",
      sec_vocab: "Vocabulary", sec_notes: "Teacher notes", sec_quiz: "Quiz",
      q_question: "Q", q_answer: "Answer", q_explain: "Why",
      reports_pass: "passing", reports_fail: "need review", reports_total: "total",
      view_json: "View raw JSON"
    }
  };

  var lang = "ar";
  var $ = function (id) { return document.getElementById(id); };

  function t(key) { return (I18N[lang] || I18N.en)[key] || key; }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  function applyLang() {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
    document.querySelectorAll("[data-i]").forEach(function (el) {
      var k = el.getAttribute("data-i");
      if (I18N[lang][k] != null) el.innerHTML = I18N[lang][k];
    });
    $("langBtn").textContent = lang === "ar" ? "EN" : "عربي";
  }

  $("langBtn").addEventListener("click", function () {
    lang = lang === "ar" ? "en" : "ar";
    applyLang();
  });

  /* ------------------------------ toast ------------------------------ */
  var toastTimer = null;
  function toast(msg) {
    var el = $("toast");
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove("show"); }, 2600);
  }

  /* ------------------------------ tabs ------------------------------ */
  document.querySelectorAll(".tab").forEach(function (tab) {
    tab.addEventListener("click", function () {
      document.querySelectorAll(".tab").forEach(function (x) { x.classList.remove("active"); });
      document.querySelectorAll(".pane").forEach(function (x) { x.classList.remove("active"); });
      tab.classList.add("active");
      document.querySelector('[data-pane="' + tab.getAttribute("data-tab") + '"]').classList.add("active");
    });
  });

  /* ------------------------------ presets ------------------------------ */
  var selectedCourse = "conversation";
  document.querySelectorAll(".preset").forEach(function (p) {
    p.addEventListener("click", function () {
      document.querySelectorAll(".preset").forEach(function (x) { x.classList.remove("sel"); });
      p.classList.add("sel");
      selectedCourse = p.getAttribute("data-course");
    });
  });

  /* ------------------------------ api ------------------------------ */
  async function api(path, opts) {
    var res = await fetch(path, opts);
    var data = await res.json().catch(function () { return {}; });
    if (!res.ok) throw new Error(data.error || res.statusText);
    return data;
  }

  async function refreshHealth() {
    try {
      var h = await api("api/health");
      var pill = $("apiPill");
      if (h.hasGeminiKey) {
        pill.classList.add("ok");
        $("apiPillTxt").textContent = t("api_ok");
        $("keyWarning").style.display = "none";
      } else {
        pill.classList.remove("ok");
        $("apiPillTxt").textContent = t("api_missing");
        $("keyWarning").style.display = "block";
      }
    } catch (e) { /* server not ready */ }
  }

  /* ------------------------------ jobs ------------------------------ */
  var currentJobId = null;
  var pollTimer = null;

  function setJobView(job) {
    var chip = $("jobChip");
    chip.className = "status-chip " + job.status;
    chip.textContent = t("job_" + job.status) || job.status;
    $("jobMsg").textContent = job.progress && job.progress.message ? job.progress.message : "";
    var total = (job.progress && job.progress.total) || 0;
    var done = (job.progress && job.progress.progress) || 0;
    var pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : job.status === "done" ? 100 : 4;
    $("jobFill").style.width = pct + "%";
    $("jobCount").textContent = done + " / " + total;
    $("jobLog").innerHTML = (job.log || []).map(function (l) {
      return '<div class="' + esc(l.level) + '"><span class="t">' + esc((l.ts || "").slice(11, 19)) + "</span>" + esc(l.message) + "</div>";
    }).join("");
    $("jobLog").scrollTop = $("jobLog").scrollHeight;
    $("cancelBtn").disabled = job.status !== "running";
    $("startBtn").disabled = job.status === "running";
  }

  function pollJob() {
    if (!currentJobId) return;
    api("api/jobs/" + currentJobId).then(function (job) {
      setJobView(job);
      if (job.status === "running") {
        pollTimer = setTimeout(pollJob, 1200);
      } else {
        currentJobId = null;
        toast(t("job_" + job.status) || job.status);
      }
    }).catch(function () {
      pollTimer = setTimeout(pollJob, 2000);
    });
  }

  $("startBtn").addEventListener("click", async function () {
    var url = $("srcUrl").value.trim();
    if (!url) return toast(t("need_url"));
    var body = {
      url: url,
      course: selectedCourse,
      outputDir: $("outDir").value.trim() || undefined,
      maxVideos: Number($("maxVideos").value) || 20,
      model: $("model").value.trim() || undefined,
      analysisPrompt: $("analysisPrompt").value.trim() || undefined,
      schemaJson: $("schemaJson").value.trim() || undefined,
    };
    try {
      var r = await api("api/jobs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      currentJobId = r.jobId;
      toast(t("job_started"));
      $("jobLog").innerHTML = "";
      pollJob();
    } catch (e) {
      toast("⚠ " + e.message);
    }
  });

  $("cancelBtn").addEventListener("click", async function () {
    if (!currentJobId) return;
    try {
      await api("api/jobs/" + currentJobId + "/cancel", { method: "POST" });
    } catch (e) { /* ignore */ }
  });

  /* ------------------------------ lessons ------------------------------ */
  var lessonCache = [];

  function renderLessonViewer(lesson) {
    var m = lesson.metadata || {};
    var c = lesson.lesson_content || {};
    var courseId = m.course_id || "conversation";
    var html = '<div class="chips" style="margin-bottom:14px">' +
      '<span class="chip">#' + esc(m.lesson_no) + "</span>" +
      '<span class="chip">' + esc(m.course_name_ar || m.course_id) + "</span>" +
      '<span class="chip">level ' + esc(m.level) + "</span>" +
      '<span class="chip">' + esc((lesson.quiz || []).length) + " " + t("quiz") + "</span>" +
      '<span class="chip">' + esc((lesson.global_vocabulary || []).length) + " " + t("vocab") + "</span>" +
      '<span class="chip">' + esc((lesson.lesson_notes || []).length) + " " + t("notes") + "</span>" +
      "</div>";
    html += '<h3 style="margin:0 0 14px">' + esc(m.title || "") + "</h3>";

    function section(title, inner) {
      return inner ? '<div class="section"><h4>' + esc(title) + "</h4>" + inner + "</div>" : "";
    }
    function box(en, ar, extra) {
      return '<div class="qbox">' + (extra || "") +
        (en ? '<div class="en">' + en + "</div>" : "") +
        (ar ? '<div class="ar">' + ar + "</div>" : "") + "</div>";
    }

    if (courseId === "phonetics") {
      html += section(t("sec_sounds"), (c.focus_sounds || []).map(function (x) {
        return box(esc(x.symbol), esc(x.description));
      }).join(""));
      html += section(t("sec_pairs"), '<div class="chips">' + (c.minimal_pairs || []).map(function (x) {
        return '<span class="chip">' + esc(x.word1) + " / " + esc(x.word2) + "</span>";
      }).join("") + "</div>");
      html += section(t("sec_scripts"), (c.practice_scripts || []).map(function (x) {
        return box(esc(x), "");
      }).join(""));
    } else if (courseId === "writing") {
      html += section(t("sec_topic"), box(esc(c.topic_en), esc(c.topic_ar)));
      html += section(t("sec_brain"), (c.brainstorming_questions || []).map(function (x) {
        return box("<b>" + esc(x.question_en) + "</b><br>" + esc(x.suggested_answer_en), "");
      }).join(""));
      html += section(t("sec_guided"), (c.guided_sentences || []).map(function (x) {
        return box(esc(x.en), esc(x.ar));
      }).join(""));
      html += section(t("sec_draft"), box(esc(c.final_draft && c.final_draft.en), esc(c.final_draft && c.final_draft.ar)));
    } else {
      html += section(t("sec_dialogue"), (c.dialogue || []).map(function (x) {
        return box("<b>" + esc(x.speaker) + ":</b> " + esc(x.en), esc(x.ar));
      }).join(""));
      html += section(t("sec_expr"), (c.key_expressions || []).map(function (x) {
        return box("<b>" + esc(x.expression_en) + "</b>", esc(x.expression_ar) + " — " + esc(x.usage_ar));
      }).join(""));
    }

    html += section(t("sec_vocab"), (lesson.global_vocabulary || []).map(function (x) {
      return box("<b>" + esc(x.word) + "</b> · " + esc(x.example_en), esc(x.meaning) + " · " + esc(x.example_ar));
    }).join(""));
    html += section(t("sec_notes"), '<div class="qbox"><ul style="margin:0;padding-inline-start:18px">' +
      (lesson.lesson_notes || []).map(function (n) { return '<li class="ar">' + esc(n) + "</li>"; }).join("") + "</ul></div>");
    html += section(t("sec_quiz"), (lesson.quiz || []).map(function (x) {
      var opts = Array.isArray(x.options) ? '<div class="chips" style="margin:6px 0">' + x.options.map(function (o) {
        return '<span class="chip">' + esc(o) + "</span>";
      }).join("") + "</div>" : "";
      return '<div class="qbox"><div class="lbl">' + esc(x.type) + "</div>" + esc(x.question) + opts +
        '<div class="ar"><b>' + esc(x.answer) + "</b> — " + esc(x.explanation_ar) + "</div></div>";
    }).join(""));

    html += '<details style="margin-top:14px"><summary style="cursor:pointer;color:var(--acc2);font-size:13px">' +
      t("view_json") + '</summary><pre style="direction:ltr;text-align:left;overflow:auto;background:#060b18;padding:12px;border-radius:10px;font-size:11px">' +
      esc(JSON.stringify(lesson, null, 2)) + "</pre></details>";

    $("lessonViewer").innerHTML = '<h2 data-i="ls_view">' + t("ls_view") + "</h2>" + html;
  }

  $("loadLessons").addEventListener("click", async function () {
    var dir = $("lessonsDir").value.trim();
    if (!dir) return toast(t("need_dir"));
    try {
      var r = await api("api/lessons?dir=" + encodeURIComponent(dir));
      lessonCache = r.lessons || [];
      if (!lessonCache.length) return toast(t("no_lessons"));
      $("lessonList").innerHTML = lessonCache.map(function (l, i) {
        return '<div class="lesson-item" data-i-idx="' + i + '">' +
          '<div class="no">' + esc(l.lesson_no != null ? l.lesson_no : i + 1) + "</div>" +
          '<div class="tt"><b>' + esc(l.title || l.file) + "</b><span>" + esc(l.file) + " · " + esc(l.quiz) + " " + t("quiz") + "</span></div></div>";
      }).join("");
      document.querySelectorAll(".lesson-item").forEach(function (el) {
        el.addEventListener("click", async function () {
          document.querySelectorAll(".lesson-item").forEach(function (x) { x.classList.remove("sel"); });
          el.classList.add("sel");
          var idx = Number(el.getAttribute("data-i-idx"));
          var file = lessonCache[idx].file;
          try {
            var lr = await api("api/lesson?dir=" + encodeURIComponent(dir) + "&file=" + encodeURIComponent(file));
            renderLessonViewer(lr.lesson);
          } catch (e) { toast("⚠ " + e.message); }
        });
      });
      document.querySelector(".lesson-item").click();
    } catch (e) {
      toast("⚠ " + e.message);
    }
  });

  /* ------------------------------ validate ------------------------------ */
  $("runValidate").addEventListener("click", async function () {
    var dir = $("valDir").value.trim();
    if (!dir) return toast(t("need_dir"));
    try {
      var r = await api("api/validate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ dir: dir, course: $("valCourse").value }),
      });
      $("valSummary").innerHTML =
        '<div class="stat ok"><b>' + r.ok + "</b><span>" + t("reports_pass") + "</span></div>" +
        '<div class="stat ' + (r.failed ? "err" : "") + '"><b>' + r.failed + "</b><span>" + t("reports_fail") + "</span></div>" +
        '<div class="stat"><b>' + r.total + "</b><span>" + t("reports_total") + "</span></div>";
      $("valReports").innerHTML = r.reports.map(function (x) {
        return '<div class="report-row ' + (x.ok ? "ok" : "fail") + '">' +
          '<span class="badge">' + (x.ok ? "✓" : "✗") + "</span><div><b dir='ltr'>" + esc(x.file) + "</b>" +
          (x.ok ? "" : "<ul>" + x.problems.map(function (p) { return "<li>" + esc(p) + "</li>"; }).join("") + "</ul>") +
          "</div></div>";
      }).join("");
    } catch (e) {
      toast("⚠ " + e.message);
    }
  });

  /* ------------------------------ settings ------------------------------ */
  async function loadConfig() {
    try {
      var c = await api("api/config");
      $("setModel").value = c.GEMINI_MODEL || "";
      $("setOut").value = c.EDUTUBE_OUTPUT_DIR || "";
      $("setYtdlp").value = c.YT_DLP_PATH || "";
      $("configPath").textContent = c.configPath || "";
      if (c.EDUTUBE_OUTPUT_DIR) {
        $("outDir").placeholder = c.EDUTUBE_OUTPUT_DIR;
        $("lessonsDir").placeholder = c.EDUTUBE_OUTPUT_DIR;
        $("valDir").placeholder = c.EDUTUBE_OUTPUT_DIR;
      }
    } catch (e) { /* ignore */ }
  }

  $("saveKeys").addEventListener("click", async function () {
    try {
      var body = {};
      if ($("setGemini").value.trim()) body.GEMINI_API_KEY = $("setGemini").value.trim();
      if ($("setYoutube").value.trim()) body.YOUTUBE_API_KEY = $("setYoutube").value.trim();
      await api("api/config", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      $("setGemini").value = ""; $("setYoutube").value = "";
      toast(t("saved"));
      refreshHealth(); loadConfig();
    } catch (e) { toast("⚠ " + e.message); }
  });

  $("saveRuntime").addEventListener("click", async function () {
    try {
      await api("api/config", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          GEMINI_MODEL: $("setModel").value.trim(),
          EDUTUBE_OUTPUT_DIR: $("setOut").value.trim(),
          YT_DLP_PATH: $("setYtdlp").value.trim(),
        }),
      });
      toast(t("saved"));
      loadConfig();
    } catch (e) { toast("⚠ " + e.message); }
  });

  /* ------------------------------ boot ------------------------------ */
  applyLang();
  refreshHealth();
  loadConfig();
  setInterval(refreshHealth, 15000);
})();
