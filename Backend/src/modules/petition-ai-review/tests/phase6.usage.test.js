// Petition AI Review - Phase 6 acceptance tests (database-free, no network: Gemini is a stub).
// Proves: every reply's token use is split the way Google bills it (input / output / thinking) and the exact model version is kept;
// tokens of refused, failed and retried attempts are counted too; the batch reviewer and the scan add them up (including the closing
// summary call); the dollar cost comes from configurable prices with safe defaults; the dry-run estimate is sane; a scan can be claimed by
// id (the command line never picks up another scan); bad numbers never corrupt the totals; older scans without the split still display.
const test = require("node:test");
const assert = require("node:assert/strict");
const { Types } = require("mongoose");

const PetitionAiScan = require("../../../models/PetitionAiScan");
const PetitionAiFinding = require("../../../models/PetitionAiFinding");
const { createFakeModel, oneOpenScanPerPetition } = require("./fixtures/fakeModel");
const { createScanService } = require("../scanService");
const { createScanRunner } = require("../scanRunner");
const { createBatchReviewer } = require("../batchReviewer");
const { createGeminiCaller, PetitionAiError, usageOf, addUsage } = require("../petitionGemini");
const { withAiSummary } = require("../summaryBuilder");
const { readConfig } = require("../config");
const { readPricing, costOf, DEFAULT_PRICING } = require("../pricing");
const { estimateScan } = require("../costEstimate");
const { usageView, scanView } = require("../reviewApi.service");
const { buildFacts } = require("../caseFacts");
const { AI_ERROR } = require("../constants");

const CONFIG = readConfig({ GEMINI_API_KEY: "k", PETITION_AI_TIMEOUT_MS: "5000" });
const quiet = { info() {}, warn() {}, error() {} };
const reply = (status, body) => ({ status, json: async () => body });
const meta = (input, output, thinking) => ({ promptTokenCount: input, candidatesTokenCount: output, thoughtsTokenCount: thinking, totalTokenCount: input + output + thinking });
const ok = (text, usage = meta(1000, 200, 300), extra = {}) => reply(200, { candidates: [{ finishReason: "STOP", content: { parts: [{ text }] } }], usageMetadata: usage, modelVersion: "gemini-3.8-flash", ...extra });
function scripted(replies) {
  return async () => {
    const next = replies.length > 1 ? replies.shift() : replies[0];
    if (next instanceof Error) throw next;
    return next;
  };
}
const caller = (replies) => createGeminiCaller({ config: CONFIG, apiKey: "secret", fetchImpl: scripted(replies), sleep: async () => {} });

// ── the caller ──────────────────────────────────────────────────────────
test("caller: input / output / thinking tokens and the exact model version are returned", async () => {
  const result = await caller([ok('{"findings":[]}')]).call({ parts: [{ text: "x" }] });
  assert.deepEqual(result.usage, { input: 1000, output: 200, thinking: 300 });
  assert.equal(result.tokens, 1500);
  assert.equal(result.modelVersion, "gemini-3.8-flash");
  assert.equal(result.model, CONFIG.model);
});

test("caller: tokens of a failed attempt that was retried are added to the successful one", async () => {
  const cutOff = reply(200, { candidates: [{ finishReason: "STOP", content: { parts: [{ text: "" }] } }], usageMetadata: meta(800, 0, 100) }); // empty -> retried? no: EMPTY is not retried
  const busy = reply(503, { error: { message: "overloaded" }, usageMetadata: meta(50, 0, 0) });
  const result = await caller([busy, ok("{}")]).call({ parts: [{ text: "x" }] });
  assert.equal(result.attempts, 2);
  assert.deepEqual(result.usage, { input: 1050, output: 200, thinking: 300 });
  // a failure that is not retried still carries what it used
  await assert.rejects(caller([cutOff]).call({ parts: [{ text: "x" }] }), (error) => error instanceof PetitionAiError && error.usage.input === 800 && error.usage.thinking === 100);
});

test("caller: a reply without usage numbers (or with junk) counts as 0, never NaN", () => {
  assert.deepEqual(usageOf({}), { input: 0, output: 0, thinking: 0 });
  assert.deepEqual(usageOf({ usageMetadata: { promptTokenCount: "abc", candidatesTokenCount: null } }), { input: 0, output: 0, thinking: 0 });
  assert.deepEqual(addUsage(undefined, { input: 2 }), { input: 2, output: 0, thinking: 0 });
});

// ── pricing and estimate ────────────────────────────────────────────────
test("pricing: defaults, overrides from the environment, and junk values fall back to the defaults", () => {
  assert.equal(readPricing({}).inputPerMillion, DEFAULT_PRICING.inputPerMillion);
  assert.equal(readPricing({}).outputPerMillion, DEFAULT_PRICING.outputPerMillion);
  const custom = readPricing({ PETITION_AI_PRICE_INPUT_PER_M: "1.5", PETITION_AI_PRICE_OUTPUT_PER_M: "7.5" });
  assert.deepEqual([custom.inputPerMillion, custom.outputPerMillion, custom.source], [1.5, 7.5, "environment"]);
  const junk = readPricing({ PETITION_AI_PRICE_INPUT_PER_M: "-3", PETITION_AI_PRICE_OUTPUT_PER_M: "free" });
  assert.deepEqual([junk.inputPerMillion, junk.outputPerMillion], [DEFAULT_PRICING.inputPerMillion, DEFAULT_PRICING.outputPerMillion]);
});

test("cost: input at the input price, output AND thinking at the output price", () => {
  const pricing = { inputPerMillion: 0.75, outputPerMillion: 3.75 };
  assert.equal(costOf({ input: 1_000_000, output: 0, thinking: 0 }, pricing), 0.75);
  assert.equal(costOf({ input: 0, output: 500_000, thinking: 500_000 }, pricing), 3.75);
  assert.equal(costOf({ input: 100_000, output: 10_000, thinking: 20_000 }, pricing), 0.1875);
  assert.equal(costOf({ input: -5, output: "x", thinking: null }, pricing), 0);
  assert.equal(costOf(undefined, pricing), 0);
});

test("estimate: calls follow the pages per call; the cost grows with the pages", () => {
  const small = estimateScan({ pages: 10, pagesPerCall: 4, instructionChars: 4000 });
  const big = estimateScan({ pages: 96, pagesPerCall: 4, instructionChars: 4000 });
  assert.equal(small.calls, 3);
  assert.equal(big.calls, 24);
  assert.ok(big.costUsd > small.costUsd && big.costUsd < 1, `96 pages should cost well under $1, got ${big.costUsd}`);
  assert.equal(estimateScan({ pages: 0 }).costUsd, 0);
  assert.equal(estimateScan({ pages: "junk", pagesPerCall: 0 }).calls, 0);
});

// ── batch reviewer ──────────────────────────────────────────────────────
test("batch reviewer: usage of every call (also a failed one that was then halved) is added up, with the model version", async () => {
  const reader = { mode: "pdf", pages: 4, slice: async () => Buffer.alloc(100), text: async (from, to) => Array.from({ length: to - from + 1 }, (_, i) => ({ page: from + i, text: "t" })) };
  let n = 0;
  const fake = {
    model: "gemini-flash-latest",
    call: async () => {
      n += 1;
      if (n === 1) throw new PetitionAiError(AI_ERROR.TRUNCATED, "cut", { usage: { input: 4000, output: 8000, thinking: 1000 }, tokens: 13000, attempts: 1, model: "gemini-flash-latest" });
      return { text: '{"findings":[]}', tokens: 1500, usage: { input: 2000, output: 100, thinking: 200 }, model: "gemini-flash-latest", modelVersion: "gemini-3.8-flash", attempts: 1 };
    },
  };
  const result = await createBatchReviewer({ reader, caller: fake }).review({ from: 1, to: 4 });
  assert.equal(result.calls, 3); // the cut-off call + the two halves
  assert.deepEqual(result.usage, { input: 8000, output: 8200, thinking: 1400 });
  assert.deepEqual(result.modelVersions, ["gemini-3.8-flash"]);
});

// ── summary call ────────────────────────────────────────────────────────
test("summary call: its usage is reported, also when it fails; a throwing counter never breaks the summary", async () => {
  const seen = [];
  const base = { text: "fallback", counts: {} };
  const findings = [{ page: 1, severity: "warning", category: "typo", found: "x" }];
  const good = { call: async () => ({ text: '{"summary":"A short and clear executive summary."}', usage: { input: 10, output: 5, thinking: 1 }, tokens: 16, attempts: 1 }) };
  const out = await withAiSummary({ summary: base, findings, caller: good, onUsage: (value) => seen.push(value.usage) });
  assert.ok(out.aiText);
  const bad = { call: async () => { throw new PetitionAiError(AI_ERROR.BLOCKED, "no", { usage: { input: 7, output: 0, thinking: 0 } }); } };
  assert.equal(await withAiSummary({ summary: base, findings, caller: bad, onUsage: (value) => seen.push(value.usage) }), base);
  assert.deepEqual(seen, [{ input: 10, output: 5, thinking: 1 }, { input: 7, output: 0, thinking: 0 }]);
  const kept = await withAiSummary({ summary: base, findings, caller: good, onUsage: () => { throw new Error("boom"); } });
  assert.ok(kept.aiText);
});

// ── the whole scan ──────────────────────────────────────────────────────
function harness() {
  const Scan = createFakeModel(PetitionAiScan, { unique: oneOpenScanPerPetition });
  const Finding = createFakeModel(PetitionAiFinding);
  return { Scan, Finding, service: createScanService({ Scan, Finding }) };
}
function runner(h, ai, pages = 8) {
  return createScanRunner({
    scanService: h.service,
    config: { ...readConfig({}), pagesPerCall: 4, concurrency: 2, batchDelayMs: 0 },
    logger: quiet,
    sleep: async () => {},
    heartbeatMs: 10 ** 9,
    loadDocument: async (id) => ({ _id: id, documentType: "petition_manual_upload", storageKey: "k", originalName: "petition.pdf" }),
    readBuffer: async () => Buffer.from("%PDF-fake"),
    openReader: async () => ({ pages, mode: "text", slice: async () => Buffer.alloc(10), text: async (from, to) => Array.from({ length: to - from + 1 }, (_, i) => ({ page: from + i, text: `page ${from + i}` })), close: async () => {} }),
    loadFacts: async () => buildFacts({ caseDoc: { caseNumber: "B420", visaType: "EB-1A" } }),
    loadRules: async () => ({ rules: [], expectedAddresses: [], prohibitedTerms: [] }),
    createCaller: () => ai,
    createFallback: () => null,
  });
}
const usageAi = () => ({
  model: "gemini-flash-latest",
  call: async (request) => {
    const prompt = request.parts.map((part) => part.text || "").join("");
    if (/executive summary/.test(prompt)) return { text: '{"summary":"One typo on page one needs a fix soon."}', tokens: 30, usage: { input: 20, output: 5, thinking: 5 }, model: "gemini-flash-latest", modelVersion: "gemini-3.8-flash", attempts: 1 };
    return { text: JSON.stringify({ findings: [{ page: 1, severity: "warning", category: "typo", excerpt: "teh", found: "typo" }] }), tokens: 1600, usage: { input: 1000, output: 100, thinking: 500 }, model: "gemini-flash-latest", modelVersion: "gemini-3.8-flash", attempts: 1 };
  },
});

test("scan: totals per kind, the model version and the dollar cost are stored and shown; the summary costs no AI call", async () => {
  const h = harness();
  const { scan } = await h.service.enqueue({ caseId: new Types.ObjectId(), documentId: new Types.ObjectId(), batchSize: 4 });
  const claim = await h.service.claimNext({ workerId: "t", scanId: scan._id });
  const outcome = await runner(h, usageAi())(claim);
  assert.equal(outcome.state, "completed");
  const stored = await h.Scan.findById(scan._id);
  assert.deepEqual({ ...stored.usage }, { calls: 2, tokens: 3200, input: 2000, output: 200, thinking: 1000 }); // 2 batches; the summary is built in code
  assert.equal(stored.modelVersion, "gemini-3.8-flash");
  const view = scanView(stored, { detail: true });
  assert.equal(view.modelVersion, "gemini-3.8-flash");
  assert.equal(view.usage.costUsd, costOf({ input: 2000, output: 200, thinking: 1000 }));
  assert.ok(view.usage.costUsd > 0);
});

test("claim by id: only the named scan is claimed, never another queued one", async () => {
  const h = harness();
  const first = (await h.service.enqueue({ caseId: new Types.ObjectId(), documentId: new Types.ObjectId() })).scan;
  const mine = (await h.service.enqueue({ caseId: new Types.ObjectId(), documentId: new Types.ObjectId() })).scan;
  const claim = await h.service.claimNext({ workerId: "cli", scanId: mine._id });
  assert.equal(String(claim.scan._id), String(mine._id));
  assert.equal(await h.service.claimNext({ workerId: "cli", scanId: mine._id }), null, "already held");
  assert.equal((await h.Scan.findById(first._id)).status, "queued");
});

test("bad numbers never corrupt the totals; older scans without the split show an unknown cost", async () => {
  const h = harness();
  const { scan } = await h.service.enqueue({ caseId: new Types.ObjectId(), documentId: new Types.ObjectId() });
  const claim = await h.service.claimNext({ workerId: "t" });
  await h.service.recordProgress(claim.scan, claim.lease, { from: 1, to: 1, calls: 1, tokens: 5, usage: { input: "x", output: -4, thinking: NaN } });
  const stored = await h.Scan.findById(scan._id);
  assert.deepEqual([stored.usage.input, stored.usage.output, stored.usage.thinking], [0, 0, 0]);
  const old = usageView({ calls: 12, tokens: 50000 });
  assert.equal(old.costUsd, null);
  assert.equal(old.tokens, 50000);
  assert.equal(usageView(undefined).calls, 0);
});

// ── found by the first live scan: the AI did not know today's date ─────
test("prompt: today's date is given to the AI (a petition dated last week is not 'in the future'); a bad date falls back to now", () => {
  const { buildSystemInstruction } = require("../prompt");
  const { buildRuleSet } = require("../rules");
  const text = buildSystemInstruction({ facts: {}, ruleSet: buildRuleSet({}), today: new Date("2026-11-04T10:00:00Z") });
  assert.match(text, /TODAY'S DATE: 2026-11-04/);
  assert.match(text, /dates up to today .* are NOT in the future/);
  const fallback = buildSystemInstruction({ facts: {}, ruleSet: buildRuleSet({}), today: new Date("junk") });
  assert.match(fallback, new RegExp(`TODAY'S DATE: ${new Date().toISOString().slice(0, 10)}`));
});

// ── owner decisions 2026-11-04: page-by-page bullet summary; the preparer's organisation name is not an issue ──
test("summary: one bullet per page in page order; one issue on the line, two or more as sub-points; section, fix and severity shown", () => {
  const { buildSummary } = require("../summaryBuilder");
  const findings = [
    { page: 47, severity: "info", category: "typo", excerpt: "company.We", found: "Missing space after the period", suggestion: "company. We", section: "Ability to pay" },
    { page: 4, severity: "error", category: "wrong_name", excerpt: "Pratap Krishna Doddaka", found: "The beneficiary is entered as the petitioner", suggestion: "Consello Technologies Inc", section: "Part 1, Applicant Information" },
    { page: 47, severity: "error", category: "consistency", excerpt: "2026", found: "Tax year differs from page 12", suggestion: "", section: "" },
  ];
  const summary = buildSummary({ findings, totalPages: 96, lastPage: 96 });
  const lines = summary.text.split("\n");
  assert.equal(lines[0], "3 issues on 2 pages: 2 to fix, 0 to check, 1 minor.");
  assert.equal(lines[1], "• Page 4 - Part 1, Applicant Information: The beneficiary is entered as the petitioner → Consello Technologies Inc [To fix]");
  assert.equal(lines[2], "• Page 47");
  assert.equal(lines[3], "    ◦ Tax year differs from page 12 [To fix]", "worst first within a page; no section -> no label");
  assert.equal(lines[4], "    ◦ Ability to pay: Missing space after the period → company. We [Minor]");
  assert.equal(lines.at(-1), "AI-assisted - verify before acting.");
  assert.deepEqual(summary.points.map((point) => [point.page, point.items.length]), [[4, 1], [47, 2]]);
  assert.match(buildSummary({ totalPages: 5, lastPage: 5 }).text, /^No issues found on 5 pages checked\./);
});

test("scan: the section the AI names reaches the stored finding AND the bullet summary (end to end)", async () => {
  const h = harness();
  const ai = {
    model: "m",
    call: async () => ({ text: JSON.stringify({ findings: [{ page: 1, severity: "error", category: "typo", excerpt: "teh", found: "typo", section: "Part 1, Item 2" }] }), tokens: 1, usage: {}, model: "m", attempts: 1 }),
  };
  const { scan } = await h.service.enqueue({ caseId: new Types.ObjectId(), documentId: new Types.ObjectId(), batchSize: 4 });
  await runner(h, ai, 4)(await h.service.claimNext({ workerId: "t", scanId: scan._id }));
  const stored = await h.Scan.findById(scan._id);
  assert.equal((await h.Finding.find({ scanId: scan._id }))[0].section, "Part 1, Item 2");
  assert.equal(stored.summary.points[0].items[0].section, "Part 1, Item 2");
  assert.match(stored.summary.text, /• Page 1 - Part 1, Item 2: typo/);
});

test("summary: a very large scan is capped and says how many more issues are in the list", () => {
  const { buildSummary } = require("../summaryBuilder");
  const { LIMITS } = require("../constants");
  const findings = Array.from({ length: LIMITS.maxSummaryItems + 7 }, (_, i) => ({ page: i + 1, severity: "warning", category: "typo", found: `issue ${i + 1}` }));
  const summary = buildSummary({ findings, totalPages: 500, lastPage: 500 });
  assert.equal(summary.points.length, LIMITS.maxSummaryItems);
  assert.equal(summary.more, 7);
  assert.match(summary.text, /and 7 more issues in the list below/);
});

test("findings keep the section the AI names (trimmed, capped); a missing section is empty, never an error", () => {
  const { validateAnswer } = require("../findingValidator");
  const { LIMITS } = require("../constants");
  const { findings } = validateAnswer({ findings: [
    { page: 1, severity: "error", category: "typo", excerpt: "teh", found: "typo", section: "  Part 2,   Item 4  " },
    { page: 2, severity: "error", category: "typo", excerpt: "x", found: "y", section: "S".repeat(500) },
    { page: 3, severity: "error", category: "typo", excerpt: "z", found: "w" },
  ] }, { from: 1, to: 4 });
  assert.deepEqual(findings.map((f) => (f.section.length > 20 ? f.section.length : f.section)), ["Part 2, Item 4", LIMITS.maxSectionChars, ""]);
});

test("organisation name: the check is off by default and comes back with PETITION_AI_BRAND_CHECK=on; the AI is told the name is correct", () => {
  const { buildRuleSet, brandCheckOn } = require("../rules");
  const { buildSystemInstruction } = require("../prompt");
  assert.equal(brandCheckOn({}), false);
  assert.equal(brandCheckOn({ PETITION_AI_BRAND_CHECK: "on" }), true);
  const off = buildRuleSet({});
  assert.equal(off.rules.some((rule) => rule.id === "brand_name"), false);
  assert.match(buildSystemInstruction({ facts: {}, ruleSet: off }), /Bay Area Immigration Services .*CORRECT wherever it appears/);
  const on = buildRuleSet({ brandCheck: true });
  assert.equal(on.rules.some((rule) => rule.id === "brand_name"), true);
  assert.doesNotMatch(buildSystemInstruction({ facts: {}, ruleSet: on }), /CORRECT wherever it appears/);
});

test("organisation name: findings about BAIS / Bay Area are dropped while the check is off; other name findings are kept", async () => {
  const { isOrganisationNameFinding } = require("../rules");
  assert.equal(isOrganisationNameFinding({ category: "company_rule", excerpt: "Business Name: Bay Area Immigration Services", found: "legacy name" }), true);
  assert.equal(isOrganisationNameFinding({ category: "wrong_name", excerpt: "BAIS", found: "x" }), true);
  assert.equal(isOrganisationNameFinding({ category: "wrong_name", excerpt: "Consello Technologies Corp.", found: "should be Inc" }), false);
  assert.equal(isOrganisationNameFinding({ category: "typo", excerpt: "Bay Area Immigration Servces", found: "typo" }), false, "a typo in it is still reported");
  assert.equal(isOrganisationNameFinding({ category: "company_rule", excerpt: "abaissement", found: "x" }), false);
  assert.equal(isOrganisationNameFinding(null), false);

  const reader = { mode: "text", pages: 4, text: async (from, to) => Array.from({ length: to - from + 1 }, (_, i) => ({ page: from + i, text: "t" })) };
  const answer = { findings: [
    { page: 1, severity: "error", category: "company_rule", excerpt: "Bay Area Immigration Services", found: "legacy name" },
    { page: 2, severity: "error", category: "wrong_name", excerpt: "Consello Technologies Corp.", found: "should be Inc" },
  ] };
  const ai = { call: async () => ({ text: JSON.stringify(answer), usage: {}, tokens: 1, model: "m", attempts: 1 }) };
  const result = await createBatchReviewer({ reader, caller: ai, keepFinding: (finding) => !isOrganisationNameFinding(finding) }).review({ from: 1, to: 4 });
  assert.deepEqual(result.findings.map((f) => f.page), [2]);
  const broken = await createBatchReviewer({ reader, caller: ai, keepFinding: () => { throw new Error("boom"); } }).review({ from: 1, to: 4 });
  assert.equal(broken.findings.length, 2, "a failing filter keeps the findings, never loses them");
});
