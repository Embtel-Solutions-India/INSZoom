#!/usr/bin/env node
// Phase 4 accuracy gate, command line. Measures the AI field-mapping engine against the SIGNED golden set with the plan's pre-approved thresholds.
//
//   node src/scripts/evaluateAiMapping.js                 # OFFLINE and READ-ONLY (default): judges the suggestions shadow mode has ALREADY stored (collection formaimappingsuggestions)
//                                                         #   against the golden set and prints the report. Calls nothing, writes nothing.
//   node src/scripts/evaluateAiMapping.js --record        # same, then stores the result as a new append-only AiMappingGateRecord (the only way the gate can ever open)
//   node src/scripts/evaluateAiMapping.js --live --forms I-90,I-130 --max-boxes 60 --max-cost-usd 0.50 [--record]
//                                                         # the ONLY path that calls Gemini (GeminiMappingService.suggestForTemplate): explicit --live, FORM_AI_MAPPING must be
//                                                         #   shadow or on, and BOTH hard caps are required. It never runs by itself.
// A stored suggestion is matched to the golden answer key by targetFieldId; only auto-used suggestions are judged (see form-ai-mapping/accuracy/evaluate.js).
// Assumed shape of a stored suggestion document: { formCode, targetFieldId, candidate: { sourcePath }, tier, createdAt } (one per document, or a `suggestions` array per run).
const EST_COST_PER_BOX = () => Number(process.env.AI_MAPPING_EST_COST_PER_BOX || 0.002); // USD, a deliberately generous estimate used only to refuse an over-cap run up front

function parseArgs(argv = []) {
  const flag = (name) => argv.includes(name);
  const value = (name) => { const at = argv.indexOf(name); return at >= 0 ? argv[at + 1] : undefined; };
  return {
    live: flag("--live"), record: flag("--record"), json: flag("--json"),
    forms: String(value("--forms") || "").split(",").map((code) => code.trim().toUpperCase()).filter(Boolean),
    maxBoxes: value("--max-boxes") === undefined ? undefined : Number(value("--max-boxes")),
    maxCostUsd: value("--max-cost-usd") === undefined ? undefined : Number(value("--max-cost-usd")),
    by: value("--by") || "evaluateAiMapping.js",
  };
}

/** Pure. { ok, reasons[] } - whether a live run may start. Refuses unless EVERYTHING is explicit and capped. */
function planLiveRun(args, env = process.env) {
  const reasons = [];
  if (!args.live) return { ok: true, live: false, reasons };
  const mode = String(env.FORM_AI_MAPPING || "off").toLowerCase();
  if (!["shadow", "on"].includes(mode)) reasons.push(`FORM_AI_MAPPING is "${mode}": set it to shadow (or on) first - a live run never starts while AI mapping is off`);
  if (!args.forms.length) reasons.push("--forms is required (the forms to run, for example --forms I-90,I-130)");
  if (!Number.isFinite(args.maxBoxes) || args.maxBoxes <= 0) reasons.push("--max-boxes is required (a hard cap on the boxes sent to the model)");
  if (!Number.isFinite(args.maxCostUsd) || args.maxCostUsd <= 0) reasons.push("--max-cost-usd is required (a hard cap on the estimated cost)");
  if (!reasons.length && args.maxBoxes * EST_COST_PER_BOX() > args.maxCostUsd) reasons.push(`${args.maxBoxes} boxes would cost an estimated $${(args.maxBoxes * EST_COST_PER_BOX()).toFixed(2)}, over --max-cost-usd ${args.maxCostUsd}: lower --max-boxes or raise the cap`);
  return { ok: reasons.length === 0, live: true, reasons, estimatedCostUsd: reasons.length ? undefined : args.maxBoxes * EST_COST_PER_BOX() };
}

/** Newest suggestion per target box, grouped by form. Accepts one-suggestion documents and documents that carry a `suggestions` array. */
function groupStored(documents = []) {
  const newest = new Map();
  const consider = (formCode, suggestion, at) => {
    if (!formCode || !suggestion?.targetFieldId) return;
    const key = `${formCode}|${suggestion.targetFieldId}`;
    const time = new Date(at || 0).getTime();
    if (!newest.has(key) || time >= newest.get(key).time) newest.set(key, { formCode, suggestion, time });
  };
  for (const doc of documents) {
    const at = doc.createdAt || doc.updatedAt;
    if (Array.isArray(doc.suggestions)) doc.suggestions.forEach((item) => consider(String(doc.formCode || item.formCode || "").toUpperCase(), item, at));
    else consider(String(doc.formCode || "").toUpperCase(), doc, at);
  }
  const byForm = {};
  for (const { formCode, suggestion } of newest.values()) (byForm[formCode] ||= []).push(suggestion);
  return byForm;
}

function print(report, args) {
  if (args.json) return console.log(JSON.stringify(report, null, 1));
  console.log(`\nAI mapping accuracy gate: ${report.met ? "MET" : "NOT MET"}  (${report.verifiedEntries} verified golden entries, golden ${String(report.goldenChecksum).slice(0, 8)})`);
  for (const [name, result] of Object.entries(report.results)) console.log(`  ${result.ok ? "pass" : "FAIL"}  ${name}: ${typeof result.actual === "object" ? JSON.stringify(result.actual) : result.actual}  (required ${result.required})`);
  const { overall } = report.metrics;
  console.log(`\n  suggestions judged ${overall.suggested} of ${overall.verified} verified boxes | auto-used ${overall.autoUsed} (correct ${overall.autoCorrect}, wrong ${overall.autoWrong}) | needs_review ${overall.needsReview} | rejected ${overall.rejected} | not in the answer key ${report.metrics.unverifiedSuggestions}`);
  console.log(`  forms evaluated: ${report.evaluated.forms.join(", ") || "(none)"} | held-out: ${report.evaluated.heldOutForms.join(", ")}`);
  for (const [kind, bucket] of Object.entries(report.metrics.byKind)) console.log(`  ${kind.padEnd(9)} verified ${String(bucket.verified).padStart(3)} suggested ${String(bucket.suggested).padStart(3)} auto-used ${String(bucket.autoUsed).padStart(3)} precision ${bucket.precision ?? "-"} candidate accuracy ${bucket.candidateAccuracy ?? "-"}`);
  report.violations.role.slice(0, 5).forEach((item) => console.log(`  ROLE  ${item.formCode} ${item.targetFieldId}: expected ${item.expected} (${item.expectedParty}), suggested ${item.suggested} (${item.suggestedParty})`));
  report.violations.integrity.slice(0, 5).forEach((item) => console.log(`  INTEGRITY  ${item.formCode} ${item.targetFieldId}: ${item.problems.join(", ")}`));
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const plan = planLiveRun(args);
  if (!plan.ok) { console.error("REFUSED:\n  " + plan.reasons.join("\n  ")); return 1; }
  require("dotenv").config();
  const mongoose = require("mongoose");
  const env = require("../config/env");
  const { readOnlyDb } = require("./lib/readOnlyDb");
  const { evaluate } = require("../modules/form-ai-mapping/accuracy");
  const gate = require("../modules/form-ai-mapping/accuracy/AiMappingGate");
  await mongoose.connect(env.mongoUri || process.env.MONGODB_URI, { autoIndex: false, autoCreate: false, serverSelectionTimeoutMS: 15000 });
  try {
    const db = readOnlyDb(mongoose.connection.db);
    const draft = require("../modules/form-mapping/golden/goldenSet.draft.json");
    const reviews = await db.collection("goldensetreviews").find({}, { projection: { entryId: 1, contentHash: 1, verdict: 1 } }).toArray();
    let suggestionsByForm;
    if (args.live) {
      const service = require("../modules/form-ai-mapping/GeminiMappingService");
      const USCISFormTemplate = require("../models/USCISFormTemplate");
      suggestionsByForm = {};
      let boxesLeft = args.maxBoxes;
      let costLeft = args.maxCostUsd;
      for (const formCode of args.forms) {
        if (boxesLeft <= 0 || costLeft <= 0) { console.log(`cap reached: ${formCode} and the forms after it were not run`); break; }
        const template = await USCISFormTemplate.findOne({ formCode, status: "active" }).sort({ editionDate: -1 });
        if (!template) { console.log(`${formCode}: no active template - skipped`); continue; }
        const result = await service.suggestForTemplate({ template, maxBoxes: boxesLeft, maxCostUsd: costLeft });
        const used = (result.suggestions || []).length;
        suggestionsByForm[formCode] = result.suggestions || [];
        boxesLeft -= used;
        costLeft -= Number(result.usage?.estimatedCostUsd ?? result.usage?.estimatedCost ?? used * EST_COST_PER_BOX());
        console.log(`${formCode}: ${used} suggestion(s); boxes left ${boxesLeft}, estimated cost left $${Math.max(costLeft, 0).toFixed(3)}`);
      }
    } else {
      const stored = await db.collection("formaimappingsuggestions").find({}).toArray();
      suggestionsByForm = groupStored(stored);
    }
    const report = evaluate({ goldenDraft: draft, reviews, suggestionsByForm });
    print(report, args);
    if (args.record) {
      const record = await gate.recordEvaluation(report, { by: args.by, source: args.live ? "live" : "shadow_store" });
      console.log(`\nrecorded AiMappingGateRecord ${record._id} (met: ${record.met}, expires ${record.expiresAt.toISOString().slice(0, 10)})`);
    } else {
      console.log("\n(nothing recorded - add --record to store this evaluation)");
    }
    return 0;
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) main().then((code) => process.exit(code), (error) => { console.error("failed:", error.stack || error.message); process.exit(1); });

module.exports = { parseArgs, planLiveRun, groupStored, EST_COST_PER_BOX };
