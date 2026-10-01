const test = require("node:test");
const assert = require("node:assert/strict");
const { prepareOfficialDownload, withTimeout } = require("../services/OfficialFormDownloadService");

const PDF = Buffer.from("%PDF-1.7 filled");
const BLANK = Buffer.from("%PDF-1.7 blank");

function makeDeps(overrides = {}) {
  const caseForm = {
    caseId: "case1",
    formCode: "I-907",
    status: "under_review",
    syncState: { lastSyncedAt: new Date(), stale: false },
    formTemplateId: { toObject: () => ({ formCode: "I-907" }) },
  };
  return {
    adobeEnabled: false,
    PDFGenerationService: {
      loadCaseForm: async () => caseForm,
      createGeneratedDocument: async () => ({ _id: "doc1" }),
      audit: async () => {},
    },
    PDFRenderer: {
      renderFiling: async () => ({ buffer: PDF, renderReport: null }),
      render: async () => ({ buffer: PDF, renderReport: null }),
      loadTemplateBuffer: async () => BLANK,
    },
    ...overrides,
  };
}

const run = (deps) => prepareOfficialDownload({ caseFormId: "f1", user: {}, req: {} }, deps);

test("normal download: strict pdf-lib render, no warnings", async () => {
  const result = await run(makeDeps());
  assert.equal(result.mode, "pdf-lib");
  assert.equal(result.buffer, PDF);
  assert.deepEqual(result.warnings, []);
});

test("Adobe failing (e.g. a read-only field) falls back to the standard engine", async () => {
  const deps = makeDeps({
    adobeEnabled: true,
    AdobeFormRenderer: { renderFiling: async () => { throw new Error("Adobe form-fill job failed: field is read only, cannot be set"); } },
  });
  const result = await run(deps);
  assert.equal(result.mode, "pdf-lib");
  assert.equal(result.buffer, PDF);
  assert.match(result.warnings[0], /Adobe form-fill service could not process this form.*read only/);
});

test("a strict-accuracy failure still downloads the form, with a warning", async () => {
  const deps = makeDeps();
  deps.PDFRenderer.renderFiling = async () => { throw new Error("PDF fidelity check failed: field X"); };
  const result = await run(deps);
  assert.equal(result.mode, "pdf-lib-unverified");
  assert.equal(result.buffer, PDF);
  assert.match(result.warnings[0], /strict accuracy check/);
});

test("if nothing can fill the form, the blank official USCIS form is downloaded", async () => {
  const deps = makeDeps({ adobeEnabled: true, AdobeFormRenderer: { renderFiling: async () => { throw new Error("adobe down"); } } });
  deps.PDFRenderer.renderFiling = async () => { throw new Error("render broke"); };
  deps.PDFRenderer.render = async () => { throw new Error("render broke too"); };
  const result = await run(deps);
  assert.equal(result.mode, "blank-template");
  assert.equal(result.buffer, BLANK);
  assert.ok(result.warnings.some((w) => /blank official USCIS form/.test(w)));
});

test("a failed data refresh, document save or audit never blocks the download", async () => {
  const deps = makeDeps({
    AutoFillService: { generate: async () => { throw new Error("autofill exploded"); } },
  });
  const form = await deps.PDFGenerationService.loadCaseForm();
  form.syncState = { stale: true, lastSyncedAt: new Date() };
  deps.PDFGenerationService.createGeneratedDocument = async () => { throw new Error("storage down"); };
  deps.PDFGenerationService.audit = async () => { throw new Error("audit down"); };
  const result = await run(deps);
  assert.equal(result.mode, "pdf-lib");
  assert.equal(result.buffer, PDF);
  assert.ok(result.warnings.some((w) => /Could not refresh the form/.test(w)));
  assert.ok(result.warnings.some((w) => /could not be saved to the case documents/.test(w)));
});

test("a missing form is still an error (nothing to download)", async () => {
  const deps = makeDeps();
  deps.PDFGenerationService.loadCaseForm = async () => { throw Object.assign(new Error("Case form not found"), { status: 404 }); };
  await assert.rejects(run(deps), /Case form not found/);
});

test("field-level adjustments are reported alongside a successful download", async () => {
  const deps = makeDeps();
  deps.PDFRenderer.renderFiling = async () => ({
    buffer: PDF,
    renderReport: {
      adjustedFieldWrites: [{ pdfField: "form1[0].#subform[0].ZipCode[0]", reason: "ZIP shortened to 5 digits" }],
      failedFieldWrites: [{ pdfField: "form1[0].#subform[8].P4_Line9b_Email[0]", message: "value is 25 characters but the PDF field allows 15; left blank" }],
    },
  });
  const result = await run(deps);
  assert.equal(result.mode, "pdf-lib");
  assert.ok(result.warnings.some((w) => /^P4_Line9b_Email:/.test(w)));
  assert.ok(result.warnings.some((w) => /^ZipCode:/.test(w)));
});

test("withTimeout rejects a hung renderer", async () => {
  await assert.rejects(withTimeout(new Promise(() => {}), 20, "Adobe form fill"), /timed out/);
  assert.equal(await withTimeout(Promise.resolve("ok"), 1000, "x"), "ok");
});

test("deferred bookkeeping: the file is ready before the copy is saved, and saving runs only when asked", async () => {
  const deps = makeDeps();
  let saved = 0;
  deps.PDFGenerationService.createGeneratedDocument = async () => { saved += 1; return { _id: "doc1" }; };
  const result = await prepareOfficialDownload({ caseFormId: "f1", user: {}, req: {}, deferBookkeeping: true }, deps);
  assert.equal(result.buffer, PDF);
  assert.equal(saved, 0);
  assert.equal(typeof result.bookkeeping, "function");
  await result.bookkeeping();
  assert.equal(saved, 1);
});
