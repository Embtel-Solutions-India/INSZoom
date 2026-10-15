#!/usr/bin/env node
// Release 0b-1: creates the indexes of the three form-edition-policy collections - above all the UNIQUE index that makes "exactly one decision row
// per { formCode, editionIdentifier }" a database guarantee, and the unique { evidenceCaseId, seq } on the audit trail.
//
// THIS IS A DATABASE CHANGE and needs its own approval. The application runs with autoIndex off, so these indexes are NOT created automatically.
// Until it is run, the evidence service still keeps one row per edition by serializing writes per edition and checking for an existing row first
// (see EvidenceService / EditionPolicyStore), but only the unique index protects against two backend processes racing.
//
//   node src/scripts/createFormEditionPolicyIndexes.js            # DRY RUN: prints what would be created, touches nothing, does not connect
//   node src/scripts/createFormEditionPolicyIndexes.js --apply    # connects and creates the indexes (creates the collections if they do not exist)
//
// Safe to repeat: createIndexes is a no-op for an index that already exists.

const MODELS = ["FormEditionSource", "FormEditionDecision", "FormEditionAuditEvent"];

function plan() {
  return MODELS.map((name) => {
    const model = require(`../models/${name}`);
    return { model: name, collection: model.collection.name, indexes: model.schema.indexes().map(([fields, options]) => ({ fields, options })) };
  });
}

async function main(argv = process.argv.slice(2)) {
  const apply = argv.includes("--apply");
  const description = plan();
  for (const item of description) {
    console.log(`${item.model} (${item.collection})`);
    item.indexes.forEach((index) => console.log(`  ${JSON.stringify(index.fields)} ${JSON.stringify(index.options)}`));
  }
  if (!apply) {
    console.log("\nDRY RUN: nothing was created. Run with --apply (after approval) to create these indexes.");
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
