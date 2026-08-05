const assert = require("node:assert/strict");
const test = require("node:test");
const MigrationSuggestionService = require("../services/MigrationSuggestionService");

test("MigrationSuggestionService recommends high-confidence mapping changes", () => {
  const suggestions = MigrationSuggestionService.suggest(
    { formFields: [{ fieldId: "beneficiaryLastName", label: "Beneficiary Last Name", type: "text" }] },
    { formFields: [{ fieldId: "beneficiaryFamilyName", label: "Beneficiary Family Name", type: "text" }] }
  );
  assert.equal(suggestions.length, 1);
  assert.ok(suggestions[0].confidence >= 80);
});
