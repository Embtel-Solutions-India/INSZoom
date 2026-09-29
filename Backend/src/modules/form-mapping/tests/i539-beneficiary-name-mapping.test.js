// Phase 3B regression test: I-539's mapping graph had a real, LIVE
// production bug (mappingVersion 3 was ACTIVE) - the "Beneficiary or
// Applicant" First/Last Name fields (Part 3, Item 6) were bound to
// company.name (the employer/petitioner's name) instead of the filer's
// own person.firstName/person.lastName. Corrected in mappingVersion 4.
//
// IMPORTANT: mappingVersion 4 is a corrected DRAFT only (status:
// needs_review) - per the "never bypass the activation gate" rule, this
// fix does not go live until a human explicitly activates it via
// MappingGraphService.activate(). This test checks loadCurrentGraph()
// (the latest version, used by the mapping editor/governance UI), NOT the
// currently-active version used by AutoFillService.generate() in
// production - those diverge until activation happens. See the Phase 3
// section of docs/forms/CHECKLIST_CANONICAL_TRACEABILITY_REPORT.md.
const assert = require("node:assert/strict");
const test = require("node:test");
const mongoose = require("mongoose");
const env = require("../../../config/env");
const USCISFormTemplate = require("../../../models/USCISFormTemplate");
const MappingGraphService = require("../services/MappingGraphService");

test.before(async () => {
  if (mongoose.connection.readyState === 0) await mongoose.connect(env.mongoUri);
});

test.after(async () => {
  await mongoose.disconnect();
});

test("I-539 mapping graph (latest draft): Beneficiary/Applicant Name fields resolve to person.firstName/lastName, never company.name", async () => {
  const template = await USCISFormTemplate.findOne({ formCode: "I-539" });
  assert.ok(template, "sanity: I-539 template must exist");
  const graph = await MappingGraphService.loadCurrentGraph(template);
  const nameFields = graph.edges.filter((edge) => /Beneficiary or Applicant/i.test(edge.targetLabel || ""));
  assert.ok(nameFields.length > 0, "sanity: some Beneficiary/Applicant name fields should still be mapped");
  nameFields.forEach((edge) => {
    assert.ok(
      /^person\.(firstName|lastName)$/.test(edge.sourcePath),
      `${edge.mappingId} (${edge.targetLabel}) must map to the filer's own person.firstName/lastName, got "${edge.sourcePath}"`
    );
    assert.notEqual(edge.sourcePath, "company.name", "must never reuse the employer/petitioner's company name for the filer's own identity");
  });
});
