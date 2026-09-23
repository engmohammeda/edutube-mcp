// Curriculum registry: the single source of truth for every course/level that
// Edutube can extract (The American English / ZAmericanEnglish curriculum and
// any custom curriculum described by a manifest file).
//
// Keeping the catalogue in one place means the extractor, the validator, the
// coverage report and the CLI all agree on what a course is, what its content
// keys are and what a compliant quiz looks like.
export type CourseId =
  | "conversation"
  | "phonetics"
  | "writing"
  | "grammar"
  | "vocabulary"
  | "reading"
  | "listening";

export const COURSE_IDS: readonly CourseId[] = [
  "conversation",
  "phonetics",
  "writing",
  "grammar",
  "vocabulary",
  "reading",
  "listening",
];

export type QuizTypeRule = {
  type: string;
  min: number;
  max?: number;
};

export type QuizPolicy = {
  exactLength: number;
  rules: QuizTypeRule[];
  /** Minimum number of distinct question types that must appear. */
  minDistinctTypes: number;
};

export type CourseDefinition = {
  id: CourseId;
  nameAr: string;
  nameEn: string;
  descriptionAr: string;
  /** Keys expected inside `lesson_content`. */
  contentKeys: string[];
  /** At least one of these must be non-empty for the lesson to count as content. */
  requiredContentKeys: string[];
  quizPolicy: QuizPolicy;
  /** Minimum accepted item counts per content key (soft quality floor). */
  minCounts: Record<string, number>;
};

function quizPolicy(rules: QuizTypeRule[], minDistinctTypes = 2): QuizPolicy {
  return { exactLength: 10, rules, minDistinctTypes };
}

export const COURSE_CATALOG: Record<CourseId, CourseDefinition> = {
  conversation: {
    id: "conversation",
    nameAr: "المحادثة",
    nameEn: "Conversation",
    descriptionAr: "حوارات كاملة مع الترجمة، التعبيرات المفتاحية، والمفردات السياقية.",
    contentKeys: ["dialogue", "key_expressions"],
    requiredContentKeys: ["dialogue"],
    quizPolicy: quizPolicy(
      [
        { type: "multiple_choice", min: 3, max: 6 },
        { type: "true_false", min: 2, max: 4 },
        { type: "written", min: 1, max: 4 },
      ],
      3
    ),
    minCounts: { dialogue: 4, key_expressions: 1 },
  },
  phonetics: {
    id: "phonetics",
    nameAr: "الصوتيات",
    nameEn: "Phonetics",
    descriptionAr: "مخارج الأصوات، الأزواج المتقابلة، وجمل التدريب السريع.",
    contentKeys: ["focus_sounds", "minimal_pairs", "practice_scripts"],
    requiredContentKeys: ["focus_sounds", "minimal_pairs", "practice_scripts"],
    quizPolicy: quizPolicy(
      [
        { type: "audio_quiz", min: 5, max: 9 },
        { type: "true_false", min: 2, max: 4 },
      ],
      2
    ),
    minCounts: { focus_sounds: 1, minimal_pairs: 1 },
  },
  writing: {
    id: "writing",
    nameAr: "الكتابة",
    nameEn: "Writing",
    descriptionAr: "العصف الذهني، الجمل الموجّهة، والمسودة النهائية للموضوع.",
    contentKeys: [
      "topic_en",
      "topic_ar",
      "brainstorming_questions",
      "guided_sentences",
      "final_draft",
    ],
    requiredContentKeys: ["brainstorming_questions", "guided_sentences", "final_draft"],
    quizPolicy: quizPolicy(
      [
        { type: "written", min: 3, max: 6 },
        { type: "multiple_choice", min: 2, max: 5 },
        { type: "true_false", min: 1, max: 4 },
      ],
      3
    ),
    minCounts: { brainstorming_questions: 2, guided_sentences: 3 },
  },
  grammar: {
    id: "grammar",
    nameAr: "القواعد",
    nameEn: "Grammar",
    descriptionAr: "القاعدة وشرحها بالعربية، التراكيب، والأخطاء الشائعة.",
    contentKeys: ["topic_en", "topic_ar", "rules", "structures", "common_mistakes"],
    requiredContentKeys: ["rules"],
    quizPolicy: quizPolicy(
      [
        { type: "multiple_choice", min: 4, max: 7 },
        { type: "true_false", min: 1, max: 3 },
        { type: "written", min: 2, max: 4 },
      ],
      3
    ),
    minCounts: { rules: 2, structures: 1 },
  },
  vocabulary: {
    id: "vocabulary",
    nameAr: "المفردات",
    nameEn: "Vocabulary",
    descriptionAr: "الكلمات المستهدفة مع النطق والمعنى، والمتلازمات اللفظية.",
    contentKeys: ["theme_en", "theme_ar", "target_words", "collocations"],
    requiredContentKeys: ["target_words"],
    quizPolicy: quizPolicy(
      [
        { type: "audio_quiz", min: 3, max: 7 },
        { type: "multiple_choice", min: 2, max: 5 },
        { type: "written", min: 1, max: 4 },
      ],
      3
    ),
    minCounts: { target_words: 5 },
  },
  reading: {
    id: "reading",
    nameAr: "القراءة",
    nameEn: "Reading",
    descriptionAr: "النص المقروء مع ترجمته ونقاط الفهم الرئيسية.",
    contentKeys: [
      "passage_title_en",
      "passage_title_ar",
      "passage_en",
      "passage_ar",
      "comprehension_points",
    ],
    requiredContentKeys: ["passage_en", "comprehension_points"],
    quizPolicy: quizPolicy(
      [
        { type: "multiple_choice", min: 4, max: 7 },
        { type: "true_false", min: 2, max: 4 },
        { type: "written", min: 1, max: 3 },
      ],
      3
    ),
    minCounts: { comprehension_points: 2 },
  },
  listening: {
    id: "listening",
    nameAr: "الاستماع",
    nameEn: "Listening",
    descriptionAr: "نص المقطع المسموع مع الترجمة ومهام الاستماع وإجاباتها.",
    contentKeys: ["audio_topic_en", "audio_topic_ar", "transcript", "listening_tasks"],
    requiredContentKeys: ["transcript"],
    quizPolicy: quizPolicy(
      [
        { type: "audio_quiz", min: 3, max: 7 },
        { type: "multiple_choice", min: 2, max: 5 },
        { type: "true_false", min: 1, max: 3 },
      ],
      3
    ),
    minCounts: { transcript: 4 },
  },
};

export function isCourseId(value: unknown): value is CourseId {
  return typeof value === "string" && (COURSE_IDS as readonly string[]).includes(value);
}

export function getCourseDefinition(course: CourseId | string | undefined): CourseDefinition {
  if (isCourseId(course)) return COURSE_CATALOG[course];
  return COURSE_CATALOG.conversation;
}

export function listCourseDefinitions(): CourseDefinition[] {
  return COURSE_IDS.map((id) => COURSE_CATALOG[id]);
}

/* ------------------------------- manifest -------------------------------- */

/**
 * A curriculum manifest describes the whole syllabus: which playlists belong to
 * which course and level, and how many lessons each is expected to contain.
 * It is authored by the user (playlist ids are never guessed by the code) and
 * drives `edutube-mcp curriculum` coverage reports.
 */
export type CurriculumCourseEntry = {
  course_id: CourseId;
  level: number;
  playlist_url?: string;
  playlist_id?: string;
  expected_lessons?: number | null;
  notes?: string;
};

export type CurriculumManifest = {
  curriculum_id: string;
  curriculum_name_ar: string;
  curriculum_name_en?: string;
  courses: CurriculumCourseEntry[];
};

export function createEmptyManifest(
  overrides: Partial<CurriculumManifest> = {}
): CurriculumManifest {
  return {
    curriculum_id: "zamericanenglish",
    curriculum_name_ar: "منهج ذا أمريكان إنجلش",
    curriculum_name_en: "The American English (ZAmericanEnglish)",
    courses: [],
    ...overrides,
  };
}

export function parseCurriculumManifest(raw: unknown): CurriculumManifest {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Curriculum manifest must be a JSON object.");
  }
  const input = raw as Record<string, unknown>;
  const coursesRaw = Array.isArray(input.courses) ? input.courses : [];
  const courses: CurriculumCourseEntry[] = [];

  coursesRaw.forEach((entry, index) => {
    if (!entry || typeof entry !== "object") {
      throw new Error(`curriculum.courses[${index}] must be an object.`);
    }
    const item = entry as Record<string, unknown>;
    const courseId = item.course_id;
    if (!isCourseId(courseId)) {
      throw new Error(
        `curriculum.courses[${index}].course_id must be one of: ${COURSE_IDS.join(", ")}.`
      );
    }
    const level = Number(item.level ?? 1);
    if (!Number.isInteger(level) || level < 1) {
      throw new Error(`curriculum.courses[${index}].level must be an integer >= 1.`);
    }
    const expected =
      item.expected_lessons === null || item.expected_lessons === undefined
        ? null
        : Number(item.expected_lessons);
    if (expected !== null && (!Number.isInteger(expected) || expected < 1)) {
      throw new Error(`curriculum.courses[${index}].expected_lessons must be an integer >= 1.`);
    }
    courses.push({
      course_id: courseId,
      level,
      playlist_url: typeof item.playlist_url === "string" ? item.playlist_url : undefined,
      playlist_id: typeof item.playlist_id === "string" ? item.playlist_id : undefined,
      expected_lessons: expected,
      notes: typeof item.notes === "string" ? item.notes : undefined,
    });
  });

  return createEmptyManifest({
    curriculum_id: typeof input.curriculum_id === "string" ? input.curriculum_id : "custom",
    curriculum_name_ar:
      typeof input.curriculum_name_ar === "string" ? input.curriculum_name_ar : "منهج مخصص",
    curriculum_name_en:
      typeof input.curriculum_name_en === "string" ? input.curriculum_name_en : undefined,
    courses,
  });
}

/* ------------------------------- coverage --------------------------------- */

export type LessonCoverageRecord = {
  metadata?: Record<string, unknown>;
  videoId?: string | null;
  file?: string | null;
  valid?: boolean;
  issues?: number;
  status?: string;
};

export type CourseCoverage = {
  course_id: string;
  course_name_ar: string;
  level: number;
  expected_lessons: number | null;
  extracted: number;
  valid: number;
  invalid: number;
  missing_lesson_nos: number[];
  duplicated_lesson_nos: number[];
  duplicated_titles: string[];
  completion: number;
};

export type CurriculumCoverage = {
  curriculum_id: string | null;
  curriculum_name_ar: string | null;
  courses: CourseCoverage[];
  totals: {
    courses: number;
    lessons: number;
    valid: number;
    invalid: number;
    expected: number;
    completion: number;
  };
};

function readMetadataNumber(metadata: Record<string, unknown> | undefined, key: string): number | null {
  const value = metadata?.[key];
  const num = typeof value === "number" ? value : Number(value);
  return Number.isFinite(num) ? Math.trunc(num) : null;
}

function readMetadataString(
  metadata: Record<string, unknown> | undefined,
  key: string
): string | null {
  const value = metadata?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function computeCourseCoverage(params: {
  courseId: CourseId | string;
  level: number;
  expectedLessons?: number | null;
  records: LessonCoverageRecord[];
}): CourseCoverage {
  const definition = getCourseDefinition(params.courseId);
  const lessonNos: number[] = [];
  const titleCounts = new Map<string, number>();
  let valid = 0;
  let invalid = 0;

  for (const record of params.records) {
    const no = readMetadataNumber(record.metadata, "lesson_no");
    if (no !== null) lessonNos.push(no);
    const title = readMetadataString(record.metadata, "title");
    if (title) titleCounts.set(title.toLowerCase(), (titleCounts.get(title.toLowerCase()) ?? 0) + 1);
    if (record.valid === false) invalid += 1;
    else valid += 1;
  }

  const seen = new Set<number>();
  const duplicatedLessonNos = new Set<number>();
  for (const no of lessonNos) {
    if (seen.has(no)) duplicatedLessonNos.add(no);
    seen.add(no);
  }

  const expected =
    params.expectedLessons && params.expectedLessons > 0
      ? params.expectedLessons
      : lessonNos.length > 0
        ? Math.max(...lessonNos)
        : 0;

  const missing: number[] = [];
  for (let no = 1; no <= expected; no += 1) {
    if (!seen.has(no)) missing.push(no);
  }

  const duplicatedTitles = [...titleCounts.entries()]
    .filter(([, count]) => count > 1)
    .map(([title]) => title);

  return {
    course_id: definition.id,
    course_name_ar: definition.nameAr,
    level: params.level,
    expected_lessons: expected > 0 ? expected : null,
    extracted: params.records.length,
    valid,
    invalid,
    missing_lesson_nos: missing,
    duplicated_lesson_nos: [...duplicatedLessonNos].sort((a, b) => a - b),
    duplicated_titles: duplicatedTitles,
    completion: expected > 0 ? Math.min(1, valid / expected) : valid > 0 ? 1 : 0,
  };
}

export function computeCurriculumCoverage(params: {
  records: LessonCoverageRecord[];
  manifest?: CurriculumManifest | null;
}): CurriculumCoverage {
  const groups = new Map<string, { courseId: string; level: number; expected: number | null; records: LessonCoverageRecord[] }>();

  const keyOf = (courseId: string, level: number) => `${courseId}::${level}`;

  for (const record of params.records) {
    const courseId = readMetadataString(record.metadata, "course_id") ?? "conversation";
    const level = readMetadataNumber(record.metadata, "level") ?? 1;
    const key = keyOf(courseId, level);
    const bucket = groups.get(key) ?? { courseId, level, expected: null, records: [] };
    bucket.records.push(record);
    groups.set(key, bucket);
  }

  const manifestCourses = params.manifest?.courses ?? [];
  for (const entry of manifestCourses) {
    const key = keyOf(entry.course_id, entry.level);
    const bucket = groups.get(key) ?? {
      courseId: entry.course_id,
      level: entry.level,
      expected: null,
      records: [],
    };
    if (entry.expected_lessons) bucket.expected = entry.expected_lessons;
    groups.set(key, bucket);
  }

  const courses = [...groups.values()]
    .map((bucket) =>
      computeCourseCoverage({
        courseId: bucket.courseId,
        level: bucket.level,
        expectedLessons: bucket.expected,
        records: bucket.records,
      })
    )
    .sort((a, b) => a.level - b.level || a.course_id.localeCompare(b.course_id));

  const totals = {
    courses: courses.length,
    lessons: courses.reduce((sum, c) => sum + c.extracted, 0),
    valid: courses.reduce((sum, c) => sum + c.valid, 0),
    invalid: courses.reduce((sum, c) => sum + c.invalid, 0),
    expected: courses.reduce((sum, c) => sum + (c.expected_lessons ?? 0), 0),
    completion: 0,
  };
  totals.completion =
    totals.expected > 0 ? Math.min(1, totals.valid / totals.expected) : totals.lessons > 0 ? 1 : 0;

  return {
    curriculum_id: params.manifest?.curriculum_id ?? null,
    curriculum_name_ar: params.manifest?.curriculum_name_ar ?? null,
    courses,
    totals,
  };
}
