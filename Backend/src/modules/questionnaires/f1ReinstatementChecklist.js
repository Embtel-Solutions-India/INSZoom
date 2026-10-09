// F-1 Reinstatement - a REAL, standalone, single-party case type (visaType F1REINSTATEMENT, filingTypes.js's F1_REINSTATEMENT).
// ONE client checklist: the applicant, the financial sponsor, the document uploads and the reinstatement-letter questions are all
// sections of it. The sponsor is a financial supporter, not an immigration petitioner: no participant, no second checklist, no invite;
// sponsor answers keep their own `client_sponsor*` keys and are never mapped onto the applicant's canonical namespace.
//
// EVERY question and upload is optional (required: false) and nothing is pre-filled or pre-selected: the template carries labels,
// keys, types and options only. Shared concepts reuse the exact question keys / canonical paths of cosF1Checklist.js, so the existing
// I-539 autofill crosswalk (keyed on canonical paths / question keys, not visa type) fills this case's Form I-539 as well.
// The new school-issued I-20 is a supporting document (an upload), never a USCIS CaseForm.

const { COUNTRIES } = require("../../config/geoOptions");

const STAFF_ROLES = ["case_manager", "team_lead", "admin", "super_admin"];
const VISIBILITY = { roles: ["client", ...STAFF_ROLES], portals: ["client", "admin"] };

const slugSection = (title) => title.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
const gate = (questionKey, operator, value) => ({ mode: "all", rules: [{ questionKey, operator, value }], groups: [] });

function q(key, label, type, sectionTitle, order, extras = {}) {
  return {
    key,
    label,
    type,
    sectionKey: slugSection(sectionTitle),
    pageKey: slugSection(sectionTitle),
    order,
    required: false, // every field of this checklist is optional
    description: extras.description,
    options: (extras.options || []).map((value) => (typeof value === "object" ? value : { label: value, value })),
    evidenceCategory: extras.evidenceCategory,
    metadata: extras.metadata || {},
    ...(extras.canonicalPath ? { mapping: { canonicalPath: extras.canonicalPath } } : {}),
    visibility: VISIBILITY,
    conditionalLogic: extras.conditionalLogic || { mode: "all", rules: [], groups: [] },
    repeatable: false,
  };
}

const country = (key, label, section, order, extras = {}) => q(key, label, "select", section, order, { ...extras, options: COUNTRIES });
const doc = (documentType, name, section, order, category) =>
  q(documentType, name, "file", section, order, { evidenceCategory: category, metadata: { documentType, category, classification: "supporting" } });

function buildF1ReinstatementQuestionnaire() {
  const questions = [];

  const applicant = "Applicant Information";
  questions.push(
    q("client_familyName", "Family Name (Last Name)", "text", applicant, 1, { canonicalPath: "person.lastName" }),
    q("client_givenName", "Given Name (First Name)", "text", applicant, 2, { canonicalPath: "person.firstName" }),
    q("client_middleName", "Middle Name", "text", applicant, 3, { canonicalPath: "person.middleName" }),
    q("client_aNumber", "Alien Registration Number (A-Number) if any", "text", applicant, 4, { canonicalPath: "person.alienNumber" }),
    q("client_uscisOnlineAccountNumber", "USCIS Online Account Number (if any)", "text", applicant, 5),
    q("client_usMailingAddress", "US Mailing Address", "textarea", applicant, 6, { canonicalPath: "contact.address.line1" }),
    q("client_usPhysicalAddress", "US Physical Address (If different from Mailing Address)", "textarea", applicant, 7),
    country("client_countryOfBirth", "Country of Birth", applicant, 8, { canonicalPath: "person.countryOfBirth" }),
    country("client_countryOfCitizenship", "Country of Citizenship", applicant, 9, { canonicalPath: "person.citizenship" }),
    q("client_dateOfBirth", "Date of Birth", "date", applicant, 10, { canonicalPath: "person.dob" }),
    q("client_ssn", "U.S. Social Security Number (if any)", "text", applicant, 11, { metadata: { sensitive: true } }),
    q("client_daytimeTelephoneNumber", "Applicant's Daytime Telephone Number", "phone", applicant, 12, { canonicalPath: "contact.phone" }),
    q("client_emailAddress", "Applicant's Email Address", "email", applicant, 13, { canonicalPath: "contact.email" })
  );

  const entry = "Most Recent Entry into the USA";
  questions.push(
    q("client_dateOfLastArrival", "Date of Last Arrival Into the United States (mm/dd/yyyy)", "date", entry, 1),
    q("client_i94Number", "I-94 Arrival-Departure Record Number", "text", entry, 2, { canonicalPath: "immigration.i94.number" }),
    q("client_passportNumber", "Passport Number", "text", entry, 3, { canonicalPath: "person.passport.number" }),
    country("client_countryOfPassportIssuance", "Country of Passport Issuance", entry, 4, { canonicalPath: "person.passport.country" }),
    q("client_passportExpirationDate", "Passport Expiration Date", "date", entry, 5, { canonicalPath: "person.passport.expirationDate" }),
    q("client_currentNonimmigrantStatus", "Current Nonimmigrant Status (e.g. F-1 student, H-4 dependent, etc.)", "text", entry, 6, { canonicalPath: "immigration.currentStatus" }),
    q("client_expirationOfCurrentStatus", "Expiration Date of Current Status (mm/dd/yyyy)", "date", entry, 7, { canonicalPath: "immigration.currentStatusExpirationDate" })
  );

  const outside = "Physical Address Outside the USA";
  questions.push(
    q("client_foreignStreetNumberName", "Street Number and Name", "text", outside, 1),
    q("client_foreignCityTown", "City or Town", "text", outside, 2),
    q("client_foreignState", "State", "text", outside, 3),
    q("client_foreignPostalCode", "Postal Code", "text", outside, 4),
    q("client_foreignProvince", "Province", "text", outside, 5),
    country("client_foreignCountry", "Country", outside, 6)
  );

  // No default and nothing pre-selected. This case type IS a reinstatement, so a different selection is never silently converted;
  // it is kept as the client's answer, and the question's metadata marks the expected value for staff review.
  const appType = "Application Type";
  const cos = gate("client_applicationType", "equals", "Change of status");
  questions.push(
    q("client_applicationType", "I am applying for (select only one)", "radio", appType, 1, {
      options: ["Reinstatement to student status", "An extension of stay in my current status", "Change of status"],
      metadata: { expectedValue: "Reinstatement to student status", staffReviewIfDifferent: true },
    }),
    q("client_changeOfStatusNewStatus", "New status", "text", appType, 2, { conditionalLogic: cos }),
    q("client_changeOfStatusEffectiveDate", "Effective date of change (mm/dd/yyyy)", "date", appType, 3, { conditionalLogic: cos }),
    q("client_changeOfStatusRequested", "The change of status I am requesting is", "textarea", appType, 4, { conditionalLogic: cos })
  );

  const sponsor = "Information About the Sponsor";
  questions.push(
    q("client_sponsorIntro", "Provide information about the person who will be financially supporting your stay in the USA.", "section_break", sponsor, 0),
    q("client_sponsorFamilyName", "Family Name (Last Name)", "text", sponsor, 1),
    q("client_sponsorGivenName", "Given Name (First Name)", "text", sponsor, 2),
    q("client_sponsorANumber", "Alien Registration Number (A-Number) if any", "text", sponsor, 3),
    q("client_sponsorUsMailingAddress", "US Mailing Address", "textarea", sponsor, 4),
    q("client_sponsorUsPhysicalAddress", "US Physical Address (If different from Mailing Address)", "textarea", sponsor, 5),
    country("client_sponsorCountryOfBirth", "Country of Birth", sponsor, 6),
    country("client_sponsorCountryOfCitizenship", "Country of Citizenship", sponsor, 7),
    q("client_sponsorDateOfBirth", "Date of Birth", "date", sponsor, 8),
    q("client_sponsorDaytimeTelephoneNumber", "Daytime Telephone Number", "phone", sponsor, 9),
    q("client_sponsorEmailAddress", "Email Address", "email", sponsor, 10)
  );

  const money = "Employment & Financial Information (If Any)";
  questions.push(
    q("client_sponsorEmployerName", "Present Employer Name", "text", money, 1),
    q("client_sponsorEmployerAddress", "Present Employer Full Address", "textarea", money, 2),
    q("client_sponsorAnnualIncome", "Current Annual Income (in USD)", "currency", money, 3),
    q("client_sponsorBankBalance", "Bank Balance (in USD)", "currency", money, 4),
    q("client_sponsorOtherAssetsValue", "Other Assets Value (in USD)", "currency", money, 5)
  );

  const applicantDocs = "Documents required from applicant";
  questions.push(
    doc("f1reinst_doc_paystubs", "Copy of last 3 months paystubs (if any)", applicantDocs, 1, "financial"),
    doc("f1reinst_doc_sevisFeeReceiptPrevious", "Copy of SEVIS fee payment receipt (Previous one)", applicantDocs, 2, "immigration"),
    doc("f1reinst_doc_oldI20", "Copy of Old I-20", applicantDocs, 3, "immigration"),
    doc("f1reinst_doc_newI20", "Copy of New I-20", applicantDocs, 4, "immigration"),
    doc("f1reinst_doc_previousAcceptanceLetter", "Copy of previous Acceptance letter", applicantDocs, 5, "immigration"),
    doc("f1reinst_doc_academicEvaluationReport", "Copy of the academic evaluation report (if applicable)", applicantDocs, 6, "education"),
    doc("f1reinst_doc_degreeAndTranscripts", "Copy of academic degree and transcripts", applicantDocs, 7, "education"),
    doc("f1reinst_doc_resume", "Copy of Resume", applicantDocs, 8, "supporting")
  );
  const sponsorDocs = "Documents required from sponsor";
  questions.push(
    doc("f1reinst_doc_sponsorTaxReturns", "Copy of tax returns for the most recent year", sponsorDocs, 1, "financial"),
    doc("f1reinst_doc_sponsorW2", "Copy of W2 for the year 2023", sponsorDocs, 2, "financial"),
    doc("f1reinst_doc_sponsorPaystubs", "Copy of paystubs for last 3 months", sponsorDocs, 3, "financial"),
    doc("f1reinst_doc_sponsorBankStatements", "Copy of bank statements for last 3 months", sponsorDocs, 4, "financial"),
    doc("f1reinst_doc_sponsorUsStatusProof", "If the sponsor is in the USA then provide proof of US Status (for e.g. green card, Citizenship certificate, I-797 Approval notice, etc.)", sponsorDocs, 5, "identity")
  );

  const letter = "Reinstatement Letter Questionnaire";
  questions.push(
    q("client_reinstatementIntro", "We need to prepare a reinstatement letter. Please share the following so we can prepare your reinstatement letter.", "section_break", letter, 0),
    q("client_reinstatementSevisTerminationReason", "Reason your SEVIS was terminated.", "textarea", letter, 1),
    q("client_reinstatementIssueStartDate", "When the issue started.", "date", letter, 2),
    q("client_reinstatementIssueStartNotes", "Anything to add about when the issue started (optional).", "textarea", letter, 3),
    q("client_reinstatementWhyUnintentional", "Why it was unintentional.", "textarea", letter, 4),
    q("client_reinstatementStepsTaken", "What steps you took after finding out.", "textarea", letter, 5)
  );

  return {
    key: "f1_reinstatement_questionnaire",
    title: "F-1 Reinstatement",
    visaType: "F1REINSTATEMENT",
    checklistRole: "client",
    isDefault: true,
    description: "",
    sections: [applicant, entry, outside, appType, sponsor, money, applicantDocs, sponsorDocs, letter],
    questions,
  };
}

const F1_REINSTATEMENT_CHECKLIST_DEFINITIONS = [buildF1ReinstatementQuestionnaire()];

module.exports = { F1_REINSTATEMENT_CHECKLIST_DEFINITIONS };
