// Family-based immigrant petition — three SEPARATE real, business-supplied
// checklists (verbatim transcriptions, same convention as k1.js/k3.js's own
// header comments), not one merged document:
//
//   1. "Questionnaire for Petition for Alien Relative" (Form I-130)
//      -> i130 export: petitioner + beneficiary sections.
//   2. "Green Card Checklist" (adjustment-of-status / Form I-485 + public
//      charge questionnaire) -> greenCard export: beneficiary-only, no
//      petitioner split (the source has none).
//   3. "Sponsor/Petitioner & Beneficiary/Principal Immigrant Checklist for
//      I-864" -> i864 export: sponsor-only (defaults to the petitioner,
//      see familyChecklists.js) + the joint-sponsor variant.
//
// familyChecklists.js composes these into the case's actual checklist set
// based on the case's chosen filing path (Case.processingPath) - see its
// own header comment for the exact composition rule (never "assign all
// three checklists always").
const key = "family_based_immigrant_petition";

function matches(value) {
  return /^(ir-?[1-5]|cr-?[12]|f-?2a|f-?2b)$/i.test(String(value || "").trim());
}

// ============================================================
// 1. FORM I-130 — "Questionnaire for Petition for Alien Relative"
// ============================================================

const i130PetitionerDocuments = [
  { name: "Copy of passport", documentType: "petitioner_passport_copy", description: "Provide all pages except blank pages.", required: true, category: "identity", targetRole: "petitioner", status: "requested" },
  { name: "Copy of Naturalization / Citizenship certificate or US Birth Certificate", documentType: "petitioner_naturalization_citizenship_or_birth_certificate", description: "If U.S. citizen.", required: true, category: "immigration", targetRole: "petitioner", status: "requested" },
  { name: "Copy of green card, front and back", documentType: "petitioner_green_card_front_back", description: "If lawful permanent resident.", required: false, category: "immigration", targetRole: "petitioner", status: "requested" },
  { name: "Copy of SSN", documentType: "petitioner_ssn_copy", required: true, category: "identity", targetRole: "petitioner", status: "requested" },
  { name: "Copy of State Identification card or driver's license", documentType: "petitioner_state_id_or_drivers_license", required: true, category: "identity", targetRole: "petitioner", status: "requested" },
  { name: "Copy of Marriage Certificate", documentType: "petitioner_marriage_certificate", description: "If applying for spouse.", required: false, category: "immigration", targetRole: "petitioner", status: "requested" },
  { name: "Copy of marriage termination documents", documentType: "petitioner_marriage_termination_documents", required: false, category: "immigration", targetRole: "petitioner", status: "requested" },
  { name: "Copy of Birth Certificate", documentType: "petitioner_birth_certificate", description: "If applying for parents.", required: false, category: "identity", targetRole: "petitioner", status: "requested" },
  { name: "One digital passport size Photo", documentType: "petitioner_passport_photo", required: true, category: "identity", targetRole: "petitioner", status: "requested" },
];

const i130BeneficiaryDocuments = [
  { name: "Copy of passport", documentType: "beneficiary_passport_copy", description: "Provide all pages except blank pages.", required: true, category: "identity", targetRole: "beneficiary", status: "requested" },
  { name: "Copy of Birth Certificate", documentType: "beneficiary_birth_certificate", required: true, category: "identity", targetRole: "beneficiary", status: "requested" },
  { name: "Copy of Marriage Certificate", documentType: "beneficiary_marriage_certificate", required: false, category: "immigration", targetRole: "beneficiary", status: "requested" },
  { name: "One digital passport size Photo", documentType: "beneficiary_passport_photo", required: true, category: "identity", targetRole: "beneficiary", status: "requested" },
  { name: "National identity card", documentType: "beneficiary_national_identity_card", required: false, category: "identity", targetRole: "beneficiary", status: "requested" },
];

const I130_PETITIONER_INFO = "Petitioner Information";
const I130_BENEFICIARY_INFO = "Beneficiary Information";

function i130FieldCatalog() {
  const entries = [
    // "I am Filing for my:" — structured, not free text, per the business's
    // explicit correction. Synced onto Case.petitionSubType (already in
    // VisaFormMapping's TRIGGER_FIELD_WHITELIST) so I-130A's existing
    // spouse-trigger can key off it for F2A/F2B (where, unlike IR-1/CR-1,
    // the visaType alone doesn't imply "spouse").
    { path: "petitioner.relationship", label: "I am Filing for my:", section: "petitioner", sectionTitle: I130_PETITIONER_INFO, type: "select", options: ["Husband/wife", "Parent", "Brother/Sister", "Child"], metadata: { syncsToCaseField: "petitionSubType" } },

    { path: "petitioner.lastName", label: "Last Name", section: "petitioner", sectionTitle: I130_PETITIONER_INFO },
    { path: "petitioner.firstName", label: "First Name", section: "petitioner", sectionTitle: I130_PETITIONER_INFO },
    { path: "petitioner.middleName", label: "Middle name", section: "petitioner", sectionTitle: I130_PETITIONER_INFO },
    { path: "petitioner.otherNamesUsed", label: "Other names used (Including Maiden name)", section: "petitioner", sectionTitle: I130_PETITIONER_INFO },
    { path: "petitioner.mailingAddress", label: "Mailing Address", section: "petitioner", sectionTitle: I130_PETITIONER_INFO },
    { path: "petitioner.physicalAddress", label: "Physical Address (If different from Mailing address)", section: "petitioner", sectionTitle: I130_PETITIONER_INFO, required: false },
    { path: "petitioner.cityCountryOfBirth", label: "City and Country of Birth", section: "petitioner", sectionTitle: I130_PETITIONER_INFO },
    { path: "petitioner.dateOfBirth", label: "Date of birth", section: "petitioner", sectionTitle: I130_PETITIONER_INFO, type: "date" },
    { path: "petitioner.gender", label: "Gender", section: "petitioner", sectionTitle: I130_PETITIONER_INFO },
    { path: "petitioner.ssn", label: "SSN Number", section: "petitioner", sectionTitle: I130_PETITIONER_INFO },
    { path: "petitioner.alienNumber", label: "Alien #", section: "petitioner", sectionTitle: I130_PETITIONER_INFO, required: false },

    { path: "petitioner.maritalStatus", label: "Marital Status", section: "petitioner", sectionTitle: I130_PETITIONER_INFO },
    { path: "petitioner.currentSpouseName", label: "Name of current Spouse (If married)", section: "petitioner", sectionTitle: I130_PETITIONER_INFO, required: false },
    { path: "petitioner.currentMarriageDate", label: "Date of Current Marriage", section: "petitioner", sectionTitle: I130_PETITIONER_INFO, required: false, type: "date" },
    { path: "petitioner.currentMarriagePlace", label: "Place of Current Marriage (City, State, and Country)", section: "petitioner", sectionTitle: I130_PETITIONER_INFO, required: false },
    { path: "petitioner.priorSpouses", label: "Prior Spouse(s)", section: "petitioner", sectionTitle: I130_PETITIONER_INFO, required: false, repeatable: true, description: "Name of prior spouse(s) and date marriage ended, if any." },

    { path: "petitioner.fatherFullName", label: "Father's Full Name", section: "petitioner", sectionTitle: I130_PETITIONER_INFO },
    { path: "petitioner.fatherDateOfBirth", label: "Father's Date of Birth", section: "petitioner", sectionTitle: I130_PETITIONER_INFO, type: "date" },
    { path: "petitioner.fatherCountryOfBirth", label: "Father's Country of Birth", section: "petitioner", sectionTitle: I130_PETITIONER_INFO },
    { path: "petitioner.fatherResidence", label: "Father's City and Country of Residence", section: "petitioner", sectionTitle: I130_PETITIONER_INFO },
    { path: "petitioner.motherFullName", label: "Mother's Full Name", section: "petitioner", sectionTitle: I130_PETITIONER_INFO },
    { path: "petitioner.motherDateOfBirth", label: "Mother's Date of Birth", section: "petitioner", sectionTitle: I130_PETITIONER_INFO, type: "date" },
    { path: "petitioner.motherCountryOfBirth", label: "Mother's Country of Birth", section: "petitioner", sectionTitle: I130_PETITIONER_INFO },
    { path: "petitioner.motherResidence", label: "Mother's City and Country of Residence", section: "petitioner", sectionTitle: I130_PETITIONER_INFO },

    { path: "petitioner.height", label: "Height (feet and inches)", section: "petitioner", sectionTitle: I130_PETITIONER_INFO },
    { path: "petitioner.weight", label: "Weight (in pounds)", section: "petitioner", sectionTitle: I130_PETITIONER_INFO },
    { path: "petitioner.eyeColor", label: "Eye Colour", section: "petitioner", sectionTitle: I130_PETITIONER_INFO },
    { path: "petitioner.hairColor", label: "Hair Colour", section: "petitioner", sectionTitle: I130_PETITIONER_INFO },

    { path: "petitioner.citizenshipBasis", label: "You are a U.S. Citizen", section: "petitioner", sectionTitle: I130_PETITIONER_INFO, type: "radio", options: ["By birth", "By Naturalization", "Through Parents"] },
    { path: "petitioner.naturalizationCertificateNumber", label: "Naturalization Certificate Number", section: "petitioner", sectionTitle: I130_PETITIONER_INFO, required: false, condition: { field: "petitioner.citizenshipBasis", operator: "equals", value: "By Naturalization" } },
    { path: "petitioner.naturalizationDateAndPlace", label: "Naturalization Date & Place of Issuance", section: "petitioner", sectionTitle: I130_PETITIONER_INFO, required: false, condition: { field: "petitioner.citizenshipBasis", operator: "equals", value: "By Naturalization" } },
    { path: "petitioner.isLawfulPermanentResident", label: "Are you a lawful Permanent resident Alien?", section: "petitioner", sectionTitle: I130_PETITIONER_INFO, type: "radio", options: ["Yes", "No"] },
    { path: "petitioner.lprGainedThroughMarriage", label: "Is it gained through Marriage?", section: "petitioner", sectionTitle: I130_PETITIONER_INFO, type: "radio", options: ["Yes", "No"], required: false },

    { path: "petitioner.employmentHistory", label: "Employment History (last 5 years, inside and outside USA)", section: "petitioner", sectionTitle: I130_PETITIONER_INFO, repeatable: true },
    { path: "petitioner.addressHistory", label: "Address History (last 5 years, inside and outside USA)", section: "petitioner", sectionTitle: I130_PETITIONER_INFO, repeatable: true },

    // Source's own "Additional Information required from the Petitioner"
    // section 8 — transcribed as-is even though it overlaps with the I-864
    // checklist's own (larger) financial section; not deduplicated across
    // documents per the "transcribe each source faithfully" instruction.
    { path: "petitioner.sponsorsMaritalStatus", label: "Sponsor's marital status", section: "petitioner", sectionTitle: I130_PETITIONER_INFO },
    { path: "petitioner.numberOfDependentKids", label: "Number of dependent kids", section: "petitioner", sectionTitle: I130_PETITIONER_INFO, type: "number" },
    { path: "petitioner.numberOfOtherDependents", label: "Number of other dependents", section: "petitioner", sectionTitle: I130_PETITIONER_INFO, type: "number" },
    { path: "petitioner.currentAnnualIncome", label: "Current Annual Income", section: "petitioner", sectionTitle: I130_PETITIONER_INFO, type: "currency" },
    { path: "petitioner.taxYear1Income", label: "Most recent Tax year total income", section: "petitioner", sectionTitle: I130_PETITIONER_INFO, type: "currency" },
    { path: "petitioner.taxYear2Income", label: "2nd Most recent Tax year total income", section: "petitioner", sectionTitle: I130_PETITIONER_INFO, type: "currency" },
    { path: "petitioner.taxYear3Income", label: "3rd Most recent Tax year total income", section: "petitioner", sectionTitle: I130_PETITIONER_INFO, type: "currency" },
    { path: "petitioner.savingsAndCheckingBalance", label: "Balance of all savings and checking accounts", section: "petitioner", sectionTitle: I130_PETITIONER_INFO, required: false, type: "currency", description: "Other assets you want to include as income." },
    { path: "petitioner.realEstateNetCashValue", label: "Net cash value of real-estate holdings", section: "petitioner", sectionTitle: I130_PETITIONER_INFO, required: false, type: "currency" },
    { path: "petitioner.stocksBondsNetCashValue", label: "Net cash value of all stocks, bonds, certificates of deposit", section: "petitioner", sectionTitle: I130_PETITIONER_INFO, required: false, type: "currency" },

    { path: "beneficiary.firstName", label: "First Name", section: "beneficiary", sectionTitle: I130_BENEFICIARY_INFO },
    { path: "beneficiary.middleName", label: "Middle Name", section: "beneficiary", sectionTitle: I130_BENEFICIARY_INFO, required: false },
    { path: "beneficiary.lastName", label: "Last Name", section: "beneficiary", sectionTitle: I130_BENEFICIARY_INFO },
    { path: "beneficiary.physicalAddress", label: "Physical Address", section: "beneficiary", sectionTitle: I130_BENEFICIARY_INFO },
    { path: "beneficiary.dateOfBirth", label: "Date of birth", section: "beneficiary", sectionTitle: I130_BENEFICIARY_INFO, type: "date" },
    { path: "beneficiary.cityStateCountryOfBirth", label: "City, State and Country of Birth", section: "beneficiary", sectionTitle: I130_BENEFICIARY_INFO },
    { path: "beneficiary.ssn", label: "SSN", section: "beneficiary", sectionTitle: I130_BENEFICIARY_INFO, required: false },
    { path: "beneficiary.alienNumber", label: "Alien # (if any)", section: "beneficiary", sectionTitle: I130_BENEFICIARY_INFO, required: false },

    { path: "beneficiary.maritalStatus", label: "Marital Status", section: "beneficiary", sectionTitle: I130_BENEFICIARY_INFO },
    { path: "beneficiary.currentSpouseName", label: "Name of current Spouse (If married)", section: "beneficiary", sectionTitle: I130_BENEFICIARY_INFO, required: false },
    { path: "beneficiary.currentMarriageDate", label: "Date of Current Marriage", section: "beneficiary", sectionTitle: I130_BENEFICIARY_INFO, required: false, type: "date" },
    { path: "beneficiary.currentMarriagePlace", label: "Place of Current Marriage (City, State, and Country)", section: "beneficiary", sectionTitle: I130_BENEFICIARY_INFO, required: false },

    { path: "beneficiary.arrivalStatus", label: "If in USA, Arrived in US in which status", section: "beneficiary", sectionTitle: I130_BENEFICIARY_INFO, required: false },
    { path: "beneficiary.i94Number", label: "I-94", section: "beneficiary", sectionTitle: I130_BENEFICIARY_INFO, required: false },
    { path: "beneficiary.lastDateOfArrival", label: "Last date of arrival", section: "beneficiary", sectionTitle: I130_BENEFICIARY_INFO, required: false, type: "date" },
    { path: "beneficiary.statusExpiresOn", label: "Status expires on", section: "beneficiary", sectionTitle: I130_BENEFICIARY_INFO, required: false, type: "date" },
    { path: "beneficiary.currentEmployerName", label: "Name of current employer", section: "beneficiary", sectionTitle: I130_BENEFICIARY_INFO, required: false },
    { path: "beneficiary.currentEmployerAddress", label: "Full address of current employer", section: "beneficiary", sectionTitle: I130_BENEFICIARY_INFO, required: false },
    { path: "beneficiary.employmentBeganDate", label: "Date employment began", section: "beneficiary", sectionTitle: I130_BENEFICIARY_INFO, required: false, type: "date" },
    { path: "beneficiary.underImmigrationProceedings", label: "Are you under immigration proceedings?", section: "beneficiary", sectionTitle: I130_BENEFICIARY_INFO, type: "radio", options: ["Yes", "No"] },

    { path: "beneficiary.priorSpouses", label: "Prior Spouse(s)", section: "beneficiary", sectionTitle: I130_BENEFICIARY_INFO, required: false, repeatable: true, description: "Name of prior spouse(s) and date marriage ended, if any." },
    { path: "beneficiary.familyMembers", label: "Present Husband/Wife and Children", section: "beneficiary", sectionTitle: I130_BENEFICIARY_INFO, required: false, repeatable: true },

    { path: "beneficiary.usAddress", label: "Address where you will live in the USA", section: "beneficiary", sectionTitle: I130_BENEFICIARY_INFO },
    { path: "beneficiary.foreignAddress", label: "Your Address outside the USA", section: "beneficiary", sectionTitle: I130_BENEFICIARY_INFO },
    { path: "beneficiary.lastSharedAddress", label: "Last address where you lived together", section: "beneficiary", sectionTitle: I130_BENEFICIARY_INFO, required: false, description: "If filing for spouse." },

    { path: "beneficiary.adjustmentOfficeCity", label: "You will apply for an Adjustment of status in which USCIS office — City", section: "beneficiary", sectionTitle: I130_BENEFICIARY_INFO, required: false },
    { path: "beneficiary.adjustmentOfficeState", label: "You will apply for an Adjustment of status in which USCIS office — State", section: "beneficiary", sectionTitle: I130_BENEFICIARY_INFO, required: false },

    { path: "petitioner.priorPetitionFiled", label: "Has the Petitioner filed any petition for this or any other relative?", section: "petitioner", sectionTitle: I130_PETITIONER_INFO, type: "radio", options: ["Yes", "No"] },
    { path: "petitioner.priorPetitionDetails", label: "Name, date of filing, and result of the prior petition", section: "petitioner", sectionTitle: I130_PETITIONER_INFO, required: false, condition: { field: "petitioner.priorPetitionFiled", operator: "equals", value: "Yes" } },
  ];
  return entries.map((entry) => ({ ...entry, required: entry.condition ? false : entry.required !== false }));
}

const I130_REPEATABLE_FIELDS = {
  "petitioner.priorSpouses": [
    { key: "name", label: "Name of prior Spouse", type: "text" },
    { key: "dateMarriageEnded", label: "Date Marriage Ended", type: "date" },
  ],
  "petitioner.employmentHistory": [
    { key: "employerNameAddress", label: "Full Name & Address of Employer", type: "text" },
    { key: "occupation", label: "Occupation", type: "text" },
    { key: "from", label: "From (Month/Year)", type: "date" },
    { key: "to", label: "To (Month/Year)", type: "date" },
  ],
  "petitioner.addressHistory": [
    { key: "streetAndNumber", label: "Street and Number", type: "text" },
    { key: "city", label: "City", type: "text" },
    { key: "provinceState", label: "Province/State", type: "text" },
    { key: "country", label: "Country", type: "text" },
    { key: "from", label: "From (Month/Year)", type: "date" },
    { key: "to", label: "To (Month/Year)", type: "date" },
  ],
  "beneficiary.priorSpouses": [
    { key: "name", label: "Name of prior Spouse", type: "text" },
    { key: "dateMarriageEnded", label: "Date Marriage Ended", type: "date" },
  ],
  "beneficiary.familyMembers": [
    { key: "name", label: "Name", type: "text" },
    { key: "relationship", label: "Relationship", type: "text" },
    { key: "dateOfBirth", label: "Date of Birth", type: "date" },
    { key: "countryOfBirth", label: "Country of birth", type: "text" },
  ],
};

// ============================================================
// 2. GREEN CARD CHECKLIST (adjustment of status) — beneficiary-only
// ============================================================

const greenCardDocuments = [
  { name: "6 passport-style photographs (taken within last 30 days)", documentType: "beneficiary_green_card_photos", description: "Natural color, white background, unmounted, glossy, unretouched, 2x2 inches. Lightly print your A# (or name, if none) on the back of each photo.", required: true, category: "identity", targetRole: "beneficiary", status: "requested", hardCopy: true },
  { name: "Foreign Birth Certificate", documentType: "beneficiary_foreign_birth_certificate", required: true, category: "identity", targetRole: "beneficiary", status: "requested" },
  { name: "All Passport pages", documentType: "beneficiary_all_passport_pages", required: true, category: "identity", targetRole: "beneficiary", status: "requested" },
  { name: "Copies of all previously issued I-20, EAD cards, and I-797", documentType: "beneficiary_prior_i20_ead_i797", required: false, category: "immigration", targetRole: "beneficiary", status: "requested" },
  { name: "Marriage certificate", documentType: "beneficiary_marriage_certificate_gc", required: false, category: "immigration", targetRole: "beneficiary", status: "requested" },
  { name: "Marriage termination documents", documentType: "beneficiary_marriage_termination_documents_gc", required: false, category: "immigration", targetRole: "beneficiary", status: "requested" },
  { name: "Copy of I-94 travel document", documentType: "beneficiary_i94_copy", required: true, category: "immigration", targetRole: "beneficiary", status: "requested" },
  { name: "Copy of all approval notices", documentType: "beneficiary_approval_notices", description: "Dependents also.", required: false, category: "immigration", targetRole: "beneficiary", status: "requested" },
  {
    name: "Immigration medical exam record (Form I-693)",
    documentType: "beneficiary_medical_exam_record",
    description: "MANDATORY: the applicant must complete a medical exam with a USCIS Civil Surgeon. Find one at https://www.uscis.gov/tools/find-a-civil-surgeon",
    required: true,
    category: "immigration",
    targetRole: "beneficiary",
    status: "requested",
  },
];

const GREEN_CARD_INFO = "Information About You";
const GREEN_CARD_ARRIVAL = "Information About Your Last Arrival in the USA";
const GREEN_CARD_PARENTS = "Information About Your Parents";
const GREEN_CARD_MARITAL = "Information About Your Marital History";
const GREEN_CARD_CHILDREN = "Information About Your Children";
const GREEN_CARD_PUBLIC_CHARGE = "Public Charge Questionnaire";

function greenCardFieldCatalog() {
  const entries = [
    { path: "beneficiary.gcLastName", label: "Last Name", section: "beneficiary", sectionTitle: GREEN_CARD_INFO },
    { path: "beneficiary.gcFirstName", label: "First Name", section: "beneficiary", sectionTitle: GREEN_CARD_INFO },
    { path: "beneficiary.gcMiddleName", label: "Middle Name", section: "beneficiary", sectionTitle: GREEN_CARD_INFO, required: false },
    { path: "beneficiary.gcOtherNames", label: "Other names (if any)", section: "beneficiary", sectionTitle: GREEN_CARD_INFO, required: false },
    { path: "beneficiary.gcGender", label: "Gender", section: "beneficiary", sectionTitle: GREEN_CARD_INFO },
    { path: "beneficiary.gcDateOfBirth", label: "Date of Birth", section: "beneficiary", sectionTitle: GREEN_CARD_INFO, type: "date" },
    { path: "beneficiary.gcCityStateCountryOfBirth", label: "City, State & Country of Birth", section: "beneficiary", sectionTitle: GREEN_CARD_INFO },
    { path: "beneficiary.gcCountryOfCitizenship", label: "Country of Citizenship", section: "beneficiary", sectionTitle: GREEN_CARD_INFO },
    { path: "beneficiary.gcAlienNumber", label: "A Number", section: "beneficiary", sectionTitle: GREEN_CARD_INFO, required: false },
    { path: "beneficiary.gcSsn", label: "SSN Number", section: "beneficiary", sectionTitle: GREEN_CARD_INFO, required: false },
    { path: "beneficiary.gcUscisOnlineAccountNumber", label: "USCIS Online Account Number", section: "beneficiary", sectionTitle: GREEN_CARD_INFO, required: false },
    { path: "beneficiary.gcMailingAddress", label: "Mailing Address", section: "beneficiary", sectionTitle: GREEN_CARD_INFO },
    { path: "beneficiary.gcMobileNumber", label: "Mobile Number", section: "beneficiary", sectionTitle: GREEN_CARD_INFO, type: "phone" },
    { path: "beneficiary.gcEmail", label: "Email id", section: "beneficiary", sectionTitle: GREEN_CARD_INFO, type: "email" },
    { path: "beneficiary.gcHeight", label: "Height (ft/inches)", section: "beneficiary", sectionTitle: GREEN_CARD_INFO, required: false },
    { path: "beneficiary.gcWeight", label: "Weight (in pounds)", section: "beneficiary", sectionTitle: GREEN_CARD_INFO, required: false },
    { path: "beneficiary.gcEyeColor", label: "Eye Colour", section: "beneficiary", sectionTitle: GREEN_CARD_INFO, required: false },
    { path: "beneficiary.gcHairColor", label: "Hair Colour", section: "beneficiary", sectionTitle: GREEN_CARD_INFO, required: false },

    { path: "beneficiary.gcLastArrivalPassportNumber", label: "Passport Number Used on Last Arrival", section: "beneficiary", sectionTitle: GREEN_CARD_ARRIVAL },
    { path: "beneficiary.gcLastArrivalPassportExpiration", label: "Expiration Date of this Passport", section: "beneficiary", sectionTitle: GREEN_CARD_ARRIVAL, type: "date" },
    { path: "beneficiary.gcLastArrivalPassportCountry", label: "Country that Issued this Passport", section: "beneficiary", sectionTitle: GREEN_CARD_ARRIVAL },
    { path: "beneficiary.gcLastArrivalVisaType", label: "On which VISA arrived (visitor, Student, Work, etc)", section: "beneficiary", sectionTitle: GREEN_CARD_ARRIVAL },
    { path: "beneficiary.gcNonimmigrantVisaNumber", label: "Nonimmigrant Visa Number (red number on your visa stamp)", section: "beneficiary", sectionTitle: GREEN_CARD_ARRIVAL, required: false },
    { path: "beneficiary.gcLastArrivalCityState", label: "City and State of Last Arrival", section: "beneficiary", sectionTitle: GREEN_CARD_ARRIVAL },
    { path: "beneficiary.gcLastArrivalDate", label: "Date of Last Arrival", section: "beneficiary", sectionTitle: GREEN_CARD_ARRIVAL, type: "date" },
    { path: "beneficiary.gcI94Number", label: "I-94 Number", section: "beneficiary", sectionTitle: GREEN_CARD_ARRIVAL },
    { path: "beneficiary.gcI94Expiry", label: "Expiry date of I-94", section: "beneficiary", sectionTitle: GREEN_CARD_ARRIVAL, type: "date" },
    { path: "beneficiary.gcNameOnI94", label: "Your name as it appears on I-94", section: "beneficiary", sectionTitle: GREEN_CARD_ARRIVAL },
    { path: "beneficiary.gcCurrentUscisStatus", label: "Current USCIS status", section: "beneficiary", sectionTitle: GREEN_CARD_ARRIVAL },
    { path: "beneficiary.gcEverAppliedImmigrantVisaAbroad", label: "Have you ever applied for an immigrant visa at a U.S. Embassy or Consulate abroad?", section: "beneficiary", sectionTitle: GREEN_CARD_ARRIVAL, type: "radio", options: ["Yes", "No"] },
    { path: "beneficiary.gcEmbassyLocation", label: "Location of U.S. Embassy or Consulate (City & Country)", section: "beneficiary", sectionTitle: GREEN_CARD_ARRIVAL, required: false, condition: { field: "beneficiary.gcEverAppliedImmigrantVisaAbroad", operator: "equals", value: "Yes" } },
    { path: "beneficiary.gcEmbassyDecision", label: "Decision (Approved, Denied, Withdrawn)", section: "beneficiary", sectionTitle: GREEN_CARD_ARRIVAL, required: false, condition: { field: "beneficiary.gcEverAppliedImmigrantVisaAbroad", operator: "equals", value: "Yes" } },
    { path: "beneficiary.gcEmbassyDecisionDate", label: "Date of Decision", section: "beneficiary", sectionTitle: GREEN_CARD_ARRIVAL, required: false, type: "date", condition: { field: "beneficiary.gcEverAppliedImmigrantVisaAbroad", operator: "equals", value: "Yes" } },

    { path: "beneficiary.gcResidentialHistory", label: "Residential History (last 5 years)", section: "beneficiary", sectionTitle: GREEN_CARD_INFO, repeatable: true },
    { path: "beneficiary.gcLastAddressOutsideUSA", label: "Last address outside the USA where you lived for more than 1 year", section: "beneficiary", sectionTitle: GREEN_CARD_INFO, required: false },
    { path: "beneficiary.gcEmploymentHistory", label: "Employment History (last 5 years)", section: "beneficiary", sectionTitle: GREEN_CARD_INFO, repeatable: true },
    { path: "beneficiary.gcLastEmploymentOutsideUSA", label: "Last employment outside USA", section: "beneficiary", sectionTitle: GREEN_CARD_INFO, required: false },

    { path: "beneficiary.gcFatherLastName", label: "Father's Last Name", section: "beneficiary", sectionTitle: GREEN_CARD_PARENTS },
    { path: "beneficiary.gcFatherFirstName", label: "Father's First Name", section: "beneficiary", sectionTitle: GREEN_CARD_PARENTS },
    { path: "beneficiary.gcFatherMiddleName", label: "Father's Middle Name", section: "beneficiary", sectionTitle: GREEN_CARD_PARENTS, required: false },
    { path: "beneficiary.gcFatherDateOfBirth", label: "Father's Date of Birth", section: "beneficiary", sectionTitle: GREEN_CARD_PARENTS, type: "date" },
    { path: "beneficiary.gcFatherCityOfBirth", label: "Father's City or Town of Birth", section: "beneficiary", sectionTitle: GREEN_CARD_PARENTS },
    { path: "beneficiary.gcFatherCountryOfBirth", label: "Father's Country of Birth", section: "beneficiary", sectionTitle: GREEN_CARD_PARENTS },
    { path: "beneficiary.gcFatherCurrentCity", label: "Father's Current City or Town of Residence", section: "beneficiary", sectionTitle: GREEN_CARD_PARENTS, required: false },
    { path: "beneficiary.gcFatherCurrentCountry", label: "Father's Current Country of Residence", section: "beneficiary", sectionTitle: GREEN_CARD_PARENTS, required: false },
    { path: "beneficiary.gcMotherLastName", label: "Mother's Last Name", section: "beneficiary", sectionTitle: GREEN_CARD_PARENTS },
    { path: "beneficiary.gcMotherFirstName", label: "Mother's First Name", section: "beneficiary", sectionTitle: GREEN_CARD_PARENTS },
    { path: "beneficiary.gcMotherMiddleName", label: "Mother's Middle Name", section: "beneficiary", sectionTitle: GREEN_CARD_PARENTS, required: false },
    { path: "beneficiary.gcMotherDateOfBirth", label: "Mother's Date of Birth", section: "beneficiary", sectionTitle: GREEN_CARD_PARENTS, type: "date" },
    { path: "beneficiary.gcMotherCityOfBirth", label: "Mother's City or Town of Birth", section: "beneficiary", sectionTitle: GREEN_CARD_PARENTS },
    { path: "beneficiary.gcMotherCountryOfBirth", label: "Mother's Country of Birth", section: "beneficiary", sectionTitle: GREEN_CARD_PARENTS },
    { path: "beneficiary.gcMotherCurrentCity", label: "Mother's Current City or Town of Residence", section: "beneficiary", sectionTitle: GREEN_CARD_PARENTS, required: false },
    { path: "beneficiary.gcMotherCurrentCountry", label: "Mother's Current Country of Residence", section: "beneficiary", sectionTitle: GREEN_CARD_PARENTS, required: false },

    { path: "beneficiary.gcCurrentMaritalStatus", label: "Current marital status", section: "beneficiary", sectionTitle: GREEN_CARD_MARITAL, type: "select", options: ["Single", "Married", "Divorced", "Widowed", "Annulled", "Separated"] },
    { path: "beneficiary.gcSpouseInArmedForces", label: "Is your spouse a current member of the U.S. armed forces or Coast Guard?", section: "beneficiary", sectionTitle: GREEN_CARD_MARITAL, type: "radio", options: ["Yes", "No"], required: false },
    { path: "beneficiary.gcNumberOfMarriages", label: "How many times have you been married (incl. annulled and marriages to the same person)?", section: "beneficiary", sectionTitle: GREEN_CARD_MARITAL, type: "number" },
    { path: "beneficiary.gcCurrentSpouseLastName", label: "Current Spouse — Last Name", section: "beneficiary", sectionTitle: GREEN_CARD_MARITAL, required: false },
    { path: "beneficiary.gcCurrentSpouseFirstName", label: "Current Spouse — First Name", section: "beneficiary", sectionTitle: GREEN_CARD_MARITAL, required: false },
    { path: "beneficiary.gcCurrentSpouseMiddleName", label: "Current Spouse — Middle Name", section: "beneficiary", sectionTitle: GREEN_CARD_MARITAL, required: false },
    { path: "beneficiary.gcCurrentSpouseDateOfBirth", label: "Current Spouse — Date of Birth", section: "beneficiary", sectionTitle: GREEN_CARD_MARITAL, required: false, type: "date" },
    { path: "beneficiary.gcCurrentSpouseAlienNumber", label: "Current Spouse — A Number", section: "beneficiary", sectionTitle: GREEN_CARD_MARITAL, required: false },
    { path: "beneficiary.gcCurrentSpouseCityStateCountryOfBirth", label: "Current Spouse — City, State & Country of Birth", section: "beneficiary", sectionTitle: GREEN_CARD_MARITAL, required: false },
    { path: "beneficiary.gcCurrentSpouseCityStateCountryOfMarriage", label: "City, State & Country of Marriage", section: "beneficiary", sectionTitle: GREEN_CARD_MARITAL, required: false },
    { path: "beneficiary.gcCurrentSpouseMarriageDate", label: "Date of Marriage", section: "beneficiary", sectionTitle: GREEN_CARD_MARITAL, required: false, type: "date" },
    { path: "beneficiary.gcCurrentSpouseApplyingWithYou", label: "Is your spouse applying with you?", section: "beneficiary", sectionTitle: GREEN_CARD_MARITAL, required: false, type: "radio", options: ["Yes", "No"] },
    { path: "beneficiary.gcPriorSpouses", label: "Prior Spouse(s)", section: "beneficiary", sectionTitle: GREEN_CARD_MARITAL, required: false, repeatable: true },

    { path: "beneficiary.gcChildren", label: "Children", section: "beneficiary", sectionTitle: GREEN_CARD_CHILDREN, required: false, repeatable: true },

    { path: "beneficiary.gcHouseholdSize", label: "Size of your US household", section: "beneficiary", sectionTitle: GREEN_CARD_PUBLIC_CHARGE, type: "number" },
    { path: "beneficiary.gcAnnualHouseholdIncome", label: "Annual household income", section: "beneficiary", sectionTitle: GREEN_CARD_PUBLIC_CHARGE, type: "select", options: ["$0-27,000", "$27,001-52,000", "$52,001-85,000", "$85,001-141,000", "Over $141,000"] },
    { path: "beneficiary.gcHouseholdAssetsValue", label: "Total value of household assets", section: "beneficiary", sectionTitle: GREEN_CARD_PUBLIC_CHARGE, type: "select", options: ["$0-18,400", "$18,401-136,000", "$136,001-321,400", "$321,401-707,100", "Over $707,100"] },
    { path: "beneficiary.gcHouseholdLiabilitiesValue", label: "Total value of household liabilities (secured and unsecured)", section: "beneficiary", sectionTitle: GREEN_CARD_PUBLIC_CHARGE, type: "select", options: ["$0", "$1-10,100", "$10,101-57,700", "$57,701-186,800", "Over $186,800"] },
    { path: "beneficiary.gcHighestEducationLevel", label: "Highest degree or level of school completed", section: "beneficiary", sectionTitle: GREEN_CARD_PUBLIC_CHARGE },
    { path: "beneficiary.gcCertificationsSkills", label: "Certifications, licenses, skills obtained through work experience, and educational certificates", section: "beneficiary", sectionTitle: GREEN_CARD_PUBLIC_CHARGE, required: false },
    { path: "beneficiary.gcReceivedPublicBenefits", label: "Have you ever received SSI, TANF, or State/Tribal/territorial/local cash benefit programs for income maintenance?", section: "beneficiary", sectionTitle: GREEN_CARD_PUBLIC_CHARGE, type: "radio", options: ["Yes", "No"] },
    { path: "beneficiary.gcPublicBenefitsReceived", label: "Benefits Received (benefit, start date, end date, dollar amount)", section: "beneficiary", sectionTitle: GREEN_CARD_PUBLIC_CHARGE, required: false, repeatable: true, condition: { field: "beneficiary.gcReceivedPublicBenefits", operator: "equals", value: "Yes" } },
    { path: "beneficiary.gcReceivedInstitutionalization", label: "Have you ever received long-term institutionalization at government expense?", section: "beneficiary", sectionTitle: GREEN_CARD_PUBLIC_CHARGE, type: "radio", options: ["Yes", "No"] },
    { path: "beneficiary.gcInstitutionalizationDetails", label: "Institution Name/City/State, Date From, Date To, Reason", section: "beneficiary", sectionTitle: GREEN_CARD_PUBLIC_CHARGE, required: false, repeatable: true, condition: { field: "beneficiary.gcReceivedInstitutionalization", operator: "equals", value: "Yes" } },
  ];
  return entries.map((entry) => ({ ...entry, required: entry.condition ? false : entry.required !== false }));
}

const GREEN_CARD_REPEATABLE_FIELDS = {
  "beneficiary.gcResidentialHistory": [
    { key: "streetAndNumber", label: "Street and Number", type: "text" },
    { key: "city", label: "City", type: "text" },
    { key: "provinceState", label: "Province/State", type: "text" },
    { key: "country", label: "Country", type: "text" },
    { key: "from", label: "From (Month/Year)", type: "date" },
    { key: "to", label: "To (Month/Year)", type: "date" },
  ],
  "beneficiary.gcEmploymentHistory": [
    { key: "employerName", label: "Full Name of Employer", type: "text" },
    { key: "employerAddress", label: "Full Address of Employer", type: "text" },
    { key: "occupation", label: "Occupation", type: "text" },
    { key: "from", label: "From (Month/Year)", type: "date" },
    { key: "to", label: "To (Month/Year)", type: "date" },
  ],
  "beneficiary.gcPriorSpouses": [
    { key: "fullName", label: "Full Name", type: "text" },
    { key: "dateOfBirth", label: "Date of Birth", type: "date" },
    { key: "dateOfMarriage", label: "Date of Marriage", type: "date" },
    { key: "cityStateCountryOfMarriage", label: "City, State & Country of Marriage", type: "text" },
    { key: "dateMarriageEnded", label: "Date Marriage Legally Ended", type: "date" },
    { key: "cityStateCountryMarriageEnded", label: "City, State & Country where Marriage Ended", type: "text" },
  ],
  "beneficiary.gcChildren": [
    { key: "fullName", label: "Full Name", type: "text" },
    { key: "dateOfBirth", label: "Date of Birth", type: "date" },
    { key: "alienNumber", label: "A Number (if any)", type: "text" },
    { key: "countryOfBirth", label: "Country of Birth", type: "text" },
    { key: "applyingWithYou", label: "Is the child applying with you?", type: "radio" },
  ],
  "beneficiary.gcPublicBenefitsReceived": [
    { key: "benefit", label: "Benefit Received", type: "text" },
    { key: "startDate", label: "Start Date", type: "date" },
    { key: "endDate", label: "End Date", type: "date" },
    { key: "dollarAmount", label: "Dollar Amount", type: "currency" },
  ],
  "beneficiary.gcInstitutionalizationDetails": [
    { key: "institutionNameCityState", label: "Institution Name/City/State", type: "text" },
    { key: "dateFrom", label: "Date From", type: "date" },
    { key: "dateTo", label: "Date To", type: "date" },
    { key: "reason", label: "Reason", type: "text" },
  ],
};

// ============================================================
// 3. FORM I-864 — "Sponsor/Petitioner & Beneficiary Checklist for I-864"
// ============================================================
// Sponsor defaults to the petitioner (targetRole "petitioner") — no
// duplicate person is created; see familyChecklists.js. jointSponsor*
// covers the distinct third-party co-sponsor case.

const i864SponsorDocuments = [
  { name: "Copy of proof of US Status", documentType: "sponsor_proof_of_us_status", description: "Naturalization certificate, birth certificate, or green card.", required: true, category: "immigration", targetRole: "petitioner", status: "requested" },
  { name: "Copy of Passport", documentType: "sponsor_passport_copy", description: "Blank pages are not required.", required: true, category: "identity", targetRole: "petitioner", status: "requested" },
  { name: "Copy of Driver's license and SSN", documentType: "sponsor_drivers_license_and_ssn", required: true, category: "identity", targetRole: "petitioner", status: "requested" },
  { name: "Copy of Evidence of Income", documentType: "sponsor_evidence_of_income", description: "Paystubs, W2 forms, 1099, etc.", required: true, category: "financial", targetRole: "petitioner", status: "requested" },
  { name: "Copy of latest Bank Statements", documentType: "sponsor_bank_statements", description: "Last 3 months.", required: true, category: "financial", targetRole: "petitioner", status: "requested" },
  { name: "Copy of recent 3 years Federal Tax Returns", documentType: "sponsor_federal_tax_returns", required: true, category: "financial", targetRole: "petitioner", status: "requested" },
];

const I864_SPONSOR_INFO = "Information about Sponsor/Petitioner";

function i864FieldCatalog() {
  const entries = [
    { path: "petitioner.i864LastName", label: "Last Name or Surname as per passport", section: "petitioner", sectionTitle: I864_SPONSOR_INFO },
    { path: "petitioner.i864FirstName", label: "First Name or Given name as per passport", section: "petitioner", sectionTitle: I864_SPONSOR_INFO },
    { path: "petitioner.i864MailingAddress", label: "Sponsor's Mailing Address", section: "petitioner", sectionTitle: I864_SPONSOR_INFO },
    { path: "petitioner.i864PhysicalAddress", label: "Sponsor's Physical Address", section: "petitioner", sectionTitle: I864_SPONSOR_INFO },
    { path: "petitioner.i864DateOfBirth", label: "Date of Birth", section: "petitioner", sectionTitle: I864_SPONSOR_INFO, type: "date" },
    { path: "petitioner.i864CountryOfBirth", label: "Country of Birth", section: "petitioner", sectionTitle: I864_SPONSOR_INFO },
    { path: "petitioner.i864Ssn", label: "U.S. Social Security Number", section: "petitioner", sectionTitle: I864_SPONSOR_INFO },
    { path: "petitioner.i864AlienNumber", label: "Sponsor's Alien Registration Number", section: "petitioner", sectionTitle: I864_SPONSOR_INFO, required: false },
    { path: "petitioner.i864ImmigrationStatus", label: "Sponsor's immigration status", section: "petitioner", sectionTitle: I864_SPONSOR_INFO, type: "radio", options: ["Green Card / LPR", "U.S. Citizen"] },
    { path: "petitioner.i864MaritalStatus", label: "Sponsor's marital status", section: "petitioner", sectionTitle: I864_SPONSOR_INFO },
    { path: "petitioner.i864NumberOfDependentKids", label: "No. of dependent kids", section: "petitioner", sectionTitle: I864_SPONSOR_INFO, type: "number" },
    { path: "petitioner.i864NumberOfOtherDependents", label: "No. of other dependents", section: "petitioner", sectionTitle: I864_SPONSOR_INFO, type: "number" },

    { path: "petitioner.i864OccupationTitle", label: "Sponsor's current occupation title", section: "petitioner", sectionTitle: I864_SPONSOR_INFO },
    { path: "petitioner.i864Employer1", label: "Name of Employer 1", section: "petitioner", sectionTitle: I864_SPONSOR_INFO, required: false },
    { path: "petitioner.i864Employer2", label: "Name of Employer 2", section: "petitioner", sectionTitle: I864_SPONSOR_INFO, required: false },
    { path: "petitioner.i864Employer3", label: "Name of Employer 3", section: "petitioner", sectionTitle: I864_SPONSOR_INFO, required: false },
    { path: "petitioner.i864SelfEmployedTitle", label: "If Self Employed, title of the occupation", section: "petitioner", sectionTitle: I864_SPONSOR_INFO, required: false },

    { path: "petitioner.i864CurrentIncome", label: "Current Income", section: "petitioner", sectionTitle: I864_SPONSOR_INFO, type: "currency" },
    { path: "petitioner.i864TaxYear1Income", label: "Most recent Tax year total income", section: "petitioner", sectionTitle: I864_SPONSOR_INFO, type: "currency" },
    { path: "petitioner.i864TaxYear2Income", label: "2nd Most recent Tax year total income", section: "petitioner", sectionTitle: I864_SPONSOR_INFO, type: "currency" },
    { path: "petitioner.i864TaxYear3Income", label: "3rd Most recent Tax year total income", section: "petitioner", sectionTitle: I864_SPONSOR_INFO, type: "currency" },
    { path: "petitioner.i864SavingsAndCheckingBalance", label: "Balance of all savings and checking accounts", section: "petitioner", sectionTitle: I864_SPONSOR_INFO, required: false, type: "currency", description: "Other assets you want to include as income (optional — if it is mandatory, we will ask you)." },
    { path: "petitioner.i864RealEstateNetCashValue", label: "Net cash value of real-estate holdings", section: "petitioner", sectionTitle: I864_SPONSOR_INFO, required: false, type: "currency" },
    { path: "petitioner.i864StocksBondsNetCashValue", label: "Net cash value of all stocks, bonds, certificates of deposit", section: "petitioner", sectionTitle: I864_SPONSOR_INFO, required: false, type: "currency" },

    { path: "petitioner.i864HouseholdMemberFullName", label: "Household member's Full Name", section: "petitioner", sectionTitle: I864_SPONSOR_INFO, required: false, description: "Income from any other person counted in your household (if any)." },
    { path: "petitioner.i864HouseholdMemberRelation", label: "Household member's Relation", section: "petitioner", sectionTitle: I864_SPONSOR_INFO, required: false },
    { path: "petitioner.i864HouseholdMemberIncome", label: "Household member's Current Income", section: "petitioner", sectionTitle: I864_SPONSOR_INFO, required: false, type: "currency" },
  ];
  return entries.map((entry) => ({ ...entry, required: entry.condition ? false : entry.required !== false }));
}

// I-864 co-sponsorship — collected only when the sponsor (petitioner) alone
// doesn't meet the income threshold and a distinct joint sponsor is added
// to the case (beneficiary.hasJointSponsor === "yes", asked on the Green
// Card checklist's marital/household section in the client UI). Same
// underlying I-864 questions as the sponsor's own, attributed to a
// different participant — see Case.jointSponsorUser.
const jointSponsorDocuments = [
  { name: "Proof of joint sponsor's U.S. citizenship or lawful permanent resident status", documentType: "joint_sponsor_citizenship_or_lpr_status", required: true, category: "immigration", targetRole: "joint_sponsor", status: "requested" },
  { name: "Joint sponsor's Affidavit of Support (Form I-864)", documentType: "joint_sponsor_i864", required: true, category: "immigration", targetRole: "joint_sponsor", status: "requested" },
  { name: "Joint sponsor's federal tax returns for the last 3 years", documentType: "joint_sponsor_tax_returns", required: true, category: "financial", targetRole: "joint_sponsor", status: "requested" },
  { name: "Joint sponsor's most recent W-2s / 1099s", documentType: "joint_sponsor_w2_1099", required: true, category: "financial", targetRole: "joint_sponsor", status: "requested" },
  { name: "Joint sponsor's employment verification letter or recent pay stubs", documentType: "joint_sponsor_employment_verification", required: false, category: "financial", targetRole: "joint_sponsor", status: "requested" },
];

const I864_JOINT_SPONSOR_INFO = "Information about Joint Sponsor";

function jointSponsorFieldCatalog() {
  const entries = [
    { path: "jointSponsor.lastName", label: "Last Name or Surname as per passport", section: "joint_sponsor", sectionTitle: I864_JOINT_SPONSOR_INFO },
    { path: "jointSponsor.firstName", label: "First Name or Given name as per passport", section: "joint_sponsor", sectionTitle: I864_JOINT_SPONSOR_INFO },
    { path: "jointSponsor.relationshipToPetitioner", label: "Joint Sponsor's Relationship to Petitioner", section: "joint_sponsor", sectionTitle: I864_JOINT_SPONSOR_INFO },
    { path: "jointSponsor.mailingAddress", label: "Mailing Address", section: "joint_sponsor", sectionTitle: I864_JOINT_SPONSOR_INFO },
    { path: "jointSponsor.dateOfBirth", label: "Date of Birth", section: "joint_sponsor", sectionTitle: I864_JOINT_SPONSOR_INFO, type: "date" },
    { path: "jointSponsor.ssn", label: "U.S. Social Security Number", section: "joint_sponsor", sectionTitle: I864_JOINT_SPONSOR_INFO },
    { path: "jointSponsor.immigrationStatus", label: "Immigration status", section: "joint_sponsor", sectionTitle: I864_JOINT_SPONSOR_INFO, type: "radio", options: ["Green Card / LPR", "U.S. Citizen"] },
    { path: "jointSponsor.currentIncome", label: "Current Income", section: "joint_sponsor", sectionTitle: I864_JOINT_SPONSOR_INFO, type: "currency" },
    { path: "jointSponsor.taxYear1Income", label: "Most recent Tax year total income", section: "joint_sponsor", sectionTitle: I864_JOINT_SPONSOR_INFO, type: "currency" },
    { path: "jointSponsor.taxYear2Income", label: "2nd Most recent Tax year total income", section: "joint_sponsor", sectionTitle: I864_JOINT_SPONSOR_INFO, type: "currency" },
    { path: "jointSponsor.taxYear3Income", label: "3rd Most recent Tax year total income", section: "joint_sponsor", sectionTitle: I864_JOINT_SPONSOR_INFO, type: "currency" },
  ];
  return entries.map((entry) => ({ ...entry, required: entry.condition ? false : entry.required !== false }));
}

const I864_REPEATABLE_FIELDS = {};

// ============================================================
// Definition objects — shaped for familyChecklists.js's existing
// buildFamilyPetitionerChecklist/buildFamilyBeneficiaryChecklist/
// buildFamilyJointSponsorChecklist (unchanged) to consume.
// ============================================================

const i130 = {
  key: "i130",
  petitionerDocuments: i130PetitionerDocuments,
  beneficiaryDocuments: i130BeneficiaryDocuments,
  fieldCatalog: i130FieldCatalog,
  REPEATABLE_FIELDS: I130_REPEATABLE_FIELDS,
};

const greenCard = {
  key: "green_card",
  // Beneficiary-only per the source document - no petitioner section.
  petitionerDocuments: [],
  beneficiaryDocuments: greenCardDocuments,
  fieldCatalog: greenCardFieldCatalog,
  REPEATABLE_FIELDS: GREEN_CARD_REPEATABLE_FIELDS,
};

const i864 = {
  key: "i864",
  // "petitioner" here IS the sponsor by default - see familyChecklists.js.
  petitionerDocuments: i864SponsorDocuments,
  beneficiaryDocuments: [],
  jointSponsorDocuments,
  fieldCatalog: () => [...i864FieldCatalog(), ...jointSponsorFieldCatalog()],
  REPEATABLE_FIELDS: I864_REPEATABLE_FIELDS,
};

module.exports = { key, matches, i130, greenCard, i864 };
