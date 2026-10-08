const { VISA_CATEGORIES, getCaseStructure, getSubTypes } = require("../../config/visaCategories");

// Pure logic: turns the GHL custom-field values on an opportunity into an
// Immiglance visa (or an honest "can't tell yet"). No database, no network.
//
// GHL today has `Service Type` (a category: Work Visa / Study Visa / Green
// Card / Business/Investment / Other) plus one detail field per category. In
// future Service Type itself will hold detailed values ("H-1B New", ...). Both
// are supported by the same editable mapping table; adding a future value is a
// new row, not a code change.
//
// Nothing is ever guessed: an unmapped, ambiguous or incomplete value leaves the
// visa pending for a team lead.

const FIELD_KEYS = {
  service_type: "opportunity.service_type",
  work_visa: "opportunity.work_visa",
  study_visa: "opportunity.study_visa",
  green_card: "opportunity.green_card",
  business__investment: "opportunity.business__investment",
};
const FIELD_NAMES = Object.keys(FIELD_KEYS);
const DETAIL_FIELDS = ["work_visa", "study_visa", "green_card", "business__investment"];
// Which detail field a Service Type category belongs to (used to catch contradictions).
const CATEGORY_TO_DETAIL = {
  "work visa": "work_visa",
  "study visa": "study_visa",
  "green card": "green_card",
  "business/investment": "business__investment",
};
const CATEGORIES = ["immigrant", "non_immigrant"];

const norm = (value) => String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");

// Seed rows for what GHL contains TODAY. Only visas that exist in
// VISA_CATEGORIES are listed (a test enforces that). Deliberately absent, because
// they would be a guess: P-1 (A or B?), CPT / Day 1 CPT (no such visa type),
// EB-5 (Standalone or Regional Center?), I-130 (which family category?).
const row = (field, value, visaType, category = "non_immigrant", petitionSubType = "") => ({ field, value, visaType, petitionSubType, category });
const DEFAULT_ENTRIES = [
  row("work_visa", "H-1B - Specialty Occupation", "H-1B"), // sub-type still needed -> "incomplete"
  row("work_visa", "L-1A", "L-1A"),
  row("work_visa", "L-1B - Intra-company Transfer", "L-1B"),
  row("work_visa", "O-1A", "O-1A"),
  row("work_visa", "O-1B - Extraordinary Ability", "O-1B"),
  row("work_visa", "O-2 - Essential Support", "O-2"),
  row("work_visa", "R-1 - Religious Worker", "R-1"),
  row("work_visa", "TN - NAFTA Professionals", "TN"),
  row("work_visa", "E-3 - Australian Professionals", "E-3"),
  row("study_visa", "F-1 - Academic Student", "F-1"),
  row("study_visa", "OPT", "F-1 OPT"),
  row("study_visa", "STEM OPT", "F-1 STEM OPT"),
  row("study_visa", "J-1 - Exchange Visitor", "J-1"),
  row("study_visa", "M-1 - Vocational Training", "M-1"),
  row("green_card", "EB-1A - Extraordinary Ability", "EB-1A", "immigrant"),
  row("green_card", "EB-1B - Outstanding Professor", "EB-1B", "immigrant"),
  row("green_card", "EB-1C - Multinational Executive", "EB-1C", "immigrant"),
  row("green_card", "EB-2", "EB-2", "immigrant"),
  row("green_card", "EB-3 - Employment Based", "EB-3", "immigrant"),
  row("green_card", "EB-2 NIW - National Interest", "EB-2 NIW", "immigrant"),
  row("green_card", "EB-4 - Special Immigrant", "EB-4", "immigrant"),
  row("business__investment", "E-1 - Treaty Trader", "E-1"),
  row("business__investment", "B-1", "B-1"),
  row("business__investment", "B-2 - Visitor Visa", "B-2"),
  row("business__investment", "E-2 - Treaty Investor", "E-2"),
  row("business__investment", "L-1A", "L-1A"),
  row("business__investment", "L-1B - New Office", "L-1B"),
];

const defaultEntries = () => DEFAULT_ENTRIES.map((e) => ({ ...e }));

// GHL returns custom fields as [{ id, type, fieldValueString | fieldValue | value }].
function readFieldValue(entry) {
  const raw = entry?.fieldValueString ?? entry?.fieldValue ?? entry?.value;
  if (Array.isArray(raw)) return raw.length === 1 ? String(raw[0]) : raw.map(String).join(", ");
  return raw === undefined || raw === null ? "" : String(raw);
}

// { field name -> value } for the five fields we care about, using the id -> name table.
function extractFieldValues(customFields, fieldIds) {
  const idToName = new Map(Object.entries(fieldIds || {}).map(([name, id]) => [id, name]));
  const values = {};
  for (const entry of Array.isArray(customFields) ? customFields : []) {
    const name = idToName.get(entry?.id);
    if (name) values[name] = readFieldValue(entry).trim();
  }
  return values;
}

function findEntry(entries, field, value) {
  const wanted = norm(value);
  return (entries || []).find((e) => e.field === field && norm(e.value) === wanted) || null;
}

const result = (status, reason, extra = {}) => ({ status, reason, ...extra });

// Adds structure / sub-type checks to a matched mapping row.
function describeMatch(entry, field, value, pipelineCategory) {
  const visaType = entry.visaType;
  const structure = getCaseStructure(visaType);
  const base = {
    visaType,
    petitionSubType: entry.petitionSubType || "",
    structure: structure || null,
    category: entry.category || null,
    field,
    value,
    categoryMismatch: Boolean(pipelineCategory && entry.category && entry.category !== pipelineCategory),
  };
  if (!structure) return result("unmapped", `Mapped visa "${visaType}" is not a known visa type`, base);
  const subTypes = getSubTypes(visaType) || [];
  if (subTypes.length && !entry.petitionSubType) {
    return result("incomplete", `${visaType} needs a sub-type (for example ${subTypes[0]})`, base);
  }
  if (entry.petitionSubType && subTypes.length && !subTypes.includes(entry.petitionSubType)) {
    return result("unmapped", `"${entry.petitionSubType}" is not a ${visaType} sub-type`, base);
  }
  return result("mapped", `${visaType} from ${field}`, base);
}

/**
 * @param customFields  the opportunity's GHL custom fields array
 * @param fieldIds      { service_type: "<id>", work_visa: "<id>", ... } resolved from GHL's field definitions
 * @param entries       the editable mapping table
 * @param pipelineCategory  "immigrant" | "non_immigrant": where GHL put the opportunity
 * @returns { status, reason, ...details } with status one of
 *   mapped | incomplete | unmapped | ambiguous | none | unavailable
 */
function resolveVisa({ customFields, fieldIds, entries, pipelineCategory } = {}) {
  if (!fieldIds || !Object.keys(fieldIds).length) {
    return result("unavailable", "GHL custom field definitions are not available (token scope or setup)");
  }
  const values = extractFieldValues(customFields, fieldIds);
  const serviceType = values.service_type || "";
  const filledDetails = DETAIL_FIELDS.filter((field) => values[field]);

  // Future: Service Type itself carries the detailed value ("H-1B New").
  if (serviceType) {
    const direct = findEntry(entries, "service_type", serviceType);
    if (direct) return describeMatch(direct, "service_type", serviceType, pipelineCategory);
  }

  if (filledDetails.length > 1) {
    return result("ambiguous", `More than one visa field is filled (${filledDetails.join(", ")})`, { serviceType });
  }
  if (filledDetails.length === 1) {
    const field = filledDetails[0];
    const expected = CATEGORY_TO_DETAIL[norm(serviceType)];
    if (serviceType && expected && expected !== field) {
      return result("ambiguous", `Service Type "${serviceType}" contradicts the filled ${field} field`, { serviceType });
    }
    const entry = findEntry(entries, field, values[field]);
    if (!entry) return result("unmapped", `GHL value "${values[field]}" (${field}) has no visa mapping`, { field, value: values[field], serviceType });
    return describeMatch(entry, field, values[field], pipelineCategory);
  }
  if (serviceType) return result("incomplete", `Service Type "${serviceType}" has no specific visa chosen yet`, { serviceType });
  return result("none", "No visa information on the opportunity");
}

// Validates an admin-supplied mapping table. Returns { ok, errors, entries }.
function validateEntries(input) {
  const errors = [];
  if (!Array.isArray(input)) return { ok: false, errors: ["entries must be an array"], entries: [] };
  if (input.length > 500) return { ok: false, errors: ["too many entries (max 500)"], entries: [] };
  const seen = new Set();
  const entries = [];
  input.forEach((raw, index) => {
    const at = `Row ${index + 1}`;
    const field = String(raw?.field || "").trim();
    const value = String(raw?.value || "").trim();
    const visaType = String(raw?.visaType || "").trim();
    const petitionSubType = String(raw?.petitionSubType || "").trim();
    const category = String(raw?.category || "").trim();
    if (!FIELD_NAMES.includes(field)) errors.push(`${at}: unknown field "${field}"`);
    if (!value) errors.push(`${at}: value is required`);
    if (!VISA_CATEGORIES[visaType]) errors.push(`${at}: "${visaType}" is not a known visa type`);
    else if (petitionSubType && !(getSubTypes(visaType) || []).includes(petitionSubType)) errors.push(`${at}: "${petitionSubType}" is not a ${visaType} sub-type`);
    if (category && !CATEGORIES.includes(category)) errors.push(`${at}: category must be immigrant or non_immigrant`);
    const key = `${field}|${norm(value)}`;
    if (seen.has(key)) errors.push(`${at}: duplicate mapping for ${field} = "${value}"`);
    seen.add(key);
    entries.push({ field, value, visaType, petitionSubType, category: category || "non_immigrant" });
  });
  return { ok: errors.length === 0, errors, entries: errors.length ? [] : entries };
}

module.exports = {
  FIELD_KEYS,
  FIELD_NAMES,
  DETAIL_FIELDS,
  CATEGORIES,
  defaultEntries,
  extractFieldValues,
  resolveVisa,
  validateEntries,
  readFieldValue,
  norm,
};
