// Form I-907 (Request for Premium Processing Service) - Information Checklist.
//
// ONE checklist, reached two ways, never two copies:
//   1. A standalone "Premium Processing" case (config/visaCategories.js): the client wants only
//      the expedite request. isDefault + visaTypes ["PremiumProcessing"] + checklistRole "client",
//      so it is auto-resolved the moment such a case exists - the same single-party mechanism
//      Green Card Renewal / SB-1 / H-4 use - and Form I-907 is the only form on the case.
//   2. An optional add-on on ANY other case: a Case Manager upgrades the case
//      (case.controller.js upgradeToPremiumProcessing), which assigns this same checklist as an
//      explicit staffRequest reference. The client portal shows it in its own section below the
//      case's regular checklists; Admin shows the same answers on the case's Documents tab.
//
// Field keys / destinations / required rules follow the approved "I-907 checklist -> form mapping"
// table. The question key is the field path with "." -> "_" (i907.filer.last_name ->
// i907_filer_last_name), the same convention PERM uses. The I-907 mapping graph
// (form-mapping/config/i907-crosswalk.js) reads each answer from
// raw.questionnaireAnswers.<question key>.value; a unit test asserts every crosswalk source key
// exists here, so the two cannot drift.
//
// Same Questionnaire key as the earlier profile-only I-907 checklist, whose questions are retired
// by the reconciler (never deleted).

const { buildQuestion } = require("./definitionHelpers");
const { US_STATES, COUNTRIES } = require("../../config/geoOptions");

const CHECKLIST_KEY = "i907_premium_processing_profile";
const PREMIUM_PROCESSING_VISA_TYPES = ["PremiumProcessing"];

const PART1 = "Information About the Person Filing This Request";
const PART2 = "Information About the Request";

const YES_NO = [{ label: "Yes", value: "Yes" }, { label: "No", value: "No" }];
const countries = COUNTRIES.map((value) => ({ label: value, value }));
// Premium Processing is offered for these related filings (Form I-907 Part 2, Item 1).
const RELATED_FORMS = ["I-129", "I-140", "I-539", "I-765", "I-131", "I-290B", "Other"];

const key = (path) => path.replace(/\./g, "_");
const rule = (path, operator, value) => ({ questionKey: key(path), operator, ...(value === undefined ? {} : { value }) });
const when = (...rules) => ({ mode: "all", rules, groups: [] });

const MAILING_COUNTRY = "i907.mailing_address.country";
const PHYSICAL_COUNTRY = "i907.physical_address.country";
const SAME = "i907.address.same_as_physical";
const COMPANY = "i907.related_case.company_name";

const IS_US = (path) => rule(path, "equals", "United States");
const HAS_COUNTRY = (path) => rule(path, "not_empty");
const NOT_US = (path) => rule(path, "not_equals", "United States");
const DIFFERS = rule(SAME, "equals", "No");
const HAS_COMPANY = rule(COMPANY, "not_empty");

const ZIP_RULE = { type: "regex", value: "^\\d{5}(-\\d{4})?$", message: "Enter a 5-digit ZIP code (or ZIP+4)." };
const A_NUMBER_RULE = { type: "regex", value: "^[Aa]?-?\\d{7,9}$", message: "A-Number is 7 to 9 digits, for example A123456789." };
const ONLINE_ACCOUNT_RULE = { type: "regex", value: "^\\d{12}$", message: "A USCIS Online Account Number is 12 digits." };
const EIN_RULE = { type: "regex", value: "^\\d{2}-?\\d{7}$", message: "EIN must be 9 digits, for example 12-3456789." };
const RECEIPT_RULE = { type: "regex", value: "^[A-Za-z]{3}[- ]?\\d{2}[- ]?\\d{3}[- ]?\\d{5}$", message: "A receipt number is 3 letters followed by 10 digits, for example EAC1234567890." };

// { path, label, type, required, ... } in the order of the official checklist.
const PART1_QUESTIONS = [
  { path: "i907.filer.alien_registration_number", label: "Alien Registration Number (A-Number) (if any)", type: "text", rules: [A_NUMBER_RULE] },
  { path: "i907.filer.uscis_online_account_number", label: "USCIS Online Account Number (if any)", type: "text", rules: [ONLINE_ACCOUNT_RULE] },
  { path: "i907.filer.last_name", label: "Family Name (Last Name)", type: "text", required: true },
  { path: "i907.filer.first_name", label: "Given Name (First Name)", type: "text", required: true },
  { path: COMPANY, label: "Company or Organization Named in the Related Case (if filed on behalf of a company or organization)", type: "text" },

  { path: "i907.mailing_address.street", label: "Mailing Address - Street Number and Name", type: "text", required: true },
  { path: "i907.mailing_address.unit", label: "Mailing Address - Apt/Ste/Flr", type: "text" },
  { path: "i907.mailing_address.city", label: "Mailing Address - City or Town", type: "text", required: true },
  { path: "i907.mailing_address.state", label: "Mailing Address - State", type: "select", required: true, options: US_STATES, logic: when(IS_US(MAILING_COUNTRY)) },
  { path: "i907.mailing_address.zip_code", label: "Mailing Address - ZIP Code", type: "text", required: true, rules: [ZIP_RULE], logic: when(IS_US(MAILING_COUNTRY)) },
  { path: "i907.mailing_address.province", label: "Mailing Address - Province", type: "text", required: true, logic: when(HAS_COUNTRY(MAILING_COUNTRY), NOT_US(MAILING_COUNTRY)) },
  { path: "i907.mailing_address.postal_code", label: "Mailing Address - Postal Code", type: "text", required: true, logic: when(HAS_COUNTRY(MAILING_COUNTRY), NOT_US(MAILING_COUNTRY)) },
  { path: MAILING_COUNTRY, label: "Mailing Address - Country", type: "select", required: true, options: countries },

  { path: SAME, label: "Is your current mailing address the same as your physical address?", type: "radio", required: true, options: YES_NO },
  { path: "i907.physical_address.street", label: "Physical Address - Street Number and Name", type: "text", required: true, logic: when(DIFFERS) },
  { path: "i907.physical_address.unit", label: "Physical Address - Apt/Ste/Flr", type: "text", logic: when(DIFFERS) },
  { path: "i907.physical_address.city", label: "Physical Address - City or Town", type: "text", required: true, logic: when(DIFFERS) },
  { path: "i907.physical_address.state", label: "Physical Address - State", type: "select", required: true, options: US_STATES, logic: when(DIFFERS, IS_US(PHYSICAL_COUNTRY)) },
  { path: "i907.physical_address.zip_code", label: "Physical Address - ZIP Code", type: "text", required: true, rules: [ZIP_RULE], logic: when(DIFFERS, IS_US(PHYSICAL_COUNTRY)) },
  { path: "i907.physical_address.province", label: "Physical Address - Province", type: "text", required: true, logic: when(DIFFERS, HAS_COUNTRY(PHYSICAL_COUNTRY), NOT_US(PHYSICAL_COUNTRY)) },
  { path: "i907.physical_address.postal_code", label: "Physical Address - Postal Code", type: "text", required: true, logic: when(DIFFERS, HAS_COUNTRY(PHYSICAL_COUNTRY), NOT_US(PHYSICAL_COUNTRY)) },
  { path: PHYSICAL_COUNTRY, label: "Physical Address - Country", type: "select", required: true, options: countries, logic: when(DIFFERS) },
];

const PART2_QUESTIONS = [
  { path: "i907.related_case.form_number", label: "Form Number of Related Petition or Application", type: "select", required: true, options: RELATED_FORMS },
  { path: "i907.related_case.receipt_number", label: "Receipt Number of Related Petition or Application", type: "text", required: true, rules: [RECEIPT_RULE] },
  { path: "i907.petitioner.last_name", label: "Petitioner or Applicant in the Related Case - Family Name (Last Name)", type: "text", required: true },
  { path: "i907.petitioner.first_name", label: "Petitioner or Applicant in the Related Case - Given Name (First Name)", type: "text", required: true },
  { path: "i907.beneficiary.last_name", label: "Beneficiary in the Related Case - Family Name (Last Name)", type: "text", required: true },
  { path: "i907.beneficiary.first_name", label: "Beneficiary in the Related Case - Given Name (First Name)", type: "text", required: true },
  { path: "i907.company_poc.last_name", label: "Name of Point of Contact for the Company or Organization - Family Name (Last Name)", type: "text", required: true, logic: when(HAS_COMPANY) },
  { path: "i907.company_poc.first_name", label: "Name of Point of Contact for the Company or Organization - Given Name (First Name)", type: "text", required: true, logic: when(HAS_COMPANY) },
  { path: "i907.company_poc.position_title", label: "Name of Point of Contact for the Company or Organization - Position Title", type: "text", required: true, logic: when(HAS_COMPANY) },
  { path: "i907.company.ein", label: "Company or Organization IRS Employer Identification Number (EIN)", type: "text", required: true, rules: [EIN_RULE], logic: when(HAS_COMPANY) },
];

function toQuestions(specs, section) {
  return specs.map((spec, index) => buildQuestion(key(spec.path), spec.label, spec.type, section, index + 1, {
    required: spec.required,
    options: spec.options,
    conditionalLogic: spec.logic,
    validationRules: spec.rules,
    metadata: { sourcePath: spec.path },
  }));
}

function buildPremiumProcessingChecklist() {
  return {
    key: CHECKLIST_KEY,
    // This Questionnaire already exists in the DB (as the earlier profile-only checklist) - ask the
    // default-template reconciler to also bring its title / visaType / checklistRole / isDefault up
    // to date in place.
    reconcileMetadata: true,
    title: "Form I-907 Information Checklist",
    visaType: "PremiumProcessing",
    visaTypes: PREMIUM_PROCESSING_VISA_TYPES,
    checklistRole: "client",
    isDefault: true,
    description: "Information used to prepare Form I-907, Request for Premium Processing Service, for a related petition or application.",
    sections: [PART1, PART2],
    questions: [...toQuestions(PART1_QUESTIONS, PART1), ...toQuestions(PART2_QUESTIONS, PART2)],
  };
}

const PREMIUM_PROCESSING_DEFINITIONS = [buildPremiumProcessingChecklist()];

module.exports = {
  CHECKLIST_KEY,
  PREMIUM_PROCESSING_VISA_TYPES,
  PREMIUM_PROCESSING_DEFINITIONS,
  buildPremiumProcessingChecklist,
  PART1_QUESTIONS,
  PART2_QUESTIONS,
  questionKeyForPath: key,
};
