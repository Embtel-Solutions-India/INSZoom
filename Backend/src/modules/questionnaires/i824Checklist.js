// I-824 (Application for Action on an Approved Application or Petition) - standalone two-party case type "I-824".
// Exactly TWO checklists: "I-824 — Petitioner Checklist" (petitioner + principal applicant, and their documents) and "I-824 — Beneficiary Checklist".
// There is deliberately NO third principal-immigrant checklist: the principal applicant's questions and uploads are sections of the petitioner checklist,
// stored under their own principalImmigrant.* namespace (documents tagged documentOwner "principal_immigrant"), never the petitioner's or the beneficiary's.
// EVERYTHING is optional (required:false + metadata.optional). Labels / answer types / canonical paths are the supplied ones.
// A family case holds one beneficiary record (Case.beneficiary), so the beneficiary section is single-person; extra derivatives are a staff-review item.

const { COUNTRIES } = require("../../config/geoOptions");

const STAFF_ROLES = ["case_manager", "team_lead", "admin", "super_admin"];
const slugSection = (title) => title.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
const PETITIONER_VISIBILITY = { roles: ["petitioner", ...STAFF_ROLES], portals: ["client", "admin"] };
const BENEFICIARY_VISIBILITY = { roles: ["beneficiary", ...STAFF_ROLES], portals: ["client", "admin"] };

const PETITIONER_KEY = "i824_petitioner_checklist";
const BENEFICIARY_KEY = "i824_beneficiary_checklist";
const PETITIONER_TITLE = "I-824 — Petitioner Checklist";
const BENEFICIARY_TITLE = "I-824 — Beneficiary Checklist";
const IMMIGRATION_STATUS_OPTIONS = ["US Citizen", "Lawful Permanent Resident"];

function makeBuilder(visibility) {
  const q = (key, label, type, section, order, canonicalPath, extras = {}) => ({
    key,
    label,
    type,
    sectionKey: slugSection(section),
    pageKey: slugSection(section),
    order,
    required: false,
    options: (extras.options || []).map((value) => (typeof value === "object" ? value : { label: value, value })),
    evidenceCategory: extras.evidenceCategory,
    metadata: { requirement: "optional", optional: true, ...(extras.metadata || {}) },
    mapping: { canonicalPath },
    visibility,
    conditionalLogic: { mode: "all", rules: [], groups: [] },
    repeatable: false,
  });
  const doc = (key, label, section, order, canonicalPath, { multiple = false, category = "identity", owner } = {}) =>
    q(key, label, "file", section, order, canonicalPath, {
      evidenceCategory: category,
      metadata: { documentType: key, category, multiple, ...(owner ? { documentOwner: owner } : {}) },
    });
  return { q, doc };
}

function buildPetitioner() {
  const { q, doc } = makeBuilder(PETITIONER_VISIBILITY);
  const sections = [];
  const questions = [];
  const push = (section, ...items) => { sections.push(section); questions.push(...items); };
  const countryOpts = { options: COUNTRIES };

  const A = "Information about the Petitioner";
  push(A,
    q("i824_petitioner_lastName", "Last Name", "text", A, 1, "petitioner.lastName"),
    q("i824_petitioner_firstName", "First Name", "text", A, 2, "petitioner.firstName"),
    q("i824_petitioner_middleName", "Middle Name", "text", A, 3, "petitioner.middleName"),
    q("i824_petitioner_dateOfBirth", "Date of Birth", "date", A, 4, "petitioner.dateOfBirth"),
    q("i824_petitioner_countryOfBirth", "Country of Birth", "select", A, 5, "petitioner.countryOfBirth", countryOpts),
    q("i824_petitioner_countryOfCitizenship", "Country of Citizenship", "select", A, 6, "petitioner.countryOfCitizenship", countryOpts),
    q("i824_petitioner_organizationName", "Company or Organization Name (if any)", "text", A, 7, "petitioner.organizationName"),
    q("i824_petitioner_currentImmigrationStatus", "Current Immigration Status (US Citizen or Lawful Permanent Resident)", "select", A, 8, "petitioner.currentImmigrationStatus", { options: IMMIGRATION_STATUS_OPTIONS }),
    q("i824_petitioner_citizenshipCertificateNumber", "Certificate of Naturalization/ Citizenship Number (if any)", "text", A, 9, "petitioner.citizenshipCertificateNumber"),
    q("i824_petitioner_aNumber", "A Number (if any)", "text", A, 10, "petitioner.aNumber"),
    q("i824_petitioner_irsTaxNumber", "IRS Tax Number (if any)", "text", A, 11, "petitioner.irsTaxNumber", { metadata: { sensitive: true } }),
    q("i824_petitioner_ssn", "Social Security Number", "text", A, 12, "petitioner.ssn", { metadata: { sensitive: true, masked: true } }),
    q("i824_petitioner_uscisOnlineAccountNumber", "USCIS Online Account Number", "text", A, 13, "petitioner.uscisOnlineAccountNumber"),
    q("i824_petitioner_mailingAddress", "Mailing Address", "address", A, 14, "petitioner.mailingAddress"),
    q("i824_petitioner_physicalAddress", "Physical Address (if different from Mailing Address)", "address", A, 15, "petitioner.physicalAddress")
  );

  const B = "Information about the Principal Applicant";
  push(B,
    q("i824_principal_lastName", "Last Name", "text", B, 1, "principalImmigrant.lastName"),
    q("i824_principal_firstName", "First Name", "text", B, 2, "principalImmigrant.firstName"),
    q("i824_principal_middleName", "Middle Name", "text", B, 3, "principalImmigrant.middleName"),
    q("i824_principal_dateOfBirth", "Date of Birth", "date", B, 4, "principalImmigrant.dateOfBirth"),
    q("i824_principal_countryOfBirth", "Country of Birth", "select", B, 5, "principalImmigrant.countryOfBirth", countryOpts),
    q("i824_principal_countryOfCitizenship", "Country of Citizenship", "select", B, 6, "principalImmigrant.countryOfCitizenship", countryOpts),
    q("i824_principal_aNumber", "A Number (if any)", "text", B, 7, "principalImmigrant.aNumber"),
    q("i824_principal_daytimeTelephoneNumber", "Daytime Telephone Number", "phone", B, 8, "principalImmigrant.daytimeTelephoneNumber"),
    q("i824_principal_mailingAddress", "Mailing Address", "address", B, 9, "principalImmigrant.mailingAddress"),
    q("i824_principal_physicalAddress", "Physical Address (if different from Mailing Address)", "address", B, 10, "principalImmigrant.physicalAddress")
  );

  const C = "Documents required from Petitioner";
  push(C,
    doc("i824_petitioner_doc_citizenshipCertificate", "Copy of Naturalization/ Citizenship certificate", C, 1, "petitioner.documents.citizenshipCertificate"),
    doc("i824_petitioner_doc_greenCard", "Copy of green card (front and back), if applicable", C, 2, "petitioner.documents.greenCard", { multiple: true }),
    doc("i824_petitioner_doc_passport", "Copy of passport of the petitioner", C, 3, "petitioner.documents.passport"),
    doc("i824_petitioner_doc_ssnCard", "Copy of SSN", C, 4, "petitioner.documents.ssnCard"),
    doc("i824_petitioner_doc_stateId", "Copy of driver's license or State Identification card", C, 5, "petitioner.documents.stateId"),
    doc("i824_petitioner_doc_i130ApprovalNotice", "Copy of the I-130 approval notice", C, 6, "petitioner.documents.i130ApprovalNotice", { category: "immigration" })
  );

  // The principal immigrant's own files: stored under principalImmigrant.* and tagged so they are never filed as the petitioner's or the beneficiary's.
  const D = "Documents required from Principal Immigrant";
  const owned = { owner: "principal_immigrant" };
  push(D,
    doc("i824_principal_doc_passport", "Copy of the passport", D, 1, "principalImmigrant.documents.passport", owned),
    doc("i824_principal_doc_greenCard", "Copy of green card (front and back)", D, 2, "principalImmigrant.documents.greenCard", { ...owned, multiple: true }),
    doc("i824_principal_doc_ssnCard", "Copy of SSN", D, 3, "principalImmigrant.documents.ssnCard", owned),
    doc("i824_principal_doc_stateId", "Copy of driver's license or State Identification card", D, 4, "principalImmigrant.documents.stateId", owned),
    doc("i824_principal_doc_relationshipEvidence", "Evidence of relationship with both petitioner and beneficiary (such as marriage certificate, birth certificate)", D, 5, "principalImmigrant.documents.relationshipEvidence", { ...owned, multiple: true, category: "relationship" })
  );

  return {
    key: PETITIONER_KEY,
    title: PETITIONER_TITLE,
    visaType: "I824",
    visaTypes: ["I824", "I-824"],
    checklistRole: "petitioner",
    isDefault: true,
    reconcileMetadata: true,
    description: "Petitioner and principal applicant information and documents for Form I-824. Everything is optional - answer what you can and save.",
    sections,
    questions,
  };
}

function buildBeneficiary() {
  const { q, doc } = makeBuilder(BENEFICIARY_VISIBILITY);
  const sections = [];
  const questions = [];
  const push = (section, ...items) => { sections.push(section); questions.push(...items); };

  const A = "Information about the Beneficiary(s)";
  push(A,
    q("i824_beneficiary_lastName", "Last Name", "text", A, 1, "beneficiary.lastName"),
    q("i824_beneficiary_firstName", "First Name", "text", A, 2, "beneficiary.firstName"),
    q("i824_beneficiary_middleName", "Middle Name", "text", A, 3, "beneficiary.middleName"),
    q("i824_beneficiary_dateOfBirth", "Date of Birth", "date", A, 4, "beneficiary.dateOfBirth"),
    q("i824_beneficiary_countryOfBirth", "Country of Birth", "select", A, 5, "beneficiary.countryOfBirth", { options: COUNTRIES }),
    q("i824_beneficiary_countryOfCitizenship", "Country of Citizenship", "select", A, 6, "beneficiary.countryOfCitizenship", { options: COUNTRIES }),
    q("i824_beneficiary_relationshipToPrincipalApplicant", "Relationship to Principal Applicant", "text", A, 7, "beneficiary.relationshipToPrincipalApplicant"),
    q("i824_beneficiary_daytimeTelephoneNumber", "Daytime Telephone Number", "phone", A, 8, "beneficiary.daytimeTelephoneNumber"),
    q("i824_beneficiary_foreignTelephoneNumber", "Foreign Telephone Number", "phone", A, 9, "beneficiary.foreignTelephoneNumber"),
    q("i824_beneficiary_email", "Email id", "email", A, 10, "beneficiary.email"),
    q("i824_beneficiary_foreignAddress", "Outside US Address of beneficiary", "address", A, 11, "beneficiary.foreignAddress")
  );

  const B = "Documents required from Beneficiary";
  push(B,
    doc("i824_beneficiary_doc_passport", "Copy of passport of the beneficiary", B, 1, "beneficiary.documents.passport"),
    doc("i824_beneficiary_doc_relationshipEvidence", "Evidence of relationship (such as marriage certificate, birth certificate)", B, 2, "beneficiary.documents.relationshipEvidence", { multiple: true, category: "relationship" })
  );

  return {
    key: BENEFICIARY_KEY,
    title: BENEFICIARY_TITLE,
    visaType: "I824",
    visaTypes: ["I824", "I-824"],
    checklistRole: "beneficiary",
    isDefault: true,
    reconcileMetadata: true,
    description: "Beneficiary information and documents for Form I-824. Everything is optional - answer what you can and save.",
    sections,
    questions,
  };
}

const I824_CHECKLIST_DEFINITIONS = [buildPetitioner(), buildBeneficiary()];

module.exports = { I824_CHECKLIST_DEFINITIONS, PETITIONER_KEY, BENEFICIARY_KEY, PETITIONER_TITLE, BENEFICIARY_TITLE, IMMIGRATION_STATUS_OPTIONS };
