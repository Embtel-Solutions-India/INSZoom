#!/usr/bin/env node
// Phase 1: creates the indexes of the FormPipelineJob collection - above all the PARTIAL UNIQUE index that makes "one open job per form" a database guarantee,
// the claim-query indexes and the TTL index that removes finished jobs. The application runs with autoIndex off, so these are NOT created automatically.
// Until this is run the job service still keeps one open job per form by checking before it inserts, but only the unique index protects two processes racing.
//
//   node src/scripts/createFormPipelineIndexes.js            # DRY RUN: prints what would be created, does not connect
//   node src/scripts/createFormPipelineIndexes.js --apply    # connects and creates the indexes (creates the collection if it does not exist)
// Safe to repeat.

// Phase 5E adds FormPipelineDigest (the digest window of the developer e-mails: one OPEN window per key, finished ones expire after 30 days)
const MODELS = ["FormPipelineJob", "FormPipelineDigest"];

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
  if (!apply) {
    console.log("\nDRY RUN: nothing was created. Run with --apply to create these indexes.");
    return 0;
  }
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

module.exports = { plan, main, MODELS };

if (require.main === module) {
  main().then((code) => process.exit(code)).catch((error) => { console.error(`index creation failed: ${error.message}`); process.exit(1); });
}
