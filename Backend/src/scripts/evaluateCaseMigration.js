#!/usr/bin/env node
// Phase 7.7 evaluation (READ-ONLY): what would the case migration do on the REAL open case forms, today's rules vs the Phase 7.7 rules? Runs the PLAN step only
// (planCarry, no writes, no autofill, no snapshot) through the read-only database handle of the Release 0a scripts: any write attempt throws.
//   node src/scripts/evaluateCaseMigration.js [--forms I-129,I-907] [--json]
// Two measurements per form:
//   migration   open case forms that sit on an edition OTHER than the live one, planned toward the live edition (what the next promotion would do)
//   self-check  open case forms planned onto THEIR OWN edition (an identity move: every answer must be carried unchanged, nothing archived or parked). This checks the new
//               rules against real answer shapes (provenance, overrides, checkboxes, option sets) even when no case form is waiting for an edition move.
// Only COUNTS are printed: no answer, name or id of a person ever appears in the output.
const mongoose = require("mongoose");

const { FROZEN_CASE_FORM_STATUSES: OPEN_FROZEN } = require("../modules/form-mapping/config/caseFormFreeze"); // the one shared definition of a frozen case form

/** Pure. Folds one plan into a counter object. */
function tally(acc, plan) {
  acc.caseForms += 1;
  if (plan.unresolved.length) {
    acc.parked += 1;
    for (const item of plan.unresolved) { const key = `${item.code}${item.policy ? `:${item.policy}` : ""}`; acc.reasons[key] = (acc.reasons[key] || 0) + 1; }
  } else acc.wouldMigrate += 1;
  acc.carried += plan.counts.carried;
  acc.archived += plan.counts.archived;
  acc.converted += plan.dispositions.filter((item) => item.converted).length;
  acc.noCounterpart += plan.dispositions.filter((item) => item.disposition === "archived" && /no_counterpart/.test(item.reason || "")).length;
  acc.notCarriable += plan.dispositions.filter((item) => item.disposition === "archived" && /value_not_carriable/.test(item.reason || "")).length;
  acc.unproven += plan.proof && !plan.proof.ok ? 1 : 0;
  return acc;
}
const counter = () => ({ caseForms: 0, wouldMigrate: 0, parked: 0, carried: 0, archived: 0, converted: 0, noCounterpart: 0, notCarriable: 0, unproven: 0, reasons: {} });

/** Pure. Plans one case form both ways. `matcher(path)`, `oldField(path)`. */
function planBoth(Recovery, image, matcher, oldField) {
  const isApplicable = (target) => target.hidden !== true;
  return { off: Recovery.planCarry(image, matcher, { isApplicable }), on: Recovery.planCarry(image, matcher, { isApplicable, v7: { oldField } }) };
}

async function main(argv) {
  const only = ((i) => (i >= 0 ? String(argv[i + 1] || "").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean) : []))(argv.indexOf("--forms"));
  await require("../config/database")();
  const { readOnlyDb } = require("./lib/readOnlyDb");
  const db = readOnlyDb(mongoose.connection.db);
  const Recovery = require("../modules/form-mapping/services/CaseFormMigrationRecovery");
  const Migration = require("../modules/form-mapping/services/CaseFormEditionMigrationService");

  const openFilter = { status: { $nin: OPEN_FROZEN }, isLocked: { $ne: true }, ...(only.length ? { formCode: { $in: only } } : {}) };
  const byTemplate = await db.collection("caseforms").aggregate([{ $match: openFilter }, { $group: { _id: { formCode: "$formCode", templateId: "$formTemplateId" }, n: { $sum: 1 } } }]).toArray();
  const forms = [...new Set(byTemplate.map((row) => row._id.formCode))].sort();
  const report = [];
  for (const formCode of forms) {
    const live = await db.collection("uscisformtemplates").findOne({ formCode, status: "active" }, { sort: { editionDate: -1 } });
    const rows = byTemplate.filter((row) => row._id.formCode === formCode);
    const entry = { formCode, liveEdition: live ? live.version : null, openCaseForms: rows.reduce((sum, row) => sum + row.n, 0), onOtherEditions: 0, migration: { off: counter(), on: counter() }, selfCheck: { off: counter(), on: counter() } };
    if (!live) { entry.note = "no live edition"; report.push(entry); continue; }
    for (const row of rows) {
      const own = String(row._id.templateId) === String(live._id);
      const template = own ? live : await db.collection("uscisformtemplates").findOne({ _id: row._id.templateId });
      if (!template) continue;
      if (!own) entry.onOtherEditions += row.n;
      const matcher = Migration.buildMatcher(template, own ? template : live);
      const oldField = Migration.oldFieldLookup(template);
      const cursor = db.collection("caseforms").find({ ...openFilter, formCode, formTemplateId: row._id.templateId });
      for await (const doc of cursor) {
        const plans = planBoth(Recovery, Recovery.imageOf(doc), matcher, oldField);
        const target = own ? entry.selfCheck : entry.migration;
        tally(target.off, plans.off);
        tally(target.on, plans.on);
      }
    }
    report.push(entry);
    process.stderr.write(`evaluated ${formCode}\n`);
  }
  if (argv.includes("--json")) console.log(JSON.stringify(report, null, 1));
  else {
    for (const entry of report) {
      console.log(`${entry.formCode} (live ${entry.liveEdition}): open case forms ${entry.openCaseForms}, on another edition ${entry.onOtherEditions}`);
      for (const [label, data] of [["migration", entry.migration], ["self-check", entry.selfCheck]]) {
        if (!data.off.caseForms) continue;
        for (const mode of ["off", "on"]) {
          const x = data[mode];
          console.log(`  ${label} ${mode.padEnd(3)}: ${x.caseForms} planned, would migrate ${x.wouldMigrate}, parked/blocked ${x.parked}, carried ${x.carried}, archived ${x.archived} (no counterpart ${x.noCounterpart}, not carriable ${x.notCarriable}), converted ${x.converted}, unproven ${x.unproven}${Object.keys(x.reasons).length ? ` reasons ${JSON.stringify(x.reasons)}` : ""}`);
        }
      }
    }
  }
  await mongoose.disconnect();
  return 0;
}

module.exports = { tally, counter, planBoth };

if (require.main === module) main(process.argv.slice(2)).then((code) => process.exit(code)).catch((error) => { console.error("evaluation failed:", error.message); process.exit(1); });
