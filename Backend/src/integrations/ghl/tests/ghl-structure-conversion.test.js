const test = require("node:test");
const assert = require("node:assert/strict");
const { selectVisa } = require("../ghlVisaSelection.service");

// A plain object with just enough of a Mongoose document for the pure (no database) paths.
const pendingCase = (extra = {}) => ({
  _id: "c1",
  creationSource: "ghl",
  visaSelectionStatus: "pending",
  user: "u1",
  clientName: "Jane Client",
  clientEmail: "jane@example.com",
  caseStructure: "single",
  caseRole: "single",
  timeline: [],
  integrations: { ghl: {} },
  set(path, value) { this[`__${path}`] = value; },
  ...extra,
});

test("selectVisa is a no-op for a case that is not a pending GHL card", async () => {
  assert.equal(await selectVisa({ creationSource: "admin_direct", visaSelectionStatus: "pending" }, "F-1"), null);
  assert.equal(await selectVisa(pendingCase(), ""), null);
});

test("an unknown visa is refused", async () => {
  await assert.rejects(() => selectVisa(pendingCase(), "NOT-A-VISA"), { code: "UNKNOWN_VISA_TYPE" });
});

test("a family visa reshapes the card: the GHL contact becomes the petitioner, beneficiary not identified", async () => {
  const doc = pendingCase();
  const result = await selectVisa(doc, "IR-1");
  assert.equal(result.structure, "family");
  assert.equal(typeof result.afterSave, "function");
  assert.equal(doc.visaSelectionStatus, "selected");
  assert.equal(doc.petitionerUser, "u1");
  assert.equal(doc.petitionerName, "Jane Client");
  assert.equal(doc.visaCategory, "Family");
  assert.equal(doc.clientEmail, "");
  assert.equal(doc.user, undefined);
  assert.equal(doc.caseStructure, null);
  assert.equal(doc.familyWorkflow.caseManagerStatus, "waiting_for_petitioner");
});

test("a family visa on a card with no client account is refused cleanly, nothing changed", async () => {
  const doc = pendingCase({ user: undefined });
  await assert.rejects(() => selectVisa(doc, "IR-1"), { code: "GHL_FAMILY_NEEDS_PETITIONER" });
  assert.equal(doc.visaSelectionStatus, "pending");
});

test("an employer visa on a card with no email is refused cleanly", async () => {
  const doc = pendingCase({ clientEmail: "" });
  await assert.rejects(() => selectVisa(doc, "H-1B"), { code: "GHL_EMPLOYER_NEEDS_EMAIL" });
  assert.equal(doc.visaSelectionStatus, "pending");
});
