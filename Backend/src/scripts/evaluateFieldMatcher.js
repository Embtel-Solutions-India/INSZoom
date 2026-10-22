#!/usr/bin/env node
// Phase 7.3 proof (c): READ-ONLY comparison of the semantic FieldMatcher with what the CURRENT edition carry-forward did, on the real stored editions.
// For every form with two (or more) stored editions that both have a mapping graph, the previous edition's graph is carried onto the newer edition twice:
//   current  = today's logic (exact name, then the strict rename rule)            - FORM_PIPELINE_AUTONOMY=off
//   matcher  = today's logic + the semantic matcher for what was still lost       - FORM_PIPELINE_AUTONOMY=on  (in memory only)
// and each carried edge is checked against the NEWER edition's own mapping graph, which a person (or an authored crosswalk) made: an edge is CORRECT when the newer graph
// maps the same canonical source to the very box we carried it to. Edges the newer graph has no opinion about are "unverifiable", never counted as right.
//   node src/scripts/evaluateFieldMatcher.js [--forms I-485,I-131] [--json]
//   node src/scripts/evaluateFieldMatcher.js --dump-fixture I-485 --out fixture.json     compact real-data fixture for the offline replay test
// Nothing is written to the database (read-only handle); the only file write is --out.
const fs = require("fs");

const compactField = (field) => ({
  fieldId: field.fieldId, fieldName: field.fieldName, pdfFieldName: field.pdfFieldName, label: field.label, tooltip: field.tooltip, type: field.type, fieldType: field.fieldType, pdfFieldType: field.pdfFieldType,
  sectionTitle: field.sectionTitle, pageNumber: field.pageNumber, groupId: field.groupId, options: field.options, exportValue: field.exportValue, boundingBox: field.boundingBox || field.coordinates?.boundingBox, coordinateSystem: field.coordinateSystem || field.coordinates?.coordinateSystem,
  validation: field.validation ? { maxLength: field.validation.maxLength, comb: field.validation.comb, required: field.validation.required } : undefined,
});
const compactEdge = (edge) => ({ mappingId: edge.mappingId, sourcePath: edge.sourcePath, targetFieldId: edge.targetFieldId, targetPdfField: edge.targetPdfField, targetLabel: edge.targetLabel, targetType: edge.targetType, section: edge.section, pageNumber: edge.pageNumber, status: edge.status, mappingType: edge.mappingType, confidence: edge.confidence });

async function loadGraph(db, template) {
  const versions = db.collection("uscismappingversions");
  const wanted = template.activeMappingVersionId ? { _id: template.activeMappingVersionId } : { template: template._id };
  const version = template.activeMappingVersionId ? await versions.findOne(wanted) : (await versions.find(wanted).sort({ status: 1, mappingVersion: -1 }).limit(1).toArray())[0];
  return version?.graph?.edges?.length ? version.graph : null;
}

/** Pure. Carry `previousGraph` onto `nextTemplate` under a given switch value and score every carried edge against `nextGraph`. */
function evaluatePair({ previousGraph, previousTemplate, nextTemplate, nextGraph, carryForwardGraph, mode }) {
  const saved = process.env.FORM_PIPELINE_AUTONOMY;
  process.env.FORM_PIPELINE_AUTONOMY = mode;
  let carried;
  try {
    carried = carryForwardGraph(JSON.parse(JSON.stringify(previousGraph)), JSON.parse(JSON.stringify(nextTemplate)), { previousTemplate });
  } finally {
    if (saved === undefined) delete process.env.FORM_PIPELINE_AUTONOMY; else process.env.FORM_PIPELINE_AUTONOMY = saved;
  }
  const truth = new Map();
  (nextGraph?.edges || []).forEach((edge) => { const key = `${edge.sourcePath}|${edge.targetPdfField}`; truth.set(key, true); });
  const truthSources = new Set((nextGraph?.edges || []).map((edge) => edge.sourcePath));
  const row = { edgesIn: (previousGraph.edges || []).length, carried: carried.graph.edges.length, renamed: carried.renamedEdges.length, lost: carried.lostEdges.length, verifiedCorrect: 0, wrong: 0, unverifiable: 0 };
  for (const renamed of carried.renamedEdges) {
    const edge = (previousGraph.edges || []).find((item) => item.mappingId === renamed.mappingId) || {};
    if (!truthSources.has(edge.sourcePath)) row.unverifiable += 1;
    else if (truth.has(`${edge.sourcePath}|${renamed.to}`)) row.verifiedCorrect += 1;
    else row.wrong += 1;
  }
  return { row, renamedEdges: carried.renamedEdges, lostEdges: carried.lostEdges };
}

async function main(argv) {
  const get = (flag) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : null; };
  const mongoose = require("mongoose");
  await require("../config/database")();
  const { readOnlyDb } = require("./lib/readOnlyDb");
  const db = readOnlyDb(mongoose.connection.db);
  const { carryForwardGraph } = require("../modules/form-mapping/services/EditionMigrationService");
  const only = (get("--forms") || get("--dump-fixture") || "").split(",").map((item) => item.trim().toUpperCase()).filter(Boolean);
  const heads = await db.collection("uscisformtemplates").find(only.length ? { formCode: { $in: only } } : {}, { projection: { formCode: 1, version: 1, editionDate: 1, status: 1, activeMappingVersionId: 1 } }).toArray();
  const byForm = new Map();
  heads.forEach((head) => (byForm.get(head.formCode) || byForm.set(head.formCode, []).get(head.formCode)).push(head));
  const report = [];
  for (const [formCode, list] of byForm) {
    const usable = list.filter((head) => head.editionDate).sort((a, b) => new Date(a.editionDate) - new Date(b.editionDate));
    if (usable.length < 2) continue;
    for (let i = 1; i < usable.length; i += 1) {
      const previousTemplate = await db.collection("uscisformtemplates").findOne({ _id: usable[i - 1]._id });
      const nextTemplate = await db.collection("uscisformtemplates").findOne({ _id: usable[i]._id });
      const previousGraph = await loadGraph(db, previousTemplate);
      const nextGraph = await loadGraph(db, nextTemplate);
      if (!previousGraph || !nextGraph) { report.push({ formCode, from: previousTemplate.version, to: nextTemplate.version, skipped: "a mapping graph is missing" }); continue; }
      if (get("--dump-fixture")) {
        const fixture = { formCode, from: previousTemplate.version, to: nextTemplate.version, previousFields: previousTemplate.formFields.map(compactField), nextFields: nextTemplate.formFields.map(compactField), previousEdges: previousGraph.edges.map(compactEdge), nextEdges: nextGraph.edges.map(compactEdge) };
        const outFile = get("--out");
        if (outFile) fs.writeFileSync(outFile, JSON.stringify(fixture)); else console.log(JSON.stringify(fixture).length, "bytes (use --out)");
        continue;
      }
      const current = evaluatePair({ previousGraph, previousTemplate, nextTemplate, nextGraph, carryForwardGraph, mode: "off" });
      const matcher = evaluatePair({ previousGraph, previousTemplate, nextTemplate, nextGraph, carryForwardGraph, mode: "on" });
      const added = matcher.renamedEdges.filter((edge) => !current.renamedEdges.some((item) => item.mappingId === edge.mappingId));
      report.push({ formCode, from: previousTemplate.version, to: nextTemplate.version, current: current.row, matcher: matcher.row, matcherAddsRenames: added.length, sample: added.slice(0, 5).map((edge) => `${edge.from} -> ${edge.to}`) });
    }
  }
  await mongoose.disconnect();
  if (argv.includes("--json")) console.log(JSON.stringify(report, null, 1));
  else for (const item of report) console.log(item.skipped ? `${item.formCode} ${item.from} -> ${item.to}: skipped (${item.skipped})` : `${item.formCode} ${item.from} -> ${item.to}: edges ${item.current.edgesIn} | current: carried ${item.current.carried}, renamed ${item.current.renamed} (correct ${item.current.verifiedCorrect}, wrong ${item.current.wrong}, unverifiable ${item.current.unverifiable}), lost ${item.current.lost} | with matcher: renamed ${item.matcher.renamed} (correct ${item.matcher.verifiedCorrect}, wrong ${item.matcher.wrong}, unverifiable ${item.matcher.unverifiable}), lost ${item.matcher.lost}${item.sample.length ? `\n    e.g. ${item.sample.join("; ")}` : ""}`);
  return 0;
}

module.exports = { evaluatePair, compactField, compactEdge };

if (require.main === module) main(process.argv.slice(2)).then((code) => process.exit(code)).catch((error) => { console.error("evaluation failed:", error.message); process.exit(1); });
