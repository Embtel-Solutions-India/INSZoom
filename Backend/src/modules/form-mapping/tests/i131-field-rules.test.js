// Form I-131 rules (config/i131FieldRules.js): every path they read must exist in the canonical registry, and each group of tick boxes must be complete.
const test = require("node:test");
const assert = require("node:assert/strict");
const { I131_RULES } = require("../config/i131FieldRules");
const { RULES, EXCLUSIVE_FORMS } = require("../config/partyFieldRules");
const CanonicalFieldRegistryService = require("../services/CanonicalFieldRegistryService");

const known = new Set(CanonicalFieldRegistryService.list({}).map((field) => field.path));

test("I-131 is wired to its rules and is not exclusive (the form's existing edges are kept)", () => {
  assert.equal(RULES["I-131"], I131_RULES);
  assert.equal(EXCLUSIVE_FORMS.has("I-131"), false);
});

test("every canonical path and fallback an I-131 rule uses exists in the registry", () => {
  for (const rule of I131_RULES) {
    assert.ok(known.has(rule.to), `${rule.to} is not a registry path`);
    if (rule.fallback) assert.ok(known.has(rule.fallback), `${rule.fallback} (fallback) is not a registry path`);
  }
});

test("each tick-box group covers every box once: 9 eye colours, 9 hair colours, 2 ethnicity boxes, 5 race boxes", () => {
  const indexes = (path, stem) => I131_RULES.filter((rule) => rule.to === path && rule.stems.includes(stem)).map((rule) => rule.index).sort((a, b) => a - b);
  assert.deepEqual(indexes("petitioner.eyeColor", "P3_Line5_EyeColor"), [0, 1, 2, 3, 4, 5, 6, 7, 8]);
  assert.deepEqual(indexes("petitioner.hairColor", "P3_Line6_HairColor"), [0, 1, 2, 3, 4, 5, 6, 7, 8]);
  assert.deepEqual(indexes("petitioner.ethnicity", "P3_Line1_Ethnicity"), [0, 1]);
  assert.equal(I131_RULES.filter((rule) => rule.to === "petitioner.race").length, 5);
  assert.equal(new Set(I131_RULES.filter((rule) => rule.to === "petitioner.eyeColor").map((rule) => rule.checkboxEquals)).size, 9, "no two eye boxes share a value");
});

test("the three weight boxes take one digit each, padded to three", () => {
  const weight = I131_RULES.filter((rule) => rule.to === "petitioner.weightPounds");
  assert.deepEqual(weight.map((rule) => rule.transform.index), [0, 1, 2]);
  assert.ok(weight.every((rule) => rule.transform.type === "digitAt" && rule.transform.pad === 3));
});

test("the applicant's statement reads the applicant as the contract does (beneficiary.*), with the single-party petitioner.* path as the fallback", () => {
  for (const [stem, path, fallback] of [["Part10_Line1_DayPhone", "beneficiary.primaryPhone", "petitioner.phone"], ["Part10_Line2_MobilePhone", "beneficiary.mobilePhone", "petitioner.mobilePhone"], ["Part10_Line3_Email", "beneficiary.email", "petitioner.email"]]) {
    const rule = I131_RULES.find((item) => item.stems.includes(stem));
    assert.equal(rule.to, path);
    assert.equal(rule.fallback, fallback);
  }
});

test("nothing here fills the interpreter, the preparer, a signature or a barcode", () => {
  const stems = I131_RULES.flatMap((rule) => rule.stems);
  assert.equal(stems.filter((stem) => /interpreter|preparer|signature|417|barcode|Part11|Part12/i.test(stem)).length, 0);
});
