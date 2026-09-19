// Real-DB, read-only (no writes, no network, no qpdf) — proves the agency
// gate and the generic form-code resolution actually cover every form
// currently in the live VisaFormMapping registry, not just a couple of
// hand-picked examples. Connects to the real configured MongoDB like
// h0-i129-seed.test.js; unlike that file, nothing here mutates data or
// shells out, so it's fast.
const assert = require("node:assert/strict");
const test = require("node:test");
const mongoose = require("mongoose");
const env = require("../../../config/env");
const VisaFormMapping = require("../../../models/VisaFormMapping");
const uscisFormService = require("../../uscis-forms/uscis-form.service");
const OnDemandFormAcquisitionService = require("../services/OnDemandFormAcquisitionService");

test.before(async () => {
  if (mongoose.connection.readyState === 0) await mongoose.connect(env.mongoUri);
});

test.after(async () => {
  await mongoose.disconnect();
});

test("registry agency gate: every non-USCIS-agency form in the real registry is rejected by acquireForCase", async (t) => {
  const nonUscis = await VisaFormMapping.find({ active: true, agency: { $exists: true, $ne: "USCIS" } })
    .distinct("formNumber");
  assert.ok(nonUscis.length > 0, "expected at least one non-USCIS-agency mapping in the registry to test against");

  t.mock.method(uscisFormService, "getAccessibleCase", async () => ({ _id: "fake-case", visaType: "H-1B" }));

  for (const formNumber of nonUscis) {
    await assert.rejects(
      () => OnDemandFormAcquisitionService.acquireForCase("fake-case", formNumber, { _id: "u1", role: "super_admin" }, {}),
      (error) => {
        assert.equal(error.code, "USCIS_FORM_WRONG_AGENCY", `${formNumber} should be rejected as non-USCIS, got: ${error.code || error.message}`);
        return true;
      },
      `${formNumber} (non-USCIS agency) must be rejected before any uscis.gov fetch is attempted`
    );
  }
});

test("registry agency gate: every standalone USCIS-agency form in the real registry resolves to a well-formed uscis.gov URL", async () => {
  const uscisForms = await VisaFormMapping.find({ active: true, agency: "USCIS" }).distinct("formNumber");
  assert.ok(uscisForms.length > 0, "expected at least one USCIS-agency mapping in the registry to test against");

  const standalone = [];
  const componentOrSupplement = [];
  for (const formNumber of uscisForms) {
    const pageUrl = OnDemandFormAcquisitionService.guessedFormPageUrl(formNumber);
    (pageUrl ? standalone : componentOrSupplement).push(formNumber);
    if (pageUrl) {
      assert.match(pageUrl, /^https:\/\/www\.uscis\.gov\/[a-z0-9-]+$/, `${formNumber} -> ${pageUrl} must be a well-formed uscis.gov URL`);
    }
  }

  // Sanity: real, well-known standalone forms must be in the standalone
  // bucket (proves the pattern isn't accidentally excluding everything),
  // and real classification supplements (embedded pages within their
  // parent's own PDF, not separately fetchable) must be in the other
  // bucket (proves it isn't accidentally treating those as fetchable).
  assert.ok(standalone.includes("I-129"));
  assert.ok(standalone.includes("I-140"));
  assert.ok(standalone.includes("N-400"));
  assert.ok(componentOrSupplement.some((formNumber) => formNumber.includes("Supplement")));
});
