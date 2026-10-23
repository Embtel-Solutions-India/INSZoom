// Phase 3 certification that proves correctness (party_markers + widget_inputs). DB-free: a synthetic graph through the REAL MappingResolver.
const test = require("node:test");
const assert = require("node:assert/strict");
const { partyMarkerReport, widgetInputReport, markerForPath, MARKERS } = require("../markerCertification");

const edge = (id, extra = {}) => ({ mappingId: `m:${id}`, targetFieldId: id, status: "active", targetPdfField: `form.${id}[0]`, targetType: "text", transform: { type: "direct" }, ...extra });
const graph = (...edges) => ({ edges });
const box = (label, section = "Part 1") => ({ targetLabel: label, section });

test("every party gets its own distinct marker and a path is judged by its root", () => {
  assert.equal(new Set(Object.values(MARKERS)).size, 4);
  assert.equal(markerForPath("petitioner.address.city"), MARKERS.petitioner);
  assert.equal(markerForPath("beneficiary.firstName"), MARKERS.beneficiary);
  assert.equal(markerForPath("company.name"), MARKERS.company);
  assert.equal(markerForPath("raw.questionnaireAnswers.employer_company_name.value"), MARKERS.petitioner, "a raw checklist answer is judged by the party word of its key");
  assert.equal(markerForPath("raw.questionnaireAnswers.employee_filingType.value"), MARKERS.beneficiary);
  assert.equal(markerForPath("person.lastName"), "NEUTRAL_TEST", "a path with no party root makes no party claim");
});

test("party_markers: a box gets its own side's data and passes", () => {
  const report = partyMarkerReport({ graph: graph(
    edge("a", { sourcePath: "petitioner.name", ...box("Employer name") }),
    edge("b", { sourcePath: "beneficiary.firstName", ...box("Beneficiary first name") }),
  ) });
  assert.equal(report.passed, true);
  assert.equal(report.checked, 2);
});

test("party_markers: the other party's data in a box is a violation, found by the marker (not by the path text alone)", () => {
  const report = partyMarkerReport({ graph: graph(edge("a", { sourcePath: "petitioner.firstName", ...box("Beneficiary first name") })) });
  assert.equal(report.passed, false);
  assert.equal(report.violations[0].code, "PARTY_MARKER_MISMATCH");
  assert.match(report.violations[0].reason, /PETITIONER_TEST_001/);
});

test("party_markers: a composite that mixes two parties in one box is a violation", () => {
  const report = partyMarkerReport({ graph: graph(edge("mix", { sourcePath: "petitioner.firstName", transform: { type: "concat", fields: ["petitioner.firstName", "beneficiary.lastName"], separator: " " }, ...box("Full name") })) });
  assert.equal(report.violations.length, 1);
  assert.equal(report.violations[0].code, "MIXED_PARTIES");
});

test("party_markers: a reviewed exception silences only that code on only that edge", () => {
  const reviewed = edge("a", { sourcePath: "petitioner.firstName", ...box("Beneficiary first name"), contractExceptions: [{ code: "PARTY_CONTRADICTION", reason: "Reviewed: the box label names the wrong person, the PDF name is right", at: new Date() }] });
  const report = partyMarkerReport({ graph: graph(reviewed, edge("b", { sourcePath: "petitioner.firstName", ...box("Beneficiary first name") })) });
  assert.deepEqual(report.violations.map((v) => v.targetFieldId), ["b"]);
});

test("party_markers: a fallback of the other side is shown as an advisory and never blocks", () => {
  const report = partyMarkerReport({ graph: graph(edge("a", { sourcePath: "beneficiary.email", fallback: "petitioner.email", ...box("Applicant's email") })) });
  assert.equal(report.passed, true);
  assert.equal(report.advisories.length, 1);
});

test("party_markers: interpreter / preparer boxes are never filled, so they are skipped; a condition that does not apply is unobserved", () => {
  const report = partyMarkerReport({ graph: graph(
    edge("p", { sourcePath: "petitioner.firstName", targetPdfField: "form.Pt11_InterpreterGivenName[0]", ...box("Interpreter's Given Name") }),
    edge("c", { sourcePath: "petitioner.name", condition: { field: "case.neverSet", operator: "greater_than", value: 5 }, ...box("Employer name") }),
    edge("inactive", { status: "needs_review", sourcePath: "petitioner.firstName", ...box("Beneficiary first name") }),
  ) });
  assert.equal(report.passed, true);
  assert.equal(report.blankPolicyBoxes, 1);
  assert.equal(report.checked, 0);
});

test("widget_inputs: a tick box must get a boolean, and a date box a date", () => {
  const report = widgetInputReport({ graph: graph(
    edge("t", { sourcePath: "beneficiary.firstName", targetType: "checkbox", ...box("Item 1") }),
    edge("ok", { sourcePath: "beneficiary.gender", targetType: "checkbox", transform: { type: "checkbox", value: "female" }, ...box("Female") }),
    edge("d", { sourcePath: "beneficiary.firstName", targetType: "date", transform: { type: "direct" }, ...box("Date of birth") }),
    edge("dok", { sourcePath: "beneficiary.dob", targetType: "date", transform: { type: "date", format: "mm/dd/yyyy" }, ...box("Date of birth") }),
  ) });
  const byId = Object.fromEntries(report.violations.map((v) => [v.targetFieldId, v.code]));
  assert.equal(byId.t, "WIDGET_NOT_BOOLEAN");
  assert.equal(byId.d, "DATE_NOT_A_DATE");
  assert.equal(byId.ok, undefined);
  assert.equal(byId.dok, undefined);
});

test("widget_inputs: a drop-down uses the renderer's own matcher - 'H-1B' finds 'H1B - SPECIALITY OCCUPATION', an unknown value is dropped", () => {
  const options = [" ", "H1B - SPECIALITY OCCUPATION", "F1 - STUDENT - ACADEMIC"];
  const targetsById = new Map([["dd", { options }]]);
  const fits = widgetInputReport({ graph: graph(edge("dd", { sourcePath: "case.visaType", targetType: "dropdown", ...box("Status") })), targetsById });
  assert.equal(fits.violations.length, 0, "the sample visa type for the general family is H-1B");
  const drops = widgetInputReport({ graph: graph(edge("dd", { sourcePath: "beneficiary.countryOfBirth", targetType: "dropdown", ...box("Country") })), targetsById });
  assert.equal(drops.violations[0]?.code, "DROPDOWN_VALUE_NOT_AN_OPTION");
});

test("widget_inputs: the sample client's placeholder answer says nothing about a drop-down or a date", () => {
  const report = widgetInputReport({ graph: graph(edge("x", { sourcePath: "raw.questionnaireAnswers.some_free_text.value", targetType: "date", ...box("Date") })), targetsById: new Map() });
  assert.equal(report.violations.length, 0);
  assert.equal(report.unobserved, 1);
});
