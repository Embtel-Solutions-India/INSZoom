const pdfParse = require("pdf-parse");
const { PDFDocument } = require("pdf-lib");
const _ = require("lodash");

function parseEditionDate(value) {
  if (!value) return undefined;
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

function isoDateVersion(date, fallback) {
  if (!date) return fallback;
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const year = date.getUTCFullYear();
  return `${month}/${day}/${year}`;
}

function extractFormNumber(text = "") {
  const candidates = [
    text.match(/\bForm\s+([A-Z]{1,4}[- ]?\d{2,4}[A-Z]?)\b/i),
    text.match(/\b([A-Z]{1,4}[- ]?\d{2,4}[A-Z]?)\b/),
  ].filter(Boolean);
  return candidates[0]?.[1]?.replace(/\s+/g, "-").toUpperCase();
}

function extractEditionDate(text = "") {
  const patterns = [
    /Edition\s+(?:Date\s*)?:?\s*(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})/i,
    /Expires\s+(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})/i,
    /Rev(?:ision)?\.?\s*(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    const parsed = parseEditionDate(match?.[1]);
    if (parsed) return parsed;
  }
  return undefined;
}

function extractTitle(text = "", formNumber) {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const formLineIndex = lines.findIndex((line) => formNumber && line.toUpperCase().includes(formNumber));
  const candidates = [
    lines[formLineIndex + 1],
    lines.find((line) => /petition|application|request|notice|registration|supplement/i.test(line)),
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
      const parsed = await pdfParse(buffer);
      parsedText = parsed.text || "";
      info = parsed.info || {};
      pdfVersion = parsed.version;
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
    const editionDate = input.editionDate ? parseEditionDate(input.editionDate) : extractEditionDate(parsedText);
    const revisionDate = input.revisionDate ? parseEditionDate(input.revisionDate) : editionDate;
    const version = String(input.version || isoDateVersion(editionDate, undefined) || new Date().toISOString().slice(0, 10));
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
