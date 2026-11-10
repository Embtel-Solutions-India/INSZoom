// A form whose saved copy is behind the case's data (the name / e-mail arrived through the client portal, a staff edit or a sync after the form was filled) must be
// refreshed before it is downloaded - the editor shows the live case data, the download used to show the stale copy. DB-free: the case model is a stub.
const test = require("node:test");
const assert = require("node:assert/strict");
const { prepareOfficialDownload, isBehindCanonical } = require("../services/OfficialFormDownloadService");

const PDF = Buffer.from("%PDF-1.7 filled");
const caseModel = (version) => ({ findById: () => ({ select: () => ({ lean: async () => ({ canonicalProfile: { version } }) }) }) });
const baseForm = (overrides = {}) => ({
  caseId: "case1", formCode: "G-1145", status: "under_review", versionNumber: 1,
  syncState: { lastSyncedAt: new Date(), stale: false, canonicalVersion: 2 },
  formTemplateId: { toObject: () => ({ formCode: "G-1145" }) },
  ...overrides,
});

function makeDeps({ form, caseVersion, generateCalls }) {
  return {
    adobeEnabled: false,
    Case: caseModel(caseVersion),
    AutoFillService: { generate: async (...args) => { generateCalls.push(args); } },
    PDFGenerationService: { loadCaseForm: async () => form, createGeneratedDocument: async () => ({}), audit: async () => {} },
    PDFRenderer: { renderFiling: async () => ({ buffer: PDF, renderReport: null }), render: async () => ({ buffer: PDF, renderReport: null }), loadTemplateBuffer: async () => PDF },
  };
}

test("isBehindCanonical: true only when the case's data version is higher than the version the form was filled from", async () => {
  assert.equal(await isBehindCanonical(baseForm(), { Case: caseModel(5) }), true);
  assert.equal(await isBehindCanonical(baseForm(), { Case: caseModel(2) }), false);
  assert.equal(await isBehindCanonical(baseForm(), { Case: caseModel(1) }), false);
});

test("isBehindCanonical: cannot tell -> false (old behaviour), never throws", async () => {
  assert.equal(await isBehindCanonical(null), false);
  assert.equal(await isBehindCanonical(baseForm({ caseId: undefined })), false);
  assert.equal(await isBehindCanonical(baseForm({ versionNumber: 0 }), { Case: caseModel(9) }), false);
  assert.equal(await isBehindCanonical(baseForm(), { Case: { findById: () => { throw new Error("db down"); } } }), false);
});

test("download: a form behind the case's data is refreshed first, from the stored profile (no slow rebuild)", async () => {
  const generateCalls = [];
  const result = await prepareOfficialDownload({ caseFormId: "f1", user: {}, req: {} }, makeDeps({ form: baseForm(), caseVersion: 5, generateCalls }));
  assert.equal(generateCalls.length, 1);
  assert.equal(generateCalls[0][4].regenerate, true);
  assert.equal(generateCalls[0][4].useStoredCanonical, true);
  assert.equal(result.mode, "pdf-lib");
});

test("download: a form that is up to date is not refreshed (no extra work)", async () => {
  const generateCalls = [];
  await prepareOfficialDownload({ caseFormId: "f1", user: {}, req: {} }, makeDeps({ form: baseForm(), caseVersion: 2, generateCalls }));
  assert.equal(generateCalls.length, 0);
});

test("download: a locked / filed form is never refreshed, even if the case moved on", async () => {
  const generateCalls = [];
  await prepareOfficialDownload({ caseFormId: "f1", user: {}, req: {} }, makeDeps({ form: baseForm({ status: "filed" }), caseVersion: 9, generateCalls }));
  assert.equal(generateCalls.length, 0);
});

test("download: if the refresh itself fails the form still downloads, with a warning", async () => {
  const generateCalls = [];
  const deps = makeDeps({ form: baseForm(), caseVersion: 5, generateCalls });
  deps.AutoFillService.generate = async () => { throw new Error("canonical busy"); };
  const result = await prepareOfficialDownload({ caseFormId: "f1", user: {}, req: {} }, deps);
  assert.equal(result.buffer, PDF);
  assert.match(result.warnings[0], /Could not refresh the form/);
});
