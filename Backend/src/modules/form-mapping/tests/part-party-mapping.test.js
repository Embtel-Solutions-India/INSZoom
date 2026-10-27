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

// ---- headings printed side by side, the joint sponsor, and the I-134 / I-140 decisions ----
test("two part headings printed side by side on one line are ordered left to right, and a box belongs to the heading of ITS column (I-140 Part 8 | Part 9)", () => {
  const raw = [{ part: 7, page: 5, y: 725, x: 38 }, { part: 9, page: 6, y: 727, x: 320 }, { part: 8, page: 6, y: 725, x: 38 }, { part: 10, page: 7, y: 723, x: 38 }];
  const ordered = orderHeadings(raw);
  assert.deepEqual(ordered.map((heading) => heading.part), [7, 8, 9, 10]);
  assert.equal(partOfBox(ordered, { page: 6, y: 600, x: 40 }), 8, "left column");
  assert.equal(partOfBox(ordered, { page: 6, y: 600, x: 330 }), 9, "right column");
  assert.equal(partOfBox(ordered, { page: 6, y: 100, x: 330 }), 9, "further down the same column");
  assert.equal(partOfBox(ordered, { page: 5, y: 400, x: 330 }), 7, "an ordinary page is unaffected");
  assert.equal(partOfBox(ordered, { page: 7, y: 600, x: 330 }), 10, "the next page starts a new part");
});

test("the form's own vocabulary: street name, unit Number by its label, digit-suffixed phones, the safe mobile phone", () => {
  assert.equal(factOf("Part2_Item11_StreetName"), "ADDR.line1");
  assert.equal(factOf("Part2_Line3_Number", "Enter the Apartment, Suite, or Floor Number"), "ADDR.line2");
  assert.equal(factOf("Part2_Line3_Number", "Item 4: some other number"), null, "a bare Number is not a unit number unless its label says so");
  assert.equal(factOf("Part4_Line3_DaytimePhoneNumber3"), "phone");
  assert.equal(factOf("Part4_Line4_SafePhoneNumber3"), "mobilePhone");
});

test("a joint sponsor group reads the petitioner's joint sponsor, falls back to the beneficiary's, cuts the address from ONE composite answer, and never takes company facts", () => {
  const fields = [
    box("Pt1Line1_FamilyName", 2, 700), box("Pt1Line1_GivenName", 2, 680),
    box("Part2_Item11_StreetName", 2, 600, "text", 40), box("Part2_Item11_City", 2, 580, "text", 40), box("Part2_Item11_ZipCode", 2, 578, "text", 300),
    box("Part4_Line3_DaytimePhoneNumber3", 5, 500),
    box("NameOfEmployer", 2, 400), box("Company_Name", 2, 380),
    box("Part3_Line1_FamilyName", 3, 700),
  ];
  const partOf = (field) => (field.pageNumber === 3 ? 3 : field.pageNumber === 5 ? 5 : 2);
  const { rules } = inferRulesForParties(fields, partOf, [{ party: "petitioner", root: "petitioner.jointSponsor", fallbackRoot: "beneficiary.jointSponsor", parts: [2, 5] }, { party: "beneficiary", parts: [3] }]);
  const by = (to) => rules.filter((rule) => rule.to === to);
  assert.equal(by("petitioner.jointSponsor.lastName")[0].fallback, "beneficiary.jointSponsor.lastName");
  const street = by("petitioner.jointSponsor.mailingAddress").find((rule) => rule.transform.part === "street");
  assert.equal(street.stems[0], "Part2_Item11_StreetName");
  assert.equal(street.fallback, "beneficiary.jointSponsor.mailingAddress");
  assert.deepEqual(by("petitioner.jointSponsor.mailingAddress").map((rule) => rule.transform.part).sort(), ["city", "street", "zip"]);
  assert.equal(by("petitioner.jointSponsor.phone")[0].stems[0], "Part4_Line3_DaytimePhoneNumber3", "a later part of the same person fills what the first part lacked");
  assert.equal(by("beneficiary.lastName").length, 1);
  assert.equal(by("petitioner.jointSponsor.name").length, 0, "no company name for a joint sponsor");
});

test("an organisation's name and tax number map to the petitioner only", () => {
  const fields = [box("Line1_CompanyorOrgName", 1, 700), box("Line5_IRSTaxNumber", 1, 680), box("Line_FamilyName", 3, 700)];
  const partOf = (field) => (field.pageNumber === 3 ? 3 : 1);
  const { rules } = inferRulesForParties(fields, partOf, [{ party: "petitioner", parts: [1] }, { party: "beneficiary", parts: [3] }]);
  assert.deepEqual(rules.filter((rule) => rule.to === "petitioner.name" || rule.to === "petitioner.ein").map((rule) => rule.to).sort(), ["petitioner.ein", "petitioner.name"]);
  const beneficiaryOnly = inferRulesForParties([box("Line1_CompanyorOrgName", 3, 700)], () => 3, [{ party: "beneficiary", parts: [3] }]).rules;
  assert.equal(beneficiaryOnly.length, 0, "a beneficiary has no company name");
});

test("the decided parties for I-134 and I-140: joint sponsor in Parts 2 and 5 with a beneficiary fallback; I-140 Parts 1, 2, 5, 8 petitioner and 3, 4 beneficiary; the rest blank", () => {
  const i134 = PARTY_FORM_SPECS["I-134"].groups;
  assert.deepEqual(i134.find((group) => group.root === "petitioner.jointSponsor").parts, [2, 5]);
  assert.equal(i134.find((group) => group.root === "petitioner.jointSponsor").fallbackRoot, "beneficiary.jointSponsor");
  assert.deepEqual(i134.find((group) => group.party === "beneficiary" && !group.root).parts, [3, 4]);
  for (const blank of [1, 6, 7, 8]) assert.ok(!i134.some((group) => group.parts.includes(blank)), `I-134 part ${blank} stays blank`);
  const i140 = PARTY_FORM_SPECS["I-140"].groups;
  assert.deepEqual(i140.find((group) => group.party === "petitioner").parts, [1, 2, 5, 8]);
  assert.deepEqual(i140.find((group) => group.party === "beneficiary").parts, [3, 4]);
  for (const blank of [6, 7, 9, 10, 11]) assert.ok(!i140.some((group) => group.parts.includes(blank)), `I-140 part ${blank} stays blank`);
});

test("the registry knows the joint sponsor under BOTH roots, so a form box can read either", () => {
  const { JOINT_SPONSOR_FIELDS } = require("../../canonical/config/jointSponsorPaths");
  const paths = new Set(JOINT_SPONSOR_FIELDS.map((field) => field.path));
  for (const fact of ["lastName", "firstName", "middleName", "dateOfBirth", "ssn", "aNumber", "email", "phone", "mobilePhone", "mailingAddress"]) {
    assert.ok(paths.has(`petitioner.jointSponsor.${fact}`), `petitioner.jointSponsor.${fact}`);
    assert.ok(paths.has(`beneficiary.jointSponsor.${fact}`), `beneficiary.jointSponsor.${fact}`);
  }
  const registry = require("../services/CanonicalFieldRegistryService");
  const registered = new Set(registry.list({}).map((field) => field.path));
  assert.ok(registered.has("beneficiary.jointSponsor.email") && registered.has("petitioner.jointSponsor.middleName"));
});

test("a form with authored rules AND decided parts keeps the authored rules and adds the decided boxes", () => {
  const field = (stem, page) => ({ fieldId: stem, fieldName: `form1[0].#subform[${page}].${stem}[0]`, pdfFieldName: `form1[0].#subform[${page}].${stem}[0]`, label: stem, type: "text", pageNumber: page, coordinates: { boundingBox: { top: 700, left: 40 } } });
  const template = { formCode: "I-140", version: "x", editionDate: new Date(), formFields: [field("Line1_GivenName", 1), field("Part3_Line1_FamilyName", 2)] };
  const { RULES } = require("../config/partyFieldRules");
  const partOf = new Map([[template.formFields[0].pdfFieldName, 1], [template.formFields[1].pdfFieldName, 3]]);
  const { graph } = PartyFieldMappingService.plan(template, { edges: [], nodes: {} }, { allowInference: false, partOf });
  assert.ok(graph.edges.some((edge) => edge.sourcePath === "petitioner.firstName"), "a decided part-1 rule was added");
  assert.ok(graph.edges.some((edge) => edge.sourcePath === "beneficiary.lastName"), "a decided part-3 rule was added");
  assert.ok(RULES["I-140"].length > 0, "the authored rules are still there");
});

test("a decided rule replaces a leftover guess completely: no stale transform or condition, so the mapping validates (I-134 Part 3 names)", () => {
  const field = (stem) => ({ fieldId: stem, fieldName: `form1[0].#subform[0].${stem}[0]`, pdfFieldName: `form1[0].#subform[0].${stem}[0]`, label: stem, type: "text", pageNumber: 1, coordinates: { boundingBox: { top: 700, left: 40 } } });
  const template = { formCode: "I-134", version: "x", editionDate: new Date(), formFields: [field("Part3_Line1_FamilyName")] };
  const guess = { mappingId: "g", targetFieldId: "Part3_Line1_FamilyName", targetPdfField: template.formFields[0].pdfFieldName, sourcePath: "person.lastName", status: "review", transform: { type: "concat", fields: ["person.firstName", "person.lastName"] }, condition: { field: "x", operator: "equals", value: 1 }, pageNumber: 1 };
  const partOf = new Map([[template.formFields[0].pdfFieldName, 3]]);
  const { graph } = PartyFieldMappingService.plan(template, { edges: [guess], nodes: {} }, { allowInference: false, partOf });
  const edge = graph.edges[0];
  assert.equal(edge.sourcePath, "beneficiary.lastName");
  assert.notEqual(edge.transform.type, "concat", "the guess's transform is gone");
  assert.equal(edge.transform.fields, undefined);
  assert.equal(edge.condition, undefined, "and so is its condition");
  assert.equal(edge.status, "active");
});

test("no font-size rule: a REAL heading printed at body size is kept (I-800A Part 4), and running-text cross-references to later parts are not mistaken for headings", () => {
  // I-800A's real pattern: headings at 12 pt except Part 4 at 10 pt; pages 9 and 10 carry body-size "Part 7." / "Part 8." cross-references inside a sentence
  const raw = [
    { part: 1, page: 1, y: 480, x: 38, height: 12 }, { part: 2, page: 1, y: 390, x: 38, height: 12 },
    { part: 2, page: 2, y: 744, x: 38, height: 11 }, { part: 2, page: 3, y: 744, x: 36, height: 10 },
    { part: 3, page: 4, y: 420, x: 38, height: 12 }, { part: 3, page: 5, y: 744, x: 38, height: 12 },
    { part: 4, page: 7, y: 606, x: 38, height: 10 },
    { part: 4, page: 8, y: 744, x: 36, height: 10 },
    { part: 5, page: 9, y: 744, x: 38, height: 12 }, { part: 7, page: 9, y: 627, x: 180, height: 10 }, { part: 8, page: 9, y: 570, x: 212, height: 10 },
    { part: 6, page: 10, y: 744, x: 38, height: 12 }, { part: 7, page: 10, y: 633, x: 180, height: 10 }, { part: 8, page: 10, y: 576, x: 212, height: 10 },
    { part: 7, page: 11, y: 744, x: 38, height: 12 }, { part: 8, page: 12, y: 745, x: 38, height: 12 },
  ];
  const ordered = orderHeadings(raw);
  assert.deepEqual(ordered.map((heading) => heading.part), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.deepEqual(ordered.filter((heading) => heading.part >= 7).map((heading) => heading.page), [11, 12], "the real Part 7 and Part 8, not the cross-references");
  assert.equal(partOfBox(ordered, { page: 7, y: 400, x: 40 }), 4, "the spouse section ends where the body-size Part 4 begins");
  assert.equal(partOfBox(ordered, { page: 6, y: 400, x: 40 }), 3);
});

test("between runs of equal length the larger-printed headings win - size only ever breaks a tie", () => {
  const raw = [
    { part: 1, page: 1, y: 700, x: 40, height: 12 },
    { part: 2, page: 2, y: 500, x: 40, height: 10 }, // a body-size mention of Part 2
    { part: 2, page: 2, y: 300, x: 40, height: 12 }, // the real Part 2 heading
    { part: 3, page: 3, y: 700, x: 40, height: 12 },
  ];
  const ordered = orderHeadings(raw);
  assert.deepEqual(ordered.map((heading) => [heading.part, heading.y]), [[1, 700], [2, 300], [3, 700]]);
});
