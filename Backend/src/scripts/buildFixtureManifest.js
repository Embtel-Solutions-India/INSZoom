#!/usr/bin/env node
// Phase 7 (7.8): "fixtures are not golden until verified". READ-ONLY.
//   node src/scripts/buildFixtureManifest.js                    dry run: prints the manifest to stdout, writes nothing
//   node src/scripts/buildFixtureManifest.js --out <file>       also writes the manifest JSON (the only write this script can do), e.g.
//                                                               src/test-utils/fixtures/editions/MANIFEST.json
//
// For each candidate old -> new edition pair (I-485, I-129, I-131) it records, per PDF: form, edition read from the PDF's own footer, sha256, size, page and field
// count, where our copy is stored and the official uscis.gov URL, and a `verification`:
//   footerEditionMatchesTemplate  the footer edition equals the template's edition
//   officialDownloadSha256        sha256 of what the official URL serves today (GET to uscis.gov only, redirect-safe fetcher)
//   officialEqualsStored          that sha256 equals the checksum of the file we imported (importMetadata.checksum) or of our stored copy
//   officialPageEditionDate       the "Edition Date" the form's uscis.gov page shows today
//   status: verified | unverified | mismatch (+ reason). An OLD edition USCIS no longer serves can never be "verified" against the official source: it stays
//   "unverified" and the stored copy's footer + hash are recorded as its provenance.
// Reads: the database through the read-only handle (any write throws), stored PDFs through the storage service (read only), uscis.gov with GET. No PDF is copied
// into the repository; the manifest holds hashes and locations only. Synthetic mutants (test-utils/editionMutants.js) are listed under `synthetic`.
const crypto = require("crypto");
const fs = require("fs");

const PAIRS = Object.freeze([
  { formCode: "I-485", old: "2026-04-09", new: "2026-09-18" },
  { formCode: "I-129", old: "2026-02-27", new: "2026-09-09" },
  { formCode: "I-131", old: "2025-01-20", new: "current" },
]);

const TEMPLATE_PROJECTION = {
  formCode: 1, version: 1, editionDate: 1, status: 1, pdfStorageKey: 1, officialPdfUrl: 1,
  "lifecycle.sourcePageUrl": 1, "lifecycle.sourcePdfUrl": 1, "lifecycle.sourceChecksum": 1,
  "artifacts.form.sourceUrl": 1, "artifacts.form.storageKey": 1,
  "importMetadata.source": 1, "importMetadata.editionDateSource": 1, "importMetadata.checksum": 1,
};

const sha256 = (buffer) => crypto.createHash("sha256").update(buffer).digest("hex");
const isoDay = (value) => { if (!value) return null; const date = new Date(value); return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10); };
const pageUrlFor = (formCode) => `https://www.uscis.gov/${String(formCode).toLowerCase()}`;

/** Pure. The template(s) of `formCode` that stand for `edition` ("YYYY-MM-DD" or "current" = the active one). Newest-first within a tie, active before retired. */
function selectTemplates(templates, formCode, edition) {
  const own = templates.filter((item) => String(item.formCode).toUpperCase() === formCode);
  const rank = (item) => ({ active: 0, review: 1, draft: 2, retired: 3 }[item.status] ?? 4);
  const matches = edition === "current"
    ? own.filter((item) => item.status === "active")
    : own.filter((item) => isoDay(item.editionDate) === edition || String(item.version).startsWith(edition));
  return matches.sort((a, b) => rank(a) - rank(b));
}

/** Pure. verification block from what was observed. */
function judge({ template, footerEdition, official, officialFooterEdition, officialSha, officialEqualsStored, pageEdition }) {
  const edition = isoDay(template.editionDate) || footerEdition;
  const base = { footerEditionMatchesTemplate: footerEdition ? footerEdition === isoDay(template.editionDate) : null, officialDownloadSha256: officialSha || null, officialEqualsStored: official?.ok ? officialEqualsStored : null, officialPageEditionDate: pageEdition || null };
  if (!footerEdition) return { ...base, status: "unverified", reason: "the stored PDF prints no unambiguous edition in its footer" };
  if (footerEdition !== isoDay(template.editionDate)) return { ...base, status: "mismatch", reason: `the stored PDF's footer says ${footerEdition} but the template's edition is ${isoDay(template.editionDate) || "not set"}` };
  if (!official?.ok) return { ...base, status: "unverified", reason: `the official file could not be fetched (${official?.error || official?.violations?.[0]?.type || "no url"}); provenance is our stored copy, footer ${footerEdition}` };
  if (officialEqualsStored) return { ...base, status: "verified", reason: "the official PDF served today is byte-identical to our copy" };
  if (officialFooterEdition === footerEdition) return { ...base, status: "verified", reason: `USCIS re-posted this edition (${edition}) with different bytes; the footer edition is the same` };
  const note = `the official URL now serves edition ${officialFooterEdition || "unknown"}`;
  if (template.status === "active") return { ...base, status: "mismatch", reason: `${note}, but this is the live edition ${edition}` };
  return { ...base, status: "unverified", reason: `USCIS no longer serves edition ${edition} (${note}); provenance is our stored copy, footer ${footerEdition}, sha256 recorded` };
}

/** Describes ONE stored edition. All I/O is injected so it can be tested without a database, storage or network. */
async function describeEdition(template, deps) {
  const { readStored, fetchOfficial, footerOf, inspectPdf, pageEditionOf } = deps;
  const key = template.pdfStorageKey || template.artifacts?.form?.storageKey || null;
  const entry = {
    formCode: String(template.formCode).toUpperCase(), edition: isoDay(template.editionDate), version: template.version, status: template.status, synthetic: false,
    source: { templateId: String(template._id), storageKey: key, officialPdfUrl: template.officialPdfUrl || template.lifecycle?.sourcePdfUrl || template.artifacts?.form?.sourceUrl || null, officialPageUrl: template.lifecycle?.sourcePageUrl || pageUrlFor(template.formCode), editionDateSource: template.importMetadata?.editionDateSource || null },
  };
  if (!key) return { ...entry, verification: { status: "unverified", reason: "the template has no stored PDF" } };
  let bytes;
  try { bytes = await readStored(key); } catch (error) { return { ...entry, verification: { status: "unverified", reason: `the stored PDF could not be read: ${error.message}` } }; }
  const footerEdition = await Promise.resolve(footerOf(bytes)).catch(() => null);
  const info = await Promise.resolve(inspectPdf(bytes)).catch(() => ({ pageCount: null, fieldCount: null }));
  entry.footerEdition = footerEdition;
  entry.sha256 = sha256(bytes);
  entry.bytes = bytes.length;
  entry.pageCount = info.pageCount;
  entry.fieldCount = info.fieldCount;
  entry.importedChecksum = template.importMetadata?.checksum || template.lifecycle?.sourceChecksum || null;

  const url = entry.source.officialPdfUrl;
  const official = url ? await fetchOfficial(url, "pdf") : null;
  const officialSha = official?.ok ? sha256(official.bytes) : null;
  const officialFooterEdition = official?.ok ? await Promise.resolve(footerOf(official.bytes)).catch(() => null) : null;
  const officialEqualsStored = Boolean(officialSha && (officialSha === entry.importedChecksum || officialSha === entry.sha256));
  let pageEdition = null;
  try {
    const page = await fetchOfficial(entry.source.officialPageUrl, "html");
    if (page?.ok) pageEdition = isoDay(pageEditionOf(page.bytes.toString("utf8"), entry.formCode));
  } catch { /* the page is advisory */ }
  entry.verification = judge({ template, footerEdition, official, officialFooterEdition, officialSha, officialEqualsStored, pageEdition });
  if (officialFooterEdition) entry.verification.officialFooterEdition = officialFooterEdition;
  return entry;
}

/** Pure. Pair-level verdict. */
function judgePair(oldEntry, newEntry) {
  if (!oldEntry || !newEntry) return { status: "unavailable", reason: `no stored ${!oldEntry ? "old" : "new"} edition found` };
  if (oldEntry.edition && oldEntry.edition === newEntry.edition) return { status: "not_a_pair", reason: `both stored editions are ${oldEntry.edition}; this is not an old/new edition pair` };
  const states = [oldEntry.verification?.status, newEntry.verification?.status];
  if (states.includes("mismatch")) return { status: "mismatch", reason: "at least one edition contradicts its own footer or the official source" };
  if (states.every((state) => state === "verified")) return { status: "verified", reason: "both editions verified" };
  return { status: "unverified", reason: "at least one edition could not be verified against the official source (see each edition)" };
}

async function buildManifest({ templates, deps, pairs = PAIRS, now = () => new Date(), catalog = require("../test-utils/editionMutants").CATALOG }) {
  const out = { generatedAt: now().toISOString(), note: "Hashes and locations only; no fixture PDF is stored in the repository. Real editions are 'verified' only against the official source; an old edition USCIS no longer serves stays 'unverified' with our stored copy as its provenance.", pairs: [], synthetic: [] };
  for (const pair of pairs) {
    const pick = async (edition) => {
      const [first, ...alternates] = selectTemplates(templates, pair.formCode, edition);
      if (!first) return { entry: null, alternates: [] };
      const entry = await describeEdition(first, deps);
      return { entry: { ...entry, role: edition === "current" ? "new" : undefined }, alternates: alternates.map((item) => ({ templateId: String(item._id), version: item.version, status: item.status })) };
    };
    const oldPick = await pick(pair.old);
    const newPick = await pick(pair.new);
    out.pairs.push({
      formCode: pair.formCode, requested: { old: pair.old, new: pair.new },
      old: oldPick.entry && { ...oldPick.entry, role: "old" }, new: newPick.entry && { ...newPick.entry, role: "new" },
      ...(oldPick.alternates.length || newPick.alternates.length ? { otherCandidates: { old: oldPick.alternates, new: newPick.alternates } } : {}),
      verdict: judgePair(oldPick.entry, newPick.entry),
    });
  }
  out.synthetic = catalog.map((item) => ({ synthetic: true, generator: `test-utils/editionMutants.${item.generator}`, name: item.name, mutation: item.mutation, appliedTo: "any real or synthetic base PDF, at harness time" }));
  return out;
}

function parseArgs(argv) {
  const args = { out: null, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--help" || argv[index] === "-h") args.help = true;
    else if (argv[index] === "--out") { args.out = argv[index + 1]; index += 1; }
  }
  return args;
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help || (argv.includes("--out") && !args.out)) {
    console.log("usage: node src/scripts/buildFixtureManifest.js [--out <file>]\nRead-only. Prints the manifest; --out also writes it to the file you name.");
    return args.help ? 0 : 2;
  }
  require("dotenv").config();
  const mongoose = require("mongoose");
  const env = require("../config/env");
  const { readOnlyDb } = require("./lib/readOnlyDb");
  const { fetchOfficialSource } = require("../modules/form-edition-policy/OfficialSourceFetcher");
  const metadata = require("../modules/uscis-form-import/services/FormMetadataService");
  const storage = require("../modules/uploads/storage.service");
  const { PDFDocument } = require("pdf-lib");
  const { USCISScannerService } = (() => { const mod = require("../modules/uscis-lifecycle/services/USCISScannerService"); return { USCISScannerService: mod.USCISScannerService || mod }; })();

  const deps = {
    readStored: (key) => storage.readBuffer(key),
    fetchOfficial: (url, accept) => fetchOfficialSource(url, { accept }),
    footerOf: async (bytes) => isoDay(metadata.extractEditionDate(await metadata.readPdfText(bytes))),
    inspectPdf: async (bytes) => {
      const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
      return { pageCount: doc.getPageCount(), fieldCount: doc.getForm().getFields().length };
    },
    pageEditionOf: (html, formCode) => USCISScannerService.extractFormInfo(html, formCode)?.editionDate,
  };
  await mongoose.connect(env.mongoUri || process.env.MONGODB_URI, { autoIndex: false, autoCreate: false, serverSelectionTimeoutMS: 15000 });
  try {
    const reader = readOnlyDb(mongoose.connection.db);
    const templates = await reader.collection("uscisformtemplates").find({ formCode: { $in: PAIRS.map((pair) => pair.formCode) } }, { projection: TEMPLATE_PROJECTION }).toArray();
    const manifest = await buildManifest({ templates, deps });
    const text = JSON.stringify(manifest, null, 2);
    if (args.out) fs.writeFileSync(args.out, text, "utf8");
    console.log(text);
    return 0;
  } finally {
    await mongoose.disconnect();
  }
}

module.exports = { PAIRS, TEMPLATE_PROJECTION, selectTemplates, judge, judgePair, describeEdition, buildManifest, parseArgs, main };

if (require.main === module) main().then((code) => process.exit(code), (error) => { console.error(`fixture manifest failed: ${error.message}`); process.exit(1); });
