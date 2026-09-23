import assert from "node:assert/strict";

import {
  computeCurriculumCoverage,
  parseCurriculumManifest,
  COURSE_IDS,
  isCourseId,
} from "../youtube-core/curriculum.js";

function record(courseId: string, level: number, lessonNo: number, title: string, valid = true) {
  return {
    metadata: { course_id: courseId, course_name_ar: "x", level, lesson_no: lessonNo, title },
    valid,
  };
}

export async function run(): Promise<void> {
  assert.equal(isCourseId("phonetics"), true);
  assert.equal(isCourseId("klingon"), false);
  assert.equal(COURSE_IDS.length, 7);

  const manifest = parseCurriculumManifest({
    curriculum_id: "zamericanenglish",
    curriculum_name_ar: "منهج ذا أمريكان إنجلش",
    courses: [
      { course_id: "phonetics", level: 1, expected_lessons: 5, playlist_id: "PLabc" },
      { course_id: "grammar", level: 2, expected_lessons: 3 },
    ],
  });
  assert.equal(manifest.courses.length, 2);
  assert.equal(manifest.courses[0].expected_lessons, 5);

  assert.throws(
    () => parseCurriculumManifest({ courses: [{ course_id: "klingon", level: 1 }] }),
    /course_id must be one of/
  );
  assert.throws(
    () => parseCurriculumManifest({ courses: [{ course_id: "grammar", level: 0 }] }),
    /level must be an integer/
  );

  const coverage = computeCurriculumCoverage({
    records: [
      record("phonetics", 1, 1, "درس ١"),
      record("phonetics", 1, 2, "درس ٢"),
      record("phonetics", 1, 2, "درس ٢"), // duplicated lesson number
      record("phonetics", 1, 4, "درس ١"), // duplicated title, lesson 3 missing
      record("phonetics", 1, 5, "درس ٥", false), // invalid
      record("grammar", 2, 1, "قواعد ١"),
    ],
    manifest,
  });

  const phonetics = coverage.courses.find((course) => course.course_id === "phonetics");
  assert.ok(phonetics);
  assert.equal(phonetics.extracted, 5);
  assert.equal(phonetics.valid, 4);
  assert.equal(phonetics.invalid, 1);
  assert.deepEqual(phonetics.missing_lesson_nos, [3]);
  assert.deepEqual(phonetics.duplicated_lesson_nos, [2]);
  assert.deepEqual(phonetics.duplicated_titles, ["درس ١", "درس ٢"]);
  assert.equal(phonetics.expected_lessons, 5);
  assert.equal(phonetics.completion, 0.8);

  // A course declared in the manifest but not extracted yet still shows up.
  const grammar = coverage.courses.find((course) => course.course_id === "grammar");
  assert.ok(grammar);
  assert.equal(grammar.level, 2);
  assert.deepEqual(grammar.missing_lesson_nos, [2, 3]);
  assert.equal(grammar.expected_lessons, 3);

  const declaredOnly = computeCurriculumCoverage({
    records: [],
    manifest: { curriculum_id: "c", curriculum_name_ar: "م", courses: manifest.courses },
  });
  assert.equal(declaredOnly.courses.length, 2);
  assert.equal(declaredOnly.totals.lessons, 0);
  assert.equal(declaredOnly.totals.expected, 8);
  assert.equal(declaredOnly.totals.completion, 0);

  // Without a manifest, expectations come from the highest extracted lesson no.
  const implicit = computeCurriculumCoverage({
    records: [record("writing", 1, 1, "أ"), record("writing", 1, 3, "ب")],
    manifest: null,
  });
  assert.equal(implicit.curriculum_id, null);
  assert.deepEqual(implicit.courses[0].missing_lesson_nos, [2]);
  assert.equal(implicit.courses[0].expected_lessons, 3);
}
