#!/usr/bin/env node
// Phase 7.8: runs the EDITION SIMULATION once and reports honest numbers. Everything happens on a THROWAWAY local database (dropped at the end), a temp storage folder, a fake uscis.gov
// (no request leaves the machine) and a mocked mailbox. Nothing touches the shared database, S3, a real mailbox or Gemini.
//
//   node src/scripts/runEditionSimulation.js [--modes on,shadow,off] [--only id,id] [--no-editions] [--no-faults] [--json] [--out report.json] [--strict]
//
// Autonomy rate = the share of scenarios that end released / imported with no human step. A scenario that correctly HOLDS (nothing safe to do automatically; the live edition untouched;
// the developer told once) counts as "held", not autonomous. Loss = a client answer that is nowhere on the case form afterwards; corruption = an answer in the wrong box.
// Exit code: 0 when every scenario ended as the pipeline honestly should today (known defects are listed, not hidden); 1 when something unexpected happened or --strict and a known defect exists.
const harness = require("../modules/form-pipeline/tests/sim/harness"); // sets the safe environment BEFORE anything else is loaded
const { runFaultScenario, FAULT_SCENARIOS } = require("../modules/form-pipeline/tests/sim/faultHarness");
const { EDITION_SCENARIOS } = require("../test-utils/editionSim/scenarios");

const argValue = (argv, name) => { const at = argv.indexOf(name); return at >= 0 ? argv[at + 1] : null; };

/** Pure. The summary of a list of scenario results. */
function summarize(results) {
  const mode = (item) => item.mode || "on";
  const total = results.length;
  const count = (predicate) => results.filter(predicate).length;
  const autonomous = count((item) => item.autonomous);
  const held = count((item) => item.outcome === "held" || item.held || String(item.endState).startsWith("held"));
  const parked = count((item) => item.outcome === "parked");
  const skipped = count((item) => String(item.endState).startsWith("skipped"));
  const errors = count((item) => String(item.endState).startsWith("error") || (item.defects || []).some((defect) => !item.knownDefect && defect.step === "run"));
  const loss = results.reduce((sum, item) => sum + (item.loss || 0), 0);
  const corruption = results.reduce((sum, item) => sum + (item.corruption || 0), 0);
  return {
    modes: [...new Set(results.map(mode))], total, autonomous, held, parked, skipped, errors,
    autonomyRate: total ? Number((autonomous / ((total - skipped) || 1)).toFixed(3)) : 0,
    matchedExpectation: count((item) => item.matchesExpectation === true), unexpected: count((item) => item.matchesExpectation === false && !item.knownDefect),
    knownDefects: results.filter((item) => item.knownDefect && item.matchesExpectation === false).map((item) => ({ id: item.id, why: item.knownDefect })),
    loss, corruption,
  };
}

const line = (item) => `${String(item.id).padEnd(38)} ${String(item.mode || "on").padEnd(7)} ${String(item.endState || "").slice(0, 34).padEnd(35)} ${String(item.outcome || (item.autonomous ? "autonomous" : item.held ? "held" : "-")).padEnd(11)} ${item.matchesExpectation === true ? "as expected" : item.matchesExpectation === null || item.matchesExpectation === undefined ? "-" : item.knownDefect ? "KNOWN DEFECT" : "UNEXPECTED"}`;

async function main(argv = process.argv.slice(2)) {
  const modes = (argValue(argv, "--modes") || "on").split(",").map((item) => item.trim()).filter(Boolean);
  const only = (argValue(argv, "--only") || "").split(",").filter(Boolean);
  const wanted = (scenario) => !only.length || only.includes(scenario.id);
  const db = await harness.connect();
  if (!db.ok) { console.error(`simulation not run: ${db.reason}`); return 2; }
  const recorder = harness.createRecorder();
  const results = [];
  try {
    for (const mode of modes) {
      if (!argv.includes("--no-editions")) for (const scenario of EDITION_SCENARIOS.filter(wanted)) results.push({ ...(await harness.runEditionScenario(scenario, { mode, recorder })), group: "edition" });
      if (!argv.includes("--no-faults")) for (const scenario of FAULT_SCENARIOS.filter(wanted)) results.push({ ...(await runFaultScenario(scenario, { mode, recorder })), group: "fault" });
    }
  } finally {
    await recorder.cleanup().catch(() => null);
    await harness.disconnect();
  }
  const perMode = Object.fromEntries(modes.map((mode) => [mode, summarize(results.filter((item) => item.mode === mode))]));
  const report = { generatedAt: new Date().toISOString(), modes, summary: perMode, results: results.map(({ pdf, steps, ...rest }) => rest) };
  if (argValue(argv, "--out")) require("fs").writeFileSync(argValue(argv, "--out"), JSON.stringify(report, null, 2));
  if (argv.includes("--json")) console.log(JSON.stringify(report, null, 2));
  else {
    console.log(results.map(line).join("\n"));
    for (const mode of modes) {
      const s = perMode[mode];
      console.log(`\n[${mode}] ${s.total} scenarios: ${s.autonomous} autonomous (rate ${(s.autonomyRate * 100).toFixed(0)}%), ${s.held} correctly held, ${s.parked} released with a case form parked, ${s.skipped} skipped, ${s.errors} errors; answers lost ${s.loss}, corrupted ${s.corruption}; unexpected ${s.unexpected}`);
      for (const known of s.knownDefects) console.log(`   known defect ${known.id}: ${known.why}`);
    }
  }
  const bad = results.some((item) => String(item.endState).startsWith("error") || (item.matchesExpectation === false && !item.knownDefect) || item.loss > 0 || item.corruption > 0);
  const known = results.some((item) => item.knownDefect && item.matchesExpectation === false);
  return bad || (argv.includes("--strict") && known) ? 1 : 0;
}

if (require.main === module) main().then((code) => process.exit(code), (error) => { console.error(error); process.exit(2); });

module.exports = { summarize, main };
