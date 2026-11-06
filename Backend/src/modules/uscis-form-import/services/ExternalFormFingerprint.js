// "Is this a NEW version of the form?" for a form that prints no edition date (the DOL ETA-9089 forms). Two levels, both cheap and deterministic:
//   sha256    the raw bytes of the downloaded file - any change at all (including a re-save that only touched metadata);
//   content   a hash of what the form SAYS: page count + every fillable box (name and kind) + the normalized text. Re-saving or re-compressing the same form changes sha256 but not content.
// A new sha256 with the SAME content is "re-issued, identical": recorded, but no new version is created (a new version would re-run mapping/certification and migrate every open case for nothing).
// A different content is a real revision. The OMB expiration date printed on the form is read for information only; it is part of the text, so a renewal that changes it AND the wording is a
// revision like any other, but it is never used as an edition date or compared on its own.
// Pure of the database. The PDF helpers are injectable for tests.
const crypto = require("crypto");

const sha = (value) => crypto.createHash("sha256").update(value).digest("hex");
const normalizeText = (text) => String(text || "").replace(/\f/g, "\n").replace(/[\u0000-\u0008\u000b\u000e-\u001f�]/g, " ").replace(/\s+/g, " ").trim().toLowerCase();

/** Pure. The OMB "Expiration Date: MM/DD/YYYY" printed on the form (the most frequent one), as an ISO day, or null. Information only. */
function ombExpirationOf(text) {
  const counts = new Map();
  for (const match of String(text || "").matchAll(/Expiration\s+Date:?\s*(\d{1,2})\/(\d{1,2})\/(\d{4})/gi)) {
    const iso = `${match[3]}-${String(match[1]).padStart(2, "0")}-${String(match[2]).padStart(2, "0")}`;
    counts.set(iso, (counts.get(iso) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
}

/** Pure. The fingerprint from already-extracted parts. */
function fromParts({ sha256, pageCount, fields, text }) {
  const fieldLines = [...(fields || [])].map((field) => `${field.type}|${String(field.name).replace(/\s+/g, " ").trim()}`).sort();
  const fieldsHash = sha(fieldLines.join("\n"));
  const normalized = normalizeText(text);
  const textHash = sha(normalized);
  return {
    sha256,
    pageCount: Number(pageCount) || 0,
    fieldCount: fieldLines.length,
    fieldsHash,
    textHash,
    content: sha(`${Number(pageCount) || 0}|${fieldsHash}|${textHash}`),
    ombExpiration: ombExpirationOf(text),
  };
}

/** The fingerprint of a downloaded PDF. Throws only when the PDF cannot be read at all (the caller treats that as a failed check, never a new version). */
async function fingerprintOf(buffer, deps = {}) {
  const normalize = deps.normalize || (async (bytes) => require("../../../utils/normalizePdf").normalizePdf(bytes));
  const readText = deps.readText || ((bytes) => require("./FormMetadataService").readPdfText(bytes));
  let readable = buffer;
  try { readable = await normalize(buffer); } catch (_error) { readable = buffer; } // qpdf trouble: the raw bytes are tried below
  const { PDFDocument } = require("pdf-lib");
  const doc = await PDFDocument.load(readable, { ignoreEncryption: true, updateMetadata: false });
  const fields = doc.getForm().getFields().map((field) => ({ type: field.constructor.name, name: field.getName() }));
  let text = "";
  try { text = await readText(readable); } catch (_error) { text = ""; }
  return fromParts({ sha256: sha(buffer), pageCount: doc.getPageCount(), fields, text });
}

/**
 * Pure. What changed between the stored fingerprint and a new one: { same, sameContent, reason }.
 *   same          byte-identical file
 *   sameContent   different bytes, same pages / boxes / text  -> "identical_reissue" (no new version)
 *   reason        identical | identical_reissue | pages_changed | fields_changed | text_changed | no_baseline
 */
function compare(previous, next) {
  if (!previous || !previous.content) return { same: false, sameContent: false, reason: "no_baseline" };
  if (previous.sha256 && previous.sha256 === next.sha256) return { same: true, sameContent: true, reason: "identical" };
  if (previous.content === next.content) return { same: false, sameContent: true, reason: "identical_reissue" };
  if (previous.pageCount !== next.pageCount) return { same: false, sameContent: false, reason: "pages_changed" };
  if (previous.fieldsHash !== next.fieldsHash) return { same: false, sameContent: false, reason: "fields_changed" };
  return { same: false, sameContent: false, reason: "text_changed" };
}

module.exports = { fingerprintOf, fromParts, compare, ombExpirationOf, normalizeText };
