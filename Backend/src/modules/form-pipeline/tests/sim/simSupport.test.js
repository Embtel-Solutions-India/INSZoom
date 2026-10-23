// Phase 7.8: the pieces of the simulation that need no database - the fake uscis.gov, the damaged-PDF builders, the summary arithmetic and the history replay. If these are wrong the
// scenario results mean nothing, so they are tested on their own.
const test = require("node:test");
const assert = require("node:assert/strict");
const { createFakeUscis } = require("../../../../test-utils/editionSim/fakeUscis");
const faultPdfs = require("../../../../test-utils/editionSim/faultPdfs");
const { buildBaseEdition } = require("../../../../test-utils/editionSim/basePdf");
const PdfDownload = require("../../../uscis-form-import/services/PdfDownload");
const { summarize } = require("../../../../scripts/runEditionSimulation");
const replay = require("../../../../scripts/replayPipelineHistory");
const { corpus } = require("../../../../test-utils/editionSim/historyCorpus");

const URL_A = "https://www.uscis.gov/sites/default/files/document/forms/x.pdf";

test("fake uscis.gov: sequences answer in order and repeat the last; a cache-busting query reaches the same route; unknown addresses are 404", async () => {
  const pdf = await buildBaseEdition();
  const site = createFakeUscis({ [URL_A]: [{ status: 503 }, { pdf }] });
  assert.equal((await site.fetchImpl(URL_A)).status, 503);
  assert.equal((await site.fetchImpl(`${URL_A}?_dl=1`)).status, 200);
  assert.equal((await site.fetchImpl(URL_A)).status, 200, "the last answer repeats");
  assert.equal((await site.fetchImpl("https://www.uscis.gov/nothing")).status, 404);
  assert.equal(site.hits(URL_A), 2);
});

test("fake uscis.gov: function routes see the call count; a slow route is cut by the real fetcher's timeout", async () => {
  const site = createFakeUscis({ [URL_A]: ({ count }) => ({ status: 200, body: `call ${count}`, contentType: "text/plain" }) });
  assert.equal(await (await site.fetchImpl(URL_A)).text(), "call 1");
  assert.equal(await (await site.fetchImpl(URL_A)).text(), "call 2");
  const slow = createFakeUscis({ [URL_A]: { pdf: Buffer.from("%PDF-1.4"), delayMs: 2000 } });
  const result = await slow.fetcher(URL_A, { accept: "pdf", timeoutMs: 100 });
  assert.equal(result.ok, false);
  assert.match(String(result.error), /no response within 100 ms/);
});

test("the real fetcher still refuses what production refuses, whatever the fake serves", async () => {
  const site = createFakeUscis({ "https://example.com/x.pdf": { pdf: Buffer.from("%PDF-1.4") } });
  const result = await site.fetcher("https://example.com/x.pdf", { accept: "pdf" });
  assert.equal(result.ok, false);
  assert.equal(site.log.length, 0, "no request was even made to a host that is not uscis.gov");
});

test("damaged-PDF builders produce exactly what the importer's checks look for", async () => {
  const base = await buildBaseEdition();
  assert.equal(PdfDownload.looksComplete(base), true);
  assert.equal(PdfDownload.looksComplete(faultPdfs.truncate(base)), false, "a truncated file has no %%EOF near its end");
  const junk = faultPdfs.withJunk(base);
  assert.equal(PdfDownload.trimLeadingJunk(junk).ok, true);
  assert.equal(PdfDownload.trimLeadingJunk(junk).buffer.subarray(0, 5).toString(), "%PDF-");
  assert.equal(PdfDownload.detectXfaOnly(await faultPdfs.buildXfaOnly()).xfaOnly, true);
  assert.equal(PdfDownload.detectXfaOnly(base).xfaOnly, false);
  assert.throws(() => faultPdfs.truncate(Buffer.alloc(100)), /too small/);
});

test("summarize: autonomy rate counts only autonomous scenarios; correct holds are 'held', skipped ones are left out of the rate; loss and corruption add up", () => {
  const results = [
    { id: "a", mode: "on", autonomous: true, outcome: "autonomous", endState: "released", loss: 0, corruption: 0, matchesExpectation: true },
    { id: "b", mode: "on", autonomous: false, outcome: "held", endState: "held:x", loss: 0, corruption: 0, matchesExpectation: true },
    { id: "c", mode: "on", autonomous: false, held: true, endState: "held", matchesExpectation: true },
    { id: "d", mode: "on", autonomous: false, outcome: "parked", endState: "released_cases_parked", loss: 0, corruption: 0, matchesExpectation: true },
    { id: "e", mode: "on", endState: "skipped: no qpdf", matchesExpectation: null },
    { id: "f", mode: "on", autonomous: false, endState: "dead_letter", knownDefect: "x", matchesExpectation: false },
    { id: "g", mode: "on", autonomous: false, endState: "released", loss: 1, corruption: 2, matchesExpectation: false },
  ];
  const summary = summarize(results);
  assert.equal(summary.total, 7);
  assert.equal(summary.autonomous, 1);
  assert.equal(summary.held, 2);
  assert.equal(summary.parked, 1);
  assert.equal(summary.skipped, 1);
  assert.equal(summary.autonomyRate, Number((1 / 6).toFixed(3)));
  assert.equal(summary.loss, 1);
  assert.equal(summary.corruption, 2);
  assert.equal(summary.unexpected, 1, "a known defect is listed separately, not as unexpected");
  assert.deepEqual(summary.knownDefects.map((item) => item.id), ["f"]);
});

test("history replay: every recorded failure of the sample ends in strategies, a backoff retry or a programming error; none is left uncovered", async () => {
  const { results, summary } = await replay.replay(corpus);
  assert.equal(summary.total, corpus.length);
  assert.equal(summary.ok, true, JSON.stringify(summary.uncovered));
  assert.equal(results.filter((item) => item.verdict === "own_code_bug").length, 1, "only the TypeError sample is a programming error");
  const planned = Object.fromEntries(results.filter((item) => item.stage === "detect" && item.cause === "source_not_found").map((item) => [item.formCode, item.planned.length]));
  for (const code of ["I-485J", "I-539A"]) assert.ok(planned[code] >= 5, `${code}: the source resolver's five steps are planned`);
  assert.equal(results.find((item) => item.formCode === "I-129" && item.cause === "tool_unavailable").planned[0], "reprobe");
});

test("history replay: a failure with no strategy and no retry is reported as uncovered; raw job documents are flattened; names and codes are rebuilt", async () => {
  const { diagnose } = require("../../resolution");
  const noStrategies = { plan: async ({ error }) => ({ diagnosis: diagnose({ error, stage: "import" }), planned: [] }) };
  const { summary } = await replay.replay([{ formCode: "I-1", stage: "import", message: "Downloaded resource is not a PDF", code: "DOWNLOADED_RESOURCE_NOT_PDF" }], { resolver: noStrategies });
  assert.equal(summary.ok, false);
  assert.equal(summary.uncovered[0].formCode, "I-1");
  const flat = replay.recordsFromJobs([{ formCode: "I-9", state: "dead_letter", lastError: { message: "boom", code: "X", stage: "map" }, stages: { import: { status: "failed", error: { message: "qpdf binary not found", code: "QPDF_NOT_FOUND" } }, detect: { status: "done" } } }]);
  assert.deepEqual(flat.map((item) => [item.stage, item.code]), [["map", "X"], ["import", "QPDF_NOT_FOUND"]]);
  assert.equal(replay.toError({ message: "TypeError: x is not a function" }) instanceof TypeError, true);
  assert.equal(replay.toError({ message: "gone", code: "E", status: 404 }).statusCode, 404);
});
