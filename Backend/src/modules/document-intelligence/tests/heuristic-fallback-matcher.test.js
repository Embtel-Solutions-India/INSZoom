// DB-free unit tests for semantic-field-matcher.service.js's heuristic
// fallback matcher (Phase: deterministic fallback for when the LLM match
// call throws/times out or returns nothing usable). Exercises
// heuristicFallbackMatch() directly against synthetic fields/catalogs, not
// through the DB-backed buildTargetCatalog/matchFields plumbing.
const assert = require("node:assert/strict");
const test = require("node:test");
const { heuristicFallbackMatch, MATCH_MIN_COMBINED_CONFIDENCE } = require("../services/semantic-field-matcher.service");

test("exact label match is accepted with matchMethod heuristic_fallback and confidence capped at 65", () => {
  const matches = heuristicFallbackMatch({
    fields: [{ key: "employerName", value: "Acme Analytics Inc", confidence: 95 }],
    catalog: [{ targetSystem: "answer", targetPath: "employer_company_fullName", label: "Employer Name" }],
  });
  assert.equal(matches.length, 1);
  assert.equal(matches[0].fieldKey, "employerName");
  assert.equal(matches[0].targetPath, "employer_company_fullName");
  assert.equal(matches[0].matchMethod, "heuristic_fallback");
  assert.ok(matches[0].combinedConfidence <= 65, "combinedConfidence must never exceed the 65 cap");
  assert.ok(matches[0].combinedConfidence >= MATCH_MIN_COMBINED_CONFIDENCE, "a clean match should still clear the review-queue confidence floor");
});

test("word-order-swapped near-miss is caught via Levenshtein similarity", () => {
  const matches = heuristicFallbackMatch({
    fields: [{ key: "wageLevelEmployer", value: "Level II", confidence: 90 }],
    catalog: [{ targetSystem: "answer", targetPath: "employer_position_wageLevel", label: "Employer Wage Level" }],
  });
  assert.equal(matches.length, 1, "word-order difference alone must not block the match");
  assert.equal(matches[0].targetPath, "employer_position_wageLevel");
});

test("alias case: DOB field key matches a 'Date of Birth' catalog label", () => {
  const matches = heuristicFallbackMatch({
    fields: [{ key: "DOB", value: "1990-03-15", confidence: 96 }],
    catalog: [
      { targetSystem: "answer", targetPath: "employee_personal_dateOfBirth", label: "Date of Birth" },
      { targetSystem: "answer", targetPath: "employee_personal_lastName", label: "Last Name" },
    ],
  });
  assert.equal(matches.length, 1);
  assert.equal(matches[0].targetPath, "employee_personal_dateOfBirth");
});

test("a genuine non-match returns nothing", () => {
  const matches = heuristicFallbackMatch({
    fields: [{ key: "favoriteColor", value: "blue", confidence: 80 }],
    catalog: [
      { targetSystem: "answer", targetPath: "employer_position_wageLevel", label: "Employer Wage Level" },
      { targetSystem: "masterData", targetPath: "person.passport.number", label: "Passport Number" },
    ],
  });
  assert.deepEqual(matches, []);
});

test("on an exact-score tie between an answer and a masterData candidate, answer wins (matches catalog order and deterministicAnswerMatches' own preference)", () => {
  const matches = heuristicFallbackMatch({
    fields: [{ key: "educationHighestLevel", value: "masters", confidence: 90 }],
    catalog: [
      { targetSystem: "answer", targetPath: "employee_education_highestLevel", label: "Highest Education Level" },
      { targetSystem: "masterData", targetPath: "employee.education.highestLevel", label: "Highest Education Level" },
    ],
  });
  assert.equal(matches.length, 1);
  assert.equal(matches[0].targetSystem, "answer", "identical-label ties must resolve to the first catalog entry (answer)");
});

test("never bypasses review: combinedConfidence is always capped at 65 even with a perfect field.confidence", () => {
  const matches = heuristicFallbackMatch({
    fields: [{ key: "passportNumber", value: "X1234567", confidence: 100 }],
    catalog: [{ targetSystem: "answer", targetPath: "employee_personal_passportNumber", label: "Passport Number" }],
  });
  assert.equal(matches[0].combinedConfidence, 65);
});
