#!/usr/bin/env node
// Clears cached component viewer-slice pointers produced by an older
// ViewerPdfPreparationService recipe (e.g. the pre-fix recipe that dropped
// ~97% of widgets and the barcode). Non-destructive by design:
//   - never deletes a USCISFormComponentDefinition document,
//   - never touches pageRanges, fieldIds, or status,
//   - never deletes S3 objects (stale objects are simply no longer
//     referenced; the next viewer open re-slices with the current recipe).
// The recipe-version check in getComponentPdf already makes stale caches
// self-heal; this is the explicit one-command action for each environment.
//
// Usage:
//   node scripts/invalidateComponentSliceCache.js            # dry run (default)
//   node scripts/invalidateComponentSliceCache.js --apply
require("dotenv").config();
const mongoose = require("mongoose");

async function main() {
  const apply = process.argv.includes("--apply");
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGODB_TEST_URI);
  const USCISFormComponentDefinition = require("../src/models/USCISFormComponentDefinition");
  const { VIEWER_PDF_RECIPE_VERSION } = require("../src/modules/form-generation/services/ViewerPdfPreparationService");

  const filter = {
    slicedPdfStorageKey: { $ne: null },
    slicedPdfRecipeVersion: { $ne: VIEWER_PDF_RECIPE_VERSION },
  };
  const stale = await USCISFormComponentDefinition.find(filter)
    .select("_id componentCode parentTemplateId slicedPdfStorageKey slicedPdfRecipeVersion slicedPdfCachedAt")
    .lean();

  console.log(`Current viewer recipe version: ${VIEWER_PDF_RECIPE_VERSION}`);
  console.log(`Stale cached slices: ${stale.length}`);
  stale.forEach((doc) => {
    console.log(`  ${doc._id}  ${doc.componentCode}  recipe=${doc.slicedPdfRecipeVersion}  cachedAt=${doc.slicedPdfCachedAt?.toISOString?.() || doc.slicedPdfCachedAt}  key=${doc.slicedPdfStorageKey}`);
  });

  if (!apply) {
    console.log("\nDry run only - re-run with --apply to clear these cache pointers.");
  } else if (stale.length) {
    const result = await USCISFormComponentDefinition.updateMany(filter, {
      $set: {
        slicedPdfStorageKey: null,
        slicedPdfCachedAt: null,
        slicedPdfChecksum: null,
        slicedPdfRecipeVersion: null,
      },
    });
    console.log(`\nApplied: matched=${result.matchedCount} modified=${result.modifiedCount}`);
  } else {
    console.log("\nNothing to apply.");
  }
  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error("invalidateComponentSliceCache failed:", error.stack || error.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
