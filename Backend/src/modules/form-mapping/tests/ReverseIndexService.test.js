// Phase 2 (§I.2) - ReverseIndexService, against the REAL compiled I-129 mapping graph (loaded via
// FormMappingService.loadTemplate + applyMappingGraph, never hand-parsed from the crosswalk config
// file - see the file's own header comment for why). Requires npm run seed:i129 / seed:i129-mapping
// to have been run against the test DB (already true for this repo's shared local test DB - the
// same seeded data h1-i129-mapping.test.js depends on).
const assert = require("node:assert/strict");
const test = require("node:test");
const mongoose = require("mongoose");

const { connectTestDB, disconnectTestDB } = require("../../../test-utils/db");
const ReverseIndexService = require("../services/ReverseIndexService");

test("ReverseIndexService against the real I-129 mapping graph", async (t) => {
  await connectTestDB();
  t.after(async () => {
    await disconnectTestDB();
  });

  await t.test("person.lastName fans out to exactly the 3 I-129 PDF fields confirmed in Phase 0", async () => {
    const index = await ReverseIndexService.buildReverseIndex("I-129");
    const entries = index["person.lastName"];
    assert.ok(entries, "expected person.lastName to appear in the reverse index");
    assert.equal(entries.length, 3, `expected exactly 3 fan-out fields, got ${entries.length}`);
    entries.forEach((entry) => {
      assert.equal(entry.formCode, "I-129");
      assert.ok(entry.pdfField, "each entry must carry a pdfField");
      assert.equal(typeof entry.reverseSync, "boolean");
    });
  });

  await t.test("a direct atomic field classifies reverseSync: true", async () => {
    const index = await ReverseIndexService.buildReverseIndex("I-129");
    const entries = index["person.lastName"];
    assert.ok(entries.every((entry) => entry.reverseSync === true), "person.lastName is a direct atomic field - every fan-out edge should be reverseSync:true");
  });

  await t.test("a composite/derived field (person.fullName) classifies reverseSync: false", async () => {
    const index = await ReverseIndexService.buildReverseIndex("I-129");
    const entries = index["person.fullName"];
    assert.ok(entries && entries.length, "expected person.fullName to appear in the reverse index");
    assert.ok(entries.every((entry) => entry.reverseSync === false), "person.fullName is composite - every edge should be reverseSync:false");
  });

  await t.test("lookupSource resolves a real mapped pdfField back to its canonical source path", async () => {
    const index = await ReverseIndexService.buildReverseIndex("I-129");
    const [pdfField] = index["person.lastName"].map((entry) => entry.pdfField);
    const sourcePath = await ReverseIndexService.lookupSource(pdfField, "I-129");
    assert.equal(sourcePath, "person.lastName");
  });

  await t.test("lookupSource returns null for a form-only (unmapped) field", async () => {
    const sourcePath = await ReverseIndexService.lookupSource(`__unmapped_probe_field_${new mongoose.Types.ObjectId().toString()}`, "I-129");
    assert.equal(sourcePath, null);
  });

  await t.test("buildReverseIndex with no formCode merges every active form's index", async () => {
    const merged = await ReverseIndexService.buildReverseIndex();
    assert.ok(merged["person.lastName"], "merged index should still contain I-129's person.lastName entries");
    assert.ok(merged["person.lastName"].some((entry) => entry.formCode === "I-129"));
  });
});
