require("dotenv").config();

const mongoose = require("mongoose");
const Case = require("../models/Case");
const Client = require("../models/Client");
const Payment = require("../models/Payment");
const { PACKAGE_NAMES, normalizePackageName } = require("../config/packages");

const PREMIUM_PROCESSING_ADDON_KEY = "premium_processing_i907";

async function connect() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI || "mongodb://127.0.0.1:27017/immigration_crm";
  await mongoose.connect(uri);
}

function assignIfNormalized($set, path, value, { allowAddon = false } = {}) {
  if (!value || PACKAGE_NAMES.includes(value)) return false;
  if (allowAddon && value === PREMIUM_PROCESSING_ADDON_KEY) return false;
  const normalized = normalizePackageName(value);
  if (!normalized) return false;
  $set[path] = normalized;
  return true;
}

async function migrateModel(Model, name, buildUpdate) {
  let scanned = 0;
  let updated = 0;
  let unresolved = 0;
  const cursor = Model.find({}).lean().cursor();

  for await (const doc of cursor) {
    scanned += 1;
    const { $set, unresolvedFields } = buildUpdate(doc);
    if (unresolvedFields.length) {
      unresolved += 1;
      console.warn(`${name} ${doc._id} has unrecognized package values: ${unresolvedFields.join(", ")}`);
    }
    if (Object.keys($set).length) {
      await Model.collection.updateOne({ _id: doc._id }, { $set });
      updated += 1;
    }
  }

  return { name, scanned, updated, unresolved };
}

function unresolvedValue(label, value, { allowAddon = false } = {}) {
  if (!value || PACKAGE_NAMES.includes(value)) return "";
  if (allowAddon && value === PREMIUM_PROCESSING_ADDON_KEY) return "";
  return normalizePackageName(value) ? "" : `${label}=${value}`;
}

async function run() {
  await connect();

  const results = [];
  results.push(await migrateModel(Case, "Case", (doc) => {
    const $set = {};
    assignIfNormalized($set, "package", doc.package);
    assignIfNormalized($set, "primaryPackage", doc.primaryPackage);
    assignIfNormalized($set, "plan.tier", doc.plan?.tier);
    return {
      $set,
      unresolvedFields: [
        unresolvedValue("package", doc.package),
        unresolvedValue("primaryPackage", doc.primaryPackage),
        unresolvedValue("plan.tier", doc.plan?.tier),
      ].filter(Boolean),
    };
  }));

  results.push(await migrateModel(Client, "Client", (doc) => {
    const $set = {};
    assignIfNormalized($set, "selectedPlan", doc.selectedPlan);
    return {
      $set,
      unresolvedFields: [unresolvedValue("selectedPlan", doc.selectedPlan)].filter(Boolean),
    };
  }));

  results.push(await migrateModel(Payment, "Payment", (doc) => {
    const $set = {};
    assignIfNormalized($set, "package", doc.package, { allowAddon: true });
    assignIfNormalized($set, "packageKey", doc.packageKey, { allowAddon: true });
    assignIfNormalized($set, "packageName", doc.packageName, { allowAddon: true });
    return {
      $set,
      unresolvedFields: [
        unresolvedValue("package", doc.package, { allowAddon: true }),
        unresolvedValue("packageKey", doc.packageKey, { allowAddon: true }),
        unresolvedValue("packageName", doc.packageName, { allowAddon: true }),
      ].filter(Boolean),
    };
  }));

  results.forEach((result) => {
    console.log(`${result.name}: scanned=${result.scanned} updated=${result.updated} unresolved=${result.unresolved}`);
  });
}

if (require.main === module) {
  run()
    .then(() => mongoose.disconnect())
    .then(() => process.exit(0))
    .catch(async (error) => {
      console.error("Failed to migrate package names:", error);
      await mongoose.disconnect().catch(() => {});
      process.exit(1);
    });
}

module.exports = run;
