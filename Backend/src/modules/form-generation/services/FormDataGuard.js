// FormDataGuard - the "no saved value is ever lost on download" safety net.
//
// Owner rule (2026-11-11): every value saved on a case form - text, number, date, checkbox, radio, dropdown - must reach the downloaded file. A value can fail
// to reach a PDF box for reasons that are not the person's fault:
//
//   reason (code)            what happened                                                            how it is handled
//   ----------------------   ----------------------------------------------------------------------   -------------------------------------------------------
//   no_mapping (orphan)      the value is saved on the form but no template mapping reads it          listed as orphan1, orphan2, ... (this case only; nothing
//                                                                                                     is added to the shared canonical paths / mappings)
//   pdf_field_missing        the mapping names a PDF box that is not in this edition's PDF            first retried against the PDF's own box names ignoring
//                                                                                                     upper/lower case and stray spaces (PDFRenderer); else listed
//   removed_with_page        the box lives on a supplement page this download does not include        listed (unless the supplement's own form holds the value)
//   choice_not_available     a radio / dropdown value is not one of the form's printed choices        dropdowns get the value added as a choice (PDFRenderer);
//                                                                                                     radios are listed
//   write_failed             writing the box raised an error                                          listed
//   readback_mismatch        the box was written but reads back different                              retried once (PDFRenderer); else listed
//   held_back_by_rule        the form's own condition ("only if ...") kept the value out               listed, so a stale/unreachable answer is still visible
//   overwritten              two answers map to the same box; one replaced the other                  the replaced answer is listed
//   form_not_filled          the form could not be filled at all (blank-template last resort)         EVERY saved value is listed
//   protected_box            a value is saved for a barcode / signature / USCIS-use-only box           never written into the box (that corrupts the form); listed
//   not_displayable          text a standard PDF font cannot draw (e.g. Chinese, Devanagari)          stored exactly in the box; viewers rebuild the look; listed
//   empty override (staff)   the native PDF editor saved a box as EMPTY over a real value              LiveFormValues restores the live / previous value
//   staff-typed value        a person typed an answer into a box                                       ALWAYS written - even if the box's "only if" rule says no
//   auto-filled value        the live view has a value the saved copy never received                   written (LiveFormValues) unless a person typed something
//
// Everything that still could not be placed is recorded in the download log (with its value) and named in the warning. (Opt-in only: appended as last page(s) + attachment.) Nothing here ever throws into the download: any problem inside this module
// yields a warning and the original file is served unchanged.
const MappingResolver = require("../../form-mapping/services/MappingResolver");
const PDFFieldMapper = require("./PDFFieldMapper");

const MAX_ENTRIES = 5000;
const REASON_TEXT = {
  no_mapping: "saved on this form, but no form box reads it",
  pdf_field_missing: "its box is not in this edition of the PDF",
  removed_with_page: "its box is on a supplement page that is not part of this download",
  choice_not_available: "not one of the choices printed on the form",
  write_failed: "the box could not be written",
  readback_mismatch: "the box did not keep the value",
  held_back_by_rule: "held back by the form's own condition",
  overwritten: "replaced by another answer mapped to the same box",
  form_not_filled: "the form could not be filled automatically",
  protected_box: "saved for a protected box (barcode / signature / USCIS-use-only) that must not be written into",
  not_displayable: "the box holds the exact text, but a standard PDF font cannot draw these characters",
};

/** A value that carries information. An unchecked box (false) or an empty answer is not data that can be lost. */
function isSignificant(value) {
  if (value === undefined || value === null || value === false) return false;
  if (typeof value === "string") return value.trim() !== "" && value.trim().toLowerCase() !== "false";
  if (Array.isArray(value)) return value.some(isSignificant);
  if (typeof value === "object") return Object.values(value).some(isSignificant);
  return true; // numbers (including 0), true, dates
}

function plain(value) {
  if (!value) return {};
  if (value instanceof Map) return Object.fromEntries(value);
  if (typeof value.toObject === "function") return value.toObject();
  return value;
}

const norm = (path) => String(path || "").replace(/\[(\d+)\]/g, ".$1");

/** Every significant leaf of the saved answers as [dotPath, value]. Arrays of plain values stay one entry. */
function leafValues(data, prefix = "", out = []) {
  if (out.length >= MAX_ENTRIES * 5) return out;
  if (data instanceof Date) { out.push([prefix, data.toISOString().slice(0, 10)]); return out; }
  if (Array.isArray(data)) {
    if (data.every((item) => item === null || typeof item !== "object")) { if (isSignificant(data)) out.push([prefix, data]); return out; }
    data.forEach((item, index) => leafValues(item, prefix ? `${prefix}.${index}` : String(index), out));
    return out;
  }
  if (data && typeof data === "object") {
    for (const [key, value] of Object.entries(data)) {
      if (key.startsWith("_")) continue; // internal bookkeeping, never answers
      leafValues(value, prefix ? `${prefix}.${key}` : key, out);
    }
    return out;
  }
  if (isSignificant(data)) out.push([prefix, data]);
  return out;
}

/** Saved values no template mapping reads, numbered orphan1, orphan2, ... in a stable (path) order. */
function findOrphans(filledData, template) {
  const mapped = new Set();
  const prefixes = new Set();
  for (const mapping of PDFFieldMapper.normalizeTemplateMappings(template)) {
    const path = norm(mapping.caseField);
    mapped.add(path);
    const parts = path.split(".");
    for (let i = 1; i < parts.length; i += 1) prefixes.add(parts.slice(0, i).join("."));
  }
  const isRead = (path) => {
    if (mapped.has(path) || prefixes.has(path)) return true;
    const parts = path.split(".");
    for (let i = parts.length - 1; i > 0; i -= 1) if (mapped.has(parts.slice(0, i).join("."))) return true; // a mapping reads the parent object/array
    return false;
  };
  return leafValues(plain(filledData))
    .map(([path, value]) => [norm(path), value])
    .filter(([path]) => !isRead(path))
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([path, value], index) => ({ label: `orphan${index + 1}`, caseField: path, value, reason: "no_mapping" }));
}

const show = (value) => {
  if (value === true) return "Yes (checked)";
  if (Array.isArray(value)) return value.filter(isSignificant).map(show).join(", ");
  if (value && typeof value === "object") return JSON.stringify(value);
  return String(value ?? "");
};

/** Which unplaced values are NOT lost because the supplement's own CaseForm already holds them (read-only lookup; any failure keeps the entry). */
async function dropValuesHeldBySiblings(entries, caseForm, deps = {}) {
  const candidates = entries.filter((entry) => entry.reason === "removed_with_page");
  if (!candidates.length || !caseForm?.caseId) return entries;
  try {
    if (!deps.CaseForm && require("mongoose").connection.readyState !== 1) return entries;
    const CaseFormModel = deps.CaseForm || require("../../../models/CaseForm");
    const siblings = await CaseFormModel.find({ caseId: caseForm.caseId, _id: { $ne: caseForm._id }, componentCode: { $nin: [null, ""] } }).select("filledData").lean();
    if (!siblings.length) return entries;
    return entries.filter((entry) => {
      if (entry.reason !== "removed_with_page") return true;
      return !siblings.some((sibling) => {
        const held = MappingResolver.resolvePath(plain(sibling.filledData), entry.caseField);
        return isSignificant(held) && show(held) === show(entry.value);
      });
    });
  } catch (_error) {
    return entries;
  }
}

/** Builds the full list of values that did not reach a form box. Never throws. */
async function collectUnplaced({ caseForm, template, renderReport, mode }, deps = {}) {
  const entries = [];
  const seen = new Set();
  const add = (entry) => {
    if (!isSignificant(entry.value)) return;
    const key = `${entry.reason}|${entry.caseField}`;
    if (seen.has(key)) return;
    seen.add(key);
    entries.push(entry);
  };
  try {
    if (mode === "blank-template") {
      leafValues(plain(caseForm.filledData)).forEach(([path, value]) => add({ caseField: norm(path), value, reason: "form_not_filled" }));
      return entries.slice(0, MAX_ENTRIES);
    }
    // Owner rule: values for supplement pages belong ONLY in the supplement's own form, so a box on a page the core download cuts is expected, never a loss (no warning, no log).
    (renderReport?.unplacedWrites || []).forEach((item) => { if (item.reason !== "removed_with_page") add({ caseField: item.caseField, pdfField: item.pdfField, value: item.value, reason: item.reason }); });
    let mapping = null;
    try { mapping = PDFFieldMapper.mapFields(caseForm, template); } catch (_error) { mapping = null; }
    (mapping?.skippedFields || []).forEach((item) => add({ caseField: item.caseField, pdfField: item.pdfField, value: item.value, reason: "held_back_by_rule" }));
    // A protected box (barcode / signature / USCIS-use-only) holds the form's own built-in text, not case data, so it is listed ONLY when a person typed something into it.
    (mapping?.protectedFields || []).forEach((item) => { if (PDFFieldMapper.hasStaffValue(caseForm, item.caseField)) add({ caseField: item.caseField, pdfField: item.pdfField, value: item.value, reason: "protected_box" }); });
    (mapping?.collisions || []).forEach((item) => add({ caseField: item.lostCaseField, pdfField: item.pdfField, value: item.lostValue, reason: "overwritten" }));
    findOrphans(caseForm.filledData, template).forEach((orphan) => add(orphan));
  } catch (_error) {
    // never let the safety net break a download
  }
  // The extra page must carry only data that is really not in the file: a value already written in another box of the same file (a name repeated on a page that is not part of
  // this download) is not lost, and a tick on a page that is not part of the download is not case data worth a page.
  let kept = entries;
  try {
    const placedValues = new Set();
    const unplacedBoxes = new Set((renderReport?.unplacedWrites || []).map((item) => item.pdfField));
    const mapped = PDFFieldMapper.mapFields(caseForm, template).mappedFields || {};
    Object.values(mapped).forEach((item) => { if (!unplacedBoxes.has(item.pdfField) && typeof item.value === "string") placedValues.add(item.value.replace(/\s+/g, "").toLowerCase()); });
    kept = entries.filter((entry) => {
      if (entry.reason !== "removed_with_page" && entry.reason !== "pdf_field_missing" && entry.reason !== "held_back_by_rule") return true;
      if (typeof entry.value === "boolean" || String(entry.value).trim().toLowerCase() === "true") return entry.reason !== "removed_with_page";
      const text = String(Array.isArray(entry.value) ? entry.value.join(", ") : entry.value).replace(/\s+/g, "").toLowerCase();
      return !(text.length >= 3 && placedValues.has(text));
    });
  } catch (_error) { kept = entries; }
  return (await dropValuesHeldBySiblings(kept, caseForm, deps)).slice(0, MAX_ENTRIES);
}

// ---- the recovery pages ----------------------------------------------------
// Standard PDF fonts only encode Latin-1; anything else is shown as "?" on the page - the exact original text is always in the embedded JSON attachment.
const SUBSTITUTIONS = { "‘": "'", "’": "'", "“": '"', "”": '"', "–": "-", "—": "-", "…": "...", " ": " " };
const winAnsi = (text) => String(text ?? "").replace(/[\r\n\t]+/g, " ").replace(/[^\x20-\x7E\xA0-\xFF]/g, (ch) => SUBSTITUTIONS[ch] || "?");

function wrap(font, text, size, maxWidth) {
  const words = winAnsi(text).split(" ");
  const lines = [];
  let line = "";
  for (let word of words) {
    while (font.widthOfTextAtSize(word, size) > maxWidth) { // one very long token: break it by characters
      let cut = word.length - 1;
      while (cut > 1 && font.widthOfTextAtSize(word.slice(0, cut), size) > maxWidth) cut -= 1;
      if (line) { lines.push(line); line = ""; }
      lines.push(word.slice(0, cut));
      word = word.slice(cut);
    }
    const candidate = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) line = candidate;
    else { lines.push(line); line = word; }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

/** Appends the recovery page(s) + a lossless JSON attachment to the finished PDF. Returns the new buffer, or null if it could not be done. */
async function appendRecoveryPages(buffer, entries, { formCode, caseId } = {}) {
  const { PDFDocument, StandardFonts, rgb } = require("pdf-lib");
  const build = async (options) => {
    const pdf = await PDFDocument.load(buffer, { ignoreEncryption: true, updateMetadata: false });
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
    const W = 612, H = 792, M = 48;
    let page = null; let y = 0;
    const newPage = () => { page = pdf.addPage([W, H]); y = H - M; };
    const ensure = (need) => { if (!page || y - need < M) newPage(); };
    newPage();
    page.drawRectangle({ x: M - 8, y: y - 44, width: W - 2 * M + 16, height: 52, color: rgb(1, 0.95, 0.85), borderColor: rgb(0.85, 0.5, 0.1), borderWidth: 1 });
    page.drawText("INTERNAL DATA RECOVERY PAGE - NOT PART OF THE USCIS FORM", { x: M, y: y - 12, size: 11, font: bold, color: rgb(0.55, 0.25, 0) });
    page.drawText(winAnsi("Remove these pages before filing. They list case answers that could not be placed on a printed form box."), { x: M, y: y - 27, size: 8.5, font, color: rgb(0.3, 0.3, 0.3) });
    page.drawText(winAnsi(`${formCode || "Form"}${caseId ? ` | case ${caseId}` : ""} | ${entries.length} value(s) | exact text is also attached to this PDF as case-data-recovery.json`), { x: M, y: y - 39, size: 8, font, color: rgb(0.4, 0.4, 0.4) });
    y -= 64;
    const groups = new Map();
    entries.forEach((entry) => { const list = groups.get(entry.reason) || []; list.push(entry); groups.set(entry.reason, list); });
    for (const [reason, list] of groups) {
      ensure(40);
      page.drawText(winAnsi(`${reason === "no_mapping" ? "Orphan values" : REASON_TEXT[reason] || reason} (${list.length})`), { x: M, y, size: 10, font: bold, color: rgb(0.1, 0.1, 0.1) });
      y -= 15;
      for (const entry of list) {
        const head = entry.label ? `${entry.label}  ${entry.caseField}` : entry.caseField;
        const headLines = wrap(bold, head, 8.5, W - 2 * M);
        const valueLines = wrap(font, show(entry.value), 9, W - 2 * M - 14);
        ensure(headLines.length * 11 + valueLines.length * 11 + 6);
        headLines.forEach((line) => { page.drawText(line, { x: M, y, size: 8.5, font: bold, color: rgb(0.25, 0.25, 0.25) }); y -= 11; });
        valueLines.forEach((line) => { page.drawText(line, { x: M + 14, y, size: 9, font, color: rgb(0, 0, 0) }); y -= 11; });
        y -= 5;
      }
      y -= 6;
    }
    try {
      pdf.attach(Buffer.from(JSON.stringify({ formCode, caseId, generatedAt: new Date().toISOString(), values: entries.map((e) => ({ label: e.label || null, caseField: e.caseField, pdfField: e.pdfField || null, reason: e.reason, value: e.value })) }, null, 2), "utf8"), "case-data-recovery.json", { mimeType: "application/json", description: "Case values that could not be placed on a form box (exact text)", creationDate: new Date(), modificationDate: new Date() });
    } catch (_error) { /* the printed pages above still carry the values */ }
    return Buffer.from(await pdf.save(options));
  };
  try { return await build({}); } catch (_first) {
    try { return await build({ updateFieldAppearances: false }); } catch (_second) { return null; }
  }
}

// STRICT OWNER RULE (2026-11-11): the download button downloads ONLY the form - no extra page, no attachment, ever. The appended recovery page therefore exists only as an
// explicit opt-in (FORM_DOWNLOAD_RECOVERY_PAGE=on, never set in production); by default values that have no box are recorded in the download log (with their value) and named
// in the warning message, and the file is the form alone.
const recoveryPageEnabled = () => String(process.env.FORM_DOWNLOAD_RECOVERY_PAGE || "off").toLowerCase() === "on";

/**
 * The one call the download path makes after the PDF is built. Returns { buffer, entries, warnings }; `buffer` is the file to serve (the original when
 * there is nothing to add, or when anything here fails). Never throws.
 */
async function recover({ caseForm, template, result, mode }, deps = {}) {
  const outcome = { buffer: result.buffer, entries: [], warnings: [] };
  try {
    const entries = await collectUnplaced({ caseForm, template, renderReport: result.renderReport, mode }, deps);
    outcome.entries = entries;
    if (!entries.length) return outcome;
    const orphans = entries.filter((entry) => entry.reason === "no_mapping").length;
    const summary = `${entries.length} saved value(s) could not be placed on a form box${orphans ? ` (${orphans} orphan value(s) with no form box)` : ""}`;
    if (!recoveryPageEnabled()) { outcome.warnings.push(`${summary}; they are recorded in the download log and are not added to the file.`); return outcome; }
    const withPages = await appendRecoveryPages(result.buffer, entries, { formCode: caseForm.formCode, caseId: String(caseForm.caseId || "") });
    if (withPages) {
      outcome.buffer = withPages;
      outcome.warnings.push(`${summary}; they are listed on the last page of the downloaded file (internal - remove before filing).`);
    } else {
      outcome.warnings.push(`${summary}, and the recovery page could not be added; they are recorded in the download log.`);
    }
  } catch (error) {
    outcome.warnings.push(`The data-completeness check could not run (${error.message}); the form was downloaded as built.`);
  }
  return outcome;
}

module.exports = { recover, collectUnplaced, findOrphans, leafValues, isSignificant, appendRecoveryPages, REASON_TEXT, MAX_ENTRIES };
