// Phase 7.E: the tool_unavailable catalog entry (the E1 fix): every strategy with injected dependencies - no qpdf, no database, no network.
const assert = require("node:assert/strict");
const test = require("node:test");
const { PDFDocument } = require("pdf-lib");
const entry = require("../resolution/catalog/toolUnavailable");
const fallback = require("../../../utils/normalizeFallback");

async function sample() {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([612, 792]);
  pdf.getForm().createTextField("Pt1Line1_Name[0]").addToPage(page, { x: 40, y: 700, width: 150, height: 20 });
  pdf.getForm().createCheckBox("Pt1Line2_Box[0]").addToPage(page, { x: 40, y: 650, width: 12, height: 12 });
  return Buffer.from(await pdf.save());
}
const strategy = (id) => entry.strategies.find((item) => item.id === id);
const ctxWith = (deps) => ({ job: { formCode: "G-1041" }, stage: "import", formCode: "G-1041", error: Object.assign(new Error("qpdf binary not found"), { code: "QPDF_NOT_FOUND" }), diagnosis: { cause: "tool_unavailable" }, attempt: 1, deps });

test("the entry follows the shared contract and orders the alternatives from cheapest to most different", () => {
  assert.equal(entry.id, "tool_unavailable");
  assert.equal(typeof entry.description, "string");
  assert.deepEqual(entry.strategies.map((item) => item.id), ["reprobe", "long_timeout_retry", "fresh_temp_dir_retry", "alternate_normalizer"]);
  for (const item of entry.strategies) {
    assert.equal(item.safe, true);
    assert.equal(typeof item.run, "function");
    assert.equal(typeof item.verify, "function");
    assert.equal(typeof item.description, "string");
  }
});

test("it matches the tool problem however it is described, and nothing else", () => {
  assert.equal(entry.matches({ cause: "tool_unavailable" }, new Error("x")), true);
  assert.equal(entry.matches({}, Object.assign(new Error("x"), { cause: "tool_spawn" })), true);
  assert.equal(entry.matches({}, Object.assign(new Error("x"), { code: "QPDF_NOT_FOUND" })), true);
  assert.equal(entry.matches({ cause: "network" }, Object.assign(new Error("x"), { code: "ECONNRESET" })), false);
  assert.equal(entry.matches(undefined, undefined), false);
});

test("reprobe: finds the tool again and verifies it runs; reports a clear failure when it does not", async () => {
  const found = ctxWith({ ensureQpdf: async (options) => { assert.equal(options.force, true); return "C:\\good\\qpdf.exe"; }, works: async (binary) => ({ ok: binary === "C:\\good\\qpdf.exe" }) });
  const result = await strategy("reprobe").run(found);
  assert.equal(result.ok, true);
  assert.equal(result.retry, true);
  assert.equal(await strategy("reprobe").verify(found, result), true);

  const missing = ctxWith({ ensureQpdf: async () => null, works: async () => ({ ok: false }) });
  const failed = await strategy("reprobe").run(missing);
  assert.equal(failed.ok, false);
  assert.match(failed.evidence, /no working qpdf/);
  assert.equal(await strategy("reprobe").verify(missing, failed), false);
});

test("reprobe is not fooled: a path that was found but does not run fails verification", async () => {
  const ctx = ctxWith({ ensureQpdf: async () => "C:\\ghost\\qpdf.exe", works: async () => ({ ok: false }) });
  const result = await strategy("reprobe").run(ctx);
  assert.equal(await strategy("reprobe").verify(ctx, result), false);
});

test("long_timeout_retry: probes with a 5 minute timeout", async () => {
  let seen;
  const ctx = ctxWith({ ensureQpdf: async (options) => { seen = options; return "qpdf"; }, works: async (_binary, options) => ({ ok: options?.timeout === 5 * 60 * 1000 }) });
  const result = await strategy("long_timeout_retry").run(ctx);
  assert.equal(seen.deps.timeout, 5 * 60 * 1000);
  assert.equal(result.ok, true);
  assert.equal(await strategy("long_timeout_retry").verify(ctx, result), true);
});

test("fresh_temp_dir_retry: succeeds when normalizing works the second time, fails clearly without the PDF or when it throws again", async () => {
  const input = await sample();
  const ok = ctxWith({ loadInput: async () => input, normalize: async (buffer) => buffer });
  const result = await strategy("fresh_temp_dir_retry").run(ok);
  assert.equal(result.ok, true);
  assert.equal(result.retry, true);
  assert.equal(await strategy("fresh_temp_dir_retry").verify(ok, result), true);

  assert.equal((await strategy("fresh_temp_dir_retry").run(ctxWith({}))).ok, false);
  const stillBroken = await strategy("fresh_temp_dir_retry").run(ctxWith({ loadInput: async () => input, normalize: async () => { throw Object.assign(new Error("x"), { code: "QPDF_NOT_FOUND" }); } }));
  assert.equal(stillBroken.ok, false);
  assert.match(stillBroken.evidence, /QPDF_NOT_FOUND/);
  assert.equal(await strategy("fresh_temp_dir_retry").verify(ok, { output: Buffer.from("not a pdf") }), false);
});

test("alternate_normalizer: produces a PDF with the same pages and field names, and says so", async () => {
  const input = await sample();
  const ctx = ctxWith({ loadInput: async () => input });
  const result = await strategy("alternate_normalizer").run(ctx);
  assert.equal(result.ok, true);
  assert.equal(result.retry, true);
  assert.equal(result.report.fields, 2);
  assert.match(result.evidence, /same field names/);
  assert.equal(await strategy("alternate_normalizer").verify(ctx, result), true);
  assert.deepEqual((await fallback.describeBuffer(result.output)).names.sort(), ["Pt1Line1_Name[0]", "Pt1Line2_Box[0]"]);
});

test("alternate_normalizer: refuses (and verification fails) when the result would change the form or the input is unavailable", async () => {
  const input = await sample();
  const changing = ctxWith({ loadInput: async () => input, fallback: { normalizeVerified: async () => { throw Object.assign(new Error("changed"), { code: "NORMALIZE_FALLBACK_MISMATCH" }); }, compareStructure: fallback.compareStructure } });
  const refused = await strategy("alternate_normalizer").run(changing);
  assert.equal(refused.ok, false);
  assert.match(refused.evidence, /NORMALIZE_FALLBACK_MISMATCH/);

  const fewer = await PDFDocument.load(input);
  fewer.getForm().removeField(fewer.getForm().getFields()[0]);
  const mismatched = Buffer.from(await fewer.save());
  assert.equal(await strategy("alternate_normalizer").verify(ctxWith({ loadInput: async () => input }), { output: mismatched }), false);

  assert.equal((await strategy("alternate_normalizer").run(ctxWith({}))).ok, false);
});
