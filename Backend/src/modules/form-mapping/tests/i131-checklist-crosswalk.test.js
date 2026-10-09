const test = require("node:test");
const assert = require("node:assert/strict");
const crosswalk = require("../config/i131-crosswalk");
const { CHECKLIST_EDGES, RAW } = require("../config/i131-checklist-crosswalk");
const MappingResolver = require("../services/MappingResolver");
const { I131_CHECKLIST_DEFINITION } = require("../../questionnaires/i131Checklist");

const checklist = I131_CHECKLIST_DEFINITION;
const keys = new Set(checklist.questions.map((question) => question.key));

// the shape MappingGraphService.graphToFieldMappings gives the resolver for one edge
const mappingOf = (edge) => ({ source: "canonical", path: RAW(edge.checklistField), sourceField: RAW(edge.checklistField), transform: edge.transform, condition: edge.condition, fallback: edge.fallback });
const answers = (map) => ({ raw: { questionnaireAnswers: Object.fromEntries(Object.entries(map).map(([key, value]) => [key, { value }])) } });
const resolve = (fieldSuffix, data) => {
  const edge = CHECKLIST_EDGES.find((item) => item.fieldName.endsWith(fieldSuffix));
  assert.ok(edge, fieldSuffix);
  return MappingResolver.resolveMapping(mappingOf(edge), data, {});
};

test("every checklist-sourced edge reads a real I-131 checklist question and never duplicates a PERM edge", () => {
  CHECKLIST_EDGES.forEach((edge) => assert.ok(keys.has(edge.checklistField), `${edge.checklistField} is not an I-131 checklist question`));
  const names = crosswalk.MAPPED_EDGES.map((edge) => edge.fieldName);
  assert.equal(new Set(names).size, names.length, "one edge per form box");
});

test("the applicant answers use the canonical paths the form mapping reads (person.* / contact.address.*), not applicant.*", () => {
  const canonical = Object.fromEntries(checklist.questions.filter((question) => question.mapping).map((question) => [question.key, question.mapping.canonicalPath]));
  assert.equal(canonical.i131_applicant_lastName, "person.lastName");
  assert.equal(canonical.i131_applicant_dateOfBirth, "person.dob");
  assert.equal(canonical.i131_applicant_countryOfCitizenship, "person.citizenship");
  assert.equal(canonical.i131_applicant_aNumber, "person.alienNumber");
  assert.equal(canonical.i131_applicant_physicalAddress_city, "contact.address.city");
  Object.values(canonical).forEach((path) => assert.ok(!path.startsWith("applicant."), `${path} is not a canonical namespace`));
});

test("a Yes/No answer ticks exactly its own box (Item 3.a: [0] is Yes, [1] is No; Item 3.b is the reverse)", () => {
  const yes = answers({ i131_refugee_everReturned: "yes", i131_refugee_everAppliedNationalPassport: "yes" });
  assert.equal(resolve("P6_Line3a_YesNo[0]", yes).value, true);
  assert.equal(resolve("P6_Line3a_YesNo[1]", yes).skipped, true);
  assert.equal(resolve("P6_Line3b_YesNo[1]", yes).value, true);
  assert.equal(resolve("P6_Line3b_YesNo[0]", yes).skipped, true);
});

test("nothing is ticked or filled when the question was not answered", () => {
  assert.equal(resolve("P6_Line3a_YesNo[0]", answers({})).value, undefined);
  assert.equal(resolve("Part2_Line10_SSN[0]", answers({})).value, undefined);
});

test("Part 7 is filled only for advance parole; the delivery boxes only for a reentry permit / refugee travel document", () => {
  const base = { i131_dateOfIntendedDeparture: "2026-12-01", i131_delivery_method: "US_EMBASSY_OR_CONSULATE", i131_delivery_embassyCity: "Mumbai" };
  assert.equal(resolve("P7_Line1_DateOfDeparture[0]", answers({ ...base, i131_purpose: "ADVANCE_PAROLE_INSIDE_US" })).value, "12/01/2026");
  assert.equal(resolve("P7_Line1_DateOfDeparture[0]", answers({ ...base, i131_purpose: "REENTRY_PERMIT" })).skipped, true);
  assert.equal(resolve("P4_Line7a[0]", answers({ ...base, i131_purpose: "REFUGEE_TRAVEL_DOCUMENT" })).value, true);
  assert.equal(resolve("P4_Line7a[0]", answers({ ...base, i131_purpose: "ADVANCE_PAROLE_INSIDE_US" })).skipped, true);
  assert.equal(resolve("P4_Line7b_CityOrTown[0]", answers({ ...base, i131_purpose: "REENTRY_PERMIT" })).value, "Mumbai");
});

test("SSN is digits only, the countries list is joined, the pick-up address is split into its parts", () => {
  assert.equal(resolve("Part2_Line10_SSN[0]", answers({ i131_applicant_ssn: "123-45-6789" })).value, "123456789");
  assert.equal(resolve("P7_Line3_ListCountries[0]", answers({ i131_purpose: "ADVANCE_PAROLE_INSIDE_US", i131_travel_intendedCountries: [{ country: "India" }, { country: "Nepal" }] })).value, "India, Nepal");
  const pickup = answers({ i131_ap_pickupAddress: "55 Oak Ave Apt 4B, Dallas, TX 75201" });
  assert.equal(resolve("P4_Line9a_CityTown[0]", pickup).value, "Dallas");
  assert.equal(resolve("P4_Line9a_ZipCode[0]", pickup).value, "75201");
});

test("the Re-entry Permit box (Part 1 Item 1) is ticked only for that purpose", () => {
  assert.equal(resolve("CB_AppType[0]", answers({ i131_purpose: "REENTRY_PERMIT" })).value, true);
  assert.equal(resolve("CB_AppType[0]", answers({ i131_purpose: "REFUGEE_TRAVEL_DOCUMENT" })).skipped, true);
});
