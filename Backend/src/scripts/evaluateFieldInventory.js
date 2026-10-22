#!/usr/bin/env node
// Phase 7.4 calibration (READ-ONLY): the per-field inventory of EVERY live (active) form edition, computed from the stored template and its active mapping graph.
// It answers the owner's D1 question with real numbers: how many boxes per class, how many protected-role / required boxes have no active mapping today, and which forms
// the inventory gate WOULD hold. The database handle is the read-only wrapper of the Release 0a scripts; nothing is written anywhere (the only write is --out).
//   node src/scripts/evaluateFieldInventory.js [--forms I-131,I-765] [--json] [--out file.json]
const fs = require("fs");

const COLUMNS = ["formCode", "version", "total", "mapped", "non_data", "deliberately_blank", "conditional", "unmapped_needs_source", "holdCount", "protectedRole", "required", "conditionalRequired", "roleUnknown", "decision"];

/** Pure. One table row per form from a built inventory. */
function rowOf(formCode, version, inventory) {
  return {
    formCode, version, total: inventory.counts.total, mapped: inventory.counts.mapped, non_data: inventory.counts.non_data, deliberately_blank: inventory.counts.deliberately_blank,
    conditional: inventory.counts.conditional, unmapped_needs_source: inventory.counts.unmapped_needs_source, holdCount: inventory.hold.length, protectedRole: inventory.holdBy.protectedRole,
    required: inventory.holdBy.required, conditionalRequired: inventory.holdBy.conditionalRequired, roleUnknown: inventory.holdBy.roleUnknown, decision: inventory.decision,
  };
}

const pad = (value, width) => String(value ?? "").padEnd(width).slice(0, Math.max(width, String(value ?? "").length));
function renderTable(rows) {
  const widths = COLUMNS.map((column) => Math.max(column.length, ...rows.map((row) => String(row[column] ?? "").length)));
  const header = COLUMNS.map((column, index) => pad(column, widths[index])).join("  ");
  return [header, ...rows.map((row) => COLUMNS.map((column, index) => pad(row[column], widths[index])).join("  "))].join("\n");
}

async function main(argv) {
  const get = (flag) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : null; };
  const mongoose = require("mongoose");
  await require("../config/database")();
  const { readOnlyDb } = require("./lib/readOnlyDb");
  const FieldInventory = require("../modules/form-mapping/inventory/FieldInventory");
  const db = readOnlyDb(mongoose.connection.db);
  const only = (get("--forms") || "").split(",").map((item) => item.trim().toUpperCase()).filter(Boolean);
  const heads = await db.collection("uscisformtemplates").find({ status: "active", ...(only.length ? { formCode: { $in: only } } : {}) }, { projection: { _id: 1, formCode: 1, version: 1 } }).sort({ formCode: 1 }).toArray();
  const rows = [];
  const details = {};
  for (const head of heads) {
    const template = await db.collection("uscisformtemplates").findOne({ _id: head._id }, { projection: { formCode: 1, version: 1, formFields: 1, activeMappingVersionId: 1 } });
    const mappingVersion = await db.collection("uscismappingversions").findOne(template.activeMappingVersionId ? { _id: template.activeMappingVersionId } : { template: template._id, status: "active" }, { sort: { mappingVersion: -1 }, projection: { mappingVersion: 1, "graph.edges.targetFieldId": 1, "graph.edges.status": 1, "graph.keepBlank": 1 } });
    const inventory = FieldInventory.build({ template, graph: mappingVersion?.graph || {} });
    rows.push(rowOf(template.formCode, template.version, inventory));
    details[template.formCode] = { summary: FieldInventory.summarize(inventory), sampleHold: inventory.hold.slice(0, 8).map((entry) => `${entry.label || entry.id} [${entry.role}${entry.required ? ", required" : ""}${entry.class === "conditional" ? ", conditional" : ""}]`) };
    process.stderr.write(`inventory ${template.formCode} ${inventory.decision}\n`);
  }
  const output = { takenAt: new Date().toISOString(), rows, details };
  if (get("--out")) fs.writeFileSync(get("--out"), JSON.stringify(output, null, 1));
  if (argv.includes("--json")) console.log(JSON.stringify(output, null, 1));
  else {
    console.log(renderTable(rows));
    const held = rows.filter((row) => row.decision === "held");
    console.log(`\n${held.length} of ${rows.length} live forms WOULD be held by the inventory gate (report-only today): ${held.map((row) => row.formCode).join(", ") || "none"}`);
  }
  await mongoose.disconnect();
  return 0;
}

module.exports = { rowOf, renderTable, COLUMNS };

if (require.main === module) main(process.argv.slice(2)).then((code) => process.exit(code)).catch((error) => { console.error("evaluation failed:", error.message); process.exit(1); });
