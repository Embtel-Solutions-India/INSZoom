// DB-free: the part-aware party mapping (PartLocatorService, PartRuleInferenceService, partyFormSpecs) and the release path of forms with nothing to map.
const assert = require("node:assert/strict");
const test = require("node:test");
const { orderHeadings, partOfBox, onlyHeadingSized } = require("../services/PartLocatorService");
const { inferRulesForParties, factOf, tokenOf } = require("../services/PartRuleInferenceService");
const PartyFieldMappingService = require("../services/PartyFieldMappingService");
const { PARTY_FORM_SPECS, NO_MAPPING_FORMS } = require("../config/partyFormSpecs");

test("headings: a body-sized cross-reference is not a heading, and one out-of-order heading does not derail the parts after it", () => {
  const found = [
    { part: 1, page: 1, y: 390, height: 12 }, { part: 9, page: 1, y: 177, height: 10 }, // "Part 9. Additional Information" inside a sentence
    { part: 2, page: 3, y: 726, height: 12 }, { part: 4, page: 4, y: 480, height: 12 }, { part: 3, page: 4, y: 343, height: 12 }, // 4 printed above 3
    { part: 5, page: 5, y: 727, height: 12 }, { part: 6, page: 8, y: 724, height: 12 },
  ];
  const heights = new Map([[10, 14650], [12, 1743]]);
  const headings = onlyHeadingSized(found, heights);
  assert.equal(headings.some((item) => item.height === 10), false);
  assert.deepEqual(orderHeadings(headings).map((item) => item.part), [1, 2, 4, 5, 6]);
});

test("headings: a form that prints them at body size keeps every candidate; a repeated running header counts once", () => {
  const found = [{ part: 1, page: 1, y: 700, height: 10 }, { part: 1, page: 2, y: 740, height: 10 }, { part: 2, page: 2, y: 400, height: 10 }];
  assert.equal(onlyHeadingSized(found, new Map([[10, 500]])).length, 3);
  assert.deepEqual(orderHeadings(found).map((item) => [item.part, item.page]), [[1, 1], [2, 2]]);
});

test("a box belongs to the last heading above it in reading order", () => {
  const ordered = orderHeadings([{ part: 1, page: 1, y: 700 }, { part: 2, page: 2, y: 500 }]);
  assert.equal(partOfBox(ordered, { page: 1, y: 800 }), 0);
  assert.equal(partOfBox(ordered, { page: 1, y: 650 }), 1);
  assert.equal(partOfBox(ordered, { page: 2, y: 600 }), 1);
  assert.equal(partOfBox(ordered, { page: 2, y: 450 }), 2);
});

test("a box's fact is read from its own name, with the Part / Line markers removed", () => {
  assert.equal(tokenOf("p1Line10DateofBirth"), "dateofbirth");
  assert.equal(tokenOf("p1Line5StreetNumberName"), "streetnumbername");
  assert.equal(tokenOf("Line_CityTown"), "citytown");
  assert.equal(factOf("p1Line3aFamilyName"), "lastName");
  assert.equal(factOf("FamilyNameLastName"), "lastName");
  assert.equal(factOf("P1_Line9_DOB"), "dateOfBirth");
  assert.equal(factOf("P1_Line3a_Name", "Item 3: Enter Family Name (Last Name)"), "lastName");
  assert.equal(factOf("E-mailAddress"), "email");
  assert.equal(factOf("P1_Line4f_ZipCode"), "ADDR.zip");
  assert.equal(factOf("SomethingUnrelated"), null);
});

const box = (stem, page, top, type = "text", left = 50) => ({ targetPdfField: `form1[0].#subform[${page}].${stem}[0]`, label: stem, type, pageNumber: page, coordinates: { boundingBox: { top, left } } });

test("inside a party's parts only the first occurrence of each fact is mapped, page-restricted; the other party's part maps its own", () => {
  const fields = [
    box("FamilyNameLastName", 2, 700), box("GivenNameFirstName", 2, 680), box("DateofBirth", 2, 660),
    box("FamilyNameLastName", 3, 700), // the petitioner's spouse, later in the same parts: not mapped
    box("FamilyNameLastName", 5, 700), box("GivenNameFirstName", 5, 680), // part 4: the beneficiary
    box("Attorney_FamilyName", 2, 600), // an attorney is nobody's
  ];
  const parts = new Map([[fields[0].targetPdfField, 2], [fields[3].targetPdfField, 2], [fields[4].targetPdfField, 4]]);
  const partOf = (field) => (field.pageNumber === 2 ? 2 : field.pageNumber === 3 ? 2 : 4);
  assert.ok(parts.size);
  const { rules } = inferRulesForParties(fields, partOf, [{ party: "petitioner", parts: [1, 2, 3] }, { party: "beneficiary", parts: [4] }]);
  const by = Object.fromEntries(rules.map((rule) => [rule.to, rule]));
  assert.deepEqual(by["petitioner.lastName"].pages, [2]);
  assert.deepEqual(by["petitioner.firstName"].stems, ["GivenNameFirstName"]);
  assert.equal(by["petitioner.dateOfBirth"].pages[0], 2);
  assert.deepEqual(by["beneficiary.lastName"].pages, [5]);
  assert.ok(!rules.some((rule) => rule.stems.includes("Attorney_FamilyName")));
  assert.equal(rules.filter((rule) => rule.to === "petitioner.lastName").length, 1);
});

test("an address is taken from ONE block: the first street box and the boxes nearest to it", () => {
  const fields = [
    box("Line7b_StreetNumberName", 2, 500, "text", 40), box("Line_CityTown", 2, 480, "text", 40), box("P1_Line3_ZipCode", 2, 478, "number", 300),
    box("Line8a_StreetNumberName", 2, 100, "text", 40), box("Line8a_CityTown", 2, 80, "text", 40), // a second address further down
  ];
  const { rules } = inferRulesForParties(fields, () => 1, [{ party: "petitioner", parts: [1] }]);
  const by = Object.fromEntries(rules.map((rule) => [rule.to, rule.stems[0]]));
  assert.equal(by["petitioner.address.line1"], "Line7b_StreetNumberName");
  assert.equal(by["petitioner.address.city"], "Line_CityTown");
  assert.equal(by["petitioner.address.zip"], "P1_Line3_ZipCode");
});

test("the decided parties: I-212 leaves Part 5 blank; I-918 is the beneficiary with the petitioner as fallback; G-1055 / G-1651 need no mapping", () => {
  const i212 = PARTY_FORM_SPECS["I-212"].groups;
  assert.deepEqual(i212.find((group) => group.party === "petitioner").parts, [1, 2, 3, 4]);
  assert.deepEqual(i212.find((group) => group.party === "beneficiary").parts, [6]);
  assert.ok(!i212.some((group) => group.parts.includes(5)));
  // I-821D: only Part 1, from the petitioner - no beneficiary group at all
  assert.deepEqual(PARTY_FORM_SPECS["I-821D"].groups, [{ party: "petitioner", parts: [1] }]);
  assert.deepEqual(PARTY_FORM_SPECS["I-918"].identity, { party: "beneficiary", fallbackParty: "petitioner" });
  assert.equal(PARTY_FORM_SPECS["I-864A"].identity.party, "beneficiary");
  assert.ok(NO_MAPPING_FORMS.has("G-1055") && NO_MAPPING_FORMS.has("G-1651"));
});

test("a decided identity form is mapped even though the registry serves family cases, and I-918 carries the petitioner fallback", () => {
  const field = (stem, type = "text") => ({ fieldId: stem, fieldName: `form1[0].#subform[0].${stem}[0]`, pdfFieldName: `form1[0].#subform[0].${stem}[0]`, label: stem, type, pageNumber: 1 });
  const template = { formCode: "I-918", version: "x", editionDate: new Date(), formFields: [field("Pt1Line1a_FamilyName"), field("Pt1Line1b_GivenName"), field("Pt1Line2_AlienNumber", "alienNumber")] };
  const { graph } = PartyFieldMappingService.plan(template, { edges: [], nodes: {} }, { allowInference: false });
  const edge = (stem) => graph.edges.find((item) => item.targetPdfField.includes(stem));
  assert.equal(edge("FamilyName").sourcePath, "beneficiary.lastName");
  assert.equal(edge("FamilyName").fallback, "petitioner.lastName");
  assert.equal(edge("AlienNumber").sourcePath, "beneficiary.alienRegistrationNumber");
});

test("the release gate accepts a form with nothing to map without an active mapping, and still requires approval", async () => {
  const gate = require("../../form-release/ReleaseGate");
  const noMap = { formCode: "G-1055", approvedAt: new Date(), approvedBy: "u1", mappingStatus: "unmapped" };
  const normal = { formCode: "I-999", approvedAt: new Date(), approvedBy: "u1", mappingStatus: "unmapped" };
  const evaluate = async (template) => gate.evaluate(template, { deps: { policy: async () => ({ allowed: true, reasons: [] }), editionDiff: async () => ({ blocked: false }), certification: async () => ({ passed: true, checks: [] }) } }).catch((error) => ({ error: error.message }));
  const a = await evaluate(noMap);
  const b = await evaluate(normal);
  assert.ok(!/mapping before activating|Activate and validate the form mapping/.test(String(a.error || "")), "G-1055 is not blocked on its mapping");
  assert.ok(b.canPromote === false || /mapping/i.test(String(b.error || "")), "an ordinary unmapped form is still blocked");
});

test("an 'Alien Registration Number' box is not read as the beneficiary's - it is an identifier any party can hold; a box that names the beneficiary still is", () => {
  const { partyOfText, validateGraphContract } = require("../contract/MappingContractValidator");
  assert.equal(partyOfText("Enter Alien Registration Number (A-Number) Part 2 Part2_Line5_AlienRegistrationNumber"), null);
  assert.equal(partyOfText("Alien Number"), null);
  assert.equal(partyOfText("Beneficiary Alien Registration Number"), "beneficiary");
  assert.equal(partyOfText("Petitioner's Alien Registration Number"), "petitioner");
  assert.equal(partyOfText("the applicant's family name"), "beneficiary");
  assert.ok(validateGraphContract);
});

test("a decided rule fully replaces a leftover review-status edge, so the mapping is ready on the FIRST pass (I-918 / I-485A)", () => {
  const field = (stem) => ({ fieldId: stem, fieldName: `form1[0].#subform[0].${stem}[0]`, pdfFieldName: `form1[0].#subform[0].${stem}[0]`, label: stem, type: "text", pageNumber: 1 });
  const template = { formCode: "I-918", version: "x", editionDate: new Date(), formFields: [field("Pt1Line1a_FamilyName"), field("Pt1Line1b_GivenName")] };
  const leftover = { mappingId: "g1", targetFieldId: "Pt1Line1a_FamilyName", targetPdfField: "form1[0].#subform[0].Pt1Line1a_FamilyName[0]", sourcePath: "person.lastName", status: "review", confidence: 40, origin: "ai", pageNumber: 1 };
  const { graph } = PartyFieldMappingService.plan(template, { edges: [leftover], nodes: {} }, { allowInference: false });
  const edge = graph.edges.find((item) => item.targetFieldId === "Pt1Line1a_FamilyName");
  assert.equal(edge.sourcePath, "beneficiary.lastName");
  assert.equal(edge.status, "active", "the review-status guess is replaced, not kept");
  assert.equal(edge.origin, "authored");
  assert.equal(graph.edges.filter((item) => item.status !== "active").length, 0);
});
