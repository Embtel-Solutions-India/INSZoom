// Phase 7.E: the pure-JavaScript alternative to qpdf for normalizing a USCIS PDF, used ONLY when qpdf cannot be started at all (after a fresh re-probe).
// pdf-lib reads the file through an empty-password encryption wrapper (ignoreEncryption), drops the XFA layer on save and writes without object streams, so the
// result is loadable by the rest of the pipeline. It is accepted only when it keeps exactly the same pages and the same set of form-field names as the input
// (compareStructure), so a fallback can never silently lose a box. Never mutates its input. No I/O, no child process.
const { PDFDocument } = require("pdf-lib");

const LOAD_OPTIONS = { ignoreEncryption: true, updateMetadata: false };

// pdf-lib can read THROUGH an empty-password wrapper only for files whose strings and streams are not actually enciphered; a really encrypted file comes out unreadable
// (field names garbled or missing). Decrypting needs qpdf, so the fallback refuses such input instead of returning something that looks right.
const ENCRYPTED = /\/Encrypt\s*(\d+\s+\d+\s+R|<<)/;
const isEncrypted = (buffer) => ENCRYPTED.test(buffer.toString("latin1"));

async function describeBuffer(buffer) {
  const pdf = await PDFDocument.load(buffer, LOAD_OPTIONS);
  const names = pdf.getForm().getFields().map((field) => field.getName());
  return { pages: pdf.getPageCount(), fields: names.length, names };
}

/** { buffer, report } - the re-saved PDF and what it contains. Throws when pdf-lib cannot read the input. */
async function normalize(inputBuffer) {
  if (!Buffer.isBuffer(inputBuffer)) throw Object.assign(new Error("normalizeFallback expects a PDF Buffer"), { code: "NORMALIZE_INPUT_NOT_PDF" });
  if (isEncrypted(inputBuffer)) throw Object.assign(new Error("this PDF is encrypted; only qpdf can decrypt it, so the JavaScript normalizer is not used"), { code: "NORMALIZE_FALLBACK_ENCRYPTED", cause: "fallback_unsupported" });
  const pdf = await PDFDocument.load(inputBuffer, LOAD_OPTIONS);
  const bytes = await pdf.save({ useObjectStreams: false, updateFieldAppearances: false });
  const buffer = Buffer.from(bytes);
  return { buffer, report: await describeBuffer(buffer) };
}

/** { ok, reasons[], before, after }: same page count, same number of fields and the identical set of field names. */
async function compareStructure(originalBuffer, normalizedBuffer) {
  const before = await describeBuffer(originalBuffer);
  const after = await describeBuffer(normalizedBuffer);
  const reasons = [];
  if (before.pages !== after.pages) reasons.push(`page count ${before.pages} -> ${after.pages}`);
  if (before.fields !== after.fields) reasons.push(`field count ${before.fields} -> ${after.fields}`);
  const afterSet = new Set(after.names);
  const missing = before.names.filter((name) => !afterSet.has(name));
  if (missing.length) reasons.push(`missing fields: ${missing.slice(0, 5).join(", ")}${missing.length > 5 ? " ..." : ""}`);
  return { ok: reasons.length === 0, reasons, before: { pages: before.pages, fields: before.fields }, after: { pages: after.pages, fields: after.fields } };
}

/** Convenience: the fallback normalization, verified against the input. Throws NORMALIZE_FALLBACK_MISMATCH when it would lose pages or fields. */
async function normalizeVerified(inputBuffer) {
  const { buffer, report } = await normalize(inputBuffer);
  const comparison = await compareStructure(inputBuffer, buffer);
  if (!comparison.ok) {
    throw Object.assign(new Error(`the JavaScript normalizer changed the form structure (${comparison.reasons.join("; ")}); not used`), { code: "NORMALIZE_FALLBACK_MISMATCH", cause: "fallback_mismatch" });
  }
  return { buffer, report };
}

module.exports = { isEncrypted, normalize, compareStructure, normalizeVerified, describeBuffer };
