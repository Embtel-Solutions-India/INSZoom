// I-130 (Petition for Alien Relative) as a STANDALONE two-party case type: the requiredness / applicability rules of the supplied "I-130 Petitioner Checklist" and
// "I-130 Beneficiary Checklist" (+ their document lists), applied on top of the business's verbatim I-130 questionnaire that already exists
// (family-workflow/questionnaires/familyBasedImmigrantPetition.js, `i130`).
//
// What this file does NOT do, on purpose: it never renames a question key or changes a canonical path. Every question keeps the key it has always had, so the canonical
// paths the I-130 / I-130A / I-864 / I-485 ... form mappings already read (partyChecklistPaths.js) keep feeding every form. It only changes WHEN a question is shown and
// WHEN it is required, using the engine's own mechanisms:
//   * `required: true`                a visible question that must be answered before Submit (a hidden question never counts);
//   * conditionalLogic.rules          the question is shown only when the rule holds (so it is required only then);
//   * metadata.requireWhen            always shown, required only while the rule holds;
//   * `required: false`               optional (nothing is required to SAVE: Save progress always works).
// An unanswered conditional question is never treated as a confirmed "No".
//
// Spec items kept as the existing shape (documented in docs/I130_PETITIONER_BENEFICIARY_CHECKLIST_INTEGRATION_REPORT.md): addresses stay the existing text answers the
// forms read; "date and place of naturalization" stays one answer; prior petitions stay one answer with details; those are mapping-side changes, not requiredness rules.
const ruleGroup = (...rules) => ({ mode: "all", rules, groups: [] });
const rule = (questionKey, operator, value) => (value === undefined ? { questionKey, operator } : { questionKey, operator, value });

const MARITAL_OPTIONS = [
  { label: "Single (never married)", value: "Single" },
  { label: "Married", value: "Married" },
  { label: "Divorced", value: "Divorced" },
  { label: "Widowed", value: "Widowed" },
  { label: "Separated", value: "Separated" },
  { label: "Annulled", value: "Annulled" },
];

const REQUIRED = { required: true };
const OPTIONAL = { required: false };
const requiredWhen = (...rules) => ({ required: false, requireWhen: ruleGroup(...rules) });
const shownWhen = (...rules) => ({ required: true, showWhen: ruleGroup(...rules) });

const SPOUSE_RELATIONSHIP = "Husband/wife"; // the value the "I am filing for my" answer stores (it also feeds Case.petitionSubType, which the I-130A trigger reads)

function petitionerRules() {
  const married = rule("petitioner_maritalStatus", "equals", "Married");
  return {
    // A. relationship
    petitioner_relationship: REQUIRED,
    // B. petitioner information
    petitioner_lastName: REQUIRED,
    petitioner_firstName: REQUIRED,
    petitioner_middleName: OPTIONAL,
    petitioner_otherNamesUsed: OPTIONAL,
    petitioner_mailingAddress: REQUIRED,
    petitioner_physicalAddress: OPTIONAL, // only "if different from the mailing address"
    petitioner_cityCountryOfBirth: REQUIRED,
    petitioner_dateOfBirth: REQUIRED,
    petitioner_gender: REQUIRED,
    petitioner_ssn: OPTIONAL, // depends on status and the existing identifier validation; never forced
    petitioner_alienNumber: OPTIONAL,
    petitioner_maritalStatus: { required: true, type: "select", options: MARITAL_OPTIONS },
    petitioner_currentSpouseName: requiredWhen(married),
    petitioner_currentMarriageDate: requiredWhen(married),
    petitioner_currentMarriagePlace: requiredWhen(married),
    petitioner_priorSpouses: OPTIONAL, // zero previous marriages is a valid answer
    petitioner_fatherFullName: REQUIRED,
    petitioner_fatherDateOfBirth: OPTIONAL,
    petitioner_fatherCountryOfBirth: OPTIONAL,
    petitioner_fatherResidence: OPTIONAL,
    petitioner_motherFullName: REQUIRED,
    petitioner_motherDateOfBirth: OPTIONAL,
    petitioner_motherCountryOfBirth: OPTIONAL,
    petitioner_motherResidence: OPTIONAL,
    petitioner_height: OPTIONAL,
    petitioner_weight: OPTIONAL,
    petitioner_eyeColor: OPTIONAL,
    petitioner_hairColor: OPTIONAL,
    // D. citizenship / permanent residence (mutually exclusive: a lawful permanent resident has no citizenship basis to give)
    petitioner_citizenshipBasis: requiredWhen(rule("petitioner_isLawfulPermanentResident", "not_equals", "Yes")),
    petitioner_naturalizationCertificateNumber: REQUIRED, // shown only when the basis is "By Naturalization" (the question's existing rule)
    petitioner_naturalizationDateAndPlace: REQUIRED,
    petitioner_isLawfulPermanentResident: REQUIRED,
    petitioner_lprGainedThroughMarriage: shownWhen(rule("petitioner_isLawfulPermanentResident", "equals", "Yes")),
    // E / F. histories (any number of records)
    petitioner_employmentHistory: REQUIRED,
    petitioner_addressHistory: REQUIRED,
    // G. sponsor financials
    petitioner_sponsorsMaritalStatus: { required: true, type: "select", options: MARITAL_OPTIONS },
    petitioner_numberOfDependentKids: REQUIRED, // zero is allowed
    petitioner_numberOfOtherDependents: REQUIRED,
    petitioner_currentAnnualIncome: REQUIRED,
    petitioner_taxYear1Income: OPTIONAL, // "if the tax-year information is available / applicable"
    petitioner_taxYear2Income: OPTIONAL,
    petitioner_taxYear3Income: OPTIONAL,
    petitioner_savingsAndCheckingBalance: OPTIONAL,
    petitioner_realEstateNetCashValue: OPTIONAL,
    petitioner_stocksBondsNetCashValue: OPTIONAL,
    // prior petitions
    petitioner_priorPetitionFiled: REQUIRED,
    petitioner_priorPetitionDetails: REQUIRED, // shown only when the answer above is Yes (the question's existing rule)
    // petitioner documents
    petitioner_passport_copy: REQUIRED,
    petitioner_naturalization_citizenship_or_birth_certificate: requiredWhen(rule("petitioner_citizenshipBasis", "not_empty")), // when documenting U.S. citizenship
    petitioner_green_card_front_back: shownWhen(rule("petitioner_isLawfulPermanentResident", "equals", "Yes")),
    petitioner_ssn_copy: requiredWhen(rule("petitioner_ssn", "not_empty")), // when the petitioner has an SSN
    petitioner_state_id_or_drivers_license: REQUIRED,
    petitioner_marriage_certificate: shownWhen(rule("petitioner_relationship", "equals", SPOUSE_RELATIONSHIP)), // only when filing for a spouse
    petitioner_marriage_termination_documents: requiredWhen(rule("petitioner_priorSpouses", "not_empty")), // when a previous marriage is listed
    petitioner_birth_certificate: shownWhen(rule("petitioner_relationship", "equals", "Parent")), // only when filing for a parent
    petitioner_passport_photo: REQUIRED,
  };
}

function beneficiaryRules() {
  const married = rule("beneficiary_maritalStatus", "equals", "Married");
  return {
    beneficiary_firstName: REQUIRED,
    beneficiary_middleName: OPTIONAL,
    beneficiary_lastName: REQUIRED,
    beneficiary_physicalAddress: REQUIRED,
    beneficiary_dateOfBirth: REQUIRED,
    beneficiary_cityStateCountryOfBirth: REQUIRED,
    beneficiary_ssn: OPTIONAL,
    beneficiary_alienNumber: OPTIONAL,
    beneficiary_maritalStatus: { required: true, type: "select", options: MARITAL_OPTIONS },
    beneficiary_currentSpouseName: requiredWhen(married),
    beneficiary_currentMarriageDate: requiredWhen(married),
    beneficiary_currentMarriagePlace: requiredWhen(married),
    // never entered the U.S. => none of these may block completion
    beneficiary_arrivalStatus: OPTIONAL,
    beneficiary_i94Number: OPTIONAL,
    beneficiary_lastDateOfArrival: OPTIONAL,
    beneficiary_statusExpiresOn: OPTIONAL,
    // current employment: the details are required only once an employer is named
    beneficiary_currentEmployerName: OPTIONAL,
    beneficiary_currentEmployerAddress: requiredWhen(rule("beneficiary_currentEmployerName", "not_empty")),
    beneficiary_employmentBeganDate: requiredWhen(rule("beneficiary_currentEmployerName", "not_empty")),
    beneficiary_underImmigrationProceedings: REQUIRED,
    beneficiary_priorSpouses: OPTIONAL,
    beneficiary_familyMembers: OPTIONAL,
    // addresses: required "when known / applicable" - never forced
    beneficiary_usAddress: OPTIONAL,
    beneficiary_foreignAddress: OPTIONAL,
    beneficiary_lastSharedAddress: OPTIONAL, // applicable only when the petitioner files for a spouse (that answer is in the petitioner's checklist)
    beneficiary_adjustmentOfficeCity: OPTIONAL,
    beneficiary_adjustmentOfficeState: OPTIONAL,
    // beneficiary documents
    beneficiary_passport_copy: REQUIRED,
    beneficiary_birth_certificate: REQUIRED,
    beneficiary_marriage_certificate: requiredWhen(married),
    beneficiary_passport_photo: REQUIRED,
    beneficiary_national_identity_card: OPTIONAL,
  };
}

function applyRules(definition, table) {
  const seen = new Set();
  const questions = definition.questions.map((question) => {
    const change = table[question.key];
    if (!change) return question;
    seen.add(question.key);
    const next = { ...question, required: Boolean(change.required) };
    if (change.type) next.type = change.type;
    if (change.options) next.options = change.options;
    const metadata = { ...(question.metadata || {}) };
    if (change.requireWhen) metadata.requireWhen = change.requireWhen;
    else delete metadata.requireWhen;
    if (!change.required && !change.requireWhen) metadata.optional = true; // an optional question can never be required, not even by a stray rule
    else delete metadata.optional;
    next.metadata = metadata;
    if (change.showWhen) {
      const existing = (question.conditionalLogic && question.conditionalLogic.rules) || [];
      next.conditionalLogic = { mode: "all", rules: [...existing, ...change.showWhen.rules], groups: (question.conditionalLogic && question.conditionalLogic.groups) || [] };
    }
    return next;
  });
  const missing = Object.keys(table).filter((key) => !seen.has(key));
  if (missing.length) throw new Error(`I-130 checklist rules name questions that do not exist: ${missing.join(", ")}`);
  return { ...definition, questions };
}

const applyPetitionerRules = (definition) => applyRules(definition, petitionerRules());
const applyBeneficiaryRules = (definition) => applyRules(definition, beneficiaryRules());

module.exports = { applyPetitionerRules, applyBeneficiaryRules, petitionerRules, beneficiaryRules, MARITAL_OPTIONS, SPOUSE_RELATIONSHIP };
