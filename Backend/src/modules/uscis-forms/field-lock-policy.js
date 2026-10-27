// Which fields of a USCIS form the case manager may fill in.
//
// USCIS marks some boxes read-only in its PDFs: many are only switched on by the form's own script (for example "Enter City or Town" under "Item 1 is checked",
// or "Enter Other Type of Petitioner"), a few are copies of a box on another page, and some can never be typed into (signatures, the PDF417 barcodes). The
// importer copies that flag onto every field (template.formFields[].readOnly), which used to lock all of them in the editor and in the downloaded PDF.
//
// This policy decides, at read time and without changing any stored template: a read-only flag still locks a field only when it is a signature, a barcode, or a
// widget that cannot be filled in at all (a button, an unknown kind). Every other read-only field is fillable - text / date / number boxes, checkboxes, drop-downs
// (e.g. the "State" list), list boxes, radio groups, and fields the form computes by script (the case manager may override the computed value).
// One rule for the workspace the editor opens and for the PDF that is generated.
const lower = (value) => String(value ?? "").toLowerCase();

const BARCODE_PATTERN = /pdf\s*_?417|bar\s*_?code/i;
const SIGNATURE_TYPES = new Set(["signature", "sig", "digitalsignature"]);
const TEXT_LIKE_TYPES = new Set(["text", "textarea", "date", "number", "checkbox", "tel", "phone", "email", "zip", "ssn", "ein", "alienNumber", "uscisReceiptNumber"].map(lower));
// the choice widgets: a drop-down / combo box, a list box (single or multi select) and a radio group
const CHOICE_TYPES = new Set(["dropdown", "combobox", "select", "radio", "radiogroup", "multiselect", "optionlist", "listbox"]);
const FILLABLE_PDF_KINDS = new Set(["text", "checkbox", ...CHOICE_TYPES]);

function namesOf(field = {}) {
  return [field.fieldName, field.pdfFieldName, field.originalName, field.name, field.fieldLabel, field.label].filter(Boolean).join(" ");
}

function isBarcodeField(field) {
  return BARCODE_PATTERN.test(namesOf(field));
}

function isSignatureField(field = {}) {
  return [field.fieldType, field.type, field.semanticType, field.pdfFieldType].some((type) => SIGNATURE_TYPES.has(lower(type)));
}

// a widget a person can fill in (text / date / number box, checkbox, drop-down, list box, radio group): by the PDF's own widget kind first, the importer's
// field type second. (The name predates drop-downs and radio groups being included.)
function isPlainFillableKind(field = {}) {
  const pdfKind = lower(field.pdfFieldType);
  if (pdfKind) return FILLABLE_PDF_KINDS.has(pdfKind);
  return [lower(field.fieldType), lower(field.type)].some((type) => TEXT_LIKE_TYPES.has(type) || CHOICE_TYPES.has(type));
}

// true when this read-only flag must still lock the field
function keepsLock(field = {}) {
  if (isSignatureField(field) || isBarcodeField(field)) return true;
  return !isPlainFillableKind(field);
}

// the read-only state the editor should apply to this field
function effectiveReadOnly(field = {}) {
  const flagged = Boolean(field.readOnly || field.readonly);
  return flagged && keepsLock(field);
}

module.exports = { effectiveReadOnly, keepsLock, isBarcodeField, isSignatureField, isPlainFillableKind };
