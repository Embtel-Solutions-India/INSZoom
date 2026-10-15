// DB-free checks of the I-824 field mapping against the REAL field list of the active USCIS template (fixtures/i824-template-fields.json, captured from the
// registered template): every rule stem exists, each lands on the intended field, nothing is invented, unrelated people's blocks stay untouched, and an old
// guessed graph is replaced - not extended - so no wrong value can reach the PDF.
const assert = require("node:assert/strict");
const test = require("node:test");
const fixture = require("./fixtures/i824-template-fields.json");
const PartyFieldMappingService = require("../services/PartyFieldMappingService");
const { RULES, EXCLUSIVE_FORMS } = require("../config/partyFieldRules");
const { I824_RULES } = require("../config/i824FieldRules");
const { I824_CANONICAL_FIELDS } = require("../../canonical/config/i824CanonicalPaths");

const stemOf = (name) => String(name).split(".").pop().replace(/\[\d+\]$/, "").toLowerCase();
const template = {
  _id: "t824", formCode: "I-824", version: "2024-01-04", editionDate: new Date("2024-01-04"),
  formFields: fixture.map((item) => ({ fieldId: item.fieldId, fieldName: item.pdfFieldName, pdfFieldName: item.pdfFieldName, label: stemOf(item.pdfFieldName), type: item.type, pageNumber: item.pageNumber, section: `Page ${item.pageNumber}` })),
};
const staleGraph = () => ({
  nodes: { canonical: [], form: template.formFields.map((item) => ({ id: `form:${item.fieldId}`, fieldId: item.fieldId, pdfField: item.fieldName })) },
  // an old auto-guessed graph: the company name on a beneficiary name box, the applicant phone on the interpreter phone
  edges: [
    { mappingId: "old1", targetFieldId: template.formFields.find((f) => /Part3_Line5a_FamilyName/.test(f.pdfFieldName)).fieldId, targetPdfField: template.formFields.find((f) => /Part3_Line5a_FamilyName/.test(f.pdfFieldName)).pdfFieldName, sourcePath: "company.name", mappingType: "direct", status: "needs_review", transform: { type: "direct" } },
    { mappingId: "old2", targetFieldId: template.formFields.find((f) => /Part5_Line3_Interpreters/.test(f.pdfFieldName)).fieldId, targetPdfField: template.formFields.find((f) => /Part5_Line3_Interpreters/.test(f.pdfFieldName)).pdfFieldName, sourcePath: "contact.phone", mappingType: "direct", status: "needs_review", transform: { type: "direct" } },
  ],
  unmappedTargets: [{ targetFieldId: "stale" }],
});
const planned = PartyFieldMappingService.plan(template, staleGraph());
const edgeFor = (stem) => planned.graph.edges.filter((edge) => stemOf(edge.targetPdfField) === stem.toLowerCase());

test("I-824 rules are registered and the form is rule-exclusive", () => {
  assert.equal(RULES["I-824"], I824_RULES);
  assert.ok(EXCLUSIVE_FORMS.has("I-824"));
});

test("every rule stem is a real PDF field of the active template (no invented identifiers)", () => {
  const real = new Set(fixture.map((item) => stemOf(item.pdfFieldName)));
  I824_RULES.flatMap((rule) => rule.stems).forEach((stem) => assert.ok(real.has(stem.toLowerCase()), `not a real I-824 field: ${stem}`));
});

test("every rule source path is a registered canonical path", () => {
  const registered = new Set(I824_CANONICAL_FIELDS.map((field) => field.path));
  const shared = /^beneficiary\.(lastName|firstName|middleName|dateOfBirth|countryOfBirth|countryOfCitizenship|email)$/;
  I824_RULES.forEach((rule) => assert.ok(registered.has(rule.to) || shared.test(rule.to), rule.to));
});

test("the three people are mapped to their own blocks: petitioner Part 1, principal Part 3 Items 2-4, beneficiary Items 5-10", () => {
  const sourceOf = (stem) => edgeFor(stem).map((edge) => edge.sourcePath);
  assert.deepEqual(sourceOf("Part1_Line2a_FamilyName"), ["petitioner.lastName", "petitioner.lastName"], "page 1 + the additional-information page");
  assert.deepEqual(sourceOf("Part3_Line2a_FamilyName"), ["principalImmigrant.lastName"]);
  assert.deepEqual(sourceOf("Part3_Line5a_FamilyName"), ["beneficiary.lastName"]);
  assert.deepEqual(sourceOf("Part1_Line11_SSN"), ["petitioner.ssn"]);
  assert.deepEqual(sourceOf("Part1_Line10_IRSTaxNumber"), ["petitioner.irsTaxNumber"]);
  assert.deepEqual(sourceOf("Pt3Line3_CityOrTown"), ["principalImmigrant.mailingAddress.city"]);
  assert.deepEqual(sourceOf("Pt3Line4_CityOrTown"), ["principalImmigrant.physicalAddress.city"]);
  assert.deepEqual(sourceOf("Part1_Line13d_CityOrTown"), ["petitioner.mailingAddress.city"]);
  assert.deepEqual(sourceOf("Pt3Line33_Country"), ["beneficiary.foreignAddress.country"]);
  assert.deepEqual(sourceOf("Part3_Line34_ForeignNumber"), ["beneficiary.foreignTelephoneNumber"]);
  assert.deepEqual(sourceOf("Part3_Line10_DependentEmailAddress"), ["beneficiary.email"]);
});

test("no petitioner / principal path ever feeds a beneficiary block and vice versa", () => {
  planned.graph.edges.forEach((edge) => {
    const stem = stemOf(edge.targetPdfField);
    if (/^part3_line5[abc]_|^part3_line[6-9]_|^part3_line10_|^pt3line33_|^part3_line34_/.test(stem)) assert.ok(edge.sourcePath.startsWith("beneficiary."), `${stem} <- ${edge.sourcePath}`);
    if (/^part3_line2|^pt3line[34]_/.test(stem)) assert.ok(edge.sourcePath.startsWith("principalImmigrant."), `${stem} <- ${edge.sourcePath}`);
    if (/^part1_|^line13c_|^usciSonlineacctnumber$/i.test(stem)) assert.ok(edge.sourcePath.startsWith("petitioner."), `${stem} <- ${edge.sourcePath}`);
  });
});

test("the old guessed edges are removed, not kept: no company / interpreter / preparer / signature value can reach the PDF", () => {
  assert.equal(planned.report.removed, 1, "the interpreter phone edge is dropped");
  assert.equal(edgeFor("Part3_Line5a_FamilyName")[0].sourcePath, "beneficiary.lastName", "the company-name edge on a beneficiary name box is replaced by the verified source");
  assert.equal(edgeFor("Part5_Line3_InterpretersDaytimeTelephoneNumber").length, 0);
  planned.graph.edges.forEach((edge) => {
    assert.ok(edge.partyRule, `edge ${edge.targetPdfField} is not backed by a verified rule`);
    assert.equal(edge.status, "active");
    assert.ok(!/^company\.|^contact\./.test(edge.sourcePath), edge.sourcePath);
    assert.ok(!/interpreter|preparer|signature|barcode|pdf417|checkbox|p2_request|additionalinfo/i.test(edge.targetPdfField), `unrelated field mapped: ${edge.targetPdfField}`);
  });
});

test("unmapped fields are listed for staff (not silently dropped), do not block activation, and the graph validates", () => {
  assert.deepEqual(planned.graph.unmappedTargets, []);
  const left = planned.graph.intentionallyUnmapped.map((item) => stemOf(item.targetPdfField));
  assert.ok(left.includes("p2_request"), "the requested-action boxes are left for the case manager");
  assert.ok(left.includes("part3_line1b_receiptnumber"), "the underlying receipt number is left for staff verification");
  assert.equal(planned.graph.validation.errors.length, 0);
  assert.equal(planned.graph.validation.summary.reviewRequired, 0);
});

test("re-planning an already-planned graph is a no-op (idempotent - no duplicates on retries)", () => {
  const again = PartyFieldMappingService.plan(template, planned.graph);
  assert.equal(again.report.created, 0);
  assert.equal(again.graph.edges.length, planned.graph.edges.length);
  const targets = again.graph.edges.map((edge) => edge.targetFieldId);
  assert.equal(new Set(targets).size, targets.length, "one edge per PDF field");
});

test("transforms: addresses use state / country transforms, identifiers digits / SSN / A-number, phones phone", () => {
  assert.equal(edgeFor("Part1_Line13e_State")[0].transform.type, "usState");
  assert.equal(edgeFor("Part1_Line13i_Country")[0].transform.type, "country");
  assert.equal(edgeFor("Part1_Line11_SSN")[0].transform.type, "ssn");
  assert.equal(edgeFor("Part1_Line6_AlienNumber")[0].transform.type, "alienNumber");
  assert.equal(edgeFor("Part3_Line2g_DaytimeTelephoneNumber3")[0].transform.type, "phone");
});
