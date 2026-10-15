// Imported GHL cards: only a card in "Case Onboarded" is a NEW case (it gets the client email); a card in "Submitted (FedEx)" is imported as completed.
const test = require("node:test");
const assert = require("node:assert/strict");
const Case = require("../../../models/Case");
const factory = require("../ghlCaseFactory");

test("only the Case Onboarded stage counts as a new case", () => {
  assert.equal(factory.isNewCaseStage({ unifiedStageKey: "case_onboarded" }), true);
  for (const key of ["docs_checklist", "docs_received", "draft_ready", "client_review", "submitted_fedex", "receipt_tracking", "status_approved"]) {
    assert.equal(factory.isNewCaseStage({ unifiedStageKey: key }), false, key);
  }
  assert.equal(factory.isNewCaseStage(null), false);
});

test("Submitted (FedEx) is the completed stage; Case Onboarded and unknown stages are not", () => {
  assert.equal(factory.isCompletedStage({ unifiedStageKey: "submitted_fedex" }), true);
  assert.equal(factory.isCompletedStage({ unifiedStageKey: "case_onboarded" }), false);
  assert.equal(factory.isCompletedStage(undefined), false);
});

test("marking an imported case completed sets the status once and records why, leaving other fields alone", async () => {
  const original = Case.updateOne;
  const calls = [];
  Case.updateOne = async (filter, update) => { calls.push({ filter, update }); return { modifiedCount: 1 }; };
  try {
    await factory.markImportedCaseCompleted({ _id: "c1", status: "pending_assignment" });
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].filter, { _id: "c1", status: { $ne: "completed" } });
    assert.deepEqual(Object.keys(calls[0].update.$set), ["status"]);
    assert.equal(calls[0].update.$set.status, "completed");
    assert.equal(calls[0].update.$push.timeline.metadata.previousStatus, "pending_assignment");
    await factory.markImportedCaseCompleted(null); // nothing to do, never throws
    assert.equal(calls.length, 1);
  } finally {
    Case.updateOne = original;
  }
});

// ---- the card's Primary Email (its GHL contact's email) fills an empty clientEmail on an already imported case ----
test("a case imported without an email takes the card's email later, but never overwrites or touches the wrong kind of case", async () => {
  const { fillMissingClientEmail } = require("../ghlReconcileService");
  const original = Case.updateOne;
  const calls = [];
  Case.updateOne = async (filter, update) => { calls.push({ filter, update }); return { modifiedCount: 1 }; };
  const card = (email) => ({ contact: { email } });
  try {
    await fillMissingClientEmail({ _id: "c1", clientEmail: "", integrations: { ghl: {} } }, card("  Client@Example.COM "));
    assert.equal(calls.length, 1);
    assert.equal(calls[0].update.$set.clientEmail, "client@example.com");
    for (const [existing, email] of [
      [{ _id: "c2", clientEmail: "kept@example.com" }, "new@example.com"],        // already has one
      [{ _id: "c3", clientEmail: "", user: "u1" }, "new@example.com"],             // has a login
      [{ _id: "c4", clientEmail: "", caseRole: "employee" }, "new@example.com"],   // the contact is the employer
      [{ _id: "c5", clientEmail: "", integrations: { ghl: { role: "family" } } }, "new@example.com"],
      [{ _id: "c6", clientEmail: "" }, ""],                                        // GHL has none
      [{ _id: "c7", clientEmail: "" }, "not-an-email"],
    ]) await fillMissingClientEmail(existing, card(email));
    assert.equal(calls.length, 1, "no other case was touched");
  } finally {
    Case.updateOne = original;
  }
});

// ---- an individual imported case is named like its GHL card ----
test("an individual case takes its GHL card's name; employee, family and unchanged cases are left alone", async () => {
  const original = Case.updateOne;
  const calls = [];
  Case.updateOne = async (filter, update) => { calls.push({ filter, update }); return { modifiedCount: 1 }; };
  const individual = (extra = {}) => ({ _id: "c1", clientName: "Harjit Singh", caseRole: "single", integrations: { ghl: { role: "individual" } }, ...extra });
  try {
    assert.equal(await factory.syncCardName(individual(), { name: " Sushil Juneja_L1A " }), true);
    assert.equal(calls[0].update.$set.clientName, "Sushil Juneja_L1A");
    for (const [existing, opportunity] of [
      [individual({ clientName: "Same Name" }), { name: "Same Name" }],                                              // already the same
      [individual(), { name: "" }],                                                                                  // GHL gave no name
      [individual({ caseRole: "employee" }), { name: "Employer, Employee" }],                                       // employee card: named for the employee
      [individual({ integrations: { ghl: { role: "family" } } }), { name: "Petitioner" }],                          // family: contact is the petitioner
      [individual({ integrations: { ghl: { role: "employee" } } }), { name: "Employer, Employee" }],
      [{ _id: "c9", clientName: "Local only" }, { name: "Whatever" }],                                              // not a GHL case
    ]) assert.equal(await factory.syncCardName(existing, opportunity), false);
    assert.equal(calls.length, 1, "nothing else was written");
  } finally {
    Case.updateOne = original;
  }
});
