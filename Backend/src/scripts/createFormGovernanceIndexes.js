#!/usr/bin/env node
// Phase 5: creates the indexes the governance screens need. The application runs with autoIndex off, so they are NOT created automatically.
//   FormPipelineRunSummary  { kind, startedAt desc } and a TTL on expireAt (a run summary is kept 90 days)
//   FormMigrationReport     { caseFormId, reportedAt desc }, { kind, reportedAt desc }, { formCode, reportedAt desc } and a SPARSE TTL on expireAt (only outcome rows and RESOLVED
//                           frozen rows carry expireAt: an unresolved frozen case form never expires)
//
//   node src/scripts/createFormGovernanceIndexes.js            # DRY RUN: prints what would be created, does not connect
//   node src/scripts/createFormGovernanceIndexes.js --apply    # connects and creates them (creates the collections if they do not exist)
// Index-only, safe to repeat; no document is read or written.
function plan() {
  return ["../models/FormPipelineRunSummary", "../models/FormMigrationReport"].map((file) => {
    const model = require(file);
    return { model, collection: model.collection.name, indexes: model.schema.indexes().map(([fields, options]) => ({ fields, options })) };
  });
}

async function main(argv = process.argv.slice(2)) {
  const apply = argv.includes("--apply");
  const items = plan();
  for (const item of items) {
    console.log(item.collection);
    item.indexes.forEach((index) => console.log(`  ${JSON.stringify(index.fields)} ${JSON.stringify(index.options)}`));
  }
  if (!apply) { console.log("\nDRY RUN: nothing was created. Run with --apply."); return 0; }
  require("dotenv").config();
  const mongoose = require("mongoose");
  const env = require("../config/env");
  await mongoose.connect(env.mongoUri || process.env.MONGODB_URI, { autoIndex: false, autoCreate: false, serverSelectionTimeoutMS: 15000 });
  try {
    for (const item of items) {
      await item.model.createIndexes();
      console.log(`created / confirmed the ${item.collection} indexes`);
    }
  } finally {
    await mongoose.disconnect();
  }
  return 0;
}

if (require.main === module) main().then((code) => process.exit(code), (error) => { console.error("failed:", error.stack || error.message); process.exit(1); });

module.exports = { plan };
