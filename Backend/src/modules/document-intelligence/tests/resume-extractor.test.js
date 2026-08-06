// DB-free unit tests for the resume extraction stack (schema/dto/validator/
// extractor), mirroring the coverage a passport.validator.js-style suite
// would give the passport path. No provider call - extract() is exercised
// via its geminiResponse override, same pattern passport-extractor.service.js
// supports.
const assert = require("node:assert/strict");
const test = require("node:test");
const { normalizeResumeExtractionDto, normalizeDegreeType, normalizeDate } = require("../dto/resume-extraction.dto");
const { validateResumeExtraction } = require("../validators/resume.validator");
const resumeExtractor = require("../extractors/resume-extractor.service");

test("normalizeDegreeType accepts known enum values (case/spacing insensitive) and rejects unknown strings", () => {
  assert.equal(normalizeDegreeType("Masters"), "masters");
  assert.equal(normalizeDegreeType("no-diploma"), "no_diploma");
  assert.equal(normalizeDegreeType("MS Computer Science"), null);
  assert.equal(normalizeDegreeType(null), null);
});

test("normalizeDate coerces parseable dates to YYYY-MM-DD and preserves unparseable text", () => {
  assert.equal(normalizeDate("2019"), "2019-01-01");
  assert.equal(normalizeDate("2019-06-15"), "2019-06-15");
  assert.equal(normalizeDate("June 2019"), "2019-06-01");
  assert.equal(normalizeDate("not a date"), "not a date");
});

test("normalizeResumeExtractionDto drops hallucinated empty rows and clamps confidence", () => {
  const dto = normalizeResumeExtractionDto({
    fields: {
      education: {
        value: [
          { institution: "XYZ University", degreeType: "masters", major: "Business Administration", awardDate: "2019", confidence: 150 },
          { institution: null, degreeType: null, confidence: 0 },
        ],
        confidence: 90,
      },
      employment: {
        value: [
          { employer: "Acme Corp", title: "Engineer", startDate: "2020-01-01", endDate: "2022-01-01", confidence: -5 },
          { employer: "", title: "Ghost Row", confidence: 50 },
        ],
        confidence: 85,
      },
      skills: { value: ["Node.js", "  ", "SQL"], confidence: 70 },
    },
    overallConfidence: 88,
  });
  assert.equal(dto.fields.education.value.length, 1, "the empty-institution row must be dropped");
  assert.equal(dto.fields.education.value[0].confidence, 100, "confidence must clamp to 100");
  assert.equal(dto.fields.education.value[0].awardDate, "2019-01-01");
  assert.equal(dto.fields.employment.value.length, 1, "the empty-employer row must be dropped");
  assert.equal(dto.fields.employment.value[0].confidence, 0, "negative confidence must clamp to 0");
  assert.deepEqual(dto.fields.skills.value, ["Node.js", "SQL"]);
});

test("validateResumeExtraction flags an invalid degreeType and an employment end-before-start date", () => {
  const validation = validateResumeExtraction({
    education: { value: [{ institution: "XYZ University", degreeType: "phd_hacked_in", awardDate: "2019-01-01" }] },
    employment: { value: [{ employer: "Acme Corp", startDate: "2022-01-01", endDate: "2020-01-01" }] },
  });
  assert.equal(validation.valid, false);
  assert.ok(validation.issuesByField.education.some((issue) => issue.code === "invalid_degree_type"));
  assert.ok(validation.issuesByField.employment.some((issue) => issue.code === "end_before_start"));
});

test("validateResumeExtraction flags duplicate education/employment entries", () => {
  const validation = validateResumeExtraction({
    education: {
      value: [
        { institution: "XYZ University", degreeType: "masters", awardDate: "2019-01-01" },
        { institution: "XYZ University", degreeType: "masters", awardDate: "2019-01-01" },
      ],
    },
    employment: { value: [] },
  });
  assert.ok(validation.issuesByField.education.some((issue) => issue.code === "possible_duplicate"));
});

test("resume-extractor.service.extract runs the DTO+validator over a geminiResponse override (no provider call)", async () => {
  const result = await resumeExtractor.extract({
    document: { originalName: "resume.pdf", mimeType: "application/pdf" },
    buffer: Buffer.from("irrelevant"),
    geminiResponse: {
      fields: {
        education: { value: [{ institution: "XYZ University", degreeType: "masters", major: "Business Administration", awardDate: "2019-05-01", confidence: 92 }], confidence: 92 },
        employment: { value: [{ employer: "Acme Corp", title: "Analyst", startDate: "2019-06-01", current: true, confidence: 90 }], confidence: 90 },
        skills: { value: ["Excel"], confidence: 80 },
      },
      overallConfidence: 90,
    },
  });
  assert.equal(result.fields.education.value[0].institution, "XYZ University");
  assert.equal(result.fields.education.validationStatus, undefined, "a clean extraction must not be flagged for review");
  assert.equal(result.overallConfidence, 90);
});
