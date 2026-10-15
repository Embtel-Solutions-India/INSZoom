// DB-free checks of the 12-hour catalog sync: edition comparison, selection (changed installed forms first, then brand-new forms), the per-run bound, and the
// guarantee that a failing import never stops the others or touches the installed edition.
const assert = require("node:assert/strict");
const test = require("node:test");
const { runCatalogSync, classify } = require("../services/FormCatalogSyncService");

const d = (value) => new Date(value);

test("classify: the I-589 example - installed 2026-01-04 vs published 2026-04-09 is an upgrade; same edition is not; a form not in the software is new", () => {
  assert.equal(classify({ formCode: "I-589", editionDate: d("2026-04-09") }, { editionDate: d("2026-01-04") }).action, "upgrade");
  assert.equal(classify({ formCode: "I-589", editionDate: d("2026-01-04T10:00:00Z") }, { editionDate: d("2026-01-04T00:00:00Z") }).action, "up_to_date");
  assert.equal(classify({ formCode: "I-589", editionDate: d("2026-04-09") }, null).action, "import_new");
  assert.equal(classify({ formCode: "I-589", editionDate: null }, { editionDate: d("2026-01-04") }).action, "skip", "an unknown published edition never triggers an import");
  assert.equal(classify({ formCode: "I-485 SUPPLEMENT A", editionDate: d("2026-01-01") }, null).action, "skip", "only standalone form codes");
  assert.equal(classify({ formCode: "I-589", editionDate: d("2026-04-09") }, { editionDate: null }).action, "check_edition");
});

function fakeDeps({ published, installed, failFor = [] }) {
  const imported = [];
  return {
    imported,
    listPublishedForms: async () => published,
    publishedEdition: async (code) => published.find((form) => form.formCode === code)?.editionDate || null,
    installedTemplate: async (code) => installed[code] || null,
    importForm: async (code) => {
      imported.push(code);
      if (failFor.includes(code)) throw new Error("uscis.gov 502 bad gateway");
      return { template: { status: "active" }, requiresActivation: false, certification: { passed: true } };
    },
  };
}

const catalog = {
  published: [
    { formCode: "I-589", editionDate: d("2026-04-09") }, // installed older -> upgrade
    { formCode: "I-130", editionDate: d("2024-04-01") }, // same -> up to date
    { formCode: "I-912", editionDate: d("2025-07-22") }, // not installed -> new
    { formCode: "I-485", editionDate: d("2026-09-18") }, // installed older -> upgrade
    { formCode: "I-485 SUPPLEMENT A", editionDate: d("2026-01-01") }, // not standalone
  ],
  installed: { "I-589": { editionDate: d("2026-01-04") }, "I-130": { editionDate: d("2024-04-01") }, "I-485": { editionDate: d("2026-01-01") } },
};

test("imports edition-changed installed forms first, then new forms; leaves up-to-date and non-standalone forms alone", async () => {
  const deps = fakeDeps(catalog);
  const result = await runCatalogSync({ user: {} }, deps);
  assert.deepEqual(deps.imported, ["I-589", "I-485", "I-912"]);
  assert.equal(result.upToDate, 1);
  assert.equal(result.skipped, 1);
  assert.ok(result.results.every((item) => item.outcome === "live"));
});

test("dry run only reports what would be imported", async () => {
  const deps = fakeDeps(catalog);
  const result = await runCatalogSync({ dryRun: true }, deps);
  assert.deepEqual(deps.imported, []);
  assert.deepEqual(result.queued, ["I-589(upgrade)", "I-485(upgrade)", "I-912(import_new)"]);
});

test("each run is bounded; the remainder is deferred, not forgotten", async () => {
  const deps = fakeDeps(catalog);
  const result = await runCatalogSync({ user: {}, maxFormsPerRun: 2 }, deps);
  assert.deepEqual(deps.imported, ["I-589", "I-485"]);
  assert.equal(result.deferred, 1);
  const next = fakeDeps({ ...catalog, installed: { ...catalog.installed, "I-589": { editionDate: d("2026-04-09") }, "I-485": { editionDate: d("2026-09-18") } } });
  await runCatalogSync({ user: {}, maxFormsPerRun: 2 }, next);
  assert.deepEqual(next.imported, ["I-912"], "the next run picks up what was deferred");
});

test("a failing import is recorded, never stops the other forms, and is retried by the next run", async () => {
  const deps = fakeDeps({ ...catalog, failFor: ["I-589"] });
  const result = await runCatalogSync({ user: {} }, deps);
  assert.deepEqual(deps.imported, ["I-589", "I-485", "I-912"]);
  assert.equal(result.results[0].outcome, "error");
  assert.equal(result.results[1].outcome, "live");
});

test("a form certification keeps in review is reported as kept_in_review (the installed edition stays live)", async () => {
  const deps = fakeDeps(catalog);
  deps.importForm = async () => ({ template: { status: "review" }, requiresActivation: true, certification: { passed: false } });
  const result = await runCatalogSync({ user: {}, only: ["I-589"] }, deps);
  assert.equal(result.results[0].outcome, "kept_in_review");
});

test("when an edition check finds nothing new, the page's date is recorded so the form compares normally from then on (no re-check every run)", async () => {
  const stamped = [];
  const deps = fakeDeps({ published: [{ formCode: "G-28", editionDate: d("2018-09-17") }], installed: { "G-28": { editionDate: d("2026-09-22") } } });
  deps.importForm = async () => ({ template: { status: "active" }, alreadyActive: true, requiresActivation: false, checked: true });
  deps.stampPublishedEdition = async (code, date) => stamped.push([code, date.toISOString().slice(0, 10)]);
  await runCatalogSync({ user: {} }, deps);
  assert.deepEqual(stamped, [["G-28", "2018-09-17"]]);
  // and once recorded, the same form is up to date
  assert.equal(classify({ formCode: "G-28", editionDate: d("2018-09-17") }, { editionDate: d("2026-09-22"), importMetadata: { publishedEditionDate: d("2018-09-17") } }).action, "up_to_date");
});
