// DB-free checks of the authored rules for I-956 (regional center entity = the petitioner) and N-644 (applicant block = the case person): every rule matches its box by the real
// PDF field name, the mapping is valid and active, and nothing about the preparer / interpreter / certifier / decedent blocks is ever filled.
const assert = require("node:assert/strict");
const test = require("node:test");
const PartyFieldMappingService = require("../services/PartyFieldMappingService");
const { EXCLUSIVE_FORMS } = require("../config/partyFieldRules");

const stemOf = (name) => String(name).split(".").pop().replace(/\[\d+\]$/, "");
const box = (path, page, type = "text") => ({ fieldId: `p${page}.${path}`, fieldName: `form1[0].${path}`, pdfFieldName: `form1[0].${path}`, label: stemOf(path), type, pageNumber: page, section: `Page ${page}` });
const build = (formCode, boxes) => {
  const template = { formCode, version: "2024-04-01", editionDate: new Date("2024-04-01"), formFields: boxes };
  const nodes = { canonical: [], form: boxes.map((item) => ({ id: `form:${item.fieldId}`, fieldId: item.fieldId, pdfField: item.fieldName })) };
  return PartyFieldMappingService.plan(template, { nodes, edges: [], unmappedTargets: [] }, { allowInference: false });
};
const bySource = (graph) => Object.fromEntries(graph.edges.map((edge) => [edge.sourcePath, edge]));

const I956_BOXES = [
  box("P1[0].sfPart2[0].P2_Line1_RegCtrEntityLegalName[0]", 1),
  box("P1[0].sfPart2[0].P2_Line7_RegEntFedEmployerNum[0]", 2),
  box("P1[0].sfPart2[0].sfP2_Line8[0].P2_Line8_StreetNumberName[0]", 2),
  box("P1[0].sfPart2[0].sfP2_Line8[0].P2_Line8_AptSteFlrNumber[0]", 2),
  box("P1[0].sfPart2[0].sfP2_Line8[0].P2_Line8_CityOrTown[0]", 2),
  box("P1[0].sfPart2[0].sfP2_Line8[0].P2_Line8_State[0]", 2, "dropdown"),
  box("P1[0].sfPart2[0].sfP2_Line8[0].P2_Line8_ZIPCode[0]", 2, "number"),
  box("P1[0].sfPart2[0].sfP2_Line8[0].P2_Line8_Country[0]", 2),
  box("P1[0].sfPart2[0].sfP2_Line9_12[0].P3_Line4_DaytimeTelePhoneNumber[0]", 2, "phone"),
  box("P1[0].sfPart2[0].sfP2_Line9_12[0].P3_Line6_Email[0]", 2, "email"),
  box("P1[0].sfPart2[0].sfP2_Line9_12[0].P3_Line6_Email[1]", 2, "email"), // the website box: never filled with an e-mail address
  // someone else's blocks and the page-12 copy of the entity name ("cannot be completed electronically")
  box("P1[0].sfPart9[0].sfCertifierContactInfo[0].P9_Line1_CertifierFamilyName[0]", 7),
  box("P1[0].sfPart11[0].sfInterpreterFullName[0].P11_Line1_InterpreterFamilyName[0]", 9),
  box("P1[0].sfPart12[0].sfPreparersFullName[0].P12_Line1_InterpreterFamilyName[0]", 10),
  box("P1[0].sfPart13[0].P2_Line1_RegCtrEntityLegalName[0]", 12),
];

const N644_BOXES = [
  box("#subform[0].ApplicanLastFirstMiddleName[0]", 1),
  box("#subform[0].ApplicantAddress[0]", 1),
  box("#subform[0].ApplicantCityStateCountryZip[0]", 1, "number"),
  box("#subform[0].ApplicantDOB[0]", 1, "date"),
  box("#subform[0].ApplicantAnumber[0]", 1, "alienNumber"),
  box("#subform[0].ApplicantE-MailAddress[0]", 1, "email"),
  box("#subform[0].DecedentLastFirstMiddleName[0]", 1), // the decedent is someone else
  box("#subform[0].DecedentDateofBirth[0]", 1, "date"),
  box("#subform[1].FatherLastFirstMiddleName[0]", 2),
];

test("both forms are exclusive: no guessed value can reach a box that no authored rule covers", () => {
  assert.ok(EXCLUSIVE_FORMS.has("I-956"));
  assert.ok(EXCLUSIVE_FORMS.has("N-644"));
});

test("I-956: the regional center entity's name, EIN, address, phone and e-mail come from the petitioner, and only Part 2 is mapped", () => {
  const { graph, report } = build("I-956", I956_BOXES);
  assert.equal(graph.validation.errors.length, 0);
  assert.equal(graph.validation.summary.reviewRequired, 0, "nothing left in review, so the mapping activates");
  const edges = bySource(graph);
  for (const path of ["petitioner.name", "petitioner.ein", "petitioner.address.line1", "petitioner.address.line2", "petitioner.address.city", "petitioner.address.state", "petitioner.address.zip", "petitioner.address.country", "petitioner.phone", "petitioner.email"]) {
    assert.ok(edges[path], `${path} is mapped`);
    assert.equal(edges[path].status, "active");
  }
  assert.equal(report.created, 10);
  assert.match(edges["petitioner.name"].targetPdfField, /sfPart2\[0\]\.P2_Line1_RegCtrEntityLegalName\[0\]$/, "the page-1 name box");
  assert.equal(edges["petitioner.email"].targetPdfField.endsWith("P3_Line6_Email[0]"), true, "the e-mail box, not the website box");
  assert.ok(!graph.edges.some((edge) => /Certifier|Interpreter|Preparer|sfPart13/.test(edge.targetPdfField)), "other people's blocks and the page-12 copy stay blank");
  assert.ok(graph.edges.every((edge) => edge.sourcePath.startsWith("petitioner.")), "the filer is the entity, never the beneficiary");
});

test("I-956 is idempotent: a second pass changes nothing", () => {
  const first = build("I-956", I956_BOXES);
  const template = { formCode: "I-956", version: "2024-04-01", editionDate: new Date("2024-04-01"), formFields: I956_BOXES };
  const second = PartyFieldMappingService.plan(template, first.graph, { allowInference: false });
  assert.equal(second.report.created, 0);
  assert.equal(second.graph.edges.length, first.graph.edges.length);
});

test("N-644: the applicant block is mapped from the case person (name as Last, First, Middle; one city/state/zip line); the decedent and family history stay blank", () => {
  const { graph, report } = build("N-644", N644_BOXES);
  assert.equal(graph.validation.errors.length, 0);
  assert.equal(graph.validation.summary.reviewRequired, 0);
  assert.equal(report.created, 6);
  const byTarget = (stem) => graph.edges.find((edge) => stemOf(edge.targetPdfField) === stem);
  const name = byTarget("ApplicanLastFirstMiddleName");
  assert.deepEqual(name.transform.fields, ["beneficiary.lastName", "beneficiary.firstName", "beneficiary.middleName"]);
  assert.equal(name.transform.separator, ", ");
  assert.deepEqual(byTarget("ApplicantCityStateCountryZip").transform.fields, ["beneficiary.city", "beneficiary.state", "beneficiary.zipCode"]);
  for (const stem of ["ApplicantAddress", "ApplicantDOB", "ApplicantAnumber", "ApplicantE-MailAddress"]) assert.ok(byTarget(stem), `${stem} is mapped`);
  assert.ok(graph.edges.every((edge) => edge.sourcePath.startsWith("beneficiary.")));
  assert.ok(!graph.edges.some((edge) => /Decedent|Father/.test(edge.targetPdfField)), "no decedent or parent box is filled");
});
