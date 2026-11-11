// A download contains every value the live form view shows (LiveFormValues). DB-free: every service is a stand-in.
const assert = require("node:assert/strict");
const test = require("node:test");
const { gapFill, withFilledData } = require("../services/LiveFormValues");
const { prepareOfficialDownload } = require("../services/OfficialFormDownloadService");

const deps = (live, extra = {}) => ({
  Case: { findById: () => ({ select: () => ({ lean: async () => ({ canonicalProfile: { lastBuiltAt: new Date() } }) }) }) },
  FormMappingService: { loadMappingVersion: async () => ({}), applyMappingGraph: (t) => t, mapTemplate: () => ({ fieldValues: live }) },
  CanonicalDataService: { build: async () => ({}) },
  AutoFillService: { isReviewedOrManual: (form, id) => (form.manual || []).includes(id) },
  ...extra,
});
const form = (filledData, more = {}) => ({ caseId: "c1", formCode: "I-907", status: "ai_filled", filledData, ...more });

test("a box the live view has and the saved copy lacks is filled - every type (text, checkbox, radio value, number, dropdown)", async () => {
  const r = await gapFill({ caseForm: form({ a: { family: "Oliver" } }), template: { _id: "t" } }, deps({ "a.family": "Oliver", "a.given": "Jennifer", "b.agree": true, "b.choice": "No", "b.amount": 112000, "b.country": "India" }));
  assert.deepEqual(r.filledFieldIds.sort(), ["a.given", "b.agree", "b.amount", "b.choice", "b.country"]);
  assert.equal(r.filledData.a.given, "Jennifer");
  assert.equal(r.filledData.a.family, "Oliver");
  assert.equal(r.filledData.b.agree, true);
  assert.equal(r.filledData.b.amount, 112000);
});

test("a value the saved copy already has is never replaced, and an edited/approved box is never touched", async () => {
  const r = await gapFill({ caseForm: form({ a: { family: "Saved" } }, { manual: ["a.given"] }), template: { _id: "t" } }, deps({ "a.family": "Live", "a.given": "Live" }));
  assert.deepEqual(r.filledFieldIds, []);
  assert.equal(r.filledData, null);
});

test("nothing is saved: the original form object is unchanged and the view carries the filled copy", async () => {
  const original = form({ a: { family: "Oliver" } });
  const r = await gapFill({ caseForm: original, template: { _id: "t" } }, deps({ "a.given": "Jennifer" }));
  assert.equal(original.filledData.a.given, undefined);
  const view = withFilledData(original, r.filledData);
  assert.equal(view.filledData.a.given, "Jennifer");
  assert.equal(view.caseId, "c1");
  assert.equal(view.formCode, "I-907");
});

test("a locked or filed form (historical record) is not gap-filled", async () => {
  for (const extra of [{ isLocked: true }, { status: "filed" }, { status: "locked" }]) {
    const r = await gapFill({ caseForm: form({}, extra), template: { _id: "t" } }, deps({ x: "v" }));
    assert.equal(r.filledData, null);
    assert.equal(r.skipped, "historical form");
  }
});

test("a case with no built canonical profile keeps its saved values (a rebuild would write)", async () => {
  const noCache = { Case: { findById: () => ({ select: () => ({ lean: async () => ({}) }) }) } };
  const r = await gapFill({ caseForm: form({}), template: { _id: "t" } }, deps({ x: "v" }, noCache));
  assert.equal(r.filledData, null);
  assert.match(r.skipped, /no cached canonical profile/);
});

test("a supplement (component) form only receives its own boxes", async () => {
  const withComponent = { USCISFormComponentDefinition: { findOne: () => ({ select: () => ({ lean: async () => ({ fieldIds: ["page21.rate"] }) }) }) } };
  const r = await gapFill({ caseForm: form({}, { componentCode: "I129_H_1B" }), template: { _id: "t" } }, deps({ "page21.rate": "112,000.00", "page1.other": "x" }, withComponent));
  assert.deepEqual(r.filledFieldIds, ["page21.rate"]);
});

test("any failure inside returns the saved copy unchanged with a reason - it can never fail a download", async () => {
  const boom = { CanonicalDataService: { build: async () => { throw new Error("db down"); } } };
  const r = await gapFill({ caseForm: form({ a: 1 }), template: { _id: "t" } }, deps({ x: "v" }, boom));
  assert.equal(r.filledData, null);
  assert.deepEqual(r.filledFieldIds, []);
  assert.match(r.skipped, /db down/);
});

test("the download renders the gap-filled copy, tells the user, and still serves a file if the live step fails", async () => {
  const seen = [];
  const base = {
    adobeEnabled: false,
    PDFGenerationService: { loadCaseForm: async () => ({ _id: "f", caseId: "c", formCode: "I-907", status: "draft", filledData: { a: 1 }, formTemplateId: { toObject: () => ({ formCode: "I-907" }) }, syncState: { lastSyncedAt: new Date() }, versionNumber: 0 }), createGeneratedDocument: async () => ({ _id: "d" }), audit: async () => {} },
    PDFRenderer: { renderFiling: async ({ caseForm }) => { seen.push(caseForm.filledData); return { buffer: Buffer.from("%PDF-x"), renderReport: null }; } },
    filingPolicy: { assessDownload: () => ({}), enforce: () => {} },
    FormDataGuard: { recover: async ({ result }) => ({ buffer: result.buffer, entries: [], warnings: [] }) },
  };
  const ok = await prepareOfficialDownload({ caseFormId: "f", user: {}, req: {} }, { ...base, LiveFormValues: { gapFill: async () => ({ filledData: { a: 1, b: 2 }, filledFieldIds: ["b"], skipped: null }), withFilledData: require("../services/LiveFormValues").withFilledData } });
  assert.deepEqual(seen[0], { a: 1, b: 2 });
  assert.ok(ok.warnings.some((w) => /1 box\(es\).*missing from the saved copy/.test(w)));
  const failed = await prepareOfficialDownload({ caseFormId: "f", user: {}, req: {} }, { ...base, LiveFormValues: { gapFill: async () => { throw new Error("boom"); }, withFilledData: require("../services/LiveFormValues").withFilledData } });
  assert.deepEqual(seen[1], { a: 1 });
  assert.equal(failed.mode, "pdf-lib");
});

test("a box blanked by an EMPTY native-edit override gets the live value back (the Given Name 'Jennifer' case) - nothing is saved", async () => {
  const blanked = form({ a: { given: "" } }, { manual: ["a.given"], manualOverrides: { "a.given": { value: "", previousValue: "Jennifer ", reason: "Native PDF field edit" } } });
  const r = await gapFill({ caseForm: blanked, template: { _id: "t" } }, deps({ "a.given": "Jennifer" }));
  assert.deepEqual(r.filledFieldIds, ["a.given"]);
  assert.deepEqual(r.restoredFieldIds, ["a.given"]);
  assert.equal(r.filledData.a.given, "Jennifer");
  assert.equal(blanked.filledData.a.given, "");
});

test("an empty override whose live value is also empty gets back the value the box held before it was blanked (text and ticked boxes)", async () => {
  const blanked = form({ m: "", t: "" }, { manual: ["m", "t"], manualOverrides: { m: { value: "", previousValue: "Glory" }, t: { value: "", previousValue: "Yes" }, untouched: { value: "", previousValue: undefined } } });
  const r = await gapFill({ caseForm: blanked, template: { _id: "t" } }, deps({}));
  assert.deepEqual(r.restoredFieldIds.sort(), ["m", "t"]);
  assert.equal(r.filledData.m, "Glory");
  assert.equal(r.filledData.t, "Yes");
});

test("a REAL override (a person typed an answer) is still the final word - the live value never replaces it", async () => {
  const typed = form({ a: { given: "Jenny" } }, { manual: ["a.given"], manualOverrides: { "a.given": { value: "Jenny", previousValue: "Jennifer" } } });
  assert.deepEqual((await gapFill({ caseForm: typed, template: { _id: "t" } }, deps({ "a.given": "Jennifer" }))).filledFieldIds, []);
});

test("a value a person typed is always written, even if the saved copy lacks it", async () => {
  const typed = form({}, { manual: ["a.given"], manualOverrides: { "a.given": { value: "Jenny", previousValue: "Jennifer" } } });
  const r = await gapFill({ caseForm: typed, template: { _id: "t" } }, deps({}));
  assert.equal(r.filledData.a.given, "Jenny");
});

test("what staff typed wins over an older saved text, but a tick is never swapped for text", async () => {
  const f = form({ a: { given: "Jennifer" }, t: true }, { manual: ["a.given", "t"], manualOverrides: { "a.given": { value: "Jenny" }, t: { value: "Yes" } } });
  const r = await gapFill({ caseForm: f, template: { _id: "t" } }, deps({}));
  assert.equal(r.filledData.a.given, "Jenny");
  assert.equal(r.filledData.t, true);
});

test("a download that rescued values writes one monitoring log line for the form (and a logger failure never breaks the download)", async () => {
  const logged = [];
  const base = {
    adobeEnabled: false,
    PDFGenerationService: { loadCaseForm: async () => ({ _id: "f", caseId: "c", formCode: "I-907", status: "draft", filledData: {}, formTemplateId: { toObject: () => ({ formCode: "I-907" }) }, syncState: { lastSyncedAt: new Date() }, versionNumber: 0 }), createGeneratedDocument: async () => ({ _id: "d" }), audit: async () => {} },
    PDFRenderer: { renderFiling: async () => ({ buffer: Buffer.from("%PDF-x"), renderReport: null }) },
    filingPolicy: { assessDownload: () => ({}), enforce: () => {} },
    FormDataGuard: { recover: async ({ result }) => ({ buffer: result.buffer, entries: [{ reason: "pdf_field_missing", caseField: "x", value: "v" }], warnings: [] }) },
    LiveFormValues: { gapFill: async () => ({ filledData: { a: 1 }, filledFieldIds: ["a"], restoredFieldIds: ["a"], skipped: null }), withFilledData: require("../services/LiveFormValues").withFilledData },
  };
  await prepareOfficialDownload({ caseFormId: "f", user: {}, req: {} }, { ...base, logger: { warn: (event, data) => logged.push([event, data]) } });
  assert.equal(logged[0][0], "form_download_data_safeguard");
  assert.deepEqual([logged[0][1].formCode, logged[0][1].filledFromLiveView, logged[0][1].restoredFromEmptyOverride, logged[0][1].noBoxOnForm], ["I-907", 1, 1, 1]);
  const survived = await prepareOfficialDownload({ caseFormId: "f", user: {}, req: {} }, { ...base, logger: { warn: () => { throw new Error("log down"); } } });
  assert.equal(survived.mode, "pdf-lib");
});
