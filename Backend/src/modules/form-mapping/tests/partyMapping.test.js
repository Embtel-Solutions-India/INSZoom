// DB-free tests for the generic party mapping: the profile builder's beneficiary.* / petitioner.* roots and the rule engine that wires every field of
// a form that asks for the same party fact.
const assert = require("node:assert/strict");
const test = require("node:test");
const PartyAliasService = require("../../canonical/services/PartyAliasService");
const PartyFieldMappingService = require("../services/PartyFieldMappingService");

test("beneficiary.* and petitioner.* are filled from the data the case holds, without overwriting anything", () => {
  const profile = PartyAliasService.apply({
    person: { firstName: "Tia", lastName: "Nafta", dob: "1990-02-03", alienNumber: "123456789", passport: { number: "P1" } },
    contact: { address: { formatted: "55 Oak Street Apt 4B, Columbus, OH 43004" } },
    company: { name: "Acme", ein: "12-3456789", authorizedRepresentative: { name: "Sam Signer", phone: "5125550100" }, address: { formatted: "1 Main St, Austin, TX 78701, USA" } },
    beneficiary: { firstName: "Keep" },
  });
  assert.equal(profile.beneficiary.firstName, "Keep", "an existing value is never overwritten");
  assert.equal(profile.beneficiary.lastName, "Nafta");
  assert.equal(profile.beneficiary.dateOfBirth, "1990-02-03");
  assert.equal(profile.beneficiary.passport.number, "P1");
  assert.deepEqual([profile.beneficiary.address, profile.beneficiary.apartment, profile.beneficiary.city, profile.beneficiary.state, profile.beneficiary.zipCode], ["55 Oak Street", "4B", "Columbus", "OH", "43004"]);
  assert.equal(profile.petitioner.name, "Acme");
  assert.equal(profile.petitioner.ein, "12-3456789");
  assert.equal(profile.petitioner.signatory.firstName, "Sam");
  assert.equal(profile.petitioner.signatory.lastName, "Signer");
  assert.equal(profile.petitioner.phone, "5125550100", "the petitioner's contact phone falls back to the signatory's");
  assert.deepEqual([profile.petitioner.address.line1, profile.petitioner.address.city, profile.petitioner.address.state, profile.petitioner.address.zip], ["1 Main St", "Austin", "TX", "78701"]);
});

test("an address that cannot be split is kept as the street line and never guessed into city / state / ZIP", () => {
  const profile = PartyAliasService.apply({ company: { name: "X", address: { formatted: "ccc block a" } } });
  assert.equal(profile.petitioner.address.line1, "ccc block a");
  assert.equal(profile.petitioner.address.city, undefined);
  assert.equal(profile.petitioner.address.zip, undefined);
});

// a tiny I-129-shaped template: the petitioner name is asked on the cover and on two supplements, the joint employer is someone else
const field = (stem, page, type = "text") => ({ fieldId: `p${page}.${stem}`, fieldName: `form1[0].#subform[${page}].${stem}[0]`, label: stem, type, pageNumber: page, section: `Page ${page}` });
const template = {
  _id: "t1", formCode: "I-129", version: "2026-09-09", editionDate: new Date("2026-09-09"),
  formFields: [
    field("Line3_CompanyorOrgName", 1), field("SupELine1_NameofEmployer", 9), field("TASupLine1_NameofPetitioner", 11), field("Line1_PetitionerName", 13), field("Sect3_PartA_PetitionerName", 18),
    field("Line24_PetitionerName", 18), // joint employer - a different entity
    field("Line7b_StreetNumberName", 1, "number"), field("Line7b_StreetNumberName", 7, "number"), // page 7 is the preparer
    field("Part3_Line2_FamilyName", 2), field("Line2_BeneficiaryName", 13), field("TASupLine1_NameofBeneficiary", 11),
    field("Line6_DateOfBirth", 3, "date"), field("Line6_DateOfBirth", 37, "date"), // page 37 is an additional beneficiary
  ],
};
const baseGraph = () => ({
  nodes: { canonical: [{ id: "canonical:company.name", path: "company.name", label: "company.name", type: "text" }], form: template.formFields.map((item) => ({ id: `form:${item.fieldId}`, fieldId: item.fieldId, pdfField: item.fieldName })) },
  edges: [{ mappingId: "e1", targetFieldId: "p1.Line3_CompanyorOrgName", targetPdfField: template.formFields[0].fieldName, sourcePath: "company.name", mappingType: "direct", status: "active", transform: { type: "direct" } }],
  unmappedTargets: [],
});

test("every field that repeats the petitioner / beneficiary fact is mapped, and fields about someone else are left alone", () => {
  const { graph, report } = PartyFieldMappingService.plan(template, baseGraph());
  const edgeFor = (id) => graph.edges.find((edge) => edge.targetFieldId === id);
  ["p1.Line3_CompanyorOrgName", "p9.SupELine1_NameofEmployer", "p11.TASupLine1_NameofPetitioner", "p13.Line1_PetitionerName", "p18.Sect3_PartA_PetitionerName"].forEach((id) => assert.equal(edgeFor(id)?.sourcePath, "petitioner.name", id));
  assert.equal(edgeFor("p18.Line24_PetitionerName"), undefined, "the joint employer is not the petitioner");
  assert.equal(edgeFor("p1.Line7b_StreetNumberName")?.sourcePath, "petitioner.address.line1");
  assert.equal(edgeFor("p7.Line7b_StreetNumberName"), undefined, "the preparer's address block is not the petitioner's");
  assert.equal(edgeFor("p3.Line6_DateOfBirth")?.sourcePath, "beneficiary.dateOfBirth");
  assert.equal(edgeFor("p37.Line6_DateOfBirth"), undefined, "an additional beneficiary is not this beneficiary");
  const full = edgeFor("p13.Line2_BeneficiaryName");
  assert.equal(full.transform.type, "concat", "a full-name field is the first + middle + last name");
  assert.deepEqual(full.transform.fields, ["beneficiary.firstName", "beneficiary.middleName", "beneficiary.lastName"]);
  assert.equal(graph.validation.valid, true, JSON.stringify(graph.validation.errors));
  assert.ok(report.byConcept["petitioner.name"] === 5);
});

test("an existing edge keeps its old source as the fallback, so data that flowed before still fills", () => {
  const { graph } = PartyFieldMappingService.plan(template, baseGraph());
  const rewired = graph.edges.find((edge) => edge.targetFieldId === "p1.Line3_CompanyorOrgName");
  assert.equal(rewired.sourcePath, "petitioner.name");
  assert.equal(rewired.fallback, "company.name");
});

test("a leftover condition on the old address follows the field to the petitioner's address", () => {
  const graph = baseGraph();
  graph.edges.push({ mappingId: "e2", targetFieldId: "p1.Line7b_StreetNumberName", targetPdfField: template.formFields[6].fieldName, sourcePath: "contact.address.line1", mappingType: "direct", status: "active", transform: { type: "direct" }, condition: { field: "contact.address.country", operator: "equals", value: "United States" } });
  const out = PartyFieldMappingService.plan(template, graph).graph.edges.find((edge) => edge.targetFieldId === "p1.Line7b_StreetNumberName");
  assert.equal(out.sourcePath, "petitioner.address.line1");
  assert.equal(out.fallback, "contact.address.line1");
  assert.equal(out.condition.field, "petitioner.address.country");
});

test("planning twice changes nothing the second time (idempotent)", () => {
  const first = PartyFieldMappingService.plan(template, baseGraph());
  const second = PartyFieldMappingService.plan(template, first.graph);
  assert.equal(second.report.created, 0);
  assert.equal(second.report.rewired, 0);
  assert.equal(second.report.unchanged, second.report.matched);
});
