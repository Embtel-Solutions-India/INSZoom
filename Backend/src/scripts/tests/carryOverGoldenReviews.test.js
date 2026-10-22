const test = require("node:test");
const assert = require("node:assert/strict");
const { classify, reasonsToReview } = require("../carryOverGoldenReviews");
const { genericPathFor } = require("../../modules/form-mapping/services/ChecklistPartyRewireService");

const entry = (extra = {}, technical = {}) => ({
  id: "e1", formCode: "I-130", ref: "I-130 #1", boxKind: "text", boxLabel: "City", where: "Item 1, page 1", writtenAs: "", onlyWhen: "", ifEmpty: "", contentHash: "old",
  technical: { sourcePath: "raw.questionnaireAnswers.employer_company_address_city.value", transform: { type: "direct" }, ...technical }, ...extra,
});
const renamed = (extra = {}, technical = {}) => entry({ contentHash: "new", ifEmpty: "the client's answer", ...extra }, { sourcePath: "petitioner.address.city", fallback: "raw.questionnaireAnswers.employer_company_address_city.value", ...technical });

test("the same question moved to its generic path (old key kept as the fallback) keeps its answer", () => {
  assert.deepEqual(reasonsToReview(entry(), renamed(), genericPathFor), []);
  const out = classify({ entries: [entry()] }, { entries: [renamed()] }, genericPathFor);
  assert.equal(out.carry.length, 1);
  assert.equal(out.review.length, 0);
});

test("an unchanged entry is left as it is", () => {
  const out = classify({ entries: [entry()] }, { entries: [entry()] }, genericPathFor);
  assert.deepEqual([out.same.length, out.carry.length, out.review.length], [1, 0, 0]);
});

test("another fact in the box needs the reviewer", () => {
  const out = classify({ entries: [entry({}, { sourcePath: "petitioner.address.city" })] }, { entries: [renamed({}, { sourcePath: "petitioner.physicalAddress.city", fallback: "petitioner.address.city" })] }, genericPathFor);
  assert.equal(out.carry.length, 0);
  assert.match(out.review[0].reasons.join(), /another fact/);
});

test("a changed format, kind of box, place or label needs the reviewer", () => {
  for (const change of [{ writtenAs: "as a date" }, { boxKind: "date" }, { where: "Item 2, page 3" }, { boxLabel: "Town" }]) {
    assert.ok(reasonsToReview(entry(), renamed(change), genericPathFor).length > 0, JSON.stringify(change));
  }
  assert.ok(reasonsToReview(entry(), renamed({}, { transform: { type: "usState" } }), genericPathFor).length > 0);
});

test("an old condition kept whole inside the new either-path condition still counts as the same condition; a different one does not", () => {
  const old = entry({ onlyWhen: 'the answer to "a" is given and the answer to "b" is empty' });
  assert.deepEqual(reasonsToReview(old, renamed({ onlyWhen: 'the sponsor\'s a is given or the answer to "a" is given and the sponsor\'s b is empty and the answer to "b" is empty' }), genericPathFor), []);
  assert.ok(reasonsToReview(old, renamed({ onlyWhen: 'the answer to "a" is given' }), genericPathFor).length > 0, "a dropped clause is a different condition");
  assert.ok(reasonsToReview(old, renamed({ onlyWhen: "" }), genericPathFor).length > 0, "a dropped condition is a different condition");
});

test("a box the signed draft did not have is never answered for anyone", () => {
  const out = classify({ entries: [] }, { entries: [renamed()] }, genericPathFor);
  assert.equal(out.added.length, 1);
  assert.equal(out.carry.length, 0);
});

test("a changed fallback (another fact behind the box) needs the reviewer", () => {
  const old = entry({ ifEmpty: "the case's visa type" }, { sourcePath: "case.classification" });
  assert.ok(reasonsToReview(old, entry({ contentHash: "new", ifEmpty: "something else" }, { sourcePath: "case.classification" }), genericPathFor).includes("another fallback"));
});
