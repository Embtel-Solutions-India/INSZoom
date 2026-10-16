// Release 0b-2: the fail-closed enforcer every activation / migration path calls. In-memory store, no database.
const test = require("node:test");
const assert = require("node:assert/strict");
const { requireAcceptedEdition, EditionPolicyHeldError, editionOf, setDepsForTests } = require("../EditionPolicyEnforcer");
const H = require("./helpers");

const day = (iso) => new Date(`${iso}T00:00:00Z`);
const tpl = (over = {}) => ({ formCode: "I-131", editionDate: day("2025-01-20"), importMetadata: { editionDateSource: "uscis_page" }, ...over });
const accepted = (over = {}) => ({ formCode: "I-131", editionIdentifier: "2025-01-20", decision: "accepted", status: "verified", reviewBy: new Date(Date.now() + 86400000 * 60), holdReason: "", version: 1, evidenceRefs: [], ...over });
test.afterEach(() => setDepsForTests(null));

const held = async (template, reasons, deps) => {
  setDepsForTests(deps);
  const error = await requireAcceptedEdition(template, { entryPoint: "test" }).then(() => null, (caught) => caught);
  assert.ok(error instanceof EditionPolicyHeldError, "must be held");
  assert.deepEqual([error.status, error.code, error.name], [409, "EDITION_POLICY_HELD", "EditionPolicyHeldError"]);
  if (reasons) assert.deepEqual(error.details.reasons, reasons);
  return error;
};

test("no decision on record: held (a missing record never authorizes anything), with a message that explains why", async () => {
  const store = H.memoryStore();
  const error = await held(tpl(), ["no_policy"], { store, service: null, autoEvidence: false });
  assert.match(error.message, /USCIS has not confirmed that I-131 edition 2025-01-20 is accepted for filing, so it was not activated/);
  assert.match(error.message, /Nothing was changed/);
  assert.deepEqual([error.details.formCode, error.details.editionIdentifier, error.details.entryPoint], ["I-131", "2025-01-20", "test"]);
});

test("a missing or untrusted edition date is held without even consulting the store (never `version`, never version_backfill)", async () => {
  let consulted = false;
  const store = { findDecision: async () => { consulted = true; return accepted(); } };
  await held(tpl({ editionDate: null }), ["invalid_edition_identifier"], { store, service: null });
  await held(tpl({ editionDate: undefined, version: "2025-01-20" }), ["invalid_edition_identifier"], { store, service: null });
  await held(tpl({ importMetadata: { editionDateSource: "version_backfill" } }), ["edition_date_untrusted"], { store, service: null });
  await held({}, null, { store, service: null });
  await held(null, null, { store, service: null });
  assert.equal(consulted, false);
  assert.deepEqual(editionOf(tpl()), { formCode: "I-131", editionIdentifier: "2025-01-20", why: null });
});

test("an accepted, verified, in-date decision is the only thing that lets an edition through", async () => {
  const store = H.memoryStore();
  store.decisions.set("I-131|2025-01-20", accepted());
  setDepsForTests({ store, service: null, autoEvidence: false });
  const result = await requireAcceptedEdition(tpl(), { entryPoint: "test" });
  assert.deepEqual([result.allowed, result.decision, result.reasons], [true, "accepted", []]);
});

test("not_accepted, held, stale, unverified and conflicting decisions are all refused (not_accepted is reported as blocked)", async () => {
  for (const [row, reason] of [
    [accepted({ decision: "not_accepted" }), "not_accepted_by_uscis"], [accepted({ decision: "held", holdReason: "waiting" }), "held"], [accepted({ status: "stale" }), "decision_past_review_date"],
    [accepted({ status: "unverified" }), "decision_not_verified"], [accepted({ status: "conflicting" }), "decision_conflicting"], [accepted({ reviewBy: new Date(Date.now() - 1000) }), "decision_past_review_date"],
  ]) {
    const store = H.memoryStore();
    store.decisions.set("I-131|2025-01-20", row);
    const error = await held(tpl(), null, { store, service: null });
    assert.ok(error.details.reasons.includes(reason), `${row.decision}/${row.status} -> ${reason}`);
  }
});

test("FAIL CLOSED: a store or gate that throws is a hold (gate_error), never an allow; the error never escapes as a raw error", async () => {
  const store = { findDecision: async () => { throw new Error("database down"); } };
  const error = await held(tpl(), ["gate_error"], { store, service: null });
  assert.equal(error.message.includes("database down"), false, "internal details are not leaked");
  setDepsForTests({ get store() { throw new Error("deps exploded"); } });
  await assert.rejects(requireAcceptedEdition(tpl(), { entryPoint: "test" }), (caught) => caught instanceof EditionPolicyHeldError && caught.details.reasons[0] === "gate_error");
});

test("automatic evidence OFF: the automatic check is never run, so the pipeline writes nothing by itself", async () => {
  let ran = 0;
  const store = H.memoryStore();
  await held(tpl(), ["no_policy"], { store, service: { runAutomaticCheck: async () => { ran += 1; } }, autoEvidence: false });
  assert.equal(ran, 0);
});

test("automatic evidence ON: the system checks first and the persisted decision then decides", async () => {
  const store = H.memoryStore();
  const calls = [];
  const service = { runAutomaticCheck: async (formCode, edition, options) => { calls.push([formCode, edition, options.trigger]); store.decisions.set(`${formCode}|${edition}`, accepted()); }, recordOutcome: async () => null };
  setDepsForTests({ store, service, autoEvidence: true });
  const result = await requireAcceptedEdition(tpl(), { entryPoint: "VersionManagementService.activate" });
  assert.equal(result.allowed, true);
  assert.deepEqual(calls, [["I-131", "2025-01-20", "VersionManagementService.activate"]]);
});

test("automatic evidence ON but failing or finding nothing: still held (a failed check can only ADD a decision, never allow)", async () => {
  const store = H.memoryStore();
  await held(tpl(), ["no_policy"], { store, service: { runAutomaticCheck: async () => { throw new Error("uscis.gov unreachable"); } }, autoEvidence: true });
  await held(tpl(), ["no_policy"], { store, service: { runAutomaticCheck: async () => ({ outcome: "no_explicit_statement" }) }, autoEvidence: true });
});

test("the outcome is recorded for the audit trail (held / blocked / gate_allowed) and a failing audit never changes the answer", async () => {
  const store = H.memoryStore();
  const outcomes = [];
  const service = { recordOutcome: async (entry) => { outcomes.push([entry.outcome, entry.entryPoint, entry.reasons]); } };
  await held(tpl(), null, { store, service, autoEvidence: false });
  store.decisions.set("I-131|2025-01-20", accepted({ decision: "not_accepted" }));
  await held(tpl(), null, { store, service, autoEvidence: false });
  store.decisions.set("I-131|2025-01-20", accepted());
  setDepsForTests({ store, service, autoEvidence: false });
  await requireAcceptedEdition(tpl(), { entryPoint: "migrateCaseFormsToEdition" });
  assert.deepEqual(outcomes.map((item) => item[0]), ["held", "blocked", "gate_allowed"]);
  assert.equal(outcomes[2][1], "migrateCaseFormsToEdition");
});
