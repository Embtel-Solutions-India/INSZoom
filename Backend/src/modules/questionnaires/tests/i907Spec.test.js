// Form I-907 Information Checklist, updated specification: exact labels / types, canonical paths, optional rules, related-case behaviour and
// the single receipt-notice document. Pure tests - no database; the end-to-end behaviour is in i907-e2e.test.js.
const test = require("node:test");
const assert = require("node:assert/strict");

const { buildPremiumProcessingChecklist, RELATED_FORMS, FORMS_WITH_BENEFICIARY, RECEIPT_NOTICE_DOCUMENT } = require("../premiumProcessingChecklist");
const { evaluateConditionGroup } = require("../condition-evaluator");
const CanonicalFieldRegistryService = require("../../form-mapping/services/CanonicalFieldRegistryService");
const { validateQuestionValue } = require("../questionnaire.service");
const registrySeed = require("../../form-registry/seeds/visaFormMappings.seed");

const checklist = buildPremiumProcessingChecklist();
const byKey = (questionKey) => checklist.questions.find((question) => question.key === questionKey);
const visible = (questionKey, answers) => evaluateConditionGroup(byKey(questionKey).conditionalLogic, answers);
const errors = (questionKey, value) => validateQuestionValue(byKey(questionKey), value).errors.length;

test("exact labels and answer types of Part 1 (mailing and physical addresses have their own sections)", () => {
  const expected = [
    ["i907_filer_alien_registration_number", "Alien Registration Number (A-Number) (if any)", "text"],
    ["i907_filer_uscis_online_account_number", "USCIS Online Account Number (if any)", "text"],
    ["i907_filer_last_name", "Family Name (Last Name)", "text"],
    ["i907_filer_first_name", "Given Name (First Name)", "text"],
    ["i907_related_case_company_name", "Company or Organization Named in the Related Case (If filed on behalf of a company or organization)", "text"],
    ["i907_mailing_address_street", "Street Number and Name", "text"],
    ["i907_mailing_address_unit", "Apt/Ste/Flr", "text"],
    ["i907_mailing_address_city", "City or Town", "text"],
    ["i907_mailing_address_state", "State", "select"],
    ["i907_mailing_address_zip_code", "ZIP Code", "text"],
    ["i907_mailing_address_province", "Province", "text"],
    ["i907_mailing_address_postal_code", "Postal Code", "text"],
    ["i907_mailing_address_country", "Country", "select"],
    ["i907_address_same_as_physical", "Is your current mailing address the same as your physical address?", "radio"],
    ["i907_physical_address_street", "Street Number and Name", "text"],
    ["i907_physical_address_unit", "Apt. Ste. Flr.", "text"],
    ["i907_physical_address_city", "City or Town", "text"],
    ["i907_physical_address_state", "State", "select"],
    ["i907_physical_address_zip_code", "ZIP Code", "text"],
    ["i907_physical_address_province", "Province", "text"],
    ["i907_physical_address_postal_code", "Postal Code", "text"],
    ["i907_physical_address_country", "Country", "select"],
  ];
  expected.forEach(([questionKey, label, type]) => {
    assert.equal(byKey(questionKey).label, label, questionKey);
    assert.equal(byKey(questionKey).type, type, questionKey);
  });
  assert.equal(byKey("i907_mailing_address_street").sectionKey, "mailing_address");
  assert.equal(byKey("i907_physical_address_street").sectionKey, "physical_address");
});

test("exact labels of Part 2", () => {
  const expected = {
    i907_related_case_form_number: "Form Number of Related Petition or Application",
    i907_related_case_receipt_number: "Receipt Number of Related Petition or Application",
    i907_related_case_receipt_number_2: "Receipt Number of Related Petition or Application",
    i907_petitioner_last_name: "Petitioner or Applicant — Family Name (Last Name)",
    i907_petitioner_first_name: "Petitioner or Applicant — Given Name (First Name)",
    i907_beneficiary_last_name: "Beneficiary — Family Name (Last Name)",
    i907_beneficiary_first_name: "Beneficiary — Given Name (First Name)",
    i907_company_poc_last_name: "Name of Point of Contact for the Company or Organization — Family Name (Last Name)",
    i907_company_poc_first_name: "Name of Point of Contact for the Company or Organization — Given Name (First Name)",
    i907_company_poc_position_title: "Name of Point of Contact for the Company or Organization — Position Title",
    i907_company_ein: "Company or Organization IRS Employer Identification Number (EIN) (if any)",
  };
  Object.entries(expected).forEach(([questionKey, label]) => assert.equal(byKey(questionKey).label, label, questionKey));
});

test("canonical paths: requestFiler.* for the filer, premiumProcessing.* for the request; all registered; none form-specific", () => {
  const registered = new Set(CanonicalFieldRegistryService.list({}).map((field) => field.path));
  const expected = {
    i907_filer_alien_registration_number: "requestFiler.alienNumber", i907_filer_last_name: "requestFiler.lastName", i907_filer_first_name: "requestFiler.firstName",
    i907_related_case_company_name: "premiumProcessing.companyOrOrganizationName", i907_mailing_address_street: "requestFiler.mailingAddress.streetAddress",
    i907_mailing_address_unit: "requestFiler.mailingAddress.addressLine2", i907_mailing_address_zip_code: "requestFiler.mailingAddress.zipCode",
    i907_address_same_as_physical: "requestFiler.physicalAddress.sameAsMailingAddress", i907_physical_address_country: "requestFiler.physicalAddress.country",
    i907_related_case_form_number: "premiumProcessing.relatedCase.formNumber", i907_related_case_receipt_number: "premiumProcessing.relatedCase.receiptNumbers[0]",
    i907_related_case_receipt_number_2: "premiumProcessing.relatedCase.receiptNumbers[1]",
    i907_petitioner_last_name: "premiumProcessing.relatedCase.petitionerOrApplicant.lastName", i907_beneficiary_first_name: "premiumProcessing.relatedCase.beneficiary.firstName",
    i907_company_poc_position_title: "premiumProcessing.companyPointOfContact.positionTitle", i907_company_ein: "premiumProcessing.companyOrOrganization.ein",
    i907_doc_relatedCaseReceiptNotice: "premiumProcessing.documents.relatedCaseReceiptNotice",
  };
  Object.entries(expected).forEach(([questionKey, path]) => assert.equal(byKey(questionKey).mapping.canonicalPath, path, questionKey));
  checklist.questions.forEach((question) => {
    const path = question.mapping?.canonicalPath;
    assert.ok(path, `${question.key} has a canonical path`);
    assert.ok(registered.has(path), `${path} registered`);
    assert.match(path, /^(requestFiler|premiumProcessing)\./);
    assert.doesNotMatch(path, /i907|subform|Pt\d|Line\d+_/i);
  });
  assert.ok(!checklist.questions.some((question) => /^person\./.test(question.mapping.canonicalPath)), "the filer never writes the case's own person.* (on an upgrade that is the beneficiary)");
});

test("optional questions are optional for Submit too (metadata.optional); no other question is", () => {
  const optional = ["i907_filer_alien_registration_number", "i907_filer_uscis_online_account_number", "i907_related_case_company_name", "i907_mailing_address_unit",
    "i907_mailing_address_province", "i907_mailing_address_postal_code", "i907_physical_address_unit", "i907_physical_address_province", "i907_physical_address_postal_code",
    "i907_related_case_receipt_number_2", "i907_company_ein"];
  optional.forEach((questionKey) => { assert.equal(byKey(questionKey).metadata.optional, true, questionKey); assert.equal(byKey(questionKey).metadata.requirement, "optional"); });
  checklist.questions.filter((question) => !optional.includes(question.key)).forEach((question) => assert.ok(!question.metadata.optional, `${question.key} is not optional`));
});

test("beneficiary questions follow the related case: only for filings that have a beneficiary", () => {
  assert.deepEqual(FORMS_WITH_BENEFICIARY, ["I-129", "I-140"]);
  ["i907_beneficiary_last_name", "i907_beneficiary_first_name"].forEach((questionKey) => {
    assert.equal(visible(questionKey, { i907_related_case_form_number: "I-129" }), true, questionKey);
    assert.equal(visible(questionKey, { i907_related_case_form_number: "I-140" }), true, questionKey);
    ["I-539", "I-765", "I-131"].forEach((form) => assert.equal(visible(questionKey, { i907_related_case_form_number: form }), false, `${questionKey} for ${form}`));
    assert.equal(visible(questionKey, {}), false, "nothing until a form is chosen");
  });
});

test("the related-form dropdown only offers forms of the existing USCIS registry (none invented)", () => {
  const i907Types = new Set(registrySeed.mappings.filter((row) => row.formNumber === "I-907").map((row) => row.visaType));
  RELATED_FORMS.forEach((form) => {
    assert.ok(registrySeed.mappings.some((row) => row.formNumber === form && i907Types.has(row.visaType)), `${form} is a registry form that sits beside I-907`);
  });
  assert.ok(!RELATED_FORMS.includes("Other") && !RELATED_FORMS.includes("I-290B"), "no placeholder or unregistered form numbers");
  assert.deepEqual(byKey("i907_related_case_form_number").options.map((option) => option.value), RELATED_FORMS);
});

test("validation: receipt numbers, A-Number, EIN, ZIP and radio options are checked; the second receipt number is optional", () => {
  assert.equal(errors("i907_related_case_receipt_number", "EAC1234567890"), 0);
  assert.equal(errors("i907_related_case_receipt_number", "123"), 1);
  assert.equal(errors("i907_related_case_receipt_number_2", ""), 0);
  assert.equal(errors("i907_related_case_receipt_number_2", "WAC2412345678"), 0);
  assert.equal(errors("i907_filer_alien_registration_number", "A123456789"), 0);
  assert.equal(errors("i907_filer_alien_registration_number", "A12"), 1);
  assert.equal(errors("i907_company_ein", "12-3456789"), 0);
  assert.equal(errors("i907_company_ein", "1234"), 1);
  assert.equal(errors("i907_mailing_address_zip_code", "12345"), 0);
  assert.equal(errors("i907_mailing_address_zip_code", "1234"), 1);
  assert.equal(errors("i907_address_same_as_physical", "Maybe"), 1, "a radio answer must be one of its options");
});

test("the one document: 'Copy of related case’s Receipt Notice', a required file upload tied to the I-907 request", () => {
  const files = checklist.questions.filter((question) => question.type === "file");
  assert.deepEqual(files.map((question) => question.key), ["i907_doc_relatedCaseReceiptNotice"]);
  const doc = files[0];
  assert.equal(doc.label, "Copy of related case’s Receipt Notice");
  assert.equal(doc.required, true);
  assert.equal(doc.metadata.documentType, doc.key, "an upload becomes a Document of this case and syncs back to this question");
  assert.equal(doc.mapping.canonicalPath, RECEIPT_NOTICE_DOCUMENT.canonical);
  assert.equal(doc.conditionalLogic.rules.length, 0, "always shown");
  assert.equal(checklist.questions.filter((question) => /passport|diploma|tax|employment letter/i.test(question.label)).length, 0, "no old document items");
});
