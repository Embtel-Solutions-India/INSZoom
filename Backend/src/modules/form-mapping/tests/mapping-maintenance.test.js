// DB-free: the mapping maintenance that runs with the 12-hour sync. Every model and service it calls is mocked.
const assert = require("node:assert/strict");
const test = require("node:test");
const maintenance = require("../services/MappingMaintenanceService");
const Template = require("../../../models/USCISFormTemplate");
const MappingVersion = require("../../../models/USCISMappingVersion");
const MappingGraphService = require("../services/MappingGraphService");
const PartyFieldMappingService = require("../services/PartyFieldMappingService");

const edge = (status = "active") => ({ status });
const draftTemplate = (over = {}) => ({ _id: "t1", formCode: "I-129", version: "2026-09-09", mappingStatus: "draft", mappingVersion: 24, ...over });

function arrange(mock, { templates = [draftTemplate()], version, verdict = { readyForActivation: true, errors: [] }, activateImpl } = {}) {
  const activated = [];
  mock.method(Template, "find", async () => templates);
  mock.method(MappingVersion, "findOne", () => ({ select: () => ({ lean: async () => version === undefined ? ({ mappingVersion: 24, status: "draft", graph: { edges: [edge(), edge()] } }) : version }) }));
  mock.method(MappingGraphService, "validateWithContract", async () => verdict);
  mock.method(MappingGraphService, "activate", activateImpl || (async (id) => { activated.push(String(id)); return {}; }));
  return activated;
}

test("a complete, valid draft that was never activated is activated through the normal gated activation", async (context) => {
  const activated = arrange(context.mock);
  const result = await maintenance.activateReadyDrafts();
  assert.deepEqual(activated, ["t1"]);
  assert.equal(result[0].activated, "v24");
});

test("a draft with a review item, an error, or that is not ready is never touched", async (context) => {
  let activated = arrange(context.mock, { version: { mappingVersion: 24, status: "draft", graph: { edges: [edge(), edge("review")] } } });
  assert.match((await maintenance.activateReadyDrafts())[0].skipped, /not complete and valid/);
  assert.deepEqual(activated, []);
  activated = arrange(context.mock, { verdict: { readyForActivation: true, errors: [{ code: "X" }] } });
  assert.match((await maintenance.activateReadyDrafts())[0].skipped, /not complete and valid/);
  activated = arrange(context.mock, { verdict: { readyForActivation: false, errors: [] } });
  await maintenance.activateReadyDrafts();
  assert.deepEqual(activated, []);
  activated = arrange(context.mock, { version: { mappingVersion: 24, status: "needs_review", graph: { edges: [] } } });
  assert.match((await maintenance.activateReadyDrafts())[0].skipped, /not a draft/);
  assert.deepEqual(activated, []);
});

test("dry run activates nothing, and a refused activation is reported, never thrown", async (context) => {
  const activated = arrange(context.mock);
  assert.equal((await maintenance.activateReadyDrafts({ dryRun: true }))[0].wouldActivate, "v24");
  assert.deepEqual(activated, []);
  arrange(context.mock, { activateImpl: async () => { throw new Error("UNREVIEWED_EDITION_CHANGES"); } });
  const result = await maintenance.activateReadyDrafts();
  assert.match(result[0].error, /UNREVIEWED_EDITION_CHANGES/);
});

test("the owner's decided parties are applied to the LIVE template of each spec form, and nothing is reported when there is nothing to change", async (context) => {
  const calls = [];
  context.mock.method(Template, "findOne", () => ({ sort: async () => ({ _id: "live", formCode: "x" }) }));
  context.mock.method(PartyFieldMappingService, "apply", async (template, user, req, options) => {
    calls.push(options);
    return calls.length === 1 ? { created: 5, rewired: 2, removed: 80, saved: true, activated: true } : { created: 0, rewired: 0, saved: false };
  });
  const results = await maintenance.applyDecidedSpecs({ only: ["I-134", "I-140"] });
  assert.equal(calls.length, 2);
  assert.ok(calls.every((options) => options.dryRun === false && options.allowInference === false));
  assert.equal(results.length, 1, "an unchanged form is not reported");
  assert.deepEqual([results[0].formCode, results[0].saved, results[0].activated], ["I-134", true, true]);
});

test("a spec form with no live edition is skipped, and a failing apply is reported for that form only", async (context) => {
  context.mock.method(Template, "findOne", () => ({ sort: async () => null }));
  context.mock.method(PartyFieldMappingService, "apply", async () => { throw new Error("should not run"); });
  assert.deepEqual(await maintenance.applyDecidedSpecs({ only: ["I-134"] }), []);
  context.mock.method(Template, "findOne", () => ({ sort: async () => ({ _id: "live" }) }));
  PartyFieldMappingService.apply.mock.mockImplementation(async () => { throw new Error("boom"); });
  const results = await maintenance.applyDecidedSpecs({ only: ["I-134", "I-140"] });
  assert.equal(results.length, 2);
  assert.match(results[0].error, /boom/);
});

test("a form with nothing to map reads Fully mapped; dry run changes nothing; the whole run never throws and can be switched off", async (context) => {
  let updated = null;
  context.mock.method(Template, "find", () => ({ select: () => ({ lean: async () => [{ _id: "g1", formCode: "G-1055", mappingStatus: "biographic_active" }] }) }));
  context.mock.method(Template, "updateMany", async (filter, update) => { updated = update; return {}; });
  assert.deepEqual(await maintenance.labelNoMappingForms({ dryRun: true }), [{ formCode: "G-1055", was: "biographic_active" }]);
  assert.equal(updated, null);
  await maintenance.labelNoMappingForms();
  assert.deepEqual(updated, { $set: { mappingStatus: "active" } });
  context.mock.method(Template, "find", () => { throw new Error("db down"); });
  context.mock.method(Template, "findOne", () => { throw new Error("db down"); });
  const summary = await maintenance.runAll();
  assert.ok(summary.specs && summary.drafts && summary.noMapping, "every step ran or was skipped, nothing threw");
  process.env.FORM_MAPPING_MAINTENANCE = "false";
  try { assert.deepEqual(await maintenance.runAll(), { skipped: "disabled" }); } finally { delete process.env.FORM_MAPPING_MAINTENANCE; }
});

test("an edition-diff refusal is retried once through the pipeline's provably-safe acknowledgement; an unprovable diff is left for a person and nothing is forced", async (context) => {
  const Comparison = require("../services/FormEditionComparisonService");
  const refusal = Object.assign(new Error("a human reviewer must acknowledge the edition diff"), { code: "UNREVIEWED_EDITION_CHANGES" });
  let calls = 0;
  arrange(context.mock, { activateImpl: async () => { calls += 1; if (calls === 1) throw refusal; return {}; } });
  context.mock.method(Comparison, "autoAcknowledge", async () => ({ acknowledged: true, proven: 12 }));
  const ok = await maintenance.activateReadyDrafts();
  assert.equal(ok[0].activated, "v24");
  assert.equal(calls, 2, "activated again after the acknowledgement");

  calls = 0;
  arrange(context.mock, { activateImpl: async () => { calls += 1; throw refusal; } });
  Comparison.autoAcknowledge.mock.mockImplementation(async () => ({ acknowledged: false, reason: "not_provably_safe" }));
  const held = await maintenance.activateReadyDrafts();
  assert.match(held[0].needsPerson, /not_provably_safe/);
  assert.equal(calls, 1, "never retried without an acknowledgement");

  arrange(context.mock, { activateImpl: async () => { throw new Error("some other failure"); } });
  assert.match((await maintenance.activateReadyDrafts())[0].error, /some other failure/);
});

test("Attachment 1 of the I-129: the slice gets its name, a CONDITIONAL registry row is added for each I-129 visa type that lacks one, and a second run adds nothing", async (context) => {
  const Definitions = require("../../../models/USCISFormComponentDefinition");
  const Rows = require("../../../models/VisaFormMapping");
  const upserts = [];
  let renamed = null;
  const listed = new Set(["L-1A"]); // L-1A already has its row
  context.mock.method(Definitions, "find", () => ({ select: () => ({ lean: async () => [{ _id: "d1" }] }) }));
  context.mock.method(Definitions, "updateMany", async (filter, update) => { renamed = update; return {}; });
  context.mock.method(Rows, "find", (query) => {
    if (query.componentType === "STANDALONE_FORM") return { lean: async () => ["H-1B", "L-1A", "O-1A"].map((visaType) => ({ visaType, visaCategory: visaType, caseType: "immigration", immigrationNature: "TEMPORARY_NONIMMIGRANT", agency: "USCIS" })) };
    return { select: () => ({ lean: async () => [...listed].map((visaType) => ({ visaType })) }) };
  });
  context.mock.method(Rows, "updateOne", async (filter, update, options) => { upserts.push({ filter, row: update.$setOnInsert, options }); listed.add(filter.visaType); return {}; });

  const report = await maintenance.registerContinuationSheets();
  assert.equal(report[0].renamed, 1);
  assert.deepEqual(renamed, { $set: { name: "Attachment 1 I-129" } });
  assert.deepEqual(upserts.map((entry) => entry.filter.visaType).sort(), ["H-1B", "O-1A"], "only the visa types without a row");
  const row = upserts[0].row;
  assert.equal(row.provisioningType, "CONDITIONAL", "never auto-created for a case");
  assert.equal(row.initialCaseCreation, false);
  assert.equal(row.componentCode, "I129_ADDITIONAL_BENEFICIARY");
  assert.equal(row.componentType, "FORM_COMPONENT");
  assert.equal(row.parentForm, "I-129");
  assert.equal(row.formName, "Attachment 1 I-129");
  assert.equal(upserts[0].options.upsert, true);
  const again = await maintenance.registerContinuationSheets();
  assert.equal(again[0].rowsAdded, 0, "idempotent");

  upserts.length = 0;
  const dry = await maintenance.registerContinuationSheets({ dryRun: true });
  assert.deepEqual(upserts, []);
  assert.equal(dry[0].rowsAdded, 0);
});

test("component discovery leaves a hand-registered continuation sheet alone, so a registry row that lists Attachment 1 cannot create a duplicate 'review required' component", () => {
  const { CONTINUATION_SHEET_CODES, CONTINUATION_SHEETS } = require("../config/continuationSheets");
  assert.ok(CONTINUATION_SHEET_CODES.has("I129_ADDITIONAL_BENEFICIARY"));
  assert.equal(CONTINUATION_SHEETS[0].name, "Attachment 1 I-129");
  const source = require("node:fs").readFileSync(require.resolve("../../uscis-forms/services/USCISFormComponentDiscoveryService"), "utf8");
  assert.match(source, /CONTINUATION_SHEET_CODES\.has\(row\.componentCode\)\) continue/);
});
