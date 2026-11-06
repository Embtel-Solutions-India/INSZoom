const assert = require("node:assert/strict");
const test = require("node:test");
const { summarizeCatalogSync } = require("../summaries");

// DB-free: the governance run summary of the scheduled catalog sync also counts the two DOL ETA-9089 forms (ExternalFormsSyncService), and is exactly as before without them.
const base = { published: 10, upgradesFound: 1, newFormsFound: 0, results: [{ outcome: "live" }, { outcome: "error" }], errors: [] };

test("without DOL results the summary is exactly what it always was", () => {
  assert.deepEqual(summarizeCatalogSync(base), { checked: 10, changed: 1, promoted: 1, held: 0, failed: 1 });
  assert.deepEqual(summarizeCatalogSync({}), { checked: 0, changed: 0, promoted: 0, held: 0, failed: 0 });
  assert.deepEqual(summarizeCatalogSync({ ...base, externalForms: [] }), summarizeCatalogSync(base));
});

test("DOL outcomes are counted: a new live version is checked + changed + promoted, an unreachable source is a failure, an identical re-issue changes nothing", () => {
  const out = summarizeCatalogSync({ ...base, externalForms: [{ formCode: "ETA-9089A", outcome: "new_version_live" }, { formCode: "ETA-9089FD", outcome: "source_unreachable" }] });
  assert.deepEqual(out, { checked: 12, changed: 2, promoted: 2, held: 0, failed: 2 });
  const quiet = summarizeCatalogSync({ ...base, externalForms: [{ outcome: "identical_reissue" }, { outcome: "no_change" }] });
  assert.deepEqual(quiet, { checked: 12, changed: 1, promoted: 1, held: 0, failed: 1 });
  const held = summarizeCatalogSync({ ...base, externalForms: [{ outcome: "kept_in_review" }] });
  assert.equal(held.held, 1);
  assert.equal(held.changed, 2);
});
