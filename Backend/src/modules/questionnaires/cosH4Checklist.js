// Change of Status to H-4 (visaType COSH4, filing type COS_H4, questionnaire key cos_h4_questionnaire).
// A single-party filing: the H-4 dependent is the only applicant; the H-1B principal's evidence is collected as documents and the principal case can be linked
// through Case.principalCaseRef (existing, optional). Created from ANY current status through the existing change-of-status picker (fromStatus -> "H-4").
//
// EVERYTHING here is optional (required:false + metadata.optional). Sections / labels are the supplied ones, in order. Scalar answers reuse the existing shared
// canonical paths (person.*, contact.*, immigration.*) so every form mapping keeps working; paths with no earlier equivalent use the supplied beneficiary.* /
// application.* paths (registered in canonical/config/h4CanonicalPaths.js). Documents are attachments, never scalar PDF values; the H-1B principal's files are
// tagged as the principal's (metadata.documentOwner) so they are never stored as the beneficiary's.

const { COUNTRIES } = require("../../config/geoOptions");

const STAFF_ROLES = ["case_manager", "team_lead", "admin", "super_admin"];
const VISIBILITY = { roles: ["client", ...STAFF_ROLES], portals: ["client", "admin"] };
const slugSection = (title) => title.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

const APPLICATION_TYPE_OPTIONS = ["Reinstatement to student status", "An extension of stay in my current status", "Change of status"];
const REINSTATEMENT = APPLICATION_TYPE_OPTIONS[0];
const CHANGE_OF_STATUS = APPLICATION_TYPE_OPTIONS[2];

function q(key, label, type, section, order, extras = {}) {
  return {
    key,
    label,
    type,
    sectionKey: slugSection(section),
    pageKey: slugSection(section),
    order,
    required: false,
    description: extras.description,
    options: (extras.options || []).map((value) => (typeof value === "object" ? value : { label: value, value })),
    evidenceCategory: extras.evidenceCategory,
    metadata: { requirement: "optional", optional: true, ...(extras.metadata || {}) },
    ...(extras.canonicalPath ? { mapping: { canonicalPath: extras.canonicalPath } } : {}),
    ...(extras.validationRules ? { validationRules: extras.validationRules } : {}),
    visibility: VISIBILITY,
    conditionalLogic: extras.conditionalLogic || { mode: "all", rules: [], groups: [] },
    repeatable: Boolean(extras.repeatable),
  };
}
const doc = (key, label, section, order, canonicalPath, extras = {}) => q(key, label, "file", section, order, {
  canonicalPath,
  evidenceCategory: extras.category || "supporting_document",
  description: extras.description,
  conditionalLogic: extras.conditionalLogic,
  metadata: { documentType: key, category: extras.category || "supporting_document", multiple: true, ...(extras.metadata || {}) },
});
const country = (extra = {}) => ({ options: COUNTRIES, ...extra });
const whenType = (value) => ({ mode: "all", rules: [{ questionKey: "client_applicationType", operator: "equals", value }], groups: [] });

function build() {
  const questions = [];
  const sections = [];
  const push = (section, ...items) => { if (!sections.includes(section)) sections.push(section); questions.push(...items); };

  const A = "Information about You";
  push(A,
    q("client_familyName", "Family Name (Last Name):", "text", A, 1, { canonicalPath: "person.lastName" }),
    q("client_givenName", "Given Name:", "text", A, 2, { canonicalPath: "person.firstName" }),
    q("client_middleName", "Middle Name:", "text", A, 3, { canonicalPath: "person.middleName" }),
    q("client_aNumber", "Alien Registration Number (A-Number) if any:", "text", A, 4, { canonicalPath: "person.alienNumber" }),
    q("client_uscisOnlineAccountNumber", "USCIS Online Account Number (if any):", "text", A, 5, { canonicalPath: "person.uscisOnlineAccountNumber" }),
    q("client_usMailingAddress", "US Mailing Address:", "address", A, 6, { canonicalPath: "beneficiary.usMailingAddress" }),
    q("client_usPhysicalAddress", "US Physical Address (If different from Mailing Address):", "address", A, 7, { canonicalPath: "beneficiary.usPhysicalAddress" })
  );

  const B = "Other Information";
  push(B,
    q("client_countryOfBirth", "Country of Birth:", "select", B, 1, country({ canonicalPath: "person.countryOfBirth" })),
    q("client_countryOfCitizenship", "Country of Citizenship:", "select", B, 2, country({ canonicalPath: "person.citizenship" })),
    q("client_dateOfBirth", "Date of Birth:", "date", B, 3, { canonicalPath: "person.dob" }),
    q("client_ssn", "U.S. Social Security Number (if any):", "text", B, 4, { canonicalPath: "person.ssn", metadata: { sensitive: true } }),
    q("client_daytimeTelephoneNumber", "Applicant's Daytime Telephone Number:", "phone", B, 5, { canonicalPath: "contact.phone" }),
    q("client_emailAddress", "Applicant's Email Address:", "email", B, 6, { canonicalPath: "contact.email" })
  );

  const C = "Provide Information about your Most Recent Entry in USA";
  push(C,
    q("client_dateOfLastArrival", "Date of Last Arrival Into the United States(mm/dd/yyyy):", "date", C, 1, { canonicalPath: "immigration.lastArrivalDate" }),
    q("client_i94Number", "I-94 Arrival-Departure Record Number:", "text", C, 2, { canonicalPath: "immigration.i94.number" }),
    q("client_passportNumber", "Passport Number:", "text", C, 3, { canonicalPath: "person.passport.number" }),
    q("client_countryOfPassportIssuance", "Country of Passport Issuance:", "select", C, 4, country({ canonicalPath: "person.passport.country" })),
    q("client_passportExpirationDate", "Passport Expiration Date:", "date", C, 5, { canonicalPath: "person.passport.expirationDate" }),
    q("client_currentNonimmigrantStatus", "Current Nonimmigrant Status(e.g. F-1 student, H-4 dependent, etc.):", "text", C, 6, { canonicalPath: "immigration.currentStatus" }),
    q("client_expirationOfCurrentStatus", "Expiration Date of Current Status (mm/dd/yyyy):", "date", C, 7, { canonicalPath: "immigration.currentStatusExpirationDate" })
  );

  const D = "Provide your physical address outside USA";
  push(D,
    q("client_foreignStreetNumberName", "Street Number and Name -", "text", D, 1, { canonicalPath: "beneficiary.foreignAddress.streetAddress" }),
    q("client_foreignCityTown", "City or Town:", "text", D, 2, { canonicalPath: "beneficiary.foreignAddress.city" }),
    q("client_foreignState", "State:", "text", D, 3, { canonicalPath: "beneficiary.foreignAddress.state" }),
    q("client_foreignPostalCode", "Postal Code:", "text", D, 4, { canonicalPath: "beneficiary.foreignAddress.postalCode" }),
    q("client_foreignProvince", "Province:", "text", D, 5, { canonicalPath: "beneficiary.foreignAddress.province" }),
    q("client_foreignCountry", "Country:", "select", D, 6, country({ canonicalPath: "beneficiary.foreignAddress.country" }))
  );

  const E = "Application type";
  push(E,
    q("client_applicationType", "I am applying for (select only one)", "radio", E, 1, {
      options: APPLICATION_TYPE_OPTIONS,
      canonicalPath: "application.applicationType",
      // "Reinstatement to student status" is kept exactly as supplied but is not an H-4 application type: selecting it only warns and is flagged for the
      // case manager; it never ticks a reinstatement box or moves the case out of H-4 (see the I-539 mapping rules).
      validationRules: [{ type: "regex", value: "^(?!Reinstatement to student status$)", message: "Reinstatement to student status is not an H-4 application type - your case manager will review this selection.", severity: "warning" }],
      metadata: { optionFlags: { [REINSTATEMENT]: "case_manager_review" }, reviewNote: "Reinstatement to student status is flagged for case manager review and is never mapped to the H-4 filing." },
    }),
    q("client_requestedStatusRecord", "New status and effective date of change (mm/dd/yyyy):", "repeating_group", E, 2, {
      canonicalPath: "application.requestedStatusRecord",
      conditionalLogic: whenType(CHANGE_OF_STATUS),
      repeatable: true,
      metadata: {
        itemLabel: "Change of status", maxRows: 1,
        repeatableFields: [
          { key: "status", label: "New status", type: "text", defaultValue: "H-4", canonicalPath: "application.requestedStatus" },
          { key: "effectiveDate", label: "Effective date of change (mm/dd/yyyy)", type: "date", canonicalPath: "application.requestedStatusEffectiveDate" },
        ],
      },
    }),
    q("client_changeOfStatusRequested", "The change of status I am requesting is:", "textarea", E, 3, { canonicalPath: "application.changeOfStatusExplanation", conditionalLogic: whenType(CHANGE_OF_STATUS) })
  );

  const F = "Document Checklist";
  push(F,
    doc("cosh4_doc_passportAndI94", "Copy of passport and I-94", F, 1, "beneficiary.documents.passportAndI94", { category: "identity", metadata: { includes: ["passport", "i94"] } }),
    doc("cosh4_doc_ssnCard", "Copy of SSN (if any)", F, 2, "beneficiary.documents.ssnCard", { category: "identity" }),
    doc("cosh4_doc_eadCard", "Copy of EAD card (if any)", F, 3, "beneficiary.documents.eadCard", { category: "immigration" }),
    doc("cosh4_doc_driverLicenseOrStateId", "Copy of driver’s license or state identification card", F, 4, "beneficiary.documents.usDriverLicenseOrStateId", { category: "identity" }),
    doc("cosh4_doc_allApprovalNotices", "Copy of all approval notices", F, 5, "beneficiary.documents.allApprovalNotices", { category: "immigration" })
  );

  const G = "If applying for H4, then provide the following documents as well:";
  push(G,
    doc("cosh4_doc_relationshipToH1B", "Evidence of relationship to H1B visa holder (for example birth certificate, marriage certificate)", G, 1, "beneficiary.documents.relationshipToH1BPrincipal", { category: "relationship" }),
    doc("cosh4_doc_h1bPrincipalDocuments", "Copy of passport, latest 3 paystubs and latest approval notice of H1B visa holder", G, 2, "principalH1B.documents.passportPaystubsAndLatestApprovalNotice", {
      category: "principal_h1b", metadata: { documentOwner: "h1b_principal", includes: ["passport", "paystubs", "approvalNotice"] },
    })
  );

  return {
    key: "cos_h4_questionnaire",
    title: "Change of Status to H-4 — Applicant Checklist",
    visaType: "COSH4",
    checklistRole: "client",
    isDefault: true,
    description: "Information and documents for an H-4 dependent. Everything is optional - answer what you can and save.",
    sections,
    questions,
  };
}

const COS_H4_CHECKLIST_DEFINITIONS = [build()];

module.exports = { COS_H4_CHECKLIST_DEFINITIONS, APPLICATION_TYPE_OPTIONS };
