// One-time (or deliberately-repeated) Phase 0 golden-fixture capture. Writes
// Backend/src/modules/form-generation/tests/golden/<visa>/snapshot.json for each visa in
// goldenHarness.VISA_KEYS by running the real, unmodified pipeline against a deterministic seed.
//
// This is NOT run automatically by `npm test` or `npm run phase0:verify` - those only READ the
// committed snapshot.json files and fail on drift. Re-run this script deliberately (and review
// the diff before committing) when a reviewed pipeline change is expected to change output -
// never to silently paper over an unexpected drift caught by phase0:verify.
//
// Usage: node src/scripts/phase0CaptureGolden.js [visaKey ...]   (default: all visas)
const fs = require("fs");
const path = require("path");

if (!process.env.MONGODB_TEST_URI) process.env.MONGODB_TEST_URI = "mongodb://localhost:27017/immigrationcrm_test";

const { captureGolden, VISA_KEYS } = require("../modules/form-generation/tests/phase0/goldenHarness");
const { disconnectTestDB } = require("../test-utils/db");

const GOLDEN_ROOT = path.resolve(__dirname, "..", "modules", "form-generation", "tests", "golden");

async function main() {
  const requested = process.argv.slice(2);
  const visaKeys = requested.length ? requested : VISA_KEYS;
  for (const visaKey of visaKeys) {
    if (!VISA_KEYS.includes(visaKey)) throw new Error(`Unknown visa key "${visaKey}" - expected one of: ${VISA_KEYS.join(", ")}`);
  }

  for (const visaKey of visaKeys) {
    process.stdout.write(`Capturing golden fixture for "${visaKey}"...\n`);
    const started = Date.now();
    const snapshot = await captureGolden(visaKey);
    const durationMs = Date.now() - started;
    const dir = path.join(GOLDEN_ROOT, visaKey);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "snapshot.json"), JSON.stringify(snapshot, null, 2) + "\n", "utf8");
    process.stdout.write(
      `  wrote ${path.relative(process.cwd(), path.join(dir, "snapshot.json"))} ` +
        `(${snapshot.counts.mappedPdfFields}/${snapshot.counts.templateFieldCount} fields mapped, ${durationMs}ms)\n`
    );
  }
  await disconnectTestDB();
}

main().catch((error) => {
  console.error("Phase 0 golden capture failed:", error);
  process.exitCode = 1;
});
