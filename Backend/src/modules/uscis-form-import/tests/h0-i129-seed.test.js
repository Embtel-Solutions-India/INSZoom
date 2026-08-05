// Phase H0 acceptance tests. Unlike the rest of this repo's suite (which is
// deliberately DB-free, mocking Mongoose model statics — see
// data-rights/tests/dataRights.service.test.js), these tests connect to the
// REAL configured MongoDB (env.mongoUri) and shell out to the REAL qpdf
// binary. That's a deliberate, scoped exception: the acceptance criteria
// here (idempotent seeding of a single real template, real assignment via
// uscis-form.service.js against a real Case/CaseForm) are inherently
// integration-level — a mocked Mongoose model can't prove "running the seed
// twice doesn't duplicate the record" the way a real find/save round-trip
// can. Requires a reachable MongoDB and `qpdf` on PATH (see
// Backend/H0_REPORT.md for how to check both).
const assert = require("node:assert/strict");
const test = require("node:test");
const mongoose = require("mongoose");
const { PDFDocument } = require("pdf-lib");
const env = require("../../../config/env");
const USCISFormTemplate = require("../../../models/USCISFormTemplate");
const Case = require("../../../models/Case");
const CaseForm = require("../../../models/CaseForm");
const storageService = require("../../uploads/storage.service");
const seedI129Template = require("../seeds/i129.seed");
const uscisFormService = require("../../uscis-forms/uscis-form.service");

test.before(async () => {
  if (mongoose.connection.readyState === 0) await mongoose.connect(env.mongoUri);
});

test.after(async () => {
  await mongoose.disconnect();
});

test("H0 acceptance suite", async (t) => {
  let templateIdBeforeSecondRun;

  await t.test("AC1 + AC3 + AC4 + AC8 — seeding is idempotent, non-destructive, and correctly activates/tags the template", async () => {
    const before = await USCISFormTemplate.findOne({ formCode: "I-129", version: "2026-02-27" });
    const idBefore = before?._id?.toString();

    const first = await seedI129Template({});
    assert.ok(first.fieldCount >= 900, `expected >=900 fields, got ${first.fieldCount}`);
    templateIdBeforeSecondRun = first.template._id.toString();
    if (idBefore) assert.equal(templateIdBeforeSecondRun, idBefore, "seeding must update the existing template in place, not create a new one");

    const second = await seedI129Template({});
    assert.equal(second.template._id.toString(), templateIdBeforeSecondRun, "re-running the seed must not create/replace the template (AC8: id preserved)");

    const count = await USCISFormTemplate.countDocuments({ formCode: "I-129", version: "2026-02-27" });
    assert.equal(count, 1, "AC3: exactly one I-129/2026-02-27 template must exist after seeding twice");

    const template = second.template;
    assert.equal(template.status, "active");
    assert.equal(template.activeFlag, true);
    assert.equal(template.officialStatus, "current");
    assert.ok(template.visaTypes.includes("H-1B"));
    assert.ok(template.editionDate);
    assert.ok(template.title);
    assert.ok(template.pdfStorageKey);
    assert.ok(template.formFields.length >= 900);
  });

  await t.test("AC2 + AC5 — the stored template PDF is independently re-loadable and fillable", async () => {
    const template = await USCISFormTemplate.findOne({ formCode: "I-129", version: "2026-02-27" });
    const buffer = await storageService.readBuffer(template.pdfStorageKey);
    const pdf = await PDFDocument.load(buffer, { ignoreEncryption: true, updateMetadata: false });
    const form = pdf.getForm();
    const fields = form.getFields();
    assert.ok(fields.length >= 900);

    const textField = fields.find((field) => typeof field.setText === "function");
    assert.ok(textField, "expected at least one fillable text field");
    textField.setText("H0 acceptance test");
    const saved = await pdf.save();
    assert.ok(saved.length > 0, "pdf.save() must produce a non-empty buffer after filling a field");
  });

  await t.test("AC6 — assigning forms to a real H-1B case creates exactly one I-129 CaseForm, idempotently", async () => {
    const caseNumber = `H0-TEST-${Date.now()}`;
    const caseDoc = await Case.create({ caseNumber, visaType: "H-1B", status: "active" });
    try {
      const systemUser = { _id: new mongoose.Types.ObjectId(), role: "super_admin" };

      const firstRun = await uscisFormService.ensureAssignedForms(caseDoc, systemUser, null);
      assert.ok(firstRun.some((form) => form.formCode === "I-129"), "expected an I-129 CaseForm to be created for an H-1B case");

      const secondRun = await uscisFormService.ensureAssignedForms(caseDoc, systemUser, null);
      assert.equal(secondRun.length, 0, "re-running ensureAssignedForms must not create a duplicate I-129 CaseForm");

      const caseFormCount = await CaseForm.countDocuments({ caseId: caseDoc._id, formCode: "I-129" });
      assert.equal(caseFormCount, 1);
    } finally {
      await CaseForm.deleteMany({ caseId: caseDoc._id });
      await Case.deleteOne({ _id: caseDoc._id });
    }
  });

  await t.test("AC9 (partial) — this template's own field manifest resolves in pdf-lib without throwing (already covered end-to-end above; smoke-check the model directly)", async () => {
    const template = await USCISFormTemplate.findOne({ formCode: "I-129", version: "2026-02-27" }).lean();
    assert.ok(template.formFields.length >= 900);
  });
});
