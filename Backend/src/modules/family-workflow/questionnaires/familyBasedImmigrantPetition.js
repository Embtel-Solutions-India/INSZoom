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
//   4. "Checklist for DS-260" (Green Card via the National Visa Center /
//      consular processing) -> gcNvc export: beneficiary-only. A SEPARATE
//      document from the Green Card (AOS) checklist above, not a rename of
//      it - materially different document list and questionnaire content
//      (see its own section below). Never auto-assigned; offered only for
//      CONSULAR-path cases and requires explicit Case Manager approval
//      (family-workflow.controller.js's approveGcNvcChecklist).
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
// 4. GC-NVC — "Checklist for DS-260" (Green Card via the National Visa
//    Center / consular processing) — beneficiary-only, same shape as the
//    Green Card (AOS) checklist above but a SEPARATE, materially different
//    business document: no I-20/EAD/I-797 or medical-exam document, but a
//    dedicated police-verification-letter document, and a much larger
//    DS-260-specific questionnaire (address/contact/travel/employment
//    history, the full DOS "security and background" question set, SSN
//    election, and the petitioner-info restatement DS-260 itself asks for).
//    This is NOT a rename/replacement of the AOS Green Card checklist —
//    both exist side by side; see familyChecklists.js for how/when each is
//    assigned (AOS gets green_card_*, CONSULAR additionally OFFERS this one,
//    gated on explicit Case Manager approval — never auto-assigned).
// ============================================================

const gcNvcDocuments = [
  { name: "2x2 Passport Size photo", documentType: "gc_nvc_passport_photo", required: true, category: "identity", targetRole: "beneficiary", status: "requested" },
  { name: "Biographic page of passport", documentType: "gc_nvc_passport_biographic_page", required: true, category: "identity", targetRole: "beneficiary", status: "requested" },
  { name: "Birth certificate", documentType: "gc_nvc_birth_certificate", required: true, category: "identity", targetRole: "beneficiary", status: "requested" },
  { name: "Marriage certificate", documentType: "gc_nvc_marriage_certificate", required: false, category: "immigration", targetRole: "beneficiary", status: "requested" },
  { name: "Marriage termination documents (such as divorce decree, death certificate), if applicable", documentType: "gc_nvc_marriage_termination_documents", required: false, category: "immigration", targetRole: "beneficiary", status: "requested" },
  { name: "Police verification letter", documentType: "gc_nvc_police_verification_letter", required: true, category: "immigration", targetRole: "beneficiary", status: "requested" },
];

const GC_NVC_PERSONAL = "Part 1: Personal Information";
const GC_NVC_ADDRESS = "Part 2: Address History Information";
const GC_NVC_CONTACT = "Part 3: Contact History";
const GC_NVC_PARENTS = "Part 4: Family Information — Parents";
const GC_NVC_SPOUSE = "Part 5: Spouse Information";
const GC_NVC_CHILDREN = "Part 6: Children Information";
const GC_NVC_TRAVEL = "Part 7: Previous U.S. Travel Information";
const GC_NVC_EMPLOYMENT = "Part 8: Applicant's Employment Information";
const GC_NVC_EDUCATION = "Part 9: Applicant's Educational Information";
const GC_NVC_ADDITIONAL = "Part 10: Additional Information";
const GC_NVC_SECURITY = "Part 11: Security and Background Information";
const GC_NVC_SSN = "Part 12: Social Security Number Information";
const GC_NVC_PETITIONER = "Part 13: Petitioner Information";

// Part 11 - the DOS security/background question set (53 yes/no questions,
// verbatim, in source order). The source gates one shared "explain below"
// textarea on "if you answer yes to ANY of the above" - the existing
// conditionalLogicFromEntry() only evaluates rules against fields already
// converted to questions, and a 53-way "any" trigger would be unusually
// heavy for this engine's simple visibility check, so that instruction is
// preserved as the explanation field's own description text (always
// visible/optional) rather than a 53-rule conditional - no question content
// is invented or dropped, only how its trigger is expressed.
const GC_NVC_SECURITY_QUESTIONS = [
  "Do you have a communicable disease of public health significance such as tuberculosis (TB)?",
  "Do you have documentation to establish that you have received vaccinations in accordance with U.S. law?",
  "Do you have a mental or physical disorder that poses or is likely to pose a threat to the safety or welfare of yourself or others?",
  "Are you or have you ever been a drug abuser or addict?",
  "Have you ever been arrested or convicted for any offense or crime, even though subject or a pardon, amnesty, or other similar action?",
  "Have you ever violated, or engaged in a conspiracy to violate, any law relating to controlled substances?",
  "Are you the spouse, son, or daughter of an individual who has violated any controlled substance trafficking law, and have knowingly benefited from the trafficking activities in the past five years?",
  "Are you coming to the United States to engage in prostitution or unlawful commercialized vice or have you been engaged in prostitution or procuring prostitutes within the past 10 years?",
  "Have you ever been involved in, or do you seek to engage in, money laundering?",
  "Have you ever committed or conspired to commit a human trafficking offense in the United States or outside the United States?",
  "Have you ever knowingly aided, abetted, assisted, or colluded with an individual who has been identified by the President of the United States as a person who plays a significant role in a severe form of trafficking in persons?",
  "Are you the spouse, son, or daughter of an individual who has committed or conspired to commit a human trafficking offense in the United States or outside the United States and have you within the last five years, knowingly benefited from the trafficking activities?",
  "Do you seek to engage in espionage, sabotage, export control violations, or any other illegal activity while in the United States?",
  "Do you seek to engage in terrorist activities while in the United States or have you ever engaged in terrorist activities?",
  "Have you ever or do you intend to provide financial assistance or other support to terrorists or terrorist organizations?",
  "Are you a member or representative of a terrorist organization?",
  "Have you ever ordered, incited, committed, assisted, or otherwise participated in genocide?",
  "Have you ever committed, ordered, incited, assisted, or otherwise participated in torture?",
  "Have you committed, ordered, incited, assisted, or otherwise participated in extrajudicial killings, political killings, or other acts of violence?",
  "Have you ever engaged in the recruitment of or the use of child soldiers?",
  "Have you, while serving as a government official, been responsible for or directly carried out, at any time, particularly severe violations of religious freedom?",
  "Are you a member of or affiliated with the Communist or other totalitarian party?",
  "Have you ever directly or indirectly assisted or supported any of the groups in Columbia known as the Revolutionary Armed Forces of Columbia (FARC), National Liberation Army (ELN), or United Self-Defense Forces of Columbia (AUC)?",
  "Have you ever, through abuse of governmental or political position converted for personal gain, confiscated or expropriated property in a foreign nation to which a United States national had claim of ownership?",
  "Are you the spouse, minor child, or agent of an individual who has through abuse of governmental or political position converted for personal gain, confiscated or expropriated property in a foreign nation to which a United States national had claim of ownership?",
  "Have you ever been directly involved in the establishment or enforcement of population controls forcing a woman to undergo an abortion against her free choice or a man or a woman to undergo sterilization against his or her free choice?",
  "Have you ever disclosed or trafficked in confidential U.S. business information obtained in connection with U.S. participation in the Chemical Weapons Convention?",
  "Are you the spouse, minor child, or agent of an individual who has disclosed or trafficked in confidential U.S. business information obtained in connection with U.S. participation in the Chemical Weapons Convention?",
  "Have you ever sought to obtain or assist others to obtain a visa, entry into the United States, or any other United States immigration benefit by fraud or willful misrepresentation or other unlawful means?",
  "Have you ever been the subject of a removal or deportation hearing?",
  "Have you failed to attend a hearing on removability or inadmissibility within the last five years?",
  "Have you ever been unlawfully present, overstayed the amount of time granted by an immigration official or otherwise violated the terms of a U.S. visa?",
  "Are you subject to a civil penalty under INA 274C?",
  "Have you been ordered removed from the U.S. during the last five years?",
  "Have you been ordered removed from the U.S. for a second time within the last 20 years?",
  "Have you ever been unlawfully present and ordered removed from the U.S. during the last ten years?",
  "Have you ever been convicted of an aggravated felony and been ordered removed from the U.S.?",
  "Have you ever been unlawfully present in the U.S. for more than 180 days (but no more than one year) and have voluntarily departed the U.S. within the last three years?",
  "Have you ever been unlawfully present in the U.S. for more than one year or more than one year in the aggregate at any time during the last 10 years?",
  "Have you ever withheld custody of a U.S. citizen child outside the United States from a person granted legal custody by a U.S. court?",
  "Have you ever intentionally assisted another person in withholding custody of a U.S. citizen child outside the United States from a person granted legal custody by a U.S. court?",
  "Have you voted in the United States in violation of any law or regulation?",
  "Have you ever renounced United States citizenship for the purpose of avoiding taxation?",
  "Have you attended a public elementary school or a public secondary school on student (F) status after November 30, 1996 without reimbursing the school?",
  "Do you seek to enter the United States for the purpose of performing skilled or unskilled labor but have not yet been certified by the Secretary of Labor?",
  "Are you a graduate of a foreign medical school seeking to perform medical services in the United States but have not yet passed the National Board of Medical Examiners examination or its equivalent?",
  "Are you a health care worker seeking to perform such work in the United States but have not yet received certification from the Commission on Graduates of Foreign Nursing Schools or from an equivalent approved independent credentialing organization?",
  "Are you permanently ineligible for U.S. citizenship?",
  "Have you ever departed the United States in order to evade military service during a time of war?",
  "Are you coming to the U.S. to practice polygamy?",
  "Are you a former exchange visitor (J) who has not yet fulfilled the two-year foreign residence requirement?",
  "Has the Secretary of Homeland Security of the United States ever determined that you knowingly made a frivolous application for asylum?",
  "Are you likely to become a public charge after you are admitted to the United States?",
];

function gcNvcSecurityQuestionEntries() {
  return GC_NVC_SECURITY_QUESTIONS.map((label, index) => ({
    path: `beneficiary.dsSecurityQ${index + 1}`,
    label,
    section: "beneficiary",
    sectionTitle: GC_NVC_SECURITY,
    type: "radio",
    options: ["Yes", "No"],
  }));
}

function gcNvcFieldCatalog() {
  const entries = [
    // Part 1
    { path: "beneficiary.dsFirstName", label: "First Name as per passport", section: "beneficiary", sectionTitle: GC_NVC_PERSONAL },
    { path: "beneficiary.dsLastName", label: "Last Name as per passport", section: "beneficiary", sectionTitle: GC_NVC_PERSONAL },
    { path: "beneficiary.dsOtherNames", label: "Other Names used (if any)", section: "beneficiary", sectionTitle: GC_NVC_PERSONAL, required: false },
    { path: "beneficiary.dsSex", label: "Sex", section: "beneficiary", sectionTitle: GC_NVC_PERSONAL, type: "select", options: ["Male", "Female"] },
    { path: "beneficiary.dsDateOfBirth", label: "Date of Birth", section: "beneficiary", sectionTitle: GC_NVC_PERSONAL, type: "date" },
    { path: "beneficiary.dsMaritalStatus", label: "Current Marital Status", section: "beneficiary", sectionTitle: GC_NVC_PERSONAL, type: "select", options: ["Single", "Married", "Divorced", "Widowed", "Annulled", "Separated"] },
    { path: "beneficiary.dsCityOfBirth", label: "City of Birth", section: "beneficiary", sectionTitle: GC_NVC_PERSONAL },
    { path: "beneficiary.dsStateOfBirth", label: "State/Province of Birth", section: "beneficiary", sectionTitle: GC_NVC_PERSONAL, required: false },
    { path: "beneficiary.dsCountryOfBirth", label: "Country of Birth", section: "beneficiary", sectionTitle: GC_NVC_PERSONAL },
    { path: "beneficiary.dsCountryOfCitizenship", label: "Country of Citizenship", section: "beneficiary", sectionTitle: GC_NVC_PERSONAL },
    { path: "beneficiary.dsHasOtherNationality", label: "Do you hold or have you held any nationality other than the one you have indicated above?", section: "beneficiary", sectionTitle: GC_NVC_PERSONAL, type: "radio", options: ["Yes", "No"] },
    { path: "beneficiary.dsOtherNationalityDetails", label: "Country Name and Passport Number (other nationality)", section: "beneficiary", sectionTitle: GC_NVC_PERSONAL, required: false, condition: { field: "beneficiary.dsHasOtherNationality", operator: "equals", value: "Yes" } },
    { path: "beneficiary.dsPassportNumber", label: "Current Passport Number", section: "beneficiary", sectionTitle: GC_NVC_PERSONAL },
    { path: "beneficiary.dsPassportIssuanceDate", label: "Passport Issuance Date", section: "beneficiary", sectionTitle: GC_NVC_PERSONAL, type: "date" },
    { path: "beneficiary.dsPassportExpiryDate", label: "Passport Expiry Date", section: "beneficiary", sectionTitle: GC_NVC_PERSONAL, type: "date" },
    { path: "beneficiary.dsPassportIssuingCountry", label: "Country that issued the Passport", section: "beneficiary", sectionTitle: GC_NVC_PERSONAL },

    // Part 2
    { path: "beneficiary.dsPresentStreet", label: "Present Address — Street Address", section: "beneficiary", sectionTitle: GC_NVC_ADDRESS },
    { path: "beneficiary.dsPresentCity", label: "Present Address — City", section: "beneficiary", sectionTitle: GC_NVC_ADDRESS },
    { path: "beneficiary.dsPresentState", label: "Present Address — State/Province", section: "beneficiary", sectionTitle: GC_NVC_ADDRESS, required: false },
    { path: "beneficiary.dsPresentZip", label: "Present Address — Postal Zone/ZIP Code", section: "beneficiary", sectionTitle: GC_NVC_ADDRESS, required: false },
    { path: "beneficiary.dsPresentCountry", label: "Present Address — Country/Region", section: "beneficiary", sectionTitle: GC_NVC_ADDRESS },
    { path: "beneficiary.dsPresentAddressStartDate", label: "Start Date of living at Present Address (Month and Year)", section: "beneficiary", sectionTitle: GC_NVC_ADDRESS, type: "date" },
    { path: "beneficiary.dsMailingStreet", label: "Mailing Address — Street number and Name (if different from Present Address)", section: "beneficiary", sectionTitle: GC_NVC_ADDRESS, required: false },
    { path: "beneficiary.dsMailingCity", label: "Mailing Address — City", section: "beneficiary", sectionTitle: GC_NVC_ADDRESS, required: false },
    { path: "beneficiary.dsMailingState", label: "Mailing Address — State/Province", section: "beneficiary", sectionTitle: GC_NVC_ADDRESS, required: false },
    { path: "beneficiary.dsMailingZip", label: "Mailing Address — Postal Zone/ZIP Code", section: "beneficiary", sectionTitle: GC_NVC_ADDRESS, required: false },
    { path: "beneficiary.dsMailingCountry", label: "Mailing Address — Country/Region", section: "beneficiary", sectionTitle: GC_NVC_ADDRESS, required: false },
    { path: "beneficiary.dsAddressHistory", label: "All addresses where you have lived since the age of sixteen", section: "beneficiary", sectionTitle: GC_NVC_ADDRESS, repeatable: true },
    { path: "beneficiary.dsUsAddressContactName", label: "Name of person currently living at intended U.S. address (if known)", section: "beneficiary", sectionTitle: GC_NVC_ADDRESS, required: false },
    { path: "beneficiary.dsUsAddressStreet", label: "U.S. Street number and Name (intended address in the United States)", section: "beneficiary", sectionTitle: GC_NVC_ADDRESS },
    { path: "beneficiary.dsUsAddressCity", label: "U.S. Address — City", section: "beneficiary", sectionTitle: GC_NVC_ADDRESS },
    { path: "beneficiary.dsUsAddressState", label: "U.S. Address — State/Province", section: "beneficiary", sectionTitle: GC_NVC_ADDRESS },
    { path: "beneficiary.dsUsAddressZip", label: "U.S. Address — Postal Zone/ZIP Code", section: "beneficiary", sectionTitle: GC_NVC_ADDRESS, required: false },
    { path: "beneficiary.dsUsAddressPhone", label: "U.S. Address — Phone Number (if known)", section: "beneficiary", sectionTitle: GC_NVC_ADDRESS, required: false },
    { path: "beneficiary.dsGcDeliveryContact", label: "Green Card Delivery Address — Contact Person (if different from above)", section: "beneficiary", sectionTitle: GC_NVC_ADDRESS, required: false },
    { path: "beneficiary.dsGcDeliveryAddress", label: "Green Card Delivery Address", section: "beneficiary", sectionTitle: GC_NVC_ADDRESS, required: false },
    { path: "beneficiary.dsGcDeliveryCity", label: "Green Card Delivery — City", section: "beneficiary", sectionTitle: GC_NVC_ADDRESS, required: false },
    { path: "beneficiary.dsGcDeliveryState", label: "Green Card Delivery — State", section: "beneficiary", sectionTitle: GC_NVC_ADDRESS, required: false },
    { path: "beneficiary.dsGcDeliveryZip", label: "Green Card Delivery — ZIP Code", section: "beneficiary", sectionTitle: GC_NVC_ADDRESS, required: false },
    { path: "beneficiary.dsGcDeliveryPhone", label: "Green Card Delivery — Phone Number (if known)", section: "beneficiary", sectionTitle: GC_NVC_ADDRESS, required: false },

    // Part 3
    { path: "beneficiary.dsPrimaryPhone", label: "Primary Phone Number", section: "beneficiary", sectionTitle: GC_NVC_CONTACT },
    { path: "beneficiary.dsSecondaryPhone", label: "Secondary Phone Number (if available)", section: "beneficiary", sectionTitle: GC_NVC_CONTACT, required: false },
    { path: "beneficiary.dsWorkPhone", label: "Work Phone Number (if available)", section: "beneficiary", sectionTitle: GC_NVC_CONTACT, required: false },
    { path: "beneficiary.dsHasOtherPhones", label: "Have you used any other telephone numbers during the last 5 years?", section: "beneficiary", sectionTitle: GC_NVC_CONTACT, type: "radio", options: ["Yes", "No"] },
    { path: "beneficiary.dsOtherPhones", label: "Other telephone numbers used in the last 5 years", section: "beneficiary", sectionTitle: GC_NVC_CONTACT, required: false, condition: { field: "beneficiary.dsHasOtherPhones", operator: "equals", value: "Yes" } },
    { path: "beneficiary.dsCurrentEmail", label: "Current Email Address", section: "beneficiary", sectionTitle: GC_NVC_CONTACT, type: "email" },
    { path: "beneficiary.dsHasOtherEmails", label: "Have you used any other email addresses during the last 5 years?", section: "beneficiary", sectionTitle: GC_NVC_CONTACT, type: "radio", options: ["Yes", "No"] },
    { path: "beneficiary.dsOtherEmails", label: "Other email addresses used in the last 5 years", section: "beneficiary", sectionTitle: GC_NVC_CONTACT, required: false, condition: { field: "beneficiary.dsHasOtherEmails", operator: "equals", value: "Yes" } },
    { path: "beneficiary.dsSocialMedia", label: "Social Media platforms used within the last 5 years (provider and identifier)", section: "beneficiary", sectionTitle: GC_NVC_CONTACT, required: false, repeatable: true },

    // Part 4
    { path: "beneficiary.dsFatherLastName", label: "Father's Last Name", section: "beneficiary", sectionTitle: GC_NVC_PARENTS },
    { path: "beneficiary.dsFatherFirstName", label: "Father's First Name", section: "beneficiary", sectionTitle: GC_NVC_PARENTS },
    { path: "beneficiary.dsFatherDateOfBirth", label: "Father's Date of Birth", section: "beneficiary", sectionTitle: GC_NVC_PARENTS, type: "date" },
    { path: "beneficiary.dsFatherCityStateCountryOfBirth", label: "Father's City, State & Country of Birth", section: "beneficiary", sectionTitle: GC_NVC_PARENTS },
    { path: "beneficiary.dsFatherIsLiving", label: "Is your father still living?", section: "beneficiary", sectionTitle: GC_NVC_PARENTS, type: "radio", options: ["Yes", "No"] },
    { path: "beneficiary.dsFatherAddress", label: "Father's Full Address", section: "beneficiary", sectionTitle: GC_NVC_PARENTS, required: false, condition: { field: "beneficiary.dsFatherIsLiving", operator: "equals", value: "Yes" } },
    { path: "beneficiary.dsFatherYearOfDeath", label: "Father's Year of Death", section: "beneficiary", sectionTitle: GC_NVC_PARENTS, required: false, condition: { field: "beneficiary.dsFatherIsLiving", operator: "equals", value: "No" } },
    { path: "beneficiary.dsMotherLastName", label: "Mother's Last Name", section: "beneficiary", sectionTitle: GC_NVC_PARENTS },
    { path: "beneficiary.dsMotherFirstName", label: "Mother's First Name", section: "beneficiary", sectionTitle: GC_NVC_PARENTS },
    { path: "beneficiary.dsMotherDateOfBirth", label: "Mother's Date of Birth", section: "beneficiary", sectionTitle: GC_NVC_PARENTS, type: "date" },
    { path: "beneficiary.dsMotherCityStateCountryOfBirth", label: "Mother's City, State & Country of Birth", section: "beneficiary", sectionTitle: GC_NVC_PARENTS },
    { path: "beneficiary.dsMotherIsLiving", label: "Is your mother still living?", section: "beneficiary", sectionTitle: GC_NVC_PARENTS, type: "radio", options: ["Yes", "No"] },
    { path: "beneficiary.dsMotherAddress", label: "Mother's Full Address", section: "beneficiary", sectionTitle: GC_NVC_PARENTS, required: false, condition: { field: "beneficiary.dsMotherIsLiving", operator: "equals", value: "Yes" } },
    { path: "beneficiary.dsMotherYearOfDeath", label: "Mother's Year of Death", section: "beneficiary", sectionTitle: GC_NVC_PARENTS, required: false, condition: { field: "beneficiary.dsMotherIsLiving", operator: "equals", value: "No" } },

    // Part 5
    { path: "beneficiary.dsSpouseLastName", label: "Current Spouse — Last Name", section: "beneficiary", sectionTitle: GC_NVC_SPOUSE, required: false },
    { path: "beneficiary.dsSpouseFirstName", label: "Current Spouse — First Name", section: "beneficiary", sectionTitle: GC_NVC_SPOUSE, required: false },
    { path: "beneficiary.dsSpouseDateOfBirth", label: "Current Spouse — Date of Birth", section: "beneficiary", sectionTitle: GC_NVC_SPOUSE, required: false, type: "date" },
    { path: "beneficiary.dsSpouseCityStateCountryOfBirth", label: "Current Spouse — City, State & Country of Birth", section: "beneficiary", sectionTitle: GC_NVC_SPOUSE, required: false },
    { path: "beneficiary.dsSpouseAddress", label: "Current Spouse — Address", section: "beneficiary", sectionTitle: GC_NVC_SPOUSE, required: false },
    { path: "beneficiary.dsSpouseOccupation", label: "Current Spouse — Occupation", section: "beneficiary", sectionTitle: GC_NVC_SPOUSE, required: false },
    { path: "beneficiary.dsSpouseSupportExplanation", label: "If Spouse is not employed, who supports her/him?", section: "beneficiary", sectionTitle: GC_NVC_SPOUSE, required: false },
    { path: "beneficiary.dsSpouseMarriageDate", label: "Date of Marriage", section: "beneficiary", sectionTitle: GC_NVC_SPOUSE, required: false, type: "date" },
    { path: "beneficiary.dsSpouseMarriagePlace", label: "City, State & Country of Marriage", section: "beneficiary", sectionTitle: GC_NVC_SPOUSE, required: false },
    { path: "beneficiary.dsSpouseImmigratingWithApplicant", label: "Is your spouse immigrating with you?", section: "beneficiary", sectionTitle: GC_NVC_SPOUSE, required: false, type: "radio", options: ["Yes", "No"] },
    { path: "beneficiary.dsSpouseImmigratingLater", label: "Is your spouse immigrating to the U.S. at a later date to join you?", section: "beneficiary", sectionTitle: GC_NVC_SPOUSE, required: false, type: "radio", options: ["Yes", "No"], condition: { field: "beneficiary.dsSpouseImmigratingWithApplicant", operator: "equals", value: "No" } },
    { path: "beneficiary.dsPreviousSpouseCount", label: "Number of previous spouses", section: "beneficiary", sectionTitle: GC_NVC_SPOUSE, required: false, type: "number" },
    { path: "beneficiary.dsPreviousSpouses", label: "Previous Spouse(s) details", section: "beneficiary", sectionTitle: GC_NVC_SPOUSE, required: false, repeatable: true },

    // Part 6
    { path: "beneficiary.dsHasChildren", label: "Do you have any children?", section: "beneficiary", sectionTitle: GC_NVC_CHILDREN, type: "radio", options: ["Yes", "No"] },
    { path: "beneficiary.dsChildrenCount", label: "Number of Children", section: "beneficiary", sectionTitle: GC_NVC_CHILDREN, required: false, type: "number", condition: { field: "beneficiary.dsHasChildren", operator: "equals", value: "Yes" } },
    { path: "beneficiary.dsChildren", label: "Children details", section: "beneficiary", sectionTitle: GC_NVC_CHILDREN, required: false, repeatable: true, condition: { field: "beneficiary.dsHasChildren", operator: "equals", value: "Yes" } },

    // Part 7
    { path: "beneficiary.dsHasBeenToUs", label: "Have you ever been in the U.S.?", section: "beneficiary", sectionTitle: GC_NVC_TRAVEL, type: "radio", options: ["Yes", "No"] },
    { path: "beneficiary.dsAlienRegistrationIssued", label: "Were you issued an Alien Registration Number?", section: "beneficiary", sectionTitle: GC_NVC_TRAVEL, required: false, type: "radio", options: ["Yes", "No"], condition: { field: "beneficiary.dsHasBeenToUs", operator: "equals", value: "Yes" } },
    { path: "beneficiary.dsAlienRegistrationNumber", label: "Alien Registration Number", section: "beneficiary", sectionTitle: GC_NVC_TRAVEL, required: false, condition: { field: "beneficiary.dsAlienRegistrationIssued", operator: "equals", value: "Yes" } },
    { path: "beneficiary.dsPriorUsVisits", label: "Last five U.S. visits — date arrived and length of stay", section: "beneficiary", sectionTitle: GC_NVC_TRAVEL, required: false, repeatable: true },
    { path: "beneficiary.dsEverIssuedUsVisa", label: "Have you ever been issued a U.S. Visa?", section: "beneficiary", sectionTitle: GC_NVC_TRAVEL, type: "radio", options: ["Yes", "No"] },
    { path: "beneficiary.dsVisaIssuedDate", label: "Date Visa Was Issued", section: "beneficiary", sectionTitle: GC_NVC_TRAVEL, required: false, type: "date", condition: { field: "beneficiary.dsEverIssuedUsVisa", operator: "equals", value: "Yes" } },
    { path: "beneficiary.dsVisaClassification", label: "Visa Classification (if known)", section: "beneficiary", sectionTitle: GC_NVC_TRAVEL, required: false, condition: { field: "beneficiary.dsEverIssuedUsVisa", operator: "equals", value: "Yes" } },
    { path: "beneficiary.dsVisaNumber", label: "Visa Number (if known)", section: "beneficiary", sectionTitle: GC_NVC_TRAVEL, required: false, condition: { field: "beneficiary.dsEverIssuedUsVisa", operator: "equals", value: "Yes" } },
    { path: "beneficiary.dsVisaLostOrStolen", label: "Have any of your U.S. visas ever been lost or stolen?", section: "beneficiary", sectionTitle: GC_NVC_TRAVEL, required: false, type: "radio", options: ["Yes", "No"], condition: { field: "beneficiary.dsEverIssuedUsVisa", operator: "equals", value: "Yes" } },
    { path: "beneficiary.dsVisaCancelledOrRevoked", label: "Have any of your U.S. visas ever been cancelled or revoked?", section: "beneficiary", sectionTitle: GC_NVC_TRAVEL, required: false, type: "radio", options: ["Yes", "No"], condition: { field: "beneficiary.dsEverIssuedUsVisa", operator: "equals", value: "Yes" } },
    { path: "beneficiary.dsRefusedVisaOrAdmission", label: "Have you ever been refused a U.S. visa, been refused admission to the U.S., or withdrawn your application for admission at the port of entry?", section: "beneficiary", sectionTitle: GC_NVC_TRAVEL, type: "radio", options: ["Yes", "No"] },

    // Part 8
    { path: "beneficiary.dsPrimaryOccupationTitle", label: "Primary Occupation title", section: "beneficiary", sectionTitle: GC_NVC_EMPLOYMENT },
    { path: "beneficiary.dsNotEmployedSupportExplanation", label: "If NOT EMPLOYED, how are you supporting yourself?", section: "beneficiary", sectionTitle: GC_NVC_EMPLOYMENT, required: false },
    { path: "beneficiary.dsHasOtherOccupations", label: "Do you have any other occupations?", section: "beneficiary", sectionTitle: GC_NVC_EMPLOYMENT, type: "radio", options: ["Yes", "No"] },
    { path: "beneficiary.dsOtherOccupationTitle", label: "Other Occupation Title", section: "beneficiary", sectionTitle: GC_NVC_EMPLOYMENT, required: false, condition: { field: "beneficiary.dsHasOtherOccupations", operator: "equals", value: "Yes" } },
    { path: "beneficiary.dsOtherEmployerName", label: "Other Employer or School Name", section: "beneficiary", sectionTitle: GC_NVC_EMPLOYMENT, required: false, condition: { field: "beneficiary.dsHasOtherOccupations", operator: "equals", value: "Yes" } },
    { path: "beneficiary.dsOtherEmployerAddress", label: "Other Employer or School — Street Address, City, State/Province, ZIP, Country, Telephone", section: "beneficiary", sectionTitle: GC_NVC_EMPLOYMENT, required: false, condition: { field: "beneficiary.dsHasOtherOccupations", operator: "equals", value: "Yes" } },
    { path: "beneficiary.dsIntendedUsOccupationTitle", label: "Occupation (title) you intend to work in the U.S.", section: "beneficiary", sectionTitle: GC_NVC_EMPLOYMENT },
    { path: "beneficiary.dsIntendedNotEmployedExplanation", label: "If NOT EMPLOYED in the U.S., how will you support yourself?", section: "beneficiary", sectionTitle: GC_NVC_EMPLOYMENT, required: false },
    { path: "beneficiary.dsIntendedEmployerName", label: "Intended U.S. Employer or School Name", section: "beneficiary", sectionTitle: GC_NVC_EMPLOYMENT, required: false },
    { path: "beneficiary.dsIntendedEmployerAddress", label: "Intended U.S. Employer or School — Street Address, City, State/Province, ZIP, Country, Telephone", section: "beneficiary", sectionTitle: GC_NVC_EMPLOYMENT, required: false },
    { path: "beneficiary.dsRequiresTwoYearsTraining", label: "Does this job require at least 2 years of Training?", section: "beneficiary", sectionTitle: GC_NVC_EMPLOYMENT, type: "radio", options: ["Yes", "No"] },
    { path: "beneficiary.dsTrainingJobTitle", label: "Training — Job title", section: "beneficiary", sectionTitle: GC_NVC_EMPLOYMENT, required: false, condition: { field: "beneficiary.dsRequiresTwoYearsTraining", operator: "equals", value: "Yes" } },
    { path: "beneficiary.dsTrainingWorkDescription", label: "Training — Describe the type of work you are doing (be as specific as possible)", section: "beneficiary", sectionTitle: GC_NVC_EMPLOYMENT, required: false, condition: { field: "beneficiary.dsRequiresTwoYearsTraining", operator: "equals", value: "Yes" } },
    { path: "beneficiary.dsTrainingDateFrom", label: "Training — Employment Date From", section: "beneficiary", sectionTitle: GC_NVC_EMPLOYMENT, required: false, type: "date", condition: { field: "beneficiary.dsRequiresTwoYearsTraining", operator: "equals", value: "Yes" } },
    { path: "beneficiary.dsTrainingDateTo", label: "Training — Employment Date To", section: "beneficiary", sectionTitle: GC_NVC_EMPLOYMENT, required: false, type: "date", condition: { field: "beneficiary.dsRequiresTwoYearsTraining", operator: "equals", value: "Yes" } },
    { path: "beneficiary.dsPreviouslyEmployed", label: "Were you previously employed?", section: "beneficiary", sectionTitle: GC_NVC_EMPLOYMENT, type: "radio", options: ["Yes", "No"] },
    { path: "beneficiary.dsEmploymentHistory", label: "Employment history for the last 10 years", section: "beneficiary", sectionTitle: GC_NVC_EMPLOYMENT, required: false, repeatable: true, condition: { field: "beneficiary.dsPreviouslyEmployed", operator: "equals", value: "Yes" } },

    // Part 9
    { path: "beneficiary.dsAttendedSecondaryOrAbove", label: "Have you attended any educational institutions at a secondary level or above?", section: "beneficiary", sectionTitle: GC_NVC_EDUCATION, type: "radio", options: ["Yes", "No"] },
    { path: "beneficiary.dsInstitutionCount", label: "Number of Educational Institutions Attended so far", section: "beneficiary", sectionTitle: GC_NVC_EDUCATION, required: false, type: "number", condition: { field: "beneficiary.dsAttendedSecondaryOrAbove", operator: "equals", value: "Yes" } },
    { path: "beneficiary.dsEducationHistory", label: "Educational institutions attended at a secondary level or above", section: "beneficiary", sectionTitle: GC_NVC_EDUCATION, required: false, repeatable: true, condition: { field: "beneficiary.dsAttendedSecondaryOrAbove", operator: "equals", value: "Yes" } },

    // Part 10
    { path: "beneficiary.dsTraveledLast5Years", label: "Have you traveled to any countries/regions within the last 5 years?", section: "beneficiary", sectionTitle: GC_NVC_ADDITIONAL, type: "radio", options: ["Yes", "No"] },
    { path: "beneficiary.dsCountriesTraveled", label: "List of countries traveled in the last 5 years", section: "beneficiary", sectionTitle: GC_NVC_ADDITIONAL, required: false, condition: { field: "beneficiary.dsTraveledLast5Years", operator: "equals", value: "Yes" } },
    { path: "beneficiary.dsServedInMilitary", label: "Have you ever served in the military?", section: "beneficiary", sectionTitle: GC_NVC_ADDITIONAL, type: "radio", options: ["Yes", "No"] },
    { path: "beneficiary.dsMilitaryCountry", label: "Military — Name of Country/Region", section: "beneficiary", sectionTitle: GC_NVC_ADDITIONAL, required: false, condition: { field: "beneficiary.dsServedInMilitary", operator: "equals", value: "Yes" } },
    { path: "beneficiary.dsMilitaryBranch", label: "Military — Branch of Service", section: "beneficiary", sectionTitle: GC_NVC_ADDITIONAL, required: false, condition: { field: "beneficiary.dsServedInMilitary", operator: "equals", value: "Yes" } },
    { path: "beneficiary.dsMilitaryRank", label: "Military — Rank/Position", section: "beneficiary", sectionTitle: GC_NVC_ADDITIONAL, required: false, condition: { field: "beneficiary.dsServedInMilitary", operator: "equals", value: "Yes" } },
    { path: "beneficiary.dsMilitarySpecialty", label: "Military — Specialty", section: "beneficiary", sectionTitle: GC_NVC_ADDITIONAL, required: false, condition: { field: "beneficiary.dsServedInMilitary", operator: "equals", value: "Yes" } },
    { path: "beneficiary.dsMilitaryDateFrom", label: "Military — Date of Service From", section: "beneficiary", sectionTitle: GC_NVC_ADDITIONAL, required: false, type: "date", condition: { field: "beneficiary.dsServedInMilitary", operator: "equals", value: "Yes" } },
    { path: "beneficiary.dsMilitaryDateTo", label: "Military — Date of Service To", section: "beneficiary", sectionTitle: GC_NVC_ADDITIONAL, required: false, type: "date", condition: { field: "beneficiary.dsServedInMilitary", operator: "equals", value: "Yes" } },
    { path: "beneficiary.dsBelongedToOrganization", label: "Have you belonged to, contributed to, or worked for any professional, social or charitable organization?", section: "beneficiary", sectionTitle: GC_NVC_ADDITIONAL, type: "radio", options: ["Yes", "No"] },

    // Part 11 - generated below via gcNvcSecurityQuestionEntries()
    { path: "beneficiary.dsSecurityExplanation", label: "If you answered Yes to any question in this section, please explain", section: "beneficiary", sectionTitle: GC_NVC_SECURITY, required: false, description: "Required only if any answer above is Yes." },

    // Part 12
    { path: "beneficiary.dsPreviouslyAppliedForSsn", label: "Have you ever applied for a Social Security number?", section: "beneficiary", sectionTitle: GC_NVC_SSN, type: "radio", options: ["Yes", "No"] },
    { path: "beneficiary.dsWantsSsnIssued", label: "Do you want the Social Security Administration to issue a Social Security number and card?", section: "beneficiary", sectionTitle: GC_NVC_SSN, type: "radio", options: ["Yes", "No"] },
    { path: "beneficiary.dsAuthorizesSsnDisclosure", label: "Do you authorize disclosure of information from this form to DHS, the Social Security Administration, and other required U.S. Government agencies for the purpose of assigning an SSN and issuing a Social Security card, and authorize SSA to share your SSN with DHS?", section: "beneficiary", sectionTitle: GC_NVC_SSN, type: "radio", options: ["Yes", "No"] },

    // Part 13 - restated on the beneficiary's own DS-260, per the source.
    { path: "beneficiary.dsPetitionerRelation", label: "Petitioner is my (relation)", section: "beneficiary", sectionTitle: GC_NVC_PETITIONER },
    { path: "beneficiary.dsPetitionerFirstName", label: "Petitioner's First Name", section: "beneficiary", sectionTitle: GC_NVC_PETITIONER },
    { path: "beneficiary.dsPetitionerLastName", label: "Petitioner's Last/Surname", section: "beneficiary", sectionTitle: GC_NVC_PETITIONER },
    { path: "beneficiary.dsPetitionerAddress", label: "Petitioner's Address", section: "beneficiary", sectionTitle: GC_NVC_PETITIONER },
    { path: "beneficiary.dsPetitionerCity", label: "Petitioner's Address — City", section: "beneficiary", sectionTitle: GC_NVC_PETITIONER },
    { path: "beneficiary.dsPetitionerState", label: "Petitioner's Address — State/Province", section: "beneficiary", sectionTitle: GC_NVC_PETITIONER, required: false },
    { path: "beneficiary.dsPetitionerZip", label: "Petitioner's Address — Postal Zone/ZIP Code", section: "beneficiary", sectionTitle: GC_NVC_PETITIONER, required: false },
    { path: "beneficiary.dsPetitionerCountry", label: "Petitioner's Address — Country/Region", section: "beneficiary", sectionTitle: GC_NVC_PETITIONER },
    { path: "beneficiary.dsPetitionerTelephone", label: "Petitioner's Telephone", section: "beneficiary", sectionTitle: GC_NVC_PETITIONER, required: false },
    { path: "beneficiary.dsPetitionerMobile", label: "Petitioner's Mobile/Cell Telephone", section: "beneficiary", sectionTitle: GC_NVC_PETITIONER, required: false },
    { path: "beneficiary.dsPetitionerEmail", label: "Petitioner's Email Address", section: "beneficiary", sectionTitle: GC_NVC_PETITIONER, required: false, type: "email" },
  ];
  const allEntries = [...entries.slice(0, entries.findIndex((e) => e.sectionTitle === GC_NVC_SECURITY) + 1), ...gcNvcSecurityQuestionEntries(), ...entries.slice(entries.findIndex((e) => e.sectionTitle === GC_NVC_SECURITY) + 1)];
  return allEntries.map((entry) => ({ ...entry, required: entry.condition ? false : entry.required !== false }));
}

const GC_NVC_REPEATABLE_FIELDS = {
  "beneficiary.dsAddressHistory": [
    { key: "streetAndNumber", label: "Street and Number", type: "text" },
    { key: "city", label: "City", type: "text" },
    { key: "provinceState", label: "Province/State", type: "text" },
    { key: "country", label: "Country", type: "text" },
    { key: "from", label: "From (Month/Year)", type: "date" },
    { key: "to", label: "To (Month/Year)", type: "date" },
  ],
  "beneficiary.dsSocialMedia": [
    { key: "platform", label: "Social Media Provider/Platform", type: "text" },
    { key: "identifier", label: "Social Media Identifier", type: "text" },
  ],
  "beneficiary.dsPreviousSpouses": [
    { key: "fullName", label: "Full Name", type: "text" },
    { key: "dateOfBirth", label: "Date of Birth", type: "date" },
    { key: "dateOfMarriage", label: "Date of Marriage", type: "date" },
    { key: "cityStateCountryOfMarriage", label: "City, State & Country of Marriage", type: "text" },
    { key: "dateMarriageEnded", label: "Date Marriage Legally Ended", type: "date" },
    { key: "cityStateCountryMarriageEnded", label: "City, State & Country where Marriage Ended", type: "text" },
  ],
  "beneficiary.dsChildren": [
    { key: "lastName", label: "Last Name", type: "text" },
    { key: "firstName", label: "First Name", type: "text" },
    { key: "dateOfBirth", label: "Date of Birth", type: "date" },
    { key: "cityStateCountryOfBirth", label: "City, State and Country of Birth", type: "text" },
    { key: "presentAddress", label: "Full Present Address", type: "text" },
    { key: "immigratingWithApplicant", label: "Is this child immigrating to the U.S. with you?", type: "radio" },
    { key: "immigratingLater", label: "Is this child immigrating to the U.S. at a later date to join you?", type: "radio" },
  ],
  "beneficiary.dsPriorUsVisits": [
    { key: "dateArrived", label: "Date Arrived", type: "date" },
    { key: "lengthOfStay", label: "Length of Stay (months or years)", type: "text" },
  ],
  "beneficiary.dsEmploymentHistory": [
    { key: "employerName", label: "Full Name of Employer", type: "text" },
    { key: "employerAddress", label: "Full Address of Employer", type: "text" },
    { key: "occupation", label: "Occupation", type: "text" },
    { key: "supervisorName", label: "Supervisor Full Name", type: "text" },
    { key: "phone", label: "Telephone Number", type: "text" },
    { key: "from", label: "From (Month/Year)", type: "date" },
    { key: "to", label: "To (Month/Year)", type: "date" },
  ],
  "beneficiary.dsEducationHistory": [
    { key: "institutionName", label: "Full Name of Institution", type: "text" },
    { key: "institutionAddress", label: "Full Address of Institution", type: "text" },
    { key: "courseOfStudy", label: "Course of Study", type: "text" },
    { key: "degree", label: "Degree/Diploma", type: "text" },
    { key: "from", label: "Date of Attendance From (Month/Year)", type: "date" },
    { key: "to", label: "Date of Attendance To (Month/Year)", type: "date" },
  ],
};

const gcNvc = {
  key: "gc_nvc",
  // Beneficiary-only per the source (DS-260 is filed by/about the
  // beneficiary; Part 13 restates petitioner info but is still part of the
  // beneficiary's own form) - no separate petitioner checklist.
  petitionerDocuments: [],
  beneficiaryDocuments: gcNvcDocuments,
  fieldCatalog: gcNvcFieldCatalog,
  REPEATABLE_FIELDS: GC_NVC_REPEATABLE_FIELDS,
};

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

module.exports = { key, matches, i130, greenCard, i864, gcNvc };
