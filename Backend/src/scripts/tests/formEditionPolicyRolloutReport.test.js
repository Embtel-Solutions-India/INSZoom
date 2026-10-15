// Release 0a pre-rollout report. DB-free: plain fixtures and a fake database handle that records every call.
const test = require("node:test");
const assert = require("node:assert/strict");
const CaseForm = require("../../models/CaseForm");
const { buildRolloutReport, loadRolloutInputs, renderText, analyzeEdition, summarizeCaseForms, versionAsDay, isoDay, parseArgs, FROZEN_CASE_FORM_STATUSES, NOT_ASSESSABLE } = require("../formEditionPolicyRolloutReport");

const d = (iso) => new Date(`${iso}T00:00:00.000Z`);
const cert = (passed) => ({ validationSummary: { certification: { passed, certifiedAt: d("2026-10-01"), version: "v" } } });
const T = (id, formCode, version, status, extra = {}) => ({ _id: id, formCode, version, status, activeFlag: status === "active", pdfStorageKey: `pdf/${id}`, ...extra });
const G = (formTemplateId, status, n, extra = {}) => ({ formCode: extra.formCode, parentFormCode: extra.parentFormCode || null, formTemplateId, formVersion: extra.formVersion, status, isLocked: extra.isLocked || false, n });

// the live shapes the plan describes
const fixtureTemplates = () => [
  // I-131: live edition dated by version_backfill; official page said 01/20/25; the retired 2025-01-20 edition was never certified
  T("t131a", "I-131", "2026-09-18", "active", { editionDate: d("2026-09-18"), importMetadata: { editionDateSource: "version_backfill", publishedEditionDate: d("2025-01-20"), ...cert(true) } }),
  T("t131r", "I-131", "2025-01-20", "retired", { editionDate: d("2025-01-20"), retiredAt: d("2026-09-18"), importMetadata: { validationSummary: { pageCount: 9 } } }),
  // I-765 / I-864: version is a different date from editionDate
  T("t765", "I-765", "2026-09-22", "active", { editionDate: d("2025-08-21"), importMetadata: { ...cert(true) } }),
  T("t864", "I-864", "2026-09-22", "active", { editionDate: d("2026-08-24"), importMetadata: { ...cert(true) } }),
  // I-129: live + a NEWER edition waiting in review + an OLDER draft
  T("t129a", "I-129", "2025-01-20", "active", { editionDate: d("2025-01-20"), importMetadata: { editionDateSource: "uscis_page", ...cert(true) } }),
  T("t129n", "I-129", "2026-10-10", "review", { editionDate: d("2026-10-10"), mappingStatus: "needs_review", importMetadata: { ...cert(false) } }),
  T("t129o", "I-129", "2024-01-01", "draft", { editionDate: d("2024-01-01") }),
  // a form with no live edition at all
  T("tN600", "N-600", "2024-03-01", "review", { editionDate: d("2024-03-01") }),
  // a clean form
  T("t90", "I-90", "2025-04-01", "active", { editionDate: d("2025-04-01"), importMetadata: { editionDateSource: "pdf", ...cert(true) } }),
];

const fixtureGroups = () => [
  G("t129a", "ai_filled", 38, { formCode: "I-129", formVersion: "2025-01-20" }),
  G("t129a", "approved", 2, { formCode: "I-129", formVersion: "2025-01-20" }),
  G("t129a", "under_review", 3, { formCode: "I129_H_SUPP", parentFormCode: "I-129", formVersion: "2025-01-20" }),
  G("t129a", "filed", 1, { formCode: "I-129", formVersion: "2025-01-20" }),
  G("t129a", "draft", 1, { formCode: "I-129", formVersion: "2025-01-20", isLocked: true }),
  G("t90", "ready_for_pdf", 4, { formCode: "I-90", formVersion: "2025-04-01" }),
  G("t90", "pending", 1, { formCode: "I-90", formVersion: "9999-01-01" }), // records a version its template does not have
  G("gone", "pending", 2, { formCode: "G-28", formVersion: "x" }), // template no longer exists
];

const fixtureRegistry = () => [
  { formNumber: "I-129", agency: "USCIS", active: true, componentType: "STANDALONE_FORM" },
  { formNumber: "I-485", agency: "USCIS", active: true, componentType: "STANDALONE_FORM" },
  { formNumber: "I-485A", formTemplateFormCode: "I-485", agency: "USCIS", active: true, componentType: "SUPPLEMENT" },
  { formNumber: "ETA-9089", agency: "DOL", active: true, componentType: "STANDALONE_FORM" },
  { formNumber: "I-999", agency: "USCIS", active: false, componentType: "STANDALONE_FORM" },
  { formNumber: "i-90", agency: "USCIS", active: true, componentType: "STANDALONE_FORM" }, // lower-case in the registry, upper-case template: installed
  { formNumber: "n-400", agency: "USCIS", active: true, componentType: "STANDALONE_FORM" }, // lower-case and genuinely not installed
];

const build = () => buildRolloutReport({ templates: fixtureTemplates(), caseFormGroups: fixtureGroups(), registryForms: fixtureRegistry(), generatedAt: d("2026-10-16") });
const form = (report, code) => report.forms.find((item) => item.formCode === code);
const anomalies = (report, type) => report.anomalies.filter((item) => item.type === type);

test("every tracked form needs initial evidence (evidence-first: no policy exists for any form)", () => {
  const report = build();
  assert.equal(report.summary.formsTracked, 6);
  assert.equal(report.summary.formsNeedingInitialEvidence, 6);
  assert.ok(report.forms.every((item) => item.needsInitialEvidence === true));
  assert.equal(report.readOnly, true);
  assert.equal(report.release, "0a");
});

test("live editions are grandfathered: serve-only, not filing-eligible, never promotable", () => {
  const report = build();
  for (const item of report.forms) {
    for (const live of item.activeEditions) {
      assert.deepEqual({ servedAs: live.gate.servedAs, filingEligible: live.gate.filingEligible, canBePromotedOrReactivated: live.gate.canBePromotedOrReactivated, wouldDo: live.gate.wouldDo }, { servedAs: "grandfathered", filingEligible: false, canBePromotedOrReactivated: false, wouldDo: "serve-only" });
      assert.ok(live.reasons.includes("no_policy"));
    }
  }
  assert.equal(report.summary.liveEditionsGrandfathered, 5);
});

test("pending editions would be HELD; newer-than-live is worked out; an older draft is not newer", () => {
  const report = build();
  const i129 = form(report, "I-129");
  assert.equal(i129.pendingEditions.length, 2);
  const newer = i129.pendingEditions.find((edition) => edition.version === "2026-10-10");
  const older = i129.pendingEditions.find((edition) => edition.version === "2024-01-01");
  assert.equal(newer.newerThanLive, true);
  assert.equal(older.newerThanLive, false);
  assert.ok(i129.pendingEditions.every((edition) => edition.gate.wouldDo === "hold" && edition.reasons.includes("no_policy")));
  assert.equal(newer.certification.state, "failed");
  assert.ok(i129.highlights.includes("pending_newer_edition"));
  assert.equal(report.summary.editionsAwaitingPromotion, 3);
  assert.equal(report.summary.formsWithPendingEdition, 2);
});

test("the live I-131 anomaly is flagged: version_backfill date and a page date that disagrees", () => {
  const report = build();
  const i131 = form(report, "I-131");
  const live = i131.activeEditions[0];
  assert.equal(live.flags.untrusted, true);
  assert.equal(live.flags.pageConflict, true);
  assert.ok(live.reasons.includes("edition_date_untrusted") && live.reasons.includes("edition_date_conflict"));
  assert.ok(i131.highlights.includes("edition_date_untrusted") && i131.highlights.includes("edition_date_conflict"));
  assert.equal(anomalies(report, "edition_date_untrusted").length, 1);
  assert.match(anomalies(report, "edition_date_conflict")[0].detail, /stored edition 2026-09-18 but the USCIS page showed 2025-01-20/);
});

test("the retired I-131 edition is the rescue candidate and has no certification on record", () => {
  const i131 = form(build(), "I-131");
  assert.equal(i131.rescueCandidate.version, "2025-01-20");
  assert.equal(i131.rescueCandidate.certification.state, "none");
  assert.equal(i131.rescueCandidate.wouldDo, "hold");
  assert.match(i131.rescueCandidate.note, /without any policy check/);
  assert.ok(i131.highlights.includes("rescue_candidate_uncertified"));
  assert.equal(form(build(), "I-90").rescueCandidate, null, "forms with no retired edition have none");
});

test("version != edition date mismatches (I-765, I-864) are listed; matching ones are not", () => {
  const report = build();
  const mismatched = anomalies(report, "version_edition_mismatch").map((item) => item.formCode).sort();
  assert.deepEqual(mismatched, ["I-765", "I-864"]);
  assert.equal(report.summary.editionsWithVersionMismatch, 2, "I-131's version equals its edition date, so only I-765 and I-864 count");
});

test("a form with no live edition is reported", () => {
  const report = build();
  assert.deepEqual(anomalies(report, "no_active_edition").map((item) => item.formCode), ["N-600"]);
  assert.equal(report.summary.formsWithoutActiveEdition, 1);
});

test("case forms are counted per form, edition and status, with supplements rolled up under their parent form", () => {
  const i129 = form(build(), "I-129");
  assert.equal(i129.caseForms.total, 45);
  assert.equal(i129.caseForms.byEdition.length, 1);
  assert.deepEqual(i129.caseForms.byEdition[0].byStatus, { ai_filled: 38, approved: 2, under_review: 3, filed: 1, draft: 1 });
  assert.equal(i129.caseForms.byEdition[0].edition, "2025-01-20");
});

test("open / frozen / Rule-J-watch counts follow the stated definitions", () => {
  const i129 = form(build(), "I-129").caseForms;
  assert.equal(i129.open, 44, "everything except the 1 filed");
  assert.equal(i129.frozen, 4, "2 approved + 1 filed + 1 locked draft");
  assert.equal(i129.ruleJWatch, 5, "2 approved + 3 under_review");
  const i90 = form(build(), "I-90").caseForms;
  assert.equal(i90.ruleJWatch, 4);
  assert.deepEqual(summarizeCaseForms([{ status: "locked", n: 2 }, { status: "finalized", n: 1 }, { status: "pending", n: 1, isLocked: true }]), { total: 4, open: 3, frozen: 4, ruleJWatch: 0, byStatus: { locked: 2, finalized: 1, pending: 1 } });
});

test("open work is prioritised by the cases next to the filing-ready steps", () => {
  const priority = build().openWorkPriority;
  assert.deepEqual(priority.map((row) => row.formCode), ["I-129", "I-90", "G-28"]);
  assert.equal(priority[0].ruleJWatch, 5);
  const orphan = priority.find((row) => row.formCode === "G-28");
  assert.equal(orphan.templateMissing, true, "open case forms of a form whose template is gone are still listed");
  assert.equal(orphan.open, 2);
  assert.equal(priority.find((row) => row.formCode === "I-129").templateMissing, false);
});

test("case forms pointing at a missing template, or recording another version, are anomalies", () => {
  const report = build();
  const orphan = anomalies(report, "caseform_orphan_template");
  assert.equal(orphan.length, 1);
  assert.equal(orphan[0].formCode, "G-28");
  assert.match(orphan[0].detail, /2 case form/);
  assert.equal(anomalies(report, "caseform_version_differs_from_template").length, 1);
});

test("registry forms with no installed template are listed (USCIS, active, standalone only)", () => {
  const report = build();
  assert.deepEqual(anomalies(report, "registry_form_not_installed").map((item) => item.formCode), ["I-485", "N-400"], "upper-cased; the lower-case i-90 matches the installed I-90");
  assert.equal(report.summary.registryFormsNotInstalled, 2);
});

test("active editions without a certification on record are noted (re-activation would need certify-on-demand)", () => {
  const report = build();
  assert.equal(anomalies(report, "active_not_certified").length, 0, "every live fixture edition is certified except none");
  const uncertified = buildRolloutReport({ templates: [T("x", "I-1", "2025-01-01", "active", { editionDate: d("2025-01-01") })] });
  assert.equal(uncertified.anomalies.filter((item) => item.type === "active_not_certified").length, 1);
});

test("data-shape anomalies: status/flag mismatch, multiple active, active without a pdf", () => {
  const report = buildRolloutReport({
    templates: [
      T("a", "F-1", "2025-01-01", "active", { editionDate: d("2025-01-01"), activeFlag: false }),
      T("b", "F-1", "2025-02-01", "active", { editionDate: d("2025-02-01") }),
      T("c", "F-2", "2025-01-01", "active", { editionDate: d("2025-01-01"), pdfStorageKey: undefined }),
    ],
  });
  assert.equal(anomalies(report, "multiple_active_editions").length, 1);
  assert.equal(anomalies(report, "status_flag_mismatch").length, 1);
  assert.equal(anomalies(report, "active_without_pdf").length, 1);
});

test("reasons that need an outbound evidence fetch are reported as not assessable, never guessed", () => {
  const report = build();
  assert.deepEqual(report.notAssessable.map((item) => item.reason), ["stale", "notice_detected", "unverifiable"]);
  assert.deepEqual(report.notAssessable, NOT_ASSESSABLE);
  assert.ok(report.forms.every((item) => [...item.activeEditions, ...item.pendingEditions].every((edition) => !edition.reasons.some((reason) => ["stale", "notice_detected", "unverifiable"].includes(reason)))));
});

test("the frozen definition is the eight-status union and every status but receipt_received is a real CaseForm status", () => {
  assert.deepEqual([...FROZEN_CASE_FORM_STATUSES].sort(), ["approved", "archived", "filed", "finalized", "generated", "locked", "ready_for_pdf", "receipt_received"]);
  const valid = CaseForm.schema.path("status").enumValues;
  assert.deepEqual(FROZEN_CASE_FORM_STATUSES.filter((status) => !valid.includes(status)), ["receipt_received"]);
  assert.deepEqual(build().definitions.frozenCaseFormStatuses, FROZEN_CASE_FORM_STATUSES);
});

test("date helpers: ISO days, version strings in the formats the data uses, and non-dates", () => {
  assert.equal(isoDay(d("2026-09-18")), "2026-09-18");
  assert.equal(isoDay("garbage"), null);
  assert.equal(isoDay(null), null);
  assert.equal(versionAsDay("2026-09-22"), "2026-09-22");
  assert.equal(versionAsDay("07/22/2025"), "2025-07-22");
  assert.equal(versionAsDay("7/2/25"), "2025-07-02");
  assert.equal(versionAsDay("v2"), null);
  assert.equal(versionAsDay(undefined), null);
});

test("analyzeEdition: a clean edition carries only the no_policy reason", () => {
  const edition = analyzeEdition(T("c", "I-90", "2025-04-01", "active", { editionDate: d("2025-04-01"), importMetadata: { editionDateSource: "pdf", ...cert(true) } }));
  assert.deepEqual(edition.reasons, ["no_policy"]);
  assert.deepEqual(edition.flags, { untrusted: false, pageConflict: false, versionMismatch: false });
  assert.equal(edition.certification.state, "passed");
});

test("the report is deterministic, never mutates its input, and handles empty data", () => {
  const templates = JSON.parse(JSON.stringify(fixtureTemplates()), (key, value) => (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value) ? new Date(value) : value));
  const groups = fixtureGroups();
  const registry = fixtureRegistry();
  const snapshot = JSON.stringify({ templates, groups, registry });
  const first = buildRolloutReport({ templates, caseFormGroups: groups, registryForms: registry, generatedAt: d("2026-10-16") });
  const second = buildRolloutReport({ templates, caseFormGroups: groups, registryForms: registry, generatedAt: d("2026-10-16") });
  assert.deepEqual(first, second);
  assert.equal(JSON.stringify({ templates, groups, registry }), snapshot, "inputs untouched");
  const empty = buildRolloutReport({});
  assert.equal(empty.summary.formsTracked, 0);
  assert.deepEqual(empty.forms, []);
  assert.equal(JSON.stringify(first).length > 100, true);
});

test("renderText prints every section and the not-assessable list", () => {
  const text = renderText(build());
  for (const heading of ["SUMMARY", "OPEN CASE FORMS BY FORM", "ANOMALIES", "FORMS (gate simulation)", "NOT ASSESSABLE READ-ONLY"]) assert.ok(text.includes(heading), heading);
  assert.match(text, /I-131.*needs initial evidence/);
  assert.match(text, /G-28\s+\(template missing\) open/);
  assert.match(text, /HOLD \(no_policy\)/);
  assert.match(text, /stale:/);
});

// ---- loading: only reads, through the read-only handle ---------------------------------------------------------------------------------------

function recordingDb(data) {
  const calls = [];
  return {
    calls,
    collection(name) {
      return new Proxy({}, {
        get: (_target, method) => (...args) => {
          calls.push({ collection: name, method: String(method), args });
          const rows = data[name] || [];
          const result = method === "aggregate" ? rows.map((row) => ({ _id: { formCode: row.formCode, parentFormCode: row.parentFormCode, formTemplateId: row.formTemplateId, formVersion: row.formVersion, status: row.status, isLocked: row.isLocked }, n: row.n })) : rows;
          return { toArray: async () => result };
        },
      });
    },
  };
}

test("loadRolloutInputs performs reads only, with projections, and never loads the heavy template fields", async () => {
  const db = recordingDb({ uscisformtemplates: fixtureTemplates(), caseforms: fixtureGroups(), visaformmappings: fixtureRegistry() });
  const inputs = await loadRolloutInputs(db);
  assert.equal(inputs.templates.length, 9);
  assert.equal(inputs.caseFormGroups.length, 8);
  assert.equal(inputs.caseFormGroups[0].status, "ai_filled");
  assert.equal(inputs.caseFormGroups[0].n, 38);
  assert.equal(inputs.registryForms.length, 7);
  assert.deepEqual(db.calls.map((call) => `${call.collection}.${call.method}`), ["uscisformtemplates.find", "caseforms.aggregate", "visaformmappings.find"]);
  const templateProjection = db.calls[0].args[1].projection;
  for (const heavy of ["formFields", "definition", "mappingGraph", "sections", "pdfFieldMappings", "lifecycle.scanHistory"]) assert.equal(heavy in templateProjection, false, `${heavy} must not be loaded`);
  const pipeline = db.calls[1].args[0];
  assert.equal(pipeline.length, 1);
  assert.ok(pipeline[0].$group, "one $group stage and nothing that writes");
});

test("loadRolloutInputs cannot write even if asked to: the handle it uses is read-only", async () => {
  const db = recordingDb({});
  const original = db.collection.bind(db);
  // the loader only ever receives collection(); prove a write attempt through that route is impossible
  const { readOnlyDb } = require("../lib/readOnlyDb");
  assert.throws(() => readOnlyDb(db).collection("uscisformtemplates").updateOne({}, { $set: { a: 1 } }), /read-only database handle/);
  assert.equal(db.calls.length, 0);
  assert.equal(typeof original, "function");
});

test("parseArgs reads --json, --out and --help", () => {
  assert.deepEqual(parseArgs(["--json", "--out", "r.json"]), { json: true, out: "r.json", help: false });
  assert.deepEqual(parseArgs([]), { json: false, out: null, help: false });
  assert.equal(parseArgs(["-h"]).help, true);
});
