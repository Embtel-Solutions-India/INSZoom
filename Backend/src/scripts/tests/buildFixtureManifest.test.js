// Phase 7 (7.8) fixture manifest: DB-free, network-free, storage-free (every dependency is injected).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { selectTemplates, judge, judgePair, describeEdition, buildManifest, parseArgs } = require("../buildFixtureManifest");

const sha = (buffer) => crypto.createHash("sha256").update(buffer).digest("hex");
const tpl = (over) => ({ _id: over._id || `t-${Math.random()}`, formCode: "I-485", status: "retired", editionDate: new Date("2026-04-09T00:00:00Z"), version: "2026-04-09", pdfStorageKey: "k/old.pdf", officialPdfUrl: "https://www.uscis.gov/sites/default/files/document/forms/i-485.pdf", ...over });

function deps({ stored = {}, official = {}, footers = {}, page = "2026-09-18" } = {}) {
  return {
    readStored: async (key) => { if (!stored[key]) throw new Error("no such object"); return stored[key]; },
    fetchOfficial: async (url, accept) => (accept === "html" ? { ok: true, bytes: Buffer.from("<html/>") } : official[url] || { ok: false, error: "HTTP 404" }),
    footerOf: async (bytes) => footers[sha(bytes)] ?? null,
    inspectPdf: async () => ({ pageCount: 3, fieldCount: 7 }),
    pageEditionOf: () => (page ? new Date(`${page}T00:00:00Z`) : null),
  };
}

test("selectTemplates: by edition or version prefix, 'current' = the active one, active before retired", () => {
  const list = [tpl({ _id: "a", status: "retired" }), tpl({ _id: "b", status: "active", editionDate: new Date("2026-09-18T00:00:00Z"), version: "2026-09-18" }), tpl({ _id: "c", status: "retired", version: "2026-04-09-manual-upload", editionDate: new Date("2026-04-09T00:00:00Z") })];
  assert.deepEqual(selectTemplates(list, "I-485", "2026-04-09").map((x) => x._id), ["a", "c"]);
  assert.deepEqual(selectTemplates(list, "I-485", "current").map((x) => x._id), ["b"]);
  assert.deepEqual(selectTemplates(list, "I-130", "current"), []);
});

test("judge: footer contradicting the template is a mismatch; no footer is unverified", () => {
  const template = tpl({ status: "active" });
  assert.equal(judge({ template, footerEdition: "2026-01-01", official: { ok: true } }).status, "mismatch");
  assert.equal(judge({ template, footerEdition: null, official: { ok: true } }).status, "unverified");
});

test("judge: byte-identical official file verifies; a re-posted same edition verifies; an unfetchable official file stays unverified", () => {
  const template = tpl({ status: "active" });
  assert.equal(judge({ template, footerEdition: "2026-04-09", official: { ok: true }, officialEqualsStored: true, officialSha: "x" }).status, "verified");
  const reposted = judge({ template, footerEdition: "2026-04-09", official: { ok: true }, officialEqualsStored: false, officialFooterEdition: "2026-04-09", officialSha: "y" });
  assert.equal(reposted.status, "verified");
  assert.match(reposted.reason, /re-posted/);
  const down = judge({ template, footerEdition: "2026-04-09", official: { ok: false, error: "HTTP 404" } });
  assert.equal(down.status, "unverified");
  assert.equal(down.officialEqualsStored, null);
});

test("judge: an old edition USCIS no longer serves is UNVERIFIED (never verified, never a mismatch); a live edition contradicted by the official file is a mismatch", () => {
  const oldTemplate = tpl({ status: "retired" });
  const old = judge({ template: oldTemplate, footerEdition: "2026-04-09", official: { ok: true }, officialEqualsStored: false, officialFooterEdition: "2026-09-18", officialSha: "z" });
  assert.equal(old.status, "unverified");
  assert.match(old.reason, /no longer serves/);
  const live = judge({ template: tpl({ status: "active" }), footerEdition: "2026-04-09", official: { ok: true }, officialEqualsStored: false, officialFooterEdition: "2026-09-18", officialSha: "z" });
  assert.equal(live.status, "mismatch");
});

test("describeEdition records hash, size, pages, fields, footer, source and verification from injected I/O", async () => {
  const bytes = Buffer.from("%PDF-old");
  const template = tpl({ _id: "t1", importMetadata: { checksum: "irrelevant" } });
  const entry = await describeEdition(template, deps({ stored: { "k/old.pdf": bytes }, footers: { [sha(bytes)]: "2026-04-09" } }));
  assert.equal(entry.sha256, sha(bytes));
  assert.equal(entry.bytes, bytes.length);
  assert.equal(entry.pageCount, 3);
  assert.equal(entry.fieldCount, 7);
  assert.equal(entry.footerEdition, "2026-04-09");
  assert.equal(entry.source.templateId, "t1");
  assert.equal(entry.source.storageKey, "k/old.pdf");
  assert.equal(entry.synthetic, false);
  assert.equal(entry.verification.status, "unverified", "the official URL answered 404");
  assert.equal(entry.verification.footerEditionMatchesTemplate, true);
});

test("describeEdition: an unreadable stored object or a template without a stored PDF is unverified, never thrown", async () => {
  assert.equal((await describeEdition(tpl({}), deps())).verification.status, "unverified");
  assert.match((await describeEdition(tpl({ pdfStorageKey: null }), deps())).verification.reason, /no stored PDF/);
});

test("judgePair: same edition is not a pair; one mismatch poisons the pair; both verified verifies; a missing side is unavailable", () => {
  const e = (edition, status) => ({ edition, verification: { status } });
  assert.equal(judgePair(e("2025-01-20", "verified"), e("2025-01-20", "verified")).status, "not_a_pair");
  assert.equal(judgePair(e("2026-04-09", "unverified"), e("2026-09-18", "mismatch")).status, "mismatch");
  assert.equal(judgePair(e("2026-04-09", "verified"), e("2026-09-18", "verified")).status, "verified");
  assert.equal(judgePair(e("2026-04-09", "unverified"), e("2026-09-18", "verified")).status, "unverified");
  assert.equal(judgePair(null, e("2026-09-18", "verified")).status, "unavailable");
});

test("buildManifest: pairs from stored templates, the synthetic catalog is labeled, nothing real is labeled synthetic", async () => {
  const oldBytes = Buffer.from("%PDF-old");
  const newBytes = Buffer.from("%PDF-new");
  const templates = [
    tpl({ _id: "old", pdfStorageKey: "k/old.pdf" }),
    tpl({ _id: "new", status: "active", editionDate: new Date("2026-09-18T00:00:00Z"), version: "2026-09-18", pdfStorageKey: "k/new.pdf", importMetadata: { checksum: sha(newBytes) } }),
  ];
  const manifest = await buildManifest({
    templates, pairs: [{ formCode: "I-485", old: "2026-04-09", new: "2026-09-18" }, { formCode: "I-131", old: "2025-01-20", new: "current" }], now: () => new Date("2026-10-22T00:00:00Z"),
    deps: deps({
      stored: { "k/old.pdf": oldBytes, "k/new.pdf": newBytes },
      footers: { [sha(oldBytes)]: "2026-04-09", [sha(newBytes)]: "2026-09-18" },
      official: { "https://www.uscis.gov/sites/default/files/document/forms/i-485.pdf": { ok: true, bytes: newBytes } },
    }),
  });
  const [i485, i131] = manifest.pairs;
  assert.equal(i485.new.verification.status, "verified");
  assert.equal(i485.old.verification.status, "unverified", "the official URL serves the new edition, so the old one cannot be verified against it");
  assert.equal(i485.verdict.status, "unverified");
  assert.equal(i131.verdict.status, "unavailable");
  assert.ok(manifest.synthetic.length >= 9 && manifest.synthetic.every((item) => item.synthetic === true && item.generator.startsWith("test-utils/editionMutants.")));
  assert.ok(manifest.pairs.every((pair) => [pair.old, pair.new].filter(Boolean).every((entry) => entry.synthetic === false)));
  assert.equal(manifest.generatedAt, "2026-10-22T00:00:00.000Z");
});

test("the script cannot write to the database and its only file write is the explicit --out", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "buildFixtureManifest.js"), "utf8");
  const code = source.split("\n").filter((line) => !line.trim().startsWith("//")).join("\n");
  for (const token of ["insertOne", "insertMany", "updateOne", "updateMany", "deleteOne", "deleteMany", "bulkWrite", ".save(", "createIndex", "findOneAndUpdate", "$out", "$merge", "storeImmutableBuffer", "putObject"]) {
    assert.ok(!code.includes(token), `must not contain ${token}`);
  }
  assert.equal((code.match(/writeFileSync/g) || []).length, 1);
  assert.match(code, /readOnlyDb\(mongoose\.connection\.db\)/);
  assert.deepEqual(parseArgs(["--out", "x.json"]), { out: "x.json", help: false });
});
