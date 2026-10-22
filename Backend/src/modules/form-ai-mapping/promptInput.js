// What may enter the prompt - an ALLOW-LIST, not a filter. A box is described by its printed label, section, widget kind and place on the form; the registry by path / type /
// role / description / aliases; the checklist by question key / label / type / option labels / canonical path. Nothing else is ever copied, so no client answer, document,
// name, SSN, A-number or case data can enter the prompt: those values are not read at all (default values, filled values and anything under a case never pass through here).
// assertAllowListed() re-checks the finished input (unknown keys, sensitive-looking values) and the caller refuses to send a batch that fails it.
//
// Labels come from a PDF and are untrusted TEXT: they are passed as JSON data between fixed delimiters, a delimiter inside a label is neutralized, and the system prompt tells
// the model that nothing between the delimiters is an instruction.
const { sha } = require("./registrySlice");

const OPEN = "<" + "<<FORM_MAPPING_DATA";
const CLOSE = "FORM_MAPPING_DATA>" + ">>";

const BOX_KEYS = Object.freeze(["fieldId", "pdfName", "widget", "label", "section", "page", "group", "neighbors", "repeated", "repeatIndex", "required", "maxLength", "optionCount"]);
const FORM_KEYS = Object.freeze(["code", "name", "purpose", "caseTypes"]);
const REGISTRY_KEYS = Object.freeze(["path", "type", "role", "description", "aliases", "cardinality"]);
const QUESTION_KEYS = Object.freeze(["key", "label", "type", "options", "canonicalPath"]);
const TOP_KEYS = Object.freeze(["form", "boxes", "registry", "questions"]);

// patterns that mean "a real person's value is in here", checked on every string of the input
const SENSITIVE = [
  [/\b\d{3}-\d{2}-\d{4}\b/, "ssn"],
  [/\b\d{9}\b/, "nine_digit_number"],
  [/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i, "email_address"],
  [/\b\d{3}[-.\s]\d{3}[-.\s]\d{4}\b/, "phone_number"],
  [/\b\d{13,19}\b/, "long_number"],
];

/** The names of the sensitive patterns found anywhere in a value (strings, arrays, nested objects). */
function scanForSensitive(value, found = new Set()) {
  if (typeof value === "string") SENSITIVE.forEach(([pattern, name]) => { if (pattern.test(value)) found.add(name); });
  else if (Array.isArray(value)) value.forEach((item) => scanForSensitive(item, found));
  else if (value && typeof value === "object") Object.values(value).forEach((item) => scanForSensitive(item, found));
  return [...found];
}

/** Printable single-line text, bounded; a delimiter sequence in it is neutralized so a label can never close the data block. */
function clean(value, max = 160) {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/<{3,}|>{3,}/g, "‹›")
    .replace(/FORM_MAPPING_DATA/g, "FORM MAPPING DATA")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

const pick = (source, keys) => Object.fromEntries(keys.filter((key) => source[key] !== undefined && source[key] !== null && source[key] !== "").map((key) => [key, source[key]]));

/** One box, from the scanned template field only: the allow-listed keys and nothing else. Returns null for a box whose own text looks like client data. */
function boxInput(field = {}, { neighbors = [], repeated = false, repeatIndex } = {}) {
  const box = pick({
    fieldId: field.targetFieldId,
    pdfName: clean(String(field.targetPdfField || "").replace(/^form\d*\[\d+\]\./i, ""), 140),
    widget: clean(field.type || field.fieldType || "text", 30),
    label: clean(field.label || field.fieldLabel || "", 200),
    section: clean(field.section || field.sectionTitle || "", 100),
    page: Number.isFinite(Number(field.pageNumber)) ? Number(field.pageNumber) : undefined,
    group: clean(field.groupId || field.parentGroup || "", 80),
    // a neighbour whose own text looks like client data is left out (the box itself stays)
    neighbors: neighbors.map((text) => clean(text, 120)).filter((text) => text && !scanForSensitive(text).length).slice(0, 4),
    repeated: repeated || undefined,
    repeatIndex: Number.isFinite(repeatIndex) ? repeatIndex : undefined,
    required: field.required ? true : undefined,
    maxLength: Number.isFinite(Number(field.validation?.maxLength)) ? Number(field.validation.maxLength) : undefined,
    optionCount: Array.isArray(field.options) && field.options.length ? field.options.length : undefined,
  }, BOX_KEYS);
  return scanForSensitive(box).length ? null : box;
}

function questionInput(question = {}) {
  return pick({
    key: clean(question.questionKey || question.key, 120),
    label: clean(question.label, 200),
    type: clean(question.type, 30),
    options: Array.isArray(question.options) ? question.options.slice(0, 12).map((option) => clean(typeof option === "object" ? option.label || option.value : option, 60)) : undefined,
    canonicalPath: clean(question.canonicalPath || question.directBindingPath, 160),
  }, QUESTION_KEYS);
}

const formInput = (template = {}, { purpose = "", caseTypes = [] } = {}) => pick({
  code: clean(template.formCode, 20), name: clean(template.title || template.formName, 160), purpose: clean(purpose, 200), caseTypes: caseTypes.slice(0, 40).map((type) => clean(type, 40)),
}, FORM_KEYS);

function buildBatchInput({ template, boxes, registry, questions = [], purpose, caseTypes }) {
  return { form: formInput(template, { purpose, caseTypes }), boxes, registry: registry.map((entry) => pick(entry, REGISTRY_KEYS)), questions: questions.map(questionInput).filter((q) => q.key || q.label) };
}

/** Throws when the finished input has a key outside the allow-list or a value that looks like client data. */
function assertAllowListed(input) {
  const problems = [];
  const keys = (object, allowed, where) => Object.keys(object || {}).forEach((key) => { if (!allowed.includes(key)) problems.push(`${where}.${key} is not allowed`); });
  keys(input, TOP_KEYS, "input");
  keys(input.form, FORM_KEYS, "form");
  (input.boxes || []).forEach((box, index) => keys(box, BOX_KEYS, `boxes[${index}]`));
  (input.registry || []).forEach((entry, index) => keys(entry, REGISTRY_KEYS, `registry[${index}]`));
  (input.questions || []).forEach((question, index) => keys(question, QUESTION_KEYS, `questions[${index}]`));
  const sensitive = scanForSensitive(input);
  if (sensitive.length) problems.push(`value looks like client data (${sensitive.join(", ")})`);
  if (problems.length) throw Object.assign(new Error(`the AI mapping input was refused: ${problems.slice(0, 3).join("; ")}`), { code: "AI_MAPPING_INPUT_REFUSED", retryable: false, problems });
  return true;
}

/** The text the prompt template receives as {{payload}}: the data as JSON between fixed delimiters. */
const renderPayload = (input) => `${OPEN}\n${JSON.stringify(input)}\n${CLOSE}`;

/** Cache key of one box's suggestion: everything that could change the answer. */
function inputHash({ editionChecksum, box, registryVersion, questionnaireSchemaVersion, promptVersion, model }) {
  return sha(JSON.stringify([editionChecksum || "", box, registryVersion, questionnaireSchemaVersion, promptVersion, model])).slice(0, 40);
}

module.exports = { BOX_KEYS, TOP_KEYS, OPEN, CLOSE, scanForSensitive, clean, boxInput, questionInput, buildBatchInput, assertAllowListed, renderPayload, inputHash };
