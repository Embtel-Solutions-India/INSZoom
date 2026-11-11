// I-130 (Petition for Alien Relative) as its own two-party case type: definitions, party separation, canonical mapping, conditional requiredness (driven through the real
// questionnaire engine), form provisioning, and "nothing else changed". DB-free.
const test = require("node:test");
const assert = require("node:assert/strict");
const { FAMILY_CHECKLIST_DEFINITIONS, resolveFamilyChecklistKeys } = require("../familyChecklists");
const { isQuestionVisible, isQuestionRequired } = require("../questionnaire.service");
const { CHECKLIST_PARTY_PATHS } = require("../../canonical/config/partyChecklistPaths");
const { getCaseStructure } = require("../../../config/visaCategories");
const { VISA_TYPE_OPTIONS } = require("../../../config/visaDropdown");
const visaFormSeeds = require("../../form-registry/seeds/visaFormMappings.seed");
const checklistSeeds = require("../../form-registry/seeds/checklistMappings.seed");

const find = (key) => FAMILY_CHECKLIST_DEFINITIONS.find((definition) => definition.key === key);
const petitioner = find("i130_i130_petitioner_checklist");
const beneficiary = find("i130_i130_beneficiary_checklist");
const client = { role: "client" };
const q = (definition, key) => definition.questions.find((question) => question.key === key);
// what the engine says for a question given the answers so far
const state = (definition, key, answers = {}) => {
  const question = q(definition, key);
  assert.ok(question, `${key} must exist`);
  const visible = isQuestionVisible(question, answers, client);
  return { visible, required: visible && isQuestionRequired(question, answers) };
};

test("two checklists, one per party, each with its information section and its own documents section", () => {
  assert.ok(petitioner && beneficiary);
  assert.deepEqual([petitioner.title, petitioner.checklistRole, petitioner.visaType], ["Questionnaire for Petition for Alien Relative — Petitioner Information", "petitioner", "I-130"]);
  assert.deepEqual([beneficiary.title, beneficiary.checklistRole, beneficiary.visaType], ["Questionnaire for Petition for Alien Relative — Beneficiary Information", "beneficiary", "I-130"]);
  assert.ok(petitioner.sections.length >= 2);
  assert.deepEqual(beneficiary.sections, ["Beneficiary Information", "Documents required from Beneficiary:"]);
  assert.equal(petitioner.isDefault, true);
  assert.equal(beneficiary.isDefault, true);
  const keys = FAMILY_CHECKLIST_DEFINITIONS.map((definition) => definition.key);
  assert.equal(new Set(keys).size, keys.length, "no duplicate checklist keys");
});

test("every question and every document of the supplied questionnaire is present (nothing silently dropped)", () => {
  assert.equal(petitioner.questions.filter((x) => x.type !== "file").length, 48);
  assert.equal(petitioner.questions.filter((x) => x.type === "file").length, 9);
  assert.equal(beneficiary.questions.filter((x) => x.type !== "file").length, 27);
  assert.equal(beneficiary.questions.filter((x) => x.type === "file").length, 5);
  for (const [definition, section] of [[petitioner, "Documents required from Petitioner:"], [beneficiary, "Documents required from Beneficiary:"]]) {
    const docs = definition.questions.filter((x) => x.type === "file");
    assert.ok(docs.every((x) => x.sectionKey === section.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "")), "each document sits in its own party's documents section");
  }
  const labels = petitioner.questions.map((x) => x.label);
  for (const wanted of ["I am Filing for my:", "Marital Status", "You are a U.S. Citizen", "Are you a lawful Permanent resident Alien?", "Current Annual Income", "Copy of green card, front and back", "One digital passport size Photo"]) {
    assert.ok(labels.includes(wanted), `${wanted} is present`);
  }
});

test("party separation: every petitioner answer maps under petitioner.*, every beneficiary answer under beneficiary.*, documents stay with their own party", () => {
  for (const [definition, party] of [[petitioner, "petitioner"], [beneficiary, "beneficiary"]]) {
    const table = CHECKLIST_PARTY_PATHS[definition.key];
    assert.ok(table, `${definition.key} has canonical paths`);
    for (const question of definition.questions.filter((x) => x.type !== "file")) {
      const spec = table[question.key];
      assert.ok(spec, `${question.key} must map to a canonical path`);
      assert.ok(spec.path.startsWith(`${party}.`), `${question.key} -> ${spec.path} must stay under ${party}.*`);
      assert.ok(question.key.startsWith(`${party}_`), `${question.key} belongs to the ${party}`);
    }
    for (const doc of definition.questions.filter((x) => x.type === "file")) {
      assert.ok(doc.key.startsWith(`${party}_`) && String(doc.metadata.documentType).startsWith(`${party}_`), `${doc.key} stays with the ${party}`);
      assert.ok(doc.visibility.roles.includes(party) && !doc.visibility.roles.includes(party === "petitioner" ? "beneficiary" : "petitioner"));
    }
  }
});

test("the canonical paths are the ones the existing I-130 checklists (and so every form mapping) already use - none invented", () => {
  const existing = CHECKLIST_PARTY_PATHS.i130_f1_petitioner_checklist;
  for (const [key, spec] of Object.entries(CHECKLIST_PARTY_PATHS.i130_i130_petitioner_checklist)) assert.equal(spec.path, existing[key].path, key);
  const existingBeneficiary = CHECKLIST_PARTY_PATHS.i130_f1_beneficiary_checklist;
  for (const [key, spec] of Object.entries(CHECKLIST_PARTY_PATHS.i130_i130_beneficiary_checklist)) assert.equal(spec.path, existingBeneficiary[key].path, key);
  assert.equal(CHECKLIST_PARTY_PATHS.i130_i130_petitioner_checklist.petitioner_relationship.path, "petitioner.relationshipToBeneficiary");
  assert.equal(CHECKLIST_PARTY_PATHS.i130_i130_beneficiary_checklist.beneficiary_dateOfBirth.path, "beneficiary.dateOfBirth");
});

test("married: current-spouse details are required; single: they are not (an unanswered marital status is not a confirmed 'married')", () => {
  for (const key of ["petitioner_currentSpouseName", "petitioner_currentMarriageDate", "petitioner_currentMarriagePlace"]) {
    assert.equal(state(petitioner, key, { petitioner_maritalStatus: "Married" }).required, true, key);
    assert.equal(state(petitioner, key, { petitioner_maritalStatus: "Single" }).required, false, key);
    assert.equal(state(petitioner, key, {}).required, false, key);
  }
  for (const key of ["beneficiary_currentSpouseName", "beneficiary_currentMarriageDate", "beneficiary_currentMarriagePlace"]) {
    assert.equal(state(beneficiary, key, { beneficiary_maritalStatus: "Married" }).required, true, key);
    assert.equal(state(beneficiary, key, { beneficiary_maritalStatus: "Divorced" }).required, false, key);
  }
  assert.deepEqual(q(petitioner, "petitioner_maritalStatus").options.map((o) => o.value), ["Single", "Married", "Divorced", "Widowed", "Separated", "Annulled"]);
});

test("naturalization details appear and are required only for 'By Naturalization'", () => {
  for (const key of ["petitioner_naturalizationCertificateNumber", "petitioner_naturalizationDateAndPlace"]) {
    assert.equal(state(petitioner, key, { petitioner_citizenshipBasis: "By Naturalization" }).required, true, key);
    for (const basis of ["By birth", "Through Parents", undefined]) assert.equal(state(petitioner, key, { petitioner_citizenshipBasis: basis }).visible, false, `${key} hidden for ${basis}`);
  }
});

test("citizenship vs permanent residence: not both forced, nothing inferred", () => {
  const basis = "petitioner_citizenshipBasis";
  assert.equal(state(petitioner, basis, { petitioner_isLawfulPermanentResident: "Yes" }).required, false, "a lawful permanent resident has no citizenship basis to give");
  assert.equal(state(petitioner, basis, { petitioner_isLawfulPermanentResident: "No" }).required, true);
  assert.equal(state(petitioner, basis, {}).required, true, "unanswered is not treated as a confirmed Yes");
  assert.equal(state(petitioner, "petitioner_lprGainedThroughMarriage", { petitioner_isLawfulPermanentResident: "Yes" }).required, true);
  assert.equal(state(petitioner, "petitioner_lprGainedThroughMarriage", { petitioner_isLawfulPermanentResident: "No" }).visible, false);
  assert.equal(state(petitioner, "petitioner_lprGainedThroughMarriage", {}).visible, false);
});

test("conditional documents follow the relationship and status, and never block an unrelated petition", () => {
  const marriage = "petitioner_marriage_certificate";
  assert.deepEqual(state(petitioner, marriage, { petitioner_relationship: "Husband/wife" }), { visible: true, required: true });
  for (const other of ["Parent", "Brother/Sister", "Child", undefined]) assert.equal(state(petitioner, marriage, { petitioner_relationship: other }).visible, false, `no marriage certificate for ${other}`);
  const parentBirth = "petitioner_birth_certificate";
  assert.deepEqual(state(petitioner, parentBirth, { petitioner_relationship: "Parent" }), { visible: true, required: true });
  assert.equal(state(petitioner, parentBirth, { petitioner_relationship: "Husband/wife" }).visible, false);
  assert.deepEqual(state(petitioner, "petitioner_green_card_front_back", { petitioner_isLawfulPermanentResident: "Yes" }), { visible: true, required: true });
  assert.equal(state(petitioner, "petitioner_green_card_front_back", { petitioner_isLawfulPermanentResident: "No" }).visible, false);
  assert.equal(state(petitioner, "petitioner_marriage_termination_documents", { petitioner_priorSpouses: [{ name: "A" }] }).required, true);
  assert.equal(state(petitioner, "petitioner_marriage_termination_documents", {}).required, false, "no previous marriage listed: nothing required");
  assert.equal(state(petitioner, "petitioner_ssn_copy", { petitioner_ssn: "123-45-6789" }).required, true);
  assert.equal(state(petitioner, "petitioner_ssn_copy", {}).required, false);
  assert.equal(state(petitioner, "petitioner_naturalization_citizenship_or_birth_certificate", { petitioner_citizenshipBasis: "By birth" }).required, true);
  assert.equal(state(petitioner, "petitioner_naturalization_citizenship_or_birth_certificate", {}).required, false);
  for (const always of ["petitioner_passport_copy", "petitioner_state_id_or_drivers_license", "petitioner_passport_photo"]) assert.equal(state(petitioner, always, {}).required, true, always);
});

test("beneficiary: never entered the U.S. - none of the entry details block completion; documents follow marital status", () => {
  for (const key of ["beneficiary_arrivalStatus", "beneficiary_i94Number", "beneficiary_lastDateOfArrival", "beneficiary_statusExpiresOn", "beneficiary_usAddress", "beneficiary_foreignAddress", "beneficiary_lastSharedAddress", "beneficiary_adjustmentOfficeCity", "beneficiary_adjustmentOfficeState"]) {
    assert.equal(state(beneficiary, key, {}).required, false, `${key} must not block`);
  }
  assert.equal(state(beneficiary, "beneficiary_currentEmployerAddress", {}).required, false);
  assert.equal(state(beneficiary, "beneficiary_currentEmployerAddress", { beneficiary_currentEmployerName: "Acme" }).required, true);
  assert.equal(state(beneficiary, "beneficiary_marriage_certificate", {}).required, false);
  assert.equal(state(beneficiary, "beneficiary_marriage_certificate", { beneficiary_maritalStatus: "Married" }).required, true);
  for (const always of ["beneficiary_passport_copy", "beneficiary_birth_certificate", "beneficiary_passport_photo", "beneficiary_firstName", "beneficiary_lastName", "beneficiary_underImmigrationProceedings"]) assert.equal(state(beneficiary, always, {}).required, true, always);
  assert.equal(state(beneficiary, "beneficiary_national_identity_card", {}).required, false);
});

test("optional petitioner details are optional (not every field is mandatory just because it is on the form)", () => {
  for (const key of ["petitioner_middleName", "petitioner_otherNamesUsed", "petitioner_physicalAddress", "petitioner_alienNumber", "petitioner_fatherDateOfBirth", "petitioner_motherCountryOfBirth", "petitioner_height", "petitioner_weight",
    "petitioner_eyeColor", "petitioner_hairColor", "petitioner_taxYear1Income", "petitioner_savingsAndCheckingBalance", "petitioner_priorSpouses"]) {
    assert.equal(state(petitioner, key, {}).required, false, key);
  }
  for (const key of ["petitioner_relationship", "petitioner_lastName", "petitioner_firstName", "petitioner_mailingAddress", "petitioner_dateOfBirth", "petitioner_gender", "petitioner_fatherFullName", "petitioner_motherFullName",
    "petitioner_isLawfulPermanentResident", "petitioner_employmentHistory", "petitioner_addressHistory", "petitioner_currentAnnualIncome", "petitioner_priorPetitionFiled"]) {
    assert.equal(state(petitioner, key, {}).required, true, key);
  }
  assert.equal(state(petitioner, "petitioner_priorPetitionDetails", {}).visible, false);
  assert.equal(state(petitioner, "petitioner_priorPetitionDetails", { petitioner_priorPetitionFiled: "Yes" }).required, true);
});

test("case type, dropdown and checklist provisioning: family, two-party, exactly the two checklists whatever the filing path, idempotent keys", () => {
  assert.equal(getCaseStructure("I-130"), "family");
  assert.ok(VISA_TYPE_OPTIONS.some((option) => option.value === "i130" && option.canonicalLabel === "I-130"));
  // exactly the workflow of every other family type (F1): petition only -> petitioner + beneficiary; adjustment of status / consular -> petitioner + Green Card + I-864
  for (const path of ["", "PETITION_ONLY"]) assert.deepEqual(resolveFamilyChecklistKeys("I-130", path), ["i130_i130_petitioner_checklist", "i130_i130_beneficiary_checklist"]);
  for (const path of ["ADJUSTMENT_OF_STATUS", "CONSULAR"]) assert.deepEqual(resolveFamilyChecklistKeys("I-130", path), ["i130_i130_petitioner_checklist", "green_card_i130_beneficiary_checklist", "i864_i130_petitioner_checklist"]);
  assert.deepEqual(resolveFamilyChecklistKeys("i130", ""), resolveFamilyChecklistKeys("I-130", ""));
  for (const key of resolveFamilyChecklistKeys("I-130", "")) assert.ok(find(key), `${key} is a registered definition`);
});

test("forms and checklist mappings: identical to F1's (same workflow for every family type), all fed by the same canonical party values", () => {
  const strip = (rows, visaType) => rows.filter((row) => row.visaType === visaType).map(({ visaType: _t, visaCategory: _v, displayOrder: _o, ...rest }) => JSON.stringify(rest, (k, v) => (typeof v === "string" ? v.replace(/_f1_|_i130_/g, "_X_") : v))).sort();
  assert.deepEqual(strip(visaFormSeeds.mappings, "I-130"), strip(visaFormSeeds.mappings, "F1"));
  const entries = (visaType) => checklistSeeds.ENTRIES.filter((entry) => entry.visaType === visaType);
  assert.deepEqual(entries("I-130").map((entry) => entry.formNumber).sort(), entries("F1").map((entry) => entry.formNumber).sort());
  for (const entry of entries("I-130")) for (const mapping of entry.checklistMappings) assert.ok(find(mapping.checklistKey), `${mapping.checklistKey} exists`);
  // the spouse relationship value the checklist stores
  assert.ok(q(petitioner, "petitioner_relationship").options.some((option) => option.value === "Husband/wife"));
});

test("nothing else changed: the F1 / K-1 / K-3 family checklists keep their original definitions and requiredness", () => {
  for (const key of ["i130_f1_petitioner_checklist", "i130_f1_beneficiary_checklist", "green_card_f1_beneficiary_checklist", "i864_f1_petitioner_checklist", "k1_petitioner_checklist", "k3_beneficiary_checklist"]) assert.ok(find(key), key);
  const f1 = find("i130_f1_petitioner_checklist");
  assert.equal(f1.questions.length, 57);
  assert.equal(q(f1, "petitioner_fatherDateOfBirth").required, true, "F1 keeps its original (stricter) requiredness");
  assert.equal(q(f1, "petitioner_maritalStatus").type, "text");
  assert.equal(find("i130_f1_beneficiary_checklist").questions.length, 32);
  assert.deepEqual(resolveFamilyChecklistKeys("F1", ""), ["i130_f1_petitioner_checklist", "i130_f1_beneficiary_checklist"]);
});

test("I-130 + Green Card (I-485): both I-130 checklists AND the Green Card checklist - plus the I-864 sponsor checklist - are assigned, whatever the filing path", () => {
  for (const path of ["", "PETITION_ONLY", "ADJUSTMENT_OF_STATUS", "CONSULAR"]) {
    const keys = resolveFamilyChecklistKeys("I-130 + I-485", path);
    assert.deepEqual(keys, ["i130_i130i485_petitioner_checklist", "i130_i130i485_beneficiary_checklist", "green_card_i130i485_beneficiary_checklist", "i864_i130i485_petitioner_checklist"]);
    for (const key of keys) assert.ok(find(key), `${key} is a registered definition`);
  }
  assert.equal(new Set(resolveFamilyChecklistKeys("I-130 + I-485", "")).size, 4, "no key twice (idempotent assignment)");
  // I-130 and F1 are unchanged
  assert.deepEqual(resolveFamilyChecklistKeys("F1", ""), ["i130_f1_petitioner_checklist", "i130_f1_beneficiary_checklist"]);
});

test("I-485 is a single-person case type (Adjustment of Status): the Green Card + I-864 checklists, answered by the applicant (client role), no family / employment variants", () => {
  const green = find("i485_green_card_checklist");
  const i864 = find("i485_i864_checklist");
  assert.ok(green && i864);
  for (const definition of [green, i864]) {
    assert.equal(definition.visaType, "Adjustment of Status");
    assert.equal(definition.checklistRole, "client");
    assert.equal(definition.isDefault, true);
    for (const question of definition.questions) assert.ok(!question.visibility.roles.includes("petitioner") && !question.visibility.roles.includes("beneficiary"), `${definition.key}.${question.key} is for the client`);
    assert.ok(CHECKLIST_PARTY_PATHS[definition.key], "canonical path table registered");
  }
  assert.equal(getCaseStructure("Adjustment of Status"), "single");
  assert.ok(VISA_TYPE_OPTIONS.some((option) => option.value === "adjustmentofstatus" && option.label === "I-485" && option.canonicalLabel === "Adjustment of Status"));
  assert.ok(!VISA_TYPE_OPTIONS.some((option) => /I-485 \((Employment|Family) Based\)/.test(option.label)), "no duplicate family / employment I-485");
  const entries = checklistSeeds.ENTRIES.filter((entry) => entry.visaType === "Adjustment of Status");
  const keysFor = (form) => entries.filter((entry) => entry.formNumber === form).flatMap((entry) => entry.checklistMappings.map((mapping) => mapping.checklistKey));
  assert.deepEqual(keysFor("I-485"), ["i485_green_card_checklist"]);
  assert.deepEqual(keysFor("I-864"), ["i485_i864_checklist"]);
  // the same Green Card questions as the family Green Card checklist
  assert.deepEqual(green.questions.map((q) => q.key), find("green_card_f1_beneficiary_checklist").questions.map((q) => q.key));
  assert.equal(resolveFamilyChecklistKeys("I-130 + I-485", "").length, 4, "the I-130 + I-485 case is unchanged");
});

test("I-140 + I-485: employment based (employer + employee), the I-140 checklists AND the I-485 checklists, one set of canonical paths for both", () => {
  const { I140I485_DEFINITIONS } = require("../i140i485Checklists");
  const byKey = Object.fromEntries(I140I485_DEFINITIONS.map((definition) => [definition.key, definition]));
  assert.deepEqual(Object.keys(byKey).sort(), ["i140_i485_employee_checklist", "i140_i485_employer_checklist", "i485_green_card_employee_checklist", "i485_i864_employee_checklist"]);
  assert.equal(byKey.i140_i485_employer_checklist.checklistRole, "employer");
  for (const key of ["i140_i485_employee_checklist", "i485_green_card_employee_checklist", "i485_i864_employee_checklist"]) assert.equal(byKey[key].checklistRole, "employee", key);
  for (const definition of I140I485_DEFINITIONS) {
    assert.equal(definition.isDefault, true);
    assert.ok(definition.visaTypes.includes("I-140/I-485") && definition.visaTypes.includes("I140/I485"));
    assert.ok(!/[+*?]/.test(definition.visaType), "the visa type is safe inside the default-checklist RegExp lookup");
    for (const question of definition.questions) assert.ok(!question.visibility.roles.some((role) => ["petitioner", "beneficiary", "client"].includes(role)), `${definition.key}.${question.key}: only employer / employee roles`);
    assert.ok(CHECKLIST_PARTY_PATHS[definition.key], `${definition.key} has its canonical path table`);
  }
  // the same canonical path serves the I-140 and the I-485 for every shared fact
  const paths = (key) => new Set(Object.values(CHECKLIST_PARTY_PATHS[key]).map((spec) => spec.path));
  for (const shared of ["beneficiary.lastName", "beneficiary.firstName", "beneficiary.dateOfBirth", "beneficiary.ssn", "beneficiary.alienRegistrationNumber", "beneficiary.email", "beneficiary.i94Number", "beneficiary.lastArrivalDate"]) {
    assert.ok(paths("i140_i485_employee_checklist").has(shared) && paths("i485_green_card_employee_checklist").has(shared), shared);
  }
  assert.equal(getCaseStructure("I-140/I-485"), "employer_employee");
  assert.ok(VISA_TYPE_OPTIONS.some((option) => option.value === "i140i485" && option.label === "I-140 + I-485" && option.canonicalLabel === "I-140/I-485"));
  const forms = visaFormSeeds.mappings.filter((row) => row.visaType === "I-140/I-485").map((row) => row.formNumber);
  for (const form of ["I-140", "I-485", "I-765", "I-131", "I-693", "I-485 Supplement J", "I-864"]) assert.ok(forms.includes(form), form);
  assert.ok(!forms.includes("I-130") && !forms.includes("DS-260"));
  for (const entry of checklistSeeds.ENTRIES.filter((e) => e.visaType === "I-140/I-485")) for (const mapping of entry.checklistMappings) assert.ok(mapping.checklistKey === "i907_premium_processing_profile" || byKey[mapping.checklistKey], `${mapping.checklistKey} exists`);
});
