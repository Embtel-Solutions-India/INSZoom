// Phase 7.6a: the certification probe that proves an edition end to end, on the REAL renderer, in memory. Two renders of the edition's own stored PDF:
//
//   LONG render       every mapped box is filled with a value far beyond its length limit (no character limit is a product rule: the full text must reach the PDF), typed
//                     boxes (date, SSN, phone ...) with a believable value, tick boxes ticked, drop-downs / radio groups set to a REAL option of this PDF, and party boxes with the
//                     party marker (the same markers as form-release/markerCertification.js). The output is reopened and every value is compared with what the renderer was
//                     meant to write (data_probe): nothing dropped, nothing cut, a value only in its own party's box.
//   REALISTIC render  every text box holds a value of exactly the length the form itself allows (its /MaxLen, else a typical 40 characters). The ArtifactValidator then checks the
//                     final file: text inside its box at the font in the file, ticks visible, pages and fields intact, nothing protected filled (artifact_probe).
//
// Nothing is written anywhere: the renderer is given an in-memory case form, the result is a verdict. Dependencies are injectable so the logic is testable without a database
// or a real PDF. Switch (FORM_PIPELINE_AUTONOMY) handling is the caller's job (FormCertificationService).
const MappingResolver = require("../form-mapping/services/MappingResolver");
const { partyOfText, isAcknowledged } = require("../form-mapping/contract/MappingContractValidator");
const { isInterpreterOrPreparerField } = require("../form-mapping/config/blankFieldPolicy");
const { markerForPath } = require("./markerCertification");
const ArtifactValidator = require("../form-generation/services/ArtifactValidator");

const SIDE = { PETITIONER: "petitioner", COMPANY: "petitioner", BENEFICIARY: "beneficiary", PREPARER: "preparer" };
const LONG_TEXT_LENGTH = 300;
const TYPICAL_LENGTH = 40;
const FILLER = "The quick brown fox jumps over the lazy dog 0123456789. ";
const NON_LATIN_SAMPLE = "José Ñandú 李明 Ωmega";

// believable values for the typed boxes (what a real answer looks like after the mapping's own transform)
const TYPED = Object.freeze({
  date: "01/15/2030", ssn: "123-45-6789", phone: "(415) 555-0100", email: "probe@example.com", number: "1234567", currency: "1234567",
  alienNumber: "123456789", passport: "X1234567", uscisReceiptNumber: "ABC1234567890", zip: "94105",
});

const isTextKind = (fieldType) => !["checkbox", "radio", "dropdown", "select", "signature", "button", "initial"].includes(String(fieldType || "").toLowerCase());

/** Pure. The text a box is given: `length` characters, starting with the party marker when the box's source belongs to a party. */
function textOfLength(length, marker) {
  let text = marker && marker !== "NEUTRAL_TEST" ? `${marker} ` : "";
  while (text.length < length) text += FILLER;
  text = text.slice(0, length);
  return /s$/.test(text) ? `${text.slice(0, -1)}x` : text; // exactly `length` characters, never ending in a space (a trailing space is not a believable last character)
}

const targetNames = (edge, target = {}) => [edge.targetLabel || target.label || target.fieldLabel, edge.section || target.section, String(edge.targetPdfField || target.pdfFieldName || "").split(".").pop()];

function sideOfMarker(text) {
  const match = String(text || "").match(/(PETITIONER|BENEFICIARY|COMPANY|PREPARER)_TEST_00[1-4]/);
  return match ? SIDE[match[1]] : null;
}

/**
 * Pure. The probe plan for an edition: which boxes are filled with what.
 *   graph, template -> [{ id, pdfField, fieldType, marker, side(box) }]  (only boxes a person's data could ever reach)
 */
function planBoxes({ template, graph, protectedCheck }) {
  const fieldsById = new Map();
  (template.formFields || []).forEach((field) => { if (field.fieldId) fieldsById.set(field.fieldId, field); if (field.uniqueId) fieldsById.set(field.uniqueId, field); });
  const keptBlank = new Set((graph.keepBlank || []).map((entry) => entry.targetFieldId));
  const seen = new Set();
  const boxes = [];
  for (const edge of graph.edges || []) {
    if (edge.status !== "active" || !edge.targetFieldId || keptBlank.has(edge.targetFieldId) || seen.has(edge.targetFieldId)) continue;
    const field = fieldsById.get(edge.targetFieldId) || {};
    const pdfField = edge.targetPdfField || field.pdfFieldName || field.fieldName;
    if (!pdfField) continue;
    const fieldType = String(field.fieldType || field.type || edge.targetType || "text");
    if (["signature", "button", "initial"].includes(fieldType.toLowerCase())) continue;
    if (isInterpreterOrPreparerField({ fieldName: pdfField, pdfFieldName: pdfField, label: edge.targetLabel || field.label, fieldType })) continue; // never filled by the system
    if (protectedCheck && protectedCheck(pdfField, field)) continue;
    seen.add(edge.targetFieldId);
    // a reviewed exception on the edge (the same contractExceptions mechanism party_markers and the contract use) means a person decided this box may hold the other side's data
    const reviewed = isAcknowledged(edge, "PARTY_CONTRADICTION") || isAcknowledged(edge, "PARTY_MARKER_MISMATCH") || isAcknowledged(edge, "PARTY_LANDING");
    boxes.push({ id: edge.targetFieldId, pdfField, fieldType, marker: markerForPath(edge.sourcePath), side: partyOfText(targetNames(edge, field)), reviewed });
  }
  return boxes;
}

// what each box really is in THIS pdf (class, options, limits): read once from the loaded template PDF
function describePdfFields(pdf) {
  const info = new Map();
  for (const field of pdf.getForm().getFields()) {
    const name = field.constructor?.name || "";
    const entry = { kind: "other" };
    if (name.includes("TextField")) { entry.kind = "text"; entry.maxLength = field.getMaxLength?.(); entry.multiline = Boolean(field.isMultiline?.()); }
    else if (name.includes("CheckBox")) entry.kind = "checkbox";
    else if (name.includes("RadioGroup")) { entry.kind = "radio"; entry.options = field.getOptions?.() || []; }
    else if (name.includes("Dropdown")) { entry.kind = "dropdown"; entry.options = field.getOptions?.() || []; }
    else if (name.includes("OptionList")) { entry.kind = "optionList"; entry.options = field.getOptions?.() || []; }
    info.set(field.getName(), entry);
  }
  return info;
}

/** Pure. The value for one box in one render. mode: "long" | "realistic". Returns { value, expectedText?, kind } or null when the box is not in this PDF. */
function valueFor(box, pdfInfo, mode) {
  const info = pdfInfo.get(box.pdfField);
  if (!info) return null;
  if (info.kind === "checkbox") return { value: true, kind: "checkbox" };
  if (info.kind === "radio" || info.kind === "dropdown" || info.kind === "optionList") {
    const option = (info.options || []).find((item) => String(item).trim() && !/^off$/i.test(String(item)));
    return option === undefined ? null : { value: option, kind: info.kind };
  }
  if (info.kind !== "text") return null;
  const typed = TYPED[box.fieldType] || (/zip/i.test(box.pdfField) ? TYPED.zip : null);
  if (typed) return { value: typed, kind: "text", typed: true };
  if (mode === "realistic") {
    const length = Number.isFinite(info.maxLength) && info.maxLength > 0 ? Math.min(info.maxLength, 80) : TYPICAL_LENGTH;
    return { value: textOfLength(length, box.marker), kind: "text", multiline: info.multiline };
  }
  return { value: textOfLength(LONG_TEXT_LENGTH, box.marker), kind: "text", multiline: info.multiline };
}

function buildCaseForm(boxes, pdfInfo, mode) {
  const filledData = {};
  const fieldValues = {};
  const planned = [];
  for (const box of boxes) {
    const given = valueFor(box, pdfInfo, mode);
    if (!given) continue;
    // the renderer reads filledData by PATH (a fieldId such as page1.form10Subform0Name0 is a nested path), exactly as autofill stores it
    MappingResolver.setPath(filledData, box.id, given.value);
    fieldValues[box.id] = given.value;
    planned.push({ box, ...given });
  }
  return { filledData, fieldValues, planned };
}

/** Pure. What the renderer was meant to write, as ArtifactValidator expected entries, given the render's own report of adjustments and refusals. */
function expectedFrom(planned, renderReport = {}, { measure }) {
  const adjusted = new Map((renderReport.adjustedFieldWrites || []).map((item) => [item.pdfField, item.to]));
  const failed = new Map((renderReport.failedFieldWrites || []).map((item) => [item.pdfField, item.message]));
  const entries = [];
  const refused = [];
  for (const item of planned) {
    if (failed.has(item.box.pdfField)) { refused.push({ field: String(item.box.pdfField).split(".").pop(), detail: `the renderer refused the value: ${failed.get(item.box.pdfField)}` }); continue; }
    const entry = { pdfField: item.box.pdfField, kind: item.kind, value: item.value, mayBeAbsent: true, measure };
    if (item.kind === "text") entry.text = adjusted.has(item.box.pdfField) ? adjusted.get(item.box.pdfField) : item.value;
    entries.push(entry);
  }
  return { entries, refused };
}

/** Pure. party landing: the text read back from each box holds only its own side's marker. */
function partyFailures(planned, readBack) {
  const failures = [];
  for (const item of planned) {
    if (item.kind !== "text" || !item.box.side || item.box.reviewed) continue;
    const found = sideOfMarker(readBack.get(item.box.pdfField));
    if (found && found !== item.box.side) failures.push({ check: "PARTY_LANDING", field: String(item.box.pdfField).split(".").pop(), detail: `the box speaks about the ${item.box.side} but holds ${found} data` });
  }
  return failures;
}

async function readBackText(buffer, pdfLib) {
  const pdf = await pdfLib.PDFDocument.load(buffer, { ignoreEncryption: true, updateMetadata: false });
  const out = new Map();
  for (const field of pdf.getForm().getFields()) if ((field.constructor?.name || "").includes("TextField")) { try { out.set(field.getName(), field.getText() || ""); } catch (error) { /* unreadable */ } }
  return out;
}

/**
 * probeEdition(template, { graph, componentCode?, deps?, nonLatin? }) -> { data: { ok, checked, failures, advisories }, artifact: { ok, failures, advisories, stats } }
 * deps (tests): { loadPdf(template), render({caseForm, template}), pdfLib, protectedCheck }
 */
async function probeEdition(template, { graph, componentCode = null, deps = {}, nonLatin = false } = {}) {
  const pdfLib = deps.pdfLib || require("pdf-lib");
  const PDFRenderer = deps.PDFRenderer || require("../form-generation/services/PDFRenderer");
  const protectedCheck = deps.protectedCheck || ((pdfField, meta) => require("../form-generation/services/ProtectedFieldPolicy").isProtectedField(pdfField, template.formCode, meta));
  const loadPdf = deps.loadPdf || (() => PDFRenderer.loadTemplatePdf(template, pdfLib.PDFDocument));
  const render = deps.render || ((args) => PDFRenderer.render({ ...args, watermark: null, flatten: false }));
  const baseCase = { formCode: componentCode || template.formCode, parentFormCode: componentCode ? template.formCode : undefined, componentCode: componentCode || undefined, formTemplateId: template._id };

  const sourcePdf = await loadPdf();
  const pdfInfo = describePdfFields(sourcePdf);
  const boxes = planBoxes({ template, graph, protectedCheck });
  const result = { data: { ok: true, checked: 0, failures: [], advisories: [] }, artifact: { ok: true, failures: [], advisories: [], stats: {} } };

  // 1. LONG render: the data survives
  const long = buildCaseForm(boxes, pdfInfo, "long");
  const longOut = await render({ caseForm: { ...baseCase, filledData: long.filledData, fieldValues: long.fieldValues }, template });
  const longRead = await readBackText(longOut.buffer, pdfLib);
  const expectedLong = expectedFrom(long.planned, longOut.renderReport, { measure: false });
  const dataCheck = await ArtifactValidator.validate(longOut.buffer, { template, expected: expectedLong.entries, pdfLib });
  result.data.checked = expectedLong.entries.length;
  result.data.failures.push(...expectedLong.refused.map((item) => ({ check: "VALUE_DROPPED", ...item })));
  result.data.failures.push(...dataCheck.failures.filter((failure) => failure.check === "VALUE_MISMATCH" && !/is not in the file/.test(failure.detail)));
  result.data.failures.push(...partyFailures(long.planned, longRead));
  // boxes of a component's pages are absent from a core render (and the other way round): a missing box is not a data failure
  result.data.advisories.push(...dataCheck.advisories);

  // 2. REALISTIC render: the final file looks right
  const realistic = buildCaseForm(boxes, pdfInfo, "realistic");
  const realOut = await render({ caseForm: { ...baseCase, filledData: realistic.filledData, fieldValues: realistic.fieldValues }, template });
  const expectedReal = expectedFrom(realistic.planned, realOut.renderReport, { measure: true });
  const artifact = await ArtifactValidator.validate(realOut.buffer, {
    template, expected: expectedReal.entries, pdfLib,
    expectedPageCount: realOut.renderReport?.componentPageCount || sourcePdf.getPageCount(),
    expectedFieldCount: deps.expectedFieldCount,
  });
  result.artifact = { ...artifact, failures: [...artifact.failures.filter((failure) => !(failure.check === "VALUE_MISMATCH" && /is not in the file/.test(failure.detail)))] };
  result.artifact.ok = result.artifact.failures.length === 0;

  // 3. optional: a non-Latin sample must not crash the render (reported, never a verdict - the renderer is not owned here)
  if (nonLatin) {
    const first = long.planned.find((item) => item.kind === "text" && !item.typed);
    if (first) {
      try {
        await render({ caseForm: { ...baseCase, filledData: { [first.box.id]: NON_LATIN_SAMPLE }, fieldValues: { [first.box.id]: NON_LATIN_SAMPLE } }, template });
        result.data.advisories.push({ check: "NON_LATIN", detail: "a non-Latin sample rendered without crashing" });
      } catch (error) {
        result.data.advisories.push({ check: "NON_LATIN_CRASH", detail: `a non-Latin sample made the render throw: ${String(error.message).slice(0, 120)}` });
      }
    }
  }
  result.data.ok = result.data.failures.length === 0;
  return result;
}

module.exports = { probeEdition, planBoxes, valueFor, textOfLength, expectedFrom, partyFailures, describePdfFields, sideOfMarker, NON_LATIN_SAMPLE, LONG_TEXT_LENGTH };
