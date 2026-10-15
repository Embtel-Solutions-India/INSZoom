// Which questions of a checklist that was authored "EVERYTHING optional" are REQUIRED to submit - the same convention the checklists that were never
// fully optional already follow (O-1 / H-1B / TN employee + employer checklists):
//   REQUIRED   the applicant's core identity (family + given name, date of birth, country of birth, country of citizenship, gender), ALL passport
//              information (passportInformation.js), the employer's core facts (company name, FEIN, type of business, year established, the signing
//              person's name + email, offered salary, job locations), the essential documents (passport copy, I-94, résumé), and every question that
//              DECIDES whether other questions apply (a gate: a "do you have a spouse?" left unanswered would silently drop what follows).
//   OPTIONAL   everything else - middle / other names, SSN, A-number, prior petition numbers, SEVIS / EAD, addresses' second lines, company size and
//              income, website, phone numbers, supporting evidence and "if any / if applicable" items.
// A question that is conditionally hidden is simply not asked, so it is not demanded either (visibility is judged where Submit is checked).
// Pure and deterministic: no DB. Applied once, in questionnaire.service.js, to every built-in definition whose questions are ALL flagged optional.
const { isPassportInformation } = require("./passportInformation");

const IDENTITY_PATH = /(^|\.)(person|beneficiary|petitioner|principalImmigrant|applicant|dependent)\.(lastName|firstName|dateOfBirth|dob|countryOfBirth|countryOfCitizenship|citizenship|gender|sex)$/i;
const IDENTITY_LABEL = /^(family name|last name|given name|first name|date of birth|country of birth|country of citizenship|gender|sex)\b/i;
// the petitioning company's core facts + the documents that prove it exists (articles, EIN letter, business license)
const EMPLOYER_PATH = /(^|\.)(company\.(name|ein|industry|yearEstablished)|company\.authorizedRepresentative\.(firstName|lastName|email)|employment\.(wage|workLocations)|(usCompany|company)\.documents\.(articlesOfIncorporation|einAssignmentLetter|businessLicense))$/i;
const ESSENTIAL_DOCUMENT = /(^|[._\s-])(i-?94|resume|passport)(?![a-z])/i;
const OPTIONAL_WORDING = /\b(if any|if applicable|optional|other names|maiden)\b|middle name|alien registration|\ba-?number\b|social security|\bssn\b|sevis|employment authorization|\bead\b|prior petition|apt\.?|suite|unit\b/i;

const isFlaggedOptional = (question) => Boolean(question?.metadata?.optional);

function referencedKeys(questions) {
  const keys = new Set();
  const visit = (group) => {
    if (!group || typeof group !== "object") return;
    (group.rules || []).forEach((rule) => { const key = rule?.questionKey || rule?.field || rule?.key; if (key) keys.add(key); });
    (group.groups || []).forEach(visit);
  };
  questions.forEach((question) => visit(question.conditionalLogic));
  return keys;
}

/** Is this question required, by the rules above? (`gates` = the keys other questions' conditions refer to) */
function isRequiredByLogic(question, gates = new Set()) {
  if (!question || ["page_break", "section_break", "group"].includes(question.type)) return false;
  const path = question.mapping?.canonicalPath || question.canonicalPath || "";
  const text = `${question.label || ""}`;
  if (isPassportInformation(question)) return true;
  if (OPTIONAL_WORDING.test(text) && !gates.has(question.key)) return false;
  if (IDENTITY_PATH.test(path) || (!path && IDENTITY_LABEL.test(text.trim()))) return true;
  if (EMPLOYER_PATH.test(path)) return true;
  if (question.type === "file" && ESSENTIAL_DOCUMENT.test(`${question.key || ""} ${path} ${text}`)) return true;
  return gates.has(question.key);
}

const isFullyOptional = (definition) => Array.isArray(definition?.questions) && definition.questions.length > 0 && definition.questions.every(isFlaggedOptional);

/** Marks the required questions of ONE fully-optional definition (in place). Returns the keys it made required. */
function applyRequirementLogic(definition) {
  if (!isFullyOptional(definition)) return [];
  const gates = referencedKeys(definition.questions);
  const made = [];
  for (const question of definition.questions) {
    if (!isRequiredByLogic(question, gates)) continue;
    question.required = true;
    const { optional, ...rest } = question.metadata || {};
    question.metadata = { ...rest, requirement: "required" };
    made.push(question.key);
  }
  return made;
}

/** Applies it to every definition of a list; returns { definitionKey: [requiredKeys] } for the ones changed. */
function applyRequirementLogicToAll(definitions) {
  const changed = {};
  for (const definition of definitions) {
    const made = applyRequirementLogic(definition);
    if (made.length) changed[definition.key] = made;
  }
  return changed;
}

module.exports = { isRequiredByLogic, isFullyOptional, applyRequirementLogic, applyRequirementLogicToAll, referencedKeys };
