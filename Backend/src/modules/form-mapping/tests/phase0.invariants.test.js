// Phase 0 safety-net invariants for the crosswalk/mapping layer. Additive-only tripwires for the
// USCIS-forms re-architecture: they characterize and guard existing behavior (fan-out shape,
// reviewed-field protection, exactly-one-active-mapping-version, non-destructive seeds), they do
// not change any pipeline file. See docs/forms/PHASE0_BASELINE.md for the narrative.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { connectTestDB, disconnectTestDB } = require("../../../test-utils/db");
const AutoFillService = require("../services/AutoFillService");
const USCISMappingVersion = require("../../../models/USCISMappingVersion");
const i129h1bCrosswalk = require("../config/i129-h1b-crosswalk");
const i129fK1Crosswalk = require("../config/i129f-k1-crosswalk");
const i130K3Crosswalk = require("../config/i130-k3-crosswalk");

function fanOutSources(edges) {
  const bySource = new Map();
  for (const edge of edges) {
    if (!bySource.has(edge.source)) bySource.set(edge.source, 0);
    bySource.set(edge.source, bySource.get(edge.source) + 1);
  }
  return {
    totalEdges: edges.length,
    distinctSources: bySource.size,
    fanOutSourceCount: [...bySource.values()].filter((count) => count > 1).length,
  };
}

// Baseline captured in docs/forms/PHASE0_BASELINE.md §5 by loading each crosswalk module and
// grouping MAPPED_EDGES by `source`. A change to any of these numbers means the crosswalk shape
// changed - which may be entirely intentional (a reviewed crosswalk edit), but it must be a
// deliberate update to this test + the baseline doc, not a silent drift.
const FAN_OUT_BASELINE = {
  "i129-h1b-crosswalk (H-1B + L-1A/L-1B)": { module: i129h1bCrosswalk, totalEdges: 101, distinctSources: 68, fanOutSourceCount: 15 },
  "i129f-k1-crosswalk": { module: i129fK1Crosswalk, totalEdges: 34, distinctSources: 26, fanOutSourceCount: 4 },
  "i130-k3-crosswalk": { module: i130K3Crosswalk, totalEdges: 33, distinctSources: 25, fanOutSourceCount: 4 },
};

for (const [name, baseline] of Object.entries(FAN_OUT_BASELINE)) {
  test(`Phase 0 invariant: ${name} fan-out shape matches the recorded baseline`, () => {
    const actual = fanOutSources(baseline.module.MAPPED_EDGES);
    assert.equal(actual.totalEdges, baseline.totalEdges, `${name}: total mapped edges drifted from baseline`);
    assert.equal(actual.distinctSources, baseline.distinctSources, `${name}: distinct canonical sources drifted from baseline`);
    assert.equal(actual.fanOutSourceCount, baseline.fanOutSourceCount, `${name}: number of one-source-to-many-pdfFields sources drifted from baseline`);
  });
}

// AutoFillService.isReviewedOrManual (AutoFillService.js:109-116) is the sole gate protecting a
// case manager's or attorney's manual work from being clobbered by a fresh auto-fill merge. This
// test pins down every state it must treat as protected, one at a time, so a future refactor that
// narrows the check (e.g. drops "edited" or "case_manager_verified") fails loudly here instead of
// silently overwriting real user work in production.
test("Phase 0 invariant: isReviewedOrManual protects every currently-recognized reviewed/manual state", () => {
  const baseCaseForm = () => ({ manualOverrides: {}, fieldReviews: {}, sourceAttribution: {} });

  const withManualOverride = baseCaseForm();
  withManualOverride.manualOverrides.f1 = { value: "x" };
  assert.equal(AutoFillService.isReviewedOrManual(withManualOverride, "f1"), true, "a manualOverrides entry must protect the field");

  for (const status of ["approved", "edited"]) {
    const cf = baseCaseForm();
    cf.fieldReviews.f1 = { status };
    assert.equal(AutoFillService.isReviewedOrManual(cf, "f1"), true, `fieldReviews.status="${status}" must protect the field`);
  }

  for (const validationStatus of ["manual_override", "approved", "attorney_verified", "case_manager_verified"]) {
    const cf = baseCaseForm();
    cf.sourceAttribution.f1 = { validationStatus };
    assert.equal(AutoFillService.isReviewedOrManual(cf, "f1"), true, `sourceAttribution.validationStatus="${validationStatus}" must protect the field`);

    const cf2 = baseCaseForm();
    cf2.sourceAttribution.f1 = { verificationStatus: validationStatus };
    assert.equal(AutoFillService.isReviewedOrManual(cf2, "f1"), true, `sourceAttribution.verificationStatus="${validationStatus}" must protect the field`);
  }

  const untouched = baseCaseForm();
  untouched.sourceAttribution.f1 = { validationStatus: "auto_filled" };
  assert.equal(AutoFillService.isReviewedOrManual(untouched, "f1"), false, "a plain auto_filled field must NOT be protected (or re-autofill would never update anything)");

  const missing = baseCaseForm();
  assert.equal(AutoFillService.isReviewedOrManual(missing, "unknown_field"), false, "a field with no history at all must not be protected");
});

test("Phase 0 invariant: exactly one active USCISMappingVersion per template in the current DB state", async (t) => {
  await connectTestDB();
  t.after(disconnectTestDB);
  const activeVersions = await USCISMappingVersion.aggregate([
    { $match: { status: "active" } },
    { $group: { _id: "$template", count: { $sum: 1 } } },
    { $match: { count: { $gt: 1 } } },
  ]);
  assert.deepEqual(
    activeVersions,
    [],
    "found a template with more than one USCISMappingVersion in status:'active' - " +
      "MappingGraphService.activate() (form-mapping/services/MappingGraphService.js:544-575) is " +
      "supposed to retire every other active version for a template before activating a new one, " +
      "non-transactionally. This invariant characterizes the current DB as consistent; if it ever " +
      "fails, treat it as evidence of the exact race documented in docs/forms/PHASE0_BASELINE.md §6, " +
      "not something to silently clean up."
  );
});

// Non-destructiveness of master-data seeds is enforced today by convention (idempotent findOne
// checks) rather than by any runtime guard, other than test-utils/db.js's PROTECTED_COLLECTIONS
// list refusing to let *tests* wipe these collections. This static source scan is the Phase 0
// tripwire for the seed scripts themselves: it fails if a future edit adds a bulk-delete call
// against a protected master-data collection inside any of these seed files.
const PROTECTED_MODEL_NAMES = ["USCISFormTemplate", "USCISMappingVersion", "Questionnaire", "Question", "PackageDefinition"];

const SEED_FILES = [
  "../../uscis-form-import/seeds/i129.seed.js",
  "../../uscis-form-import/seeds/i129f.seed.js",
  "../../uscis-form-import/seeds/i130.seed.js",
  "../../uscis-form-import/seeds/i134.seed.js",
  "../../uscis-form-import/seeds/i539.seed.js",
  "../../uscis-form-import/seeds/i539a.seed.js",
  "../../uscis-form-import/seeds/i907.seed.js",
  "../seeds/i129-h1b-mapping.seed.js",
  "../seeds/i129f-k1-mapping.seed.js",
  "../seeds/i130-k3-mapping.seed.js",
].map((relative) => path.resolve(__dirname, relative));

for (const seedFile of SEED_FILES) {
  test(`Phase 0 invariant: ${path.relative(process.cwd(), seedFile)} contains no bulk-delete call against a protected master-data model`, () => {
    assert.ok(fs.existsSync(seedFile), `expected seed file to exist at ${seedFile}`);
    const source = fs.readFileSync(seedFile, "utf8");
    for (const modelName of PROTECTED_MODEL_NAMES) {
      const modelUsagePattern = new RegExp(`${modelName}\\s*\\.(deleteMany|deleteOne|remove|drop|findOneAndDelete)\\s*\\(`);
      assert.doesNotMatch(source, modelUsagePattern, `${seedFile} must not bulk-delete against protected model ${modelName}`);
    }
  });
}
