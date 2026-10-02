// Shared edge builders for the K-1 (i129f-k1-crosswalk.js) and K-3
// (i130-k3-crosswalk.js) crosswalks. Both forms are filled from the SAME
// two-party checklist content (family-workflow/questionnaires/k1.js, reused
// verbatim by k3.js), so the edge shapes - identity text, mm/dd/yyyy dates,
// one-box-per-answer checkboxes, free-text address blocks, repeating-group
// rows - are identical and live here once.
//
// ROLE SAFETY (the point of this module): every `source` is a
// raw.questionnaireAnswers.<key>.value path, and every question key in the
// family checklists is prefixed by the role that answers it
// (petitioner_* / beneficiary_*). A petitioner field can therefore only ever
// be wired to a petitioner_* key and a beneficiary field to a beneficiary_*
// key - there is no shared person.*/contact.* namespace in between for the
// two parties to collide in. petitionerKey()/beneficiaryKey() below make that
// explicit, and the crosswalk tests assert it for every edge.
const RAW_PREFIX = "raw.questionnaireAnswers";

function answerPath(questionKey, sub) {
  return `${RAW_PREFIX}.${questionKey}.value${sub ? `.${sub}` : ""}`;
}

const petitionerKey = (path) => `petitioner_${path}`;
const beneficiaryKey = (path) => `beneficiary_${path}`;

// Builds the {fieldName} for a widget: subform number, widget base name, index.
function widget(subform, name, index = 0) {
  return `form1[0].#subform[${subform}].${name}[${index}]`;
}

function edge(fieldName, source, note, extra = {}) {
  return { fieldName, source, note, ...extra };
}

const DATE = { type: "date", format: "mm/dd/yyyy" };
const BOOLEAN = { type: "boolean" };

const text = (fieldName, source, note, extra) => edge(fieldName, source, note, extra);
const date = (fieldName, source, note, extra) => edge(fieldName, source, note, { transform: DATE, ...extra });
const digits = (fieldName, source, note, extra) => edge(fieldName, source, note, { transform: { type: "digits" }, ...extra });

// Checkbox ticked when `source` equals one of `values` (exactly one box of a
// group can pass for any given answer - the guarantee behind "never both
// Male and Female ticked").
function checkbox(fieldName, source, values, note, extra = {}) {
  const list = [].concat(values);
  const condition = list.length > 1
    ? { field: source, operator: "in", value: list }
    : { field: source, operator: "equals", value: list[0] };
  return edge(fieldName, source, note, { condition, transform: BOOLEAN, ...extra });
}

// Checkbox ticked when an arbitrary condition (all/any/rule) holds. `source`
// only needs to resolve to something truthy for the boolean transform.
function checkboxWhen(fieldName, source, condition, note, extra = {}) {
  return edge(fieldName, source, note, { condition, transform: BOOLEAN, ...extra });
}

const exists = (field) => ({ field, operator: "exists" });
const empty = (field) => ({ field, operator: "empty" });
const equals = (field, value) => ({ field, operator: "equals", value });
const isIn = (field, value) => ({ field, operator: "in", value });
const all = (...rules) => ({ all: rules });
const any = (...rules) => ({ any: rules });

// Case-level condition (K-1 vs K-3 specific boxes). Canonical `case.visaType`.
const VISA_K1 = ["K-1", "K1", "k-1", "k1"];
const VISA_K3 = ["K-3", "K3", "k-3", "k3"];
const visaIs = (values) => isIn("case.visaType", values);

// One free-text address answer -> the widgets of one USCIS address block.
// `fields` maps parts to widget names (any may be omitted when the block lacks
// it). `unit` lists the three Apt/Ste/Flr checkbox widgets, whose order
// differs per block (verified against each widget's tooltip).
function addressBlock({ source, fallback, fields, unit, note, rows = false }) {
  const extra = fallback ? { fallback } : {};
  const part = (name) => (rows ? `row${name[0].toUpperCase()}${name.slice(1)}` : name);
  const out = [];
  const push = (fieldName, partName, label) => {
    if (!fieldName) return;
    out.push(edge(fieldName, source, `${note} - ${label}`, { transform: { type: "address", part: partName }, ...extra }));
  };
  push(fields.street, part("street"), "street number and name");
  push(fields.unitNumber, part("unitNumber"), "apartment/suite/floor number");
  if (unit) {
    push(unit.apt, part("unitApt"), "unit type Apartment");
    push(unit.ste, part("unitSte"), "unit type Suite");
    push(unit.flr, part("unitFlr"), "unit type Floor");
  }
  if (!rows) {
    push(fields.city, "city", "city or town");
    push(fields.state, "state", "state");
    push(fields.zip, "zip", "ZIP code");
    push(fields.province, "province", "province");
    push(fields.postalCode, "postalCode", "postal code");
    push(fields.country, "country", "country");
  }
  return out;
}

// One row of a repeating group (residential/employment history, children,
// prior spouses) -> a block of widgets. `rowSource(col)` returns the answer
// path of that column of that row.
function rowEdge(fieldName, rowSource, col, note, extra = {}) {
  return edge(fieldName, rowSource(col), note, extra);
}

// mappingType recorded on the persisted graph edge (the graph validator only
// requires it to be present; the mapping editor shows it).
function mappingTypeFor(edgeDef) {
  const type = edgeDef.transform?.type;
  if (type === "date") return "date";
  if (type === "boolean") return "checkbox";
  return "direct";
}

module.exports = {
  mappingTypeFor, RAW_PREFIX, answerPath, petitionerKey, beneficiaryKey, widget, edge, text, date, digits, checkbox, checkboxWhen,
  addressBlock, rowEdge, exists, empty, equals, isIn, all, any, visaIs, VISA_K1, VISA_K3, DATE, BOOLEAN,
};
