#!/usr/bin/env node
// Builds the draft golden set from the LIVE mappings and writes it into the repository (READ-ONLY toward the database: it reads active mapping versions through the
// read-only handle and writes only two files).
//   node src/scripts/buildGoldenSetDraft.js            # writes modules/form-mapping/golden/goldenSet.draft.json and docs/golden-set/GOLDEN_SET_DRAFT.csv
//   node src/scripts/buildGoldenSetDraft.js --print    # only prints the summary
const fs = require("fs");
const path = require("path");
const { buildDraft, SCOPE } = require("../modules/form-mapping/golden/buildDraft");
const { toCsv } = require("../modules/form-mapping/golden/exportCsv");

const DRAFT_FILE = path.join(__dirname, "..", "modules", "form-mapping", "golden", "goldenSet.draft.json");
const CSV_FILE = path.join(__dirname, "..", "..", "..", "docs", "golden-set", "GOLDEN_SET_DRAFT.csv");

async function main(argv = process.argv.slice(2)) {
  require("dotenv").config();
  const mongoose = require("mongoose");
  const env = require("../config/env");
  const { readOnlyDb } = require("./lib/readOnlyDb");
  await mongoose.connect(env.mongoUri || process.env.MONGODB_URI, { autoIndex: false, autoCreate: false, serverSelectionTimeoutMS: 15000 });
  try {
    const db = readOnlyDb(mongoose.connection.db);
    const graphsByForm = {};
    for (const formCode of Object.keys(SCOPE)) {
      const template = await db.collection("uscisformtemplates").findOne({ formCode, status: "active" }, { projection: { _id: 1 } });
      const version = template && await db.collection("uscismappingversions").findOne({ template: template._id, status: "active" }, { sort: { mappingVersion: -1 }, projection: { "graph.edges": 1 } });
      graphsByForm[formCode] = version?.graph?.edges || [];
    }
    const draft = buildDraft(graphsByForm);
    console.log(JSON.stringify({ total: draft.summary.total, byForm: draft.summary.byForm, byKind: draft.summary.byKind, byFamily: draft.summary.byFamily, meetsPlan: draft.meetsPlan }, null, 1));
    if (argv.includes("--print")) return 0;
    fs.mkdirSync(path.dirname(CSV_FILE), { recursive: true });
    fs.writeFileSync(DRAFT_FILE, `${JSON.stringify(draft, null, 2)}\n`);
    fs.writeFileSync(CSV_FILE, `﻿${toCsv(draft.entries)}`);
    console.log(`written: ${path.relative(process.cwd(), DRAFT_FILE)} and ${path.relative(process.cwd(), CSV_FILE)}`);
    return 0;
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) main().then((code) => process.exit(code), (error) => { console.error("failed:", error.stack || error.message); process.exit(1); });

module.exports = { main, DRAFT_FILE, CSV_FILE };
