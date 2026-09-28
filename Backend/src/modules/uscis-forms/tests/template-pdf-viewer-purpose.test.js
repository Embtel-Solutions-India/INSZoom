const assert = require("node:assert/strict");
const test = require("node:test");
const crypto = require("node:crypto");
const USCISFormTemplate = require("../../../models/USCISFormTemplate");
const storageService = require("../../uploads/storage.service");
const ViewerPdfPreparationService = require("../../form-generation/services/ViewerPdfPreparationService");
const controller = require("../uscis-form.controller");

// GET /api/uscis-forms/:id/pdf without ?purpose must keep serving the exact
// stored official blank PDF (the signed download URL uses it) - only
// ?purpose=viewer may transform the bytes.
const STORED_BYTES = Buffer.from("%PDF-1.7\n% official stored template bytes\n");
const VIEWER_BYTES = Buffer.from("%PDF-1.7\n% viewer-prepared bytes\n");

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function fakeRes() {
  return {
    headers: {},
    body: null,
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    send(body) { this.body = body; },
  };
}

function stubTemplate(t) {
  t.mock.method(USCISFormTemplate, "findById", () => ({
    select: () => ({
      lean: async () => ({
        _id: "tpl-1",
        formCode: "I-129",
        version: "2026-02-27",
        artifacts: { form: { storageKey: "government/uscis/I-129/form.pdf", checksum: "abc" } },
      }),
    }),
  }));
}

test("P1: default template PDF bytes are byte-identical to the stored artifact", async (t) => {
  stubTemplate(t);
  t.mock.method(storageService, "readBuffer", async () => STORED_BYTES);
  const prepare = t.mock.method(ViewerPdfPreparationService, "prepareViewerPdf", async () => {
    throw new Error("must not be called without purpose=viewer");
  });
  const res = fakeRes();
  let nextError = null;
  await controller.getTemplatePdf({ params: { id: "tpl-1" }, query: {} }, res, (error) => { nextError = error; });
  assert.equal(nextError, null);
  assert.equal(sha256(res.body), sha256(STORED_BYTES));
  assert.equal(prepare.mock.callCount(), 0);
  assert.equal(res.headers["x-viewer-recipe"], undefined);
});

test("P1: purpose=viewer serves the prepared copy and caches it by checksum + recipe", async (t) => {
  stubTemplate(t);
  const reads = [];
  t.mock.method(storageService, "readBuffer", async (key) => {
    reads.push(key);
    if (key.startsWith("uscis-forms/viewer-full/")) {
      throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    }
    return STORED_BYTES;
  });
  const stored = [];
  t.mock.method(storageService, "storeBuffer", async (key, buffer) => { stored.push({ key, buffer }); return { key }; });
  t.mock.method(ViewerPdfPreparationService, "prepareViewerPdf", async ({ rawBuffer, pagesToKeep }) => {
    assert.equal(sha256(rawBuffer), sha256(STORED_BYTES));
    assert.equal(pagesToKeep, null);
    return { buffer: VIEWER_BYTES, report: { strategy: "full", pageMap: [] } };
  });
  const res = fakeRes();
  let nextError = null;
  await controller.getTemplatePdf({ params: { id: "tpl-1" }, query: { purpose: "viewer" } }, res, (error) => { nextError = error; });
  assert.equal(nextError, null);
  assert.equal(sha256(res.body), sha256(VIEWER_BYTES));
  assert.equal(stored.length, 1);
  assert.equal(stored[0].key, `uscis-forms/viewer-full/tpl-1/abc-r${ViewerPdfPreparationService.VIEWER_PDF_RECIPE_VERSION}.pdf`);
  assert.equal(res.headers["x-viewer-recipe"], String(ViewerPdfPreparationService.VIEWER_PDF_RECIPE_VERSION));
  assert.match(res.headers["access-control-expose-headers"], /X-Viewer-Page-Map/);
});
