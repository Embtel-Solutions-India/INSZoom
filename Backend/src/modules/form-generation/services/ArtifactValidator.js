// Phase 7.6a: does the FINAL PDF - not just the stored answers - look right? One independent check of a rendered form, run on the output bytes. It never trusts the
// renderer's own report: it reopens the file and measures it.
//
//   ArtifactValidator.validate(pdfBuffer, { template, expected, ... }) -> { ok, failures: [{ check, field?, detail }], advisories: [...], stats }
//
// Checks (each failure names its check):
//   INTEGRITY            the file reopens, has no leftover XFA data, and exposes at least as many fields as the template says it should (FIELD_COUNT_LOW)
//   PAGES                the page count equals the pages that were meant to be kept (PAGE_COUNT) and the pages keep the source's order (PAGE_ORDER, compared by page size);
//                        a different page count than the PREVIOUS edition is only an advisory (editions legitimately change length)
//   VALUE                every expected text / choice value is read back unchanged (VALUE_MISMATCH) - the full text, however long, is the product rule
//   TICK                 a ticked box is checked AND carries a visible appearance: its /AS names an on-state that exists in /AP /N (TICK_NOT_VISIBLE)
//   TEXT_OVERFLOW        a text value fits inside its widget at the font size the file really uses (single line: width; multi-line: wrapped height). Auto-size fields (font 0)
//                        are shrunk by the viewer itself and combed fields that hold exactly their boxes are not measured
//   PROTECTED_WRITTEN    a barcode / signature / USCIS-use-only box is never filled
//   FILING (opts.filing) no watermark text (WATERMARK_PRESENT) and the source file is the stored one (SOURCE_CHECKSUM_MISMATCH)
//
// Pure with respect to the database and the network. Used by the edition certification probe (form-release/artifactCertification.js) and exported for the filing path.
// FILING PATH USE: after rendering a filing copy, call validate(buffer, { template, expected, filing: true, sourceBytes, storedChecksum, watermarkLabels }) and refuse the
// copy when ok is false. Nothing in the download / package code calls it yet.
const crypto = require("crypto");
const { isProtectedField } = require("./ProtectedFieldPolicy");

const WIDGET_PADDING_PT = 4; // same border + padding allowance the renderer's own fitting uses
const FONT_SIZE_IN_DA = /([\d.]+)\s+Tf/;
const DEFAULT_WATERMARK_LABELS = ["ATTORNEY REVIEW"];

const kindOf = (field) => {
  const name = field?.constructor?.name || "";
  if (name.includes("TextField")) return "text";
  if (name.includes("CheckBox")) return "checkbox";
  if (name.includes("RadioGroup")) return "radio";
  if (name.includes("Dropdown")) return "dropdown";
  if (name.includes("OptionList")) return "optionList";
  if (name.includes("Signature")) return "signature";
  return "other";
};

function wrappedLineCount(font, text, size, maxWidth) {
  let lines = 0;
  for (const paragraph of String(text).split(/\r\n|\r|\n/)) {
    lines += 1;
    let lineWidth = 0;
    for (const word of paragraph.split(" ")) {
      const wordWidth = font.widthOfTextAtSize(`${word} `, size);
      if (lineWidth > 0 && lineWidth + wordWidth > maxWidth) { lines += 1; lineWidth = 0; }
      lineWidth += wordWidth;
      if (wordWidth > maxWidth) lines += Math.floor(wordWidth / maxWidth);
    }
  }
  return lines;
}

/** Pure. Does `text` fit a widget of `rect` at `size`? { fits, measurable }. `font` must expose widthOfTextAtSize (a pdf-lib standard font). */
function textFits({ font, text, size, rect, multiline }) {
  const availableWidth = rect.width - WIDGET_PADDING_PT;
  const availableHeight = rect.height - WIDGET_PADDING_PT;
  if (availableWidth <= 0 || availableHeight <= 0) return { fits: false, measurable: true };
  try {
    if (multiline) return { fits: wrappedLineCount(font, text, size, availableWidth) * size * 1.15 <= availableHeight + 0.01, measurable: true };
    return { fits: font.widthOfTextAtSize(text, size) <= availableWidth + 0.01, measurable: true };
  } catch (error) {
    return { fits: true, measurable: false }; // a character Helvetica cannot measure (non-Latin): reported as an advisory, never as a failure
  }
}

/** True when a ticked check box shows: /AS is a name other than Off and /AP /N has an entry of that name. */
function tickVisible(field, pdfLib) {
  const { PDFName, PDFDict } = pdfLib;
  try {
    const widgets = field.acroField.getWidgets();
    if (!widgets.length) return false;
    return widgets.some((widget) => {
      const as = widget.dict.get(PDFName.of("AS"));
      const asName = as && typeof as.decodeText === "function" ? as.decodeText() : String(as?.toString?.() || "").replace(/^\//, "");
      if (!asName || asName === "Off") return false;
      const ap = widget.dict.lookup(PDFName.of("AP"));
      const normal = ap instanceof PDFDict ? ap.lookup(PDFName.of("N")) : null;
      return normal instanceof PDFDict ? normal.has(PDFName.of(asName)) : false;
    });
  } catch (error) {
    return false;
  }
}

// every content stream of the page, decoded to text (best effort)
function pageText(page, pdfLib) {
  const { PDFName, PDFArray, PDFRawStream, decodePDFRawStream } = pdfLib;
  const chunks = [];
  try {
    const contents = page.node.lookup(PDFName.of("Contents"));
    const streams = contents instanceof PDFArray ? contents.asArray().map((ref) => page.node.context.lookup(ref)) : [contents];
    for (const stream of streams) {
      if (!stream) continue;
      const bytes = stream instanceof PDFRawStream ? decodePDFRawStream(stream).decode() : stream.getContents?.();
      if (bytes) chunks.push(Buffer.from(bytes).toString("latin1"));
    }
  } catch (error) { /* an unreadable stream cannot prove a watermark */ }
  return chunks.join("\n");
}

const hex = (text) => Buffer.from(text, "latin1").toString("hex").toUpperCase();

function hasWatermark(pdf, pdfLib, labels) {
  for (const page of pdf.getPages()) {
    const text = pageText(page, pdfLib);
    const upper = text.toUpperCase();
    for (const label of labels) {
      const wanted = String(label).toUpperCase();
      if (upper.includes(`(${wanted})`) || upper.includes(`<${hex(wanted)}>`)) return label;
    }
  }
  return null;
}

/**
 * opts: { template, expected: [{ pdfField, kind, value (what was meant to be written), text (what must be read back, text kinds) }],
 *         expectedFieldCount?, expectedPageCount?, sourcePageSizes? ([{width,height}] of the pages that should remain, in order), previous? ({ pageCount }),
 *         filing?, watermarkLabels?, sourceBytes?, storedChecksum?, pdfLib? }
 */
async function validate(pdfBuffer, opts = {}) {
  const pdfLib = opts.pdfLib || require("pdf-lib");
  const { PDFDocument, PDFName, StandardFonts } = pdfLib;
  const failures = [];
  const advisories = [];
  const stats = { fields: 0, pages: 0, checkedText: 0, measured: 0, autoSize: 0, ticks: 0, protectedFound: 0 };
  const add = (check, field, detail) => failures.push({ check, ...(field ? { field } : {}), detail });

  let pdf;
  try {
    pdf = await PDFDocument.load(pdfBuffer, { ignoreEncryption: true, updateMetadata: false });
  } catch (error) {
    return { ok: false, failures: [{ check: "INTEGRITY", detail: `the file does not reopen: ${String(error.message).slice(0, 160)}` }], advisories, stats };
  }
  // INTEGRITY. XFA is read BEFORE pdf.getForm(): pdf-lib deletes the XFA entry the moment the form is opened.
  try {
    const acro = pdf.catalog.lookup(PDFName.of("AcroForm"));
    if (acro && acro.has && acro.has(PDFName.of("XFA"))) add("INTEGRITY", null, "the file still carries XFA form data");
  } catch (error) { /* no AcroForm dictionary to inspect */ }
  const form = pdf.getForm();
  const fields = form.getFields();
  stats.fields = fields.length;
  stats.pages = pdf.getPageCount();
  const byName = new Map(fields.map((field) => [field.getName(), field]));
  if (Number.isFinite(opts.expectedFieldCount) && fields.length < opts.expectedFieldCount) add("FIELD_COUNT_LOW", null, `the file exposes ${fields.length} fields but ${opts.expectedFieldCount} were expected`);

  // PAGES
  if (Number.isFinite(opts.expectedPageCount) && stats.pages !== opts.expectedPageCount) add("PAGE_COUNT", null, `the file has ${stats.pages} pages but ${opts.expectedPageCount} were expected`);
  if (Array.isArray(opts.sourcePageSizes) && opts.sourcePageSizes.length === stats.pages) {
    const sizes = pdf.getPages().map((page) => page.getSize());
    const off = sizes.findIndex((size, index) => Math.abs(size.width - opts.sourcePageSizes[index].width) > 1 || Math.abs(size.height - opts.sourcePageSizes[index].height) > 1);
    if (off >= 0) add("PAGE_ORDER", null, `page ${off + 1} has a different size than the source page it should be (the pages are out of order or replaced)`);
  }
  if (opts.previous && Number.isFinite(opts.previous.pageCount) && opts.previous.pageCount !== stats.pages) advisories.push({ check: "PAGE_COUNT_CHANGED", detail: `${opts.previous.pageCount} pages in the previous edition, ${stats.pages} now` });

  // PROTECTED boxes are never filled
  for (const field of fields) {
    const meta = opts.template ? (opts.template.formFields || []).find((item) => (item.pdfFieldName || item.fieldName) === field.getName()) : undefined;
    if (!isProtectedField(field.getName(), opts.template?.formCode, meta)) continue;
    stats.protectedFound += 1;
    if (kindOf(field) === "text") { try { if (field.getText()) add("PROTECTED_WRITTEN", field.getName().split(".").pop(), "a protected (barcode / signature / USCIS-use) box holds text"); } catch (error) { /* unreadable */ } }
  }

  // VALUE / TICK / TEXT_OVERFLOW per expected entry
  let font = null;
  for (const item of opts.expected || []) {
    const field = byName.get(item.pdfField);
    const short = String(item.pdfField || "").split(".").pop();
    if (!field) { if (!item.mayBeAbsent) add("VALUE_MISMATCH", short, "the box is not in the file"); continue; }
    const kind = kindOf(field);
    try {
      if (kind === "checkbox") {
        stats.ticks += 1;
        const checked = field.isChecked();
        if (Boolean(item.value) !== checked) { add("VALUE_MISMATCH", short, `a ${item.value ? "ticked" : "unticked"} box reads back ${checked ? "ticked" : "unticked"}`); continue; }
        if (item.value && !tickVisible(field, pdfLib)) add("TICK_NOT_VISIBLE", short, "the box is ticked but has no visible tick appearance");
      } else if (kind === "radio") {
        const selected = field.getSelected();
        if (item.value != null && selected !== item.value) add("VALUE_MISMATCH", short, `the group reads back ${JSON.stringify(selected)} instead of ${JSON.stringify(item.value)}`);
      } else if (kind === "dropdown" || kind === "optionList") {
        const selected = [].concat(field.getSelected() || []);
        if (item.value != null && !selected.includes(item.value)) add("VALUE_MISMATCH", short, `the choice reads back ${JSON.stringify(selected)} instead of ${JSON.stringify(item.value)}`);
      } else if (kind === "text") {
        stats.checkedText += 1;
        const read = field.getText() ?? "";
        const wanted = item.text ?? item.value;
        if (wanted != null && read !== String(wanted)) { add("VALUE_MISMATCH", short, `read back ${read.length} characters, expected ${String(wanted).length} (the full text must survive)`); continue; }
        if (item.measure === false || !read) continue;
        const match = String(field.acroField.getDefaultAppearance() || "").match(FONT_SIZE_IN_DA);
        const size = match ? Number(match[1]) : 0;
        if (!size) { stats.autoSize += 1; continue; } // the viewer shrinks an auto-size box itself
        const widgets = field.acroField.getWidgets();
        if (!widgets.length) continue;
        const rect = widgets.map((widget) => widget.getRectangle()).reduce((a, b) => (b.width < a.width ? b : a));
        if (field.isCombed?.() && Number.isFinite(field.getMaxLength?.()) && read.length <= field.getMaxLength()) continue; // one character per printed box
        font = font || (await pdf.embedFont(StandardFonts.Helvetica));
        const result = textFits({ font, text: read, size, rect, multiline: Boolean(field.isMultiline?.()) });
        if (!result.measurable) { advisories.push({ check: "NOT_MEASURABLE", field: short, detail: "contains characters the standard font cannot measure" }); continue; }
        stats.measured += 1;
        if (!result.fits) add("TEXT_OVERFLOW", short, `the text does not fit its box at the font size in the file (${size} pt, box ${Math.round(rect.width)}x${Math.round(rect.height)})`);
      }
    } catch (error) {
      add("VALUE_MISMATCH", short, `could not be read back: ${String(error.message).slice(0, 100)}`);
    }
  }

  // FILING copy must be the clean official form
  if (opts.filing) {
    const label = hasWatermark(pdf, pdfLib, opts.watermarkLabels || DEFAULT_WATERMARK_LABELS);
    if (label) add("WATERMARK_PRESENT", null, `the filing copy carries the "${label}" watermark`);
    if (opts.storedChecksum && opts.sourceBytes) {
      const actual = crypto.createHash("sha256").update(opts.sourceBytes).digest("hex");
      if (actual !== String(opts.storedChecksum).toLowerCase()) add("SOURCE_CHECKSUM_MISMATCH", null, "the source PDF is not the stored, verified file");
    } else {
      advisories.push({ check: "SOURCE_CHECKSUM_NOT_CHECKED", detail: "no stored checksum to compare with" });
    }
  }

  return { ok: failures.length === 0, failures, advisories, stats };
}

module.exports = { validate, textFits, tickVisible, hasWatermark, DEFAULT_WATERMARK_LABELS };
