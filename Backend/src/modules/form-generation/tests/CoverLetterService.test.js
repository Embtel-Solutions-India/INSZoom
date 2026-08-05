const assert = require("node:assert/strict");
const test = require("node:test");
const CoverLetterService = require("../services/CoverLetterService");

test("CoverLetterService renders nested placeholders", () => {
  const result = CoverLetterService.renderTemplate("Dear USCIS, {{ beneficiary.fullName }} works at {{ petitioner.name }}.", {
    beneficiary: { fullName: "Jane Doe" },
    petitioner: { name: "Acme Corp" },
  });
  assert.equal(result, "Dear USCIS, Jane Doe works at Acme Corp.");
});
