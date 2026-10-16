// Phase 2: classification of form-field `defaultValue`s (plan: "classify all of them by category with a committed snapshot ... preserve behavior now"). Pure.
// Autofill still treats every default exactly as before (MappingResolver / FormMappingService.normalizeMappings: a default is used only when a field has no mapping);
// this module only NAMES what a default is, so a default that looks like a person's data is flagged and never silently trusted or silently removed.
//   checkbox_unchecked  a checkbox / radio that starts unchecked (false / "false" / "off" / 0)                        - safe, expected
//   empty_dropdown      a dropdown's empty option list or empty choice ([] / [""] / [" "])                            - safe, expected
//   empty_value         an empty string for a text / date / number / signature / ... field                           - safe, expected
//   barcode_token       the page token a PDF417 barcode field carries ("I-131|01/20/25|3")                           - safe, expected
//   constant            a fixed word the form itself prints, e.g. "PRESENT" for an open-ended date range              - reviewed constant
//   party_looking       an e-mail, SSN, phone or A-number shaped value: looks like a person's data                  - FLAGGED
//   other               anything else                                                                                 - FLAGGED (unclassified)
const CATEGORIES = Object.freeze(["checkbox_unchecked", "empty_dropdown", "empty_value", "barcode_token", "constant", "party_looking", "other"]);
const FLAGGED = Object.freeze(["party_looking", "other"]);
const REVIEWED_CONSTANTS = Object.freeze(["PRESENT"]);

const norm = (value) => String(value ?? "").trim();
const lower = (value) => norm(value).toLowerCase();

function isEmptyish(value) {
  if (value === undefined || value === null) return true;
  if (Array.isArray(value)) return value.every((item) => norm(item) === "");
  if (typeof value === "string") return value.trim() === "";
  return false;
}

/** Category of one field's default, or null when the field has no default at all. */
function classifyDefault(field = {}) {
  const value = field.defaultValue;
  if (value === undefined || value === null) return null;
  const type = lower(field.fieldType || field.type || field.semanticType);
  const name = `${field.pdfFieldName || ""} ${field.fieldName || ""} ${field.fieldId || ""}`;

  if (/pdf417|barcode/i.test(name) || (typeof value === "string" && /^[A-Z0-9-]{2,12}\|\d{1,2}\/\d{1,2}\/\d{2,4}\|\d+$/.test(value.trim()))) return "barcode_token";
  if (["checkbox", "radio", "button", "boolean"].includes(type) && (value === false || value === 0 || ["false", "off", "0", "no", ""].includes(lower(value)))) return "checkbox_unchecked";
  if (["dropdown", "select", "combobox", "list", "choice"].includes(type) && isEmptyish(value)) return "empty_dropdown";
  if (isEmptyish(value)) return "empty_value";
  if (typeof value === "string" && REVIEWED_CONSTANTS.includes(norm(value).toUpperCase())) return "constant";
  if (typeof value === "string") {
    const text = norm(value);
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text) || /^\d{3}-?\d{2}-?\d{4}$/.test(text) || /^\+?[\d\s().-]{10,}$/.test(text) || /^A-?\d{7,9}$/i.test(text)) return "party_looking";
  }
  return "other";
}

/** { categories: { name: count }, flagged: [{ fieldId, category }] (first 50), total } for a list of form fields. */
function summarizeDefaults(fields = []) {
  const categories = Object.fromEntries(CATEGORIES.map((name) => [name, 0]));
  const flagged = [];
  let total = 0;
  for (const field of fields) {
    const category = classifyDefault(field);
    if (!category) continue;
    total += 1;
    categories[category] += 1;
    if (FLAGGED.includes(category) && flagged.length < 50) flagged.push({ fieldId: field.fieldId || field.id || field.fieldName, category });
  }
  return { total, categories, flagged };
}

module.exports = { CATEGORIES, FLAGGED, classifyDefault, summarizeDefaults };
