// Phase 7.8 proof: every EDITION scenario (unchanged, renamed boxes, part shift, inserted page, inserted supplement, removed box, changed radio choices, changed box type, new box with no source)
// run through the real pipeline code with the engine ON, on a throwaway local database (no shared database, no case, no real e-mail, no network): the real field scanner, mapping
// carry-forward with partial activation, certification, release gate, case migration, PDF renderer and the Admin edit adapter.
// What each scenario must end in is written in test-utils/editionSim/scenarios.js (expectOutcome); the product rules asserted for EVERY scenario:
//   loss 0, corruption 0, no character limit, read-only-by-USCIS boxes keep and show their value, ticks reach the PDF, frozen (filed) case forms never move, a second run changes nothing.
const test = require("node:test");
const assert = require("node:assert/strict");
const sim = require("./harness");
const { EDITION_SCENARIOS } = require("../../../../test-utils/editionSim/scenarios");
const { summarize } = require("../../../../scripts/runEditionSimulation");

const db = { ok: false, reason: "not connected" };
const recorder = sim.createRecorder();
const results = [];

test.before(async () => { Object.assign(db, await sim.connect()); });
test.after(async () => {
  if (db.ok) await recorder.cleanup().catch(() => null);
  await sim.disconnect();
});

const failedPdfChecks = (metrics) => Object.entries(metrics.pdf || {}).filter(([, value]) => String(value).startsWith("FAIL")).map(([name, value]) => `${name}: ${value}`);

for (const scenario of EDITION_SCENARIOS) {
  test(`engine on - ${scenario.id} (${scenario.label}) -> ${scenario.expectOutcome}`, async (t) => {
    if (!db.ok) return t.skip(db.reason);
    const metrics = await sim.runEditionScenario(scenario, { mode: "on", recorder });
    results.push(metrics);
    assert.deepEqual(metrics.defects, [], JSON.stringify(metrics.defects));
    assert.equal(metrics.loss, 0, "no client answer may be lost");
    assert.equal(metrics.corruption, 0, "no client answer may land in the wrong box");
    assert.deepEqual(failedPdfChecks(metrics), [], "the PDF must show every answer: long text without a limit, the read-only box, the tick, the dropdown, the radio");
    assert.equal(metrics.outcome, scenario.expectOutcome, `ended as ${metrics.endState}`);
    if (metrics.idempotent !== undefined) assert.equal(metrics.idempotent, true, "a second run must change nothing");
    if (metrics.outcome === "held") return; // not released: nothing was shown, the live edition is untouched (checked as a defect above)
    for (const key of ["long_text_country", "long_text_notes", "read_only_box", "mapped_box"]) assert.equal(metrics.pdf[key], "ok", `${key} must be checked and pass`);
  });
}

test("a box with no source is left blank and the edition is still released (owner decision 2026-10-23)", async (t) => {
  if (!db.ok) return t.skip(db.reason);
  const scenario = EDITION_SCENARIOS.find((item) => item.id === "box_added_no_source");
  const metrics = results.find((item) => item.id === scenario.id) || await sim.runEditionScenario(scenario, { mode: "on", recorder });
  assert.equal(metrics.outcome, "autonomous");
  assert.equal(metrics.mapping.partial || metrics.mapping.activated, true);
  assert.equal(metrics.corruption, 0);
});

test("engine off and shadow: never worse than before - nothing lost or corrupted, no unexplained error (the case forms simply wait for a person)", async (t) => {
  if (!db.ok) return t.skip(db.reason);
  const scenario = EDITION_SCENARIOS.find((item) => item.id === "renamed_boxes");
  for (const mode of ["off", "shadow"]) {
    const metrics = await sim.runEditionScenario(scenario, { mode, recorder });
    assert.deepEqual(metrics.defects, [], `${mode}: ${JSON.stringify(metrics.defects)}`);
    assert.equal(metrics.loss + metrics.corruption, 0, mode);
    assert.notEqual(metrics.outcome, "error", mode);
    assert.equal(metrics.autonomous, false, `${mode}: the engine is not applied, so nothing becomes autonomous`);
  }
});

test("the autonomy rate is computed honestly from the scenarios that ran", async (t) => {
  if (!db.ok) return t.skip(db.reason);
  if (results.length !== EDITION_SCENARIOS.length) return t.skip("not every scenario ran (filtered run)");
  const summary = summarize(results);
  const expectedAutonomous = EDITION_SCENARIOS.filter((item) => item.expectOutcome === "autonomous").length;
  assert.equal(summary.total, EDITION_SCENARIOS.length);
  assert.equal(summary.autonomous, expectedAutonomous);
  assert.equal(summary.autonomyRate, Number((expectedAutonomous / EDITION_SCENARIOS.length).toFixed(3)));
  assert.equal(summary.loss + summary.corruption, 0);
  assert.equal(summary.unexpected, 0);
});
