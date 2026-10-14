// The autopilot must leave the registry / I-824 form in a certified, openable state by itself, be idempotent, and never overwrite existing rows.
const assert = require("node:assert/strict");
const test = require("node:test");
const mongoose = require("mongoose");
const env = require("../../../config/env");
const Autopilot = require("../FormPipelineAutopilot");
const VisaFormMapping = require("../../../models/VisaFormMapping");
const USCISFormTemplate = require("../../../models/USCISFormTemplate");

test.before(async () => { await mongoose.connect(env.mongoUri); });
test.after(async () => { await mongoose.disconnect(); });

test("registry gap-fill never overwrites an existing row", async () => {
  const before = await VisaFormMapping.findOne({ visaType: "I-824", formNumber: "I-824" }).lean();
  assert.ok(before, "the I-824 registry row exists");
  const result = await Autopilot.syncMissingRegistry();
  assert.ok(Array.isArray(result.missingVisaTypes));
  const after = await VisaFormMapping.findOne({ visaType: "I-824", formNumber: "I-824" }).lean();
  assert.equal(String(after.updatedAt), String(before.updatedAt), "an existing row is left exactly as it is");
});

test("no FORM_COMPONENT row is left without a componentCode after the autopilot", async () => {
  await Autopilot.linkComponents();
  const unlinked = await VisaFormMapping.countDocuments({ active: true, componentType: "FORM_COMPONENT", $or: [{ componentCode: null }, { componentCode: { $exists: false } }] });
  assert.equal(unlinked, 0);
});

test("I-824 is mapped from verified rules, scoped to its visa type and certified - and a second run is a no-op", async () => {
  const actor = { role: "super_admin" };
  const first = await Autopilot.readinessForForm("I-824", actor);
  assert.ok(first.certified || first.skipped === "already certified", JSON.stringify(first));
  const template = await USCISFormTemplate.findOne({ formCode: "I-824", status: "active" });
  assert.ok(template.visaTypes.includes("I-824"));
  assert.equal(template.mappingStatus, "active");
  assert.equal(template.importMetadata.validationSummary.certification.passed, true);
  const second = await Autopilot.readinessForForm("I-824", actor);
  assert.equal(second.skipped, "already certified");
});

test("every active form has an edition date (backfilled from a date-shaped version, never overwritten)", async () => {
  const before = await USCISFormTemplate.find({ status: "active", editionDate: { $exists: true, $ne: null } }).select("formCode editionDate").lean();
  await Autopilot.backfillEditionDates();
  const after = await USCISFormTemplate.find({ status: "active" }).select("formCode version editionDate").lean();
  const unchanged = new Map(before.map((row) => [String(row._id), String(row.editionDate)]));
  after.filter((row) => unchanged.has(String(row._id))).forEach((row) => assert.equal(String(row.editionDate), unchanged.get(String(row._id)), `${row.formCode} editionDate was overwritten`));
  const missing = after.filter((row) => !row.editionDate && /^\d{4}-\d{2}-\d{2}$/.test(String(row.version)));
  assert.deepEqual(missing.map((row) => row.formCode), [], "a date-shaped version must have produced an edition date");
});

test("automatically fetched forms are stored as <form>_<yyyy-mm-dd>.pdf and still load", async () => {
  const report = await Autopilot.normalizeStoredFileNames();
  assert.deepEqual(report.failed, []);
  const fetched = await USCISFormTemplate.find({ status: "active", "importMetadata.source": { $in: ["on_demand_acquisition", "system_download"] } }).select("formCode pdfStorageKey editionDate version").lean();
  for (const row of fetched) {
    const date = row.editionDate ? row.editionDate.toISOString().slice(0, 10) : row.version;
    assert.ok(row.pdfStorageKey.endsWith(`/${row.formCode.toLowerCase()}_${date}.pdf`), `${row.formCode}: ${row.pdfStorageKey}`);
  }
  const again = await Autopilot.normalizeStoredFileNames();
  assert.equal(again.candidates, 0, "idempotent");
});
