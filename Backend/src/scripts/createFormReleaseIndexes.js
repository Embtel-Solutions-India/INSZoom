#!/usr/bin/env node
// Phase 3: creates the indexes the case-migration safety needs. The application runs with autoIndex off, so they are NOT created automatically.
//   CaseFormMigrationSnapshot  all of its indexes, above all the TTL index on expiresAt that removes a pre-image 90 days after a VERIFIED migration (a snapshot with no expiresAt -
//                              unresolved, failed, waiting for reconciliation, legal hold - is never touched by it)
//   caseforms                  ONLY { "migrationState.step": 1 } (sparse), which the reconciliation sweeper uses - not every index the CaseForm schema declares
//
//   node src/scripts/createFormReleaseIndexes.js            # DRY RUN: prints what would be created, does not connect
//   node src/scripts/createFormReleaseIndexes.js --apply    # connects and creates them (creates the snapshot collection if it does not exist)
// Index-only, safe to repeat; no document is read or written.
const CASEFORM_INDEX = { keys: { "migrationState.step": 1 }, options: { sparse: true, name: "migrationState.step_1" } };

function plan() {
  const snapshot = require("../models/CaseFormMigrationSnapshot");
  return {
    snapshot: { collection: snapshot.collection.name, indexes: snapshot.schema.indexes().map(([fields, options]) => ({ fields, options })) },
    caseForm: { collection: "caseforms", indexes: [{ fields: CASEFORM_INDEX.keys, options: CASEFORM_INDEX.options }] },
  };
}

async function main(argv = process.argv.slice(2)) {
  const apply = argv.includes("--apply");
  const { snapshot, caseForm } = plan();
  for (const item of [snapshot, caseForm]) {
    console.log(item.collection);
    item.indexes.forEach((index) => console.log(`  ${JSON.stringify(index.fields)} ${JSON.stringify(index.options)}`));
  }
  if (!apply) { console.log("\nDRY RUN: nothing was created. Run with --apply."); return 0; }
  require("dotenv").config();
  const mongoose = require("mongoose");
  const env = require("../config/env");
  await mongoose.connect(env.mongoUri || process.env.MONGODB_URI, { autoIndex: false, autoCreate: false, serverSelectionTimeoutMS: 15000 });
  try {
    await require("../models/CaseFormMigrationSnapshot").createIndexes();
    console.log("created / confirmed the CaseFormMigrationSnapshot indexes");
    await mongoose.connection.db.collection("caseforms").createIndex(CASEFORM_INDEX.keys, CASEFORM_INDEX.options);
    console.log("created / confirmed caseforms { migrationState.step: 1 } (sparse)");
  } finally {
    await mongoose.disconnect();
  }
  return 0;
}

if (require.main === module) main().then((code) => process.exit(code), (error) => { console.error("failed:", error.stack || error.message); process.exit(1); });

module.exports = { plan, CASEFORM_INDEX };
