const assert = require("node:assert/strict");
const test = require("node:test");
const { PDFDocument } = require("pdf-lib");
const env = require("../../config/env");
const { normalizePdf } = require("../normalizePdf");

async function buildFillablePdf() {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([612, 792]);
  const form = pdfDoc.getForm();
  const field = form.createTextField("Pt1Line1a_LastName");
  field.addToPage(page, { x: 50, y: 700, width: 180, height: 20 });
  return Buffer.from(await pdfDoc.save());
}

test("normalizePdf round-trips a small fillable PDF and stays loadable by pdf-lib", async () => {
  const original = await buildFillablePdf();
  const normalized = await normalizePdf(original);

  assert.ok(Buffer.isBuffer(normalized));
  const pdf = await PDFDocument.load(normalized, { ignoreEncryption: true, updateMetadata: false });
  assert.equal(pdf.getPageCount(), 1);
  assert.equal(pdf.getForm().getFields().length, 1);
});

test("normalizePdf never mutates the input buffer", async () => {
  const original = await buildFillablePdf();
  const originalCopy = Buffer.from(original);
  await normalizePdf(original);
  assert.deepEqual(original, originalCopy);
});

test("normalizePdf is idempotent — normalizing an already-normalized PDF stays loadable", async () => {
  const original = await buildFillablePdf();
  const normalizedOnce = await normalizePdf(original);
  const normalizedTwice = await normalizePdf(normalizedOnce);

  const pdf = await PDFDocument.load(normalizedTwice, { ignoreEncryption: true, updateMetadata: false });
  assert.equal(pdf.getPageCount(), 1);
  assert.equal(pdf.getForm().getFields().length, 1);
});

test("normalizePdf rejects a non-PDF buffer before ever invoking qpdf", async () => {
  await assert.rejects(
    () => normalizePdf(Buffer.from("not a pdf")),
    (error) => error.code === "NORMALIZE_INPUT_NOT_PDF"
  );
});

test("normalizePdf throws QPDF_NOT_FOUND only when qpdf cannot be started even after a fresh re-probe and the bare name (injected, so the result does not depend on this machine having qpdf on PATH)", async () => {
  const original = await buildFillablePdf();
  const previousPath = env.qpdfPath;
  env.qpdfPath = "C:/definitely/not/a/real/qpdf/binary-does-not-exist.exe";
  const missing = async (binary) => { throw Object.assign(new Error(`spawn ${binary} ENOENT`), { code: "ENOENT", syscall: `spawn ${binary}`, path: binary }); };
  try {
    await assert.rejects(
      () => normalizePdf(original, { exec: missing, ensureQpdf: async () => null, mode: "off" }),
      (error) => error.code === "QPDF_NOT_FOUND" && error.cause === "tool_spawn"
    );
  } finally {
    env.qpdfPath = previousPath;
  }
});

test("normalizePdf heals a wrong QPDF_PATH by itself when qpdf is available another way (re-probe / PATH)", async (t) => {
  const original = await buildFillablePdf();
  const previousPath = env.qpdfPath;
  env.qpdfPath = "C:/definitely/not/a/real/qpdf/binary-does-not-exist.exe";
  try {
    let normalized;
    try { normalized = await normalizePdf(original, { mode: "off" }); } catch (error) { if (error.code === "QPDF_NOT_FOUND") return t.skip("no qpdf anywhere on this machine"); throw error; }
    assert.ok(Buffer.isBuffer(normalized));
  } finally {
    env.qpdfPath = previousPath;
  }
});
