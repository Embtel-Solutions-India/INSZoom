// Phase 7.E: normalizePdf tells "qpdf cannot be started" from "a temp file was missing", heals a stale process by re-probing, and - only when qpdf is truly
// unusable and the autonomy switch is not off - falls back to the pure-JavaScript normalizer without losing a page or a field name.
// No database. The real qpdf is used only by the one test that needs an encrypted file (skipped when qpdf is absent).
const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const { PDFDocument } = require("pdf-lib");
const env = require("../../config/env");
const { normalizePdf } = require("../normalizePdf");
const fallback = require("../normalizeFallback");
const ensure = require("../ensureQpdf");

const BAD = "C:\\Program Files\\qpdf 12.3.2\\bin\\qpdf.exe";

async function buildForm() {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([612, 792]);
  const form = pdf.getForm();
  const text = form.createTextField("Pt1Line1a_FamilyName[0]");
  text.addToPage(page, { x: 50, y: 700, width: 200, height: 20 });
  const check = form.createCheckBox("Pt2Line3_Married[0]");
  check.addToPage(page, { x: 50, y: 650, width: 14, height: 14 });
  const radio = form.createRadioGroup("Pt3Line1_Gender[0]");
  radio.addOptionToPage("M", page, { x: 50, y: 600, width: 14, height: 14 });
  radio.addOptionToPage("F", page, { x: 90, y: 600, width: 14, height: 14 });
  const second = pdf.addPage([612, 792]);
  form.createTextField("Pt4Line2_City[0]").addToPage(second, { x: 50, y: 700, width: 200, height: 20 });
  return Buffer.from(await pdf.save());
}

const namesOf = async (buffer) => (await fallback.describeBuffer(buffer)).names.sort();
const enoentSpawn = (binary) => Object.assign(new Error(`spawn ${binary} ENOENT`), { code: "ENOENT", syscall: `spawn ${binary}`, path: binary, errno: -4058 });
// a fake qpdf: copies the input to the output (the last two arguments), for any binary except the ones listed as broken
const fakeExec = ({ broken = [], calls = [] } = {}) => async (binary, args) => {
  calls.push(binary);
  if (broken.includes(binary)) throw enoentSpawn(binary);
  fs.copyFileSync(args[args.length - 2], args[args.length - 1]);
  return { stdout: "", stderr: "" };
};

async function withEnvPath(value, fn) {
  const saved = env.qpdfPath;
  env.qpdfPath = value;
  try { return await fn(); } finally { env.qpdfPath = saved; }
}

test("the stored-message scenario: qpdf cannot be started ONCE (stale process); the forced re-probe heals it and nothing is reported missing", async () => {
  const input = await buildForm();
  const calls = [];
  await withEnvPath(BAD, async () => {
    let probes = 0;
    const output = await normalizePdf(input, { exec: fakeExec({ broken: [BAD], calls }), ensureQpdf: async (options) => { probes += 1; assert.equal(options.force, true, "the re-probe must ignore every cached answer"); return "C:\\good\\qpdf.exe"; }, mode: "off" });
    assert.ok(Buffer.isBuffer(output));
    assert.deepEqual(await namesOf(output), await namesOf(input));
    assert.equal(probes, 1);
    assert.deepEqual(calls, [BAD, "C:\\good\\qpdf.exe"]);
    assert.equal(env.qpdfPath, "C:\\good\\qpdf.exe", "the working path is remembered for the next call");
  });
});

test("the bare name on PATH is tried when the re-probe finds nothing", async () => {
  const input = await buildForm();
  const calls = [];
  await withEnvPath(BAD, async () => {
    const output = await normalizePdf(input, { exec: fakeExec({ broken: [BAD], calls }), ensureQpdf: async () => null, mode: "off" });
    assert.ok(Buffer.isBuffer(output));
    assert.deepEqual(calls, [BAD, "qpdf"]);
  });
});

test("qpdf truly unusable and the switch on: the JavaScript normalizer returns the same pages and the same field names (text, checkbox, radio)", async () => {
  const input = await buildForm();
  await withEnvPath(BAD, async () => {
    const output = await normalizePdf(input, { exec: fakeExec({ broken: [BAD, "qpdf"] }), ensureQpdf: async () => null, mode: "shadow" });
    assert.equal(output.subarray(0, 5).toString("utf8"), "%PDF-");
    assert.deepEqual(await namesOf(output), ["Pt1Line1a_FamilyName[0]", "Pt2Line3_Married[0]", "Pt3Line1_Gender[0]", "Pt4Line2_City[0]"]);
    const comparison = await fallback.compareStructure(input, output);
    assert.equal(comparison.ok, true);
    assert.equal(comparison.after.pages, 2);
  });
});

test("qpdf truly unusable and the switch OFF: today's behavior, QPDF_NOT_FOUND, but with the real cause and everything that was tried", async () => {
  const input = await buildForm();
  await withEnvPath(BAD, async () => {
    await assert.rejects(
      () => normalizePdf(input, { exec: fakeExec({ broken: [BAD, "qpdf"] }), ensureQpdf: async () => null, mode: "off" }),
      (error) => {
        assert.equal(error.code, "QPDF_NOT_FOUND");
        assert.equal(error.cause, "tool_spawn");
        assert.match(error.message, /could not be started/);
        assert.match(error.message, /qpdf 12\.3\.2/);
        assert.match(error.evidence, /tried/);
        return true;
      }
    );
  });
});

test("a missing TEMP file is not reported as a missing tool: it is retried once in a fresh folder and never triggers a re-probe", async () => {
  const input = await buildForm();
  let runs = 0;
  let probes = 0;
  const flaky = async (binary, args) => {
    runs += 1;
    if (runs === 1) throw Object.assign(new Error("ENOENT: no such file or directory, open 'x.in.pdf'"), { code: "ENOENT", syscall: "open", path: args[args.length - 2] });
    fs.copyFileSync(args[args.length - 2], args[args.length - 1]);
    return {};
  };
  const output = await normalizePdf(input, { exec: flaky, ensureQpdf: async () => { probes += 1; return null; }, mode: "off" });
  assert.ok(Buffer.isBuffer(output));
  assert.equal(runs, 2);
  assert.equal(probes, 0);

  const always = async (_binary, args) => { throw Object.assign(new Error("ENOENT: no such file or directory, open"), { code: "ENOENT", syscall: "open", path: args[args.length - 2] }); };
  await assert.rejects(
    () => normalizePdf(input, { exec: always, ensureQpdf: async () => { probes += 1; return null; }, mode: "on" }),
    (error) => error.code === "NORMALIZE_TEMP_FILE" && error.cause === "temp_file" && error.code !== "QPDF_NOT_FOUND"
  );
  assert.equal(probes, 0, "a temp-file problem never starts the tool search");
});

test("qpdf warnings (exit code 3) keep the written output, as before", async () => {
  const input = await buildForm();
  const warn = async (_binary, args) => { fs.copyFileSync(args[args.length - 2], args[args.length - 1]); throw Object.assign(new Error("warnings"), { code: 3 }); };
  const output = await normalizePdf(input, { exec: warn, mode: "off" });
  assert.deepEqual(await namesOf(output), await namesOf(input));
});

test("qpdf rejecting the file is qpdf_failed, never 'not found', and the JavaScript fallback is NOT used for it", async () => {
  const input = await buildForm();
  let fallbackCalls = 0;
  const damaged = async () => { throw Object.assign(new Error("damaged file"), { code: 2 }); };
  await assert.rejects(
    () => normalizePdf(input, { exec: damaged, mode: "on", fallback: { normalizeVerified: async () => { fallbackCalls += 1; return { buffer: input }; } } }),
    (error) => error.cause === "qpdf_failed" && /qpdf normalization failed/.test(error.message) && error.code === 2
  );
  assert.equal(fallbackCalls, 0);
});

test("a non-PDF input is rejected before any tool is touched, with its own cause", async () => {
  await assert.rejects(() => normalizePdf(Buffer.from("<html>soft 404</html>"), { exec: () => { throw new Error("must not run"); } }), (error) => error.code === "NORMALIZE_INPUT_NOT_PDF" && error.cause === "not_pdf");
});

test("the fallback refuses to answer when it would change the form: a structure mismatch is an error, not a silent loss", async () => {
  const input = await buildForm();
  const trimmed = await PDFDocument.load(input);
  trimmed.getForm().removeField(trimmed.getForm().getFields()[0]);
  const smaller = Buffer.from(await trimmed.save());
  const comparison = await fallback.compareStructure(input, smaller);
  assert.equal(comparison.ok, false);
  assert.ok(comparison.reasons.some((reason) => /field count|missing fields/.test(reason)));
});

function qpdfAvailable() {
  try { execFileSync(env.qpdfPath || "qpdf", ["--version"], { stdio: "ignore" }); return env.qpdfPath || "qpdf"; } catch (_) { try { execFileSync("qpdf", ["--version"], { stdio: "ignore" }); return "qpdf"; } catch (__) { return null; } }
}

test("an input that is really encrypted is refused by the fallback (only qpdf can decrypt it), so normalizePdf reports the tool problem instead of returning garbage", async (t) => {
  const binary = qpdfAvailable();
  if (!binary) return t.skip("qpdf is not available to build an encrypted sample");
  const input = await buildForm();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "enc-"));
  try {
    const inPath = path.join(dir, "in.pdf");
    const outPath = path.join(dir, "enc.pdf");
    fs.writeFileSync(inPath, input);
    execFileSync(binary, ["--allow-weak-crypto", "--encrypt", "", "", "128", "--print=none", "--", inPath, outPath]); // the RC4 wrapper many USCIS files carry
    const encrypted = fs.readFileSync(outPath);
    assert.equal(fallback.isEncrypted(encrypted), true);
    assert.equal(fallback.isEncrypted(input), false);
    await assert.rejects(() => fallback.normalizeVerified(encrypted), (error) => error.code === "NORMALIZE_FALLBACK_ENCRYPTED");
    await withEnvPath(BAD, async () => {
      await assert.rejects(
        () => normalizePdf(encrypted, { exec: fakeExec({ broken: [BAD, "qpdf"] }), ensureQpdf: async () => null, mode: "on" }),
        (error) => error.code === "QPDF_NOT_FOUND" && error.cause === "tool_spawn"
      );
    });
    // with a working tool the same encrypted file normalizes through qpdf itself
    const viaQpdf = await normalizePdf(encrypted, { mode: "off" });
    assert.deepEqual(await namesOf(viaQpdf), await namesOf(input));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("ensureQpdf: nothing is installed at runtime in production unless QPDF_AUTO_INSTALL is explicitly true", () => {
  assert.equal(ensure.installAllowed({ NODE_ENV: "production" }), false);
  assert.equal(ensure.installAllowed({ NODE_ENV: "production", QPDF_AUTO_INSTALL: "true" }), true);
  assert.equal(ensure.installAllowed({ NODE_ENV: "production", QPDF_AUTO_INSTALL: "false" }), false);
  assert.equal(ensure.installAllowed({ NODE_ENV: "development" }), true);
  assert.equal(ensure.installAllowed({ NODE_ENV: "development", QPDF_AUTO_INSTALL: "false" }), false);
});

test("ensureQpdf: describe() reports path, existence, runs and version without installing; a forced probe tries the configured path, PATH name and locator results", async () => {
  const seen = [];
  const works = async (binary) => { seen.push(binary); return binary === "D:\\tools\\qpdf.exe" ? { ok: true, version: "12.3.2" } : { ok: false, version: null }; };
  await withEnvPath(BAD, async () => {
    const found = await ensure.ensureQpdf({ force: true, deps: { works, locate: async () => ["D:\\tools\\qpdf.exe"], knownLocations: () => [], installAllowed: () => false } });
    assert.equal(found, "D:\\tools\\qpdf.exe");
    assert.deepEqual(seen.slice(0, 3), [BAD, "qpdf", "D:\\tools\\qpdf.exe"], "configured path, bare name, then what where/which reports");
  });
  const saved = env.qpdfPath;
  env.qpdfPath = "D:\\tools\\qpdf.exe";
  try {
    const description = await ensure.describe({ fresh: true, deps: { works } });
    assert.equal(description.configuredPath, "D:\\tools\\qpdf.exe");
    assert.equal(description.runs, true);
    assert.equal(description.version, "12.3.2");
    assert.ok(description.triedAt);
  } finally { env.qpdfPath = saved; }
  await ensure.ensureQpdf({ force: true, deps: { works: async () => ({ ok: false }), locate: async () => [], knownLocations: () => [], installAllowed: () => false } }).then((value) => assert.equal(value, null));
});

test("ensureQpdf: a failed probe is never cached - the next forced call can succeed", async () => {
  const none = { works: async () => ({ ok: false }), locate: async () => [], knownLocations: () => [], installAllowed: () => false };
  assert.equal(await ensure.ensureQpdf({ force: true, deps: none }), null);
  const saved = env.qpdfPath;
  try {
    const good = await ensure.ensureQpdf({ force: true, deps: { ...none, works: async (binary) => (binary === "qpdf" ? { ok: true, version: "12.3.2" } : { ok: false }) } });
    assert.equal(good, "qpdf");
  } finally { env.qpdfPath = saved; await ensure.ensureQpdf({ force: true, deps: none }); }
});
