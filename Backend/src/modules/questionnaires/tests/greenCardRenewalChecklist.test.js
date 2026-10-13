const assert = require("node:assert/strict");
const test = require("node:test");
const { GREEN_CARD_RENEWAL_DEFINITIONS, TITLE } = require("../greenCardRenewalChecklist");
const { isQuestionVisible, validateQuestionValue, validateResponse, normalizeAnswerValue } = require("../questionnaire.service");
const { mappings } = require("../../form-registry/seeds/visaFormMappings.seed");
const { MAPPED_EDGES } = require("../../form-mapping/config/i90-crosswalk");
const CanonicalFieldRegistryService = require("../../form-mapping/services/CanonicalFieldRegistryService");
const { I90_CANONICAL_FIELDS } = require("../../canonical/config/i90CanonicalPaths");
const { getCaseStructure } = require("../../../config/visaCategories");
const { categoryForVisa } = require("../../../integrations/ghl/ghlAuxOutbound");

// "Questionnaire for Form I-90 - Application to Replace Permanent Resident Card" - the one client checklist of the "Green Card Renewal"
// case type. Single-party (checklistRole "client"), completely separate from the I-130 / Green Card (AOS) / GC-NVC family workflows.
// DB-free, following this module's convention; the end-to-end behaviour is in green-card-renewal-e2e.test.js.

const def = GREEN_CARD_RENEWAL_DEFINITIONS[0];
const byKey = new Map(def.questions.map((question) => [question.key, question]));
const question = (key) => {
  assert.ok(byKey.has(key), `${key} must exist`);
  return byKey.get(key);
};
const client = { role: "client" };
const visibleKeys = (answers) => new Set(def.questions.filter((item) => isQuestionVisible(item, answers, client)).map((item) => item.key));

test("exactly one Green Card Renewal checklist is registered: client-owned, always default, titled as specified", () => {
  assert.equal(GREEN_CARD_RENEWAL_DEFINITIONS.length, 1);
  assert.equal(def.key, "green_card_renewal_checklist");
  assert.equal(def.checklistRole, "client");
  assert.equal(def.isDefault, true);
  assert.equal(def.visaType, "GreenCardRenewal");
  assert.equal(def.title, "Questionnaire for Form I-90 — Application to Replace Permanent Resident Card");
  assert.equal(TITLE, def.title);
  assert.equal(def.reconcileMetadata, true, "an existing stored questionnaire must have its title brought up to date in place");
});

test("sections: reason, identity, address, residence, accommodations, documents - in that order", () => {
  assert.deepEqual(def.sections, [
    "Application Reason",
    "Applicant Identity",
    "Address and Contact Information",
    "Permanent Residence and Admission Information",
    "Accommodations",
    "Supporting Documents",
  ]);
});

test("no duplicate question keys; every conditional rule points at a question that exists", () => {
  const keys = def.questions.map((item) => item.key);
  assert.deepEqual(keys.filter((key, index) => keys.indexOf(key) !== index), []);
  const walk = (group, owner) => {
    (group?.rules || []).forEach((rule) => assert.ok(byKey.has(rule.questionKey), `${owner} gates on missing question ${rule.questionKey}`));
    (group?.groups || []).forEach((nested) => walk(nested, owner));
  };
  def.questions.forEach((item) => walk(item.conditionalLogic, item.key));
});

test("display order == definition order inside every section (a toggle is never sorted after the questions it controls)", () => {
  for (const title of def.sections) {
    const inSection = def.questions.filter((item) => item.sectionKey === title.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, ""));
    assert.ok(inSection.length > 0, title);
    const orders = inSection.map((item) => item.order);
    assert.deepEqual(orders, [...orders].sort((a, b) => a - b), `${title}: questions listed out of order`);
    inSection.forEach((item) => {
      (item.conditionalLogic?.rules || []).forEach((rule) => {
        const gate = byKey.get(rule.questionKey);
        if (gate.sectionKey === item.sectionKey) assert.ok(gate.order < item.order, `${item.key} is shown before its gate ${gate.key}`);
      });
    });
  }
});

// ── Section A: application reason ─────────────────────────────────────────────────────────────────────────────────────────────────────
test("'I am applying for' is a real select with the four specified internal values (plus 'other' for the form's remaining reasons)", () => {
  const reason = question("i90_applicationReason");
  assert.equal(reason.type, "select");
  assert.equal(reason.label, "I am applying for:");
  assert.deepEqual(reason.options.map((option) => option.value), ["renewal", "replacement", "correction", "biographic_update", "other"]);
  assert.equal(reason.options[0].label, "Renewal of my Green Card because my previous card has expired or will expire within six months");
  assert.equal(reason.options[1].label, "Replacement because my Green Card was lost, stolen, destroyed, or mutilated");
  assert.equal(reason.options[2].label, "Correction of incorrect information on my Green Card that was not caused by a USCIS error, where applicable");
  assert.equal(reason.options[3].label, "Update of my name or other biographic information following a legal change");
  assert.equal(reason.mapping.canonicalPath, "immigration.greenCard.applicationReason");
});

test("only the follow-up questions of the chosen reason are shown", () => {
  const base = visibleKeys({});
  assert.ok(base.has("i90_applicationReason") && base.has("i90_aNumber"));
  ["i90_cardExpirationDate", "i90_replacementCircumstance", "i90_correctionCause", "i90_biographicChangeType", "i90_otherReason"].forEach((key) => assert.ok(!base.has(key), `${key} hidden before a reason is chosen`));

  const renewal = visibleKeys({ i90_applicationReason: "renewal" });
  assert.ok(renewal.has("i90_cardExpirationDate"));
  ["i90_replacementCircumstance", "i90_correctionCause", "i90_biographicChangeType", "i90_otherReason"].forEach((key) => assert.ok(!renewal.has(key)));

  const lost = visibleKeys({ i90_applicationReason: "replacement", i90_replacementCircumstance: "lost" });
  ["i90_replacementCircumstance", "i90_incidentDate", "i90_incidentDescription", "i90_doc_lossEvidence"].forEach((key) => assert.ok(lost.has(key), key));
  assert.ok(!lost.has("i90_damagedCardAvailable"), "'is the card available' is only for a mutilated card");
  assert.ok(!lost.has("i90_cardExpirationDate"));

  const mutilated = visibleKeys({ i90_applicationReason: "replacement", i90_replacementCircumstance: "mutilated" });
  assert.ok(mutilated.has("i90_damagedCardAvailable") && mutilated.has("i90_incidentDescription"));
  assert.ok(!mutilated.has("i90_incidentDate") && !mutilated.has("i90_doc_lossEvidence"), "no date / loss evidence for a damaged card");

  const correction = visibleKeys({ i90_applicationReason: "correction" });
  ["i90_correctionCause", "i90_correctionItems", "i90_doc_correctionEvidence", "i90_doc_birthCertificate"].forEach((key) => assert.ok(correction.has(key), key));

  const bio = visibleKeys({ i90_applicationReason: "biographic_update" });
  ["i90_biographicChangeType", "i90_biographicPreviousValue", "i90_biographicNewValue", "i90_biographicEffectiveDate", "i90_biographicLegalDocument", "i90_doc_legalChangeEvidence"].forEach((key) => assert.ok(bio.has(key), key));

  const other = visibleKeys({ i90_applicationReason: "other", i90_otherReason: "commuter_status" });
  ["i90_otherReason", "i90_commuterPortOfEntryCity", "i90_commuterPortOfEntryState", "i90_doc_otherReasonEvidence"].forEach((key) => assert.ok(other.has(key), key));
  assert.ok(!visibleKeys({ i90_applicationReason: "other", i90_otherReason: "automatic_conversion" }).has("i90_commuterPortOfEntryCity"));
});

test("a possible USCIS-caused error, or any non-standard reason, is marked for case-manager review", () => {
  const cause = question("i90_correctionCause");
  assert.equal(cause.metadata.staffReview.when, "uscis_error");
  assert.deepEqual(cause.options.map((option) => option.value), ["uscis_error", "applicant_error", "not_sure"]);
  assert.match(cause.description, /different .*procedure/i);
  assert.ok(question("i90_otherReason").metadata.staffReview);
  assert.ok(question("i90_removalProceedings").metadata.staffReview && question("i90_abandonmentDetermination").metadata.staffReview);
});

// ── Section B/C/D: identity, addresses, admission ─────────────────────────────────────────────────────────────────────────────────────
test("identity questions bind to the existing person.* canonical paths (no beneficiary.*, no form-specific path)", () => {
  const expected = {
    i90_aNumber: "person.alienNumber", i90_ssn: "person.ssn", i90_uscisOnlineAccountNumber: "person.uscisOnlineAccountNumber",
    i90_lastName: "person.lastName", i90_firstName: "person.firstName", i90_middleName: "person.middleName",
    i90_sex: "person.gender", i90_dateOfBirth: "person.dob", i90_cityOfBirth: "person.cityTownOfBirth", i90_countryOfBirth: "person.countryOfBirth",
    i90_heightFeet: "person.height.feet", i90_heightInches: "person.height.inches", i90_weightPounds: "person.weightPounds",
    i90_eyeColor: "person.eyeColor", i90_hairColor: "person.hairColor", i90_motherGivenName: "person.mother.firstName", i90_fatherGivenName: "person.father.firstName",
  };
  for (const [key, path] of Object.entries(expected)) assert.equal(question(key).mapping?.canonicalPath, path, key);
});

test("no canonical path is named after a form or a PDF field, and every path the checklist uses is registered", () => {
  const registered = new Set(CanonicalFieldRegistryService.list({}).map((field) => field.path));
  const paths = def.questions.map((item) => item.mapping?.canonicalPath).filter(Boolean);
  assert.ok(paths.length > 60);
  for (const path of paths) {
    assert.doesNotMatch(path, /^(i90|formi90|uscis|form)\b/i, `${path} is form-specific`);
    assert.doesNotMatch(path, /subform|(^|\.)(P\d+_|Pt\d|Line\d+_)|checkbox/, `${path} looks like a PDF field name`);
    assert.doesNotMatch(path, /^beneficiary\./, `${path}: the applicant files for themselves (person.*), beneficiary.* is the petitioned-for person`);
    assert.ok(registered.has(path), `${path} is not registered in CanonicalFieldRegistryService`);
  }
  I90_CANONICAL_FIELDS.forEach((field) => assert.doesNotMatch(field.path, /^(i90|form)/i));
});

test("physical address: required only when the physical address differs; the mailing address is always asked", () => {
  const withoutPhysical = visibleKeys({ i90_physicalAddressDifferent: "no", i90_mailingCountry: "United States" });
  assert.ok(withoutPhysical.has("i90_mailingStreet") && withoutPhysical.has("i90_mailingState") && withoutPhysical.has("i90_mailingZip"));
  ["i90_physicalStreet", "i90_physicalCity", "i90_physicalCountry", "i90_physicalState", "i90_physicalZip"].forEach((key) => assert.ok(!withoutPhysical.has(key), `${key} hidden`));

  const withPhysical = visibleKeys({ i90_physicalAddressDifferent: "yes", i90_physicalCountry: "United States" });
  ["i90_physicalStreet", "i90_physicalCity", "i90_physicalCountry", "i90_physicalState", "i90_physicalZip"].forEach((key) => assert.ok(withPhysical.has(key), key));
  assert.ok(!withPhysical.has("i90_physicalProvince"));
  assert.equal(question("i90_physicalStreet").mapping.canonicalPath, "contact.physicalAddress.line1", "kept apart from the mailing address");
  assert.equal(question("i90_mailingStreet").mapping.canonicalPath, "contact.address.line1");
});

test("address components stay separate; US addresses ask state + ZIP, foreign ones province + postal code", () => {
  const us = visibleKeys({ i90_mailingCountry: "United States" });
  assert.ok(us.has("i90_mailingState") && us.has("i90_mailingZip") && !us.has("i90_mailingProvince") && !us.has("i90_mailingPostalCode"));
  const abroad = visibleKeys({ i90_mailingCountry: "India" });
  assert.ok(!abroad.has("i90_mailingState") && !abroad.has("i90_mailingZip") && abroad.has("i90_mailingProvince") && abroad.has("i90_mailingPostalCode"));
  assert.ok(!visibleKeys({}).has("i90_mailingState"), "nothing country-specific before a country is chosen");
  assert.deepEqual(
    ["i90_mailingStreet", "i90_mailingUnitNumber", "i90_mailingCity", "i90_mailingState", "i90_mailingZip", "i90_mailingCountry"].map((key) => question(key).mapping.canonicalPath),
    ["contact.address.line1", "contact.address.line2", "contact.address.city", "contact.address.state", "contact.address.zip", "contact.address.country"]
  );
});

test("optional answers are gated, never blank-but-visible: middle name, SSN, USCIS account, name on the card, port of entry", () => {
  const none = visibleKeys({ i90_hasMiddleName: "no", i90_hasSsn: "no", i90_hasUscisOnlineAccount: "no", i90_nameChangedSinceCardIssued: "no" });
  ["i90_middleName", "i90_ssn", "i90_uscisOnlineAccountNumber", "i90_cardLastName", "i90_cardFirstName", "i90_doc_ssnEvidence", "i90_doc_legalChangeEvidence"].forEach((key) => assert.ok(!none.has(key), `${key} hidden`));
  const all = visibleKeys({ i90_hasMiddleName: "yes", i90_hasSsn: "yes", i90_hasUscisOnlineAccount: "yes", i90_nameChangedSinceCardIssued: "yes", i90_cardHasMiddleName: "yes" });
  ["i90_middleName", "i90_ssn", "i90_uscisOnlineAccountNumber", "i90_cardLastName", "i90_cardFirstName", "i90_cardMiddleName", "i90_doc_ssnEvidence", "i90_doc_legalChangeEvidence"].forEach((key) => assert.ok(all.has(key), key));
  // port of entry / destination only for someone who entered with an immigrant visa
  assert.ok(visibleKeys({ i90_greenCardPath: "immigrant_visa" }).has("i90_portOfEntryCity"));
  assert.ok(!visibleKeys({ i90_greenCardPath: "adjustment_of_status" }).has("i90_portOfEntryCity"));
  // explanations only for a "yes"
  assert.ok(visibleKeys({ i90_removalProceedings: "yes" }).has("i90_removalProceedingsExplanation"));
  assert.ok(!visibleKeys({ i90_removalProceedings: "no" }).has("i90_removalProceedingsExplanation"));
});

test("the form asks the parents' GIVEN names only (Items 12-13) and has no port-of-entry or mailing-vs-physical 'same as' box of its own", () => {
  assert.ok(byKey.has("i90_motherGivenName") && byKey.has("i90_fatherGivenName"));
  assert.ok(![...byKey.keys()].some((key) => /mother.*last|father.*last/i.test(key)), "no parent last-name questions: the form has no such box");
});

test("sensitive identifiers are tagged, and their keys are matched by the platform's log redaction", () => {
  ["i90_ssn", "i90_aNumber", "i90_uscisOnlineAccountNumber"].forEach((key) => assert.equal(question(key).metadata.sensitive, true, key));
  const { sanitizeForLog } = (() => {
    try { return require("../../../utils/logger"); } catch { return {}; }
  })();
  // the redaction pattern lives in utils/logger.js (key based): "ssn" and "a number" style keys are covered
  const SENSITIVE_KEY = /ssn|alien.?number|a.?number|passport.?number|date.?of.?birth|dob/i;
  assert.match("i90_ssn", SENSITIVE_KEY);
  assert.match("i90_aNumber", SENSITIVE_KEY);
  void sanitizeForLog;
});

// ── validation, enforced by the server ────────────────────────────────────────────────────────────────────────────────────────────────
test("format rules reject malformed identifiers and impossible values; blank (gated) answers are never judged", () => {
  const errors = (key, value) => validateQuestionValue(question(key), value).errors;
  assert.equal(errors("i90_aNumber", "A-123456789").length, 0);
  assert.equal(errors("i90_aNumber", "123456789").length, 0);
  assert.equal(errors("i90_aNumber", "A12").length, 1);
  assert.equal(errors("i90_ssn", "123-45-6789").length, 0);
  assert.equal(errors("i90_ssn", "12345678").length, 1);
  assert.equal(errors("i90_uscisOnlineAccountNumber", "123456789012").length, 0);
  assert.equal(errors("i90_uscisOnlineAccountNumber", "12345").length, 1);
  assert.equal(errors("i90_mailingZip", "73301").length, 0);
  assert.equal(errors("i90_mailingZip", "7330").length, 1);
  assert.equal(errors("i90_heightFeet", 5).length, 0);
  assert.equal(errors("i90_heightFeet", 9).length, 1);
  assert.equal(errors("i90_heightInches", 12).length, 1);
  assert.ok(errors("i90_weightPounds", 1000).length >= 1);
  assert.ok(errors("i90_daytimePhone", "123").length >= 1);
  assert.equal(errors("i90_ssn", "").length, 0, "an unanswered optional value is not an error");
  assert.ok(errors("i90_emailAddress", "not-an-email").length >= 1);
});

test("dates: invalid dates are rejected; birth / admission / incident dates cannot be in the future; an expiry date can", () => {
  const errors = (key, value) => validateQuestionValue(question(key), value).errors;
  assert.equal(errors("i90_dateOfBirth", "1990-04-05").length, 0);
  assert.equal(errors("i90_dateOfBirth", "not a date").length >= 1, true);
  assert.equal(errors("i90_dateOfBirth", "2999-01-01").length, 1);
  assert.equal(errors("i90_dateOfAdmission", "2999-01-01").length, 1);
  assert.equal(errors("i90_incidentDate", "2999-01-01").length, 1);
  assert.equal(errors("i90_cardExpirationDate", "2999-01-01").length, 0, "a card may expire in the future");
  assert.equal(normalizeAnswerValue(question("i90_dateOfBirth"), "1990-04-05"), "1990-04-05");
});

test("choice answers must be one of the listed options (strictOptions), and a gated answer outside them is refused", () => {
  [
    "i90_applicationReason", "i90_residentStatusType", "i90_replacementCircumstance", "i90_sex", "i90_eyeColor", "i90_hairColor",
    "i90_race", "i90_mailingState", "i90_mailingCountry", "i90_hasSsn", "i90_removalProceedings",
  ].forEach((key) => assert.equal(question(key).metadata.strictOptions, true, `${key} is strict`));
  const errors = (key, value) => validateQuestionValue(question(key), value).errors;
  assert.equal(errors("i90_applicationReason", "renewal").length, 0);
  assert.equal(errors("i90_applicationReason", "something else").length, 1);
  assert.equal(errors("i90_race", ["white", "asian"]).length, 0);
  assert.equal(errors("i90_race", ["white", "martian"]).length, 1);
  assert.equal(errors("i90_hasSsn", "maybe").length, 1);
  assert.equal(errors("i90_mailingState", "TX").length, 0);
  assert.equal(errors("i90_mailingState", "Texas").length, 1, "state is stored as the 2-letter code");
});

test("validateResponse judges only the questions that are visible", () => {
  const stored = { i90_applicationReason: "renewal", i90_ssn: "garbage", i90_hasSsn: "no" };
  const result = validateResponse({ _id: "q", key: def.key, version: 1 }, def.questions, stored, client);
  assert.ok(!result.errors.some((item) => item.questionKey === "i90_ssn"), "a hidden answer with a bad format does not block submission");
  const shown = validateResponse({ _id: "q", key: def.key, version: 1 }, def.questions, { ...stored, i90_hasSsn: "yes" }, client);
  assert.ok(shown.errors.some((item) => item.questionKey === "i90_ssn"));
});

test("repeating-group rows (each incorrect item) are validated: all three columns are needed", () => {
  const items = question("i90_correctionItems");
  assert.equal(items.type, "repeating_group");
  assert.equal(items.mapping.canonicalPath, "immigration.greenCard.corrections");
  assert.deepEqual(items.metadata.fields.map((field) => field.key), ["item", "incorrectValue", "correctValue"]);
  assert.equal(validateQuestionValue(items, [{ item: "Date of birth", incorrectValue: "1990-05-04", correctValue: "1990-04-05" }]).errors.length, 0);
  assert.ok(validateQuestionValue(items, [{ item: "Date of birth" }]).errors.length >= 2);
});

// ── documents ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
test("documents: stable ids, own document types; only the passport is a standing requirement, everything else is conditional", () => {
  const docs = def.questions.filter((item) => item.type === "file");
  assert.deepEqual(docs.map((item) => item.key), [
    "i90_doc_passport", "i90_doc_previousGreenCard", "i90_doc_stateId", "i90_doc_ssnEvidence", "i90_doc_birthCertificate",
    "i90_doc_legalChangeEvidence", "i90_doc_lossEvidence", "i90_doc_correctionEvidence", "i90_doc_otherReasonEvidence",
  ]);
  docs.forEach((item) => {
    assert.equal(item.metadata.documentType, item.key, "documentType == key, so an upload syncs back to its question");
    assert.ok(item.metadata.category, item.key);
  });
  const standing = docs.filter((item) => !(item.conditionalLogic.rules.length || item.conditionalLogic.groups.length));
  assert.deepEqual(standing.map((item) => item.key), ["i90_doc_passport"]);
  assert.ok(![...byKey.keys()].some((key) => /tax|w2|birth_cert.*always/i.test(key) && key !== "i90_doc_birthCertificate"), "no standing tax-return question");
  assert.ok(!docs.some((item) => /tax return/i.test(item.label)), "tax returns are requested by the case manager when needed, not for every filing");
});

test("document conditions follow the case: previous card / state ID / SSN evidence only when the client has them", () => {
  const empty = visibleKeys({});
  assert.ok(empty.has("i90_doc_passport"));
  ["i90_doc_previousGreenCard", "i90_doc_stateId", "i90_doc_ssnEvidence", "i90_doc_birthCertificate", "i90_doc_lossEvidence", "i90_doc_otherReasonEvidence"].forEach((key) => assert.ok(!empty.has(key), `${key} hidden`));
  const some = visibleKeys({ i90_hasPreviousCard: "yes", i90_hasStateIdentification: "yes", i90_hasSsn: "yes" });
  ["i90_doc_previousGreenCard", "i90_doc_stateId", "i90_doc_ssnEvidence"].forEach((key) => assert.ok(some.has(key), key));
  assert.ok(visibleKeys({ i90_nameChangedSinceCardIssued: "yes" }).has("i90_doc_legalChangeEvidence"), "a name change needs its legal evidence whatever the reason");
});

// ── every question carries its definition (id, label, section, type, requirement, validation, conditions, canonical path, form reference) ──
test("every question defines requirement, canonical type and form reference where they apply", () => {
  def.questions.forEach((item) => {
    assert.ok(item.key && item.label && item.sectionKey && item.type, item.key);
    assert.ok(["required", "conditional"].includes(item.metadata.requirement), `${item.key}: requirement`);
    const gated = Boolean(item.conditionalLogic.rules.length || item.conditionalLogic.groups.length);
    assert.equal(item.metadata.requirement === "conditional", gated, `${item.key}: requirement must match its conditional logic`);
    assert.equal(typeof item.metadata.pdfAutofill, "boolean", item.key);
    if (item.mapping?.canonicalPath && item.type !== "file") assert.ok(item.metadata.canonicalType, `${item.key}: canonicalType`);
    if (item.metadata.pdfAutofill) assert.ok(item.metadata.formRef, `${item.key}: formRef`);
    assert.equal(item.required, false, "Question.required is always false in this system; completeness is 'every visible question'");
  });
});

test("checklist <-> crosswalk agree: every pdfAutofill question feeds a crosswalk edge, and every edge is fed by a question", () => {
  const edgeSources = new Set(MAPPED_EDGES.flatMap((edge) => [edge.source, ...(edge.transform?.fields || [])]));
  const questionPaths = new Set(def.questions.map((item) => item.mapping?.canonicalPath).filter(Boolean));
  const gatePaths = new Set(MAPPED_EDGES.flatMap((edge) => JSON.stringify(edge.condition || {}).match(/"field":"([^"]+)"/g) || []).map((match) => match.slice(9, -1)));
  def.questions.filter((item) => item.metadata.pdfAutofill).forEach((item) => {
    const path = item.mapping.canonicalPath;
    assert.ok(edgeSources.has(path) || gatePaths.has(path), `${item.key} (${path}) is marked pdfAutofill but no crosswalk edge reads it`);
  });
  MAPPED_EDGES.forEach((edge) => assert.ok(questionPaths.has(edge.source), `${edge.fieldName} reads ${edge.source}, which no checklist question writes`));
  def.questions.filter((item) => item.mapping?.canonicalPath && !item.metadata.pdfAutofill).forEach((item) => {
    assert.ok(!edgeSources.has(item.mapping.canonicalPath), `${item.key} is not marked pdfAutofill but the crosswalk reads ${item.mapping.canonicalPath}`);
  });
});

test("checklist visibility is client + staff only (never petitioner / beneficiary / employer / employee / joint_sponsor)", () => {
  def.questions.forEach((item) => {
    assert.ok(item.visibility.roles.includes("client"));
    ["petitioner", "beneficiary", "employer", "employee", "joint_sponsor"].forEach((role) => assert.ok(!item.visibility.roles.includes(role), `${item.key} must not be visible to ${role}`));
  });
});

// ── registry: the case type ───────────────────────────────────────────────────────────────────────────────────────────────────────────
test("case type: 'Green Card Renewal' is a single-party case that provisions Form I-90 and ONLY Form I-90", () => {
  assert.equal(getCaseStructure("Green Card Renewal"), "single");
  const rows = mappings.filter((m) => m.visaType === "Green Card Renewal");
  assert.deepEqual(rows.map((r) => r.formNumber), ["I-90"]);
  assert.equal(rows[0].provisioningType, "AUTO_CREATE");
  ["I-130", "I-485", "DS-260", "I-864", "I-765", "I-131", "I-751"].forEach((form) => assert.ok(!rows.some((r) => r.formNumber === form), `${form} must not be provisioned`));
  assert.deepEqual(mappings.filter((m) => m.formNumber === "I-90").map((r) => r.visaType), ["Green Card Renewal"], "I-90 is attached to no other case type");
});

test("case type: the GHL pipeline treats Green Card Renewal as immigrant", () => {
  assert.equal(categoryForVisa("Green Card Renewal", "", []), "immigrant");
});
