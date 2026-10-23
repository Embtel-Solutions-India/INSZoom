const USCISFormTemplate = require("../../models/USCISFormTemplate");
const storageService = require("../uploads/storage.service");

// The library shows exactly what Form Governance serves to cases: per form code, the active edition, newest first.
const FIELDS = "formCode title formName editionDate version updatedAt artifacts.form.storageKey pdfStorageKey";

// Some stored titles were read from the first line of the PDF text ("For", "To be completed by an", "START HERE ...") and some are cut off. The list shows the official USCIS name instead.
const OFFICIAL_TITLES = {
  "G-28": "Notice of Entry of Appearance as Attorney or Accredited Representative",
  "G-325A": "Biographic Information",
  "I-102": "Application for Replacement/Initial Nonimmigrant Arrival-Departure Document",
  "I-129": "Petition for a Nonimmigrant Worker",
  "I-131": "Application for Travel Document",
  "I-131A": "Application for Carrier Documentation",
  "I-140": "Immigrant Petition for Alien Workers",
  "I-191": "Application for Relief Under Former Section 212(c) of the Immigration and Nationality Act",
  "I-192": "Application for Advance Permission to Enter as a Nonimmigrant",
  "I-485": "Application to Register Permanent Residence or Adjust Status",
  "I-485J": "Supplement J to Form I-485 - Confirmation of Bona Fide Job Offer or Request for Job Portability",
  "I-589": "Application for Asylum and for Withholding of Removal",
};

function displayTitle(template) {
  const code = String(template.formCode).toUpperCase();
  if (OFFICIAL_TITLES[code]) return OFFICIAL_TITLES[code];
  const stored = String(template.title || template.formName || "").replace(/\s+/g, " ").trim();
  const cleaned = stored.replace(new RegExp("\\s*\\(" + code.replace(/-/g, "[-]") + "\\)\\s*$", "i"), "").trim();
  const placeholder = !cleaned || cleaned.toUpperCase() === code || /^USCIS Form /i.test(cleaned) || cleaned.length < 12;
  return placeholder ? "USCIS Form " + code : cleaned;
}

const hasPdf = (template) => Boolean(template?.artifacts?.form?.storageKey || template?.pdfStorageKey);
const time = (template) => new Date(template.editionDate || template.updatedAt || 0).getTime();

// One entry per form code (the latest active edition that has a stored PDF), sorted by form code.
function latestPerForm(templates) {
  const byCode = new Map();
  for (const template of templates) {
    if (!template?.formCode || !hasPdf(template)) continue;
    const code = String(template.formCode).toUpperCase();
    const current = byCode.get(code);
    if (!current || time(template) > time(current)) byCode.set(code, template);
  }
  return [...byCode.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, template]) => template);
}

async function listForms() {
  const templates = await USCISFormTemplate.find({ status: "active" }).select(FIELDS).lean();
  return latestPerForm(templates).map((template) => ({
    formCode: String(template.formCode).toUpperCase(),
    title: displayTitle(template),
    editionDate: template.editionDate || null,
  }));
}

async function readFormPdf(formCode) {
  const wanted = String(formCode || "").trim();
  if (!wanted || wanted.length > 40) return null;
  const escaped = wanted.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const templates = await USCISFormTemplate.find({ status: "active", formCode: new RegExp(`^${escaped}$`, "i") }).select(FIELDS).lean();
  const template = latestPerForm(templates)[0];
  if (!template) return null;
  const buffer = await storageService.readBuffer(template.artifacts?.form?.storageKey || template.pdfStorageKey);
  return { buffer, filename: `${String(template.formCode).toUpperCase()}.pdf` };
}

module.exports = { listForms, readFormPdf, latestPerForm, displayTitle };
