// Regression test for a real bug found while verifying Phase 1 (USCIS forms
// not rendering): 2 of 99 seeded CaseForm records in the dev DB reference a
// formTemplateId that no longer exists (a stale duplicate removed by a later
// re-seed/import). Mongoose's populate() silently resolves that ref to null
// instead of erroring, and renderCaseForm's `caseForm.formTemplateId.toObject()`
// then threw an uncaught TypeError - a 500 with no explanation, for the exact
// "workspace" endpoint the interactive form viewer depends on. Matches this
// repo's no-DB test convention (see data-rights/tests/dataRights.service.test.js)
// by stubbing the Mongoose models instead of hitting a real database.
const assert = require("node:assert/strict");
const test = require("node:test");
const Case = require("../../../models/Case");
const CaseForm = require("../../../models/CaseForm");
const caseService = require("../../cases/case.service");
const { renderCaseForm } = require("../uscis-form.service");

test("renderCaseForm throws a clear, actionable error (not an uncaught TypeError) when the case form's template was deleted", async (t) => {
  t.mock.method(Case, "findById", () => Promise.resolve({ _id: "case1" }));
  t.mock.method(caseService, "canAccessCase", () => true);
  t.mock.method(CaseForm, "findOne", () => ({
    populate: () => Promise.resolve({ _id: "caseform1", formTemplateId: null }),
  }));

  await assert.rejects(
    () => renderCaseForm("case1", "caseform1", { _id: "user1", role: "case_manager" }, {}),
    (error) => {
      assert.notEqual(error.constructor.name, "TypeError", "must not be the raw 'Cannot read properties of null' crash");
      assert.equal(error.statusCode, 409);
      assert.match(error.message, /template.*(missing|removed)/i);
      return true;
    },
  );
});
