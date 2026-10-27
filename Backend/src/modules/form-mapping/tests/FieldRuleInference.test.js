// DB-free checks of the deterministic rule inference used for forms with no authored rules: it maps the filer's own identity facts, never another person's
// block, never addresses, never a repeated "other names" line, and it is stable (same input -> same rules) and wired into the mapping plan.
const assert = require("node:assert/strict");
const test = require("node:test");
const fixture = require("./fixtures/i824-template-fields.json");
const { inferRules } = require("../services/FieldRuleInferenceService");
const MappingGraphService = require("../services/MappingGraphService");
const PartyFieldMappingService = require("../services/PartyFieldMappingService");

const stemOf = (name) => String(name).split(".").pop().replace(/\[\d+\]$/, "");
const field = (stem, page, type = "text") => ({ fieldId: `p${page}.${stem}`, fieldName: `form1[0].#subform[${page}].${stem}[0]`, pdfFieldName: `form1[0].#subform[${page}].${stem}[0]`, label: stem, type, pageNumber: page, section: `Page ${page}` });
const getFields = (template) => MappingGraphService.getTemplateFields(template);
const toMap = (rules) => Object.fromEntries(rules.map((rule) => [rule.to, rule.stems]));

// a single-applicant form with the usual traps: other names on a later line, a spouse block, a preparer block, addresses, signature, additional info
const synthetic = {
  formCode: "I-999", version: "2026-01-01", editionDate: new Date("2026-01-01"),
  formFields: [
    field("Part1_Line1a_FamilyName", 1), field("Part1_Line1b_GivenName", 1), field("Part1_Line1c_MiddleName", 1),
    field("Part1_Line2a_FamilyName", 1), field("Part1_Line2b_GivenName", 1), // other names used - NOT the filer
    field("Part1_Line3_DateofBirth", 1, "date"), field("Part1_Line4_CountryofBirth", 1), field("Part1_Line5_CountryofCitizenship", 1),
    field("Part1_Line6_AlienNumber", 1, "alienNumber"), field("Part1_Line7_SSN", 1, "ssn"), field("Part1_Line8_EmailAddress", 1, "email"),
    field("Part1_Line9_DaytimePhoneNumber", 1, "phone"),
    field("Part1_Line10_StreetNumberName", 1), field("Part1_Line10_CityOrTown", 1), // addresses are never inferred
    field("Part2_Line1_FamilyName", 2), field("Part2_Line1_GivenName", 2), // not the filer's own block (Part 2)
    field("Part1_SpouseFamilyName", 1), // names another person
    field("Part6_Line1_PreparerFamilyName", 4), field("Part6_Line6_Signature", 4, "signature"), field("Part1_Line11_Sig", 1),
    field("Part1_Line1a_FamilyName", 6), // additional-information page repeats the filer's name
    field("PDF417BarCode1", 1, "textarea"), field("Part1_CheckBox", 1, "checkbox"),
  ],
};
const inferred = toMap(inferRules(synthetic, getFields));

test("maps the filer's own identity facts to the generic applicant root", () => {
  assert.deepEqual(inferred["beneficiary.lastName"], ["Part1_Line1a_FamilyName"], "the additional-information copy shares the stem, so one stem covers both pages");
  assert.deepEqual(inferred["beneficiary.firstName"], ["Part1_Line1b_GivenName"]);
  assert.deepEqual(inferred["beneficiary.middleName"], ["Part1_Line1c_MiddleName"]);
  assert.deepEqual(inferred["beneficiary.dateOfBirth"], ["Part1_Line3_DateofBirth"]);
  assert.deepEqual(inferred["beneficiary.countryOfBirth"], ["Part1_Line4_CountryofBirth"]);
  assert.deepEqual(inferred["beneficiary.countryOfCitizenship"], ["Part1_Line5_CountryofCitizenship"]);
  assert.deepEqual(inferred["beneficiary.alienRegistrationNumber"], ["Part1_Line6_AlienNumber"]);
  assert.deepEqual(inferred["beneficiary.ssn"], ["Part1_Line7_SSN"]);
  assert.deepEqual(inferred["beneficiary.email"], ["Part1_Line8_EmailAddress"]);
  assert.deepEqual(inferred["beneficiary.primaryPhone"], ["Part1_Line9_DaytimePhoneNumber"]);
});

test("never maps another person, a later 'other names' line, addresses, signatures, barcodes or checkboxes", () => {
  const stems = Object.values(inferred).flat();
  assert.ok(!stems.includes("Part1_Line2a_FamilyName") && !stems.includes("Part1_Line2b_GivenName"), "other-names line is not the filer");
  assert.ok(!stems.some((stem) => /Part2_|Spouse|Prepar|Sig|PDF417|CheckBox|Street|City/i.test(stem)), stems.join(","));
});

test("inference is deterministic", () => {
  assert.deepEqual(toMap(inferRules(synthetic, getFields)), inferred);
});

test("on the real I-824 field list it only ever touches Part 1 identity facts - and none of the preparer / interpreter / signature / other-person boxes", () => {
  const template = { formCode: "I-824", version: "x", editionDate: new Date(), formFields: fixture.map((item) => ({ fieldId: item.fieldId, fieldName: item.pdfFieldName, pdfFieldName: item.pdfFieldName, label: stemOf(item.pdfFieldName), type: item.type, pageNumber: item.pageNumber })) };
  const stems = inferRules(template, getFields).flatMap((rule) => rule.stems);
  assert.ok(stems.length > 0);
  stems.forEach((stem) => assert.ok(/^Part1_/.test(stem) && !/prepar|interpret|signature|Pt3|Part3|Part5|Part6/i.test(stem), stem));
});

test("the mapping plan uses inferred rules for a form without authored rules: active edges, unmapped fields listed (not blocking), graph valid, idempotent", () => {
  const base = () => ({ nodes: { canonical: [], form: synthetic.formFields.map((item) => ({ id: `form:${item.fieldId}`, fieldId: item.fieldId, pdfField: item.fieldName })) }, edges: [], unmappedTargets: [{ targetFieldId: "stale" }] });
  const first = PartyFieldMappingService.plan(synthetic, base());
  assert.ok(first.graph.edges.length >= 10);
  assert.ok(first.graph.edges.every((edge) => edge.status === "active" && edge.sourcePath.startsWith("beneficiary.")));
  assert.deepEqual(first.graph.unmappedTargets, []);
  assert.ok(first.graph.intentionallyUnmapped.some((item) => /Street/.test(item.targetPdfField)), "addresses are left for the case manager");
  assert.equal(first.graph.validation.errors.length, 0);
  const second = PartyFieldMappingService.plan(synthetic, first.graph);
  assert.equal(second.report.created, 0);
  assert.equal(second.graph.edges.length, first.graph.edges.length);
});

test("a form with authored rules is never overridden by inference", () => {
  const template = { formCode: "I-824", version: "x", editionDate: new Date(), formFields: fixture.map((item) => ({ fieldId: item.fieldId, fieldName: item.pdfFieldName, pdfFieldName: item.pdfFieldName, label: stemOf(item.pdfFieldName), type: item.type, pageNumber: item.pageNumber })) };
  const { graph } = PartyFieldMappingService.plan(template, { nodes: { canonical: [], form: template.formFields.map((item) => ({ id: `form:${item.fieldId}`, fieldId: item.fieldId, pdfField: item.fieldName })) }, edges: [], unmappedTargets: [] });
  assert.ok(graph.edges.some((edge) => edge.sourcePath === "petitioner.lastName"));
  assert.ok(!graph.edges.some((edge) => edge.sourcePath === "beneficiary.lastName" && /Part1_/.test(edge.targetPdfField)), "Part 1 of I-824 is the petitioner, per its authored rules");
});

test("for an inferred form the importer's unreviewed guesses are dropped or replaced, and a verified (active) carried-over edge is kept", () => {
  const nodes = { canonical: [], form: synthetic.formFields.map((item) => ({ id: `form:${item.fieldId}`, fieldId: item.fieldId, pdfField: item.fieldName })) };
  const byStem = (stem) => synthetic.formFields.find((item) => item.fieldId.endsWith(`.${stem}`) && item.pageNumber === 1);
  const edge = (stem, sourcePath, status) => ({ mappingId: `old-${stem}`, targetFieldId: byStem(stem).fieldId, targetPdfField: byStem(stem).pdfFieldName, sourcePath, mappingType: "direct", status, transform: { type: "direct" } });
  const graph = { nodes, unmappedTargets: [], edges: [
    edge("Part1_Line10_StreetNumberName", "company.name", "needs_review"), // a guess on an unmapped field: dropped
    edge("Part1_Line1a_FamilyName", "company.name", "needs_review"), // a guess on a field an inferred rule matches: replaced and activated
    edge("Part1_Line10_CityOrTown", "contact.address.city", "active"), // verified earlier mapping: kept
  ] };
  const { graph: next } = PartyFieldMappingService.plan(synthetic, graph);
  const bySource = Object.fromEntries(next.edges.map((item) => [stemOf(item.targetPdfField), item]));
  assert.equal(bySource.Part1_Line10_StreetNumberName, undefined);
  assert.equal(bySource.Part1_Line1a_FamilyName.sourcePath, "beneficiary.lastName");
  assert.equal(bySource.Part1_Line1a_FamilyName.status, "active");
  assert.ok(!bySource.Part1_Line1a_FamilyName.fallback, "no inherited junk fallback");
  assert.equal(bySource.Part1_Line10_CityOrTown.sourcePath, "contact.address.city");
  assert.equal(next.validation.summary.reviewRequired, 0, "nothing left in review, so the mapping can be activated");
});

test("Roman-numeral / lettered part names (I-589 style PtAILine4_LastName) are understood: the filer is Part A.I, the spouse Part A.II is not", () => {
  const f = (stem, type = "text") => field(stem, 1, type);
  const template = { formCode: "I-998", version: "x", editionDate: new Date(), formFields: [
    f("PtAILine1_ANumber", "alienNumber"), f("PtAILine4_LastName"), f("PtAILine5_FirstName"), f("PtAILine6_MiddleName"),
    f("PtAIILine1_ANumber", "alienNumber"), f("PtAIILine5_LastName"), f("PtAIILine6_FirstName"), // the spouse
    f("PtAILine8_StreetNumandName"), f("ChildLast1"), f("TextField1"),
  ] };
  const rules = toMap(inferRules(template, getFields));
  assert.deepEqual(rules["beneficiary.lastName"], ["PtAILine4_LastName"]);
  assert.deepEqual(rules["beneficiary.firstName"], ["PtAILine5_FirstName"]);
  assert.deepEqual(rules["beneficiary.middleName"], ["PtAILine6_MiddleName"]);
  assert.deepEqual(rules["beneficiary.alienRegistrationNumber"], ["PtAILine1_ANumber"]);
  assert.ok(!Object.values(rules).flat().some((stem) => /PtAII|Child|Street/.test(stem)));
});

test("P10 is never read as P1 and a Part 2 identity block is found when there is no Part 1 name", () => {
  const f = (stem) => field(stem, 1);
  const template = { formCode: "I-997", version: "x", editionDate: new Date(), formFields: [f("P2_L2_FamilyName"), f("P2_L2_GivenName"), f("P10_L1_FamilyName"), f("P10_L6_EmailAddress")] };
  const rules = toMap(inferRules(template, getFields));
  assert.deepEqual(rules["beneficiary.lastName"], ["P2_L2_FamilyName"]);
  assert.ok(!rules["beneficiary.email"], "Part 10 is not the filer's block");
});

// single-block forms with no "Part N" prefix (G-1145 / G-1650): the filer's block is found by name, and a block about someone else (the bank account holder) is never filled
test("an unnumbered form: the unique boxes map; a repeated name is limited to the applicant block, never the bank account holder's", () => {
  const named = (path, type = "text") => ({ fieldId: path, fieldName: path, pdfFieldName: path, label: path, type, pageNumber: 1, section: "Page 1" });
  const g1145 = { formCode: "G-1145", version: "x", editionDate: new Date(), formFields: [
    named("form1[0].#subform[0].LastName[0]"), named("form1[0].#subform[0].FirstName[0]"), named("form1[0].#subform[0].MiddleName[0]"),
    named("form1[0].#subform[0].Email[0]", "email"), named("form1[0].#subform[0].MobilePhoneNumber[0]", "phone"), named("form1[0].#pageSet[0].Page1[0].PDF417BarCode1[0]", "textarea"),
  ] };
  const one = toMap(inferRules(g1145, getFields));
  assert.deepEqual(one["beneficiary.lastName"], ["LastName"]);
  assert.deepEqual(one["beneficiary.mobilePhone"], ["MobilePhoneNumber"]);
  assert.ok(one["beneficiary.email"]);

  const g1650 = { formCode: "G-1650", version: "x", editionDate: new Date(), formFields: [
    named("form1[0].PG1[0].sfApplicantPetitionerName[0].GivenName[0]"), named("form1[0].PG1[0].sfApplicantPetitionerName[0].FamilyName[0]"),
    named("form1[0].PG1[0].sfBankAccountHolderInfo[0].GivenName[0]"), named("form1[0].PG1[0].sfBankAccountHolderInfo[0].FamilyName[0]"),
    named("form1[0].PG1[0].sfBankAccountInformation[0].BankName[0]"),
  ] };
  const rules = inferRules(g1650, getFields);
  assert.deepEqual(rules.map((rule) => [rule.to, rule.within]).sort(), [["beneficiary.firstName", "sfApplicantPetitionerName"], ["beneficiary.lastName", "sfApplicantPetitionerName"]]);
  const plan = PartyFieldMappingService.plan(g1650, { edges: [], nodes: {} }, { allowInference: true });
  const mapped = plan.graph.edges.map((edge) => edge.targetPdfField);
  assert.equal(mapped.length, 2);
  assert.ok(mapped.every((name) => name.includes("sfApplicantPetitionerName")), "no bank account holder box is filled");
});
