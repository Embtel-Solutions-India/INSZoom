// Petition AI Review - Phase 1 acceptance tests (database-free).
// Proves: settings parsing, page batch planning (each page exactly once, resume, split, page cap), the rule set, the three models' validation,
// and the off-thread PDF slicer (right pages, every error case typed, the main thread stays responsive on a 700-page petition).
const test = require("node:test");
const assert = require("node:assert/strict");
const { PDFDocument } = require("pdf-lib");

const { readConfig, resolveApiKey, keySource } = require("../config");
const { planBatches, splitBatch, toAbsolutePage, coversExactlyOnce } = require("../batchPlanner");
const { buildRuleSet, loadRules, FIXED_RULES } = require("../rules");
const { PdfSlicer, PdfSliceError } = require("../pdfSlicer");
const { PDF_ERROR, SCAN_STATUS } = require("../constants");
const PetitionAiScan = require("../../../models/PetitionAiScan");
const PetitionAiFinding = require("../../../models/PetitionAiFinding");
const PetitionAiRules = require("../../../models/PetitionAiRules");
const { Types } = require("mongoose");

// A petition whose page N is (100 + N) points wide: a slice's page widths prove exactly which pages were copied.
async function makePetition(pageCount) {
  const doc = await PDFDocument.create();
  for (let page = 1; page <= pageCount; page += 1) doc.addPage([100 + page, 200]).drawText(`Page ${page}`, { x: 5, y: 100, size: 8 });
  return Buffer.from(await doc.save());
}
async function widthsOf(bytes) {
  const doc = await PDFDocument.load(bytes);
  return doc.getPages().map((page) => Math.round(page.getWidth()));
}

// ── settings ────────────────────────────────────────────────────────────
test("config: safe defaults, master switch, key precedence, and the key is never part of the config object", () => {
  const defaults = readConfig({});
  assert.equal(defaults.enabled, true);
  assert.equal(defaults.keyConfigured, false);
  assert.equal(defaults.pagesPerCall, 4);
  assert.equal(defaults.concurrency, 2);
  assert.equal(defaults.maxPages, 1500);
  assert.equal(defaults.model, "gemini-flash-latest");
  for (const off of ["off", "false", "0", "no", "disabled", " OFF "]) assert.equal(readConfig({ PETITION_AI_REVIEW: off }).enabled, false, off);
  assert.equal(readConfig({ PETITION_AI_REVIEW: "on" }).enabled, true);
  const env = { GEMINI_API_KEY: "gem-secret", PETITION_AI_API_KEY: "pet-secret", GEMINI_MODEL: "gemini-x" };
  assert.equal(keySource(env), "PETITION_AI_API_KEY");
  assert.equal(resolveApiKey(env), "pet-secret");
  assert.equal(keySource({ GEMINI_API_KEY: "gem-secret" }), "GEMINI_API_KEY");
  assert.equal(readConfig(env).model, "gemini-x");
  assert.equal(readConfig({ ...env, PETITION_AI_MODEL: "gemini-y" }).model, "gemini-y");
  assert.ok(!JSON.stringify(readConfig(env)).includes("secret"), "the key value must never be inside the config");
  assert.equal(readConfig({ PETITION_AI_PAGES_PER_CALL: "999", PETITION_AI_CONCURRENCY: "-3" }).pagesPerCall, 10);
  assert.equal(readConfig({ PETITION_AI_CONCURRENCY: "-3" }).concurrency, 1);
  assert.equal(readConfig({ PETITION_AI_MAX_PAGES: "abc" }).maxPages, 1500);
});

// ── batch planner ───────────────────────────────────────────────────────
test("planner: 37 pages in batches of 4 cover every page exactly once (1-4, 5-8 ... 37-37)", () => {
  const { batches, lastPage, skippedFrom } = planBatches({ totalPages: 37, batchSize: 4 });
  assert.equal(batches.length, 10);
  assert.deepEqual(batches[0], { from: 1, to: 4 });
  assert.deepEqual(batches[9], { from: 37, to: 37 });
  assert.equal(lastPage, 37);
  assert.equal(skippedFrom, null);
  assert.ok(coversExactlyOnce(batches, 1, 37));
});

test("planner: resuming from ANY page leaves no gap and no overlap", () => {
  for (let total = 1; total <= 41; total += 1) {
    for (let size = 1; size <= 6; size += 1) {
      for (let resume = 1; resume <= total; resume += 1) {
        const done = planBatches({ totalPages: total, batchSize: size }).batches.filter((batch) => batch.to < resume);
        const rest = planBatches({ totalPages: total, batchSize: size, startPage: resume }).batches;
        const all = [...done.map((batch) => ({ ...batch })), ...rest];
        // pages before `resume` that the "done" part does not cover are exactly the pages of a batch that was in flight - rebuild coverage page by page
        const seen = new Map();
        for (const batch of [...planBatches({ totalPages: total, batchSize: size, startPage: 1 }).batches.filter((b) => b.to < resume), ...rest]) {
          for (let page = batch.from; page <= batch.to; page += 1) seen.set(page, (seen.get(page) || 0) + 1);
        }
        for (let page = resume; page <= total; page += 1) assert.equal(seen.get(page), 1, `total ${total} size ${size} resume ${resume} page ${page}`);
        assert.ok(rest.every((batch) => batch.from >= resume));
        assert.ok(all.length >= rest.length);
      }
    }
  }
});

test("planner: the page cap stops at maxPages and reports the first skipped page", () => {
  const { batches, lastPage, skippedFrom } = planBatches({ totalPages: 700, batchSize: 4, maxPages: 650 });
  assert.equal(lastPage, 650);
  assert.equal(skippedFrom, 651);
  assert.ok(coversExactlyOnce(batches, 1, 650));
  assert.deepEqual(planBatches({ totalPages: 0, batchSize: 4 }).batches, []);
  assert.deepEqual(planBatches({ totalPages: 5, batchSize: 4, startPage: 9 }).batches, []);
});

test("planner: splitting a batch keeps exactly the same pages; one page cannot be split", () => {
  for (const batch of [{ from: 1, to: 2 }, { from: 5, to: 8 }, { from: 10, to: 19 }, { from: 37, to: 39 }]) {
    const halves = splitBatch(batch);
    assert.ok(coversExactlyOnce(halves, batch.from, batch.to));
  }
  assert.equal(splitBatch({ from: 7, to: 7 }), null);
});

test("planner: a page number reported inside a slice maps to the right absolute page, and out-of-slice numbers are rejected", () => {
  const batch = { from: 121, to: 124 };
  assert.equal(toAbsolutePage(batch, 1), 121);
  assert.equal(toAbsolutePage(batch, 4), 124);
  for (const bad of [0, 5, -1, 2.5, "x", null, undefined, 121]) assert.equal(toAbsolutePage(batch, bad), null, String(bad));
});

// ── rules ───────────────────────────────────────────────────────────────
test("rules: fixed company rules always present; addresses and team rules added; prohibited terms fall back to the compliance defaults", () => {
  const empty = buildRuleSet();
  assert.deepEqual(empty.rules.map((rule) => rule.id), FIXED_RULES.map((rule) => rule.id));
  assert.match(empty.disclaimer, /Immiglance is not a law firm/);
  assert.ok(empty.prohibitedTerms.includes("guaranteed"));
  assert.ok(empty.legacyBrandNames.includes("BAIS"));
  const full = buildRuleSet({
    disclaimer: "Custom disclaimer",
    prohibitedTerms: ["guaranteed", "guaranteed", "  "],
    stored: { version: 3, expectedAddresses: [{ label: "FedEx", address: "USCIS, 2501 S State Hwy 121, Lewisville, TX 75067" }, { label: "blank", address: "  " }], extraRules: ["Receipt numbers must start with IOE", ""] },
  });
  assert.equal(full.version, 3);
  assert.equal(full.disclaimer, "Custom disclaimer");
  assert.deepEqual(full.prohibitedTerms, ["guaranteed"]);
  assert.equal(full.expectedAddresses.length, 1);
  assert.equal(full.rules.at(-1).id, "team_rule_1");
  assert.match(full.rules.at(-1).text, /IOE/);
});

test("rules: loadRules never throws, even when every source fails", async () => {
  const broken = await loadRules({
    entityConfig: { resolveDisclaimer: () => Promise.reject(new Error("db down")), resolveProhibitedTerms: () => Promise.reject(new Error("db down")) },
    RulesModel: { findOne: () => ({ lean: () => Promise.reject(new Error("db down")) }) },
  });
  assert.ok(broken.rules.length >= FIXED_RULES.length);
  assert.match(broken.disclaimer, /not a law firm/);
  const ok = await loadRules({
    entityConfig: { resolveDisclaimer: async () => ({ text: "From settings" }), resolveProhibitedTerms: async () => ["sure thing"] },
    RulesModel: { findOne: () => ({ lean: async () => ({ version: 2, expectedAddresses: [{ address: "1 Main St" }], extraRules: [] }) }) },
  });
  assert.equal(ok.disclaimer, "From settings");
  assert.deepEqual(ok.prohibitedTerms, ["sure thing"]);
  assert.equal(ok.expectedAddresses[0].address, "1 Main St");
});

// ── models (validation only, no database) ───────────────────────────────
test("models: a valid scan / finding / rules record passes validation; bad values are rejected", () => {
  const ids = { caseId: new Types.ObjectId(), documentId: new Types.ObjectId() };
  const scan = new PetitionAiScan({ ...ids });
  assert.equal(scan.validateSync(), undefined);
  assert.equal(scan.status, SCAN_STATUS.QUEUED);
  assert.equal(scan.open, true);
  assert.equal(scan.nextPage, 1);
  assert.ok(new PetitionAiScan({ ...ids, status: "exploded" }).validateSync()?.errors?.status);
  assert.ok(new PetitionAiScan({ caseId: ids.caseId }).validateSync()?.errors?.documentId);
  assert.ok(PetitionAiScan.schema.indexes().some(([, options]) => options?.name === "one_open_scan_per_petition" && options.unique));

  const finding = new PetitionAiFinding({ ...ids, scanId: new Types.ObjectId(), page: 12, severity: "error", category: "wrong_name", excerpt: "Jhon Smith" });
  assert.equal(finding.validateSync(), undefined);
  assert.ok(new PetitionAiFinding({ ...ids, scanId: new Types.ObjectId(), page: 0, severity: "error", category: "typo" }).validateSync()?.errors?.page);
  assert.ok(new PetitionAiFinding({ ...ids, scanId: new Types.ObjectId(), page: 3, severity: "fatal", category: "typo" }).validateSync()?.errors?.severity);
  assert.ok(new PetitionAiFinding({ ...ids, scanId: new Types.ObjectId(), page: 3, severity: "info", category: "gossip" }).validateSync()?.errors?.category);
  assert.ok(new PetitionAiFinding({ ...ids, scanId: new Types.ObjectId(), page: 3, severity: "info", category: "typo", confidence: 4 }).validateSync()?.errors?.confidence);

  assert.equal(new PetitionAiRules({ expectedAddresses: [{ label: "FedEx", address: "1 Main St" }] }).validateSync(), undefined);
  assert.ok(new PetitionAiRules({ expectedAddresses: [{ label: "no address" }] }).validateSync());
});

// ── PDF slicer (worker thread) ──────────────────────────────────────────
test("slicer: counts 37 pages and every slice holds exactly the right pages", async () => {
  const slicer = await PdfSlicer.open(await makePetition(37));
  try {
    assert.equal(slicer.pages, 37);
    for (const batch of planBatches({ totalPages: 37, batchSize: 4 }).batches) {
      const widths = await widthsOf(await slicer.slice(batch.from, batch.to));
      const expected = [];
      for (let page = batch.from; page <= batch.to; page += 1) expected.push(100 + page);
      assert.deepEqual(widths, expected, `pages ${batch.from}-${batch.to}`);
    }
  } finally {
    await slicer.close();
  }
});

test("slicer: the caller's buffer is copied, never detached or changed", async () => {
  const buffer = await makePetition(5);
  const before = Buffer.from(buffer);
  const slicer = await PdfSlicer.open(buffer);
  await slicer.slice(2, 3);
  await slicer.close();
  assert.equal(buffer.length, before.length);
  assert.ok(buffer.equals(before));
});

const FAST = { timeoutMs: 20000, loadTimeoutMs: 20000 };

test("slicer: a file no reader can open, and an empty file, fail with a typed error (no hang)", async () => {
  await assert.rejects(PdfSlicer.open(Buffer.from("this is not a pdf"), FAST), (error) => error instanceof PdfSliceError && error.code === PDF_ERROR.UNREADABLE);
  await assert.rejects(PdfSlicer.open(Buffer.alloc(0), FAST), (error) => error.code === PDF_ERROR.EMPTY);
});

// Real encryption made with qpdf (already used by the app's PDF normalizer). Returns null when qpdf is not installed.
function qpdfEncrypt(input, userPassword) {
  const { spawnSync } = require("child_process");
  const fs = require("fs");
  const os = require("os");
  const path = require("path");
  const qpdf = process.env.QPDF_PATH || "qpdf";
  if (spawnSync(qpdf, ["--version"], { encoding: "utf8" }).status !== 0) return null;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "petition-enc-"));
  const inFile = path.join(dir, "in.pdf");
  const outFile = path.join(dir, "out.pdf");
  fs.writeFileSync(inFile, input);
  const result = spawnSync(qpdf, ["--encrypt", userPassword, "owner-secret", "256", "--", inFile, outFile], { encoding: "utf8" });
  const bytes = result.status === 0 ? fs.readFileSync(outFile) : null;
  fs.rmSync(dir, { recursive: true, force: true });
  return bytes;
}

test("backup reader: a permission-encrypted petition (no opening password) that pdf-lib refuses is read as text by pdf.js", async (t) => {
  const encrypted = qpdfEncrypt(await makePetition(3), "");
  if (!encrypted) return t.skip("qpdf is not installed here");
  const reader = await PdfSlicer.open(encrypted, FAST);
  try {
    assert.equal(reader.mode, "text");
    assert.equal(reader.fallbackReason, PDF_ERROR.ENCRYPTED);
    assert.equal(reader.pages, 3);
    const pages = await reader.text(1, 3);
    assert.deepEqual(pages.map((item) => item.page), [1, 2, 3]);
    assert.match(pages[0].text, /Page 1/);
    assert.match(pages[2].text, /Page 3/);
    await assert.rejects(reader.slice(1, 1), (error) => error.code === PDF_ERROR.UNREADABLE); // text mode never pretends to slice
  } finally {
    await reader.close();
  }
});

test("backup reader: a petition locked with an opening password fails with a clear, typed message", async (t) => {
  const locked = qpdfEncrypt(await makePetition(2), "open-me");
  if (!locked) return t.skip("qpdf is not installed here");
  await assert.rejects(PdfSlicer.open(locked, FAST), (error) => error.code === PDF_ERROR.ENCRYPTED && /password/i.test(error.message));
});

test("backup reader: text of real pages is extracted in pdf mode too (used when the AI refuses a PDF slice)", async () => {
  const reader = await PdfSlicer.open(await makePetition(4), FAST);
  try {
    assert.equal(reader.mode, "pdf");
    const pages = await reader.text(2, 3);
    assert.deepEqual(pages.map((item) => item.page), [2, 3]);
    assert.match(pages[0].text, /Page 2/);
    assert.match(pages[1].text, /Page 3/);
  } finally {
    await reader.close();
  }
});

test("backup: a reader process that crashes once is replaced automatically and the same slice succeeds", async () => {
  const os = require("os");
  const path = require("path");
  const fs = require("fs");
  const marker = path.join(os.tmpdir(), `petition-crash-${process.pid}-${Date.now()}`);
  process.env.PETITION_TEST_FAULT = "crash-once";
  process.env.PETITION_TEST_MARKER = marker;
  const reader = await PdfSlicer.open(await makePetition(8), { ...FAST, workerFile: path.join(__dirname, "fixtures", "faultyWorker.js") });
  try {
    const widths = await widthsOf(await reader.slice(5, 8));
    assert.deepEqual(widths, [105, 106, 107, 108]);
    assert.ok(fs.existsSync(marker), "the first worker really crashed");
    assert.equal(reader.restartsLeft, 1);
  } finally {
    await reader.close();
    delete process.env.PETITION_TEST_FAULT;
    delete process.env.PETITION_TEST_MARKER;
    fs.rmSync(marker, { force: true });
  }
});

test("backup: a reader process that keeps crashing stops after the allowed restarts with a typed error (never loops forever)", async () => {
  const path = require("path");
  process.env.PETITION_TEST_FAULT = "crash-always";
  const reader = await PdfSlicer.open(await makePetition(4), { ...FAST, restarts: 2, workerFile: path.join(__dirname, "fixtures", "faultyWorker.js") });
  try {
    await assert.rejects(reader.slice(1, 2), (error) => error.code === PDF_ERROR.SLICER_CRASHED);
    assert.equal(reader.restartsLeft, 0);
  } finally {
    await reader.close();
    delete process.env.PETITION_TEST_FAULT;
  }
});

test("backup: if the primary reader hangs while opening a petition, the text reader takes over after the load timeout", async () => {
  const path = require("path");
  process.env.PETITION_TEST_FAULT = "hang-load";
  const started = Date.now();
  const reader = await PdfSlicer.open(await makePetition(3), { timeoutMs: 20000, loadTimeoutMs: 1500, workerFile: path.join(__dirname, "fixtures", "faultyWorker.js") });
  try {
    assert.equal(reader.mode, "text");
    assert.equal(reader.pages, 3);
    assert.ok(Date.now() - started < 15000, "fell back quickly, did not wait for retries of the hung reader");
    const pages = await reader.text(1, 3);
    assert.match(pages[2].text, /Page 3/);
  } finally {
    await reader.close();
    delete process.env.PETITION_TEST_FAULT;
  }
});

test("slicer: a page range outside the petition is refused, and a closed slicer refuses work", async () => {
  const slicer = await PdfSlicer.open(await makePetition(6));
  await assert.rejects(slicer.slice(5, 9), (error) => error.code === PDF_ERROR.BAD_RANGE);
  await assert.rejects(slicer.slice(0, 2), (error) => error.code === PDF_ERROR.BAD_RANGE);
  await assert.rejects(slicer.slice(4, 3), (error) => error.code === PDF_ERROR.BAD_RANGE);
  await slicer.close();
  await slicer.close(); // twice is safe
  await assert.rejects(slicer.slice(1, 2), (error) => error.code === PDF_ERROR.SLICER_CRASHED);
});

test("slicer: a 700-page petition is sliced in a separate process - the server's event loop stays responsive", async () => {
  const petition = await makePetition(700);
  let maxLagMs = 0;
  let last = Date.now();
  const probe = setInterval(() => {
    const now = Date.now();
    maxLagMs = Math.max(maxLagMs, now - last - 10);
    last = now;
  }, 10);
  const slicer = await PdfSlicer.open(petition);
  let pagesSeen = 0;
  try {
    assert.equal(slicer.pages, 700);
    for (const batch of planBatches({ totalPages: 700, batchSize: 4 }).batches) {
      const bytes = await slicer.slice(batch.from, batch.to);
      pagesSeen += batch.to - batch.from + 1;
      assert.ok(bytes.length > 0);
    }
  } finally {
    clearInterval(probe);
    await slicer.close();
  }
  assert.equal(pagesSeen, 700);
  assert.ok(maxLagMs < 250, `main thread was blocked for ${maxLagMs} ms`);
});
