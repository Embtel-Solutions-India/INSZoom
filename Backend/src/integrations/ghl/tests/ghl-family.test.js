const test = require("node:test");
const assert = require("node:assert/strict");

const { planFromResolution } = require("../ghlVisaService");
const { presentCard } = require("../ghlPresenter");
const { ghlSystemActor } = require("../ghlSystemActor");
const caseService = require("../../../modules/cases/case.service");

const resolution = (structure, visaType = "X") => ({ status: "mapped", structure, visaType, petitionSubType: "", category: "immigrant", field: "service_type", value: "v" });

// ---- routing: each structure is applied only on its OWN intake path ----------------

test("a family visa is applied only on the family path (and only as a whole case)", () => {
  const family = planFromResolution(resolution("family", "K-1"), { allowFamily: true });
  assert.equal(family.applied, true);
  assert.deepEqual(family.fields, { visaType: "K-1", visaCategory: "K-1", petitionType: "K-1", visaSelectionStatus: "selected" });
  assert.equal(planFromResolution(resolution("family", "K-1")).applied, false); // existing individual card: never converted
  assert.equal(planFromResolution(resolution("family", "K-1"), { allowEmployer: true }).applied, false); // the employer path never takes a family visa
});

test("an employer visa is never taken by the family path, nor a family visa by the employer path", () => {
  assert.equal(planFromResolution(resolution("employer_employee", "TN"), { allowFamily: true }).applied, false);
  assert.equal(planFromResolution(resolution("family", "IR-1"), { allowEmployer: true }).applied, false);
  assert.equal(planFromResolution(resolution("single", "F-1")).applied, true); // single-party still applies everywhere
});

// ---- the system actor ---------------------------------------------------------------------

test("the system actor passes the existing access check, has no person behind it, and is never shared", () => {
  const actor = ghlSystemActor();
  assert.equal(actor._id, undefined);
  assert.equal(actor.role, "super_admin");
  assert.equal(caseService.canAccessCase(actor, { _id: "c1", caseNumber: "N" }), true);
  assert.equal(caseService.canAccessCase(null, { _id: "c1" }), false); // no actor at all is what used to be refused
  actor.role = "client";
  assert.equal(ghlSystemActor().role, "super_admin", "each call gets its own object");
});

// ---- the board card for a family case ------------------------------------------------------

const familyCase = (extra = {}) => ({
  _id: "f1",
  caseNumber: "N-1",
  petitionerName: "John Smith",
  clientName: "", // the beneficiary's (unknown yet)
  clientEmail: "",
  visaType: "K-1",
  integrations: { ghl: { role: "family", unifiedStageKey: "x", pipelineId: "pA", category: "immigrant", sync: { state: "synced" } } },
  ...extra,
});

test("a family card is titled by the PETITIONER and never shows a separate beneficiary card or email", () => {
  const card = presentCard(familyCase(), { role: "admin" });
  assert.deepEqual([card.isFamily, card.clientName, card.clientEmail, card.beneficiaryName, card.beneficiaryIdentified], [true, "John Smith", null, "", false]);
});

test("the beneficiary appears on the card from the invitation, else from what the canonical profile recorded", () => {
  assert.equal(presentCard(familyCase({ beneficiaryInvite: { name: "Maria Smith", email: "m@x.com" } }), { role: "admin" }).beneficiaryName, "Maria Smith");
  const recorded = presentCard(familyCase({ canonicalProfile: { profile: { beneficiary: { firstName: "Rosa", lastName: "Diaz" } } } }), { role: "admin" });
  assert.deepEqual([recorded.beneficiaryName, recorded.beneficiaryIdentified], ["Rosa Diaz", true]);
  const wrapped = presentCard(familyCase({ canonicalProfile: { profile: { beneficiary: { fullName: { value: "Luz Perez", source: "questionnaire" } } } } }), { role: "admin" });
  assert.equal(wrapped.beneficiaryName, "Luz Perez");
  assert.equal(presentCard(familyCase({ beneficiaryInvite: { name: "Invited Name" }, canonicalProfile: { profile: { beneficiary: { fullName: "Other" } } } }), { role: "admin" }).beneficiaryName, "Invited Name");
});

test("non-family cards are unchanged by the family fields", () => {
  const card = presentCard({ _id: "s1", caseNumber: "N-2", clientName: "Sam", clientEmail: "s@x.com", visaType: "F-1", integrations: { ghl: { role: "individual", sync: {} } } }, { role: "admin" });
  assert.deepEqual([card.isFamily, card.clientName, card.clientEmail, "beneficiaryName" in card], [false, "Sam", "s@x.com", false]);
});
