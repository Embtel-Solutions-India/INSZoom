// Explicit, one-time index sync — the controlled replacement for mongoose's
// default autoIndex:true behavior (see docs/MONGODB_STARTUP_LOAD_FINDINGS.md:
// autoIndex fired ~277 concurrent createIndexes commands, one per declared
// index across all 74 models, on EVERY process boot, entirely independent of
// any real traffic, and was the dominant source of the startup MongoDB
// connection-pool contention).
//
// Run this after any deploy that adds/changes a model's .index() declarations
// (including this session's new models: EmailTemplate, SavedCharge, Branch,
// Team). It is idempotent — Model.syncIndexes() only creates/drops what
// actually differs from what's already on the collection, so a repeat run
// with no schema changes is a fast no-op.
//
//   node src/scripts/syncIndexes.js
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
const env = require("../config/env");

async function main() {
  await mongoose.connect(env.mongoUri, { maxPoolSize: 10 });
  const modelsDir = path.join(__dirname, "../models");
  const modelNames = [];
  for (const file of fs.readdirSync(modelsDir)) {
    if (!file.endsWith(".js")) continue;
    const model = require(path.join(modelsDir, file));
    if (model?.modelName) modelNames.push(model.modelName);
  }

  const results = [];
  for (const name of modelNames) {
    const Model = mongoose.model(name);
    try {
      const created = await Model.syncIndexes();
      results.push({ model: name, collection: Model.collection.name, changed: created });
    } catch (error) {
      results.push({ model: name, collection: Model.collection.name, error: error.message });
    }
  }

  const changed = results.filter((r) => r.changed && r.changed.length);
  const failed = results.filter((r) => r.error);
  console.log(`Synced ${results.length} models.`);
  if (changed.length) {
    console.log(`Indexes changed on ${changed.length} model(s):`);
    changed.forEach((r) => console.log(`  ${r.model} (${r.collection}): ${r.changed.join(", ")}`));
  } else {
    console.log("No index changes needed — every model already matched its schema.");
  }
  if (failed.length) {
    console.log(`${failed.length} model(s) failed to sync:`);
    failed.forEach((r) => console.log(`  ${r.model}: ${r.error}`));
  }

  await mongoose.disconnect();
  process.exit(failed.length ? 1 : 0);
}

main().catch((error) => {
  console.error("syncIndexes failed:", error.message);
  process.exit(1);
});
