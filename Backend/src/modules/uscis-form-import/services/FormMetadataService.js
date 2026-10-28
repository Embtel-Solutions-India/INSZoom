const { PDFParse } = require("pdf-parse");
const { PDFDocument } = require("pdf-lib");
const _ = require("lodash");

function parseEditionDate(value) {
  if (!value) return undefined;
  // the scanner passes a real Date; stringifying it would match no pattern below and silently drop the edition date
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? undefined : value;
  const normalized = String(value).trim();
  const isoMatch = normalized.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (isoMatch) {
    const [, year, month, day] = isoMatch;
    const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
    return Number.isNaN(date.getTime()) ? undefined : date;
  }
  const match = normalized.match(/(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/);
  if (!match) return undefined;
  const [, month, day, yearValue] = match;
  const year = yearValue.length === 2 ? Number(`20${yearValue}`) : Number(yearValue);
  const date = new Date(Date.UTC(year, Number(month) - 1, Number(day)));
  return Number.isNaN(date.getTime()) ? undefined : date;
}

// yyyy-mm-dd (UTC) - the ONE edition-date format used for a form's version and its stored file name ("i-129_2026-09-09.pdf")
function isoDate(date, fallback) {
  if (!date || Number.isNaN(date.getTime?.())) return fallback;
  return date.toISOString().slice(0, 10);
}

// A caller-supplied version that is really a date ("07/22/2025", "2026-9-9") is normalised to yyyy-mm-dd; anything else (a deliberate label) is kept.
function normalizeVersion(value) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  return /^[\d/ -]+$/.test(text) && parseEditionDate(text) ? isoDate(parseEditionDate(text)) : text;
}

// Which date is THE edition of the file being imported. The edition printed on the PDF itself describes the stored file, so it wins; the date USCIS shows on the
// form page is kept separately (publishedEditionDate) because the catalog sync compares the page against the page. Never silently "today": if neither source
// has a date the import date is used and marked as such so nothing downstream mistakes it for a real edition.
function resolveEdition({ printed, page, inputVersion, now = new Date() }) {
  const editionDate = printed || page || undefined;
  const source = printed ? "pdf" : page ? "uscis_page" : "import_date";
  const version = normalizeVersion(inputVersion) || isoDate(editionDate || now);
  return { editionDate, publishedEditionDate: page || undefined, editionDateSource: source, version };
}

function extractFormNumber(text = "") {
  const candidates = [
    text.match(/\bForm\s+([A-Z]{1,4}[- ]?\d{2,4}[A-Z]?)\b/i),
    text.match(/\b([A-Z]{1,4}[- ]?\d{2,4}[A-Z]?)\b/),
  ].filter(Boolean);
  return candidates[0]?.[1]?.replace(/\s+/g, "-").toUpperCase();
}

// The edition USCIS prints in the footer of every page. Current forms print "Form I-131  Edition 01/20/25  Page 1 of 14"; older ones print "Form G-28  09/17/18  Page 1 of 4"
// (or "Page 1 of 1  Form G-1650 06/03/25") without the word Edition. Only those footer shapes count: "Expires" is the OMB approval date and "Rev." / "Exp." (EOIR forms) are not
// USCIS editions, so none of them is read. Every page repeats the footer, so the most frequent date wins; a tie is ambiguous and yields nothing.
const EDITION_WORD_FOOTER = /Edition\s+(?:Date\s*)?:?\s*(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})/gi;
const PLAIN_FOOTERS = [
  /\bForm\s+[A-Z]{1,4}-?\d+[A-Z]*\s+(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})(?:\s+[A-Za-z])?\s+Page\s+\d+\s+of\s+\d+/gi,
  /Page\s+\d+\s+of\s+\d+\s+Form\s+[A-Z]{1,4}-?\d+[A-Z]*\s+(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})/gi,
];
function extractEditionDate(text = "") {
  const source = String(text);
  const editionWord = [...source.matchAll(EDITION_WORD_FOOTER)];
  const matches = editionWord.length ? editionWord : PLAIN_FOOTERS.flatMap((pattern) => [...source.matchAll(pattern)]);
  const counts = new Map();
  const counted = new Set(); // one footer can match two shapes; count each printed date once, by position
  for (const match of matches) {
    const at = match.index + match[0].lastIndexOf(match[1]);
    if (counted.has(at)) continue;
    counted.add(at);
    const parsed = parseEditionDate(match[1]);
    if (parsed) counts.set(parsed.getTime(), (counts.get(parsed.getTime()) || 0) + 1);
  }
  const ranked = [...counts.entries()].sort((x, y) => y[1] - x[1]);
  if (!ranked.length || (ranked[1] && ranked[1][1] === ranked[0][1])) return undefined;
  return new Date(ranked[0][0]);
}

// The footer line itself ("Form I-485 Sup J  Edition 09/18/26"), verbatim, for an edition; null when no footer prints it. Used as the quote in the audit trail.
function footerEditionQuote(text = "", editionIso) {
  const source = String(text);
  const editionWord = [...source.matchAll(EDITION_WORD_FOOTER)];
  const matches = editionWord.length ? editionWord : PLAIN_FOOTERS.flatMap((pattern) => [...source.matchAll(pattern)]);
  for (const match of matches) {
    const parsed = parseEditionDate(match[1]);
    if (!parsed || parsed.toISOString().slice(0, 10) !== editionIso) continue;
    const before = source.slice(Math.max(0, match.index - 30), match.index).split(/\r?\n/).pop();
    return `${before}${match[0]}`.replace(/\s+/g, " ").trim();
  }
  return null;
}

// pdf-parse v2 API (the same call USCISFormComponentDiscoveryService uses). The buffer is copied because pdf.js may detach the one it is given.
async function readPdfText(buffer) {
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  try {
    return (await parser.getText()).text || "";
  } finally {
    await parser.destroy();
  }
}

// Page furniture that can sit right after the form number but is never a title ("For USCIS Only" box, agency banner, OMB / expiry line).
const TITLE_NOISE = /^(for\s+uscis\s+(use\s+)?only|department of homeland security|u\.?\s?s\.?\s+citizenship and immigration services|omb\s+no|expires\b|page\s+\d|form\s+[a-z]{1,4}-?\d+[a-z]?(\s|$)|start here)/i;

function extractTitle(text = "", formNumber) {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const formLineIndex = lines.findIndex((line) => formNumber && line.toUpperCase().includes(formNumber));
  const afterForm = lines.slice(formLineIndex + 1).find((line) => !TITLE_NOISE.test(line) && line.length >= 8);
  const candidates = [
    afterForm,
    lines.find((line) => !TITLE_NOISE.test(line) && /petition|application|request|notice|registration|supplement/i.test(line)),
  ].filter(Boolean);
  return candidates[0] || (formNumber ? `USCIS Form ${formNumber}` : "USCIS Form");
}

function buildSections(fields = []) {
  const sectionsById = new Map();
  fields.forEach((field) => {
    const sectionId = field.sectionId || "general";
    if (!sectionsById.has(sectionId)) {
      sectionsById.set(sectionId, {
        sectionId,
        key: sectionId,
        title: sectionId === "general" ? "General" : _.startCase(sectionId.replace(/^part/i, "Part ")),
        order: sectionsById.size,
        repeatable: false,
        fields: [],
        pages: new Set(),
      });
    }
    const section = sectionsById.get(sectionId);
    section.fields.push(field.fieldId);
    if (field.pageNumber) section.pages.add(field.pageNumber);
  });
  return [...sectionsById.values()].map((section) => ({
    ...section,
    pages: [...section.pages].sort((a, b) => a - b),
    fieldCount: section.fields.length,
  }));
}

class FormMetadataService {
  async extract(buffer, input = {}, scanResult = {}) {
    let parsedText = "";
    let pdfVersion;
    let info = {};
    try {
      parsedText = await readPdfText(buffer);
    } catch {
      parsedText = "";
    }
    let pdfDoc;
    try {
      pdfDoc = await PDFDocument.load(buffer, { ignoreEncryption: true });
      pdfVersion = pdfVersion || pdfDoc.context?.header?.version;
    } catch {
      pdfDoc = null;
    }
    const formNumber = String(input.formType || input.formCode || input.formNumber || extractFormNumber(parsedText) || "").trim().toUpperCase();
    const { editionDate, publishedEditionDate, editionDateSource, version } = resolveEdition({
      printed: extractEditionDate(parsedText),
      page: input.editionDate ? parseEditionDate(input.editionDate) : undefined,
      inputVersion: input.version,
    });
    const revisionDate = input.revisionDate ? parseEditionDate(input.revisionDate) : editionDate;
    const formName = input.formName || input.title || extractTitle(parsedText, formNumber);
    const sections = scanResult.sections?.length ? scanResult.sections : buildSections(scanResult.fields || []);
    const pages = scanResult.pages?.length
      ? scanResult.pages
      : Array.from({ length: scanResult.pageCount || pdfDoc?.getPageCount?.() || 0 }, (_, index) => ({
        pageNumber: index + 1,
        sectionIds: sections.filter((section) => section.pages.includes(index + 1)).map((section) => section.sectionId),
        fieldCount: (scanResult.fields || []).filter((field) => field.pageNumber === index + 1).length,
      }));
    return {
      formCode: formNumber,
      formNumber,
      formName,
      title: formName,
      editionDate,
      publishedEditionDate,
      editionDateSource,
      revisionDate,
      version,
      provider: input.provider || "uscis",
      pageCount: scanResult.pageCount || pdfDoc?.getPageCount?.() || 0,
      uscisIdentifier: formNumber,
      pdfVersion,
      fileSize: buffer.length,
      importDate: new Date(),
      pdfInfo: info,
      sourcePdfUrl: input.pdfUrl || input.sourcePdfUrl,
      sourcePageUrl: input.pageUrl || input.sourcePageUrl,
      sections,
      formStructure: scanResult.structure || {
        sections,
        pages,
        groups: scanResult.groups || [],
        repeatableGroups: scanResult.repeatableGroups || [],
        dependencies: scanResult.dependencies || [],
        indexes: scanResult.indexes || {},
      },
    };
  }
}

module.exports = FormMetadataService;
module.exports.resolveEdition = resolveEdition;
module.exports.normalizeVersion = normalizeVersion;
module.exports.isoDate = isoDate;
module.exports.parseEditionDate = parseEditionDate;
module.exports.extractEditionDate = extractEditionDate;
module.exports.readPdfText = readPdfText;
module.exports.footerEditionQuote = footerEditionQuote;
module.exports.extractTitle = extractTitle;
