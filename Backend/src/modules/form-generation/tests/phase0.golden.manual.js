// Phase 0 golden-fixture drift detection. Re-runs the real, unmodified pipeline (via
// tests/phase0/goldenHarness.js) for H-1B, L-1A, and K-3 (I-130 family form) and compares against
// the committed snapshot.json files under tests/golden/<visa>/. A failure here means the pipeline's
// OUTPUT changed since the baseline was captured - not necessarily a regression (a Phase 1+ fix is
// expected to change output deliberately), but it must never pass silently: re-run
// `node src/scripts/phase0CaptureGolden.js <visa>`, review the diff by hand, and recapture only
// after confirming the change is the intended one.
//
// Named *.manual.js (not *.test.js), matching this codebase's existing convention for DB-heavy
// files that must NOT be swept into the default `npm test` glob (see e.g.
// document-intelligence/tests/ac9-live-smoke.manual.js): confirmed empirically that running this
// alongside 100+ other concurrently-executing test files hits a pre-existing test-infra
// fragility in Backend/src/test-utils/db.js (a single shared mongoose default connection, with
// each file's own connect/disconnect racing every other file's) that intermittently produces
// "Not authorized to answer this questionnaire" - not a pipeline defect, and not unique to this
// file (h1b-golden-path.test.js's own comments already document the same class of collision).
// Run explicitly via `npm run test:phase0-golden`, or in-process (no concurrent files, so this
// hazard doesn't apply) via `npm run phase0:verify`, which is what later phases actually gate on.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { captureGolden, VISA_KEYS } = require("./phase0/goldenHarness");
const { disconnectTestDB } = require("../../../test-utils/db");

const GOLDEN_ROOT = path.join(__dirname, "golden");

test.after(disconnectTestDB);

for (const visaKey of VISA_KEYS) {
  test(`Phase 0 golden fixture: ${visaKey} output matches the committed baseline`, async () => {
    const goldenPath = path.join(GOLDEN_ROOT, visaKey, "snapshot.json");
    assert.ok(
      fs.existsSync(goldenPath),
      `no committed golden fixture for "${visaKey}" - run: node src/scripts/phase0CaptureGolden.js ${visaKey}`
    );
    const golden = JSON.parse(fs.readFileSync(goldenPath, "utf8"));
    const current = await captureGolden(visaKey);

    assert.equal(current.formCode, golden.formCode, `${visaKey}: target formCode changed`);
    assert.equal(
      current.pdfFieldValuesHash,
      golden.pdfFieldValuesHash,
      `${visaKey}: the caseForm.filledData -> pdfField value map drifted from the committed baseline. ` +
        `If this is an intended change (e.g. a Phase 1+ mapping fix), recapture with ` +
        `\`node src/scripts/phase0CaptureGolden.js ${visaKey}\` and review the diff by hand before committing.`
    );
    assert.equal(
      current.pdfSnapshotHash,
      golden.pdfSnapshotHash,
      `${visaKey}: the actual generated PDF's AcroForm field state drifted from the committed baseline.`
    );
    assert.equal(current.counts.mappedPdfFields, golden.counts.mappedPdfFields, `${visaKey}: number of mapped PDF fields drifted`);
    assert.equal(current.counts.fillWarnings, golden.counts.fillWarnings, `${visaKey}: number of PDF render fill warnings drifted`);
  });
}
