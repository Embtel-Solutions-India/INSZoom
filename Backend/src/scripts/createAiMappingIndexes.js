#!/usr/bin/env node
// Phase 4: creates the indexes of the AI-mapping collections. The application runs with autoIndex off, so they are NOT created automatically.
//   AiMappingGateRecord        the accuracy-gate history (newest first)
//   FormAiMappingSuggestion    the shadow-mode suggestion store, when that model exists (declared by the Gemini engine, form-ai-mapping/)
//
//   node src/scripts/createAiMappingIndexes.js            # DRY RUN: prints what would be created, does not connect
//   node src/scripts/createAiMappingIndexes.js --apply    # connects and creates them (creates the collections if they do not exist)
// Index-only, safe to repeat; no document is read or written.
const MODELS = ["AiMappingGateRecord", "FormAiMappingSuggestion"];

function load(name) {
  try {
    return require(`../models/${name}`);
  } catch (error) {
    if (error.code === "MODULE_NOT_FOUND" && String(error.message).includes(`models/${name}`)) return null; // the model does not exist (yet)
    throw error;
  }
}

function plan() {
  return MODELS.map((name) => {
    const model = load(name);
    return model ? { model: name, collection: model.collection.name, indexes: model.schema.indexes().map(([fields, options]) => ({ fields, options })) } : { model: name, missing: true, indexes: [] };
  });
}

async function main(argv = process.argv.slice(2)) {
  const apply = argv.includes("--apply");
  for (const item of plan()) {
    console.log(item.missing ? `${item.model}: model not found - skipped` : `${item.model} (${item.collection})`);
    item.indexes.forEach((index) => console.log(`  ${JSON.stringify(index.fields)} ${JSON.stringify(index.options)}`));
  }
  if (!apply) { console.log("\nDRY RUN: nothing was created. Run with --apply."); return 0; }
  require("dotenv").config();
  const mongoose = require("mongoose");
  const env = require("../config/env");
  await mongoose.connect(env.mongoUri || process.env.MONGODB_URI, { autoIndex: false, autoCreate: false, serverSelectionTimeoutMS: 15000 });
  try {
    for (const name of MODELS) {
      const model = load(name);
      if (!model) continue;
      await model.createIndexes();
      console.log(`created / confirmed indexes for ${name}`);
    }
  } finally {
    await mongoose.disconnect();
  }
  return 0;
}

if (require.main === module) main().then((code) => process.exit(code), (error) => { console.error("failed:", error.stack || error.message); process.exit(1); });

module.exports = { plan, MODELS };
