// Idempotent loader: upserts every seed record by its natural key
// (visaType+formNumber+componentType), never duplicates. Run via:
//   node src/modules/form-registry/seeds/loadVisaFormMappings.js
require("dotenv").config();
const mongoose = require("mongoose");

async function run() {
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGODB_TEST_URI);
  const VisaFormMapping = require("../../../models/VisaFormMapping");
  const { mappings } = require("./visaFormMappings.seed");

  let created = 0;
  let updated = 0;
  const errors = [];
  for (const mapping of mappings) {
    try {
      const result = await VisaFormMapping.findOneAndUpdate(
        { visaType: mapping.visaType, formNumber: mapping.formNumber, componentType: mapping.componentType },
        { $set: mapping },
        { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true, rawResult: true }
      );
      if (result.lastErrorObject?.updatedExisting) updated += 1;
      else created += 1;
    } catch (error) {
      errors.push({ visaType: mapping.visaType, formNumber: mapping.formNumber, componentType: mapping.componentType, error: error.message });
    }
  }
  console.log(`Seed complete: ${created} created, ${updated} updated, ${errors.length} errors out of ${mappings.length} total records.`);
  if (errors.length) {
    console.log("ERRORS:");
    errors.forEach((e) => console.log(`  ${e.visaType} -> ${e.formNumber} (${e.componentType}): ${e.error}`));
  }
  await mongoose.disconnect();
  if (errors.length) process.exit(1);
}

if (require.main === module) {
  run().catch((error) => {
    console.error("SEED SCRIPT FAILED:", error);
    process.exit(1);
  });
}

module.exports = { run };
