// Phase 3 ReleaseGate + CERT_CHECK_POLICY. DB-free: the policy and the edition diff are injected, so the whole decision matrix runs without a database.
const test = require("node:test");
const assert = require("node:assert/strict");
const { evaluate, decide } = require("../ReleaseGate");
const { CERT_CHECK_POLICY, CRITICAL_CERTIFICATION_CHECKS, classify, certificationDecision } = require("../certPolicy");

const passed = { validationSummary: { certification: { passed: true, checks: [] } } };
const failing = (...names) => ({ validationSummary: { certification: { passed: false, checks: names.map((name) => ({ name, passed: false })) } } });
const edition = (over = {}) => ({ formCode: "I-131", version: "2025-01-20", approvedAt: new Date(), approvedBy: "u1", mappingStatus: "active", importMetadata: passed, ...over });
const allow = async () => ({ allowed: true, decision: "accepted", reasons: [] });
const ok = async () => ({ blocked: false });
const gate = (template, deps = {}, req = {}) => evaluate(template, { req, deps: { policy: allow, editionDiff: ok, ...deps } });

test("the policy: five critical checks, two overridable, and an unknown name is critical (fail closed)", () => {
  assert.deepEqual(Object.keys(CERT_CHECK_POLICY).filter((name) => CERT_CHECK_POLICY[name] === "non_critical"), ["viewer_download", "components_slice"]);
  assert.equal(CRITICAL_CERTIFICATION_CHECKS.length, 5);
  assert.equal(classify("something_new"), "critical");
});

test("everything passes -> promote", async () => {
  const result = await gate(edition());
  assert.equal(result.decision, "promote");
  assert.equal(result.canPromote, true);
  assert.equal(result.error, undefined);
});

test("only non-critical checks failed: refused without a reason, restricted_degraded with a written one (returned for the audit)", async () => {
  const template = edition({ importMetadata: failing("viewer_download", "components_slice") });
  const refused = await gate(template);
  assert.equal(refused.decision, "blocked");
  assert.match(refused.error, /overrideReason/);
  const allowed = await gate(template, {}, { body: { overrideReason: "Components were verified by hand today" } });
  assert.equal(allowed.decision, "restricted_degraded");
  assert.equal(allowed.canPromote, true);
  assert.deepEqual(allowed.override.failed, ["viewer_download", "components_slice"]);
});

test("a failed critical check is blocked and can never be overridden - including the two Phase 3 checks", async () => {
  for (const name of ["pdf_fillable", "mapping_valid", "fill_roundtrip", "party_markers", "widget_inputs"]) {
    const result = await gate(edition({ importMetadata: failing(name, "viewer_download") }), {}, { body: { overrideReason: "the business needs this form right now" } });
    assert.equal(result.decision, "blocked", name);
    assert.equal(result.canPromote, false);
  }
});

test("the preconditions are checked first and keep their own messages", async () => {
  assert.match((await gate(edition({ approvedAt: null }))).error, /Approve the USCIS form edition/);
  assert.match((await gate(edition({ mappingStatus: "needs_review" }))).error, /Activate and validate the form mapping/);
  assert.match((await gate(edition({ officialStatus: "deprecated" }))).error, /deprecated/);
  assert.match((await gate(edition({ importMetadata: {} }))).error, /not been certified/);
});

test("USCIS acceptance missing -> held; explicitly not accepted -> blocked; a throwing policy -> held (fail closed)", async () => {
  assert.equal((await gate(edition(), { policy: async () => ({ allowed: false, decision: "held", reasons: ["no_policy"] }) })).decision, "held");
  assert.equal((await gate(edition(), { policy: async () => ({ allowed: false, decision: "not_accepted", reasons: ["not_accepted"] }) })).decision, "blocked");
  const thrown = await gate(edition(), { policy: async () => { throw new Error("database down"); } });
  assert.equal(thrown.decision, "held");
  assert.match(thrown.error, /database down/);
});

test("an unacknowledged material edition change -> approval_required (the diff is attached); an unreadable diff fails closed the same way", async () => {
  const diff = await gate(edition({ parentVersion: "p1" }), { editionDiff: async () => ({ blocked: true, summary: { removed: 2 } }) });
  assert.equal(diff.decision, "approval_required");
  assert.deepEqual(diff.checks.find((check) => check.name === "edition_diff").diff, { removed: 2 });
  const unreadable = await gate(edition({ parentVersion: "p1" }), { editionDiff: async () => { throw new Error("no parent"); } });
  assert.equal(unreadable.decision, "approval_required");
});

test("when several checks fail the most severe decision wins: blocked > held > approval_required > restricted_degraded > promote", () => {
  const c = (outcome) => ({ name: outcome, outcome });
  assert.equal(decide([c("pass"), c("degraded"), c("approval_required"), c("held"), c("blocked")]), "blocked");
  assert.equal(decide([c("pass"), c("degraded"), c("approval_required"), c("held")]), "held");
  assert.equal(decide([c("pass"), c("degraded"), c("approval_required")]), "approval_required");
  assert.equal(decide([c("pass"), c("degraded")]), "restricted_degraded");
  assert.equal(decide([c("pass")]), "promote");
});

test("the old certificationDecision shapes are unchanged", () => {
  assert.deepEqual(certificationDecision({ importMetadata: passed }, {}), { ok: true });
});
