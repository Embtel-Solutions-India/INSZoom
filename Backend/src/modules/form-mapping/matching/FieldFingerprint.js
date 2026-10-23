// Phase 7.3: what a field IS, independent of its name and scan order. A fingerprint is built from a scanned / stored template field (or a mapping-graph target)
// and carries only comparable, normalized facts. Pure: no database, no PDF. Missing facts are null (the matcher never treats "unknown" as "equal").
const { clean } = require("../contract/fieldEquivalence");
const { qualifiedName, indexlessName } = require("./stableKey");

const idOf = (field) => field?.fieldId || field?.targetFieldId || field?.id || field?.fieldName || field?.pdfFieldName || null;
const nameOf = (field) => field?.pdfFieldName || field?.targetPdfField || field?.fieldName || field?.originalName || "";

/** The widget KIND is the hard compatibility class: a text box can never be matched with a tick box, whatever their names say. */
function kindOf(field) {
  const pdf = String(field?.pdfFieldType || "").toLowerCase();
  const type = String(field?.fieldType || field?.type || field?.targetType || "").toLowerCase();
  const probe = pdf && pdf !== "unknown" ? pdf : type;
  if (/check/.test(probe)) return "checkbox";
  if (/radio/.test(probe)) return "radio";
  if (/drop|select|combo|choice|option|list/.test(probe)) return "choice";
  if (/signature|sign/.test(probe)) return "signature";
  if (/button/.test(probe)) return "button";
  if (probe) return "text"; // text, textarea, date, number, alienNumber, ssn, ...
  return null;
}

/** The semantic type (date, alienNumber ...): a change here is a soft warning (the value's format may differ), not a hard incompatibility. */
const semanticOf = (field) => String(field?.fieldType || field?.type || field?.targetType || "").toLowerCase() || null;

/** A normalized option set: every option's value / label / export value, lower-cased; null when the field has no options. */
function optionSetOf(field) {
  const raw = [...(Array.isArray(field?.options) ? field.options : []), ...(Array.isArray(field?.exportValue) ? field.exportValue : [])];
  const values = raw.map((item) => (item && typeof item === "object" ? item.exportValue ?? item.value ?? item.label : item)).map((item) => String(item ?? "").trim().toLowerCase()).filter(Boolean);
  return values.length ? [...new Set(values)].sort() : null;
}

/** The last name segment with its index and the leading Pt/Line numbering removed: `Pt2Line3a_FamilyName[0]` -> `familyname` (the renumbering-proof core). */
function coreOf(rawName) {
  const last = qualifiedName(rawName).split(".").pop() || "";
  const core = last
    .replace(/\[\d+\]/g, "")
    .replace(/^(?:pt|part)\d+(?:line|item)\d+[a-z]?_?/i, "") // Pt2Line3a_FamilyName
    .replace(/^(?:pt|part)\d+_?/i, "") // Pt2_FamilyName
    .replace(/^p\d+_(?:line|item)?\d*[a-z]?_?/i, "") // P2_Line3a_FamilyName
    .replace(/^(?:line|item)\d+[a-z]?_?/i, "") // Line3a_FamilyName
    .replace(/[^a-z0-9]+/g, "");
  return core || null;
}

const ordinalOf = (rawName) => {
  const last = qualifiedName(rawName).split(".").pop() || "";
  const match = last.match(/\[(\d+)\]\s*$/);
  return match ? Number(match[1]) : null;
};

function geometryOf(field) {
  const box = field?.boundingBox || field?.coordinates?.boundingBox || field?.coordinates || field?.position;
  const system = field?.coordinateSystem || field?.coordinates?.coordinateSystem || {};
  const x = Number(box?.x ?? box?.left);
  const y = Number(box?.y ?? box?.bottom);
  const width = Number(box?.width ?? field?.width);
  const height = Number(box?.height ?? field?.height);
  if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return null;
  const pageWidth = Number(system.pageWidth) || 612;
  const pageHeight = Number(system.pageHeight) || 792;
  return { cx: (x + width / 2) / pageWidth, cy: (y + height / 2) / pageHeight, w: width / pageWidth, h: height / pageHeight };
}

const sectionKey = (field) => String(field?.sectionTitle || field?.section || field?.sectionKey || field?.sectionId || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

function fromField(field) {
  const raw = nameOf(field);
  // a label the scanner DERIVED from the PDF name (it carries the container path: "Form 1 0 Subform 0 ...") says nothing about meaning and changes with every page insertion: ignored
  const rawLabel = String(field?.label || field?.targetLabel || field?.fieldLabel || "");
  const label = /\bsubform\s*\d+\b|\bform\s*\d+\s+\d+\b|\bpage\s*set\b/i.test(rawLabel) ? "" : clean(rawLabel);
  const tooltip = clean(field?.tooltip || "");
  const section = sectionKey(field);
  return {
    id: idOf(field),
    name: qualifiedName(raw) || null,
    kindName: indexlessName(raw) || null,
    core: coreOf(raw),
    ordinal: ordinalOf(raw),
    label: label || null,
    tooltip: tooltip || null,
    // a section the scanner only DERIVED from the page ("Page 2") or could not name ("General") is not a printed heading: it proves nothing, so it is unknown
    section: section && section !== "general" && !/^page \d+$/.test(section) ? section : null,
    page: Number(field?.pageNumber ?? field?.page ?? field?.coordinates?.pageNumber) || null,
    kind: kindOf(field),
    semantic: semanticOf(field),
    options: optionSetOf(field),
    group: String(field?.groupId || field?.parentGroup || field?.subsectionId || "").toLowerCase() || null,
    geometry: geometryOf(field),
    maxLength: Number(field?.validation?.maxLength || field?.maxLength) || null,
    comb: Boolean(field?.validation?.comb || field?.comb || field?.combed),
  };
}

module.exports = { fromField, kindOf, optionSetOf, coreOf, geometryOf };
