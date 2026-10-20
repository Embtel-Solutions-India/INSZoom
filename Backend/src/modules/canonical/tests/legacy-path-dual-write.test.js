// A question that moved to a generic petitioner.* / beneficiary.* path (scripts/apply-party-checklist-paths.js) remembers the path it had before in
// metadata.legacyCanonicalPath; the canonical builder records its answer on BOTH, so everything that still reads the older path keeps receiving the same fact.
// Pure: no database.
const assert = require("node:assert/strict");
const test = require("node:test");
const CanonicalBuilderService = require("../services/CanonicalBuilderService");

const answer = (questionKey, value, question) => ({ questionKey, value, status: "submitted", question });
const pathsOf = (answers, options) => {
  const candidates = [];
  CanonicalBuilderService.addQuestionnaireCandidates(candidates, answers, options);
  return candidates.map((candidate) => [candidate.path, candidate.value]);
};

test("an answer lands on the generic path and on the path the question had before", () => {
  const rows = pathsOf([answer("employer_company_fullName", "Acme", { mapping: { canonicalPath: "petitioner.name" }, metadata: { legacyCanonicalPath: "company.name" } })]);
  assert.deepEqual(rows, [["petitioner.name", "Acme"], ["company.name", "Acme"]]);
});

test("a question that never moved is recorded once, exactly as before", () => {
  assert.deepEqual(pathsOf([answer("x", "1", { mapping: { canonicalPath: "petitioner.ein" } })]), [["petitioner.ein", "1"]]);
  assert.deepEqual(pathsOf([answer("x", "1", { mapping: { canonicalPath: "company.ein" }, metadata: { legacyCanonicalPath: "company.ein" } })]), [["company.ein", "1"]]);
});

test("a question with no path at all is still skipped", () => {
  assert.deepEqual(pathsOf([answer("not_a_known_key", "1", { mapping: {} })]), []);
});
