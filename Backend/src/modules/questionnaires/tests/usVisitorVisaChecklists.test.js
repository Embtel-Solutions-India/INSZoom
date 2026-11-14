// US Visitor Visa (Indian Timeline Cases): a visa type with NO subtype and TWO checklists that belong to this visa type only, shown separately and in order.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { US_VISITOR_VISA_DEFINITIONS, APPLICANT_KEY, I134_KEY, APPLICANT_SECTIONS, I134_SECTIONS } = require("../usVisitorVisaChecklists");
const { orderDefaultChecklists } = require("../checklistOrder");
const { slugSection } = require("../definitionHelpers");
const service = require("../questionnaire.service");
const filingTypes = require("../../../config/filingTypes");
const visaCategories = require("../../../config/visaCategories");
const visaFormSeeds = require("../../form-registry/seeds/visaFormMappings.seed");
const { SINGLE_PARTY_FILING_DEFINITIONS } = require("../singlePartyChecklists");
const engineModule = require("../../cases/immigration-knowledge-engine.service");
const Engine = engineModule.default || engineModule.ImmigrationKnowledgeEngine || engineModule;

const { isQuestionVisible, isQuestionRequired, VISA_TEMPLATE_DEFINITIONS } = service;
const [applicant, i134] = US_VISITOR_VISA_DEFINITIONS;
const client = { role: "client" };
const q = (definition, prefix) => (name) => definition.questions.find((question) => question.key === `${prefix}${name}`);
const A = q(applicant, "usvv_");
const I = q(i134, "usvi_");
const labelsOf = (definition, section) => definition.questions.filter((question) => question.sectionKey === slugSection(section)).map((question) => question.label);

test("registration: the visa type has no subtype and exactly these two checklists, shown in order", () => {
  const registry = visaCategories.VISA_CATEGORIES["US-VISITOR-VISA"];
  assert.deepEqual([registry.caseStructure, registry.forms, registry.noForms, registry.label, registry.subTypes], ["single", [], true, "US Visitor Visa", undefined], "no subtype");
  assert.deepEqual(registry.checklists, [APPLICANT_KEY, I134_KEY]);
  assert.equal(registry.selfContainedChecklists, true);
  assert.deepEqual(US_VISITOR_VISA_DEFINITIONS.map((item) => item.key), [APPLICANT_KEY, I134_KEY]);
  assert.deepEqual(US_VISITOR_VISA_DEFINITIONS.map((item) => item.title), ["US Visitor Visa - Visitor Visa Document Checklist & Questionnaire", "US Visitor Visa - I-134 Checklist: Questionnaire for the Sponsor"]);
  for (const definition of US_VISITOR_VISA_DEFINITIONS) {
    assert.deepEqual([definition.visaType, definition.visaTypes, definition.checklistRole, definition.isDefault], ["US-VISITOR-VISA", ["US-VISITOR-VISA"], "client", true]);
    assert.equal(VISA_TEMPLATE_DEFINITIONS.filter((item) => item.key === definition.key).length, 1, `${definition.key} registered exactly once`);
    for (const question of definition.questions) assert.ok(!question.mapping && !(question.metadata || {}).canonicalPath, `${question.key} has no canonical mapping`);
  }
  assert.deepEqual(US_VISITOR_VISA_DEFINITIONS.map((item) => item.settings.checklistOrder), [1, 2], "the applicant checklist first, the sponsor questionnaire second");
  assert.equal(filingTypes.listFilingTypes().filter((item) => item.visaType === "US-VISITOR-VISA").length, 0, "no filing type / subtype");
  assert.equal(SINGLE_PARTY_FILING_DEFINITIONS.filter((item) => item.visaType === "US-VISITOR-VISA").length, 0, "no scaffold checklist");
  assert.equal(visaFormSeeds.mappings.filter((row) => row.visaType === "US-VISITOR-VISA").length, 0, "no USCIS forms");
  const others = new Set(VISA_TEMPLATE_DEFINITIONS.filter((item) => !US_VISITOR_VISA_DEFINITIONS.includes(item)).flatMap((item) => (item.questions || []).map((question) => question.key)));
  assert.ok(!US_VISITOR_VISA_DEFINITIONS.some((definition) => definition.questions.some((question) => others.has(question.key))), "no question key shared with another checklist");
  assert.equal(new Set(US_VISITOR_VISA_DEFINITIONS.flatMap((definition) => definition.questions.map((question) => question.key))).size, applicant.questions.length + i134.questions.length, "no duplicate keys");
});

test("both checklists are assigned to US Visitor Visa cases only (and the engine keeps their documents inside each checklist)", () => {
  const visitorCase = { visaType: "US-VISITOR-VISA", visaCategory: "US-VISITOR-VISA", caseType: "individual_filing" };
  for (const definition of US_VISITOR_VISA_DEFINITIONS) {
    assert.equal(Engine.questionnaireApplies(definition, visitorCase), true, `${definition.key} applies to a US Visitor Visa case`);
    assert.equal(Engine.subtypeChecklistApplies(definition, visitorCase), true);
    for (const visaType of ["OCI", "US-PASSPORT-MINOR", "INDIAN-PASSPORT-RENEWAL", "RENUNCIATION", "INDIAN-E-TOURIST-VISA", "GC-NVC", "H-1B", "I-130", "N-400"]) {
      assert.equal(Engine.questionnaireApplies(definition, { visaType, visaCategory: visaType, caseType: "individual_filing" }), false, `${definition.key} does not apply to a ${visaType} case`);
    }
  }
  // no other default checklist is scoped to this visa type, and no US Visitor Visa checklist is scoped to another
  const defaults = VISA_TEMPLATE_DEFINITIONS.filter((item) => item.isDefault && [item.visaType, ...(item.visaTypes || [])].includes("US-VISITOR-VISA"));
  assert.deepEqual(defaults.map((item) => item.key), [APPLICANT_KEY, I134_KEY]);
  // the documents of each checklist stay inside it (never pooled into one shared documents list); PERM and GC-NVC (which also use registry checklists) keep working as before
  const owned = Engine.selfContainedQuestionnaireIds([{ key: APPLICANT_KEY, _id: "a" }, { key: I134_KEY, _id: "b" }, { key: "gc_nvc_checklist", _id: "c" }, { key: "perm_employer_information", _id: "d" }]);
  assert.deepEqual([...owned].sort(), ["a", "b"]);
});

test("the checklists are listed in order, one after another, whatever order they arrive in", () => {
  const arrival = [{ key: "other" }, { ...i134, key: I134_KEY }, { key: "another" }, { ...applicant, key: APPLICANT_KEY }];
  assert.deepEqual(orderDefaultChecklists(arrival).map((item) => item.key), [APPLICANT_KEY, I134_KEY, "other", "another"], "ordered ones first; the others keep their order");
  const noOrder = [{ key: "z" }, { key: "y" }, { settings: {}, key: "x" }];
  assert.deepEqual(orderDefaultChecklists([...noOrder]).map((item) => item.key), ["z", "y", "x"], "a visa type that sets no order is untouched");
  assert.equal(service.orderDefaultChecklists, orderDefaultChecklists);
});

test("the visa type is offered in the Indian Timeline group, with no subtype picker (backend + Admin)", () => {
  const admin = fs.readFileSync(path.join(__dirname, "../../../../../Admin/frontend/src/utils/visaOptions.js"), "utf8");
  const backend = fs.readFileSync(path.join(__dirname, "../../../config/visaDropdown.js"), "utf8");
  const line = "{ value: 'usvisitorvisa', label: 'US Visitor Visa', canonicalLabel: 'US-VISITOR-VISA' }";
  assert.ok(admin.includes(line) && backend.includes(line), "the same dropdown entry in both copies");
  assert.ok(/INDIAN_TIMELINE_VISA_TYPES = new Set\(\[[^\]]*'usvisitorvisa'/.test(admin), "grouped with the Indian Timeline cases");
  assert.ok(!/INDIAN_TIMELINE_SUBTYPES = \{[\s\S]*usvisitorvisa:/.test(admin), "no subtype list, so the New-case form asks for none");
  const templates = fs.readFileSync(path.join(__dirname, "../../../../../Admin/frontend/src/pages/QuestionnaireTemplates.jsx"), "utf8");
  assert.ok(templates.includes("'USVISITORVISA'"), "listed with the Indian Timeline templates");
});

test("checklist 1 (applicant): sections, exact labels, counts and answer types", () => {
  assert.equal(applicant.questions.length, 86);
  assert.deepEqual(applicant.sections, APPLICANT_SECTIONS);
  assert.deepEqual(applicant.sections.map((section) => labelsOf(applicant, section).length), [3, 2, 9, 7, 9, 9, 6, 17, 18, 1, 5]);
  assert.deepEqual(labelsOf(applicant, APPLICANT_SECTIONS[0]), ["Applicant Full Name", "Phone Number", "Email Id"]);
  assert.deepEqual(labelsOf(applicant, APPLICANT_SECTIONS[1]), ["Copy of Passport", "Photograph"]);
  assert.deepEqual(labelsOf(applicant, APPLICANT_SECTIONS[2]), ["Applicant’s Surname", "Applicant’s Given Name", "Marital Status", "Date of Birth", "City, State & Country of Birth", "National Identification Number", "Home Address of the person", "Phone number", "Email id"]);
  assert.deepEqual(labelsOf(applicant, APPLICANT_SECTIONS[3]), ["Passport Number", "Country Issued Passport number", "City where issued", "State where issued", "Issuance date", "Expiration date", "Have you ever lost a passport or had one stolen?"]);
  assert.deepEqual(labelsOf(applicant, APPLICANT_SECTIONS[4]), ["Tentative date of travel", "Tentative length of stay in US", "Address where you will stay in the US", "Person/ Entity Paying for your trip", "Name of Sponsor", "Address of the Sponsor", "Telephone Number of the Sponsor", "Email address of Sponsor", "Relationship to you"]);
  assert.deepEqual(labelsOf(applicant, APPLICANT_SECTIONS[5]), ["Name of the Person", "Relation to You", "Have you ever been to the USA?", "US visits", "Have you ever been issued a USA Visa?", "Visa Issuance Date", "Visa number", "List of the Countries that you have traveled in the last five years",
    "Have you ever been refused a US Visa, been refused admission to the United States or withdrawn your application for admission at the point of entry?"]);
  assert.deepEqual(labelsOf(applicant, APPLICANT_SECTIONS[6]), ["Contact Name in USA", "Organization name in the USA", "Relationship to you", "USA Contact Address", "Phone Number", "Email Address"]);
  assert.deepEqual(labelsOf(applicant, APPLICANT_SECTIONS[7]), ["Father’s first name", "Father’s surname", "Father DOB(mm/dd/yyyy)", "Is your Father in the USA?", "Mother’s first name", "Mother’s surname", "Mother DOB(mm/dd/yyyy)", "Is your Mother in the USA?", "Do you have any immediate relatives in the USA?",
    "Immediate relatives in the USA", "Spouse’s first name", "Spouse’s surname", "Spouse DOB(mm/dd/yyyy)", "Spouse Nationality", "Spouse City of Birth", "Spouse Country of birth", "Spouse Address"]);
  assert.equal(labelsOf(applicant, APPLICANT_SECTIONS[8]).length, 18);
  assert.deepEqual(labelsOf(applicant, APPLICANT_SECTIONS[9]), ["Educational institutions"]);
  assert.deepEqual(labelsOf(applicant, APPLICANT_SECTIONS[10]), ["Social Security Number(if available)", "Social media", "US Driver's License Number", "US State that issued Driver's License", "Provide a List of Languages You Speak"]);
  // answer types
  assert.deepEqual([A("applicant_phone").type, A("applicant_email").type, A("date_of_birth").type, A("passport_country").type, A("passport_lost_or_stolen").type, A("home_address").type, A("doc_passport_copy").type, A("doc_photograph").type, A("spouse_nationality").type],
    ["phone", "email", "date", "select", "radio", "textarea", "file", "file", "select"]);
  assert.deepEqual(A("marital_status").options.map((o) => o.value), ["Single / Never Married", "Married", "Divorced", "Widowed", "Separated"]);
  // the five tables are repeating groups with the columns of the form (and the form's row limits)
  const group = (name) => ({ columns: A(name).metadata.fields.map((f) => f.label), max: A(name).repeatableConfig.max, min: A(name).repeatableConfig.min });
  assert.deepEqual(group("us_visits"), { columns: ["US Travel date (mm/dd/yyyy)", "Duration of the stay"], max: 5, min: 0 });
  assert.deepEqual(group("relatives"), { columns: ["Relative’s name", "Relative’s surname", "Status in the USA", "Relationship to you"], max: undefined, min: 0 });
  assert.deepEqual(group("employment_history"), { columns: ["Employer/Company Name", "Full Employer/Company Address", "Telephone Number", "Your Job Title", "Supervisor's name", "Supervisor's surname", "Employment Start Date(mm/dd/yyyy)", "Employment End Date(mm/dd/yyyy)", "Briefly describe your duties"], max: 3, min: 0 });
  assert.deepEqual(group("education"), { columns: ["Name of Institution", "Full Address of Institution", "Course of Study", "Date of Attendance From (mm/dd/yyyy)", "Date of Attendance To (mm/dd/yyyy)"], max: 3, min: 0 });
  assert.deepEqual(group("social_media"), { columns: ["Social Media Provider/Platform", "Social Media Identifier"], max: undefined, min: 0 });
  assert.equal(A("doc_passport_copy").description, "Color copy of the first two and last two pages of your current valid passport (must have more than 6 months validity remaining).");
  assert.equal(A("doc_photograph").description, "One Digital US Passport size photo (2’ X 2’)");
});

test("checklist 2 (I-134 sponsor questionnaire): sections, exact labels, counts and answer types", () => {
  assert.equal(i134.questions.length, 43);
  assert.deepEqual(i134.sections, I134_SECTIONS);
  assert.deepEqual(i134.sections.map((section) => labelsOf(i134, section).length), [15, 6, 1, 17, 4]);
  assert.deepEqual(labelsOf(i134, I134_SECTIONS[0]).slice(0, 11), ["Sponsor’s Surname", "Sponsor’s Given", "Date of Birth", "City or Town of Birth", "State or Province of Birth", "Country of Birth", "Alien Registration Number (A-Number) (if any)", "What is your relationship to the beneficiary?", "Current annual income", "Sponsor's Current address", "Sponsor's Current status in the USA"]);
  assert.deepEqual(labelsOf(i134, I134_SECTIONS[1]), ["Employment status", "Title/Position", "Name of Employer", "Title/Profession", "Please specify", "Please explain"]);
  assert.deepEqual(labelsOf(i134, I134_SECTIONS[2]), ["Assets"]);
  assert.deepEqual(labelsOf(i134, I134_SECTIONS[3]), ["Beneficiary Surname", "Beneficiary Given name", "Gender", "Date of Birth", "Place of birth", "City or Town of Birth", "State or Province of Birth", "Country of Birth", "Country of Citizenship or Nationality", "Alien Registration Number (A-Number) (if any)",
    "Marital status", "Current Address", "Physical Address", "From (mm/dd/yyyy)", "To (mm/dd/yyyy)", "Telephone number", "Email ID"]);
  assert.deepEqual(labelsOf(i134, I134_SECTIONS[4]), ["Copy of current valid passport", "Copy of tax returns for the most recent year", "Copy of bank statements for last 3 months", "If the sponsor is in the USA, then provide proof of US Status (for e.g. green card, Citizenship certificate, I-797 Approval notice, etc)"]);
  assert.deepEqual(I("employment_status").options.map((o) => o.value), ["Employed (full-time, part-time, seasonal)", "Self-employed", "Unemployed, not employed, or retired", "Other"]);
  assert.equal(I("other_forms_count").type, "number");
  assert.equal(I("dependents_count").type, "number");
  assert.deepEqual(I("other_forms").metadata.fields.map((f) => f.label), ["Full Name", "Date of Birth", "Relationship to You", "A Number", "Receipt Number"]);
  assert.deepEqual(I("dependents").metadata.fields.map((f) => f.label), ["Full Name", "Date of Birth (dd/mm/yyyy)", "Relationship to you", "A-Number (If any)", "Receipt Number (If any)"]);
  assert.deepEqual(I("assets").metadata.fields.map((f) => [f.label, f.type]), [["Type of Asset", "text"], ["City & State (if the asset is a property or Real Estate Asset)", "text"], ["Amount (Cash Value) (U.S. dollars)", "number"]]);
  assert.deepEqual(I("beneficiary_gender").options.map((o) => o.value), ["Male", "Female", "Other"]);
  assert.deepEqual([I("sponsor_dob").type, I("beneficiary_phone").type, I("beneficiary_email").type, I("stay_from").type, I("doc_tax_returns").type], ["date", "phone", "email", "date", "file"]);
});

test("no show-when rules; exact required lists; no instructions, e-mail or photo wording; titles and typos", () => {
  for (const definition of US_VISITOR_VISA_DEFINITIONS) {
    for (const question of definition.questions) {
      assert.ok(!question.conditionalLogic || !(question.conditionalLogic.rules || []).length, `${question.key} has no show-when rule`);
      assert.equal(isQuestionVisible(question, {}, client), true, `${question.key} visible with no answers`);
    }
    const text = JSON.stringify([definition.title, definition.description, definition.sections, definition.questions.map((question) => [question.label, question.description])]);
    assert.ok(!/IMPORTANT INSTRUCTIONS|Mark 'N\/A'|must be in color|e-?mail attachment|via e-?mail|send (it )?to us|Martial/i.test(text), `${definition.key}: no instructions block, no e-mail wording, typos corrected`);
    assert.ok(!definition.questions.some((question) => /physical_photos/.test(question.key)), "no physical-photographs item (the photograph is a digital upload)");
  }
  const required = (definition, prefix) => definition.questions.filter((question) => question.required).map((question) => question.key.replace(prefix, "")).sort();
  assert.deepEqual(required(applicant, "usvv_"), ["applicant_name", "applicant_phone", "applicant_email", "doc_passport_copy", "doc_photograph", "surname", "given_name", "marital_status", "date_of_birth", "birth_place", "home_address", "phone", "email",
    "passport_number", "passport_country", "issued_city", "issuance_date", "expiration_date", "passport_lost_or_stolen", "travel_date", "stay_length", "us_stay_address", "trip_payer", "been_to_usa", "visa_issued", "countries_last_five_years", "visa_refused",
    "contact_name", "contact_relationship", "contact_address", "contact_phone", "father_first_name", "father_surname", "father_dob", "father_in_usa", "mother_first_name", "mother_surname", "mother_dob", "mother_in_usa", "relatives_in_usa"].sort());
  assert.equal(required(applicant, "usvv_").length, 40);
  assert.deepEqual(required(i134, "usvi_"), ["sponsor_surname", "sponsor_given_name", "sponsor_dob", "sponsor_birth_city", "sponsor_birth_country", "sponsor_relationship", "sponsor_income", "sponsor_address", "employment_status",
    "beneficiary_surname", "beneficiary_given_name", "beneficiary_gender", "beneficiary_dob", "beneficiary_birth_place", "beneficiary_birth_city", "beneficiary_birth_country", "beneficiary_citizenship", "beneficiary_marital_status", "beneficiary_current_address", "stay_from", "stay_to",
    "doc_passport_copy", "doc_tax_returns", "doc_bank_statements"].sort());
  assert.equal(required(i134, "usvi_").length, 24);
  // optional by design: the national id, the state where the passport was issued, the sponsor / companion / spouse details and every table
  for (const name of ["national_id_number", "issued_state", "sponsor_name", "companion_name", "us_visits", "relatives", "spouse_first_name", "employer_name", "employment_history", "retired_employer_name", "education", "social_security_number", "social_media", "languages"]) assert.equal(A(name).required, false, name);
  for (const name of ["other_forms", "dependents", "assets", "sponsor_us_status", "doc_sponsor_us_status", "beneficiary_physical_address"]) assert.equal(I(name).required, false, name);
  assert.equal(A("passport_lost_or_stolen").required, true, "the passport rule keeps passport answers required");
});
