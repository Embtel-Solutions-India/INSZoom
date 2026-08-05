// Phase H7 DB test harness. Deliberately separate from the app's own
// mongoose connection (env.mongoUri, which points at the real/shared
// database) - this suite gets its OWN connection to a dedicated test
// database (local by default; override via MONGODB_TEST_URI for CI or a
// non-local Mongo), so it can freely create/clear case-level test data
// without ever touching real data.
const mongoose = require("mongoose");

const TEST_URI = process.env.MONGODB_TEST_URI || "mongodb://localhost:27017/immigrationcrm_test";

// Master-data collections: questionnaire/form-template/mapping/package
// definitions. Per AGENTS.md/CANONICAL_WORKFLOW.md's master-data
// protection rule, these are never deleted/reset/truncated - only
// non-destructive versioned upserts are permitted, even in tests (the
// golden-path suite runs against real imported/mapped/seeded master data,
// not disposable fixtures, so accidentally wiping it here would silently
// invalidate every other test in the file).
const PROTECTED_COLLECTIONS = ["USCISFormTemplate", "USCISMappingVersion", "Questionnaire", "Question", "PackageDefinition"];

async function connectTestDB() {
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(TEST_URI);
  }
  return mongoose.connection;
}

async function disconnectTestDB() {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
}

// collections: array of Mongoose MODEL NAMES (e.g. "Case", "CaseForm"),
// not raw collection names - resolved via mongoose.model(name) so a typo
// throws immediately instead of silently no-op-ing against a nonexistent
// collection.
async function clearTestCollections(collections = []) {
  const protectedHit = collections.find((name) => PROTECTED_COLLECTIONS.includes(name));
  if (protectedHit) {
    throw new Error(`Refusing to clear "${protectedHit}" - it's a protected master-data collection (see PROTECTED_COLLECTIONS). Master data is never deleted, reset, or truncated, including in tests.`);
  }
  for (const name of collections) {
    const model = mongoose.model(name);
    await model.deleteMany({});
  }
}

module.exports = { connectTestDB, disconnectTestDB, clearTestCollections, PROTECTED_COLLECTIONS, TEST_URI };
