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

// ---- tracking forms that are already installed (the 12-hour sync) ----
test("an installed form whose code the discovery rule skips (EOIR-29) is still compared edition by edition; a NEW one is still not discovered", () => {
  const { classifyShared } = require("../services/FormCatalogSyncService");
  const installed = { formCode: "EOIR-29", editionDate: new Date("2026-02-01"), importMetadata: { publishedEditionDate: new Date("2026-02-01") } };
  assert.equal(classifyShared({ formCode: "EOIR-29", editionDate: new Date("2026-06-01") }, installed).action, "upgrade");
  assert.equal(classifyShared({ formCode: "EOIR-29", editionDate: new Date("2026-02-01") }, installed).action, "up_to_date");
  assert.equal(classifyShared({ formCode: "EOIR-29", editionDate: new Date("2026-06-01") }, null).action, "skip", "not discovered as a new catalog form");
  assert.equal(classifyShared({ formCode: "I-130", editionDate: new Date("2026-06-01") }, null).action, "import_new");
});

test("an installed form the directory does not list (I-539A) is still checked, and a new edition of it is imported", async () => {
  const deps = fakeDeps({ published: [{ formCode: "I-130", editionDate: d("2024-04-01") }], installed: { "I-130": { editionDate: d("2024-04-01") }, "I-539A": { editionDate: d("2024-08-28") } } });
  deps.installedFormCodes = async () => ["I-130", "I-539A"];
  deps.publishedEdition = async (code) => (code === "I-539A" ? d("2026-06-01") : null); // read from the form's own PDF footer when it has no page
  const summary = await runCatalogSync({ maxFormsPerRun: 5 }, deps);
  assert.deepEqual(deps.imported, ["I-539A"]);
  assert.ok(summary.queued.includes("I-539A(upgrade)"), JSON.stringify(summary.queued));
});

test("an unlisted installed form whose edition did not change is left alone, and a failing lookup never stops the sync", async () => {
  const deps = fakeDeps({ published: [], installed: { "I-539A": { editionDate: d("2024-08-28") } } });
  deps.installedFormCodes = async () => ["I-539A"];
  deps.publishedEdition = async () => d("2024-08-28");
  await runCatalogSync({ maxFormsPerRun: 5 }, deps);
  assert.deepEqual(deps.imported, []);
  const broken = fakeDeps({ published: [], installed: {} });
  broken.installedFormCodes = async () => { throw new Error("database busy"); };
  await assert.doesNotReject(runCatalogSync({ maxFormsPerRun: 5 }, broken));
});

test("an installed form whose edition cannot be found anywhere is REPORTED with where it looked - never silently skipped - and the sync carries on", async () => {
  const deps = fakeDeps({ published: [{ formCode: "I-130", editionDate: d("2026-06-01") }], installed: { "I-130": { editionDate: d("2024-04-01") }, "I-539A": { editionDate: d("2024-08-28") } } });
  deps.installedFormCodes = async () => ["I-130", "I-539A"];
  deps.publishedEdition = async () => { throw Object.assign(new Error("USCIS page fetch failed: 404"), { code: "EDITION_SOURCE_NOT_FOUND", tried: [{ url: "https://www.uscis.gov/i-539a", status: 404, note: "unreachable" }, { url: "https://www.uscis.gov/i-539", status: 200, note: "page does not name or link this form" }] }); };
  const summary = await runCatalogSync({ maxFormsPerRun: 5 }, deps);
  assert.deepEqual(deps.imported, ["I-130"], "the form that WAS found is still imported");
  assert.equal(summary.editionUnresolved.length, 1);
  assert.equal(summary.editionUnresolved[0].formCode, "I-539A");
  assert.equal(summary.editionUnresolved[0].tried.length, 2, "it says where it looked");
});

// ---- a code USCIS publishes only as lettered forms (I-854 -> I-854A / I-854B) ----
test("a parent-only code (I-854) is never imported as a form: the sync imports its lettered forms instead, with the same edition", async () => {
  const deps = fakeDeps({ published: [{ formCode: "I-854", editionDate: d("2025-01-20"), pageUrl: "https://www.uscis.gov/i-854" }, { formCode: "I-130", editionDate: d("2024-04-01") }], installed: { "I-130": { editionDate: d("2024-04-01") } } });
  const summary = await runCatalogSync({ maxFormsPerRun: 10 }, deps);
  assert.deepEqual([...deps.imported].sort(), ["I-854A", "I-854B"]);
  assert.ok(!deps.imported.includes("I-854"));
  assert.equal(summary.newFormsFound, 2);
});

test("the parent-only data: I-854 has two forms and no form of its own; ordinary codes are untouched", () => {
  const { parentOnlyChildren, aliasFor, pageUrlFor } = require("../config/formSourceAliases");
  assert.deepEqual(parentOnlyChildren("I-854"), ["I-854A", "I-854B"]);
  assert.deepEqual(parentOnlyChildren(" i-854 "), ["I-854A", "I-854B"]);
  assert.equal(parentOnlyChildren("I-854A"), null);
  assert.equal(parentOnlyChildren("I-130"), null);
  assert.equal(aliasFor("I-854B").pdfSlugs[0], "i-854b");
  assert.equal(pageUrlFor("I-854A"), "https://www.uscis.gov/i-854");
});

test("asking the importer for I-854 itself is a permanent, clearly worded block - never a stored wrong form", async () => {
  const acquisition = require("../services/OnDemandFormAcquisitionService");
  await assert.rejects(acquisition.ensureCurrentUSCISForm("I-854", { _id: "u1" }, {}, {}), (error) => error.code === "USCIS_FORM_PARENT_ONLY" && /I-854A and I-854B/.test(error.message));
  const { classifyError } = require("../../form-pipeline/errorClassifier");
  assert.equal(classifyError(Object.assign(new Error("x"), { code: "USCIS_FORM_PARENT_ONLY" })).retryable, false);
});
