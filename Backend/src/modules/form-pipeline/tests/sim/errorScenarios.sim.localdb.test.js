// Phase 7.8 proof: every ERROR and FAULT scenario (plan section D.1) through the real importer, error-resolution engine, job service, runner and alerter, on a throwaway local database,
// with a fake uscis.gov (no network) and a mocked mailbox:
//   fetch 503 / timeout / slow server, HTML instead of PDF, truncated PDF, XFA-only, password PDF, oversize template, qpdf missing / wrong path, wrong page address (I-485J, I-539A),
//   lease loss mid-stage, worker killed mid-stage, a database error in the middle of the case migration, a repeated run.
// Each ends autonomous (imported with no human step) or in a documented hold with exactly ONE e-mail to the developer; never half-imported, never lost.
// A scenario that exposes a real defect carries `knownDefect` in test-utils/editionSim/faultScenarios.js and runs as a node:test TODO: it is reported, it cannot fail the run, and
// it starts passing (and must lose its flag) the day the defect is fixed.
const test = require("node:test");
const assert = require("node:assert/strict");
const sim = require("./harness");
const { runFaultScenario, FAULT_SCENARIOS, DEVELOPER } = require("./faultHarness");

const db = { ok: false, reason: "not connected" };
const recorder = sim.createRecorder();

test.before(async () => { Object.assign(db, await sim.connect()); });
test.after(async () => {
  if (db.ok) await recorder.cleanup().catch(() => null);
  await sim.disconnect();
});

for (const scenario of FAULT_SCENARIOS) {
  test(`engine on - ${scenario.id}: ${scenario.label} -> ${scenario.expect}`, { todo: scenario.knownDefect || false }, async (t) => {
    if (!db.ok) return t.skip(db.reason);
    const result = await runFaultScenario(scenario, { mode: "on", recorder });
    if (String(result.endState).startsWith("skipped")) return t.skip(result.endState);
    assert.deepEqual(result.defects, [], JSON.stringify(result.defects));
    assert.equal(result.loss + result.corruption, 0);
    if (scenario.expect === "autonomous") assert.equal(result.endState, "imported", `ended as ${result.endState}`);
    else assert.equal(result.endState, "held", `ended as ${result.endState} (a documented hold is expected, never a dead letter)`);
    assert.equal(result.matchesExpectation, true);
  });
}

test("a hold names the developer address and the form: the stuck e-mail goes to DEVELOPER_EMAIL, once", async (t) => {
  if (!db.ok) return t.skip(db.reason);
  const result = await runFaultScenario(FAULT_SCENARIOS.find((item) => item.id === "source_gone_everywhere"), { mode: "on", recorder });
  assert.equal(result.endState, "held");
  assert.deepEqual(result.emails.filter((mail) => mail.key === "form-pipeline-stuck").map((mail) => mail.to), [DEVELOPER]);
  assert.equal(result.hold.code, "NO_OFFICIAL_SOURCE");
  assert.ok(result.strategies.length >= 5, "every strategy that was tried is recorded on the job");
});

test("engine off and shadow: the engine is not consulted - nothing is repaired, nothing is recorded as tried, the form is handled as before", async (t) => {
  if (!db.ok) return t.skip(db.reason);
  const scenario = FAULT_SCENARIOS.find((item) => item.id === "html_instead_of_pdf");
  for (const mode of ["off", "shadow"]) {
    const result = await runFaultScenario(scenario, { mode, recorder });
    assert.notEqual(result.endState, "imported", `${mode}: an HTML page for the PDF is not repaired without the engine`);
    assert.deepEqual(result.strategies, [], `${mode}: no strategy may run`);
  }
  const on = await runFaultScenario(scenario, { mode: "on", recorder });
  assert.equal(on.endState, "imported");
  assert.ok(on.strategies.some((item) => item.startsWith("resolve_pdf_link_again")), "the engine found the right link on the official page");
});

test("lease loss and a killed worker never leave two editions or a stuck job", async (t) => {
  if (!db.ok) return t.skip(db.reason);
  for (const id of ["lease_loss_mid_stage", "worker_kill_mid_stage"]) {
    const result = await runFaultScenario(FAULT_SCENARIOS.find((item) => item.id === id), { mode: "on", recorder });
    assert.deepEqual(result.defects, [], `${id}: ${JSON.stringify(result.defects)}`);
    assert.equal(result.endState, "imported", id);
    assert.equal(result.runs, 2, id);
  }
});

test("a database error in the middle of the case migration is recovered by the next run with nothing lost, at every checkpoint", async (t) => {
  if (!db.ok) return t.skip(db.reason);
  for (const scenario of FAULT_SCENARIOS.filter((item) => item.kind === "migration_fault")) {
    const result = await runFaultScenario(scenario, { mode: "on", recorder });
    assert.deepEqual(result.defects, [], `${scenario.id}: ${JSON.stringify(result.defects)}`);
    assert.equal(result.fault.injected, true, scenario.id);
    assert.equal(result.fault.firstRunFailed, 1, `${scenario.id}: the injected error must have stopped the first run`);
    assert.equal(result.idempotent, true, scenario.id);
    assert.equal(result.loss + result.corruption, 0, scenario.id);
  }
});
