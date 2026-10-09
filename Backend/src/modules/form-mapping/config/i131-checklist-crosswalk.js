// Form I-131 <- the I-131 CHECKLIST (questionnaires/i131Checklist.js, key i131_checklist), as a second source of the same mapping graph.
//
// WHY: the graph in i131-perm-crosswalk.js was authored for the PERM workflow and reads canonical paths only (person.*, contact.address.*). The
// stand-alone I-131 checklist (Re-entry Permit / Refugee Travel Document / Advance Parole) asks many more things than the PERM checklist, and
// none of them reached the form. This file maps them, each to the box the form actually prints it in.
//
// HOW THE TWO FLOWS SHARE ONE GRAPH: where a canonical path already feeds a box (name, A-Number, date of birth, countries, mailing and physical
// address), nothing changes: the I-131 checklist now writes the SAME canonical paths (person.*, contact.address.*), so both checklists fill
// those boxes. Only boxes with no canonical source are added here, read from the saved answer (raw.questionnaireAnswers.<key>.value).
//
// VERIFIED: every fieldName below is a real field of the active I-131 template (edition 01/20/25); Part / Item numbers were read from the PDF text
// (dev-assets/uscis/i-131_2025-20-01.pdf). Yes/No widgets carry only "Yes"/"No" labels, so which widget is Yes is taken from the template's own
// label per widget (for example P6_Line2_YesNo[0] is "No", [1] is "Yes"; P6_Line3a_YesNo[0] is "Yes", [1] is "No"). Confidence is MEDIUM (70)
// because the saved-answer sources have not been run on a real case yet.
//
// NEVER MAPPED (left for the case manager, with the reason): Part 1 Items 2-3 (which refugee box), Item 5 and 6-11 (advance parole type), the
// Part 5 time-outside-US boxes (the checklist answer is free text), Part 8 and 9, Item 8.a/8.b pick-up boxes, interpreter, preparer, signatures.

const MEDIUM = "MEDIUM";
const NUMERIC_CONFIDENCE = { HIGH: 95, MEDIUM: 70 };
const RAW = (key) => `raw.questionnaireAnswers.${key}.value`;

const P1 = "form1[0].P1[0].";
const P4 = "form1[0].P4[0].";
const P5 = "form1[0].P5[0].";
const P6 = "form1[0].P6[0].";
const P7 = "form1[0].P7[0].";
const S7 = "form1[0].#subform[7].";
const S8 = "form1[0].#subform[8].";
const S9 = "form1[0].#subform[9].";

function edge(fieldName, page, section, item, checklistField, dataType, note, extra = {}) {
  return {
    fieldName, formPage: page, formSection: section, item,
    canonicalPath: RAW(checklistField), checklistField, sourceChecklist: "i131_checklist",
    confidenceLevel: MEDIUM, confidence: NUMERIC_CONFIDENCE.MEDIUM, dataType, required: false, note, ...extra,
  };
}
// A box is ticked ONLY when the client's own answer equals `value` (condition), otherwise it is left untouched. (A "checkbox" transform cannot be
// used here: it resolves its source from edge.source, which the graph sets to "canonical", so it would never see the answer.)
const when = (checklistField, value) => ({ transform: { type: "boolean" }, condition: { field: RAW(checklistField), operator: "equals", value } });
const dateT = { type: "date", format: "mm/dd/yyyy" };
const countryT = { type: "country" };
// The form scopes some parts to a document type: Part 7 is "only if applying for an Advance Parole Document" and the delivery items (Part 4 Items 7-9)
// "if you are requesting a Reentry Permit or Refugee Travel Document" (advance parole SKIPS them). Those boxes are filled only for that purpose.
const AP = ["ADVANCE_PAROLE_INSIDE_US", "ADVANCE_PAROLE_OUTSIDE_US_FOR_SELF", "ADVANCE_PAROLE_FOR_PERSON_OUTSIDE_US"];
const RTD_OR_REENTRY = ["REENTRY_PERMIT", "REFUGEE_TRAVEL_DOCUMENT"];
const purposeIn = (values) => ({ field: RAW("i131_purpose"), operator: "in", value: values });
// extra for an edge: keep its own condition (if any) AND the purpose scope
const scoped = (values, extra = {}) => ({ ...extra, condition: extra.condition ? { all: [purposeIn(values), extra.condition] } : purposeIn(values) });
// one free-text address answer -> the part the box wants (AddressParser never guesses; a part the text does not show stays blank)
const addr = (part) => ({ type: "address", part });

const P2 = "Part 2. Information About You";
const P2_THEM = "Part 2. Information About Them";
const P4S = "Part 4. Processing Information";
const P6S = "Part 6. Refugee Travel Document";
const P7S = "Part 7. Proposed Travel";

// A Yes/No pair: [yesIndex] gets the Yes box, the other the No box, both only from the client's own yes/no answer.
function yesNoPair(prefix, name, yesIndex, page, section, item, checklistField, label) {
  const noIndex = yesIndex === 0 ? 1 : 0;
  return [
    edge(`${prefix}${name}[${yesIndex}]`, page, section, item, checklistField, "checkbox", `${label}: Yes box.`, when(checklistField, "yes")),
    edge(`${prefix}${name}[${noIndex}]`, page, section, item, checklistField, "checkbox", `${label}: No box.`, when(checklistField, "no")),
  ];
}

const CHECKLIST_EDGES = [
  // ---- Part 1 Item 1: the one application type that maps one-to-one ----
  edge(`${P1}CB_AppType[0]`, 1, "Part 1. Application Type", "1", "i131_purpose", "checkbox",
    "Item 1: I am a permanent resident applying for a reentry permit, ticked only when the client chose Re-entry Permit.",
    when("i131_purpose", "REENTRY_PERMIT")),
  edge(`${P4}P1_Line13_YesNo[0]`, 4, "Part 1. Application Type (continued)", "13", "i131_purpose", "checkbox",
    "Item 13 (hold refugee/asylee status, or LPR because of it): Yes, ticked for a Refugee Travel Document applicant, who by definition holds that status.",
    when("i131_purpose", "REFUGEE_TRAVEL_DOCUMENT")),

  // ---- Part 2 Items 8, 10, 12 (the other Part 2 boxes come from the shared canonical paths) ----
  edge(`${P5}Part2_Line8_Gender[0]`, 5, P2, "8", "i131_applicant_gender", "checkbox", "Item 8: Female box.", when("i131_applicant_gender", "Female")),
  edge(`${P5}Part2_Line8_Gender[1]`, 5, P2, "8", "i131_applicant_gender", "checkbox", "Item 8: Male box.", when("i131_applicant_gender", "Male")),
  edge(`${P5}#area[1].Part2_Line10_SSN[0]`, 5, P2, "10", "i131_applicant_ssn", "ssn", "Item 10: U.S. Social Security Number. No canonical SSN path exists, so it is read from the saved answer; digits only (the widget pre-prints the dashes).", { transform: { type: "digits" } }),
  edge(`${P5}Part2_Line12_ClassofAdmission[0]`, 5, P2, "12", "i131_applicant_classOfAdmission", "text", "Item 12: Class of Admission (COA)."),

  // ---- Part 2 Items 16-25: "Information About Them" (only when filing for a person outside the USA) ----
  edge(`${P6}P2_Line16_FamilyName[0]`, 6, P2_THEM, "16", "i131_outsideUsa_lastName", "text", "Item 16: their family name."),
  edge(`${P6}P2_Line16_GivenName[0]`, 6, P2_THEM, "16", "i131_outsideUsa_firstName", "text", "Item 16: their given name."),
  edge(`${P6}P2_Line16_MiddleName[0]`, 6, P2_THEM, "16", "i131_outsideUsa_middleName", "text", "Item 16: their middle name."),
  edge(`${P6}P2_Line18_DateOfBirth[0]`, 6, P2_THEM, "18", "i131_outsideUsa_dateOfBirth", "date", "Item 18: their date of birth.", { transform: dateT }),
  edge(`${P6}P2_Line19_CountryOfBirth[0]`, 6, P2_THEM, "19", "i131_outsideUsa_countryOfBirth", "text", "Item 19: their country of birth.", { transform: countryT }),
  edge(`${P6}P2_Line20_CountryOfCitizenship[0]`, 6, P2_THEM, "20", "i131_outsideUsa_countryOfCitizenship", "text", "Item 20: their country of citizenship or nationality.", { transform: countryT }),
  edge(`${P6}P2_Line21_DaytimeTelephoneNumber[0]`, 6, P2_THEM, "21", "i131_outsideUsa_daytimePhone", "phone", "Item 21: their daytime phone number."),
  edge(`${P6}P2_Line25_StreetNumberName[0]`, 6, P2_THEM, "25", "i131_outsideUsa_physicalAddress", "text", "Item 25: their current physical address, street."),
  edge(`${P6}P2_Line25_CityTown[0]`, 6, P2_THEM, "25", "i131_outsideUsa_physicalAddress_city", "text", "Item 25: their current physical address, city or town."),
  edge(`${P6}P2_Line25_Province[0]`, 6, P2_THEM, "25", "i131_outsideUsa_physicalAddress_province", "text", "Item 25: their current physical address, province."),
  edge(`${P6}P2_Line25_PostalCode[0]`, 6, P2_THEM, "25", "i131_outsideUsa_physicalAddress_postalCode", "text", "Item 25: their current physical address, postal code."),
  edge(`${P6}P2_Line25_Country[0]`, 6, P2_THEM, "25", "i131_outsideUsa_physicalAddress_country", "text", "Item 25: their current physical address, country.", { transform: countryT }),

  // ---- Part 4 Item 2: ever issued a Reentry Permit or Refugee Travel Document ----
  ...yesNoPair(P7, "P4_Line2a_YesNo", 0, 7, P4S, "2.a", "i131_previouslyIssued", "Item 2.a, ever issued a Reentry Permit or Refugee Travel Document"),
  edge(`${P7}P4_Line2b_DateIssued[0]`, 7, P4S, "2.b", "i131_previouslyIssued_dateIssued", "date", "Item 2.b: date the last one was issued.", { transform: dateT }),
  edge(`${P7}P4_Line2c_Disposition[0]`, 7, P4S, "2.c", "i131_previouslyIssued_disposition", "text", "Item 2.c: what became of it (attached, lost, ...)."),

  // ---- Part 4 Item 7: where to send the document ----
  edge(`${S7}P4_Line7a[1]`, 8, P4S, "7.a", "i131_delivery_method", "checkbox", "Item 7.a: to the U.S. address in Part 2 Item 3, when the client chose their physical address.", scoped(RTD_OR_REENTRY, when("i131_delivery_method", "PHYSICAL_ADDRESS"))),
  edge(`${S7}P4_Line7a[0]`, 8, P4S, "7.b", "i131_delivery_method", "checkbox", "Item 7.b: to a U.S. Embassy / Consulate / USCIS or DHS office overseas, when the client chose either.", scoped(RTD_OR_REENTRY, { transform: { type: "constant", value: true }, condition: { field: RAW("i131_delivery_method"), operator: "in", value: ["US_EMBASSY_OR_CONSULATE", "DHS_OFFICE_OVERSEAS"] } })),
  edge(`${S7}P4_Line7b_CityOrTown[0]`, 8, P4S, "7.b", "i131_delivery_embassyCity", "text", "Item 7.b: city or town of the overseas office (embassy / consulate answer, else the DHS office answer).", scoped(RTD_OR_REENTRY, { fallback: RAW("i131_delivery_dhsCity") })),
  edge(`${S7}P4_Line7b_Country[0]`, 8, P4S, "7.b", "i131_delivery_embassyCountry", "text", "Item 7.b: country of the overseas office (embassy / consulate answer, else the DHS office answer).", scoped(RTD_OR_REENTRY, { fallback: RAW("i131_delivery_dhsCountry"), transform: countryT })),

  // ---- Part 4 Item 9.a: where the pick-up notice goes (one free-text address, split into its parts) ----
  edge(`${S8}P4_Line9a_StreetNumberName[0]`, 9, P4S, "9.a", "i131_ap_pickupAddress", "text", "Item 9.a: pick-up notice address, street (split from the one free-text answer).", { transform: addr("street") }),
  edge(`${S8}P4_Line9a_CityTown[0]`, 9, P4S, "9.a", "i131_ap_pickupAddress", "text", "Item 9.a: city or town.", { transform: addr("city") }),
  edge(`${S8}P4_Line9a_State[0]`, 9, P4S, "9.a", "i131_ap_pickupAddress", "dropdown", "Item 9.a: state (a recognised US state only).", { transform: addr("state") }),
  edge(`${S8}P4_Line9a_ZipCode[0]`, 9, P4S, "9.a", "i131_ap_pickupAddress", "text", "Item 9.a: ZIP code.", { transform: addr("zip") }),
  edge(`${S8}P4_Line9a_Province[0]`, 9, P4S, "9.a", "i131_ap_pickupAddress", "text", "Item 9.a: province (non-US address).", { transform: addr("province") }),
  edge(`${S8}P4_Line9a_PostalCode[0]`, 9, P4S, "9.a", "i131_ap_pickupAddress", "text", "Item 9.a: postal code (non-US address).", { transform: addr("postalCode") }),
  edge(`${S8}P4_Line9a_Country[0]`, 9, P4S, "9.a", "i131_ap_pickupAddress", "text", "Item 9.a: country.", { transform: addr("country") }),

  // ---- Part 6: Refugee Travel Document ----
  edge(`${S8}P6_Line1_CountryRefugee[0]`, 9, P6S, "1", "i131_refugee_countryOfRefugeeAsylee", "text", "Item 1: country from which you are a refugee or asylee.", { transform: countryT }),
  ...yesNoPair(S8, "P6_Line2_YesNo", 1, 9, P6S, "2", "i131_refugee_plansToTravel", "Item 2, plan to travel to that country"),
  ...yesNoPair(S8, "P6_Line3a_YesNo", 0, 9, P6S, "3.a", "i131_refugee_everReturned", "Item 3.a, ever returned to that country"),
  ...yesNoPair(S8, "P6_Line3b_YesNo", 1, 9, P6S, "3.b", "i131_refugee_everAppliedNationalPassport", "Item 3.b, applied for / obtained a national passport or entry permit"),
  ...yesNoPair(S8, "P6_Line3c_YesNo", 0, 9, P6S, "3.c", "i131_refugee_everAppliedBenefits", "Item 3.c, applied for / received a benefit from that country"),
  ...yesNoPair(S9, "P6_Line4a_YesNo", 1, 10, P6S, "4.a", "i131_refugee_everReacquiredNationality", "Item 4.a, reacquired the nationality of that country"),
  ...yesNoPair(S9, "P6_Line4b_YesNo", 0, 10, P6S, "4.b", "i131_refugee_everAcquiredNewNationality", "Item 4.b, acquired a new nationality"),
  edge(`${S9}Line4c_Yes[0]`, 10, P6S, "4.c", "i131_refugee_everGrantedElsewhere", "checkbox", "Item 4.c, granted refugee or asylee status in another country: Yes box.", when("i131_refugee_everGrantedElsewhere", "yes")),
  edge(`${S9}Line4c_No[0]`, 10, P6S, "4.c", "i131_refugee_everGrantedElsewhere", "checkbox", "Item 4.c, granted refugee or asylee status in another country: No box.", when("i131_refugee_everGrantedElsewhere", "no")),

  // ---- Part 7: proposed travel (advance parole) ----
  edge(`${S9}P7_Line1_DateOfDeparture[0]`, 10, P7S, "1", "i131_dateOfIntendedDeparture", "date", "Item 1: date of intended departure.", scoped(AP, { transform: dateT })),
  edge(`${S9}P7_Line2_Purpose[0]`, 10, P7S, "2", "i131_travel_purposeOfTrip", "textarea", "Item 2: purpose of trip.", scoped(AP)),
  edge(`${S9}P7_Line3_ListCountries[0]`, 10, P7S, "3", "i131_travel_intendedCountries", "textarea", "Item 3: countries to visit, listed from the checklist's repeating rows.", scoped(AP, { transform: { type: "join", itemPath: "country", separator: ", " } })),
  edge(`${S9}P7_Line4_CB[0]`, 10, P7S, "4", "i131_ap_numberOfTrips", "checkbox", "Item 4: One Trip.", scoped(AP, when("i131_ap_numberOfTrips", "One Trip"))),
  edge(`${S9}P7_Line4_CB[1]`, 10, P7S, "4", "i131_ap_numberOfTrips", "checkbox", "Item 4: More than one trip.", scoped(AP, when("i131_ap_numberOfTrips", "Multiple Trips"))),
  edge(`${S9}P7_Line5_ExpectedLengthTrip[0]`, 10, P7S, "5", "i131_expectedLengthOfTrip", "text", "Item 5: expected length of trip (in days).", scoped(AP)),
];

module.exports = { CHECKLIST_EDGES, RAW };
