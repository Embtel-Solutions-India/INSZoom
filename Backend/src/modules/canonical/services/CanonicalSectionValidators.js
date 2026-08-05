const MappingResolver = require("../../form-mapping/services/MappingResolver");
const { resolveDocumentRequirementTypes } = require("../../document-requirements/document-requirement.resolver");

function value(profile, path) {
  return MappingResolver.resolvePath(profile, path);
}

function isEmpty(candidate) {
  return MappingResolver.isEmpty(candidate);
}

function required(profile, paths) {
  return paths.filter((path) => isEmpty(value(profile, path))).map((path) => ({
    code: "FIELD_REQUIRED",
    path,
    severity: "error",
    message: `${path} is required`,
    suggestedFix: `Provide ${path}`,
  }));
}

function formatError(path, code, message, severity = "error") {
  return { code, path, severity, message, suggestedFix: `Review and correct ${path}` };
}

function validDate(candidate) {
  return !candidate || !Number.isNaN(new Date(candidate).getTime());
}

function sectionResult(section, requiredPaths, issues, totalOverride) {
  const missing = issues.filter((issue) => issue.code === "FIELD_REQUIRED").length;
  const total = totalOverride || Math.max(requiredPaths.length, 1);
  const completed = Math.max(0, total - missing);
  return {
    section,
    requiredFields: requiredPaths.length,
    totalFields: total,
    completedFields: completed,
    missingFields: missing,
    percent: total ? Math.round((completed / total) * 100) : 100,
    issues,
  };
}

class PersonalInformationValidator {
  static validate(profile) {
    const requiredPaths = ["person.firstName", "person.lastName", "person.dob", "person.citizenship"];
    const issues = required(profile, requiredPaths);
    if (!validDate(value(profile, "person.dob"))) issues.push(formatError("person.dob", "INVALID_DATE", "Date of birth must be a valid date"));
    const alien = value(profile, "person.alienNumber");
    if (alien && !/^A?\d{7,9}$/i.test(String(alien))) issues.push(formatError("person.alienNumber", "INVALID_ALIEN_NUMBER", "Alien number format is invalid"));
    return sectionResult("personal", requiredPaths, issues, 8);
  }
}

class ContactInformationValidator {
  static validate(profile) {
    const requiredPaths = ["contact.email", "contact.phone"];
    const issues = required(profile, requiredPaths);
    const email = value(profile, "contact.email");
    const phone = value(profile, "contact.phone");
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email))) issues.push(formatError("contact.email", "INVALID_EMAIL", "Email format is invalid"));
    if (phone && !/^[0-9+()\-.\s]{7,}$/.test(String(phone))) issues.push(formatError("contact.phone", "INVALID_PHONE", "Phone format is invalid", "warning"));
    return sectionResult("contact", requiredPaths, issues, 5);
  }
}

class PassportValidator {
  static validate(profile) {
    const requiredPaths = ["person.passport.number", "person.passport.country", "person.passport.expirationDate"];
    const issues = required(profile, requiredPaths);
    const passport = value(profile, "person.passport.number");
    const expiration = value(profile, "person.passport.expirationDate");
    if (passport && !/^[A-Z0-9]{5,20}$/i.test(String(passport))) issues.push(formatError("person.passport.number", "INVALID_PASSPORT_NUMBER", "Passport number format is invalid"));
    if (expiration && !validDate(expiration)) issues.push(formatError("person.passport.expirationDate", "INVALID_DATE", "Passport expiration date is invalid"));
    if (expiration && validDate(expiration)) {
      const days = (new Date(expiration).getTime() - Date.now()) / (1000 * 60 * 60 * 24);
      if (days < 0) issues.push(formatError("person.passport.expirationDate", "PASSPORT_EXPIRED", "Passport is expired"));
      else if (days < 180) issues.push(formatError("person.passport.expirationDate", "PASSPORT_EXPIRING_SOON", "Passport expires within 6 months", "warning"));
    }
    return sectionResult("passport", requiredPaths, issues, 5);
  }
}

class AddressValidator {
  static validate(profile) {
    const requiredPaths = ["contact.address.city", "contact.address.country"];
    const issues = required(profile, requiredPaths);
    const zip = value(profile, "contact.address.zip");
    if (zip && !/^[A-Z0-9\-\s]{3,12}$/i.test(String(zip))) issues.push(formatError("contact.address.zip", "INVALID_ZIP", "ZIP/postal code format is invalid", "warning"));
    return sectionResult("address", requiredPaths, issues, 6);
  }
}

class EmploymentValidator {
  static validate(profile) {
    const records = Array.isArray(profile.employment) ? profile.employment : [];
    const issues = [];
    records.forEach((job, index) => {
      if (!job.employer && !job.company) issues.push(formatError(`employment.${index}.employer`, "EMPLOYER_MISSING", "Employer is missing", "warning"));
      if (!job.startDate) issues.push(formatError(`employment.${index}.startDate`, "START_DATE_MISSING", "Employment start date is missing", "warning"));
      if (job.startDate && !validDate(job.startDate)) issues.push(formatError(`employment.${index}.startDate`, "INVALID_DATE", "Employment start date is invalid"));
    });
    if (!records.length) issues.push(formatError("employment", "EMPLOYMENT_HISTORY_MISSING", "Employment history is missing", "warning"));
    return sectionResult("employment", ["employment"], issues, Math.max(records.length * 3, 3));
  }
}

class EducationValidator {
  static validate(profile) {
    const records = Array.isArray(profile.education) ? profile.education : [];
    const issues = [];
    records.forEach((education, index) => {
      if (!education.institution && !education.school && !education.university) issues.push(formatError(`education.${index}.institution`, "INSTITUTION_MISSING", "Education institution is missing", "warning"));
      if (!education.degree) issues.push(formatError(`education.${index}.degree`, "DEGREE_MISSING", "Degree is missing", "warning"));
    });
    if (!records.length) issues.push(formatError("education", "EDUCATION_HISTORY_MISSING", "Education history is missing", "warning"));
    return sectionResult("education", ["education"], issues, Math.max(records.length * 2, 2));
  }
}

class ImmigrationHistoryValidator {
  static validate(profile) {
    const requiredPaths = ["immigration.currentStatus"];
    const issues = required(profile, requiredPaths);
    const receipt = value(profile, "immigration.receiptNumbers.0");
    if (receipt && !/^[A-Z]{3}\d{10}$/i.test(String(receipt))) issues.push(formatError("immigration.receiptNumbers.0", "INVALID_RECEIPT_NUMBER", "USCIS receipt number format is invalid", "warning"));
    return sectionResult("immigrationHistory", requiredPaths, issues, 5);
  }
}

class TravelHistoryValidator {
  static validate(profile) {
    const records = Array.isArray(profile.travelHistory) ? profile.travelHistory : [];
    const issues = [];
    records.forEach((travel, index) => {
      if (travel.arrivalDate && !validDate(travel.arrivalDate)) issues.push(formatError(`travelHistory.${index}.arrivalDate`, "INVALID_DATE", "Travel arrival date is invalid"));
      if (travel.departureDate && !validDate(travel.departureDate)) issues.push(formatError(`travelHistory.${index}.departureDate`, "INVALID_DATE", "Travel departure date is invalid"));
    });
    if (!records.length) issues.push(formatError("travelHistory", "TRAVEL_HISTORY_EMPTY", "Travel history is empty or not yet confirmed", "warning"));
    return sectionResult("travelHistory", [], issues, Math.max(records.length * 2, 1));
  }
}

class FamilyValidator {
  static validate(profile) {
    const members = Array.isArray(profile.family?.members) ? profile.family.members : [];
    const dependents = Array.isArray(profile.family?.dependents) ? profile.family.dependents : [];
    const issues = [];
    if (String(profile.person?.maritalStatus || "").toLowerCase() === "married" && !members.some((member) => /spouse/i.test(member.relationship || ""))) {
      issues.push(formatError("family.members", "SPOUSE_MISSING", "Marital status is married but spouse details are missing", "warning"));
    }
    return sectionResult("family", [], issues, Math.max(members.length + dependents.length, 1));
  }
}

class CompanyValidator {
  static validate(profile) {
    const requiredPaths = ["company.name"];
    const issues = required(profile, requiredPaths);
    const ein = value(profile, "company.ein");
    if (ein && !/^\d{2}-?\d{7}$/.test(String(ein))) issues.push(formatError("company.ein", "INVALID_EIN", "Company EIN format is invalid", "warning"));
    return sectionResult("company", requiredPaths, issues, 6);
  }
}

class PetitionerValidator {
  static validate(profile) {
    const requiredPaths = profile.case?.visaType && !/family|i-130/i.test(String(profile.case.visaType)) ? ["petitioner.name"] : [];
    const issues = required(profile, requiredPaths);
    return sectionResult("petitioner", requiredPaths, issues, Math.max(requiredPaths.length, 1));
  }
}

class BeneficiaryValidator {
  static validate(profile) {
    const requiredPaths = ["beneficiary.firstName", "beneficiary.lastName"];
    const issues = required(profile, requiredPaths).map((issue) => ({ ...issue, severity: "warning" }));
    return sectionResult("beneficiary", requiredPaths, issues, 6);
  }
}

class DocumentsValidator {
  static async validate(profile) {
    const documents = Array.isArray(profile.documents) ? profile.documents : [];
    // Same single resolver every other document-requirement read goes
    // through (DB-first, config-fallback) — no separate sync-only path.
    const requiredDocs = await resolveDocumentRequirementTypes(profile);
    const availableTypes = new Set(documents.filter((doc) => ["approved", "uploaded", "submitted", "under_review", "pending"].includes(doc.reviewStatus || doc.status || "uploaded")).map((doc) => doc.documentType));
    const issues = requiredDocs.filter((documentType) => !availableTypes.has(documentType)).map((documentType) => ({
      code: "REQUIRED_DOCUMENT_MISSING",
      path: `documents.${documentType}`,
      severity: "error",
      message: `${documentType} document is required`,
      suggestedFix: `Upload ${documentType}`,
    }));
    return sectionResult("documents", requiredDocs.map((doc) => `documents.${doc}`), issues, Math.max(requiredDocs.length, 1));
  }
}

class OcrValidator {
  static validate(profile, state = {}) {
    const metadata = state.fieldMetadata || {};
    const issues = Object.entries(metadata)
      .filter(([, item]) => item.sourceType === "ocr" && Number(item.confidence || 0) < 75)
      .map(([path, item]) => ({
        code: "LOW_OCR_CONFIDENCE",
        path,
        severity: "warning",
        message: `OCR confidence is low for ${path}`,
        confidence: item.confidence,
        suggestedFix: `Review OCR value for ${path}`,
      }));
    return sectionResult("ocr", [], issues, Math.max(Object.keys(metadata).length, 1));
  }
}

class USCISRequiredFieldsValidator {
  static validate(profile) {
    const requiredPaths = ["person.firstName", "person.lastName", "person.dob", "case.visaType"];
    const issues = required(profile, requiredPaths);
    return sectionResult("uscisRequiredFields", requiredPaths, issues, 10);
  }
}

module.exports = [
  PersonalInformationValidator,
  ContactInformationValidator,
  PassportValidator,
  AddressValidator,
  EmploymentValidator,
  EducationValidator,
  ImmigrationHistoryValidator,
  TravelHistoryValidator,
  FamilyValidator,
  CompanyValidator,
  PetitionerValidator,
  BeneficiaryValidator,
  DocumentsValidator,
  OcrValidator,
  USCISRequiredFieldsValidator,
];
