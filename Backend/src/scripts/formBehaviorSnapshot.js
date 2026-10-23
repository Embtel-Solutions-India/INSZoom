#!/usr/bin/env node
// Phase 7 regression guard: a READ-ONLY behavior snapshot of every live form. It proves "current forms still open, map, fill, save and download exactly as before"
// by running the REAL code paths on the real live templates with a fictional client and recording what comes out.
//   per live (active) edition: the mapping projection (edge and field counts, a hash of every mapping), the values the real resolver produces for a fictional
//   client (count + hash), and a REAL render of the stored PDF with those values, re-opened and read back (page count, field count, every filled value, a hash).
//   node src/scripts/formBehaviorSnapshot.js --out snapshot.json [--forms I-129,I-131]     write a snapshot (reads only; the only write is --out)
//   node src/scripts/formBehaviorSnapshot.js --compare before.json after.json            exit 1 and list every difference
// Nothing is written to the database or to storage; the database handle is the read-only wrapper of the Release 0a scripts.
const fs = require("fs");
const crypto = require("crypto");

const sha = (value) => crypto.createHash("sha1").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex");

/** Pure. Every canonical path an edge reads (primary, fallback, transform sources, condition fields). */
function pathsOf(edge) {
  const paths = [edge.sourcePath, edge.fallback, ...(edge.transform?.fields || []), edge.transform?.source, edge.transform?.countryPath];
  const walk = (rule) => {
    if (!rule || typeof rule !== "object") return;
    (rule.all || rule.any || []).forEach(walk);
    const field = rule.field || rule.source || rule.path;
    if (field && !rule.all && !rule.any) paths.push(field);
  };
  walk(edge.condition);
  return paths.filter((path) => typeof path === "string" && path);
}

/** Pure. Differences between two snapshot files as readable lines (empty = identical behavior). */
function compareSnapshots(before, after) {
  const lines = [];
  const index = (snapshot) => new Map((snapshot.forms || []).map((form) => [`${form.formCode}|${form.version}`, form]));
  const a = index(before);
  const b = index(after);
  for (const key of new Set([...a.keys(), ...b.keys()])) {
    const x = a.get(key);
    const y = b.get(key);
    if (!x) { lines.push(`${key}: only in the after snapshot`); continue; }
    if (!y) { lines.push(`${key}: missing from the after snapshot`); continue; }
    for (const field of ["edgeCount", "projectedCount", "mappingsHash", "valueCount", "valuesHash", "error"]) {
      if (JSON.stringify(x[field]) !== JSON.stringify(y[field])) lines.push(`${key}: ${field} ${JSON.stringify(x[field])} -> ${JSON.stringify(y[field])}`);
    }
    const rx = x.render || {};
    const ry = y.render || {};
    for (const field of ["ok", "pageCount", "fieldCount", "writtenCount", "readbackHash", "error"]) {
      if (JSON.stringify(rx[field]) !== JSON.stringify(ry[field])) lines.push(`${key}: render.${field} ${JSON.stringify(rx[field])} -> ${JSON.stringify(ry[field])}`);
    }
  }
  return lines;
}

async function snapshotForm({ template, mappingVersion, deps }) {
  const { FormMappingService, buildSampleCanonical, PDFRenderer, PDFDocument } = deps;
  const out = { formCode: template.formCode, version: template.version };
  const edges = mappingVersion?.graph?.edges || [];
  out.edgeCount = edges.length;
  const working = JSON.parse(JSON.stringify({ ...template, formFields: template.formFields || [] }));
  FormMappingService.applyMappingGraph(working, mappingVersion || {});
  const mappings = working.formFields.flatMap((field) => (field.mappings || []).map((m) => [field.fieldId || field.fieldName, m.path, m.mappingType || "", JSON.stringify(m.transform || null), JSON.stringify(m.condition || null), m.fallback || ""]));
  out.projectedCount = mappings.length;
  out.mappingsHash = sha(mappings.map((row) => row.join("|")).sort());
  const canonical = buildSampleCanonical(edges.flatMap(pathsOf), {});
  const mapped = FormMappingService.mapTemplate(working, canonical);
  const values = Object.entries(mapped.fieldValues || {}).map(([key, value]) => `${key}=${typeof value === "object" ? JSON.stringify(value) : String(value)}`).sort();
  out.valueCount = values.length;
  out.valuesHash = sha(values);
  out.render = { ok: false };
  try {
    const caseForm = { filledData: mapped.filledData, fieldValues: mapped.fieldValues, sourceAttribution: mapped.sourceAttribution };
    const rendered = await PDFRenderer.render({ caseForm, template: working, watermark: null, flatten: false });
    const pdf = await PDFDocument.load(rendered.buffer, { ignoreEncryption: true, updateMetadata: false });
    const form = pdf.getForm();
    const readback = [];
    for (const field of form.getFields()) {
      let value = "";
      try {
        if (typeof field.getText === "function") value = field.getText() || "";
        else if (typeof field.isChecked === "function") value = field.isChecked() ? "on" : "";
        else if (typeof field.getSelected === "function") value = [].concat(field.getSelected() || []).join(",");
      } catch { value = "?"; }
      if (value !== "") readback.push(`${field.getName()}=${value}`);
    }
    readback.sort();
    out.render = { ok: true, pageCount: pdf.getPageCount(), fieldCount: form.getFields().length, writtenCount: readback.length, readbackHash: sha(readback) };
  } catch (error) {
    out.render = { ok: false, error: String(error.code || error.message).slice(0, 160) };
  }
  return out;
}

async function main(argv) {
  const get = (flag) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : null; };
  if (argv.includes("--compare")) {
    const i = argv.indexOf("--compare");
    const lines = compareSnapshots(JSON.parse(fs.readFileSync(argv[i + 1], "utf8")), JSON.parse(fs.readFileSync(argv[i + 2], "utf8")));
    console.log(lines.length ? lines.join("\n") : "IDENTICAL: every live form maps, fills and renders exactly as before");
    return lines.length ? 1 : 0;
  }
  const mongoose = require("mongoose");
  await require("../config/database")();
  const { readOnlyDb } = require("./lib/readOnlyDb");
  const db = readOnlyDb(mongoose.connection.db);
  const deps = {
    FormMappingService: require("../modules/form-mapping/services/FormMappingService"),
    buildSampleCanonical: require("../modules/form-mapping/golden/sampleClient").buildSampleCanonical,
    PDFRenderer: require("../modules/form-generation/services/PDFRenderer"),
    PDFDocument: require("pdf-lib").PDFDocument,
  };
  const only = (get("--forms") || "").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
  const heads = await db.collection("uscisformtemplates").find({ status: "active", ...(only.length ? { formCode: { $in: only } } : {}) }, { projection: { _id: 1, formCode: 1, version: 1 } }).sort({ formCode: 1 }).toArray();
  const forms = [];
  for (const head of heads) {
    const template = await db.collection("uscisformtemplates").findOne({ _id: head._id });
    const mappingVersion = await db.collection("uscismappingversions").findOne(template.activeMappingVersionId ? { _id: template.activeMappingVersionId } : { template: template._id, status: "active" }, { sort: { mappingVersion: -1 } });
    try {
      forms.push(await snapshotForm({ template, mappingVersion, deps }));
    } catch (error) {
      forms.push({ formCode: template.formCode, version: template.version, error: String(error.message).slice(0, 160) });
    }
    process.stderr.write(`snapshot ${template.formCode} ${forms[forms.length - 1].render?.ok ? "ok" : "render-failed"}\n`);
  }
  const snapshot = { takenAt: new Date().toISOString(), forms };
  const outFile = get("--out");
  if (outFile) fs.writeFileSync(outFile, JSON.stringify(snapshot, null, 1));
  else console.log(JSON.stringify(snapshot, null, 1));
  await mongoose.disconnect();
  return 0;
}

module.exports = { pathsOf, compareSnapshots, snapshotForm };

if (require.main === module) main(process.argv.slice(2)).then((code) => process.exit(code)).catch((error) => { console.error("snapshot failed:", error.message); process.exit(1); });
