// Petition AI Review - Phase 2 acceptance tests (database-free, no network: Gemini is a stub).
// Proves: the petition's own Gemini caller (request shape, every reply type mapped, retries only where they help, key never in the URL),
// the prompt, finding validation (real pages, enums, hallucinated pages dropped, duplicates merged), the summary, the backup provider,
// and that the batch reviewer resolves every failure automatically (halve, text mode, repair, re-queue, backup AI, unreadable page).
const test = require("node:test");
const assert = require("node:assert/strict");
const { PDFDocument } = require("pdf-lib");

const { AI_ERROR, CATEGORY } = require("../constants");
const { readConfig } = require("../config");
const { createGeminiCaller, PetitionAiError, THINKING_BUDGET } = require("../petitionGemini");
const { RESPONSE_SCHEMA, buildSystemInstruction, buildBatchPrompt } = require("../prompt");
const { parseAnswer, validateAnswer, dedupeFindings } = require("../findingValidator");
const { buildSummary, withAiSummary } = require("../summaryBuilder");
const { pickFallbackProvider, createFallbackCaller } = require("../fallbackProvider");
const { createBatchReviewer } = require("../batchReviewer");
const { buildRuleSet } = require("../rules");
const { PdfSlicer } = require("../pdfSlicer");
const { classifyReply } = require("../../../../scripts/diagnoseGemini");

const CONFIG = readConfig({ GEMINI_API_KEY: "k", PETITION_AI_TIMEOUT_MS: "5000" });
const KEY = "secret-key-123";
const noSleep = async () => {};

// ── Gemini reply builders ───────────────────────────────────────────────
const reply = (status, body) => ({ status, json: async () => body });
const answer = (obj, finishReason = "STOP", tokens = 50) => reply(200, { candidates: [{ finishReason, content: { parts: [{ text: typeof obj === "string" ? obj : JSON.stringify(obj) }] } }], usageMetadata: { totalTokenCount: tokens } });
function scriptedFetch(replies) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options, body: JSON.parse(options.body) });
    const next = replies.length > 1 ? replies.shift() : replies[0];
    if (next instanceof Error) throw next;
    return typeof next === "function" ? next(calls.at(-1)) : next;
  };
  return { fetchImpl, calls };
}
const caller = (replies, extra = {}) => {
  const fake = scriptedFetch(replies);
  return { ...fake, gemini: createGeminiCaller({ config: CONFIG, apiKey: KEY, fetchImpl: fake.fetchImpl, sleep: noSleep, ...extra }) };
};

// ── the Gemini caller ───────────────────────────────────────────────────
test("caller: sends output budget, small thinking budget and response schema; key only in a header, never in the URL", async () => {
  const { gemini, calls } = caller([answer({ findings: [] })]);
  const result = await gemini.call({ parts: [{ text: "hi" }], systemInstruction: "sys", responseSchema: RESPONSE_SCHEMA });
  assert.equal(result.text, '{"findings":[]}');
  assert.equal(result.tokens, 50);
  const { url, options, body } = calls[0];
  assert.doesNotMatch(url, /secret-key|key=/);
  assert.equal(options.headers["x-goog-api-key"], KEY);
  assert.equal(body.generationConfig.maxOutputTokens, CONFIG.maxOutputTokens);
  assert.equal(body.generationConfig.thinkingConfig.thinkingBudget, THINKING_BUDGET);
  assert.equal(body.generationConfig.responseMimeType, "application/json");
  assert.deepEqual(body.generationConfig.responseSchema, RESPONSE_SCHEMA);
  assert.equal(body.systemInstruction.parts[0].text, "sys");
});

test("caller: thought parts are left out of the answer text", async () => {
  const { gemini } = caller([reply(200, { candidates: [{ finishReason: "STOP", content: { parts: [{ text: "thinking...", thought: true }, { text: '{"findings":[]}' }] } }] })]);
  assert.equal((await gemini.call({ parts: [{ text: "x" }] })).text, '{"findings":[]}');
});

test("caller: no key -> NOT_CONFIGURED without any network call", async () => {
  let called = 0;
  const gemini = createGeminiCaller({ config: CONFIG, apiKey: "", fetchImpl: async () => { called += 1; }, sleep: noSleep });
  await assert.rejects(gemini.call({ parts: [] }), (error) => error.code === AI_ERROR.NOT_CONFIGURED);
  assert.equal(called, 0);
});

for (const [status, code] of [[402, AI_ERROR.BILLING], [429, AI_ERROR.QUOTA], [403, AI_ERROR.BAD_REQUEST], [404, AI_ERROR.BAD_REQUEST]]) {
  test(`caller: HTTP ${status} -> ${code}, sent exactly once (never hammered)`, async () => {
    const { gemini, calls } = caller([reply(status, { error: { message: "nope" } })]);
    await assert.rejects(gemini.call({ parts: [] }), (error) => error.code === code && error.httpStatus === status);
    assert.equal(calls.length, 1);
  });
}

test("caller: 503 is retried with backoff, then UPSTREAM; a later success is returned", async () => {
  const waits = [];
  const fail = caller([reply(503, {})], { sleep: async (ms) => waits.push(ms), retries: 2, backoffMs: 100 });
  await assert.rejects(fail.gemini.call({ parts: [] }), (error) => error.code === AI_ERROR.UPSTREAM && error.attempts === 3);
  assert.equal(fail.calls.length, 3);
  assert.deepEqual(waits, [100, 200]);
  const recover = caller([reply(500, {}), answer({ findings: [] })]);
  assert.equal((await recover.gemini.call({ parts: [] })).attempts, 2);
});

test("caller: network error -> UPSTREAM (retried), timeout -> TIMEOUT", async () => {
  const net = caller([new TypeError("fetch failed")]);
  await assert.rejects(net.gemini.call({ parts: [] }), (error) => error.code === AI_ERROR.UPSTREAM);
  assert.equal(net.calls.length, 3);
  const timeout = Object.assign(new Error("aborted"), { name: "TimeoutError" });
  await assert.rejects(caller([timeout]).gemini.call({ parts: [] }), (error) => error.code === AI_ERROR.TIMEOUT);
});

test("caller: MAX_TOKENS -> TRUNCATED with the partial text; empty -> EMPTY_RESPONSE; safety -> BLOCKED (none retried)", async () => {
  const cut = caller([answer('{"findings":[{"page":', "MAX_TOKENS")]);
  await assert.rejects(cut.gemini.call({ parts: [] }), (error) => error.code === AI_ERROR.TRUNCATED && /findings/.test(error.partialText));
  assert.equal(cut.calls.length, 1);
  await assert.rejects(caller([reply(200, { candidates: [] })]).gemini.call({ parts: [] }), (error) => error.code === AI_ERROR.EMPTY_RESPONSE);
  await assert.rejects(caller([reply(200, { promptFeedback: { blockReason: "SAFETY" } })]).gemini.call({ parts: [] }), (error) => error.code === AI_ERROR.BLOCKED);
});

test("caller: settings rejected (HTTP 400) -> re-sent once without thinking/schema, and kept plain afterwards", async () => {
  const { gemini, calls } = caller([reply(400, { error: { message: "thinking not supported" } }), answer({ findings: [] })]);
  await gemini.call({ parts: [], responseSchema: RESPONSE_SCHEMA });
  assert.equal(calls.length, 2);
  assert.ok(calls[0].body.generationConfig.thinkingConfig);
  assert.equal(calls[1].body.generationConfig.thinkingConfig, undefined);
  assert.equal(calls[1].body.generationConfig.responseSchema, undefined);
  assert.equal(gemini.lean, true);
  await gemini.call({ parts: [], responseSchema: RESPONSE_SCHEMA });
  assert.equal(calls[2].body.generationConfig.thinkingConfig, undefined);
  // a 400 that persists is BAD_REQUEST after the one plain retry
  const still = caller([reply(400, { error: { message: "API key not valid" } })]);
  await assert.rejects(still.gemini.call({ parts: [] }), (error) => error.code === AI_ERROR.BAD_REQUEST);
  assert.equal(still.calls.length, 2);
});

test("the diagnostic script and the caller share one classifier", () => {
  assert.equal(classifyReply(402, {}).code, "BILLING");
  assert.equal(classifyReply(200, { candidates: [{ finishReason: "MAX_TOKENS", content: { parts: [{ text: "{" }] } }] }).code, "TRUNCATED");
});

// ── prompt ──────────────────────────────────────────────────────────────
test("prompt: case facts, expected addresses, every rule and the relative-page instruction are included", () => {
  const ruleSet = buildRuleSet({ prohibitedTerms: ["guaranteed"], stored: { expectedAddresses: [{ label: "FedEx", address: "1 Main St, Dallas, TX 75201" }], extraRules: ["Use US spelling"] } });
  const text = buildSystemInstruction({ facts: { caseNumber: "B243-A", visaType: "H-1B", people: [{ role: "Beneficiary", name: "Hanqi Zhang" }], companies: [{ role: "Petitioner", name: "Ana Corp" }] }, ruleSet });
  for (const expected of ["B243-A", "H-1B", "Beneficiary: Hanqi Zhang", "Petitioner: Ana Corp", "1 Main St, Dallas, TX 75201", "Use US spelling", "guaranteed", "not a law firm", "WITHIN THE PAGES YOU WERE GIVEN"]) assert.match(text, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), expected);
  const none = buildSystemInstruction({ facts: {}, ruleSet: buildRuleSet({}) });
  assert.match(none, /do not report name or case-number mismatches/);
  assert.match(none, /do not report address mismatches/);
});

test("prompt: text mode numbers pages from 1 and marks pages with no text", () => {
  const text = buildBatchPrompt({ batch: { from: 9, to: 10 }, mode: "text", pagesText: [{ page: 9, text: "Hello" }, { page: 10, text: "" }] });
  assert.match(text, /=== PAGE 1 ===\nHello/);
  assert.match(text, /=== PAGE 2 ===\n\(no text could be extracted/);
  assert.match(buildBatchPrompt({ batch: { from: 9, to: 12 }, mode: "pdf" }), /4 page\(s\)/);
});

// ── validation ──────────────────────────────────────────────────────────
test("validator: relative pages become real pages; pages outside the slice and incomplete findings are dropped", () => {
  const batch = { from: 101, to: 104 };
  const { findings, dropped, unreadablePages } = validateAnswer({
    findings: [
      { page: 1, severity: "error", category: "wrong_name", excerpt: "Hanky Zhang", found: "name misspelt", confidence: 0.9 },
      { page: 4, severity: "warning", category: "typo", excerpt: "teh", found: "typo" },
      { page: 5, severity: "error", category: "typo", excerpt: "x", found: "hallucinated page" },
      { page: 0, severity: "error", category: "typo", excerpt: "x", found: "page 0" },
      { page: "2", severity: "error", category: "typo", excerpt: "x" },
      { page: 2, severity: "error", category: "not_a_category", excerpt: "x", found: "y" },
      { page: 3, severity: "error", category: "typo" },
    ],
    unreadablePages: [2, 9],
  }, batch);
  assert.deepEqual(findings.map((f) => f.page), [101, 102, 104], "a page number sent as the string \"2\" is accepted");
  assert.equal(dropped.outOfRange, 2);
  assert.equal(dropped.invalid, 2);
  assert.deepEqual(unreadablePages, [102]);
});

test("validator: aliases, default severity, confidence clamp, text trimmed to the model limits", () => {
  const { findings } = validateAnswer({ findings: [
    { page: 1, severity: "CRITICAL", category: "Spelling", excerpt: "a", found: "b", confidence: 85 },
    { page: 2, category: "address", excerpt: "a".repeat(2000), found: "b", confidence: -3 },
    { page: 3, category: "typo", excerpt: "a", found: "b", confidence: "abc" },
  ] }, { from: 1, to: 3 });
  assert.deepEqual(findings.map((f) => [f.severity, f.category, f.confidence]), [["error", "typo", 0.85], ["warning", "address_mismatch", 0], ["info", "typo", 0.5]]);
  assert.equal(findings[1].excerpt.length, 400);
});

test("validator: duplicates merged (most severe kept); parseAnswer tolerates fences and rejects garbage", () => {
  const merged = dedupeFindings([
    { page: 3, severity: "warning", category: "typo", excerpt: "Teh  cat", found: "x", confidence: 0.4 },
    { page: 3, severity: "error", category: "typo", excerpt: "teh cat", found: "y", confidence: 0.2 },
    { page: 1, severity: "info", category: "typo", excerpt: "z", found: "z", confidence: 0.2 },
  ]);
  assert.deepEqual(merged.map((f) => [f.page, f.severity]), [[1, "info"], [3, "error"]]);
  assert.deepEqual(parseAnswer('```json\n{"findings":[]}\n```'), { findings: [] });
  assert.deepEqual(parseAnswer('Sure! {"findings":[]} hope this helps'), { findings: [] });
  for (const bad of ["", "nope", '{"findings":[', "[1,2]", null]) assert.equal(parseAnswer(bad), null, String(bad));
});

// ── summary ─────────────────────────────────────────────────────────────
test("summary: totals equal the finding counts; pages, categories, gaps and page cap are reported", () => {
  const findings = [
    { page: 2, severity: "error", category: "wrong_name" }, { page: 2, severity: "info", category: "typo" },
    { page: 7, severity: "warning", category: "typo" }, { page: 9, severity: "error", category: "address_mismatch" },
  ];
  const summary = buildSummary({ findings, gaps: [{ from: 20, to: 21 }], totalPages: 40, lastPage: 30, skippedFrom: 31 });
  assert.deepEqual(summary.counts, { error: 2, warning: 1, info: 1 });
  assert.equal(Object.values(summary.byCategory).reduce((a, b) => a + b, 0), findings.length);
  assert.deepEqual(summary.byPage, [{ page: 2, count: 2, worst: "error" }, { page: 7, count: 1, worst: "warning" }, { page: 9, count: 1, worst: "error" }]);
  assert.match(summary.text, /4 issues on 3 pages: 2 to fix, 1 to check, 1 minor/);
  assert.match(summary.text, /• Page 2\n    ◦ /); // two issues on page 2: sub-points (the bullet layout itself is tested in phase6)
  assert.match(summary.text, /• Page 9 - /);
  assert.match(summary.text, /2 pages could not be read/);
  assert.match(summary.text, /Pages 31-40 were not scanned/);
  assert.match(summary.text, /verify before acting/);
  assert.match(buildSummary({ totalPages: 5, lastPage: 5 }).text, /No issues found on 5 pages/);
});

test("summary: the AI executive summary is used when it works and the code-built one is kept on any failure", async () => {
  const base = buildSummary({ findings: [{ page: 1, severity: "error", category: "typo", found: "x" }], totalPages: 1, lastPage: 1 });
  const good = await withAiSummary({ summary: base, findings: [{ page: 1, severity: "error", category: "typo", found: "x" }], caller: { call: async () => ({ text: '{"summary":"One typo on page one needs fixing before filing."}' }) } });
  assert.match(good.text, /^One typo on page one/);
  assert.equal(good.counts.error, 1);
  for (const bad of [async () => { throw new PetitionAiError(AI_ERROR.BILLING); }, async () => ({ text: "not json" }), async () => ({ text: '{"summary":"ok"}' })]) {
    assert.equal((await withAiSummary({ summary: base, findings: [{ page: 1, severity: "error", category: "typo", found: "x" }], caller: { call: bad } })).text, base.text);
  }
  assert.equal(await withAiSummary({ summary: base, findings: [], caller: null }), base);
});

// ── backup provider ─────────────────────────────────────────────────────
test("backup provider: none without another key; picks the first configured non-Gemini provider", () => {
  const definitions = [{ key: "gemini", provider: "gemini", apiKeyEnv: "GEMINI_API_KEY" }, { key: "openai", provider: "openai", apiKeyEnv: "OPENAI_API_KEY", endpoint: "x" }, { key: "anthropic", provider: "anthropic", apiKeyEnv: "ANTHROPIC_API_KEY" }];
  assert.equal(pickFallbackProvider({ definitions, env: { GEMINI_API_KEY: "g" } }), null);
  assert.equal(pickFallbackProvider({ definitions, env: { GEMINI_API_KEY: "g", ANTHROPIC_API_KEY: "a" } }).key, "anthropic");
  assert.equal(createFallbackCaller({ provider: null }), null);
});

test("backup provider: findings returned as JSON text; registry errors and non-findings answers become typed errors", async () => {
  const provider = { key: "anthropic", provider: "anthropic", model: "m", displayName: "Anthropic" };
  const ok = createFallbackCaller({ provider, registry: { generate: async (request) => { assert.equal(request.providerKey, "anthropic"); return { data: { findings: [] }, model: "m", usage: { totalTokens: 9 } }; } } });
  assert.deepEqual(JSON.parse((await ok.call({ parts: [{ text: "a" }] })).text), { findings: [] });
  const cases = [[{ status: 402 }, AI_ERROR.BILLING], [{ status: 429 }, AI_ERROR.QUOTA], [{ status: 503 }, AI_ERROR.UPSTREAM], [{ code: "AI_CREDENTIAL_MISSING" }, AI_ERROR.NOT_CONFIGURED]];
  for (const [error, code] of cases) {
    const failing = createFallbackCaller({ provider, registry: { generate: async () => { throw Object.assign(new Error("x"), error); } } });
    await assert.rejects(failing.call({ parts: [] }), (e) => e.code === code, code);
  }
  const prose = createFallbackCaller({ provider, registry: { generate: async () => ({ data: { answer: "looks fine" } }) } });
  await assert.rejects(prose.call({ parts: [] }), (e) => e.code === AI_ERROR.BAD_OUTPUT);
});

// ── batch reviewer: every failure resolved in code ──────────────────────
function fakeReader({ mode = "pdf", pages = 100, text = (page) => `Text of page ${page}`, sliceBytes = 1000, failSlice = false, failText = false } = {}) {
  const log = { slices: [], texts: [] };
  return {
    log, mode, pages,
    slice: async (from, to) => { log.slices.push([from, to]); if (failSlice) throw Object.assign(new Error("bad pdf"), { code: "PDF_UNREADABLE" }); return Buffer.alloc(typeof sliceBytes === "function" ? sliceBytes(from, to) : sliceBytes); },
    text: async (from, to) => { log.texts.push([from, to]); if (failText) throw Object.assign(new Error("gone"), { code: "PDF_SLICER_CRASHED" }); return Array.from({ length: to - from + 1 }, (_, i) => ({ page: from + i, text: text(from + i) })); },
  };
}
// A stub caller driven by a function of (request, call number). It tells pdf from text requests by the parts.
function fakeCaller(handler, { model = "gemini-test" } = {}) {
  const calls = [];
  return {
    calls,
    call: async (request) => {
      const isPdf = Boolean(request.parts.find((part) => part.inlineData));
      const promptText = request.parts.map((part) => part.text || "").join("");
      const pageCount = isPdf ? Number(/holds (\d+) page/.exec(promptText)?.[1]) : (promptText.match(/=== PAGE/g) || []).length;
      const entry = { isPdf, pageCount, repair: /previous answer was not valid JSON/.test(promptText), promptText };
      calls.push(entry);
      const result = await handler(entry, calls.length);
      if (result instanceof Error) throw result;
      return { text: typeof result === "string" ? result : JSON.stringify(result), tokens: 10, latencyMs: 1, model, finishReason: "STOP", attempts: 1 };
    },
  };
}
const aiError = (code) => new PetitionAiError(code, code.toLowerCase());
const oneFindingPerPage = (entry) => ({ findings: Array.from({ length: entry.pageCount }, (_, i) => ({ page: i + 1, severity: "warning", category: "typo", excerpt: `word ${i + 1}`, found: "typo" })) });
const pagesOf = (result) => [...new Set(result.findings.map((f) => f.page))].sort((a, b) => a - b);

test("reviewer: a normal batch gives findings on the right real pages, with diagnostics and usage", async () => {
  const gemini = fakeCaller(oneFindingPerPage);
  const result = await createBatchReviewer({ reader: fakeReader(), caller: gemini }).review({ from: 21, to: 24 });
  assert.deepEqual(pagesOf(result), [21, 22, 23, 24]);
  assert.equal(result.calls, 1);
  assert.equal(result.tokens, 10);
  assert.deepEqual(result.models, ["gemini-test"]);
  assert.equal(result.requeue, false);
  assert.equal(result.diagnostics[0].outcome, "OK");
  assert.equal(gemini.calls[0].isPdf, true);
});

test("reviewer: TRUNCATED halves the batch down to single pages and still covers every page exactly once", async () => {
  const gemini = fakeCaller((entry) => (entry.pageCount > 1 ? aiError(AI_ERROR.TRUNCATED) : oneFindingPerPage(entry)));
  const result = await createBatchReviewer({ reader: fakeReader(), caller: gemini }).review({ from: 1, to: 4 });
  assert.deepEqual(pagesOf(result), [1, 2, 3, 4]);
  assert.equal(result.findings.length, 4);
  assert.equal(result.gaps.length, 0);
});

test("reviewer: a single page still TRUNCATED goes as text, then is flagged unreadable (never skipped)", async () => {
  const result = await createBatchReviewer({ reader: fakeReader(), caller: fakeCaller(() => aiError(AI_ERROR.TRUNCATED)) }).review({ from: 7, to: 7 });
  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0].category, CATEGORY.UNREADABLE_PAGE);
  assert.deepEqual(result.gaps.map((g) => [g.from, g.to]), [[7, 7]]);
});

test("reviewer: blocked / empty PDF answer is re-sent as text and succeeds", async () => {
  for (const code of [AI_ERROR.BLOCKED, AI_ERROR.EMPTY_RESPONSE]) {
    const gemini = fakeCaller((entry) => (entry.isPdf ? aiError(code) : oneFindingPerPage(entry)));
    const result = await createBatchReviewer({ reader: fakeReader(), caller: gemini }).review({ from: 5, to: 8 });
    assert.deepEqual(pagesOf(result), [5, 6, 7, 8], code);
    assert.deepEqual(gemini.calls.map((c) => c.isPdf), [true, false]);
  }
});

test("reviewer: a page blocked even as text is isolated by halving; only that page is flagged unreadable", async () => {
  const gemini = fakeCaller((entry) => (entry.isPdf || /page 6\b/.test(entry.promptText) ? aiError(AI_ERROR.BLOCKED) : oneFindingPerPage(entry)));
  const result = await createBatchReviewer({ reader: fakeReader(), caller: gemini }).review({ from: 5, to: 8 });
  assert.deepEqual(pagesOf(result), [5, 6, 7, 8]);
  assert.equal(result.findings.find((f) => f.page === 6).category, CATEGORY.UNREADABLE_PAGE);
  assert.ok(result.findings.filter((f) => f.page !== 6).every((f) => f.category === "typo"));
  assert.deepEqual(result.gaps.map((g) => [g.from, g.to]), [[6, 6]]);
  assert.equal(result.requeue, false);
});

test("reviewer: invalid JSON is repaired with one stricter re-ask", async () => {
  const gemini = fakeCaller((entry) => (entry.repair ? { findings: [{ page: 1, severity: "error", category: "typo", excerpt: "x", found: "y" }] } : "this is not json"));
  const result = await createBatchReviewer({ reader: fakeReader(), caller: gemini }).review({ from: 3, to: 4 });
  assert.deepEqual(pagesOf(result), [3]);
  assert.deepEqual(gemini.calls.map((c) => c.repair), [false, true]);
});

test("reviewer: JSON that stays invalid is halved, and a single page that stays invalid is re-queued (not lost)", async () => {
  const result = await createBatchReviewer({ reader: fakeReader(), caller: fakeCaller(() => "garbage") }).review({ from: 1, to: 2 });
  assert.equal(result.requeue, true);
  assert.deepEqual(result.gaps.map((g) => [g.from, g.to, g.retry]), [[1, 1, true], [2, 2, true]]);
});

test("reviewer: 5xx / timeout after the caller's retries re-queues the batch; a plain Error from a caller is handled the same way", async () => {
  for (const failure of [aiError(AI_ERROR.UPSTREAM), aiError(AI_ERROR.TIMEOUT), new Error("socket hang up")]) {
    const result = await createBatchReviewer({ reader: fakeReader(), caller: fakeCaller(() => failure) }).review({ from: 9, to: 12 });
    assert.equal(result.requeue, true);
    assert.deepEqual(result.gaps.map((g) => [g.from, g.to]), [[9, 12]]);
    assert.equal(result.findings.length, 0);
  }
});

test("reviewer: billing / quota / rejected / no key WITHOUT a backup stops the run with a typed error", async () => {
  for (const code of [AI_ERROR.BILLING, AI_ERROR.QUOTA, AI_ERROR.BAD_REQUEST, AI_ERROR.NOT_CONFIGURED]) {
    await assert.rejects(createBatchReviewer({ reader: fakeReader(), caller: fakeCaller(() => aiError(code)) }).review({ from: 1, to: 4 }), (error) => error.code === code && error.stopsRun === true, code);
  }
});

test("reviewer: billing WITH a backup switches to it in text mode, and later batches go straight to the backup", async () => {
  const gemini = fakeCaller(() => aiError(AI_ERROR.BILLING));
  const backup = fakeCaller(oneFindingPerPage, { model: "claude-backup" });
  const reviewer = createBatchReviewer({ reader: fakeReader(), caller: gemini, fallbackCaller: backup });
  const first = await reviewer.review({ from: 1, to: 4 });
  assert.deepEqual(pagesOf(first), [1, 2, 3, 4]);
  assert.equal(first.usedFallback, true);
  assert.ok(backup.calls.every((c) => !c.isPdf));
  const second = await reviewer.review({ from: 5, to: 8 });
  assert.deepEqual(pagesOf(second), [5, 6, 7, 8]);
  assert.equal(gemini.calls.length, 1, "Gemini is not called again after billing failed");
  assert.equal(reviewer.usingFallback, true);
});

test("reviewer: the backup also failing for billing stops the run (no loop between the two)", async () => {
  const reviewer = createBatchReviewer({ reader: fakeReader(), caller: fakeCaller(() => aiError(AI_ERROR.QUOTA)), fallbackCaller: fakeCaller(() => aiError(AI_ERROR.BILLING)) });
  await assert.rejects(reviewer.review({ from: 1, to: 4 }), (error) => error.stopsRun && error.code === AI_ERROR.BILLING);
});

test("reviewer: reader in text mode (pdf-lib could not open the file) never sends a PDF", async () => {
  const gemini = fakeCaller(oneFindingPerPage);
  const reader = fakeReader({ mode: "text" });
  const result = await createBatchReviewer({ reader, caller: gemini }).review({ from: 1, to: 3 });
  assert.deepEqual(pagesOf(result), [1, 2, 3]);
  assert.equal(reader.log.slices.length, 0);
  assert.ok(gemini.calls.every((c) => !c.isPdf));
});

test("reviewer: slicing failure falls back to text; an oversized slice is halved, then a single oversized page goes as text", async () => {
  const fromText = await createBatchReviewer({ reader: fakeReader({ failSlice: true }), caller: fakeCaller(oneFindingPerPage) }).review({ from: 1, to: 2 });
  assert.deepEqual(pagesOf(fromText), [1, 2]);
  const gemini = fakeCaller(oneFindingPerPage);
  const big = fakeReader({ sliceBytes: (from, to) => (to - from + 1) * 9 * 1024 * 1024 }); // 9 MB a page, limit 15 MB
  const result = await createBatchReviewer({ reader: big, caller: gemini }).review({ from: 1, to: 4 });
  assert.deepEqual(pagesOf(result), [1, 2, 3, 4]);
  assert.ok(gemini.calls.every((c) => c.pageCount === 1 && c.isPdf), "2-page halves (18 MB) are split again; single 9 MB pages fit and go as PDF");
  const huge = fakeCaller(oneFindingPerPage);
  const single = await createBatchReviewer({ reader: fakeReader({ sliceBytes: 20 * 1024 * 1024 }), caller: huge }).review({ from: 9, to: 9 });
  assert.deepEqual(pagesOf(single), [9]);
  assert.equal(huge.calls[0].isPdf, false, "a single page over the limit goes as text");
});

test("reviewer: pages with no text in text mode are flagged unreadable without spending an AI call", async () => {
  const gemini = fakeCaller(oneFindingPerPage);
  const reader = fakeReader({ mode: "text", text: (page) => (page === 2 ? "" : `text ${page}`) });
  const result = await createBatchReviewer({ reader, caller: gemini }).review({ from: 1, to: 3 });
  assert.equal(result.findings.find((f) => f.page === 2).category, CATEGORY.UNREADABLE_PAGE);
  const allBlank = await createBatchReviewer({ reader: fakeReader({ mode: "text", text: () => "  " }), caller: gemini }).review({ from: 4, to: 5 });
  assert.equal(allBlank.findings.length, 2);
  assert.equal(gemini.calls.length, 1, "the all-blank batch made no call");
  const gone = await createBatchReviewer({ reader: fakeReader({ mode: "text", failText: true }), caller: gemini }).review({ from: 6, to: 6 });
  assert.equal(gone.findings[0].category, CATEGORY.UNREADABLE_PAGE);
});

test("reviewer: page numbers the AI reports outside the pages sent are dropped and noted", async () => {
  const gemini = fakeCaller(() => ({ findings: [{ page: 1, category: "typo", excerpt: "a", found: "b" }, { page: 30, category: "typo", excerpt: "c", found: "d" }] }));
  const result = await createBatchReviewer({ reader: fakeReader(), caller: gemini }).review({ from: 50, to: 53 });
  assert.deepEqual(pagesOf(result), [50]);
  assert.ok(result.diagnostics.some((d) => d.outcome === "DROPPED" && /1 outside/.test(d.note)));
});

test("reviewer: end to end with the REAL PDF reader and the real Gemini caller on a stubbed network", async () => {
  const doc = await PDFDocument.create();
  for (let page = 1; page <= 8; page += 1) doc.addPage([200, 200]).drawText(`Page ${page} teh`, { x: 5, y: 100, size: 8 });
  const reader = await PdfSlicer.open(Buffer.from(await doc.save()));
  try {
    const { fetchImpl, calls } = scriptedFetch([(call) => {
      const pdf = call.body.contents[0].parts.find((part) => part.inlineData);
      assert.equal(pdf.inlineData.mimeType, "application/pdf");
      assert.ok(Buffer.from(pdf.inlineData.data, "base64").subarray(0, 5).toString() === "%PDF-");
      return answer({ findings: [{ page: 2, severity: "info", category: "typo", excerpt: "teh", found: "should be 'the'", suggestion: "the", confidence: 0.9 }] });
    }]);
    const gemini = createGeminiCaller({ config: CONFIG, apiKey: KEY, fetchImpl, sleep: noSleep });
    const reviewer = createBatchReviewer({ reader, caller: gemini, systemInstruction: "sys" });
    const results = [await reviewer.review({ from: 1, to: 4 }), await reviewer.review({ from: 5, to: 8 })];
    assert.deepEqual(results.flatMap((r) => r.findings.map((f) => f.page)), [2, 6]);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].body.systemInstruction.parts[0].text, "sys");
  } finally {
    await reader.close();
  }
});
