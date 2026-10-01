// O-2 (support personnel accompanying an O-1 alien) — dedicated employer and
// employee checklists. Same petition structure and field paths as O-1 (the
// normalizers and the field/path vocabulary are reused from o1.js, so the
// document-intelligence passport autofill and canonical mappings that already
// target employee.personal.* work unchanged), but with O-2's own, shorter
// content: no O-1A/O-1B criteria groups, no classification selector, and a
// 3-document employer list.
const o1 = require("./o1");

const key = "o2";

function matches(value) {
  return /^o[\s-]?2$/i.test(String(value || "").trim());
}

const EMPLOYER_DOCUMENT_TYPES = ["o1_articles_of_incorporation", "o1_business_license", "o1_blank_letterhead"];

// Source "Documents Required": Article of Incorporation, Business License,
// Blank Letterhead in word format — all required.
const employerDocuments = o1.COMMON_EMPLOYER_DOCUMENTS
  .filter((doc) => EMPLOYER_DOCUMENT_TYPES.includes(doc.documentType))
  .map((doc) => ({ ...doc, required: true, category: "business", targetRole: "employer", status: "requested" }));

// Source "Documents Required from Beneficiary/Employee" is the same 11 items
// as O-1's; the O-1A/O-1B criteria groups do not apply to O-2.
const employeeDocuments = o1.employeeDocuments.map((doc) => ({ ...doc }));

const insideUS = { field: "employee.immigrationStatus.insideUnitedStates", operator: "equals", value: "yes" };
const outsideUS = { field: "employee.immigrationStatus.insideUnitedStates", operator: "equals", value: "no" };

// Answer type / required-vs-optional, decided per question by its nature:
//  - passport identity + dates, DOB, birth/citizenship country: required
//  - identifiers that only some people have (SSN, A#, prior petition #, SEVIS,
//    EAD, middle name, other names, province/state of birth): optional
//  - US-only (I-94, last arrival, current status/expiry): required only when
//    inside the US; consulate/foreign address: required only when outside
//  - every yes/no screening question: required radio
const FIELD_OVERRIDES = {
  "employee.personal.dateOfBirth": { type: "date", required: true },
  "employee.personal.passportIssueDate": { type: "date", required: true },
  "employee.personal.passportExpirationDate": { type: "date", required: true },
  "employee.personal.passportCountryOfIssuance": { required: true },
  "employee.personal.passportNumber": { required: true },
  "employee.personal.currentUsAddress.street": { required: false },
  "employee.immigrationStatus.insideUnitedStates": { type: "radio", required: true },
  "employee.immigrationStatus.dateOfLastArrival": { type: "date", required: true },
  "employee.immigrationStatus.i94Number": { required: true },
  "employee.immigrationStatus.currentVisaStatus": { required: true },
  "employee.immigrationStatus.currentStatusExpirationDate": { type: "date", required: true },
  "employee.immigrationStatus.consulateForStamping": { required: true },
  "employee.immigrationStatus.foreignResidentialAddress.street": { required: true },
  "employee.immigrationStatus.foreignResidentialAddress.city": { required: true },
  "employee.immigrationStatus.foreignResidentialAddress.country": { required: true },
  "employee.otherInformation.hasValidPassport": { type: "radio", required: true },
  "employee.otherInformation.replaceI94": { type: "radio", required: true },
  "employee.otherInformation.hasDependents": { type: "radio", required: true },
  "employee.otherInformation.numberOfDependents": { type: "number", required: true },
  "employee.otherInformation.inRemovalProceedings": { type: "radio", required: true },
  "employee.otherInformation.employerFiledGreenCard": { type: "radio", required: true },
  "employee.otherInformation.heldO1VisaLastSevenYears": { type: "radio", required: true },
  "employee.otherInformation.deniedO1VisaLastSevenYears": { type: "radio", required: true },
  "employee.otherInformation.o1VisaDenialExplanation": { required: true },
  "employer.company.yearEstablished": { type: "number", required: true },
  "employer.company.totalEmployees": { type: "number", required: false },
  "employer.company.grossAnnualIncome": { type: "currency", required: false },
  "employer.company.netAnnualIncome": { type: "currency", required: false },
  "employer.position.offeredSalary": { type: "currency", required: true },
  "employer.signingPerson.email": { type: "email", required: true },
  "employer.signingPerson.mobilePhone": { type: "phone", required: true },
  "employer.signingPerson.title": { required: true },
  "employer.company.address": { required: true },
  "employer.company.website": { required: false },
  "employer.endClient.name": { required: false },
};

function fieldCatalog() {
  return o1.fieldCatalog()
    // O-2 has no O-1A/O-1B classification selector.
    .filter((entry) => entry.path !== "employer.oClassification")
    .map((entry) => {
      const next = { ...entry, ...(FIELD_OVERRIDES[entry.path] || {}) };
      // Conditional answers are required only while their gate is open.
      if (entry.path.startsWith("employee.immigrationStatus.") && entry.condition?.value === "yes") next.condition = insideUS;
      if (entry.path.startsWith("employee.immigrationStatus.") && entry.condition?.value === "no") next.condition = outsideUS;
      return next;
    });
}

module.exports = {
  key,
  matches,
  employerDocuments,
  employeeDocuments,
  // The employer/employee data shapes are identical to O-1 minus
  // oClassification, so the O-1 normalizers apply as-is.
  normalizeEmployer: (payload) => {
    const { oClassification, ...rest } = o1.normalizeEmployer(payload);
    return rest;
  },
  normalizeEmployee: o1.normalizeEmployee,
  employerConditionalDocuments: o1.employerConditionalDocuments,
  fieldCatalog,
};
