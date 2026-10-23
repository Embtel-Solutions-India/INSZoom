#!/usr/bin/env node
// READ-ONLY calibration of the Phase 7.6a certification probe over every LIVE edition (and, for forms that have them, every ACTIVE component): for each, the probe renders the
// edition's own stored PDF in memory (very long / typed / ticked / real-option values), re-opens it and checks the data and the final file. Nothing is written to the database
// or storage; the only file written is --out. A live edition that FAILS here is a finding: either the check is wrong, or the form has a latent defect.
//   node src/scripts/evaluateArtifactCertification.js [--forms I-131,I-765] [--components] [--non-latin] [--out report.json]
const fs = require("fs");

async function main(argv) {
  const get = (flag) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : null; };
  const mongoose = require("mongoose");
  await require("../config/database")();
  const { readOnlyDb } = require("./lib/readOnlyDb");
  const db = readOnlyDb(mongoose.connection.db);
  const MappingGraphService = require("../modules/form-mapping/services/MappingGraphService");
  const { probeEdition } = require("../modules/form-release/artifactCertification");
  const only = (get("--forms") || "").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
  const withComponents = argv.includes("--components");
  const heads = await db.collection("uscisformtemplates").find({ status: "active", ...(only.length ? { formCode: { $in: only } } : {}) }, { projection: { formCode: 1, version: 1 } }).sort({ formCode: 1 }).toArray();
  const rows = [];
  for (const head of heads) {
    const template = await db.collection("uscisformtemplates").findOne({ _id: head._id });
    const targets = [{ componentCode: null }];
    if (withComponents) {
      const defs = await db.collection("uscisformcomponentdefinitions").find({ parentTemplateId: template._id, status: "ACTIVE" }, { projection: { componentCode: 1 } }).toArray();
      defs.forEach((def) => targets.push({ componentCode: def.componentCode }));
    }
    for (const target of targets) {
      const row = { form: template.formCode, component: target.componentCode, version: template.version };
      const started = Date.now();
      try {
        const graph = await MappingGraphService.loadCurrentGraph(template);
        const result = await probeEdition(template, { graph, componentCode: target.componentCode, nonLatin: argv.includes("--non-latin") });
        row.data = { ok: result.data.ok, checked: result.data.checked, failures: result.data.failures.slice(0, 4), advisories: result.data.advisories.filter((a) => /NON_LATIN/.test(a.check)).slice(0, 1) };
        row.artifact = { ok: result.artifact.ok, failures: result.artifact.failures.slice(0, 4), stats: result.artifact.stats };
      } catch (error) {
        row.error = String(error.code || error.message).slice(0, 200);
      }
      row.seconds = Math.round((Date.now() - started) / 1000);
      rows.push(row);
      process.stderr.write(`${row.form}${row.component ? ` / ${row.component}` : ""}: ${row.error ? `ERROR ${row.error}` : `data ${row.data.ok ? "ok" : "FAIL"} (${row.data.checked} boxes), file ${row.artifact.ok ? "ok" : "FAIL"} (${row.seconds}s)`}\n`);
    }
  }
  const out = get("--out");
  if (out) fs.writeFileSync(out, JSON.stringify(rows, null, 1));
  const bad = rows.filter((row) => row.error || !row.data?.ok || !row.artifact?.ok);
  console.log(`probed ${rows.length}; with a finding: ${bad.length}`);
  for (const row of bad) console.log(JSON.stringify({ form: row.form, component: row.component, error: row.error, data: row.data?.failures, artifact: row.artifact?.failures }).slice(0, 700));
  await mongoose.disconnect();
  return 0;
}

if (require.main === module) main(process.argv.slice(2)).then((code) => process.exit(code)).catch((error) => { console.error("failed:", error.message); process.exit(1); });
module.exports = { main };
