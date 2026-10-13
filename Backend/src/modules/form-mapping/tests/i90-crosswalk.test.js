const assert = require("node:assert/strict");
const test = require("node:test");
const MappingResolver = require("../services/MappingResolver");
const { MAPPED_EDGES, classifyField } = require("../config/i90-crosswalk");

// Form I-90 crosswalk: canonical profile -> PDF fields. Pure (no DB): every edge is resolved exactly as AutoFillService does
// (MappingResolver.resolveMapping), against hand-built canonical profiles. The widget / label geometry was verified separately against the
// rendered official PDF; i90-mapping-graph.test.js checks the persisted graph against the real template.

const P1 = "form1[0].#subform[0].";
const P2 = "form1[0].#subform[1].";
const P3 = "form1[0].#subform[2].";

function fill(profile) {
  const out = {};
  for (const edge of MAPPED_EDGES) {
    const mapping = { source: "canonical", path: edge.source, sourceField: edge.source, transform: edge.transform, condition: edge.condition, fallback: edge.fallback };
    const { value } = MappingResolver.resolveMapping(mapping, profile);
    if (value !== undefined && value !== null && value !== "" && value !== false) out[edge.fieldName] = value;
  }
  return out;
}

const base = () => ({
  person: { lastName: "Testcase", firstName: "Ivy", gender: "female", dob: "1990-04-05", alienNumber: "A123456789", middleNameProvided: "no", ssnProvided: "no", uscisAccountProvided: "no", nameChangedSinceCardIssuance: "no", weightPounds: 95 },
  contact: { address: { line1: "12 Test St", unitType: "none", city: "Austin", country: "United States", state: "TX", zip: "73301" }, physicalAddressDifferent: "no", phone: "(512) 555-0100", email: "a@b.co" },
  immigration: { residentStatusType: "lawful_permanent_resident", greenCard: { applicationReason: "renewal" }, removalProceedings: "no", abandonmentDetermination: "no", greenCardPath: "adjustment_of_status" },
});
const reasonBoxes = (out) => Object.keys(out).filter((name) => /P2_checkbox[23]\[/.test(name)).map((name) => name.replace(/form1\[0\]\.#subform\[\d\]\./, ""));

test("every edge is unique, targets a distinct field and reads a canonical path (never a raw answer, never a form path)", () => {
  const names = MAPPED_EDGES.map((edge) => edge.fieldName);
  assert.equal(new Set(names).size, names.length);
  MAPPED_EDGES.forEach((edge) => {
    assert.match(edge.source, /^(person|contact|immigration)\./, edge.fieldName);
    assert.doesNotMatch(edge.source, /^raw\.|subform|P\d+_/, edge.fieldName);
  });
  assert.equal(classifyField({ fieldName: "form1[0].#pageSet[0].Page1[0].PDF417BarCode1[0]" }).status, "uscis_use_only");
  assert.equal(classifyField({ fieldName: `${P1}P1_Line6a_InCareofName[0]` }).status, "manual_entry");
});

test("renewal by a lawful permanent resident: reason 2.f only; identifiers are digits; unprovided optional answers print nothing", () => {
  const profile = base();
  profile.person.ssn = "123-45-6789"; // stale: the client later answered "no SSN"
  profile.person.middleName = "Quinn"; // stale: "no middle name"
  profile.person.uscisOnlineAccountNumber = "123456789012";
  const out = fill(profile);
  assert.deepEqual(reasonBoxes(out), ["P2_checkbox2[1]"]);
  assert.equal(out[`${P2}P2_checkbox1[0]`], true);
  assert.equal(out[`${P1}#area[1].P1_Line1_AlienNumber[0]`], "123456789");
  assert.equal(out[`${P2}P1_Line9_DateOfBirth[0]`], "04/05/1990");
  assert.equal(out[`${P2}P1_Line8_female[0]`], true);
  assert.equal(out[`${P2}P1_Line8_male[0]`], undefined);
  assert.equal(out[`${P2}P1_Line16_SSN[0]`], undefined, "no SSN printed while the gate says no");
  assert.equal(out[`${P1}P1_Line3c_MiddleName[0]`], undefined);
  assert.equal(out[`${P1}P1_Line2_AcctIdentifier[0]`], undefined);
  assert.equal(out[`${P1}P1_checkbox4[1]`], true, "name not changed -> Item 4 'No'");
  assert.equal(out[`${P3}P3_checkbox4[0]`], true);
  assert.equal(out[`${P3}P3_checkbox5[0]`], true);
});

test("weight prints as three zero-padded digits", () => {
  const w = (pounds) => { const p = base(); p.person.weightPounds = pounds; const o = fill(p); return [1, 2, 3].map((n) => o[`${P3}P3_Line9_HeightInches${n}[0]`]).join(""); };
  assert.equal(w(95), "095");
  assert.equal(w(150), "150");
  assert.equal(w(8), "008");
});

test("replacement: lost / stolen / destroyed -> 2.a, never received -> 2.b, mutilated -> 2.c; Section B uses 3.a-3.c", () => {
  const tick = (circumstance, status = "lawful_permanent_resident") => {
    const p = base();
    p.immigration.residentStatusType = status;
    p.immigration.greenCard = { applicationReason: "replacement", replacementCircumstance: circumstance };
    return reasonBoxes(fill(p));
  };
  assert.deepEqual(tick("lost"), ["P2_checkbox2[5]"]);
  assert.deepEqual(tick("stolen"), ["P2_checkbox2[5]"]);
  assert.deepEqual(tick("destroyed"), ["P2_checkbox2[5]"]);
  assert.deepEqual(tick("never_received"), ["P2_checkbox2[6]"]);
  assert.deepEqual(tick("mutilated"), ["P2_checkbox2[7]"]);
  assert.deepEqual(tick("lost", "commuter"), ["P2_checkbox2[5]"]);
  assert.deepEqual(tick("lost", "conditional"), ["P2_checkbox3[4]"]);
  assert.deepEqual(tick("never_received", "conditional"), ["P2_checkbox3[0]"]);
  assert.deepEqual(tick("mutilated", "conditional"), ["P2_checkbox3[1]"]);
});

test("correction ticks 'DHS error' only when the client says USCIS made the error; otherwise it is left for the case manager", () => {
  const tick = (cause, status = "lawful_permanent_resident") => {
    const p = base();
    p.immigration.residentStatusType = status;
    p.immigration.greenCard = { applicationReason: "correction", correctionCause: cause };
    return reasonBoxes(fill(p));
  };
  assert.deepEqual(tick("uscis_error"), ["P2_checkbox2[4]"]);
  assert.deepEqual(tick("uscis_error", "conditional"), ["P2_checkbox3[2]"]);
  assert.deepEqual(tick("applicant_error"), []);
  assert.deepEqual(tick("not_sure"), []);
});

test("biographic update -> 2.e / 3.e; renewal by a conditional resident ticks nothing (that is Form I-751)", () => {
  const p = base();
  p.immigration.greenCard = { applicationReason: "biographic_update" };
  assert.deepEqual(reasonBoxes(fill(p)), ["P2_checkbox2[0]"]);
  p.immigration.residentStatusType = "conditional";
  assert.deepEqual(reasonBoxes(fill(p)), ["P2_checkbox3[3]"]);
  const renewal = base();
  renewal.immigration.residentStatusType = "conditional";
  assert.deepEqual(reasonBoxes(fill(renewal)), []);
});

test("'other' reasons map to 2.g.1 / 2.g.2 / 2.h.1 / 2.h.2 / 2.i / 2.j; commuter status also prints the port of entry as 'City, ST'", () => {
  const expected = { turned_14_expires_after_16: 2, turned_14_expires_before_16: 3, commuter_status: 11, commuter_to_resident: 9, automatic_conversion: 10, prior_edition_or_other: 8 };
  for (const [reason, index] of Object.entries(expected)) {
    const p = base();
    p.immigration.greenCard = { applicationReason: "other", otherReason: reason };
    p.immigration.commuterPortOfEntry = { city: "Detroit", state: "MI" };
    const out = fill(p);
    assert.deepEqual(reasonBoxes(out), [`P2_checkbox2[${index}]`], reason);
    assert.equal(out[`${P2}P2_Line2h1_CityandState[0]`], reason === "commuter_status" ? "Detroit, MI" : undefined, reason);
  }
});

test("a physical address is printed only while 'different' is yes; a foreign address uses province / postal code, never state / ZIP", () => {
  const p = base();
  p.contact.physicalAddress = { line1: "99 Other Rd", city: "Dallas", country: "United States", state: "TX", zip: "75001", unitType: "suite", line2: "9" };
  assert.equal(fill(p)[`${P1}P1_Line7a_StreetNumberName[0]`], undefined, "stale physical address stays off the form");
  p.contact.physicalAddressDifferent = "yes";
  const shown = fill(p);
  assert.equal(shown[`${P1}P1_Line7a_StreetNumberName[0]`], "99 Other Rd");
  assert.equal(shown[`${P1}P1_checkbox7b_Unit[1]`], true, "Suite");
  assert.equal(shown[`${P1}P1_Line7b_AptSteFlrNumber[0]`], "9");
  const abroad = base();
  abroad.contact.address = { line1: "5 Road", unitType: "none", city: "Pune", country: "India", province: "MH", postalCode: "411001", state: "TX", zip: "73301" };
  const out = fill(abroad);
  assert.equal(out[`${P1}P1_Line6g_Province[0]`], "MH");
  assert.equal(out[`${P1}P1_Line6h_PostalCode[0]`], "411001");
  assert.equal(out[`${P1}P1_Line6e_State[0]`], undefined, "a stale US state never prints for a foreign address");
  assert.equal(out[`${P1}P1_Line6f_ZipCode[0]`], undefined);
});

test("name on the card prints only when the name changed; removal / I-407 explanations land in Part 8 with their page, part and item", () => {
  const p = base();
  p.person.nameOnCard = { lastName: "Oldname", firstName: "Ivy", middleNameProvided: "no" };
  assert.equal(fill(p)[`${P1}P1_Line5a_FamilyName[0]`], undefined);
  p.person.nameChangedSinceCardIssuance = "yes";
  const out = fill(p);
  assert.equal(out[`${P1}P1_checkbox4[0]`], true);
  assert.equal(out[`${P1}P1_Line5a_FamilyName[0]`], "Oldname");
  assert.equal(out[`${P1}P1_Line5c_MiddleName[0]`], undefined);
  p.immigration.removalProceedings = "yes";
  p.immigration.removalProceedingsExplanation = "Proceedings were terminated in 2015.";
  const part8 = fill(p);
  const P8 = "form1[0].#subform[6].";
  assert.equal(part8[`${P8}P8_Line3d_AdditionalInfo[0]`], "Proceedings were terminated in 2015.");
  assert.deepEqual([part8[`${P8}P8_Line3a_PageNumber[0]`], part8[`${P8}P8_Line3b_PartNumber[0]`], part8[`${P8}P8_Line3c_ItemNumber[0]`]], ["3", "3", "4"]);
  assert.equal(part8[`${P3}P3_checkbox4[1]`], true, "Item 4 'Yes'");
});

test("immigrant-visa entrants print destination and port of entry; adjustment-of-status cases do not", () => {
  const p = base();
  p.immigration.destinationAtAdmission = "Austin, Texas";
  p.immigration.portOfEntry = { city: "Los Angeles", state: "CA" };
  assert.equal(fill(p)[`${P3}P3_Line3a1_CityandState[0]`], undefined);
  p.immigration.greenCardPath = "immigrant_visa";
  const out = fill(p);
  assert.equal(out[`${P3}P3_Line3a1_CityandState[0]`], "Los Angeles, CA");
  assert.equal(out[`${P3}P3_Line3a_Destination[0]`], "Austin, Texas");
});

test("biographic boxes: ethnicity, several races, eye and hair colour, accommodation yes/no", () => {
  const p = base();
  Object.assign(p.person, { ethnicity: "hispanic_or_latino", race: ["asian", "white"], eyeColor: "unknown_other", hairColor: "bald", height: { feet: 5, inches: 0 } });
  p.person.accommodation = { requested: "yes", types: ["blind_or_low_vision"], blindDetails: "Large print" };
  const out = fill(p);
  assert.equal(out[`${P3}P3_checkbox6[1]`], true);
  assert.equal(out[`${P3}P3_checkbox7_Asian[0]`], true);
  assert.equal(out[`${P3}P3_checkbox7_White[0]`], true);
  assert.equal(out[`${P3}P3_checkbox7_Black[0]`], undefined);
  assert.equal(out[`${P3}P3_checkbox10[7]`], true);
  assert.equal(out[`${P3}P3_checkbox11[0]`], true);
  assert.equal(out[`${P3}P3_Line8_HeightFeet[0]`], "5");
  assert.equal(out[`${P3}P3_Line8_HeightInches[0]`], "0");
  assert.equal(out[`${P3}P4_checkbox1[1]`], true, "accommodation: Yes");
  assert.equal(out["form1[0].#subform[3].P4_checkbox1b[0]"], true);
  assert.equal(out["form1[0].#subform[3].P4_Line1b_AccomodationRequested[0]"], "Large print");
  assert.equal(out["form1[0].#subform[3].P4_checkbox1c[0]"], undefined);
});

test("missing answers print nothing: an empty profile fills no field (no fabricated values)", () => {
  assert.deepEqual(fill({}), {});
});

test("resolver transforms added for this form: digitAt (zero-padded, refuses an overflow) and concat with a separator", () => {
  const t = (transform, value) => MappingResolver.applyTransform(value, { transform }, {});
  assert.equal(t({ type: "digitAt", index: 0, pad: 3 }, 7), "0");
  assert.equal(t({ type: "digitAt", index: 2, pad: 3 }, 7), "7");
  assert.equal(t({ type: "digitAt", index: 0, pad: 3 }, 1500), undefined);
  assert.equal(t({ type: "string" }, 5), "5");
  assert.equal(MappingResolver.resolveDerivedValue({ transform: { type: "concat", fields: ["a.c", "a.s"], separator: ", " } }, { a: { c: "Boston", s: "MA" } }), "Boston, MA");
  assert.equal(MappingResolver.resolveDerivedValue({ transform: { type: "concat", fields: ["a.c", "a.s"] } }, { a: { c: "Boston", s: "MA" } }), "Boston MA", "default separator unchanged");
});
