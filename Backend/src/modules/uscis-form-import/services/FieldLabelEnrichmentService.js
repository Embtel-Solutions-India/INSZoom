// Post-scan label enrichment: turns a raw scanned field's XFA name (e.g.
// "form1[0].#subform[2].Line1_Gender_P3[0]") into a human-readable label a
// case manager can actually read, and flags USCIS-internal fields (barcodes)
// so they never reach the review UI. Runs once, at import time, over
// PDFFieldScannerService's own scan output - it does not re-scan or
// re-architect anything there.
//
// Label priority, most to least trustworthy:
//   1. The form's own human-authored crosswalk note (i129-h1b-crosswalk.js
//      and its siblings) - an attorney-reviewed, USCIS-facing description
//      already written for every mapped edge.
//   2. The PDF's own /TU tooltip (confirmed empirically: 980/980 fields on
//      the real seeded I-129 template carry one, including the barcode
//      field - see labelFromTooltip's own note on why that doesn't matter).
//   3. A naming-pattern parse of the XFA field name itself (Part/Section/
//      Item numbers are embedded in USCIS's own field-naming convention,
//      e.g. "H1BSecALine1a_Yes" -> "Section A, Item 1a") - the documented
//      fallback for any field lacking both of the above (rare for I-129
//      specifically, given (2)'s near-universal coverage there, but real
//      for other forms/fields that may not carry /TU data).
//   4. The field's own existing label (labelFromName's startCase of the
//      XFA name) - never worse than what the system already had.
const i129H1bCrosswalk = require("../../form-mapping/config/i129-h1b-crosswalk");
const i129fK1Crosswalk = require("../../form-mapping/config/i129f-k1-crosswalk");
const i130K3Crosswalk = require("../../form-mapping/config/i130-k3-crosswalk");

const CROSSWALKS_BY_FORM_CODE = {
  "I-129": i129H1bCrosswalk,
  "I-129F": i129fK1Crosswalk,
  "I-130": i130K3Crosswalk,
};

// Applies regardless of whether a formCode has an authored crosswalk -
// PDF417 barcodes are a standard USCIS PDF-authoring convention, not
// specific to any one form, so a form with no crosswalk yet still gets its
// obviously-USCIS-internal fields filtered.
const GENERIC_USCIS_USE_ONLY_PATTERNS = [/PDF417BarCode/i];

function crosswalkFor(formCode) {
  return CROSSWALKS_BY_FORM_CODE[String(formCode || "").trim().toUpperCase()];
}

function isUscisUseOnly(fieldName, formCode) {
  const crosswalk = crosswalkFor(formCode);
  const patterns = [...(crosswalk?.USCIS_USE_ONLY_PATTERNS || []), ...GENERIC_USCIS_USE_ONLY_PATTERNS];
  return patterns.some((pattern) => pattern.test(String(fieldName || "")));
}

// Crosswalk notes are written as "<USCIS-facing description>. <internal
// reasoning/citation>." (e.g. "Item 5, Sex - Male widget. person.gender is
// normalized lowercase by CanonicalTransformationService (verified
// empirically)."). The first sentence is always the form-facing part;
// everything after it is reviewer-facing engineering context that has no
// place in a case manager's UI. Parentheticals inside that first sentence
// (rare, but possible) are stripped too.
function cleanCrosswalkNote(note) {
  if (!note) return undefined;
  const firstSentence = String(note).split(/(?<=[.!?])\s+/)[0] || String(note);
  return firstSentence.replace(/\s*\([^)]*\)/g, "").replace(/\.+$/, "").trim() || undefined;
}

function crosswalkLabel(fieldName, formCode) {
  const crosswalk = crosswalkFor(formCode);
  if (!crosswalk) return undefined;
  const edge = (crosswalk.MAPPED_EDGES || []).find((item) => item.fieldName === fieldName);
  return edge ? cleanCrosswalkNote(edge.note) : undefined;
}

// USCIS TU tooltips are structured "<Part context>. <Item heading>.
// <widget-specific instruction>." - the LAST sentence is always the
// actionable instruction for THIS exact widget (e.g. "Enter City or
// Town.", "Select State from a List of States.", "Check Suite."), which is
// what a case manager needs; the leading Part/Item sentences are page
// orientation, not per-field content. A preceding numbered item heading
// ("3. Mailing Address...") is folded in as an "Item N:" prefix when
// present, so the label keeps the form's own item numbering. Some fields'
// /TU is just their own field name (e.g. the barcode field's "PDF417BarCode1")
// with no sentence structure at all - filtered out by the `=== fieldName`
// check, since that's not a usable tooltip, not a genuine description.
function labelFromTooltip(tooltip, fieldName) {
  const cleaned = String(tooltip || "").trim();
  if (!cleaned || cleaned === fieldName) return undefined;
  const sentences = cleaned.split(/(?<=[.!?])\s+/).map((sentence) => sentence.trim()).filter(Boolean);
  const last = sentences[sentences.length - 1] || cleaned;
  const instruction = last.replace(/[.\s]+$/, "").trim();
  if (!instruction) return undefined;
  const itemMatch = cleaned.match(/(?:^|\.\s+)(\d{1,2}[a-z]?)\.\s+[A-Z]/);
  const label = `${itemMatch ? `Item ${itemMatch[1]}: ` : ""}${instruction}`;
  // A tooltip that's really just the whole Part/Item paragraph (no later
  // sentence split cleanly, e.g. names truncated by a scanning glitch)
  // is too long to be a "label" - better to fall through to the naming
  // parser than show a wall of text.
  return label.length > 160 ? undefined : label;
}

// USCIS's own XFA field-naming convention embeds Part/Section/Item
// numbers directly in the field name (Line/Sec/Part/Pt tokens) - parsed
// here instead of a raw labelize() of the whole internal string. Returns
// undefined (not a guess) when none of these tokens are present, so the
// caller can fall through to the field's prior label.
function labelFromNamingPattern(fieldName, pageNumber) {
  const raw = String(fieldName || "");
  const partMatch = raw.match(/(?:^|[^a-zA-Z])(?:Part|Pt|P)[_.\s]*0*([0-9]{1,2})(?![0-9])/);
  // "SecALine1a" packs the section letter directly against the next
  // camelCase word (no separator) - a letter run right after "Sec" is
  // itself the marker (English continuations of "Sec" are lowercase:
  // "Section", "Second", ...), so no lookahead boundary is needed/wanted.
  const secMatch = raw.match(/Sec([A-Z])/);
  const lineMatch = raw.match(/(?:Sub[A-Z]?)?Line[_.\s]*0*([0-9]{1,2}[a-z]?)/i);
  const parts = [];
  if (partMatch) parts.push(`Part ${partMatch[1]}`);
  if (secMatch) parts.push(`Section ${secMatch[1]}`);
  if (lineMatch) parts.push(`Item ${lineMatch[1]}`);
  if (parts.length) return parts.join(", ");
  return pageNumber ? `Page ${pageNumber} field` : undefined;
}

function deriveLabel({ fieldName, tooltip, pageNumber, formCode, fallback }) {
  const crosswalkNote = crosswalkLabel(fieldName, formCode);
  if (crosswalkNote) return { label: crosswalkNote, labelSource: "crosswalk_note" };
  const tooltipLabel = labelFromTooltip(tooltip, fieldName);
  if (tooltipLabel) return { label: tooltipLabel, labelSource: "pdf_tooltip" };
  const namingLabel = labelFromNamingPattern(fieldName, pageNumber);
  if (namingLabel) return { label: namingLabel, labelSource: "naming_pattern" };
  return { label: fallback || fieldName, labelSource: "labelize_fallback" };
}

// Runs over PDFFieldScannerService's scanned fields (or an already-stored
// template's formFields, for backfilling). Never mutates the input array;
// returns a new array with `label`/`fieldLabel`/`labelSource` replaced and
// `uscisUseOnly` set. Callers decide whether to store uscis_use_only
// fields at all (USCISFormImporterService keeps them, for PDF-flattening
// completeness - see that file's own note) or filter them at a later,
// review-facing boundary (uscis-form.service.js's buildSections()).
function enrichFields(fields = [], formCode) {
  return fields.map((field) => {
    // `tooltip` (the raw /TU string) is only needed transiently, to derive
    // a label - it is deliberately NOT included in the returned object.
    // Persisting all ~980 fields' full tooltip text pushed a real template
    // document to Mongo's 16MB subdocument-array ceiling (confirmed
    // empirically against the seeded I-129 template), and the derived
    // label already carries the useful part of it.
    const { tooltip, ...rest } = field;
    const uscisUseOnly = isUscisUseOnly(field.fieldName, formCode);
    if (uscisUseOnly) return { ...rest, uscisUseOnly: true };
    const { label, labelSource } = deriveLabel({
      fieldName: field.fieldName,
      tooltip,
      pageNumber: field.pageNumber,
      formCode,
      fallback: field.label || field.fieldLabel,
    });
    return { ...rest, label, fieldLabel: label, labelSource, uscisUseOnly: false };
  });
}

module.exports = {
  CROSSWALKS_BY_FORM_CODE,
  isUscisUseOnly,
  cleanCrosswalkNote,
  crosswalkLabel,
  labelFromTooltip,
  labelFromNamingPattern,
  deriveLabel,
  enrichFields,
};
