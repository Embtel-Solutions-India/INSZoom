// Single source for "what does this question mean" logic — conditional
// visibility, requiredness, validation, and small formatting helpers. Used by
// every questionnaire-rendering surface (QuestionnaireRenderer today; nothing
// else should re-implement this). Extracted verbatim from the old
// Pages/Dashboard/Intake.jsx CaseQuestionnaireIntake implementation — no
// logic changes, just relocated so it has exactly one owner.

export function clampPercent(value) {
  return Math.max(0, Math.min(100, Number(value || 0)));
}

export function sectionKey(section) {
  return section?.key || section?.sectionKey || section?.title?.toLowerCase().replace(/[^a-z0-9]+/g, "_") || "general";
}

export function questionKey(question) {
  return question?.key || question?.questionKey || question?._id;
}

export function titleFromKey(key) {
  return String(key || "General")
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

export function unwrapApiData(response) {
  return response?.data?.data || response?.data || response;
}

export function valueFromAnswers(answers = []) {
  return answers.reduce((result, answer) => {
    const key = answer.questionKey || answer.question?.key;
    if (key) result[key] = answer.value;
    return result;
  }, {});
}

// Answers auto-saved from an OCR extraction (any document type) sit in
// status "auto_saved" with mappingOutput.sourceType === "ocr" until the
// client confirms or edits them — that's what the prefill badge reads.
export function prefillMetaFromAnswers(answers = []) {
  return answers.reduce((result, answer) => {
    const key = answer.questionKey || answer.question?.key;
    if (key && answer.status === "auto_saved" && answer.mappingOutput?.sourceType === "ocr") {
      result[key] = { status: "pending", confidenceScore: answer.mappingOutput.confidenceScore, answerId: answer._id };
    }
    return result;
  }, {});
}

// Document types the H-1B OCR-autofill pipeline supports (must match
// Backend/src/modules/document-intelligence/config/autofill-document-types.js's
// AUTOFILL_DOCUMENT_TYPES exactly — these are the H-1B checklist's OWN
// document slot names, e.g. employmentChecklists.js's h1b.employeeDocuments,
// not the AI-classification-oriented type names like "i94"/"driver_license").
// Each entry lists real H-1B question keys (Question.key, e.g.
// "employee_personal_firstName" — confirmed against h1b.js's fieldCatalog()
// and Phase H1's already-verified golden case fixture) that document type
// can plausibly fill, so the Autofill button only shows up on a section that
// actually has a matching question — not a generic/legacy key list that
// never matches the real H-1B checklist (the prior version of this map used
// bare keys like "firstName"/"education" that don't exist anywhere in the
// real checklist, so no H-1B section ever showed an Autofill button at all).
export const AUTOFILL_SOURCES = {
  passport: [
    "employee_personal_firstName", "employee_personal_middleName", "employee_personal_lastName",
    "employee_personal_passportNumber", "employee_personal_passportIssueDate", "employee_personal_passportExpirationDate",
    "employee_personal_dateOfBirth", "employee_personal_gender",
    "employee_personal_countryOfCitizenship", "employee_personal_countryOfBirth",
  ],
  employee_i94_copy: [
    "employee_immigrationStatus_i94Number", "employee_immigrationStatus_dateOfLastArrival",
    "employee_immigrationStatus_currentVisaStatus", "employee_immigrationStatus_currentStatusExpirationDate",
  ],
  previous_i797_notices: [
    "employee_personal_latestPriorPetitionNumber", "employee_immigrationHistory_heldH1bLastSevenYears",
  ],
  updated_resume: [
    "employee_education_highestLevel", "employee_education_majorFieldOfStudy", "employee_education_usInstitutionName",
    "employee_education_degreeAwardDate", "employee_education_degreeType", "employee_education_hasUsMastersOrHigher",
  ],
  certified_lca_eta9035: [
    "employee_personal_firstName", "employee_personal_middleName", "employee_personal_lastName",
    "employee_personal_dateOfBirth", "employee_personal_gender", "employee_personal_countryOfBirth",
    "employee_personal_countryOfCitizenship", "employee_personal_alienRegistrationNumber",
    "employee_personal_passportNumber", "employee_personal_passportExpirationDate",
    "employer_company_fullName", "employer_company_fein", "employer_company_address_street",
    "employer_company_address_city", "employer_company_address_state", "employer_company_address_zipCode",
    "employer_company_daytimePhone", "employer_company_naicsCode", "employer_company_businessType",
    "employer_workforce_totalUsEmployees", "employer_position_socCode", "employer_position_jobTitle",
    "employer_position_wageLevel", "employer_position_offeredSalary", "employer_position_employmentStartDate",
  ],
  academic_certificates: [
    "employee_education_degreeType", "employee_education_majorFieldOfStudy",
    "employee_education_usInstitutionName", "employee_education_degreeAwardDate", "employee_education_institutionAddress",
  ],
  credential_evaluation_report: [
    "employee_education_degreeType", "employee_education_majorFieldOfStudy", "employee_education_hasUsMastersOrHigher",
  ],
  employee_drivers_license_or_state_id: [
    "employee_personal_currentUsAddress_street", "employee_personal_currentUsAddress_city",
    "employee_personal_currentUsAddress_state", "employee_personal_currentUsAddress_zipCode",
    "employee_immigrationStatus_hasDriverLicense",
  ],
};
export const AUTOFILL_LABELS = {
  passport: "passport",
  employee_i94_copy: "I-94",
  previous_i797_notices: "I-797 notice",
  updated_resume: "resume",
  certified_lca_eta9035: "LCA (ETA-9035)",
  academic_certificates: "academic certificate",
  credential_evaluation_report: "credential evaluation report",
  employee_drivers_license_or_state_id: "driver's license or state ID",
};

export function matchingAutofillSources(questions = []) {
  const keys = new Set(questions.map((question) => questionKey(question)));
  return Object.entries(AUTOFILL_SOURCES)
    .filter(([, fieldKeys]) => fieldKeys.some((key) => keys.has(key)))
    .map(([documentType]) => documentType);
}

export function normalizeOptions(options = []) {
  return (options || []).map((option) => {
    if (option && typeof option === "object") {
      return {
        label: option.label ?? String(option.value ?? ""),
        value: option.value ?? option.label,
      };
    }
    return { label: String(option), value: option };
  });
}

export function normalizeType(question) {
  const requestedType = question?.metadata?.requestedType || question?.type || "text";
  const aliases = {
    multiselect: "multi_select",
    "file-multiple": "file",
    datetime: "date",
    percent: "number",
    signature: "file",
    passport: "repeating_group",
    employment: "repeating_group",
    education: "repeating_group",
    person: "repeating_group",
    travel_history: "repeating_group",
    immigration_history: "repeating_group",
    visa: "repeating_group",
    i94: "repeating_group",
  };
  return aliases[requestedType] || requestedType;
}

// Any question that renders as a file upload (including "signature") is
// pulled off its normal section and shown on a dedicated Documents step
// within the questionnaire — this is what keeps conditional documents (e.g.
// "Upload FEIN Letter" when DOL verification = No) living inside the
// questionnaire instead of the reusable Documents page.
export function isFileQuestion(question) {
  return normalizeType(question) === "file";
}

export const DOCUMENTS_SECTION_KEY = "__documents__";

export function isEmptyValue(value) {
  if (value === undefined || value === null) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") return Object.values(value).every(isEmptyValue);
  return false;
}

export function compareValue(actual, operator, expected) {
  const normalizedOperator = operator || "equals";
  if (normalizedOperator === "exists") return !isEmptyValue(actual);
  if (normalizedOperator === "missing" || normalizedOperator === "not_exists") return isEmptyValue(actual);
  if (normalizedOperator === "contains") {
    if (Array.isArray(actual)) return actual.includes(expected);
    return String(actual ?? "").toLowerCase().includes(String(expected ?? "").toLowerCase());
  }
  if (normalizedOperator === "in") return Array.isArray(expected) && expected.includes(actual);
  if (normalizedOperator === "not_in") return Array.isArray(expected) && !expected.includes(actual);
  if (normalizedOperator === "not_equals") return actual !== expected;
  if (["gt", "gte", "lt", "lte", "greater_than", "less_than"].includes(normalizedOperator)) {
    const actualNumber = Number(actual);
    const expectedNumber = Number(expected);
    if (Number.isNaN(actualNumber) || Number.isNaN(expectedNumber)) return false;
    if (normalizedOperator === "gt" || normalizedOperator === "greater_than") return actualNumber > expectedNumber;
    if (normalizedOperator === "gte") return actualNumber >= expectedNumber;
    if (normalizedOperator === "lt" || normalizedOperator === "less_than") return actualNumber < expectedNumber;
    return actualNumber <= expectedNumber;
  }
  return actual === expected;
}

export function evaluateRule(rule, answers) {
  const key = rule?.questionKey || rule?.field || rule?.key;
  if (!key) return true;
  return compareValue(answers[key], rule.operator, rule.value);
}

export function evaluateCondition(condition, answers) {
  if (!condition) return true;
  if (condition.field || condition.questionKey || condition.key) return evaluateRule(condition, answers);
  const rules = Array.isArray(condition.rules) ? condition.rules : [];
  const groups = Array.isArray(condition.groups) ? condition.groups : [];
  if (!rules.length && !groups.length) return true;
  const evaluations = [
    ...rules.map((rule) => evaluateRule(rule, answers)),
    ...groups.map((group) => evaluateCondition(group, answers)),
  ];
  return condition.mode === "any" ? evaluations.some(Boolean) : evaluations.every(Boolean);
}

export function isQuestionVisible(question, answers) {
  if (question?.active === false || question?.isActive === false) return false;
  if (question?.type === "page_break" || question?.type === "section_break" || question?.type === "group") return false;
  return evaluateCondition(question?.conditionalLogic, answers) && evaluateCondition(question?.showIf, answers);
}

export function isQuestionRequired(question, answers) {
  const requiredByRule = (question?.validationRules || []).some((rule) => rule.type === "required");
  const requireWhen = question?.metadata?.requireWhen || question?.requiredWhen;
  return Boolean(question?.required || requiredByRule || (requireWhen && evaluateCondition(requireWhen, answers)));
}

// The role set that makes a case "employer-shaped" for the unified
// checklist page's multi-role architecture (handoff junction, rail
// grouping, etc.) — shared with Documents.jsx so the two files don't
// maintain separate copies of this list.
export const EMPLOYER_SHAPE_ROLES = ["employer", "business_plan", "employee"];

// Which checklistRole(s) the current viewer is allowed to see for a case —
// an access-boundary decision, not a visa-type one, so it does NOT gate on
// H-1B/L-1A or any other visa type: whatever checklists are actually
// assigned (listCaseChecklists, visa-agnostic) is the source of what
// exists; this only decides which of those a given login relationship
// (employer vs. employee vs. plain client) may see. An employer only sees
// the employee packet when they've been assigned to complete it themselves.
// Returns null for "no restriction" (show every assigned checklist).
export function resolveApplicableChecklistRoles(caseData, user) {
  // Family/sponsor visa (K-1/K-3) two-party path — additive, mirrors the
  // employer/employee branches below under separate field names (same
  // pattern already used server-side in applyCaseRoleFilter). Keyed off the
  // case's own relationship fields, not a visa-type string, matching this
  // function's existing "access-boundary, not visa-type" design — and
  // mutually exclusive with the employer/employee branch below, since a
  // case is never both shapes.
  if (caseData?.petitionerUser || caseData?.beneficiaryUser) {
    const userId = String(user?._id || "");
    const isPetitioner = Boolean(userId) && String(caseData.petitionerUser?._id || caseData.petitionerUser || "") === userId;
    const isBeneficiary = (Boolean(userId) && String(caseData.beneficiaryUser?._id || caseData.beneficiaryUser || "") === userId)
      || (String(user?.role || "").toLowerCase() === "beneficiary" && Boolean(caseData.beneficiaryInvite?.email) && caseData.beneficiaryInvite.email === user?.email);
    if (isPetitioner) {
      const roles = ["petitioner"];
      if (caseData.familyCompletionMode === "petitioner_completes") roles.push("beneficiary");
      return roles;
    }
    if (isBeneficiary) return ["beneficiary"];
  }

  const normalizedRole = String(user?.role || "client").toLowerCase();
  const intakeRole = caseData?.assessmentAnswers?.primaryApplicant;
  const effectiveRole = normalizedRole === "client" && (intakeRole === "employer" || intakeRole === "employee") ? intakeRole : normalizedRole;
  const assignmentMode = caseData?.questionnaireData?.masterData?.employeeQuestionnaireAssignment?.mode || "";
  if (effectiveRole === "employer") {
    const roles = ["employer", "business_plan"];
    if (assignmentMode === "employer_completes") roles.push("employee");
    return roles;
  }
  if (effectiveRole === "employee") return ["employee"];
  return null;
}

export function validateQuestion(question, value, answers) {
  if (!isQuestionVisible(question, answers)) return [];
  const errors = [];
  if (isQuestionRequired(question, answers) && isEmptyValue(value)) {
    errors.push("This field is required.");
  }
  (question.validationRules || []).forEach((rule) => {
    if (isEmptyValue(value)) return;
    if (rule.type === "minLength" && String(value).length < Number(rule.value)) errors.push(rule.message || `Minimum length is ${rule.value}.`);
    if (rule.type === "maxLength" && String(value).length > Number(rule.value)) errors.push(rule.message || `Maximum length is ${rule.value}.`);
    if (rule.type === "regex" && rule.value && !new RegExp(rule.value).test(String(value))) errors.push(rule.message || "Invalid format.");
    if (rule.type === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value))) errors.push(rule.message || "Enter a valid email.");
    if (rule.type === "phone" && !/^[+()\d\s.-]{7,}$/.test(String(value))) errors.push(rule.message || "Enter a valid phone number.");
  });
  return errors;
}
