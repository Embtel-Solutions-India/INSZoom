#!/usr/bin/env node
// Phase 2: classifies every form field `defaultValue` of the LIVE (active) templates and compares it with the committed snapshot
// (modules/form-mapping/config/defaultValueSnapshot.json). READ-ONLY: it reads templates through the read-only database handle and writes nothing to the database.
//
//   node src/scripts/defaultValueReport.js            # compare the live data with the snapshot (exit 1 when they differ)
//   node src/scripts/defaultValueReport.js --write    # (re)write the snapshot file in the repository from the live data
//
// Why: defaults are used by autofill when a field has no mapping (MappingResolver / FormMappingService). Behavior is preserved as it is today; the snapshot makes any
// CHANGE visible (a new default, a removed one, a different category) and the classifier flags defaults that look like a person's data.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { classifyDefault, CATEGORIES, FLAGGED } = require("../modules/form-mapping/contract/defaultValueClassifier");

const SNAPSHOT_FILE = path.join(__dirname, "..", "modules", "form-mapping", "config", "defaultValueSnapshot.json");

const valueKey = (value) => crypto.createHash("sha256").update(JSON.stringify(value ?? null)).digest("hex").slice(0, 10);

/** Pure. templates: [{ formCode, formFields: [...] }] (active ones). Returns the snapshot object. */
function buildSnapshot(templates) {
  const perForm = {};
  const totals = Object.fromEntries(CATEGORIES.map((name) => [name, 0]));
  const lines = [];
  const flagged = [];
  for (const template of [...templates].sort((a, b) => String(a.formCode).localeCompare(String(b.formCode)))) {
    const counts = Object.fromEntries(CATEGORIES.map((name) => [name, 0]));
    for (const field of template.formFields || []) {
      const category = classifyDefault(field);
      if (!category) continue;
      counts[category] += 1;
      totals[category] += 1;
      const id = field.fieldId || field.id || field.fieldName;
      lines.push(`${template.formCode}|${id}|${category}|${valueKey(field.defaultValue)}`);
      if (FLAGGED.includes(category)) flagged.push(`${template.formCode}|${id}|${category}`);
    }
    perForm[template.formCode] = counts;
  }
  lines.sort();
  return {
    version: 1,
    note: "Classification of form-field defaultValue for the live templates. Autofill behavior is unchanged; a change here is a visible, reviewed event.",
    templates: templates.length,
    fieldsWithDefault: lines.length,
    totals,
    perForm,
    flagged: flagged.sort(),
    contentHash: crypto.createHash("sha256").update(lines.join("\n")).digest("hex"),
  };
}

/** Pure. { same, differences[] } between a committed snapshot and a freshly built one. */
function compareSnapshots(committed, live) {
  const differences = [];
  if (committed.contentHash === live.contentHash) return { same: true, differences };
  for (const name of CATEGORIES) {
    if (committed.totals?.[name] !== live.totals?.[name]) differences.push(`total ${name}: snapshot ${committed.totals?.[name]} -> live ${live.totals?.[name]}`);
  }
  const forms = new Set([...Object.keys(committed.perForm || {}), ...Object.keys(live.perForm || {})]);
  for (const form of forms) {
    if (JSON.stringify(committed.perForm?.[form]) !== JSON.stringify(live.perForm?.[form])) differences.push(`form ${form}: ${committed.perForm?.[form] ? "counts changed" : "new form"}${live.perForm?.[form] ? "" : " (gone)"}`);
  }
  const added = (live.flagged || []).filter((item) => !(committed.flagged || []).includes(item));
  if (added.length) differences.push(`newly flagged defaults: ${added.slice(0, 10).join(", ")}${added.length > 10 ? " ..." : ""}`);
  if (!differences.length) differences.push("the same counts, but at least one default value or field changed (content hash differs)");
  return { same: false, differences };
}

async function main(argv = process.argv.slice(2)) {
  require("dotenv").config();
  const mongoose = require("mongoose");
  const env = require("../config/env");
  const { readOnlyDb } = require("./lib/readOnlyDb");
  await mongoose.connect(env.mongoUri || process.env.MONGODB_URI, { autoIndex: false, autoCreate: false, serverSelectionTimeoutMS: 15000 });
  try {
    const db = readOnlyDb(mongoose.connection.db);
    const templates = await db.collection("uscisformtemplates")
      .find({ status: "active" }, { projection: { formCode: 1, "formFields.fieldId": 1, "formFields.id": 1, "formFields.fieldName": 1, "formFields.pdfFieldName": 1, "formFields.fieldType": 1, "formFields.type": 1, "formFields.semanticType": 1, "formFields.defaultValue": 1 } })
      .toArray();
    const live = buildSnapshot(templates);
    if (argv.includes("--write")) {
      fs.writeFileSync(SNAPSHOT_FILE, `${JSON.stringify(live, null, 2)}\n`);
      console.log(`snapshot written: ${live.fieldsWithDefault} defaults in ${live.templates} live templates -> ${path.relative(process.cwd(), SNAPSHOT_FILE)}`);
      console.log(JSON.stringify(live.totals));
      return 0;
    }
    const committed = JSON.parse(fs.readFileSync(SNAPSHOT_FILE, "utf8"));
    const result = compareSnapshots(committed, live);
    console.log(result.same ? `no drift: ${live.fieldsWithDefault} defaults match the committed snapshot` : `DRIFT:\n- ${result.differences.join("\n- ")}`);
    return result.same ? 0 : 1;
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) main().then((code) => process.exit(code), (error) => { console.error("failed:", error.message); process.exit(1); });

module.exports = { buildSnapshot, compareSnapshots, SNAPSHOT_FILE };
