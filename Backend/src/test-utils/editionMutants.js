// Phase 7 (7.8) synthetic edition mutants. Each generator is a PURE function: bytes of a PDF in, bytes of a changed PDF out - no database, no network, no files.
// Every result is labeled { synthetic: true, name, mutation, ... } so a synthetic file can never be mistaken for a real USCIS edition (the fixture manifest lists
// them under `synthetic`, separately from the verified real pairs).
const { PDFDocument, PDFName, PDFString, PDFHexString, PDFRadioGroup, PDFCheckBox } = require("pdf-lib");

const load = (bytes) => PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
const save = async (doc) => Buffer.from(await doc.save({ useObjectStreams: false }));
const result = (name, mutation, buffer, extra = {}) => ({ synthetic: true, name, mutation, contentType: "application/pdf", buffer, ...extra });

/** Renames fields; nothing else changes (same page, rectangle, value). `map` is { oldName: newName }. */
async function renameFields(bytes, map) {
  const doc = await load(bytes);
  const form = doc.getForm();
  const applied = {};
  for (const [from, to] of Object.entries(map)) {
    const field = form.getFields().find((item) => item.getName() === from);
    if (!field) continue;
    field.acroField.setPartialName(to);
    applied[from] = to;
  }
  return result("rename", { kind: "rename", fields: applied }, await save(doc));
}

/** Renumbers lines: every field whose name contains `<prefix><n>` gets n + shift (Pt2Line3a -> Pt2Line4a), e.g. a new line inserted above. */
async function renumberFields(bytes, { prefix, shift = 1, fromNumber = 0 }) {
  const doc = await load(bytes);
  const form = doc.getForm();
  const pattern = new RegExp(`(${prefix})(\\d+)`);
  const applied = {};
  for (const field of form.getFields()) {
    const name = field.getName();
    const match = name.match(pattern);
    if (!match || Number(match[2]) < fromNumber) continue;
    const next = name.replace(pattern, (_all, head, digits) => `${head}${Number(digits) + shift}`);
    field.acroField.setPartialName(next);
    applied[name] = next;
  }
  return result("renumber", { kind: "renumber", prefix, shift, fromNumber, fields: applied }, await save(doc));
}

/** Inserts a page at `index` that carries `headingText` (a supplement heading) and optionally one new text field. Other pages and fields are untouched. */
async function insertPage(bytes, { index, headingText = "Supplement Z", fieldName = null }) {
  const doc = await load(bytes);
  const page = doc.insertPage(Math.min(index, doc.getPageCount()), [612, 792]);
  page.drawText(headingText, { x: 50, y: 740, size: 14 });
  if (fieldName) {
    const field = doc.getForm().createTextField(fieldName);
    field.addToPage(page, { x: 50, y: 700, width: 200, height: 20 });
  }
  return result("inserted_page", { kind: "inserted_page", index, headingText, fieldName }, await save(doc), { pagesAdded: 1 });
}

/** Removes the named fields; nothing else changes. */
async function removeFields(bytes, names) {
  const doc = await load(bytes);
  const form = doc.getForm();
  const removed = [];
  for (const name of names) {
    const field = form.getFields().find((item) => item.getName() === name);
    if (!field) continue;
    form.removeField(field);
    removed.push(name);
  }
  return result("removed_field", { kind: "removed_field", fields: removed }, await save(doc))
}

/** Replaces a radio group with one of the same name and position whose options are `options` (a changed export-value set). */
async function changeRadioOptions(bytes, { groupName, options }) {
  const doc = await load(bytes);
  const form = doc.getForm();
  const group = form.getFields().find((item) => item.getName() === groupName && item instanceof PDFRadioGroup);
  if (!group) throw new Error(`radio group ${groupName} not found`);
  const before = group.getOptions();
  const widgets = group.acroField.getWidgets();
  const page = doc.getPages()[0];
  const rects = widgets.map((widget) => widget.getRectangle());
  form.removeField(group);
  const next = form.createRadioGroup(groupName);
  options.forEach((option, i) => {
    const rect = rects[i] || { x: 50 + i * 60, y: 600, width: 14, height: 14 };
    next.addOptionToPage(option, page, { x: rect.x, y: rect.y, width: rect.width, height: rect.height });
  });
  return result("radio_options_changed", { kind: "radio_options_changed", groupName, before, after: options }, await save(doc));
}

/** A PDF with an XFA form and no AcroForm fields (what a LiveCycle-only USCIS file looks like to the scanner: zero fields). */
async function xfaOnly(bytes) {
  const doc = await load(bytes);
  const form = doc.getForm();
  const removed = form.getFields().length;
  for (const field of [...form.getFields()]) form.removeField(field);
  const acro = doc.catalog.lookup(PDFName.of("AcroForm"));
  const xfa = doc.context.flateStream("<xdp:xdp xmlns:xdp=\"http://ns.adobe.com/xdp/\"><template/></xdp:xdp>");
  if (acro) acro.set(PDFName.of("XFA"), doc.context.register(xfa));
  return result("xfa_only", { kind: "xfa_only", fieldsRemoved: removed }, await save(doc));
}

/**
 * A PDF whose trailer carries an /Encrypt dictionary (a document-open password). pdf-lib cannot encrypt, so this is a MARKER only: it is detected as encrypted
 * by anything that looks at the trailer, but its content is not really enciphered. Use qpdf (--encrypt) in an integration test when real ciphertext matters.
 */
async function passwordProtected(bytes) {
  const doc = await load(bytes);
  const encrypt = doc.context.obj({ Filter: "Standard", V: 1, R: 2, P: -44, O: PDFHexString.of("00".repeat(32)), U: PDFHexString.of("00".repeat(32)) });
  doc.context.trailerInfo.Encrypt = doc.context.register(encrypt);
  return result("password_pdf", { kind: "password_pdf", marker: true, note: "trailer /Encrypt dictionary only; content is not enciphered" }, await save(doc));
}

/** What a soft-404 or error page looks like when the "PDF" url answers HTML (status 200, text/html). */
function htmlResponse({ title = "Page Not Found" } = {}) {
  const html = `<!doctype html><html><head><title>${title}</title></head><body><h1>${title}</h1><p>The page you requested could not be found.</p></body></html>`;
  return { synthetic: true, name: "html_response", mutation: { kind: "html_response", title }, contentType: "text/html", buffer: Buffer.from(html, "utf8") };
}

/** The same PDF followed by `extraBytes` of trailing comment padding (still a valid PDF: readers ignore bytes after %%EOF), to exceed a size cap. */
function oversize(bytes, { extraBytes }) {
  const padding = Buffer.alloc(Math.max(0, Number(extraBytes) || 0), 0x25); // '%' = a comment byte
  return { synthetic: true, name: "oversize", mutation: { kind: "oversize", extraBytes: padding.length }, contentType: "application/pdf", buffer: Buffer.concat([Buffer.from(bytes), Buffer.from("\n"), padding]) };
}

/** What the manifest lists: the generator names and the mutations they perform (no bytes). */
const CATALOG = Object.freeze([
  { generator: "renameFields", name: "rename", mutation: "one or more fields renamed; page, rectangle and value unchanged" },
  { generator: "renumberFields", name: "renumber", mutation: "line numbers shifted by n in every matching field name (a line inserted above)" },
  { generator: "insertPage", name: "inserted_page", mutation: "a page with a supplement heading (and optionally a new field) inserted" },
  { generator: "removeFields", name: "removed_field", mutation: "named fields removed" },
  { generator: "changeRadioOptions", name: "radio_options_changed", mutation: "a radio group re-created with a different export-value set" },
  { generator: "xfaOnly", name: "xfa_only", mutation: "all AcroForm fields removed and an XFA stream added (scans to zero fields)" },
  { generator: "passwordProtected", name: "password_pdf", mutation: "trailer /Encrypt marker (not real ciphertext)" },
  { generator: "htmlResponse", name: "html_response", mutation: "an HTML error page served with status 200" },
  { generator: "oversize", name: "oversize", mutation: "trailing padding after %%EOF to exceed a size cap" },
]);

module.exports = { renameFields, renumberFields, insertPage, removeFields, changeRadioOptions, xfaOnly, passwordProtected, htmlResponse, oversize, CATALOG };
