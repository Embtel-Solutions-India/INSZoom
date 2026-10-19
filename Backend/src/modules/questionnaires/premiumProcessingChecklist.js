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
const MAILING = "Mailing Address";
const PHYSICAL = "Physical Address";
const PART2 = "Information About the Request";
const DOCUMENTS = "Required Document";

const YES_NO = [{ label: "Yes", value: "Yes" }, { label: "No", value: "No" }];
const countries = COUNTRIES.map((value) => ({ label: value, value }));
// Related filings Premium Processing is offered for (Form I-907 Part 2, Item 1). Every one is a form of the existing USCIS registry (an active
// USCISFormTemplate and a VisaFormMapping that sits beside I-907 on the same visa types) - a test asserts that, so no form number is invented.
// The question itself is a free-text box (the client types the form number), so this list no longer limits what can be answered: it only drives
// which typed form numbers count as "has a beneficiary" (FORMS_WITH_BENEFICIARY) and what the registry test checks.
const RELATED_FORMS = ["I-129", "I-140", "I-539", "I-765", "I-131"];
// Of those, the filings that have a beneficiary distinct from the filer (I-539 / I-765 / I-131 are filed by the person themself).
const FORMS_WITH_BENEFICIARY = ["I-129", "I-140"];

const key = (path) => path.replace(/\./g, "_");
const rule = (path, operator, value) => ({ questionKey: key(path), operator, ...(value === undefined ? {} : { value }) });
const when = (...rules) => ({ mode: "all", rules, groups: [] });

const MAILING_COUNTRY = "i907.mailing_address.country";
const PHYSICAL_COUNTRY = "i907.physical_address.country";
const SAME = "i907.address.same_as_physical";
const COMPANY = "i907.related_case.company_name";
const FORM_NUMBER = "i907.related_case.form_number";

const IS_US = (path) => rule(path, "equals", "United States");
const HAS_COUNTRY = (path) => rule(path, "not_empty");
const NOT_US = (path) => rule(path, "not_equals", "United States");
const DIFFERS = rule(SAME, "equals", "No");
const HAS_COMPANY = rule(COMPANY, "not_empty");
// The form number is typed, so "I-129", "i-129", "I129" and "Form I-129" must all count: one "any" group of case/dash variants (the shared
// condition evaluator already supports nested groups; "contains" is a plain substring test).
const FORM_NUMBER_VARIANTS = FORMS_WITH_BENEFICIARY.flatMap((form) => [form, form.replace("-", ""), form.toLowerCase(), form.replace("-", "").toLowerCase()]);
const BENEFICIARY_GROUP = { mode: "any", rules: FORM_NUMBER_VARIANTS.map((variant) => rule(FORM_NUMBER, "contains", variant)), groups: [] };
const WHEN_BENEFICIARY = { mode: "all", rules: [], groups: [BENEFICIARY_GROUP] };

const ZIP_RULE = { type: "regex", value: "^\\d{5}(-\\d{4})?$", message: "Enter a 5-digit ZIP code (or ZIP+4)." };
const A_NUMBER_RULE = { type: "regex", value: "^[Aa]?-?\\d{7,9}$", message: "A-Number is 7 to 9 digits, for example A123456789." };
const ONLINE_ACCOUNT_RULE = { type: "regex", value: "^\\d{12}$", message: "A USCIS Online Account Number is 12 digits." };
const EIN_RULE = { type: "regex", value: "^\\d{2}-?\\d{7}$", message: "EIN must be 9 digits, for example 12-3456789." };
const FORM_NUMBER_RULE = { type: "regex", value: "^\\s*(?:[Ff]orm\\s+)?[Ii]\\s?-?\\s?\\d{2,3}[A-Za-z]?\\s*$", message: "Enter the form number, for example I-129." };
const RECEIPT_RULE = { type: "regex", value: "^[A-Za-z]{3}[- ]?\\d{2}[- ]?\\d{3}[- ]?\\d{5}$", message: "A receipt number is 3 letters followed by 10 digits, for example EAC1234567890." };

// { path, label, type, required, optional, canonical, ref, ... } in the order of the specification. "required: true" is the specification's
// requirement; "optional: true" additionally lets Submit go through without an answer (metadata.optional), which is what makes "Optional" real:
// by default this platform needs every visible question answered to submit. The question key is the field path with "." -> "_" and is stable:
// the I-907 mapping graph reads each answer by that key.
const PART1_QUESTIONS = [
  { path: "i907.filer.alien_registration_number", label: "Alien Registration Number (A-Number) (if any)", type: "text", optional: true, rules: [A_NUMBER_RULE], canonical: "requestFiler.alienNumber", ref: "Part 1, Item 1", sensitive: true },
  { path: "i907.filer.uscis_online_account_number", label: "USCIS Online Account Number (if any)", type: "text", optional: true, rules: [ONLINE_ACCOUNT_RULE], canonical: "requestFiler.uscisOnlineAccountNumber", ref: "Part 1, Item 2" },
  { path: "i907.filer.last_name", label: "Family Name (Last Name)", type: "text", required: true, canonical: "requestFiler.lastName", ref: "Part 1, Item 3.a" },
  { path: "i907.filer.first_name", label: "Given Name (First Name)", type: "text", required: true, canonical: "requestFiler.firstName", ref: "Part 1, Item 3.b" },
  { path: COMPANY, label: "Company or Organization Named in the Related Case (If filed on behalf of a company or organization)", type: "text", optional: true, canonical: "premiumProcessing.companyOrOrganizationName", ref: "Part 1, Item 4" },
];

const MAILING_QUESTIONS = [
  { path: "i907.mailing_address.street", label: "Street Number and Name", type: "text", required: true, canonical: "requestFiler.mailingAddress.streetAddress", ref: "Part 1, Item 5.a" },
  { path: "i907.mailing_address.unit", label: "Apt/Ste/Flr", type: "text", optional: true, canonical: "requestFiler.mailingAddress.addressLine2", ref: "Part 1, Item 5.b" },
  { path: "i907.mailing_address.city", label: "City or Town", type: "text", required: true, canonical: "requestFiler.mailingAddress.city", ref: "Part 1, Item 5.c" },
  { path: "i907.mailing_address.state", label: "State", type: "select", required: true, options: US_STATES, logic: when(IS_US(MAILING_COUNTRY)), canonical: "requestFiler.mailingAddress.state", ref: "Part 1, Item 5.d" },
  { path: "i907.mailing_address.zip_code", label: "ZIP Code", type: "text", required: true, rules: [ZIP_RULE], logic: when(IS_US(MAILING_COUNTRY)), canonical: "requestFiler.mailingAddress.zipCode", ref: "Part 1, Item 5.e" },
  { path: "i907.mailing_address.province", label: "Province", type: "text", optional: true, logic: when(HAS_COUNTRY(MAILING_COUNTRY), NOT_US(MAILING_COUNTRY)), canonical: "requestFiler.mailingAddress.province", ref: "Part 1, Item 5.f" },
  { path: "i907.mailing_address.postal_code", label: "Postal Code", type: "text", optional: true, logic: when(HAS_COUNTRY(MAILING_COUNTRY), NOT_US(MAILING_COUNTRY)), canonical: "requestFiler.mailingAddress.postalCode", ref: "Part 1, Item 5.g" },
  { path: MAILING_COUNTRY, label: "Country", type: "select", required: true, options: countries, canonical: "requestFiler.mailingAddress.country", ref: "Part 1, Item 5.h" },
];

const PHYSICAL_QUESTIONS = [
  { path: SAME, label: "Is your current mailing address the same as your physical address?", type: "radio", required: true, options: YES_NO, canonical: "requestFiler.physicalAddress.sameAsMailingAddress", ref: "Part 1, Item 6" },
  { path: "i907.physical_address.street", label: "Street Number and Name", type: "text", required: true, logic: when(DIFFERS), canonical: "requestFiler.physicalAddress.streetAddress", ref: "Part 1, Item 7.a" },
  { path: "i907.physical_address.unit", label: "Apt. Ste. Flr.", type: "text", optional: true, logic: when(DIFFERS), canonical: "requestFiler.physicalAddress.addressLine2", ref: "Part 1, Item 7.b" },
  { path: "i907.physical_address.city", label: "City or Town", type: "text", required: true, logic: when(DIFFERS), canonical: "requestFiler.physicalAddress.city", ref: "Part 1, Item 7.c" },
  { path: "i907.physical_address.state", label: "State", type: "select", required: true, options: US_STATES, logic: when(DIFFERS, IS_US(PHYSICAL_COUNTRY)), canonical: "requestFiler.physicalAddress.state", ref: "Part 1, Item 7.d" },
  { path: "i907.physical_address.zip_code", label: "ZIP Code", type: "text", required: true, rules: [ZIP_RULE], logic: when(DIFFERS, IS_US(PHYSICAL_COUNTRY)), canonical: "requestFiler.physicalAddress.zipCode", ref: "Part 1, Item 7.e" },
  { path: "i907.physical_address.province", label: "Province", type: "text", optional: true, logic: when(DIFFERS, HAS_COUNTRY(PHYSICAL_COUNTRY), NOT_US(PHYSICAL_COUNTRY)), canonical: "requestFiler.physicalAddress.province", ref: "Part 1, Item 7.f" },
  { path: "i907.physical_address.postal_code", label: "Postal Code", type: "text", optional: true, logic: when(DIFFERS, HAS_COUNTRY(PHYSICAL_COUNTRY), NOT_US(PHYSICAL_COUNTRY)), canonical: "requestFiler.physicalAddress.postalCode", ref: "Part 1, Item 7.g" },
  { path: PHYSICAL_COUNTRY, label: "Country", type: "select", required: true, options: countries, logic: when(DIFFERS), canonical: "requestFiler.physicalAddress.country", ref: "Part 1, Item 7.h" },
];

const PART2_QUESTIONS = [
  { path: FORM_NUMBER, label: "Form Number of Related Petition or Application", type: "text", required: true, rules: [FORM_NUMBER_RULE], canonical: "premiumProcessing.relatedCase.formNumber", ref: "Part 2, Item 1" },
  { path: "i907.related_case.receipt_number", label: "Receipt Number of Related Petition or Application", type: "text", required: true, rules: [RECEIPT_RULE], canonical: "premiumProcessing.relatedCase.receiptNumbers[0]", ref: "Part 2, Item 2" },
  { path: "i907.related_case.receipt_number_2", label: "Receipt Number of Related Petition or Application", description: "A second receipt number, only if the related case has one.", type: "text", optional: true, rules: [RECEIPT_RULE], canonical: "premiumProcessing.relatedCase.receiptNumbers[1]", ref: "none (second receipt number; the form has one box)" },
  { path: "i907.petitioner.last_name", label: "Petitioner or Applicant — Family Name (Last Name)", type: "text", required: true, canonical: "premiumProcessing.relatedCase.petitionerOrApplicant.lastName", ref: "Part 2, Item 4" },
  { path: "i907.petitioner.first_name", label: "Petitioner or Applicant — Given Name (First Name)", type: "text", required: true, canonical: "premiumProcessing.relatedCase.petitionerOrApplicant.firstName", ref: "Part 2, Item 4" },
  { path: "i907.beneficiary.last_name", label: "Beneficiary — Family Name (Last Name)", type: "text", required: true, logic: WHEN_BENEFICIARY, canonical: "premiumProcessing.relatedCase.beneficiary.lastName", ref: "Part 2, Item 5" },
  { path: "i907.beneficiary.first_name", label: "Beneficiary — Given Name (First Name)", type: "text", required: true, logic: WHEN_BENEFICIARY, canonical: "premiumProcessing.relatedCase.beneficiary.firstName", ref: "Part 2, Item 5" },
  { path: "i907.company_poc.last_name", label: "Name of Point of Contact for the Company or Organization — Family Name (Last Name)", type: "text", required: true, logic: when(HAS_COMPANY), canonical: "premiumProcessing.companyPointOfContact.lastName", ref: "Part 2, Item 6" },
  { path: "i907.company_poc.first_name", label: "Name of Point of Contact for the Company or Organization — Given Name (First Name)", type: "text", required: true, logic: when(HAS_COMPANY), canonical: "premiumProcessing.companyPointOfContact.firstName", ref: "Part 2, Item 6" },
  { path: "i907.company_poc.position_title", label: "Name of Point of Contact for the Company or Organization — Position Title", type: "text", required: true, logic: when(HAS_COMPANY), canonical: "premiumProcessing.companyPointOfContact.positionTitle", ref: "Part 2, Item 6" },
  { path: "i907.company.ein", label: "Company or Organization IRS Employer Identification Number (EIN) (if any)", type: "text", optional: true, rules: [EIN_RULE], logic: when(HAS_COMPANY), canonical: "premiumProcessing.companyOrOrganization.ein", ref: "Part 2, Item 7" },
];

// The one document of this checklist (the old checklist had no document items beyond uploads on the case itself).
const RECEIPT_NOTICE_DOCUMENT = {
  key: "i907_doc_relatedCaseReceiptNotice",
  label: "Copy of related case’s Receipt Notice",
  canonical: "premiumProcessing.documents.relatedCaseReceiptNotice",
};

function toQuestions(specs, section) {
  return specs.map((spec, index) => buildQuestion(key(spec.path), spec.label, spec.type, section, index + 1, {
    required: spec.required,
    description: spec.description,
    options: spec.options,
    conditionalLogic: spec.logic,
    validationRules: spec.rules,
    ...(spec.canonical ? { mapping: { canonicalPath: spec.canonical } } : {}),
    metadata: {
      sourcePath: spec.path,
      requirement: spec.required ? "required" : "optional",
      ...(spec.optional ? { optional: true } : {}),
      ...(spec.ref ? { formRef: spec.ref } : {}),
      ...(spec.sensitive ? { sensitive: true } : {}),
      // a choice answer must be one of the listed options (enforced server-side on submit)
      ...(["select", "radio"].includes(spec.type) && spec.options?.length ? { strictOptions: true } : {}),
    },
  }));
}

function documentQuestions() {
  return [buildQuestion(RECEIPT_NOTICE_DOCUMENT.key, RECEIPT_NOTICE_DOCUMENT.label, "file", DOCUMENTS, 1, {
    required: true,
    evidenceCategory: "immigration",
    mapping: { canonicalPath: RECEIPT_NOTICE_DOCUMENT.canonical },
    // documentType == key, so an upload becomes a Document of this case and syncs back to this question. It is read together with the
    // receipt-number answers of the same response, which is what ties the notice to the related case.
    metadata: { documentType: RECEIPT_NOTICE_DOCUMENT.key, category: "immigration", requirement: "required", relatedCase: true },
  })];
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
    sections: [PART1, MAILING, PHYSICAL, PART2, DOCUMENTS],
    questions: [
      ...toQuestions(PART1_QUESTIONS, PART1),
      ...toQuestions(MAILING_QUESTIONS, MAILING),
      ...toQuestions(PHYSICAL_QUESTIONS, PHYSICAL),
      ...toQuestions(PART2_QUESTIONS, PART2),
      ...documentQuestions(),
    ],
  };
}

const PREMIUM_PROCESSING_DEFINITIONS = [buildPremiumProcessingChecklist()];

module.exports = {
  CHECKLIST_KEY,
  PREMIUM_PROCESSING_VISA_TYPES,
  PREMIUM_PROCESSING_DEFINITIONS,
  buildPremiumProcessingChecklist,
  PART1_QUESTIONS,
  MAILING_QUESTIONS,
  PHYSICAL_QUESTIONS,
  PART2_QUESTIONS,
  RELATED_FORMS,
  FORMS_WITH_BENEFICIARY,
  RECEIPT_NOTICE_DOCUMENT,
  questionKeyForPath: key,
};
