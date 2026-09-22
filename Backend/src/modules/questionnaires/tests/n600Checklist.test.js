const assert = require("node:assert/strict");
const test = require("node:test");
const { N600_CHECKLIST_DEFINITION } = require("../n600Checklist");
const { mappings } = require("../../form-registry/seeds/visaFormMappings.seed");

// N-600 (Certificate of Citizenship) - an OPTIONAL add-on immigration
// process, attachable to any existing case regardless of visa type.
// DB-free, following n400Checklist.js's own established convention.

const def = N600_CHECKLIST_DEFINITION;

test("N-600 checklist is client-owned, never default, never a real visaType", () => {
  assert.equal(def.checklistRole, "client");
  assert.equal(def.isDefault, false, "must never be auto-resolved without explicit Case Manager approval");
  assert.equal(def.visaType, "N600");
});

test("client-facing title is the general-language process name, never 'N-600 Application'/'Apply for N-600'", () => {
  assert.equal(def.title, "Certificate of Citizenship Checklist");
  assert.doesNotMatch(def.title, /N-600/i);
  assert.doesNotMatch(def.title, /apply for/i);
});

test("registry: N-600 already exists (pre-existing AUTO_CREATE row under the dedicated 'Certificate of Citizenship' case type) and gained no new rows under any other visa type", () => {
  const n600Rows = mappings.filter((m) => m.formNumber === "N-600");
  assert.deepEqual(n600Rows.map((m) => m.visaType), ["Certificate of Citizenship"]);
  assert.equal(n600Rows[0].provisioningType, "AUTO_CREATE");
  const forbidden = ["IR-1", "CR-1", "F2A", "F2B", "K-1", "K-3", "H-1B", "L-1A", "EB-1A", "EB-2 NIW", "EB-2 PERM", "EB-3 Skilled Worker", "Adjustment of Status", "Green Card Renewal", "Naturalization"];
  forbidden.forEach((visaType) => assert.ok(!n600Rows.some((m) => m.visaType === visaType)));
});

test("legal name and Green Card name are kept as separate data points, not combined", () => {
  const keys = new Set(def.questions.map((q) => q.key));
  ["client_lastName", "client_firstName", "client_gcLastName", "client_gcFirstName", "client_gcMiddleName"].forEach((key) => assert.ok(keys.has(key), `${key} missing`));
});

test("Section 3: current immigration status drives LPR-specific fields and the 'Other' explanation", () => {
  const lprGate = [{ questionKey: "client_immigrationStatus", operator: "equals", value: "Lawful Permanent Resident / Green Card Holder" }];
  ["client_dateBecameLpr", "client_lprGrantingOffice", "client_previouslyAppliedCertOrPassport", "client_everAbandonedLpr", "client_everAbsentFromUs"].forEach((key) => {
    assert.deepEqual(def.questions.find((q) => q.key === key).conditionalLogic.rules, lprGate);
  });
  const otherGate = [{ questionKey: "client_immigrationStatus", operator: "equals", value: "Other" }];
  assert.deepEqual(def.questions.find((q) => q.key === "client_immigrationStatusOtherExplain").conditionalLogic.rules, otherGate);
});

test("absence-history repeatable table is gated on 'ever absent from the US' and is a real structured table, not free text", () => {
  const absence = def.questions.find((q) => q.key === "client_absenceHistory");
  assert.equal(absence.type, "repeating_group");
  assert.ok(absence.repeatable);
  assert.deepEqual(absence.metadata.fields.map((f) => f.key), ["dateLeftUS", "dateReturnedUS", "placeOfEntryUponReturn"]);
  assert.deepEqual(absence.conditionalLogic.rules, [{ questionKey: "client_everAbsentFromUs", operator: "equals", value: "Yes" }]);
});

test("adoption section is gated on 'were you adopted', re-adoption sub-section gated on the re-adoption question", () => {
  const adoptedGate = [{ questionKey: "client_wasAdopted", operator: "equals", value: "Yes" }];
  ["client_adoption_place", "client_adoption_date", "client_adoption_legalCustodyDate", "client_adoption_physicalCustodyDate", "client_wasReAdopted"].forEach((key) => {
    assert.deepEqual(def.questions.find((q) => q.key === key).conditionalLogic.rules, adoptedGate);
  });
  const reAdoptedGate = [{ questionKey: "client_wasReAdopted", operator: "equals", value: "Yes" }];
  ["client_reAdoption_place", "client_reAdoption_date", "client_reAdoption_legalCustodyDate", "client_reAdoption_physicalCustodyDate"].forEach((key) => {
    assert.deepEqual(def.questions.find((q) => q.key === key).conditionalLogic.rules, reAdoptedGate);
  });
});

test("father and mother citizenship-method branches gate the correct sub-fields independently", () => {
  ["father", "mother"].forEach((prefix) => {
    const methodKey = `client_${prefix}_citizenshipMethod`;
    const birthAbroadGate = [{ questionKey: methodKey, operator: "equals", value: "By Birth Abroad to U.S. Citizen Parents" }];
    assert.deepEqual(def.questions.find((q) => q.key === `client_${prefix}_certOfCitizenshipNumber`).conditionalLogic.rules, birthAbroadGate);
    const naturalizationGate = [{ questionKey: methodKey, operator: "equals", value: "By Naturalization" }];
    ["naturalizationPlace", "naturalizationCity", "naturalizationState", "naturalizationCertNumber", "naturalizationANumber", "naturalizationDate"].forEach((suffix) => {
      assert.deepEqual(def.questions.find((q) => q.key === `client_${prefix}_${suffix}`).conditionalLogic.rules, naturalizationGate);
    });
  });
});

test("father's and mother's current-spouse sections are gated on that parent's own marital status, independently", () => {
  const fatherMarriedGate = [{ questionKey: "client_father_maritalStatus", operator: "equals", value: "Married" }];
  ["client_fatherSpouse_firstName", "client_fatherSpouse_marriageDate", "client_fatherSpouseIsMother"].forEach((key) => {
    assert.deepEqual(def.questions.find((q) => q.key === key).conditionalLogic.rules, fatherMarriedGate);
  });
  const motherMarriedGate = [{ questionKey: "client_mother_maritalStatus", operator: "equals", value: "Married" }];
  ["client_motherSpouse_firstName", "client_motherSpouse_marriageDate", "client_motherSpouseIsFather"].forEach((key) => {
    assert.deepEqual(def.questions.find((q) => q.key === key).conditionalLogic.rules, motherMarriedGate);
  });
});

test("parent physical-presence repeatable table lets each entry specify Father or Mother, with no fixed entry limit", () => {
  const q = def.questions.find((question) => question.key === "client_parentPhysicalPresence");
  assert.equal(q.type, "repeating_group");
  assert.ok(q.repeatable);
  assert.deepEqual(q.metadata.fields.map((f) => f.key), ["parent", "fromDate", "toDate"]);
});

test("military-service branch is gated on 'has your U.S. citizen parent served'", () => {
  const gate = [{ questionKey: "client_parentServedMilitary", operator: "equals", value: "Yes" }];
  ["client_militaryServiceParent", "client_militaryServiceStartDate", "client_militaryServiceEndDate", "client_militaryDischargeType"].forEach((key) => {
    assert.deepEqual(def.questions.find((q) => q.key === key).conditionalLogic.rules, gate);
  });
});

test("document checklist: applicant documents vs. U.S.-citizen parent documents are kept as individual items, not collapsed", () => {
  const docs = def.questions.filter((q) => q.type === "file");
  const physicalPresenceDocs = docs.filter((d) => d.key.startsWith("n600_doc_physicalPresence_"));
  assert.equal(physicalPresenceDocs.length, 5, "physical-presence evidence must be 5 separate document items, not one generic upload");
  ["n600_doc_passportPhotos", "n600_doc_passportCopy", "n600_doc_birthCertificate"].forEach((key) => {
    assert.equal(docs.find((d) => d.key === key).required, true);
  });
  ["n600_doc_ssnCard", "n600_doc_greenCardCopy"].forEach((key) => {
    assert.equal(docs.find((d) => d.key === key).required, false, `${key} is "if available", not mandatory`);
  });
});

test("legitimation proof is gated on born-out-of-wedlock-and-never-legitimated, not shown unconditionally", () => {
  const doc = def.questions.find((q) => q.key === "n600_doc_legitimationProof");
  assert.equal(doc.required, false);
  assert.deepEqual(doc.conditionalLogic.rules, [
    { questionKey: "client_parentsMarriedAtBirth", operator: "equals", value: "No" },
    { questionKey: "client_parentsMarriedAfterBirth", operator: "equals", value: "No" },
  ]);
  assert.equal(doc.conditionalLogic.mode, "all");
});

test("marriage-certificate and marriage-termination documents are gated on either parent's marital history, using mode:any", () => {
  const marriageCert = def.questions.find((q) => q.key === "n600_doc_parentMarriageCertificate");
  assert.equal(marriageCert.conditionalLogic.mode, "any");
  assert.equal(marriageCert.conditionalLogic.rules.length, 2);
  const terminationDocs = def.questions.find((q) => q.key === "n600_doc_parentMarriageTerminationDocs");
  assert.equal(terminationDocs.conditionalLogic.mode, "any");
  assert.equal(terminationDocs.conditionalLogic.rules.length, 6);
});

test("checklist visibility is client-only (never petitioner/beneficiary/employer/employee/joint_sponsor)", () => {
  def.questions.forEach((q) => {
    assert.ok(q.visibility.roles.includes("client"));
    ["petitioner", "beneficiary", "employer", "employee", "joint_sponsor"].forEach((role) => {
      assert.ok(!q.visibility.roles.includes(role), `${q.key} must not be visible to ${role}`);
    });
  });
});

test("no duplicate question keys", () => {
  const keys = def.questions.map((q) => q.key);
  const duplicates = keys.filter((key, index) => keys.indexOf(key) !== index);
  assert.deepEqual(duplicates, []);
});
