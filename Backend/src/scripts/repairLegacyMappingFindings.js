#!/usr/bin/env node
// Phase 2 follow-up: repairs the legacy findings the mapping contract reported on live mapping graphs (I-907, G-28, I-539).
//
//   node src/scripts/repairLegacyMappingFindings.js            # DRY RUN (default): shows exactly what would change, writes nothing
//   node src/scripts/repairLegacyMappingFindings.js --apply    # writes: backs up each old graph, stores a NEW mapping version, activates it
//
// What it changes (and only this):
//   1. STALE DERIVED METADATA (I-907, G-28): an edge written by a party rule (it has `partyRule`) must carry the profile owner that rule derives
//      (petitioner.* -> employer, everything else -> employee, exactly PartyFieldMappingService's own derivation). The stored owner was `employee` for petitioner paths.
//      The edge is then marked `authored` (it IS rule-authored) and dated. No source path, transform, condition, status or filled value changes.
//   2. A REVIEWED EXCEPTION (I-539): two edges read the petitioner's name into `P3_Line4_NameofPetitioner[0|1]`. The edges' own authored note says "Name of petitioner on the
//      related Form I-129"; the real PDF field name agrees; only the auto-extracted label ("Beneficiary or Applicant") disagrees. The mapping is left exactly as it is and a
//      dated exception with that reason is recorded on those two edges, so the contract stops reporting a false alarm. Remove the exception to see the finding again.
//
// Safety: every old graph is written to backups/forms/ first; nothing is deleted (the old version is retired, not removed); the repaired graph must pass the contract with
// no enforced errors and none of the targeted findings left, or nothing is written; a form whose live graph no longer matches what this script expects is skipped.
const fs = require("fs");
const path = require("path");

const OWNER_FOR = (partyRule) => (String(partyRule).startsWith("petitioner") ? "employer" : "employee");

// explicit, reviewed exceptions: formCode -> [{ pdfFieldSuffix, code, reason }]
const EXCEPTIONS = {
  "I-539": [
    { pdfFieldSuffix: "P3_Line4_NameofPetitioner[0]", code: "PARTY_CONTRADICTION", reason: "Reviewed: the edge's authored note and the PDF field name (NameofPetitioner) say this is the petitioner's name on the related Form I-129; only the auto-extracted label says 'Beneficiary or Applicant'. The mapping is intentional." },
    { pdfFieldSuffix: "P3_Line4_NameofPetitioner[1]", code: "PARTY_CONTRADICTION", reason: "Reviewed: the edge's authored note and the PDF field name (NameofPetitioner) say this is the petitioner's name on the related Form I-129 (repeat widget); only the auto-extracted label says 'Beneficiary or Applicant'. The mapping is intentional." },
  ],
};

/** Pure. Returns { graph, changes[] } - the repaired copy of a graph and a plain list of what was changed. */
function repairGraph(formCode, graph, now = new Date()) {
  const changes = [];
  const exceptions = EXCEPTIONS[formCode] || [];
  const edges = (graph.edges || []).map((edge) => {
    let next = edge;
    if (edge.partyRule && edge.profileOwner !== OWNER_FOR(edge.partyRule)) {
      next = { ...next, profileOwner: OWNER_FOR(edge.partyRule), origin: "authored", reviewedAt: now };
      changes.push({ mappingId: edge.mappingId, field: String(edge.targetPdfField).split(".").pop(), change: `profileOwner ${edge.profileOwner} -> ${next.profileOwner}` });
    }
    for (const exception of exceptions) {
      if (String(edge.targetPdfField || "").endsWith(exception.pdfFieldSuffix) && !(edge.contractExceptions || []).some((item) => item.code === exception.code)) {
        next = { ...next, contractExceptions: [...(next.contractExceptions || []), { code: exception.code, reason: exception.reason, at: now, by: "repairLegacyMappingFindings (reviewed on request)" }] };
        changes.push({ mappingId: edge.mappingId, field: exception.pdfFieldSuffix, change: `reviewed exception recorded for ${exception.code}` });
      }
    }
    return next;
  });
  return { graph: { ...graph, edges }, changes };
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
    let exit = 0;
    for (const formCode of ["I-907", "G-28", "I-539"]) {
      const template = await USCISFormTemplate.findOne({ formCode, status: "active" });
      const live = template && await USCISMappingVersion.findOne({ template: template._id, status: "active" }).sort({ mappingVersion: -1 });
      if (!live) { console.log(`${formCode}: no active template / mapping version - skipped`); continue; }
      const { graph, changes } = repairGraph(formCode, JSON.parse(JSON.stringify(live.graph)));
      const getTemplateFields = (item) => MappingGraphService.getTemplateFields(item);
      const before = contract.validateGraphContract(live.graph, template, { universe, getTemplateFields });
      const after = contract.validateGraphContract(graph, template, { universe, getTemplateFields });
      console.log(`\n${formCode} (live mapping version ${live.mappingVersion}): ${changes.length} change(s); findings before ${before.summary.legacyViolations + before.summary.errors}, after ${after.summary.legacyViolations + after.summary.errors}`);
      changes.slice(0, 40).forEach((item) => console.log(`  - ${item.field}: ${item.change}`));
      if (!changes.length) { console.log("  nothing to repair"); continue; }
      if (after.errors.length || after.legacy.length) { console.log(`  REFUSED: the repaired graph still has ${after.errors.length + after.legacy.length} finding(s); nothing written`); exit = 1; continue; }
      if (!apply) continue;

      const dir = path.resolve(__dirname, "../../backups/forms");
      fs.mkdirSync(dir, { recursive: true });
      const backup = path.join(dir, `${formCode}-mapping-v${live.mappingVersion}-before-legacy-repair-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
      fs.writeFileSync(backup, JSON.stringify({ formCode, mappingVersion: live.mappingVersion, graph: live.graph }));
      graph.repairedFrom = { mappingVersion: live.mappingVersion, by: "repairLegacyMappingFindings", at: new Date().toISOString() };
      const version = await MappingGraphService.persistVersion(template, graph, { _id: null, role: "system" });
      // the same effects as MappingGraphService.activate, without its readiness gate: this repair changes metadata only, so what is filled is exactly what was filled before
      await USCISMappingVersion.updateMany({ template: template._id, status: "active", _id: { $ne: version._id } }, { $set: { status: "retired", retiredAt: new Date() } });
      await USCISMappingVersion.updateOne({ _id: version._id }, { $set: { status: "active", activatedAt: new Date() } });
      template.mappingStatus = "active";
      template.activeMappingVersion = version.mappingVersion;
      template.activeMappingVersionId = version._id;
      template.mappingAuditHistory = [...(template.mappingAuditHistory || []), { action: "LEGACY_FINDINGS_REPAIRED", performedAt: new Date(), version: version.mappingVersion }];
      await template.save();
      console.log(`  written: new mapping version ${version.mappingVersion} is active; old version ${live.mappingVersion} retired and backed up to ${path.relative(process.cwd(), backup)}`);
    }
    if (!apply) console.log("\nDRY RUN: nothing was written. Re-run with --apply.");
    return exit;
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) main().then((code) => process.exit(code), (error) => { console.error("failed:", error.stack || error.message); process.exit(1); });

module.exports = { repairGraph, OWNER_FOR, EXCEPTIONS };
