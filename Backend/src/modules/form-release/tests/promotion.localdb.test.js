// DB-BACKED tests of the Phase 3 activation protocol, crash reconciliation and rollback, against the LOCAL test database only (src/test-utils/pipelineDb.js refuses anything
// else; with no local MongoDB the tests are skipped). Real USCISFormTemplate model and the real VersionManagementService; only the acceptance store is scripted and the staff
// notification / audit side effects are stubbed. Every document uses a unique ZZ-PIPE-* form code and is deleted afterwards by that code.
const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { useTestDatabase, uniqueFormCode } = require("../../../test-utils/pipelineDb");
const USCISFormTemplate = require("../../../models/USCISFormTemplate");
const VersionManagementService = require("../../uscis-lifecycle/services/VersionManagementService");
const { setDepsForTests, EditionPolicyHeldError } = require("../../form-edition-policy/EditionPolicyEnforcer");

const codes = [];
const raw = (name) => mongoose.connection.collection(name);
test.after(async () => {
  if (!db?.ok || !codes.length) return;
  const ids = (await raw("uscisformtemplates").find({ formCode: { $in: codes } }, { projection: { _id: 1 } }).toArray()).map((item) => item._id);
  await raw("caseforms").deleteMany({ formTemplateId: { $in: ids } });
  await raw("uscismappingversions").deleteMany({ template: { $in: ids } });
  await raw("uscisformtemplates").deleteMany({ formCode: { $in: codes } });
  setDepsForTests(null);
});
const db = useTestDatabase({ before: test.before, after: test.after }, [USCISFormTemplate]);
const newCode = () => { const code = uniqueFormCode(); codes.push(code); return code; };
const day = (iso) => new Date(`${iso}T00:00:00Z`);
const admin = { _id: new mongoose.Types.ObjectId(), role: "admin" };

// the acceptance store: which "<code>|<edition>" USCIS accepts (scripted per test)
let accepted = new Set();
const useAcceptance = (...entries) => {
  accepted = new Set(entries);
  setDepsForTests({
    service: { runAutomaticCheck: async () => ({}), recordOutcome: async () => ({}) },
    store: { findDecision: async (code, edition) => (accepted.has(`${code}|${edition}`) ? { decision: "accepted", status: "verified", reviewBy: new Date(Date.now() + 864e5) } : null) },
    autoEvidence: false,
  });
};
const certified = { validationSummary: { certification: { passed: true, checks: [] } } };
const make = async (formCode, version, editionISO, over = {}) => USCISFormTemplate.create({
  formCode, title: `${formCode} test`, version, editionDate: day(editionISO), status: "review", mappingStatus: "active", approvedAt: new Date(), approvedBy: new mongoose.Types.ObjectId(),
  importMetadata: { editionDateSource: "pdf", ...certified }, lifecycle: {}, activeMappingVersionId: new mongoose.Types.ObjectId(), ...over,
});
const live = async (code) => (await raw("uscisformtemplates").find({ formCode: code, status: "active" }, { projection: { version: 1 } }).toArray()).map((item) => item.version).sort();
const stubSideEffects = (t) => { t.mock.method(VersionManagementService, "notify", async () => []); t.mock.method(VersionManagementService, "audit", async () => undefined); };

test("a promotion brings the new edition live while the old one is still live, then retires the old one and clears its intent", async (t) => {
  if (!db.ok) return t.skip(db.reason);
  stubSideEffects(t);
  const code = newCode();
  useAcceptance(`${code}|2025-01-20`, `${code}|2026-01-20`);
  const old = await make(code, "2025-01-20", "2025-01-20", { status: "active", activeFlag: true });
  const next = await make(code, "2026-01-20", "2026-01-20");

  // the retire step is held back: the moment between "new is live" and "old is retired" must never be a moment without a live edition
  const retire = t.mock.method(VersionManagementService, "retireReplaced", async () => ({ retired: 0, deferred: true }));
  await VersionManagementService.activate(next._id, admin, {});
  assert.deepEqual(await live(code), ["2025-01-20", "2026-01-20"], "both are live at that moment - never zero");
  const intent = (await raw("uscisformtemplates").findOne({ _id: next._id })).lifecycle.promotionIntent;
  assert.equal(String(intent.newId), String(next._id));
  assert.deepEqual(intent.oldIds.map(String), [String(old._id)]);
  retire.mock.restore();

  // the real retire step: the old edition is retired and the intent is gone
  const result = await VersionManagementService.retireReplaced(next, [old._id], admin);
  assert.equal(result.retired, 1);
  assert.deepEqual(await live(code), ["2026-01-20"]);
  assert.equal((await raw("uscisformtemplates").findOne({ _id: next._id })).lifecycle.promotionIntent, undefined);
  const oldNow = await raw("uscisformtemplates").findOne({ _id: old._id });
  assert.deepEqual([oldNow.status, oldNow.currentStatus, oldNow.activeFlag], ["retired", "retired", false]);
});

test("activate refuses an edition that is not approved, not certified, or not accepted - and the live edition is untouched", async (t) => {
  if (!db.ok) return t.skip(db.reason);
  stubSideEffects(t);
  const code = newCode();
  useAcceptance(`${code}|2025-01-20`); // 2026 is NOT accepted
  await make(code, "2025-01-20", "2025-01-20", { status: "active", activeFlag: true });
  const unapproved = await make(code, "2026-01-20", "2026-01-20", { approvedAt: undefined, approvedBy: undefined });
  const uncertified = await make(code, "2026-02-20", "2026-02-20", { importMetadata: { editionDateSource: "pdf" } });
  const failedCritical = await make(code, "2026-03-20", "2026-03-20", { importMetadata: { editionDateSource: "pdf", validationSummary: { certification: { passed: false, checks: [{ name: "party_markers", passed: false }] } } } });
  const notAccepted = await make(code, "2026-04-20", "2026-04-20", { importMetadata: { editionDateSource: "pdf", ...certified } });
  for (const [candidate, pattern] of [[unapproved, /Approve the USCIS form edition/], [uncertified, /not been certified/], [failedCritical, /critical check \(party_markers\)/]]) {
    await assert.rejects(VersionManagementService.activate(candidate._id, admin, {}), (error) => error.status === 409 && pattern.test(error.message));
  }
  await assert.rejects(VersionManagementService.activate(notAccepted._id, admin, {}), (error) => error instanceof EditionPolicyHeldError);
  assert.deepEqual(await live(code), ["2025-01-20"], "nothing changed: the live edition is still the only live one");
});

test("reconcile: an interrupted promotion is finished when the new edition is still accepted, and reverted when it no longer is", async (t) => {
  if (!db.ok) return t.skip(db.reason);
  stubSideEffects(t);
  const interrupted = async (code) => {
    const old = await make(code, "2025-01-20", "2025-01-20", { status: "active", activeFlag: true });
    const next = await make(code, "2026-01-20", "2026-01-20", { status: "active", activeFlag: true, lifecycle: { promotionIntent: { newId: new mongoose.Types.ObjectId(), oldIds: [], step: "retiring_old", at: new Date() } } });
    await raw("uscisformtemplates").updateOne({ _id: next._id }, { $set: { "lifecycle.promotionIntent": { newId: next._id, oldIds: [old._id], step: "retiring_old", at: new Date() } } });
    return { old, next };
  };
  const a = newCode();
  useAcceptance(`${a}|2025-01-20`, `${a}|2026-01-20`);
  await interrupted(a);
  let outcomes = (await VersionManagementService.reconcilePromotions()).filter((item) => item.formCode === a);
  assert.deepEqual(outcomes.map((item) => item.outcome), ["promotion_completed"]);
  assert.deepEqual(await live(a), ["2026-01-20"]);
  assert.equal((await raw("uscisformtemplates").findOne({ formCode: a, version: "2026-01-20" })).lifecycle.promotionIntent, undefined);

  const b = newCode();
  useAcceptance(`${b}|2025-01-20`); // the new edition's acceptance is gone
  await interrupted(b);
  outcomes = (await VersionManagementService.reconcilePromotions()).filter((item) => item.formCode === b);
  assert.deepEqual(outcomes.map((item) => item.outcome), ["new_edition_reverted_not_accepted"]);
  assert.deepEqual(await live(b), ["2025-01-20"], "the edition USCIS accepts stays live; the one it does not accept is retired");
  assert.deepEqual((await VersionManagementService.reconcilePromotions()).filter((item) => item.formCode === b), [], "idempotent: nothing left to reconcile");
});

test("reconcile: with no live edition the previous one is restored only if the gate still accepts it; otherwise none is activated and admins are told", async (t) => {
  if (!db.ok) return t.skip(db.reason);
  const notify = t.mock.method(VersionManagementService, "notify", async () => []);
  t.mock.method(VersionManagementService, "audit", async () => undefined);
  const neither = async (code) => {
    const old = await make(code, "2025-01-20", "2025-01-20", { status: "retired" });
    const next = await make(code, "2026-01-20", "2026-01-20", { status: "review" });
    await raw("uscisformtemplates").updateOne({ _id: next._id }, { $set: { "lifecycle.promotionIntent": { newId: next._id, oldIds: [old._id], step: "retiring_old", at: new Date() } } });
  };
  const a = newCode();
  useAcceptance(`${a}|2025-01-20`);
  await neither(a);
  assert.deepEqual((await VersionManagementService.reconcilePromotions()).filter((item) => item.formCode === a).map((item) => item.outcome), ["previous_edition_restored"]);
  assert.deepEqual(await live(a), ["2025-01-20"]);

  const b = newCode();
  useAcceptance(); // nothing is accepted any more
  await neither(b);
  assert.deepEqual((await VersionManagementService.reconcilePromotions()).filter((item) => item.formCode === b).map((item) => item.outcome), ["no_policy_approved_edition_available"]);
  assert.deepEqual(await live(b), [], "an edition USCIS does not accept is never activated just to have one live");
  assert.ok(notify.mock.calls.some((call) => /No accepted/.test(call.arguments[1].title)), "admins are alerted");
});

test("rollback: restores the earlier certified edition through the same gates, lists the case forms to reconcile, and never moves a case", async (t) => {
  if (!db.ok) return t.skip(db.reason);
  stubSideEffects(t);
  const code = newCode();
  useAcceptance(`${code}|2025-01-20`, `${code}|2026-01-20`);
  const earlier = await make(code, "2025-01-20", "2025-01-20", { status: "retired", activeFlag: false });
  const current = await make(code, "2026-01-20", "2026-01-20", { status: "active", activeFlag: true });
  await raw("uscismappingversions").insertOne({ _id: earlier.activeMappingVersionId, template: earlier._id, status: "active" });
  const caseForm = { _id: new mongoose.Types.ObjectId(), caseId: new mongoose.Types.ObjectId(), formCode: code, formTemplateId: current._id, status: "ai_filled" };
  await raw("caseforms").insertOne(caseForm);

  const result = await VersionManagementService.rollback(code, { reason: "the new edition filled the wrong box" }, admin, {});
  assert.deepEqual(await live(code), ["2025-01-20"]);
  assert.equal(result.rollback.restored.version, "2025-01-20");
  assert.equal(result.rollback.replaced.version, "2026-01-20");
  assert.deepEqual(result.rollback.caseFormsToReconcile.map((item) => item.caseFormId), [String(caseForm._id)]);
  assert.equal(String((await raw("caseforms").findOne({ _id: caseForm._id })).formTemplateId), String(current._id), "the case form was NOT moved back");
});

test("rollback refuses: an edition that is already live, one with no stored mapping, one USCIS does not accept, or nothing certified to go back to", async (t) => {
  if (!db.ok) return t.skip(db.reason);
  stubSideEffects(t);
  const code = newCode();
  useAcceptance(`${code}|2026-01-20`); // the earlier edition is NOT accepted
  const earlier = await make(code, "2025-01-20", "2025-01-20", { status: "retired" });
  const current = await make(code, "2026-01-20", "2026-01-20", { status: "active", activeFlag: true });
  await assert.rejects(VersionManagementService.rollback(code, { toTemplateId: current._id }, admin, {}), (error) => error.status === 409, "not a retired edition");
  await assert.rejects(VersionManagementService.rollback(code, {}, admin, {}), /mapping version is no longer stored/);
  await raw("uscismappingversions").insertOne({ _id: earlier.activeMappingVersionId, template: earlier._id, status: "active" });
  await assert.rejects(VersionManagementService.rollback(code, {}, admin, {}), (error) => error instanceof EditionPolicyHeldError);
  assert.deepEqual(await live(code), ["2026-01-20"], "every refusal left the live edition alone");
  const lone = newCode();
  await make(lone, "2026-01-20", "2026-01-20", { status: "active" });
  await assert.rejects(VersionManagementService.rollback(lone, {}, admin, {}), /no earlier certified edition/);
});
