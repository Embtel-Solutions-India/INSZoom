#!/usr/bin/env node
// Phase 7.5 READ-ONLY evaluation of the registry-free component segmenter against the real data.
//   node src/scripts/evaluateComponentDiscovery.js [--forms I-129,I-864] [--json]
// For every stored template with a stored PDF (all editions, any status) it extracts the page text, runs the segmenter and reports:
//   - for a template that HAS stored component definitions: whether the segmenter reproduces every ACTIVE range (and which code it carries);
//   - for every other template: the number of components the segmenter finds (it must be 0: a form with no embedded supplements must never get invented ones).
// The database handle is the read-only wrapper of the Release 0a scripts; PDFs are read from storage; nothing is written anywhere.
const fs = require("fs");

const rangeKey = (start, end) => `${start}-${end}`;

/** Pure. Compare stored ACTIVE definitions with the segments of the same PDF -> { agree, missing: [...], extra: [...], codeMismatch: [...] }. */
function compare(storedDefs, segmentation) {
  const stored = storedDefs.filter((def) => def.status === "ACTIVE");
  const segs = segmentation.segments.filter((seg) => seg.kind === "component");
  const byRange = new Map(segs.map((seg) => [rangeKey(seg.startPage, seg.endPage), seg]));
  const missing = [];
  const codeMismatch = [];
  const seen = new Set();
  for (const def of stored) {
    for (const range of def.pageRanges || []) {
      const key = rangeKey(range.startPage, range.endPage);
      const seg = byRange.get(key);
      if (!seg) { missing.push({ componentCode: def.componentCode, range: key }); continue; }
      seen.add(key);
      const sameRange = stored.filter((other) => (other.pageRanges || []).some((r) => rangeKey(r.startPage, r.endPage) === key));
      const overlapOk = sameRange.length > 1 && sameRange.some((other) => other.componentCode === seg.componentCode); // a documented duplicate: one segment, two stored rows
      if (seg.componentCode !== def.componentCode && seg.codeSource === "carried" && !overlapOk) codeMismatch.push({ stored: def.componentCode, segmenter: seg.componentCode, range: key });
    }
  }
  const extra = segs.filter((seg) => !seen.has(rangeKey(seg.startPage, seg.endPage))).map((seg) => ({ range: rangeKey(seg.startPage, seg.endPage), heading: seg.headingText, code: seg.componentCode, codeSource: seg.codeSource }));
  return { agree: !missing.length && !extra.length, missing, extra, codeMismatch };
}

async function main(argv) {
  const only = (argv.includes("--forms") ? argv[argv.indexOf("--forms") + 1] : "").split(",").map((item) => item.trim().toUpperCase()).filter(Boolean);
  const mongoose = require("mongoose");
  await require("../config/database")();
  const { readOnlyDb } = require("./lib/readOnlyDb");
  const db = readOnlyDb(mongoose.connection.db);
  const storage = require("../modules/uploads/storage.service");
  const { PDFParse } = require("pdf-parse");
  const Segmenter = require("../modules/uscis-forms/services/ComponentSegmenter");

  const heads = await db.collection("uscisformtemplates").find(only.length ? { formCode: { $in: only } } : {}, { projection: { formCode: 1, version: 1, status: 1, "artifacts.form.storageKey": 1 } }).sort({ formCode: 1, version: 1 }).toArray();
  const definitions = await db.collection("uscisformcomponentdefinitions").find({}, { projection: { parentTemplateId: 1, componentCode: 1, name: 1, status: 1, pageRanges: 1 } }).toArray();
  const registry = await db.collection("visaformmappings").aggregate([{ $match: { parentForm: { $ne: null }, componentType: { $in: ["SUPPLEMENT", "FORM_COMPONENT"] } } }, { $group: { _id: { parentForm: "$parentForm", formName: "$formName", componentCode: "$componentCode" } } }]).toArray();
  const defsByTemplate = new Map();
  for (const def of definitions) { const key = String(def.parentTemplateId); (defsByTemplate.get(key) || defsByTemplate.set(key, []).get(key)).push(def); }

  const textOf = new Map();
  const readPages = async (head) => {
    const key = String(head._id);
    if (!textOf.has(key)) {
      const parser = new PDFParse({ data: await storage.readBuffer(head.artifacts.form.storageKey) });
      try { textOf.set(key, (await parser.getText()).pages.map((page) => page.text || "")); } finally { await parser.destroy(); }
    }
    return textOf.get(key);
  };
  const rows = [];
  for (const head of heads) {
    const storageKey = head.artifacts?.form?.storageKey;
    const row = { formCode: head.formCode, version: head.version, status: head.status };
    if (!storageKey) { rows.push({ ...row, skipped: "no stored PDF" }); continue; }
    try {
      const pages = await readPages(head);
      const candidates = registry.filter((item) => String(item._id.parentForm).toUpperCase() === String(head.formCode).toUpperCase()).map((item) => ({ name: item._id.formName, componentCode: item._id.componentCode || Segmenter.derivedCode(head.formCode, item._id.formName), inUse: Boolean(item._id.componentCode), source: "registry" }));
      const stored = defsByTemplate.get(String(head._id)) || [];
      // the previous edition of the same form that has stored components (older version): its pages and components let a HEADINGLESS sheet (I-129 Additional Beneficiary) be recognised
      const older = heads.filter((other) => other.formCode === head.formCode && String(other._id) !== String(head._id) && String(other.version) < String(head.version) && (defsByTemplate.get(String(other._id)) || []).length)
        .sort((a, b) => String(b.version).localeCompare(String(a.version)))[0];
      let previous = null;
      let previousCandidates = [];
      if (older) {
        const olderDefs = defsByTemplate.get(String(older._id));
        previous = { pages: await readPages(older), components: olderDefs.map((def) => ({ componentCode: def.componentCode, name: def.name, startPage: def.pageRanges?.[0]?.startPage, endPage: def.pageRanges?.[0]?.endPage })) };
        previousCandidates = olderDefs.map((def) => ({ name: def.name, componentCode: def.componentCode, inUse: false, source: "previous" }));
      }
      const segmentation = Segmenter.segment({ pages, parentFormCode: head.formCode, candidates: [...candidates, ...previousCandidates], previous });
      row.pages = pages.length;
      row.segmentsFound = segmentation.segments.filter((seg) => seg.kind === "component").length;
      row.unclaimedPages = segmentation.unclaimed.length;
      if (stored.length) row.comparison = compare(stored, segmentation);
      rows.push(row);
    } catch (error) {
      rows.push({ ...row, error: String(error.message).slice(0, 120) });
    }
    process.stderr.write(`evaluated ${head.formCode} ${head.version}\n`);
  }
  await mongoose.disconnect();
  if (argv.includes("--json")) { console.log(JSON.stringify(rows, null, 1)); return 0; }
  const withDefs = rows.filter((row) => row.comparison);
  const without = rows.filter((row) => !row.comparison && !row.skipped && !row.error);
  console.log(`templates read: ${rows.length}; with stored component definitions: ${withDefs.length}; without: ${without.length}; skipped/errors: ${rows.length - withDefs.length - without.length}`);
  for (const row of withDefs) console.log(`WITH DEFS  ${row.formCode} ${row.version} (${row.status}): ${row.comparison.agree ? "AGREES" : "DIFFERS"} - segments ${row.segmentsFound}, unclaimed pages ${row.unclaimedPages}${row.comparison.missing.length ? ` missing ${JSON.stringify(row.comparison.missing)}` : ""}${row.comparison.extra.length ? ` extra ${JSON.stringify(row.comparison.extra)}` : ""}${row.comparison.codeMismatch.length ? ` codes ${JSON.stringify(row.comparison.codeMismatch)}` : ""}`);
  const invented = without.filter((row) => row.segmentsFound > 0);
  console.log(`NO DEFS    ${without.length} templates; components found where none are stored: ${invented.length}${invented.length ? "\n" + invented.map((row) => `  ${row.formCode} ${row.version}: ${row.segmentsFound}`).join("\n") : ""}`);
  rows.filter((row) => row.error || row.skipped).forEach((row) => console.log(`NOT READ   ${row.formCode} ${row.version}: ${row.error || row.skipped}`));
  return 0;
}

module.exports = { compare };

if (require.main === module) main(process.argv.slice(2)).then((code) => process.exit(code)).catch((error) => { console.error("evaluation failed:", error.message); process.exit(1); });
