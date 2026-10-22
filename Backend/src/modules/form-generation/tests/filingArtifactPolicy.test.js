// Phase 7.1: filing downloads and filing packages (FORM_PIPELINE_AUTONOMY). DB-free: every dependency is injected. Does not depend on qpdf, PDFFidelityService
// or the PDFRenderer tests (they are never run here).
const test = require("node:test");
const assert = require("node:assert/strict");
const Policy = require("../services/FilingArtifactPolicy");
const FilingPackageService = require("../services/FilingPackageService");
const { prepareOfficialDownload } = require("../services/OfficialFormDownloadService");

const PDF = Buffer.from("%PDF-1.7 filled");
const BLANK = Buffer.from("%PDF-1.7 blank");

async function withMode(value, fn) {
  const before = process.env.FORM_PIPELINE_AUTONOMY;
  if (value === undefined) delete process.env.FORM_PIPELINE_AUTONOMY; else process.env.FORM_PIPELINE_AUTONOMY = value;
  try { return await fn(); } finally { if (before === undefined) delete process.env.FORM_PIPELINE_AUTONOMY; else process.env.FORM_PIPELINE_AUTONOMY = before; }
}

const silentLog = () => { const calls = []; return { calls, warn: (event, data) => calls.push({ event, data }), info() {}, error() {} }; };

function downloadDeps({ status, renderFilingFails = false, renderFails = false } = {}) {
  const stored = { documents: 0 };
  const caseForm = { _id: "cf1", caseId: "case1", formCode: "I-129", status, syncState: { lastSyncedAt: new Date(), stale: false }, formTemplateId: { toObject: () => ({ formCode: "I-129" }) } };
  return {
    stored,
    deps: {
      adobeEnabled: false,
      PDFGenerationService: { loadCaseForm: async () => caseForm, createGeneratedDocument: async () => { stored.documents += 1; return { _id: "d" }; }, audit: async () => {} },
      PDFRenderer: {
        renderFiling: async () => { if (renderFilingFails) throw new Error("PDF fidelity check failed"); return { buffer: PDF, renderReport: null }; },
        render: async () => { if (renderFails) throw new Error("render failed"); return { buffer: PDF, renderReport: null }; },
        loadTemplateBuffer: async () => BLANK,
      },
    },
  };
}

// ---------- pure policy ----------
test("which forms are filing forms: ready_for_pdf, locked, finalized, filed or explicitly locked; never drafts or review copies", () => {
  for (const status of ["ready_for_pdf", "locked", "finalized", "filed"]) assert.equal(Policy.isFilingForm({ status }), true, status);
  assert.equal(Policy.isFilingForm({ status: "draft", isLocked: true }), true);
  for (const status of ["pending", "draft", "ai_filled", "in_review", "under_review", "needs_revision", "approved", "generated", "archived"]) assert.equal(Policy.isFilingForm({ status }), false, status);
  assert.equal(Policy.isFilingForm(null), false);
});

test("a package is a filing package only when no watermark was asked for", () => {
  assert.equal(Policy.isFilingPackage(""), true);
  assert.equal(Policy.isFilingPackage(undefined), true);
  assert.equal(Policy.isFilingPackage("  "), true);
  assert.equal(Policy.isFilingPackage("DRAFT"), false);
});

test("assessDownload: only the fallback modes of a filing form are a problem", () => {
  assert.equal(Policy.assessDownload({ caseForm: { status: "locked" }, mode: "pdf-lib" }).ok, true);
  assert.equal(Policy.assessDownload({ caseForm: { status: "locked" }, mode: "adobe" }).ok, true);
  assert.deepEqual(Policy.assessDownload({ caseForm: { status: "locked" }, mode: "pdf-lib-unverified" }).problems.map((p) => p.code), ["FILING_DOWNLOAD_NOT_VERIFIED"]);
  assert.deepEqual(Policy.assessDownload({ caseForm: { status: "filed" }, mode: "blank-template" }).problems.map((p) => p.code), ["FILING_DOWNLOAD_BLANK_FORM"]);
  // a review copy is never judged
  assert.equal(Policy.assessDownload({ caseForm: { status: "under_review" }, mode: "blank-template" }).ok, true);
});

test("carriesWatermark reads the stored watermark label", () => {
  assert.equal(Policy.carriesWatermark({ watermark: "FINAL" }), true);
  assert.equal(Policy.carriesWatermark({ watermark: "ATTORNEY REVIEW" }), true);
  assert.equal(Policy.carriesWatermark({ watermark: null }), false);
  assert.equal(Policy.carriesWatermark({ watermark: "" }), false);
  assert.equal(Policy.carriesWatermark(undefined), false);
});

// ---------- official download ----------
test("official download, switch off: a filing form that fell back to the blank form is served exactly as today", () => withMode(undefined, async () => {
  const { deps } = downloadDeps({ status: "locked", renderFilingFails: true, renderFails: true });
  const result = await prepareOfficialDownload({ caseFormId: "cf1", user: {}, req: {} }, deps);
  assert.equal(result.mode, "blank-template");
  assert.equal(result.buffer, BLANK);
}));

test("official download, shadow: same result, plus a would-refuse warning", () => withMode("shadow", async () => {
  const { deps } = downloadDeps({ status: "locked", renderFilingFails: true });
  const log = silentLog();
  deps.filingPolicy = { assessDownload: Policy.assessDownload, enforce: (assessment, options) => Policy.enforce(assessment, { ...options, log }) };
  const result = await prepareOfficialDownload({ caseFormId: "cf1", user: {}, req: {} }, deps);
  assert.equal(result.mode, "pdf-lib-unverified");
  assert.equal(log.calls.length, 1);
  assert.equal(log.calls[0].event, "form_filing_artifact_would_refuse");
  assert.deepEqual(log.calls[0].data.problems, ["FILING_DOWNLOAD_NOT_VERIFIED"]);
}));

test("official download, on: a filing form that did not pass the strict check is refused with a 409 and nothing is stored", () => withMode("on", async () => {
  for (const [options, code] of [[{ renderFilingFails: true }, "FILING_DOWNLOAD_NOT_VERIFIED"], [{ renderFilingFails: true, renderFails: true }, "FILING_DOWNLOAD_BLANK_FORM"]]) {
    const { deps, stored } = downloadDeps({ status: "locked", ...options });
    await assert.rejects(() => prepareOfficialDownload({ caseFormId: "cf1", user: {}, req: {} }, deps), (error) => {
      assert.equal(error.status, 409);
      assert.equal(error.code, "FILING_ARTIFACT_NOT_VALIDATED");
      assert.equal(error.problems[0].code, code);
      return true;
    });
    assert.equal(stored.documents, 0);
  }
}));

test("official download, on: a verified filing copy, and every review copy (even degraded), are still served", () => withMode("on", async () => {
  const verified = downloadDeps({ status: "filed" });
  assert.equal((await prepareOfficialDownload({ caseFormId: "cf1", user: {}, req: {} }, verified.deps)).mode, "pdf-lib");
  const review = downloadDeps({ status: "under_review", renderFilingFails: true, renderFails: true });
  const result = await prepareOfficialDownload({ caseFormId: "cf1", user: {}, req: {} }, review.deps);
  assert.equal(result.mode, "blank-template");
}));

// ---------- filing packages ----------
const formItem = { caseFormId: "cf1", documentId: "doc1", title: "I-129", type: "form" };
const evidenceItem = { documentId: "ev1", title: "Passport copy", type: "evidence" };
const watermarked = { watermark: "FINAL" };
const packageDeps = (extra = {}) => ({
  logger: silentLog(),
  documentMetadata: async (item) => (item.documentId === "doc1" ? watermarked : null),
  loadCaseForm: async () => ({ formTemplateId: { toObject: () => ({}) } }),
  renderer: { renderFiling: async () => ({ buffer: Buffer.from("%PDF-clean") }) },
  ...extra,
});

test("filing package, switch off: nothing is rebuilt and nothing is looked up", () => withMode(undefined, async () => {
  let looked = 0;
  const map = await FilingPackageService.cleanFormBuffers([formItem], { watermark: "" }, packageDeps({ documentMetadata: async () => { looked += 1; return watermarked; } }));
  assert.equal(map.size, 0);
  assert.equal(looked, 0);
}));

test("review / draft package (a watermark was asked for): never touched, whatever the switch says", () => withMode("on", async () => {
  const map = await FilingPackageService.cleanFormBuffers([formItem], { watermark: "DRAFT" }, packageDeps({ renderer: { renderFiling: async () => { throw new Error("must not render"); } } }));
  assert.equal(map.size, 0);
}));

test("filing package, shadow: logs would-rebuild for a watermarked form and still returns nothing", () => withMode("shadow", async () => {
  const deps = packageDeps();
  const map = await FilingPackageService.cleanFormBuffers([formItem, evidenceItem], { watermark: "" }, deps);
  assert.equal(map.size, 0);
  assert.deepEqual(deps.logger.calls.map((call) => call.event), ["form_filing_artifact_would_rebuild"]);
}));

test("filing package, on: a form item is rebuilt from the clean verified render; evidence is left alone", () => withMode("on", async () => {
  const map = await FilingPackageService.cleanFormBuffers([formItem, evidenceItem], { watermark: "" }, packageDeps());
  assert.equal(map.size, 1);
  assert.equal(map.get(formItem).toString(), "%PDF-clean");
  assert.equal(map.has(evidenceItem), false);
}));

test("filing package, on: a form that cannot be rebuilt (fidelity failure) refuses the whole package", () => withMode("on", async () => {
  const deps = packageDeps({ renderer: { renderFiling: async () => { throw Object.assign(new Error("PDF fidelity check failed: field X"), { code: "PDF_FIDELITY_FAILURE" }); } } });
  await assert.rejects(() => FilingPackageService.cleanFormBuffers([formItem, evidenceItem], { watermark: "" }, deps), (error) => {
    assert.equal(error.status, 409);
    assert.equal(error.code, "FILING_ARTIFACT_NOT_VALIDATED");
    assert.equal(error.problems[0].code, "PDF_FIDELITY_FAILURE");
    assert.match(error.message, /I-129/);
    return true;
  });
}));

test("filing package, on: a watermarked component that has no form behind it to rebuild from refuses the package", () => withMode("on", async () => {
  const stray = { documentId: "doc1", title: "Form G-28", type: "g28" };
  await assert.rejects(() => FilingPackageService.cleanFormBuffers([stray], { watermark: "" }, packageDeps()), (error) => error.problems[0].code === "FILING_PACKAGE_WATERMARKED_COMPONENT");
  // a clean (un-watermarked) uploaded document is fine
  const clean = await FilingPackageService.cleanFormBuffers([{ documentId: "ev1", title: "Signed G-28", type: "g28" }], { watermark: "" }, packageDeps());
  assert.equal(clean.size, 0);
}));
