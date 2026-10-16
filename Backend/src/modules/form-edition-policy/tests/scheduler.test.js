// Release 0b-2: the 12-hourly check is part of this subsystem. DB-free: fake store and service.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { runScheduledEditionChecks } = require("../EditionPolicyScheduler");

const day = (iso) => new Date(`${iso}T00:00:00Z`);
const tpl = (formCode, iso, over = {}) => ({ formCode, editionDate: iso ? day(iso) : null, status: "active", importMetadata: { editionDateSource: "pdf" }, ...over });
const fakeService = (script = {}) => {
  const calls = [];
  return { calls, runAutomaticCheck: async (formCode, edition, options) => { calls.push([formCode, edition, options.trigger]); const step = script[formCode]; if (step instanceof Error) throw step; return { outcome: step || "no_explicit_statement" }; } };
};

test("disabled (the default): nothing is checked, nothing is read", async () => {
  let read = false;
  const result = await runScheduledEditionChecks({ enabled: false, store: { listTemplates: async () => { read = true; return []; } }, service: fakeService() });
  assert.deepEqual(result, { enabled: false, checked: 0, tally: {} });
  assert.equal(read, false);
});

test("enabled: every distinct edition with a trusted date is checked once, through the automatic check, tagged as scheduled", async () => {
  const service = fakeService({ "I-131": "accepted", "I-765": "not_accepted" });
  const store = { listTemplates: async () => [
    tpl("I-131", "2025-01-20"), tpl("I-131", "2025-01-20", { status: "review" }), tpl("I-765", "2025-08-21"), tpl("N-400", "2025-01-20"),
    tpl("I-589", "2026-09-15", { importMetadata: { editionDateSource: "version_backfill" } }), // untrusted date: skipped
    tpl("G-325R", null), // no date: skipped
    tpl("I-90", "2025-01-20", { status: "retired" }), // not live or pending: skipped
  ] };
  const result = await runScheduledEditionChecks({ enabled: true, store, service });
  assert.deepEqual(service.calls, [["I-131", "2025-01-20", "scheduled_sync"], ["I-765", "2025-08-21", "scheduled_sync"], ["N-400", "2025-01-20", "scheduled_sync"]]);
  assert.deepEqual(result, { enabled: true, checked: 3, tally: { accepted: 1, not_accepted: 1, no_explicit_statement: 1 } });
});

test("one edition failing never stops the others, and the run never throws", async () => {
  const service = fakeService({ "I-131": new Error("uscis.gov unreachable") });
  const store = { listTemplates: async () => [tpl("I-131", "2025-01-20"), tpl("I-765", "2025-08-21")] };
  const result = await runScheduledEditionChecks({ enabled: true, store, service });
  assert.deepEqual(result.tally, { error: 1, no_explicit_statement: 1 });
  assert.equal(service.calls.length, 2);
  const broken = await runScheduledEditionChecks({ enabled: true, store: { listTemplates: async () => { throw new Error("database down"); } }, service });
  assert.deepEqual([broken.enabled, broken.checked], [true, 0]);
});

test("the 12-hour catalog sync job calls this subsystem after the sync and has no acceptance logic of its own", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "..", "uscis-lifecycle", "jobs", "USCISCatalogSyncJob.js"), "utf8");
  const code = source.split("\n").filter((line) => !line.trim().startsWith("//")).join("\n");
  assert.match(code, /require\("\.\.\/\.\.\/form-edition-policy\/EditionPolicyScheduler"\)/);
  assert.ok(code.indexOf("await runCatalogSync(") > -1 && code.indexOf("await runCatalogSync(") < code.indexOf("await runScheduledEditionChecks()"));
  assert.equal(/EvidenceService|EditionPolicyGate|filingEligibility|decision/i.test(code), false);
});
