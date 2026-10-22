// Phase 7.5 wiring of the segmenter into the discovery service, on the LOCAL throwaway database (src/test-utils/pipelineDb.js; skipped when no local MongoDB answers).
// A synthetic multi-supplement PDF is built with pdf-lib; storage is replaced. Proves: off = today's result, shadow = same stored result, on = same result when nothing is
// unregistered, and an unregistered supplement is bounded + recorded as a candidate instead of absorbed.
const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { PDFDocument, StandardFonts } = require("pdf-lib");
const { useTestDatabase } = require("../../../test-utils/pipelineDb");
const USCISFormComponentDefinition = require("../../../models/USCISFormComponentDefinition");
const VisaFormMapping = require("../../../models/VisaFormMapping");
const USCISFormTemplate = require("../../../models/USCISFormTemplate");
const storage = require("../../uploads/storage.service");
const Discovery = require("../services/USCISFormComponentDiscoveryService");

let db;
db = useTestDatabase({ before: test.before, after: test.after }, [USCISFormComponentDefinition]);
test.beforeEach(async () => {
  if (!db.ok) return;
  await mongoose.connection.collection("uscisformcomponentdefinitions").deleteMany({});
  await mongoose.connection.collection("visaformmappings").deleteMany({});
  await mongoose.connection.collection("uscisformtemplates").deleteMany({});
});

const withMode = async (mode, fn) => {
  const before = process.env.FORM_PIPELINE_AUTONOMY;
  if (mode === undefined) delete process.env.FORM_PIPELINE_AUTONOMY; else process.env.FORM_PIPELINE_AUTONOMY = mode;
  try { return await fn(); } finally { if (before === undefined) delete process.env.FORM_PIPELINE_AUTONOMY; else process.env.FORM_PIPELINE_AUTONOMY = before; }
};

/** pages: array of [headingOrNull, bodyLine]; every page gets the real "Page N of M / Form X Edition" header line. */
async function buildPdf(pages) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  pages.forEach(([heading, body], index) => {
    const page = doc.addPage([612, 792]);
    const lines = [`Page ${index + 1} of ${pages.length}    Form ZZ-129 Edition 09/09/26`, ...(heading ? [heading, "Department of Homeland Security"] : []), body];
    lines.forEach((line, i) => page.drawText(line, { x: 40, y: 740 - i * 22, size: 11, font }));
  });
  return Buffer.from(await doc.save());
}

// every page gets its own words: pages that look alike are (correctly) treated as trailing boilerplate by the discovery, which would end a range early
let pageCounter = 0;
const unique = (label) => { pageCounter += 1; return `${label} ` + Array.from({ length: 14 }, (_, i) => `w${pageCounter}x${i}`).join(" "); };
const core = (n) => [null, unique(`Core part ${n}`)];
// two closing pages that look alike: the discovery treats such a trailing run as boilerplate and ends the last component before it (today's rule)
const closing = () => [[null, "Closing statement identical on both closing pages signature date interpreter preparer"], [null, "Closing statement identical on both closing pages signature date interpreter preparer"]];
const sheet = (heading, n) => [n === 0 ? heading : null, unique(`Body of ${heading} page ${n}`)];
async function seed(pdf, { withZ }) {
  const key = `test/zz-129-${Math.random()}.pdf`;
  storage.readBuffer = async () => pdf;
  const formFields = Array.from({ length: 12 }, (_, i) => ({ fieldId: `f${i + 1}`, pageNumber: i + 1 }));
  const inserted = await USCISFormTemplate.collection.insertOne({ formCode: "ZZ-129", title: "t", version: withZ ? "v2" : "v1", status: "active", artifacts: { form: { storageKey: key } }, formFields });
  for (const [formName, code] of [["A Classification Supplement", null], ["B Classification Supplement", null]]) {
    await VisaFormMapping.collection.insertOne({ visaType: "X", immigrationNature: "nonimmigrant", formNumber: "ZZ-129", formName, agency: "USCIS", provisioningType: "required", parentForm: "ZZ-129", componentType: "FORM_COMPONENT", ...(code ? { componentCode: code } : {}) });
  }
  return inserted.insertedId;
}
const brief = (outcome) => outcome.results.map((r) => `${r.componentCode}|${r.status}|${r.pageRanges.map((x) => `${x.startPage}-${x.endPage}`).join("+")}|${r.fieldCount}`).sort();

test("off, shadow and on give the SAME stored result when every heading is registered (today's behavior is unchanged)", async (t) => {
  if (!db.ok) return t.skip(db.reason);
  const pdf = await buildPdf([core(1), core(2), sheet("A Classification Supplement", 0), sheet("A Classification Supplement", 1), sheet("B Classification Supplement", 0), sheet("B Classification Supplement", 1), ...closing()]);
  await seed(pdf, { withZ: false });
  const outcomes = {};
  for (const mode of [undefined, "shadow", "on"]) {
    await mongoose.connection.collection("uscisformcomponentdefinitions").deleteMany({});
    outcomes[mode || "off"] = brief(await withMode(mode, () => Discovery.discoverComponentsForParentForm("ZZ-129")));
  }
  assert.deepEqual(outcomes.off, ["ZZ129_A_CLASSIFICATION_SUPPLEM|ACTIVE|3-4|2", "ZZ129_B_CLASSIFICATION_SUPPLEM|ACTIVE|5-6|2"]);
  assert.deepEqual(outcomes.shadow, outcomes.off);
  // on: the same components, plus the closing pages that nothing accounts for are recorded as an UNCLAIMED run (a candidate, never active) instead of leaking into the core form
  assert.deepEqual(outcomes.on.filter((row) => !row.includes("UNCLAIMED_TAIL")), outcomes.off);
  assert.deepEqual(outcomes.on.filter((row) => row.includes("UNCLAIMED_TAIL")), ["ZZ129_UNCLAIMED_TAIL|REVIEW_REQUIRED|7-8|0"]);
});

test("an UNREGISTERED supplement: off = today's result (the neighbour is flagged), shadow = same stored result + a log, on = the neighbour keeps its range and the new one is a candidate", async (t) => {
  if (!db.ok) return t.skip(db.reason);
  const pdf = await buildPdf([core(1), core(2), sheet("A Classification Supplement", 0), sheet("A Classification Supplement", 1), sheet("B Classification Supplement", 0), sheet("B Classification Supplement", 1), sheet("Z Classification Supplement", 0), sheet("Z Classification Supplement", 1), ...closing()]);
  await seed(pdf, { withZ: true });
  const stored = async () => (await USCISFormComponentDefinition.find({}).lean()).map((d) => `${d.componentCode}|${d.status}|${d.pageRanges.map((x) => `${x.startPage}-${x.endPage}`).join("+")}|${d.verificationMethod}`).sort();

  await withMode(undefined, () => Discovery.discoverComponentsForParentForm("ZZ-129"));
  const off = await stored();
  assert.ok(off.some((row) => row.startsWith("ZZ129_B_CLASSIFICATION_SUPPLEM|REVIEW_REQUIRED")), "today: B is flagged because a competing heading sits inside its range");
  assert.equal(off.some((row) => row.includes("segmenter_new_component_candidate")), false);

  await mongoose.connection.collection("uscisformcomponentdefinitions").deleteMany({});
  await withMode("shadow", () => Discovery.discoverComponentsForParentForm("ZZ-129"));
  assert.deepEqual(await stored(), off, "shadow writes exactly what off writes");

  await mongoose.connection.collection("uscisformcomponentdefinitions").deleteMany({});
  const on = await withMode("on", () => Discovery.discoverComponentsForParentForm("ZZ-129"));
  const rows = await stored();
  assert.ok(rows.includes("ZZ129_A_CLASSIFICATION_SUPPLEM|ACTIVE|3-4|pdf_text_heading_search+field_page_crossref"));
  assert.ok(rows.includes("ZZ129_B_CLASSIFICATION_SUPPLEM|ACTIVE|5-6|pdf_text_heading_search+field_page_crossref"), "B keeps its own range and stays usable");
  assert.ok(rows.includes("ZZ129_Z_CLASSIFICATION_SUPPLEM|REVIEW_REQUIRED|7-8|segmenter_new_component_candidate"), "Z is a candidate, never ACTIVE");
  const z = on.results.find((r) => r.componentCode === "ZZ129_Z_CLASSIFICATION_SUPPLEM");
  assert.equal(z.fieldCount, 0);
  assert.match(z.reviewReason, /New component candidate/);
});

test("on: the previous edition's code is kept when the registry name changed slightly (no orphaned codes)", async (t) => {
  if (!db.ok) return t.skip(db.reason);
  const pdf = await buildPdf([core(1), core(2), sheet("A Classification Supplement", 0), sheet("A Classification Supplement", 1), sheet("B Classification Supplement", 0), sheet("B Classification Supplement", 1)]);
  await seed(pdf, { withZ: false });
  const previousTemplate = new mongoose.Types.ObjectId();
  await USCISFormComponentDefinition.collection.insertOne({ parentFormCode: "ZZ-129", parentTemplateId: previousTemplate, templateVersion: "v0", componentCode: "ZZ129_OLD_A_CODE", name: "A Classification Supplement", componentType: "FORM_COMPONENT", pageRanges: [{ startPage: 3, endPage: 4 }], fieldIds: ["f3"], status: "ACTIVE", discoveredAt: new Date(Date.now() - 86400000), verificationMethod: "pdf_text_heading_search+field_page_crossref" });
  const on = await withMode("on", () => Discovery.discoverComponentsForParentForm("ZZ-129"));
  assert.ok(on.results.some((r) => r.componentCode === "ZZ129_OLD_A_CODE"), "the code A already had is carried");
  const off = await withMode(undefined, () => Discovery.discoverComponentsForParentForm("ZZ-129"));
  assert.ok(off.results.some((r) => r.componentCode === "ZZ129_A_CLASSIFICATION_SUPPLEM"), "off derives the code from the registry name, exactly as before");
});
