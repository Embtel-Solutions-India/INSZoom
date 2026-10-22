// The accuracy metrics and the pre-approved release criteria. DB-free: synthetic golden entries and suggestions (fixtures.js).
const test = require("node:test");
const assert = require("node:assert/strict");
const { evaluate, effectiveThresholds, PRE_APPROVED_THRESHOLDS } = require("..");
const { build, suggestionFor } = require("./fixtures");

const run = (scenario, extra = {}) => evaluate({ goldenDraft: scenario.draft, reviews: scenario.reviews, suggestionsByForm: scenario.suggestionsByForm, ...extra });
const failed = (report) => Object.entries(report.results).filter(([, result]) => !result.ok).map(([name]) => name);
const firstText = (scenario, formCode) => scenario.entries.filter((entry) => entry.formCode === formCode && entry.boxKind === "text");
const autoUse = (scenario, entry) => { suggestionFor(scenario.suggestionsByForm, entry).tier = "auto_use"; };

test("the pre-approved thresholds are the plan's numbers", () => {
  assert.deepEqual({ ...PRE_APPROVED_THRESHOLDS }, { maxCriticalRoleViolations: 0, maxDataIntegrityFailures: 0, minPrecision: 0.99, minAutoUsedTextMappings: 300, minFormsPerFamily: 3, minVerifiedPerWidgetType: 25, requireHeldOutForm: true });
});

test("a perfect run meets every criterion", () => {
  const report = run(build());
  assert.deepEqual(failed(report), []);
  assert.equal(report.met, true);
  assert.deepEqual(report.blockers, []);
  assert.equal(report.metrics.precision, 1);
  assert.ok(report.metrics.autoUsedText >= 300);
  assert.equal(report.evaluated.forms.length, 9);
  assert.deepEqual(report.evaluated.heldOutForms, ["I-90"]);
});

test("a critical party-role violation blocks the gate whatever the overall precision is", () => {
  const scenario = build();
  const [entry] = firstText(scenario, "E1");
  suggestionFor(scenario.suggestionsByForm, entry).candidate.path = "beneficiary.something"; // the employer's box would get the worker's data
  const report = run(scenario);
  assert.equal(report.metrics.precision >= 0.99, true, "precision alone would have passed");
  assert.deepEqual(failed(report), ["no critical party-role violation"]);
  assert.equal(report.violations.role[0].expectedParty, "petitioner");
  assert.equal(report.violations.role[0].suggestedParty, "beneficiary");
  assert.equal(report.met, false);
});

test("a wrong answer on the SAME party is a precision miss, not a role violation", () => {
  const scenario = build();
  suggestionFor(scenario.suggestionsByForm, firstText(scenario, "E1")[0]).candidate.path = "petitioner.another";
  const report = run(scenario);
  assert.equal(report.violations.roleTotal, 0);
  assert.equal(report.metrics.overall.autoWrong, 1);
});

test("data-integrity failures: a checkbox / radio / dropdown / date box auto-used is a violation, even with the right path", () => {
  for (const kind of ["checkbox", "dropdown", "date"]) {
    const scenario = build();
    const entry = scenario.entries.find((item) => item.boxKind === kind);
    autoUse(scenario, entry);
    const report = run(scenario);
    assert.deepEqual(failed(report), ["no data-integrity failure"], kind);
    assert.deepEqual(report.violations.integrity[0].problems, ["NON_TEXT_BOX_AUTO_USED"]);
  }
  const radio = build();
  radio.entries.find((item) => item.boxKind === "checkbox").boxKind = "radio";
  autoUse(radio, radio.entries.find((item) => item.boxKind === "radio"));
  const radioReport = run(radio);
  assert.ok(failed(radioReport).includes("no data-integrity failure"));
  assert.equal(radioReport.met, false);
});

test("data-integrity failures: a box verified blank, a conditional box, a repeating box, a sensitive field and an address block are never auto-used", () => {
  const cases = [
    ["blank", (scenario, entry) => { scenario.reviews.find((review) => review.entryId === entry.id).verdict = "blank"; }, "BLANK_BOX_FILLED"],
    ["conditional", (scenario, entry) => { entry.technical.condition = { field: "x", operator: "equals", value: "y" }; }, "CONDITIONAL_BOX_AUTO_USED"],
    ["repeating", (scenario, entry) => { entry.technical.transform = { type: "arrayItem" }; }, "REPEATING_BOX_AUTO_USED"],
    ["sensitive", (scenario, entry) => { entry.technical.sourcePath = "petitioner.ssn"; suggestionFor(scenario.suggestionsByForm, entry).candidate.path = "petitioner.ssn"; }, "SENSITIVE_FIELD_AUTO_USED"],
    ["address", (scenario, entry) => { entry.technical.sourcePath = "petitioner.mailingAddress"; suggestionFor(scenario.suggestionsByForm, entry).candidate.path = "petitioner.mailingAddress"; }, "ADDRESS_BLOCK_AUTO_USED"],
  ];
  for (const [name, change, code] of cases) {
    const scenario = build();
    const entry = firstText(scenario, "E1")[0];
    change(scenario, entry);
    const report = run(scenario);
    assert.ok(report.violations.integrity[0].problems.includes(code), `${name} -> ${code}`);
    assert.ok(failed(report).includes("no data-integrity failure"), name);
    assert.equal(report.met, false);
  }
});

test("needs_review and rejected suggestions on any box are never judged as violations - they never reach a live form", () => {
  const scenario = build();
  const blank = firstText(scenario, "E1")[0];
  scenario.reviews.find((review) => review.entryId === blank.id).verdict = "blank";
  suggestionFor(scenario.suggestionsByForm, blank).tier = "needs_review";
  const rejected = firstText(scenario, "E1")[1];
  suggestionFor(scenario.suggestionsByForm, rejected).tier = "rejected";
  suggestionFor(scenario.suggestionsByForm, rejected).candidate = null;
  const report = run(scenario);
  assert.equal(report.met, true);
  assert.equal(report.metrics.overall.rejected, 1);
});

test("sample size: 299 verified auto-used text mappings can never qualify, 300 can", () => {
  const scenario = build();
  const autoUsed = scenario.entries.filter((entry) => entry.boxKind === "text");
  let excess = autoUsed.length - 299;
  for (const entry of autoUsed) { if (excess <= 0) break; suggestionFor(scenario.suggestionsByForm, entry).tier = "needs_review"; excess -= 1; }
  const short = run(scenario);
  assert.equal(short.metrics.autoUsedText, 299);
  assert.deepEqual(failed(short).sort(), ["enough verified auto-used text mappings", "precision on auto-used text mappings"].sort(), "a precision of 100% on 299 is no claim at all");
  suggestionFor(scenario.suggestionsByForm, autoUsed[0]).tier = "auto_use";
  assert.equal(run(scenario).met, true);
});

test("precision: exactly 99% passes, anything lower fails (300 auto-used)", () => {
  const make = (wrong) => {
    const scenario = build({ text: 34 }); // 9 forms x 34 = 306 text boxes
    const autoUsed = scenario.entries.filter((entry) => entry.boxKind === "text");
    autoUsed.slice(300).forEach((entry) => { suggestionFor(scenario.suggestionsByForm, entry).tier = "needs_review"; });
    autoUsed.slice(0, wrong).forEach((entry) => { suggestionFor(scenario.suggestionsByForm, entry).candidate.path = `${entry.technical.sourcePath}.other`; });
    return scenario;
  };
  const ok = run(make(3));
  assert.equal(ok.metrics.autoUsedText, 300);
  assert.equal(ok.metrics.precision, 0.99);
  assert.equal(ok.met, true);
  const bad = run(make(4));
  assert.deepEqual(failed(bad), ["precision on auto-used text mappings"]);
  assert.equal(bad.met, false);
});

test("forms per family: a family with only two evaluated forms blocks", () => {
  const scenario = build();
  delete scenario.suggestionsByForm.E3;
  const report = run(scenario);
  assert.ok(failed(report).includes("forms evaluated per main family"), "the family criterion fails (the dropped form's verified fields also stop counting)");
  assert.equal(report.met, false);
  assert.equal(report.results["forms evaluated per main family"].actual.employment, 2);
});

test("the held-out form must be evaluated, on its own: with a fourth form in its family only that criterion fails", () => {
  const scenario = build({ families: { employment: ["E1", "E2", "E3"], family: ["F1", "F2", "F3"], single: ["S1", "S2", "S3", "I-90"] } });
  delete scenario.suggestionsByForm["I-90"];
  const report = run(scenario);
  assert.deepEqual(failed(report), ["a held-out form was evaluated"]);
  const none = build();
  none.draft.heldOutForms = [];
  assert.deepEqual(failed(run(none)), ["a held-out form was evaluated"], "a golden set with no held-out form can never qualify");
});

test("verified fields per widget type: 24 checkboxes in a family block, 27 pass", () => {
  const scenario = build({ others: 8 }); // 24 per family
  assert.deepEqual(failed(run(scenario)), ["verified fields per widget type in each main family"]);
  assert.equal(run(build({ others: 9 })).met, true);
});

test("thresholds can only be made stricter, never looser", () => {
  const loosened = effectiveThresholds({ minPrecision: 0.5, minAutoUsedTextMappings: 1, minFormsPerFamily: 1, minVerifiedPerWidgetType: 1, maxCriticalRoleViolations: 99, maxDataIntegrityFailures: 99, requireHeldOutForm: false });
  assert.deepEqual({ ...loosened }, { ...PRE_APPROVED_THRESHOLDS });
  assert.equal(effectiveThresholds({ minPrecision: 0.999 }).minPrecision, 0.999);
  const scenario = build();
  assert.equal(run(scenario, { thresholds: { minPrecision: 0.5, minAutoUsedTextMappings: 1 } }).thresholds.minAutoUsedTextMappings, 300);
  scenario.entries.filter((entry) => entry.boxKind === "text").slice(0, 3).forEach((entry) => { suggestionFor(scenario.suggestionsByForm, entry).candidate.path = "petitioner.x"; });
  assert.equal(run(scenario).met, true, "99.7% passes the pre-approved 99%");
  assert.equal(run(scenario, { thresholds: { minPrecision: 0.999 } }).met, false, "a stricter caller threshold is honoured");
});

test("only VALID verified entries form the key: a stale review, a wrong or unsure verdict, and a suggestion for an unknown box are not judged", () => {
  const scenario = build();
  const [stale, wrong, unsure] = firstText(scenario, "E1");
  scenario.reviews.find((review) => review.entryId === stale.id).contentHash = "reworded-since";
  scenario.reviews.find((review) => review.entryId === wrong.id).verdict = "wrong";
  scenario.reviews.find((review) => review.entryId === unsure.id).verdict = "unsure";
  [stale, wrong, unsure].forEach((entry) => { suggestionFor(scenario.suggestionsByForm, entry).candidate.path = "beneficiary.nonsense"; }); // would be role violations if they were judged
  scenario.suggestionsByForm.E1.push({ targetFieldId: "E1.unknown", candidate: { path: "beneficiary.x" }, tier: "auto_use" });
  const report = run(scenario);
  assert.equal(report.violations.roleTotal, 0);
  assert.equal(report.metrics.unverifiedSuggestions, 4);
  assert.equal(report.verifiedEntries, scenario.entries.length - 3);
});

test("the per-form, per-family and per-kind reports carry the counts, precision, coverage and needs_review rate", () => {
  const scenario = build({ text: 10, others: 2 });
  suggestionFor(scenario.suggestionsByForm, firstText(scenario, "E1")[0]).tier = "needs_review";
  const report = run(scenario);
  const e1 = report.metrics.byForm.E1;
  assert.equal(e1.verified, 16);
  assert.equal(e1.suggested, 16);
  assert.equal(e1.coverage, 1);
  assert.equal(e1.autoUsed, 9);
  assert.equal(e1.precision, 1);
  assert.equal(report.metrics.byFamily.employment.verified, 48);
  assert.equal(report.metrics.byKind.checkbox.needsReview, 18);
  assert.equal(report.metrics.byKind.checkbox.autoUsed, 0);
  assert.equal(report.metrics.byKind.text.candidateAccuracy, 1);
});

test("the engine's stored field name (candidate.path) and candidate.sourcePath are both read", () => {
  const scenario = build({ text: 3, others: 1 });
  const entry = firstText(scenario, "E1")[0];
  suggestionFor(scenario.suggestionsByForm, entry).candidate = { sourcePath: entry.technical.sourcePath };
  assert.equal(run(scenario).metrics.byForm.E1.autoCorrect, 3);
});
