// K-1 (fiancé(e) of a U.S. citizen) — REAL, verbatim petitioner + beneficiary
// checklist content (replaces the prior minimal scaffold). Mirrors the shape
// of employment-workflow/questionnaires/{h1b,l1a,p,o1}.js (key, matches,
// *Documents, fieldCatalog()), kept entirely separate from those files — the
// employer/employee path is never read from or written to here.
//
// Source: "Information Required from U.S Sponsor/Petitioner (Required from
// US Citizen)" + "Information Required from Beneficiary (Required from
// Fiancee of US Citizen)". Every field label and document name below is
// verbatim from that source, EXCEPT two source typos that were flagged at
// sign-off and corrected per the source owner's explicit instruction (the
// authoritative source document itself is being updated to match):
//   - Section 13: "Did You met your wife..." -> "Did you meet your wife..."
//   - Section 14: "...immediately receding the filing..." -> "...immediately
//     preceding the filing..."
const key = "k1";

function matches(value) {
  return /^k[\s-]?1$/i.test(String(value || "").trim());
}

// "Petitioner Documents — 'From US Sponsor/ Petitioner:'" — verbatim, 9 items.
// The source's "Proof of having met in person within last two years before
// filing this petition:" line is a group heading over the next two items, not
// a document itself — preserved verbatim as each sub-item's description
// rather than dropped or modeled as a 10th document.
const MET_IN_PERSON_HEADING = "Proof of having met in person within last two years before filing this petition:";
const petitionerDocuments = [
  { name: "Copy of U.S passport", documentType: "petitioner_us_passport", required: true, category: "identity", targetRole: "petitioner", status: "requested" },
  { name: "Copy of US Naturalization/ Citizenship/ Birth certificate", documentType: "petitioner_naturalization_citizenship_birth_certificate", required: true, category: "immigration", targetRole: "petitioner", status: "requested" },
  { name: "Copy of SSN", documentType: "petitioner_ssn_copy", required: true, category: "identity", targetRole: "petitioner", status: "requested" },
  { name: "Copy of Driver's license or State Identification card", documentType: "petitioner_drivers_license_or_state_id", required: true, category: "identity", targetRole: "petitioner", status: "requested" },
  { name: "Passport photos(2pcs) of the petitioner- Hard copy", documentType: "petitioner_passport_photos_hard_copy", required: false, category: "identity", targetRole: "petitioner", status: "requested", hardCopy: true },
  { name: "Photos of the petitioner and the beneficiary together", documentType: "petitioner_met_in_person_photos", description: MET_IN_PERSON_HEADING, required: true, category: "immigration", targetRole: "petitioner", status: "requested" },
  { name: "Copy of the travel itinerary of the petitioner", documentType: "petitioner_travel_itinerary", description: MET_IN_PERSON_HEADING, required: true, category: "immigration", targetRole: "petitioner", status: "requested" },
  { name: "Letter mentioning intent to marry fiance within 90 days (required if applying for Fiance)", documentType: "petitioner_intent_to_marry_letter", required: true, category: "immigration", targetRole: "petitioner", status: "requested" },
  { name: "Marriage termination documents (such as divorce decrees, death certificate), if applicable", documentType: "petitioner_marriage_termination_documents", required: false, category: "immigration", targetRole: "petitioner", status: "requested" },
];

// "Documents required from Beneficiary:" — verbatim, 4 items.
const beneficiaryDocuments = [
  { name: "Copy of Passport of the beneficiary", documentType: "beneficiary_passport_copy", required: true, category: "identity", targetRole: "beneficiary", status: "requested" },
  { name: "Passport size photos(2pcs) of the beneficiary- Hard copy", documentType: "beneficiary_passport_photos_hard_copy", required: false, category: "identity", targetRole: "beneficiary", status: "requested", hardCopy: true },
  { name: "Letter mentioning intent to marry US Citizen fiance within 90 days", documentType: "beneficiary_intent_to_marry_letter", required: true, category: "immigration", targetRole: "beneficiary", status: "requested" },
  { name: "Marriage termination documents (such as divorce decrees, death certificate), if applicable", documentType: "beneficiary_marriage_termination_documents", required: false, category: "immigration", targetRole: "beneficiary", status: "requested" },
];

// Sub-field column definitions for every repeating group below, keyed by the
// group's own fieldCatalog() path — read by familyChecklists.js the same way
// employmentChecklists.js's REPEATABLE_FIELDS map is read, just kept local to
// this file since K-1's repeating groups are unique to the family path.
const REPEATABLE_FIELDS = {
  "petitioner.residentialHistory": [
    { key: "streetAndNumber", label: "Street and Number", type: "text" },
    { key: "city", label: "City", type: "text" },
    { key: "provinceState", label: "Province/State", type: "text" },
    { key: "country", label: "Country", type: "text" },
    { key: "from", label: "From (mm/dd/yyyy)", type: "date" },
    { key: "to", label: "To (mm/dd/yyyy)", type: "date" },
  ],
  "beneficiary.residentialHistory": [
    { key: "streetAndNumber", label: "Street and Number", type: "text" },
    { key: "city", label: "City", type: "text" },
    { key: "provinceState", label: "Province/State", type: "text" },
    { key: "country", label: "Country", type: "text" },
    { key: "from", label: "From (mm/dd/yyyy)", type: "date" },
    { key: "to", label: "To (mm/dd/yyyy)", type: "date" },
  ],
  "petitioner.employmentHistory": [
    { key: "employerName", label: "Full Name of Employer", type: "text" },
    { key: "employerAddress", label: "Full Address of Employer", type: "text" },
    { key: "occupation", label: "Your Occupation", type: "text" },
    { key: "from", label: "From (mm/dd/yyyy)", type: "date" },
    { key: "to", label: "To (mm/dd/yyyy)", type: "date" },
  ],
  "beneficiary.employmentHistory": [
    { key: "employerName", label: "Full Name of Employer", type: "text" },
    { key: "employerAddress", label: "Full Address of Employer", type: "text" },
    { key: "occupation", label: "Your Occupation", type: "text" },
    { key: "from", label: "From (mm/dd/yyyy)", type: "date" },
    { key: "to", label: "To (mm/dd/yyyy)", type: "date" },
  ],
  // Source prints "Prior Spouse 1/2/3" (petitioner) vs "Prior Spouse 1 and
  // Prior Spouse 2 (if any)" (beneficiary) — both are modeled identically as
  // an add-as-many-as-needed repeating group (per confirmed default #1); the
  // printed row count is a paper-form artifact, not a content difference.
  "petitioner.priorSpouses": [
    { key: "lastName", label: "Last Name", type: "text" },
    { key: "firstName", label: "First Name", type: "text" },
    { key: "middleName", label: "Middle Name", type: "text" },
    { key: "dateMarriageEnded", label: "Date Marriage Ended", type: "date" },
  ],
  "beneficiary.priorSpouses": [
    { key: "lastName", label: "Last Name", type: "text" },
    { key: "firstName", label: "First Name", type: "text" },
    { key: "middleName", label: "Middle Name", type: "text" },
    { key: "dateMarriageEnded", label: "Date Marriage Ended", type: "date" },
  ],
  "petitioner.statesCountriesSince18": [
    { key: "state", label: "State", type: "text" },
    { key: "country", label: "Country", type: "text" },
  ],
  "beneficiary.children": [
    { key: "lastName", label: "Last Name", type: "text" },
    { key: "firstName", label: "First Name", type: "text" },
    { key: "middleName", label: "Middle Name", type: "text" },
    { key: "dateOfBirth", label: "Date of Birth", type: "date" },
    { key: "countryOfBirth", label: "Country of Birth", type: "text" },
    { key: "fullAddress", label: "Full address of the child", type: "text" },
  ],
};

// The 14 "Information about your Parents:" fields are identical for
// petitioner and beneficiary (source repeats the same block verbatim on both
// sides) — built once here and prefixed per party below to avoid transcribing
// the same 14 labels twice.
function parentFields(party, sectionTitle) {
  return [
    { field: "fatherLastName", label: "Father's Last name:" },
    { field: "fatherFirstName", label: "Father's First name:" },
    { field: "fatherMiddleName", label: "Father's Middle Name:" },
    { field: "fatherDateOfBirth", label: "Date of Birth:", type: "date" },
    { field: "fatherCountryOfBirth", label: "Country of Birth:" },
    { field: "fatherCityTownVillageOfResidence", label: "City/Town/Village of Residence:" },
    { field: "fatherCountryOfResidence", label: "Country of Residence:" },
    { field: "motherLastName", label: "Mother's Last name:" },
    { field: "motherFirstName", label: "Mother's First name:" },
    { field: "motherMiddleName", label: "Mother's Middle Name:" },
    { field: "motherDateOfBirth", label: "Date of Birth:", type: "date" },
    { field: "motherCountryOfBirth", label: "Country of Birth:" },
    { field: "motherCityTownVillageOfResidence", label: "City/Town/Village of Residence:" },
    { field: "motherCountryOfResidence", label: "Country of Residence:" },
  ].map((entry) => ({
    path: `${party}.parents.${entry.field}`,
    label: entry.label,
    section: party,
    sectionTitle,
    type: entry.type,
  }));
}

const MARITAL_STATUS_OPTIONS = ["single", "married", "widowed", "divorced"];
// Not enumerated in the source (which only prints "Gender:" with no option
// list) — a reasonable UI default, flagged at sign-off as inferred rather
// than verbatim-sourced, unlike every other option list in this file.
const GENDER_OPTIONS = ["Male", "Female"];

function fieldCatalog() {
  const petitionerSection1 = "Information about you (U.S. sponsor/Petitioner):";
  const petitionerSection2 = "Provide your residential history for the last five years:";
  const petitionerSection3 = "Provide your employment history for last 5 years:";
  const petitionerSection4 = "Information about your Parents:";
  const petitionerSection5 = "If you were previously married, then please provide the following details for all your previous Spouse(s):";
  const petitionerSection6 = "Your Citizenship Information:";
  const petitionerSection7 = "Have you ever filed Form I-129F for any other beneficiary? (Yes/No)";
  const petitionerSection8 = "Do you have any children who are below 18 years of age? If yes, provide their age-";
  const petitionerSection9 = "Provide all US states and foreign countries where you have stayed since your 18th birthday-";

  const beneficiarySection1 = "Information about the Beneficiary:";
  const beneficiarySection2 = petitionerSection2;
  const beneficiarySection3 = petitionerSection3;
  const beneficiarySection4 = petitionerSection4;
  const beneficiarySection5 = "If you were previously married, then please provide the following details for all your previous Spouse(s):";
  const beneficiarySection6 = "Have you ever been to the United States?";
  const beneficiarySection7 = "If you are currently in the United States, then provide the following information:";
  const beneficiarySection8 = "If you have any children, then provide the following details for all your children:";
  const beneficiarySection9 = "Address where you intend to live in the USA:";
  const beneficiarySection10 = "Your full Outside US address:";
  const beneficiarySection11 = "You will apply for a visa abroad at the U.S. Embassy or U.S. Consulate at (mention City and Country):";
  const beneficiarySection12 = "Biographical Information:";
  const beneficiarySection13 = "Did you meet your wife through any International Marriage Broker:";
  const beneficiarySection14 = "Has your Fiancé met and seen you within the two year period immediately preceding the filing of this petition?";

  return [
    // ---- PETITIONER ----
    // Section 1 — 15 fields, verbatim.
    { path: "petitioner.info.lastName", label: "Last Name:", section: "petitioner", sectionTitle: petitionerSection1, required: true },
    { path: "petitioner.info.firstName", label: "First name:", section: "petitioner", sectionTitle: petitionerSection1, required: true },
    { path: "petitioner.info.middleName", label: "Middle Name:", section: "petitioner", sectionTitle: petitionerSection1 },
    { path: "petitioner.info.gender", label: "Gender:", section: "petitioner", sectionTitle: petitionerSection1, type: "select", options: GENDER_OPTIONS },
    { path: "petitioner.info.dateOfBirth", label: "Date of birth:", section: "petitioner", sectionTitle: petitionerSection1, type: "date", required: true },
    { path: "petitioner.info.cityTownOfBirth", label: "City/Town of Birth:", section: "petitioner", sectionTitle: petitionerSection1 },
    { path: "petitioner.info.stateProvinceOfBirth", label: "State/Province of Birth:", section: "petitioner", sectionTitle: petitionerSection1 },
    { path: "petitioner.info.countryOfBirth", label: "Country of birth:", section: "petitioner", sectionTitle: petitionerSection1, required: true },
    { path: "petitioner.info.countryOfCitizenship", label: "Country of Citizenship/Nationality:", section: "petitioner", sectionTitle: petitionerSection1, required: true },
    { path: "petitioner.info.fullMailingAddress", label: "Full Mailing address:", section: "petitioner", sectionTitle: petitionerSection1 },
    { path: "petitioner.info.fullPhysicalAddress", label: "Full Physical address (if different from Mailing Address):", section: "petitioner", sectionTitle: petitionerSection1 },
    { path: "petitioner.info.ssn", label: "U.S. Social Security #:", section: "petitioner", sectionTitle: petitionerSection1 },
    { path: "petitioner.info.uscisOnlineAccountNumber", label: "USCIS Online Account Number (If any):", section: "petitioner", sectionTitle: petitionerSection1 },
    { path: "petitioner.info.aNumber", label: "A# (if any):", section: "petitioner", sectionTitle: petitionerSection1 },
    { path: "petitioner.info.maritalStatus", label: "Marital status (single, married, widowed, divorced):", section: "petitioner", sectionTitle: petitionerSection1, type: "select", options: MARITAL_STATUS_OPTIONS, required: true },

    // Section 2 — repeating group.
    { path: "petitioner.residentialHistory", label: petitionerSection2, section: "petitioner", sectionTitle: petitionerSection2, repeatable: true },

    // Section 3 — repeating group.
    { path: "petitioner.employmentHistory", label: petitionerSection3, section: "petitioner", sectionTitle: petitionerSection3, repeatable: true },

    // Section 4 — 14 parent fields.
    ...parentFields("petitioner", petitionerSection4),

    // Section 5 — repeating group, gated on having been previously married.
    // No explicit yes/no field exists in the source for this — driven by
    // maritalStatus !== "single" (flagged at sign-off as an inferred driver).
    {
      path: "petitioner.priorSpouses",
      label: petitionerSection5,
      section: "petitioner",
      sectionTitle: petitionerSection5,
      repeatable: true,
      condition: { field: "petitioner.info.maritalStatus", operator: "not_equals", value: "single" },
    },

    // Section 6 — citizenship information + conditional certificate detail.
    { path: "petitioner.citizenship.throughType", label: "You are a US citizen Through-", section: "petitioner", sectionTitle: petitionerSection6, type: "select", options: ["Birth in the United States", "Naturalization", "US Citizen parents"] },
    { path: "petitioner.citizenship.hasCertificate", label: "Have you obtained a Certificate of Citizenship or Certificate of Naturalization in your name?", section: "petitioner", sectionTitle: petitionerSection6, type: "radio", options: ["Yes", "No"] },
    { path: "petitioner.citizenship.certificateNumber", label: "Certificate Number:", section: "petitioner", sectionTitle: petitionerSection6, condition: { field: "petitioner.citizenship.hasCertificate", operator: "equals", value: "Yes" } },
    { path: "petitioner.citizenship.certificatePlaceOfIssuance", label: "Place of Issuance:", section: "petitioner", sectionTitle: petitionerSection6, condition: { field: "petitioner.citizenship.hasCertificate", operator: "equals", value: "Yes" } },
    { path: "petitioner.citizenship.certificateDateOfIssuance", label: "Date of Issuance:", section: "petitioner", sectionTitle: petitionerSection6, type: "date", condition: { field: "petitioner.citizenship.hasCertificate", operator: "equals", value: "Yes" } },

    // Section 7 — I-129F history, conditional detail block.
    { path: "petitioner.i129f.filedBefore", label: petitionerSection7, section: "petitioner", sectionTitle: petitionerSection7, type: "radio", options: ["Yes", "No"] },
    { path: "petitioner.i129f.aNumber", label: "A# Number:", section: "petitioner", sectionTitle: petitionerSection7, condition: { field: "petitioner.i129f.filedBefore", operator: "equals", value: "Yes" } },
    { path: "petitioner.i129f.lastName", label: "Last Name:", section: "petitioner", sectionTitle: petitionerSection7, condition: { field: "petitioner.i129f.filedBefore", operator: "equals", value: "Yes" } },
    { path: "petitioner.i129f.firstName", label: "First Name:", section: "petitioner", sectionTitle: petitionerSection7, condition: { field: "petitioner.i129f.filedBefore", operator: "equals", value: "Yes" } },
    { path: "petitioner.i129f.middleName", label: "Middle Name:", section: "petitioner", sectionTitle: petitionerSection7, condition: { field: "petitioner.i129f.filedBefore", operator: "equals", value: "Yes" } },
    { path: "petitioner.i129f.dateOfFiling", label: "Date of filing:", section: "petitioner", sectionTitle: petitionerSection7, type: "date", condition: { field: "petitioner.i129f.filedBefore", operator: "equals", value: "Yes" } },
    { path: "petitioner.i129f.uscisAction", label: "What action did USCIS take on the Form I-129F (for example approved, denied, revoked)?", section: "petitioner", sectionTitle: petitionerSection7, condition: { field: "petitioner.i129f.filedBefore", operator: "equals", value: "Yes" } },

    // Section 8 — children under 18, conditional age detail.
    { path: "petitioner.children.hasChildrenUnder18", label: "Do you have any children who are below 18 years of age?", section: "petitioner", sectionTitle: petitionerSection8, type: "radio", options: ["Yes", "No"] },
    { path: "petitioner.children.ages", label: "If yes, provide their age-", section: "petitioner", sectionTitle: petitionerSection8, condition: { field: "petitioner.children.hasChildrenUnder18", operator: "equals", value: "Yes" } },

    // Section 9 — repeating group.
    { path: "petitioner.statesCountriesSince18", label: petitionerSection9, section: "petitioner", sectionTitle: petitionerSection9, repeatable: true },

    // ---- BENEFICIARY ----
    // Section 1 — 14 fields, verbatim (no USCIS Online Account Number).
    { path: "beneficiary.info.lastName", label: "Last Name:", section: "beneficiary", sectionTitle: beneficiarySection1, required: true },
    { path: "beneficiary.info.firstName", label: "First name:", section: "beneficiary", sectionTitle: beneficiarySection1, required: true },
    { path: "beneficiary.info.middleName", label: "Middle Name:", section: "beneficiary", sectionTitle: beneficiarySection1 },
    { path: "beneficiary.info.gender", label: "Gender:", section: "beneficiary", sectionTitle: beneficiarySection1, type: "select", options: GENDER_OPTIONS },
    { path: "beneficiary.info.dateOfBirth", label: "Date of birth:", section: "beneficiary", sectionTitle: beneficiarySection1, type: "date", required: true },
    { path: "beneficiary.info.cityTownOfBirth", label: "City/Town of Birth:", section: "beneficiary", sectionTitle: beneficiarySection1 },
    { path: "beneficiary.info.stateProvinceOfBirth", label: "State/Province of Birth:", section: "beneficiary", sectionTitle: beneficiarySection1 },
    { path: "beneficiary.info.countryOfBirth", label: "Country of birth:", section: "beneficiary", sectionTitle: beneficiarySection1, required: true },
    { path: "beneficiary.info.countryOfCitizenship", label: "Country of Citizenship/Nationality:", section: "beneficiary", sectionTitle: beneficiarySection1, required: true },
    { path: "beneficiary.info.fullMailingAddress", label: "Full Mailing address:", section: "beneficiary", sectionTitle: beneficiarySection1 },
    { path: "beneficiary.info.fullPhysicalAddress", label: "Full Physical address (if different from Mailing Address):", section: "beneficiary", sectionTitle: beneficiarySection1 },
    { path: "beneficiary.info.ssn", label: "U.S. Social Security #:", section: "beneficiary", sectionTitle: beneficiarySection1 },
    { path: "beneficiary.info.aNumber", label: "A# (if any):", section: "beneficiary", sectionTitle: beneficiarySection1 },
    { path: "beneficiary.info.maritalStatus", label: "Marital status (single, married, widowed, divorced):", section: "beneficiary", sectionTitle: beneficiarySection1, type: "select", options: MARITAL_STATUS_OPTIONS, required: true },

    // Section 2 — repeating group.
    { path: "beneficiary.residentialHistory", label: beneficiarySection2, section: "beneficiary", sectionTitle: beneficiarySection2, repeatable: true },

    // Section 3 — repeating group.
    { path: "beneficiary.employmentHistory", label: beneficiarySection3, section: "beneficiary", sectionTitle: beneficiarySection3, repeatable: true },

    // Section 4 — 14 parent fields (identical block to the petitioner's).
    ...parentFields("beneficiary", beneficiarySection4),

    // Section 5 — repeating group, same inferred maritalStatus gate as the petitioner's.
    {
      path: "beneficiary.priorSpouses",
      label: beneficiarySection5,
      section: "beneficiary",
      sectionTitle: beneficiarySection5,
      repeatable: true,
      condition: { field: "beneficiary.info.maritalStatus", operator: "not_equals", value: "single" },
    },

    // Section 6 — ever been to the United States.
    { path: "beneficiary.usHistory.everBeenToUS", label: beneficiarySection6, section: "beneficiary", sectionTitle: beneficiarySection6, type: "radio", options: ["Yes", "No"] },

    // Section 7 — conditional on Section 6 = Yes (no separate "currently in
    // the US" field exists in the source; flagged at sign-off as the inferred
    // driver for this block).
    { path: "beneficiary.usHistory.i94Number", label: "I-94#", section: "beneficiary", sectionTitle: beneficiarySection7, condition: { field: "beneficiary.usHistory.everBeenToUS", operator: "equals", value: "Yes" } },
    { path: "beneficiary.usHistory.i94ExpiryDate", label: "Expiry date of I-94:", section: "beneficiary", sectionTitle: beneficiarySection7, type: "date", condition: { field: "beneficiary.usHistory.everBeenToUS", operator: "equals", value: "Yes" } },
    { path: "beneficiary.usHistory.dateOfLastArrival", label: "Date of last arrival (mm/dd/yyyy):", section: "beneficiary", sectionTitle: beneficiarySection7, type: "date", condition: { field: "beneficiary.usHistory.everBeenToUS", operator: "equals", value: "Yes" } },
    { path: "beneficiary.usHistory.dateStatusExpires", label: "Date Status expires (mm/dd/yyyy):", section: "beneficiary", sectionTitle: beneficiarySection7, type: "date", condition: { field: "beneficiary.usHistory.everBeenToUS", operator: "equals", value: "Yes" } },
    { path: "beneficiary.usHistory.visaOnWhichArrived", label: "Visa on which you arrived (for example, visitor, student, temporary worker):", section: "beneficiary", sectionTitle: beneficiarySection7, condition: { field: "beneficiary.usHistory.everBeenToUS", operator: "equals", value: "Yes" } },
    { path: "beneficiary.usHistory.passportNumber", label: "Passport Number:", section: "beneficiary", sectionTitle: beneficiarySection7, condition: { field: "beneficiary.usHistory.everBeenToUS", operator: "equals", value: "Yes" } },
    { path: "beneficiary.usHistory.passportCountryOfIssuance", label: "Country of Issuance for the passport:", section: "beneficiary", sectionTitle: beneficiarySection7, condition: { field: "beneficiary.usHistory.everBeenToUS", operator: "equals", value: "Yes" } },
    { path: "beneficiary.usHistory.passportExpirationDate", label: "Expiration date of passport:", section: "beneficiary", sectionTitle: beneficiarySection7, type: "date", condition: { field: "beneficiary.usHistory.everBeenToUS", operator: "equals", value: "Yes" } },

    // Section 8 — repeating group (children), ungated (no boolean driver
    // field exists in the source; an empty group represents "no children").
    { path: "beneficiary.children", label: beneficiarySection8, section: "beneficiary", sectionTitle: beneficiarySection8, repeatable: true },

    // Section 9-11 — single fields.
    { path: "beneficiary.intendedUsAddress", label: beneficiarySection9, section: "beneficiary", sectionTitle: beneficiarySection9 },
    { path: "beneficiary.outsideUsAddress", label: beneficiarySection10, section: "beneficiary", sectionTitle: beneficiarySection10 },
    { path: "beneficiary.consulateCityCountry", label: beneficiarySection11, section: "beneficiary", sectionTitle: beneficiarySection11 },

    // Section 12 — biographical information, 4 fields, verbatim (including
    // the source's inline blank-formatting on height/weight).
    { path: "beneficiary.biographical.height", label: "Height: ____ft____inches", section: "beneficiary", sectionTitle: beneficiarySection12 },
    { path: "beneficiary.biographical.weight", label: "Weight:______pounds", section: "beneficiary", sectionTitle: beneficiarySection12 },
    { path: "beneficiary.biographical.eyeColor", label: "Eye Colour:", section: "beneficiary", sectionTitle: beneficiarySection12 },
    { path: "beneficiary.biographical.hairColor", label: "Hair Colour:", section: "beneficiary", sectionTitle: beneficiarySection12 },

    // Section 13 — international marriage broker, conditional detail.
    // Section 13 — typo corrected per sign-off ("met" -> "meet"); source doc being updated to match.
    { path: "beneficiary.marriageBroker.usedBroker", label: beneficiarySection13, section: "beneficiary", sectionTitle: beneficiarySection13, type: "radio", options: ["Yes", "No"] },
    { path: "beneficiary.marriageBroker.brokerNameAddress", label: "Please give their Name and Address", section: "beneficiary", sectionTitle: beneficiarySection13, condition: { field: "beneficiary.marriageBroker.usedBroker", operator: "equals", value: "Yes" } },

    // Section 14 — typo corrected per sign-off ("receding" -> "preceding"); source doc being updated to match.
    { path: "beneficiary.metWithinTwoYears", label: beneficiarySection14, section: "beneficiary", sectionTitle: beneficiarySection14, type: "radio", options: ["Yes", "No"], required: true },
  ];
}

module.exports = { key, matches, petitionerDocuments, beneficiaryDocuments, fieldCatalog, REPEATABLE_FIELDS };
