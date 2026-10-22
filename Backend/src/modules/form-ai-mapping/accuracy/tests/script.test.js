// scripts/evaluateAiMapping.js: the offline default, the guarded live path, and how stored shadow suggestions are grouped. DB-free; nothing is connected or called.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { parseArgs, planLiveRun, groupStored, EST_COST_PER_BOX } = require("../../../../scripts/evaluateAiMapping");

const live = (extra = []) => parseArgs(["--live", "--forms", "I-90,i-130", "--max-boxes", "50", "--max-cost-usd", "0.5", ...extra]);

test("the default run is offline: it needs no flag, plans no live call, and --live must be explicit", () => {
  assert.deepEqual(planLiveRun(parseArgs([]), { FORM_AI_MAPPING: "off" }), { ok: true, live: false, reasons: [] });
  assert.equal(parseArgs([]).live, false);
  assert.equal(parseArgs(["--record"]).live, false);
});

test("a live run is refused unless FORM_AI_MAPPING is shadow or on", () => {
  for (const mode of ["off", "", "banana", undefined]) {
    const plan = planLiveRun(live(), { FORM_AI_MAPPING: mode });
    assert.equal(plan.ok, false, String(mode));
    assert.match(plan.reasons.join(), /FORM_AI_MAPPING/);
  }
  assert.equal(planLiveRun(live(), { FORM_AI_MAPPING: "shadow" }).ok, true);
  assert.equal(planLiveRun(live(), { FORM_AI_MAPPING: "ON" }).ok, true);
});

test("a live run needs the forms and BOTH hard caps", () => {
  const env = { FORM_AI_MAPPING: "shadow" };
  assert.match(planLiveRun(parseArgs(["--live", "--max-boxes", "5", "--max-cost-usd", "1"]), env).reasons.join(), /--forms/);
  assert.match(planLiveRun(parseArgs(["--live", "--forms", "I-90", "--max-cost-usd", "1"]), env).reasons.join(), /--max-boxes/);
  assert.match(planLiveRun(parseArgs(["--live", "--forms", "I-90", "--max-boxes", "5"]), env).reasons.join(), /--max-cost-usd/);
  assert.equal(planLiveRun(parseArgs(["--live", "--forms", "I-90", "--max-boxes", "0", "--max-cost-usd", "1"]), env).ok, false);
  assert.equal(planLiveRun(parseArgs(["--live", "--forms", "I-90", "--max-boxes", "5", "--max-cost-usd", "-1"]), env).ok, false);
});

test("a live run whose estimated cost is over the cap is refused before anything is called", () => {
  const plan = planLiveRun(parseArgs(["--live", "--forms", "I-90", "--max-boxes", "1000", "--max-cost-usd", "0.10"]), { FORM_AI_MAPPING: "shadow" });
  assert.equal(plan.ok, false);
  assert.match(plan.reasons.join(), /over --max-cost-usd/);
  const ok = planLiveRun(live(), { FORM_AI_MAPPING: "shadow" });
  assert.equal(ok.estimatedCostUsd, 50 * EST_COST_PER_BOX());
});

test("forms are normalised and the actor can be named", () => {
  const args = live(["--record", "--by", "admin@immiglance.com"]);
  assert.deepEqual(args.forms, ["I-90", "I-130"]);
  assert.equal(args.record, true);
  assert.equal(args.by, "admin@immiglance.com");
});

test("stored suggestions: the newest one per box wins, and one-per-document and array-per-run documents are both read", () => {
  const grouped = groupStored([
    { formCode: "I-90", targetFieldId: "a", tier: "needs_review", createdAt: new Date("2026-10-01") },
    { formCode: "I-90", targetFieldId: "a", tier: "auto_use", createdAt: new Date("2026-10-05") },
    { formCode: "i-130", createdAt: new Date("2026-10-02"), suggestions: [{ targetFieldId: "b", tier: "auto_use" }, { targetFieldId: "c", tier: "rejected" }] },
    { formCode: "I-90", tier: "auto_use" }, // no target box: ignored
  ]);
  assert.deepEqual(Object.keys(grouped).sort(), ["I-130", "I-90"]);
  assert.equal(grouped["I-90"].length, 1);
  assert.equal(grouped["I-90"][0].tier, "auto_use");
  assert.equal(grouped["I-130"].length, 2);
});

test("only the guarded live path can reach the Gemini engine, and nothing in the accuracy gate opens itself", () => {
  const source = (file) => fs.readFileSync(path.join(__dirname, "..", "..", "..", "..", file), "utf8");
  const script = source("scripts/evaluateAiMapping.js");
  assert.equal((script.match(/GeminiMappingService/g) || []).length >= 1, true);
  assert.match(script, /if \(args\.live\) \{\s*\n\s*const service = require\("\.\.\/modules\/form-ai-mapping\/GeminiMappingService"\)/, "the engine is required only inside the --live branch");
  for (const file of ["modules/form-ai-mapping/accuracy/evaluate.js", "modules/form-ai-mapping/accuracy/AiMappingGate.js", "modules/form-ai-mapping/accuracy/thresholds.js"]) {
    const code = source(file).split(/\r?\n/).filter((line) => !line.trim().startsWith("//")).join("\n");
    assert.equal(/suggestForTemplate|callModel|gemini\.service|\.generate\(/.test(code), false, `${file} never calls the model (it may read the engine's version constants, nothing more)`);
  }
});
