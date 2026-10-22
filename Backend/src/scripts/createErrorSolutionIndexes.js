#!/usr/bin/env node
// Phase 7.E: creates the indexes of the ErrorSolution collection (what the error-resolution engine learned). The application runs with autoIndex off.
//   node src/scripts/createErrorSolutionIndexes.js            # DRY RUN: prints what would be created, does not connect
//   node src/scripts/createErrorSolutionIndexes.js --apply    # connects and creates them
// Index-only, safe to repeat; no document is read or written.
const MODELS = ["ErrorSolution"];

function plan() {
  return MODELS.map((name) => {
    const model = require(`../models/${name}`);
    return { model: name, collection: model.collection.name, indexes: model.schema.indexes().map(([fields, options]) => ({ fields, options })) };
  });
}

async function main(argv = process.argv.slice(2)) {
  const apply = argv.includes("--apply");
  for (const item of plan()) {
    console.log(`${item.model} (${item.collection})`);
    item.indexes.forEach((index) => console.log(`  ${JSON.stringify(index.fields)} ${JSON.stringify(index.options)}`));
  }
  if (!apply) { console.log("\nDRY RUN: nothing was created. Run with --apply."); return 0; }
  require("dotenv").config();
  const mongoose = require("mongoose");
  const env = require("../config/env");
  await mongoose.connect(env.mongoUri || process.env.MONGODB_URI, { autoIndex: false, autoCreate: false, serverSelectionTimeoutMS: 15000 });
  try {
    for (const name of MODELS) {
      await require(`../models/${name}`).createIndexes();
      console.log(`created / confirmed indexes for ${name}`);
    }
  } finally {
    await mongoose.disconnect();
  }
  return 0;
}

if (require.main === module) main().then((code) => process.exit(code), (error) => { console.error("failed:", error.stack || error.message); process.exit(1); });

module.exports = { plan, MODELS };
