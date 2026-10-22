#!/usr/bin/env node
// Follow-up to the checklist -> generic party path rewire (ChecklistPartyRewireService): marks the rewired edges as changed and repairs their derived labels, so the live
// graphs of I-129, I-129F, I-130, I-131, I-539 and I-907 pass the mapping contract again.
//
//   node src/scripts/repairRewiredEdgeMetadata.js            # DRY RUN (default): shows exactly what would change, writes nothing
//   node src/scripts/repairRewiredEdgeMetadata.js --apply    # writes: backs up each old graph, stores a NEW mapping version and activates it through the normal activation gate
//
// What it changes (and only this), on edges that carry a `partyRewire` snapshot:
//   1. origin: legacy -> authored. The rewire changed these edges, so they are held to the contract like any new edge (legacy edges are only reported on). Nobody reviewed them one
//      by one: no `reviewedBy` is recorded, only the date of this mark (`rewireMarkedAt`).
//   2. partyRule: the contract requires this derived label to equal the source path (or the first path of the edge's transform). The rewire had stripped the row number and field
//      name from a repeating path (petitioner.addressHistory.1.city -> petitioner.addressHistory), which the contract reports as STALE_DERIVED_METADATA.
//   3. A reviewed exception for three edges where the form's own label says "Employer" but the box really is the beneficiary's employer (the contract reads the word, not the
//      path): the mapping is right and is left exactly as it is; the exception is dated, written and reversible.
// No source path, fallback, transform, condition, status, target or filled value changes: that is checked (the repaired edges, minus those three keys, must equal the old ones).
//
// Safety: every old graph is written to backups/forms/ first; nothing is deleted (the old version is retired, not removed); the repaired graph must pass the contract with no
// findings of any kind, or nothing is written for that form; the new version is activated through MappingGraphService.activate (readiness gate included), not around it.
const fs = require("fs");
const path = require("path");

// reviewed exceptions: formCode -> [{ targetFieldId, code, reason }]
const EXCEPTIONS = {
  "I-130": [
    { targetFieldId: "part4.form10Subform6Part4Line26NameOfCompany0", code: "PARTY_CONTRADICTION", reason: "Reviewed: Item 51 asks for the name of the current employer of the person the petition is for (the beneficiary). The edge reads beneficiary.employmentHistory.0.employerName, which is right; the contract only reads the word 'Employer' in the box label as the petitioner's side." },
  ],
  "I-129F": [
    { targetFieldId: "part2.form10Subform4Part2Line16NameofEmployer0", code: "PARTY_CONTRADICTION", reason: "Reviewed: Item 16 is the beneficiary's own employer (Part 2 is about the beneficiary). The edge reads beneficiary.employmentHistory.0.employerName, which is right; the contract only reads the word 'Employer' in the box label as the petitioner's side." },
    { targetFieldId: "part2.form10Subform5Part2Line20NameofEmployer0", code: "PARTY_CONTRADICTION", reason: "Reviewed: Item 20 is the beneficiary's own employer (Part 2 is about the beneficiary). The edge reads beneficiary.employmentHistory.1.employerName, which is right; the contract only reads the word 'Employer' in the box label as the petitioner's side." },
  ],
};

const MARKED = ["origin", "partyRule", "rewireMarkedAt", "contractExceptions"];

/** Pure. Returns { graph, changes[] } - the repaired copy of a graph and a plain list of what changed. */
function repairGraph(formCode, graph, now = new Date()) {
  const changes = [];
  const exceptions = EXCEPTIONS[formCode] || [];
  const edges = (graph.edges || []).map((edge) => {
    if (!edge.partyRewire) return edge;
    let next = edge;
    const field = String(edge.targetPdfField || edge.targetFieldId).split(".").pop();
    if (next.origin !== "authored") {
      next = { ...next, origin: "authored", rewireMarkedAt: now };
      changes.push({ mappingId: edge.mappingId, field, change: `origin ${edge.origin || "legacy"} -> authored` });
    }
    const wanted = next.transform?.fields?.[0] || next.sourcePath;
    if (next.partyRule && next.partyRule !== wanted) {
      next = { ...next, partyRule: wanted };
      changes.push({ mappingId: edge.mappingId, field, change: `partyRule ${edge.partyRule} -> ${wanted}` });
    }
    for (const exception of exceptions) {
      if (exception.targetFieldId === edge.targetFieldId && !(next.contractExceptions || []).some((item) => item.code === exception.code)) {
        next = { ...next, contractExceptions: [...(next.contractExceptions || []), { code: exception.code, reason: exception.reason, at: now, by: "repairRewiredEdgeMetadata (reviewed on request)" }] };
        changes.push({ mappingId: edge.mappingId, field, change: `reviewed exception recorded for ${exception.code}` });
      }
    }
    return next;
  });
  return { graph: { ...graph, edges }, changes };
}

/** What an edge fills, ignoring the keys this script is allowed to change. */
const meaning = (edge) => { const copy = { ...edge }; MARKED.forEach((key) => delete copy[key]); return JSON.stringify(copy); };

/** True when nothing but the allowed keys differs between two graphs. */
function onlyMetadataChanged(before, after) {
  if ((before.edges || []).length !== (after.edges || []).length) return false;
  return before.edges.every((edge, index) => meaning(edge) === meaning(after.edges[index]) && edge.targetFieldId === after.edges[index].targetFieldId);
}

async function main(argv = process.argv.slice(2)) {
  const apply = argv.includes("--apply");
  require("dotenv").config();
  const mongoose = require("mongoose");
  const env = require("../config/env");
  const USCISFormTemplate = require("../models/USCISFormTemplate");
  const USCISMappingVersion = require("../models/USCISMappingVersion");
  const MappingGraphService = require("../modules/form-mapping/services/MappingGraphService");
  const contract = require("../modules/form-mapping/contract");
  await mongoose.connect(env.mongoUri || process.env.MONGODB_URI, { autoIndex: false, autoCreate: false, serverSelectionTimeoutMS: 15000 });
  try {
    const universe = await contract.loadPathUniverse({ force: true });
    const getTemplateFields = (item) => MappingGraphService.getTemplateFields(item);
    // the forms to look at: every live template whose live graph has a rewired edge (read with a projection - the graph only, never the 10-16 MB template)
    const heads = await USCISFormTemplate.find({ status: "active" }).select("formCode").lean();
    let exit = 0;
    for (const head of heads.sort((a, b) => a.formCode.localeCompare(b.formCode))) {
      const live = await USCISMappingVersion.findOne({ template: head._id, status: "active" }).sort({ mappingVersion: -1 });
      if (!live || !(live.graph?.edges || []).some((edge) => edge.partyRewire)) continue;
      const formCode = head.formCode;
      const template = await USCISFormTemplate.findById(head._id);
      const { graph, changes } = repairGraph(formCode, JSON.parse(JSON.stringify(live.graph)));
      const before = contract.validateGraphContract(live.graph, template, { universe, getTemplateFields });
      const after = contract.validateGraphContract(graph, template, { universe, getTemplateFields });
      const left = after.errors.length + after.legacy.length;
      console.log(`\n${formCode} (live mapping version ${live.mappingVersion}): ${changes.length} change(s) on ${graph.edges.filter((edge) => edge.partyRewire).length} rewired edge(s); contract findings before ${before.summary.legacyViolations + before.summary.errors}, after ${left}; enforced edges after ${after.summary.enforcedEdges}`);
      const counts = {};
      changes.forEach((item) => { const key = item.change.split(" ")[0]; counts[key] = (counts[key] || 0) + 1; });
      console.log("  ", JSON.stringify(counts));
      changes.filter((item) => /exception/.test(item.change)).forEach((item) => console.log(`   - ${item.field}: ${item.change}`));
      if (!changes.length) { console.log("  nothing to repair"); continue; }
      if (!onlyMetadataChanged(live.graph, graph)) { console.log("  REFUSED: the repair would change more than metadata; nothing written"); exit = 1; continue; }
      if (left) { console.log(`  REFUSED: the repaired graph still has ${left} finding(s) (${JSON.stringify({ ...after.summary.byCode })}); nothing written`); exit = 1; continue; }
      if (!apply) continue;

      const dir = path.resolve(__dirname, "../../backups/forms");
      fs.mkdirSync(dir, { recursive: true });
      const backup = path.join(dir, `${formCode}-mapping-v${live.mappingVersion}-before-rewire-metadata-repair-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
      fs.writeFileSync(backup, JSON.stringify({ formCode, mappingVersion: live.mappingVersion, graph: live.graph }));
      graph.repairedFrom = { mappingVersion: live.mappingVersion, by: "repairRewiredEdgeMetadata", at: new Date().toISOString() };
      const actor = { _id: null, role: "system" };
      const version = await MappingGraphService.persistVersion(template, graph, actor);
      await MappingGraphService.activate(template._id, actor, { ip: "script", headers: {} });
      console.log(`  written: new mapping version ${version.mappingVersion} is active; old version ${live.mappingVersion} retired and backed up to ${path.relative(process.cwd(), backup)}`);
    }
    if (!apply) console.log("\nDRY RUN: nothing was written. Re-run with --apply.");
    return exit;
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) main().then((code) => process.exit(code), (error) => { console.error("failed:", error.stack || error.message); process.exit(1); });

module.exports = { repairGraph, onlyMetadataChanged, EXCEPTIONS };
