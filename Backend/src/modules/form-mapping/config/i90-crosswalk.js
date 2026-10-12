// Form I-90 (Application to Replace Permanent Resident Card) crosswalk: CANONICAL PROFILE -> I-90 PDF fields.
//
// Chain: green_card_renewal_checklist question -> question.mapping.canonicalPath (person.* / contact.* / immigration.*) -> Case.canonicalProfile
// (with provenance) -> THIS FILE -> the PDF widget. Every edge's `source` is a canonical path (registered in
// canonical/config/i90CanonicalPaths.js or already known to CanonicalFieldRegistryService); nothing here reads a raw questionnaire answer, so
// the same edges keep working for any other source of those canonical values (OCR of the card, a staff correction, ...). USCIS field
// identifiers exist ONLY in this file.
//
// TARGET FIELDS: the 195 fields of the active I-90 template (edition 01/20/25, dev-assets/uscis/i-90_2025-20-01.pdf, imported by
// uscis-form-import/seeds/bulkImportPhase1Forms.js). Every fieldName below was read from that template's formFields; none was guessed.
// Part / Item numbers were read from the PDF text. Several template LABELS are wrong or generic (the Part 2 reason boxes, the Yes/No
// pairs), so which widget is which was taken from each widget's tooltip and on-page position:
//   Part 2 Item 1   P2_checkbox1[0..2]  = 1.a Lawful Permanent Resident, 1.b Commuter, 1.c Conditional (top to bottom)
//   Section A       P2_checkbox2[5]=2.a lost/stolen/destroyed  [6]=2.b never received  [7]=2.c mutilated  [4]=2.d DHS error
//                   [0]=2.e name/biographic change  [1]=2.f expired  [2]=2.g.1 (14th birthday, expires AFTER 16th)  [3]=2.g.2 (BEFORE 16th)
//                   [11]=2.h.1 commuter status  [9]=2.h.2 commuter taking up residence  [10]=2.i automatic conversion  [8]=2.j other/prior edition
//   Section B       P2_checkbox3[4]=3.a lost/stolen/destroyed  [0]=3.b never received  [1]=3.c mutilated  [2]=3.d DHS error  [3]=3.e name change
//   Yes / No pairs  [0] is "No" and [1] is "Yes" for P3_checkbox4 / P3_checkbox5 / P4_checkbox1 (left-to-right "Yes No" on the page,
//                   tooltips "Select No." / "Select Yes."); P1_checkbox4 is [0] Yes, [1] No, [2] Not applicable (top to bottom).
//
// CONDITIONS: a box or value is written only while the answer that makes it applicable still holds. The checklist keeps a client's earlier
// answers when they change a gate (the reason, "is your physical address different?", ...), so every conditional edge re-checks its gate
// against the canonical profile instead of trusting the follower value. Canonical values are post-normalisation
// (CanonicalTransformationService.normalizeByPath): person.gender is "male" / "female", dates are ISO, state codes upper-case.
//
// DELIBERATELY NOT MAPPED (left to the case manager, never guessed) - see MANUAL_ENTRY_FIELDS:
//   - Part 1 Item 6.a "In Care Of" (not asked); the unit-type box when the client chose "None";
//   - Part 5: the statement boxes (read English / interpreter / preparer), signature and date, mobile phone: legal declarations, not data;
//   - Part 6 interpreter and Part 7 preparer blocks: not client data;
//   - Part 8 blocks other than the two explanation boxes below, and the pre-printed page header barcodes (USCIS use only);
//   - Section A/B reason boxes for a combination the form does not allow (renewal by a conditional resident, "other" reasons by a conditional
//     resident): left blank and flagged for review in the checklist.

const FORM_CODE = "I-90";
const CANON = {
  status: "immigration.residentStatusType",
  reason: "immigration.greenCard.applicationReason",
  circumstance: "immigration.greenCard.replacementCircumstance",
  correctionCause: "immigration.greenCard.correctionCause",
  otherReason: "immigration.greenCard.otherReason",
};

const P1 = "form1[0].#subform[0].";
const P2 = "form1[0].#subform[1].";
const P3 = "form1[0].#subform[2].";
const P4 = "form1[0].#subform[3].";
const P7 = "form1[0].#subform[6].";

// ── edge builders ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const leaf = (field, operator, value) => ({ field, operator, value });
const eq = (field, value) => leaf(field, "equals", value);
const inList = (field, values) => leaf(field, "in", values);
const allOf = (...conditions) => ({ all: conditions });
const needs = (extra) => (extra ? { condition: extra } : {});

const edge = (fieldName, source, note, extra = {}) => ({ fieldName, source, sourceVerified: true, note, ...extra });
// a box ticked only while `condition` holds
const box = (fieldName, source, condition, note) => edge(fieldName, source, note, { transform: { type: "boolean" }, condition });
const date = { transform: { type: "date", format: "mm/dd/yyyy" } };
const digits = { transform: { type: "digits" } };
const text = { transform: { type: "string" } };

const statusIn = (...values) => inList(CANON.status, values);
const reasonIs = (value) => eq(CANON.reason, value);

// Mailing (6) and physical (7) address blocks share one shape: street, unit type boxes + number, city, state / ZIP (US) or province / postal
// code (foreign), country.
function addressEdges({ prefix, item, base, unitBox, widgetNames, gate }) {
  const g = (...extra) => (gate || extra.length ? { condition: allOf(...(gate ? [gate] : []), ...extra) } : {});
  const usOnly = [eq(`${base}.country`, "United States")];
  const foreignOnly = [leaf(`${base}.country`, "not_equals", "United States")];
  const unit = (type) => allOf(...(gate ? [gate] : []), eq(`${base}.unitType`, type));
  return [
    edge(`${prefix}${widgetNames.street}`, `${base}.line1`, `Item ${item}.b, street number and name.`, g()),
    edge(`${prefix}${widgetNames.unitNumber}`, `${base}.line2`, `Item ${item}.c, apartment / suite / floor number (only when a unit type was chosen).`,
      { condition: allOf(...(gate ? [gate] : []), inList(`${base}.unitType`, ["apartment", "suite", "floor"])) }),
    box(`${prefix}${unitBox}[0]`, `${base}.unitType`, unit("apartment"), `Item ${item}.c, Apt. box.`),
    box(`${prefix}${unitBox}[1]`, `${base}.unitType`, unit("suite"), `Item ${item}.c, Ste. box.`),
    box(`${prefix}${unitBox}[2]`, `${base}.unitType`, unit("floor"), `Item ${item}.c, Flr. box.`),
    edge(`${prefix}${widgetNames.city}`, `${base}.city`, `Item ${item}.d, city or town.`, g()),
    edge(`${prefix}${widgetNames.state}`, `${base}.state`, `Item ${item}.e, state (the dropdown's own 2-letter values; a non-US country never lands here).`,
      { transform: { type: "usState", countryPath: `${base}.country` }, ...g(...usOnly) }),
    edge(`${prefix}${widgetNames.zip}`, `${base}.zip`, `Item ${item}.f, ZIP code.`, g(...usOnly)),
    edge(`${prefix}${widgetNames.province}`, `${base}.province`, `Item ${item}.g, province (non-US address only).`, g(...foreignOnly)),
    edge(`${prefix}${widgetNames.postal}`, `${base}.postalCode`, `Item ${item}.h, postal code (non-US address only).`, g(...foreignOnly)),
    edge(`${prefix}${widgetNames.country}`, `${base}.country`, `Item ${item}.i, country.`, g()),
  ];
}

const MAILING = addressEdges({
  prefix: P1, item: 6, base: "contact.address", unitBox: "P1_checkbox6c_Unit",
  widgetNames: { street: "P1_Line6b_StreetNumberName[0]", unitNumber: "P1_Line6c_AptSteFlrNumber[0]", city: "P1_Line6d_CityOrTown[0]", state: "P1_Line6e_State[0]", zip: "P1_Line6f_ZipCode[0]", province: "P1_Line6g_Province[0]", postal: "P1_Line6h_PostalCode[0]", country: "P1_Line6i_Country[0]" },
});
const PHYSICAL_GATE = eq("contact.physicalAddressDifferent", "yes");
const PHYSICAL = addressEdges({
  prefix: P1, item: 7, base: "contact.physicalAddress", unitBox: "P1_checkbox7b_Unit", gate: PHYSICAL_GATE,
  widgetNames: { street: "P1_Line7a_StreetNumberName[0]", unitNumber: "P1_Line7b_AptSteFlrNumber[0]", city: "P1_Line7c_CityOrTown[0]", state: "P1_Line7d_State[0]", zip: "P1_Line7e_ZipCode[0]", province: "P1_Line7f_Province[0]", postal: "P1_Line7g_PostalCode[0]", country: "P1_Line7h_Country[0]" },
});

// Section A (lawful permanent resident / commuter) and Section B (conditional resident) reason boxes. A box is ticked from the client's own
// reason answers and their status; "name / biographic change" is the reason itself, "expired" is the renewal reason.
const SECTION_A = statusIn("lawful_permanent_resident", "commuter");
const SECTION_B = statusIn("conditional");
const lossLike = inList(CANON.circumstance, ["lost", "stolen", "destroyed"]);
const reasonBoxes = [
  // Section A
  box(`${P2}P2_checkbox2[5]`, CANON.circumstance, allOf(SECTION_A, reasonIs("replacement"), lossLike), "Item 2.a: card lost, stolen or destroyed."),
  box(`${P2}P2_checkbox2[6]`, CANON.circumstance, allOf(SECTION_A, reasonIs("replacement"), eq(CANON.circumstance, "never_received")), "Item 2.b: card issued but never received."),
  box(`${P2}P2_checkbox2[7]`, CANON.circumstance, allOf(SECTION_A, reasonIs("replacement"), eq(CANON.circumstance, "mutilated")), "Item 2.c: card mutilated."),
  box(`${P2}P2_checkbox2[4]`, CANON.correctionCause, allOf(SECTION_A, reasonIs("correction"), eq(CANON.correctionCause, "uscis_error")), "Item 2.d: incorrect data because of a DHS error - ticked only when the client says USCIS made the error (flagged for case-manager review)."),
  box(`${P2}P2_checkbox2[0]`, CANON.reason, allOf(SECTION_A, reasonIs("biographic_update")), "Item 2.e: name or other biographic information legally changed."),
  box(`${P2}P2_checkbox2[1]`, CANON.reason, allOf(SECTION_A, reasonIs("renewal")), "Item 2.f: card expired or will expire within six months."),
  box(`${P2}P2_checkbox2[2]`, CANON.otherReason, allOf(SECTION_A, reasonIs("other"), eq(CANON.otherReason, "turned_14_expires_after_16")), "Item 2.g.1: turned 14, card expires AFTER the 16th birthday."),
  box(`${P2}P2_checkbox2[3]`, CANON.otherReason, allOf(SECTION_A, reasonIs("other"), eq(CANON.otherReason, "turned_14_expires_before_16")), "Item 2.g.2: turned 14, card expires BEFORE the 16th birthday."),
  box(`${P2}P2_checkbox2[11]`, CANON.otherReason, allOf(SECTION_A, reasonIs("other"), eq(CANON.otherReason, "commuter_status")), "Item 2.h.1: permanent resident taking up commuter status."),
  box(`${P2}P2_checkbox2[9]`, CANON.otherReason, allOf(SECTION_A, reasonIs("other"), eq(CANON.otherReason, "commuter_to_resident")), "Item 2.h.2: commuter taking up actual residence."),
  box(`${P2}P2_checkbox2[10]`, CANON.otherReason, allOf(SECTION_A, reasonIs("other"), eq(CANON.otherReason, "automatic_conversion")), "Item 2.i: automatically converted to lawful permanent resident status."),
  box(`${P2}P2_checkbox2[8]`, CANON.otherReason, allOf(SECTION_A, reasonIs("other"), eq(CANON.otherReason, "prior_edition_or_other")), "Item 2.j: prior edition of the card, or a reason not listed."),
  // Section B (conditional permanent residents; there is no renewal here - that is Form I-751)
  box(`${P3}P2_checkbox3[4]`, CANON.circumstance, allOf(SECTION_B, reasonIs("replacement"), lossLike), "Section B Item 3.a: card lost, stolen or destroyed."),
  box(`${P3}P2_checkbox3[0]`, CANON.circumstance, allOf(SECTION_B, reasonIs("replacement"), eq(CANON.circumstance, "never_received")), "Section B Item 3.b: card issued but never received."),
  box(`${P3}P2_checkbox3[1]`, CANON.circumstance, allOf(SECTION_B, reasonIs("replacement"), eq(CANON.circumstance, "mutilated")), "Section B Item 3.c: card mutilated."),
  box(`${P3}P2_checkbox3[2]`, CANON.correctionCause, allOf(SECTION_B, reasonIs("correction"), eq(CANON.correctionCause, "uscis_error")), "Section B Item 3.d: incorrect data because of a DHS error (flagged for case-manager review)."),
  box(`${P3}P2_checkbox3[3]`, CANON.reason, allOf(SECTION_B, reasonIs("biographic_update")), "Section B Item 3.e: name or other biographic information legally changed."),
];

// A single "Yes"/"No" answer -> the two boxes of a pair. `yesIndex` is the widget index that prints "Yes".
const yesNo = (prefix, name, yesIndex, source, label) => [
  box(`${prefix}${name}[${yesIndex}]`, source, eq(source, "yes"), `${label}: Yes box.`),
  box(`${prefix}${name}[${yesIndex === 0 ? 1 : 0}]`, source, eq(source, "no"), `${label}: No box.`),
];

const choiceBoxes = (prefix, name, source, choices, label) => choices.map(([index, value, what]) => (
  box(`${prefix}${name}[${index}]`, source, eq(source, value), `${label}: ${what} box.`)
));

const MAPPED_EDGES = [
  // ── Part 1: Information About You ───────────────────────────────────────────────────────────────────────────────────────────────
  edge(`${P1}#area[1].P1_Line1_AlienNumber[0]`, "person.alienNumber", "Item 1, A-Number. The widget pre-prints 'A-', so digits only.", digits),
  edge(`${P1}P1_Line2_AcctIdentifier[0]`, "person.uscisOnlineAccountNumber", "Item 2, USCIS Online Account Number (printed only while the client says they have one).",
    { ...digits, condition: eq("person.uscisAccountProvided", "yes") }),
  edge(`${P1}P1_Line3a_FamilyName[0]`, "person.lastName", "Item 3.a, family name (the name the card will be issued in)."),
  edge(`${P1}P1_Line3b_GivenName[0]`, "person.firstName", "Item 3.b, given name."),
  edge(`${P1}P1_Line3c_MiddleName[0]`, "person.middleName", "Item 3.c, middle name (only when the client has one).", needs(eq("person.middleNameProvided", "yes"))),
  ...choiceBoxes(P1, "P1_checkbox4", "person.nameChangedSinceCardIssuance", [[0, "yes", "Yes"], [1, "no", "No"], [2, "never_received", "N/A (never received a card)"]], "Item 4, name legally changed since the card was issued"),
  edge(`${P1}P1_Line5a_FamilyName[0]`, "person.nameOnCard.lastName", "Item 5.a, family name exactly as printed on the current card.", needs(eq("person.nameChangedSinceCardIssuance", "yes"))),
  edge(`${P1}P1_Line5b_GivenName[0]`, "person.nameOnCard.firstName", "Item 5.b, given name as printed on the current card.", needs(eq("person.nameChangedSinceCardIssuance", "yes"))),
  edge(`${P1}P1_Line5c_MiddleName[0]`, "person.nameOnCard.middleName", "Item 5.c, middle name as printed on the current card.",
    needs(allOf(eq("person.nameChangedSinceCardIssuance", "yes"), eq("person.nameOnCard.middleNameProvided", "yes")))),
  ...MAILING,
  ...PHYSICAL,

  // ── Part 1 continued (page 2) ──────────────────────────────────────────────────────────────────────────────────────────────────
  box(`${P2}P1_Line8_male[0]`, "person.gender", eq("person.gender", "male"), "Item 8: Male box."),
  box(`${P2}P1_Line8_female[0]`, "person.gender", eq("person.gender", "female"), "Item 8: Female box."),
  edge(`${P2}P1_Line9_DateOfBirth[0]`, "person.dob", "Item 9, date of birth.", date),
  edge(`${P2}P1_Line10_CityTownOfBirth[0]`, "person.cityTownOfBirth", "Item 10, city / town / village of birth."),
  edge(`${P2}P1_Line11_CountryofBirth[0]`, "person.countryOfBirth", "Item 11, country of birth."),
  edge(`${P2}P1_Line12_MotherGivenName[0]`, "person.mother.firstName", "Item 12, mother's given name."),
  edge(`${P2}P1_Line13_FatherGivenName[0]`, "person.father.firstName", "Item 13, father's given name."),
  edge(`${P2}P1_Line14_ClassOfAdmission[0]`, "immigration.classOfAdmission", "Item 14, class of admission.", { transform: { type: "uppercase" } }),
  edge(`${P2}P1_Line15_DateOfAdmission[0]`, "immigration.dateOfAdmission", "Item 15, date of admission (the template types this widget as a date).", date),
  edge(`${P2}P1_Line16_SSN[0]`, "person.ssn", "Item 16, Social Security Number, digits only (printed only while the client says they have one).",
    { ...digits, condition: eq("person.ssnProvided", "yes") }),

  // ── Part 2: Application Type ────────────────────────────────────────────────────────────────────────────────────────────────────
  ...choiceBoxes(P2, "P2_checkbox1", CANON.status, [[0, "lawful_permanent_resident", "1.a Lawful Permanent Resident"], [1, "commuter", "1.b Permanent Resident - In Commuter Status"], [2, "conditional", "1.c Conditional Permanent Resident"]], "Item 1, my status is"),
  ...reasonBoxes,
  edge(`${P2}P2_Line2h1_CityandState[0]`, "immigration.commuterPortOfEntry.city", "Item 2.h.1.a, port of entry as 'City, ST' (25-character widget).",
    { transform: { type: "concat", fields: ["immigration.commuterPortOfEntry.city", "immigration.commuterPortOfEntry.state"], separator: ", " }, condition: allOf(reasonIs("other"), eq(CANON.otherReason, "commuter_status")) }),

  // ── Part 3: Processing Information ──────────────────────────────────────────────────────────────────────────────────────────────
  edge(`${P3}P3_Line1_LocationAppliedVisa[0]`, "immigration.greenCardApplicationLocation", "Item 1, location where the immigrant visa / adjustment was applied for."),
  edge(`${P3}P3_Line2_LocationIssuedVisa[0]`, "immigration.cardIssuanceLocation", "Item 2, location where the visa was issued / USCIS office that granted adjustment (the template mistypes this text widget as a date)."),
  edge(`${P3}P3_Line3a_Destination[0]`, "immigration.destinationAtAdmission", "Item 3.a, destination in the United States at admission (immigrant-visa entrants only).", needs(eq("immigration.greenCardPath", "immigrant_visa"))),
  edge(`${P3}P3_Line3a1_CityandState[0]`, "immigration.portOfEntry.city", "Item 3.a.1, port of entry as 'City, ST' (25-character widget; immigrant-visa entrants only).",
    { transform: { type: "concat", fields: ["immigration.portOfEntry.city", "immigration.portOfEntry.state"], separator: ", " }, condition: eq("immigration.greenCardPath", "immigrant_visa") }),
  ...yesNo(P3, "P3_checkbox4", 1, "immigration.removalProceedings", "Item 4, ever in exclusion / deportation / removal proceedings"),
  ...yesNo(P3, "P3_checkbox5", 1, "immigration.abandonmentDetermination", "Item 5, ever filed Form I-407 or determined to have abandoned status"),
  ...choiceBoxes(P3, "P3_checkbox6", "person.ethnicity", [[1, "hispanic_or_latino", "Hispanic or Latino"], [0, "not_hispanic_or_latino", "Not Hispanic or Latino"]], "Item 6, ethnicity"),
  box(`${P3}P3_checkbox7_White[0]`, "person.race", leaf("person.race", "contains", "white"), "Item 7: White box."),
  box(`${P3}P3_checkbox7_Asian[0]`, "person.race", leaf("person.race", "contains", "asian"), "Item 7: Asian box."),
  box(`${P3}P3_checkbox7_Black[0]`, "person.race", leaf("person.race", "contains", "black_or_african_american"), "Item 7: Black or African American box."),
  box(`${P3}P3_checkbox7_Indian[0]`, "person.race", leaf("person.race", "contains", "american_indian_or_alaska_native"), "Item 7: American Indian or Alaska Native box."),
  box(`${P3}P3_checkbox7_Hawaiian[0]`, "person.race", leaf("person.race", "contains", "native_hawaiian_or_other_pacific_islander"), "Item 7: Native Hawaiian or Other Pacific Islander box."),
  edge(`${P3}P3_Line8_HeightFeet[0]`, "person.height.feet", "Item 8, height - feet (dropdown option is the number as text).", text),
  edge(`${P3}P3_Line8_HeightInches[0]`, "person.height.inches", "Item 8, height - inches (dropdown option is the number as text).", text),
  // Item 9, weight: three one-digit boxes, zero-padded on the left (the widgets are named ...HeightInches1-3 but are tooltipped "Weight in Pounds").
  edge(`${P3}P3_Line9_HeightInches1[0]`, "person.weightPounds", "Item 9, weight, first digit of three (zero-padded).", { transform: { type: "digitAt", index: 0, pad: 3 } }),
  edge(`${P3}P3_Line9_HeightInches2[0]`, "person.weightPounds", "Item 9, weight, second digit of three.", { transform: { type: "digitAt", index: 1, pad: 3 } }),
  edge(`${P3}P3_Line9_HeightInches3[0]`, "person.weightPounds", "Item 9, weight, third digit of three.", { transform: { type: "digitAt", index: 2, pad: 3 } }),
  ...choiceBoxes(P3, "P3_checkbox10", "person.eyeColor", [[6, "black", "Black"], [0, "blue", "Blue"], [5, "brown", "Brown"], [8, "gray", "Gray"], [1, "green", "Green"], [2, "hazel", "Hazel"], [4, "maroon", "Maroon"], [3, "pink", "Pink"], [7, "unknown_other", "Unknown / Other"]], "Item 10, eye color"),
  ...choiceBoxes(P3, "P3_checkbox11", "person.hairColor", [[0, "bald", "Bald (No hair)"], [8, "black", "Black"], [1, "blond", "Blond"], [7, "brown", "Brown"], [2, "gray", "Gray"], [6, "red", "Red"], [3, "sandy", "Sandy"], [5, "white", "White"], [4, "unknown_other", "Unknown / Other"]], "Item 11, hair color"),

  // ── Part 4: Accommodations for Individuals with Disabilities and/or Impairments ────────────────────────────────────────────────
  ...yesNo(P3, "P4_checkbox1", 1, "person.accommodation.requested", "Part 4 Item 1, requesting an accommodation"),
  box(`${P3}P4_checkbox1a[0]`, "person.accommodation.types", allOf(eq("person.accommodation.requested", "yes"), leaf("person.accommodation.types", "contains", "deaf_or_hard_of_hearing")), "Part 4 Item 1.a: deaf or hard of hearing box."),
  edge(`${P3}P4_Line1a_AccomodationRequested[0]`, "person.accommodation.deafDetails", "Part 4 Item 1.a, accommodation requested.",
    needs(allOf(eq("person.accommodation.requested", "yes"), leaf("person.accommodation.types", "contains", "deaf_or_hard_of_hearing")))),
  box(`${P4}P4_checkbox1b[0]`, "person.accommodation.types", allOf(eq("person.accommodation.requested", "yes"), leaf("person.accommodation.types", "contains", "blind_or_low_vision")), "Part 4 Item 1.b: blind or low vision box."),
  edge(`${P4}P4_Line1b_AccomodationRequested[0]`, "person.accommodation.blindDetails", "Part 4 Item 1.b, accommodation requested.",
    needs(allOf(eq("person.accommodation.requested", "yes"), leaf("person.accommodation.types", "contains", "blind_or_low_vision")))),
  box(`${P4}P4_checkbox1c[0]`, "person.accommodation.types", allOf(eq("person.accommodation.requested", "yes"), leaf("person.accommodation.types", "contains", "other")), "Part 4 Item 1.c: another disability or impairment box."),
  edge(`${P4}P4_Line1c_AccomodationRequested[0]`, "person.accommodation.otherDetails", "Part 4 Item 1.c, description and accommodation requested.",
    needs(allOf(eq("person.accommodation.requested", "yes"), leaf("person.accommodation.types", "contains", "other")))),

  // ── Part 5: applicant contact information ───────────────────────────────────────────────────────────────────────────────────────
  edge(`${P4}P5_Line3_DaytimePhoneNumber[0]`, "contact.phone", "Part 5 Item 3, applicant's daytime telephone number.", { transform: { type: "phone" } }),
  edge(`${P4}P5_Line5_EmailAddress[0]`, "contact.email", "Part 5 Item 5, applicant's email address."),

  // ── Part 8: Additional Information - the two explanations the form itself asks for ("provide a detailed explanation in Part 8") ─
  edge(`${P7}P8_Line3a_PageNumber[0]`, "immigration.removalProceedings", "Part 8 block 3 page number: the removal-proceedings answer is on page 3.", { transform: { type: "constant", value: "3" }, condition: eq("immigration.removalProceedings", "yes") }),
  edge(`${P7}P8_Line3b_PartNumber[0]`, "immigration.removalProceedings", "Part 8 block 3 part number: Part 3.", { transform: { type: "constant", value: "3" }, condition: eq("immigration.removalProceedings", "yes") }),
  edge(`${P7}P8_Line3c_ItemNumber[0]`, "immigration.removalProceedings", "Part 8 block 3 item number: Item 4.", { transform: { type: "constant", value: "4" }, condition: eq("immigration.removalProceedings", "yes") }),
  edge(`${P7}P8_Line3d_AdditionalInfo[0]`, "immigration.removalProceedingsExplanation", "Part 8 block 3, the explanation of Part 3 Item 4.", needs(eq("immigration.removalProceedings", "yes"))),
  edge(`${P7}P8_Line5a_PageNumber[1]`, "immigration.abandonmentDetermination", "Part 8 block 4 page number: the I-407 answer is on page 3.", { transform: { type: "constant", value: "3" }, condition: eq("immigration.abandonmentDetermination", "yes") }),
  edge(`${P7}P8_Line5b_PartNumber[1]`, "immigration.abandonmentDetermination", "Part 8 block 4 part number: Part 3.", { transform: { type: "constant", value: "3" }, condition: eq("immigration.abandonmentDetermination", "yes") }),
  edge(`${P7}P8_Line5c_ItemNumber[1]`, "immigration.abandonmentDetermination", "Part 8 block 4 item number: Item 5.", { transform: { type: "constant", value: "5" }, condition: eq("immigration.abandonmentDetermination", "yes") }),
  edge(`${P7}P8_Line5d_AdditionalInfo[1]`, "immigration.abandonmentExplanation", "Part 8 block 4, the explanation of Part 3 Item 5.", needs(eq("immigration.abandonmentDetermination", "yes"))),

  // ── Part 8 continuation sheet header (page 7): the applicant's name and A-Number repeated ───────────────────────────────────────
  edge(`${P7}P1_Line3a_FamilyName[1]`, "person.lastName", "Continuation sheet header, family name (repeat)."),
  edge(`${P7}P1_Line3b_GivenName[1]`, "person.firstName", "Continuation sheet header, given name (repeat)."),
  edge(`${P7}P1_Line3c_MiddleName[1]`, "person.middleName", "Continuation sheet header, middle name (repeat).", needs(eq("person.middleNameProvided", "yes"))),
  edge(`${P7}#area[3].P1_Line1_AlienNumber[1]`, "person.alienNumber", "Continuation sheet header, A-Number (repeat).", digits),
];

const MANUAL_ENTRY_FIELDS = {
  no_checklist_source: [`${P1}P1_Line6a_InCareofName[0]`, `${P4}P5_Line4_MobilePhoneNumber[0]`],
  legal_declaration: [
    `${P4}P5_Checkbox1a[0]`, `${P4}P5_Checkbox1b[0]`, `${P4}P5_Line1b_Language[0]`, `${P4}P5_Checkbox2[0]`, `${P4}P5_Line2_NameofRepresentative[0]`,
    `${P4}P5_Line6a_SignatureofApplicant[0]`, `${P4}P5_Line6b_DateofSignature[0]`,
  ],
  interpreter_and_preparer: ["Part 6 (interpreter) and Part 7 (preparer) fields - not client data; completed at review"],
};

// Matches by the RAW AcroForm field name (see i129-h1b-crosswalk.js for why).
const USCIS_USE_ONLY_PATTERNS = [/PDF417BarCode/];
const MANUAL_ENTRY_SET = new Set(Object.values(MANUAL_ENTRY_FIELDS).flat());
const MAPPED_BY_FIELD_NAME = new Map(MAPPED_EDGES.map((item) => [item.fieldName, item]));

function classifyField(field) {
  const fieldName = field.fieldName || field.pdfFieldName || field.fieldId;
  if (USCIS_USE_ONLY_PATTERNS.some((pattern) => pattern.test(fieldName))) return { status: "uscis_use_only", note: "USCIS-internal barcode field." };
  const mapped = MAPPED_BY_FIELD_NAME.get(fieldName);
  if (mapped) return { status: "mapped", edge: mapped };
  if (MANUAL_ENTRY_SET.has(fieldName)) return { status: "manual_entry", note: "See MANUAL_ENTRY_FIELDS for the reason." };
  return { status: "manual_entry", note: "Not applicant checklist data (interpreter / preparer / signature / unused Part 8 block) - completed at review." };
}

module.exports = { FORM_CODE, MAPPED_EDGES, MANUAL_ENTRY_FIELDS, USCIS_USE_ONLY_PATTERNS, classifyField };
