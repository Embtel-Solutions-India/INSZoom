const assert = require("node:assert/strict");
const test = require("node:test");
const { CHANGE_OF_ADDRESS_DEFINITIONS, CHECKLIST_KEY_BY_TARGET_ROLE, CANONICAL_PREFIX_BY_TARGET_ROLE } = require("../changeOfAddressChecklist");

// Change of Address (AR-11) - optional, visa-agnostic, case-structure-
// agnostic add-on, attachable to any of the six participant roles. DB-free.

function byKey(key) {
  return CHANGE_OF_ADDRESS_DEFINITIONS.find((def) => def.key === key);
}

test("four variants exist, one per canonical namespace, all non-default and never a real visaType", () => {
  assert.equal(CHANGE_OF_ADDRESS_DEFINITIONS.length, 4);
  const keys = CHANGE_OF_ADDRESS_DEFINITIONS.map((d) => d.key).sort();
  assert.deepEqual(keys, [
    "change_of_address_employer_checklist",
    "change_of_address_joint_sponsor_checklist",
    "change_of_address_person_checklist",
    "change_of_address_petitioner_checklist",
  ].sort());
  CHANGE_OF_ADDRESS_DEFINITIONS.forEach((def) => {
    assert.equal(def.isDefault, false, `${def.key} must never be auto-resolved without explicit Case Manager attach`);
    assert.equal(def.visaType, "COA");
  });
});

test("client-facing title/description is plain language, never 'AR-11' or technical wording", () => {
  CHANGE_OF_ADDRESS_DEFINITIONS.forEach((def) => {
    assert.equal(def.title, "Change of Address");
    assert.doesNotMatch(def.title, /AR-?11/i);
    assert.doesNotMatch(def.description, /AR-?11/i);
    assert.doesNotMatch(def.description, /dependency mapping/i);
  });
});

test("each variant's Present Physical Address fields carry the correct canonicalPath for that participant's namespace", () => {
  const cases = [
    { key: "change_of_address_person_checklist", prefix: "contact" },
    { key: "change_of_address_employer_checklist", prefix: "company" },
    { key: "change_of_address_petitioner_checklist", prefix: "petitioner" },
    { key: "change_of_address_joint_sponsor_checklist", prefix: "jointSponsor" },
  ];
  cases.forEach(({ key, prefix }) => {
    const def = byKey(key);
    const street = def.questions.find((q) => q.key === "coa_present_street");
    const city = def.questions.find((q) => q.key === "coa_present_city");
    const state = def.questions.find((q) => q.key === "coa_present_state");
    const zip = def.questions.find((q) => q.key === "coa_present_zip");
    assert.equal(street.mapping.canonicalPath, `${prefix}.address.line1`);
    assert.equal(city.mapping.canonicalPath, `${prefix}.address.city`);
    assert.equal(state.mapping.canonicalPath, `${prefix}.address.state`);
    assert.equal(zip.mapping.canonicalPath, `${prefix}.address.zip`);
  });
});

test("Previous Physical Address and Mailing Address fields carry NO canonicalPath (informational/self-reported only, not autofill sources)", () => {
  const def = byKey("change_of_address_person_checklist");
  ["coa_previous_street", "coa_previous_city", "coa_previous_state", "coa_previous_zip", "coa_mailing_street", "coa_mailing_city"].forEach((key) => {
    const q = def.questions.find((question) => question.key === key);
    assert.ok(q, `${key} missing`);
    assert.equal(q.mapping, undefined, `${key} must not carry a canonicalPath`);
  });
});

test("mailing address fields are gated on 'same as present' == No, structured Yes/No, not free text", () => {
  const def = byKey("change_of_address_person_checklist");
  const gate = def.questions.find((q) => q.key === "coa_mailing_sameAsPresent");
  assert.equal(gate.type, "radio");
  assert.deepEqual(gate.options.map((o) => o.value), ["Yes", "No"]);
  ["coa_mailing_street", "coa_mailing_apt", "coa_mailing_city", "coa_mailing_state", "coa_mailing_zip"].forEach((key) => {
    const q = def.questions.find((question) => question.key === key);
    assert.deepEqual(q.conditionalLogic.rules, [{ questionKey: "coa_mailing_sameAsPresent", operator: "equals", value: "No" }]);
  });
});

test("visibility.roles for the shared 'person' variant covers employee, beneficiary, AND client - not just its nominal checklistRole", () => {
  const def = byKey("change_of_address_person_checklist");
  assert.equal(def.checklistRole, "client");
  def.questions.forEach((q) => {
    ["client", "employee", "beneficiary"].forEach((role) => assert.ok(q.visibility.roles.includes(role), `${q.key} must be visible to ${role}`));
    ["employer", "petitioner", "joint_sponsor"].forEach((role) => assert.ok(!q.visibility.roles.includes(role), `${q.key} must not be visible to ${role}`));
  });
});

test("employer/petitioner/joint_sponsor variants are scoped strictly to their own single role", () => {
  const cases = [
    { key: "change_of_address_employer_checklist", role: "employer" },
    { key: "change_of_address_petitioner_checklist", role: "petitioner" },
    { key: "change_of_address_joint_sponsor_checklist", role: "joint_sponsor" },
  ];
  cases.forEach(({ key, role }) => {
    const def = byKey(key);
    def.questions.forEach((q) => {
      assert.ok(q.visibility.roles.includes(role));
      ["employee", "beneficiary", "client", "petitioner", "employer", "joint_sponsor"].filter((r) => r !== role).forEach((otherRole) => {
        assert.ok(!q.visibility.roles.includes(otherRole), `${key}'s ${q.key} must not be visible to ${otherRole}`);
      });
    });
  });
});

test("CHECKLIST_KEY_BY_TARGET_ROLE and CANONICAL_PREFIX_BY_TARGET_ROLE cover all six roles and resolve to registered definitions", () => {
  const roles = ["employer", "employee", "petitioner", "beneficiary", "joint_sponsor", "client"];
  roles.forEach((role) => {
    const key = CHECKLIST_KEY_BY_TARGET_ROLE[role];
    assert.ok(key, `${role} missing from CHECKLIST_KEY_BY_TARGET_ROLE`);
    assert.ok(byKey(key), `${key} (for ${role}) must be a registered definition`);
    assert.ok(CANONICAL_PREFIX_BY_TARGET_ROLE[role], `${role} missing from CANONICAL_PREFIX_BY_TARGET_ROLE`);
  });
  // employee and beneficiary share the same underlying checklist/namespace.
  assert.equal(CHECKLIST_KEY_BY_TARGET_ROLE.employee, CHECKLIST_KEY_BY_TARGET_ROLE.beneficiary);
  assert.equal(CANONICAL_PREFIX_BY_TARGET_ROLE.employee, CANONICAL_PREFIX_BY_TARGET_ROLE.beneficiary);
});

test("no duplicate question keys within any variant", () => {
  CHANGE_OF_ADDRESS_DEFINITIONS.forEach((def) => {
    const keys = def.questions.map((q) => q.key);
    const duplicates = keys.filter((key, index) => keys.indexOf(key) !== index);
    assert.deepEqual(duplicates, [], `${def.key} has duplicate question keys: ${duplicates.join(", ")}`);
  });
});

test("Information About You fields exist and are structured, not one free-text address field", () => {
  const def = byKey("change_of_address_person_checklist");
  ["coa_lastName", "coa_firstName", "coa_middleName", "coa_dateOfBirth", "coa_aNumber"].forEach((key) => {
    assert.ok(def.questions.some((q) => q.key === key), `${key} missing`);
  });
  ["coa_present_street", "coa_present_apt", "coa_present_city", "coa_present_state", "coa_present_zip"].forEach((key) => {
    const q = def.questions.find((question) => question.key === key);
    assert.ok(q, `${key} missing - address must be structured fields, not one large text field`);
    assert.notEqual(q.type, "textarea");
  });
});
