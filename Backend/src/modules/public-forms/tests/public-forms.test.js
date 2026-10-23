const test = require("node:test");
const assert = require("node:assert/strict");
const { latestPerForm, displayTitle } = require("../public-forms.service");

const tpl = (formCode, editionDate, key = "k") => ({ formCode, editionDate, artifacts: { form: { storageKey: key } } });

test("latestPerForm keeps the newest edition per form code, sorted, and skips templates with no stored PDF", () => {
  const result = latestPerForm([
    tpl("I-130", "2024-04-01"),
    tpl("i-130", "2025-01-01"),
    tpl("G-28", "2023-01-01"),
    { formCode: "I-9", editionDate: "2025-01-01", artifacts: {} },
  ]);
  assert.deepEqual(result.map((t) => [t.formCode, t.editionDate]), [["G-28", "2023-01-01"], ["i-130", "2025-01-01"]]);
});

test("displayTitle replaces scraped or truncated titles and strips the trailing form code", () => {
  assert.equal(displayTitle({ formCode: "I-192", title: "START HERE - Type or print in black ink.	►" }), "Application for Advance Permission to Enter as a Nonimmigrant");
  assert.equal(displayTitle({ formCode: "I-130", title: "Petition for Alien Relative (I-130)" }), "Petition for Alien Relative");
  assert.equal(displayTitle({ formCode: "G-845", title: "Verification Request" }), "Verification Request");
  assert.equal(displayTitle({ formCode: "I-589", title: "USCIS Form I-589" }), "Application for Asylum and for Withholding of Removal");
  assert.equal(displayTitle({ formCode: "N-999", title: "USCIS Form N-999" }), "USCIS Form N-999");
});
