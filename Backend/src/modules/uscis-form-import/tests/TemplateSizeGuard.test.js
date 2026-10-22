// Phase 7.2: the template size guard (exact BSON measurement, per-key breakdown, and removal of ONLY proven duplicate copies). Pure: no database.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { BSON } = require("mongoose").mongo;
const Guard = require("../services/TemplateSizeGuard");

const blob = (mb) => "x".repeat(Math.round(mb * 1024 * 1024));
const questions = (mb) => [{ key: "q", text: blob(mb) }];

function payload({ structureMb = 1, layoutMb = 0.5 } = {}) {
  const formStructure = { sections: [], questions: questions(structureMb) };
  const formLayout = { pages: [{ n: 1, pad: blob(layoutMb) }] };
  return {
    formCode: "I-999", formFields: [{ fieldId: "a", pad: blob(1) }], formStructure, formLayout, fieldIndexes: { a: 1 }, fieldDependencies: [], validationRules: { r: 1 }, sections: [{ id: 1 }],
    definition: { metadata: { formCode: "I-999" }, fields: [{ fieldId: "a", pad: blob(1) }], formStructure, layout: formLayout, questions: formStructure.questions, indexes: { a: 1 }, dependencies: [], validation: { r: 1 }, sections: [{ id: 1 }], pages: [], groups: [] },
  };
}

test("bsonSize is the driver's exact serialized size of a value", () => {
  for (const value of [{ a: 1 }, [1, 2, 3], "text", { nested: { deep: [{ x: "y" }] }, date: new Date() }]) {
    const expected = Buffer.isBuffer(value) ? 0 : (Array.isArray(value) || typeof value !== "object" ? BSON.calculateObjectSize({ v: value }) - 8 : BSON.calculateObjectSize(value));
    assert.equal(Guard.bsonSize(value), expected);
  }
});

test("a small template is ok; the breakdown lists every top-level key, largest first, with the copies the save hook adds", () => {
  const small = { formCode: "I-1", formFields: [{ fieldId: "a" }], formStructure: { questions: [] }, formLayout: {} };
  const result = Guard.check(small);
  assert.equal(result.ok, true);
  assert.equal(result.code, undefined);
  assert.deepEqual(Object.keys(result.sizes).sort(), ["formCode", "formFields", "formLayout", "formStructure"]);
  const big = Guard.measure(payload({ structureMb: 2, layoutMb: 1 }));
  const sizes = Object.values(big.sizes);
  assert.deepEqual(sizes, [...sizes].sort((a, b) => b - a), "largest first");
  assert.ok(big.copies.renderingConfiguration > 3 * 1024 * 1024 - 1, "the empty renderingConfiguration will be filled with layout + structure at save");
  assert.ok(big.estimate > big.sizes.definition, "the estimate includes the copies");
});

test("a template over 14.5 MB is TEMPLATE_TOO_LARGE with the sizes of its parts; the limit comes from TEMPLATE_MAX_BYTES but never above 15.5 MB", () => {
  const big = payload({ structureMb: 3, layoutMb: 1 });
  const small = Guard.check(big, { limit: 40 * Guard.BYTES });
  assert.equal(small.ok, true);
  const limited = Guard.check(big, { limit: 4 * Guard.BYTES });
  assert.equal(limited.ok, false);
  assert.equal(limited.code, "TEMPLATE_TOO_LARGE");
  const error = Guard.tooLargeError(limited);
  assert.deepEqual([error.code, error.status, error.cause], ["TEMPLATE_TOO_LARGE", 413, "template_too_large"]);
  assert.match(error.message, /definition/);
  assert.equal(error.sizes.definition, limited.sizes.definition);
  assert.equal(Guard.check(big, { env: { TEMPLATE_MAX_BYTES: String(100 * Guard.BYTES) } }).limit, 15.5 * Guard.BYTES);
  assert.equal(Guard.check(big, { env: { TEMPLATE_MAX_BYTES: String(2 * Guard.BYTES) } }).limit, 2 * Guard.BYTES);
  assert.equal(Guard.check(big, { env: {} }).limit, Guard.DEFAULT_LIMIT);
});

test("slim removes only definition copies PROVEN identical to their top-level twin, never mutates its input, and stops as soon as the template fits", () => {
  const input = payload({ structureMb: 3, layoutMb: 1 });
  const snapshot = JSON.stringify(input);
  const before = Guard.check(input);
  const limit = before.estimate - 3 * Guard.BYTES;
  const slimmed = Guard.slim(input, { limit });
  assert.equal(JSON.stringify(input), snapshot, "the input is untouched");
  assert.equal(slimmed.ok, true);
  assert.ok(slimmed.after.estimate < before.estimate);
  for (const key of slimmed.removed) assert.equal(key in slimmed.payload.definition, false);
  assert.ok(slimmed.removed.includes("formStructure"));
  // everything that is not a duplicate stays, and the top-level values are the same objects
  assert.deepEqual(slimmed.payload.definition.metadata, { formCode: "I-999" });
  assert.equal(slimmed.payload.formStructure, input.formStructure);
  assert.equal(slimmed.payload.formFields, input.formFields);
});

test("a definition copy that is NOT identical to its top-level twin is kept, whatever its name", () => {
  const input = payload({ structureMb: 3, layoutMb: 1 });
  input.definition = { ...input.definition, layout: { pages: [{ n: 1, pad: "different" }] }, formStructure: { ...input.formStructure, extra: true } };
  const slimmed = Guard.slim(input, { limit: 1 });
  assert.equal("layout" in slimmed.payload.definition, true);
  assert.equal("formStructure" in slimmed.payload.definition, true);
  assert.equal(slimmed.ok, false, "if proven copies are not enough the template is still too large and the caller must refuse it");
  assert.equal(slimmed.after.code, "TEMPLATE_TOO_LARGE");
});

test("tier 2 (definition.fields) is used only when tier 1 is not enough", () => {
  const input = payload({ structureMb: 0.2, layoutMb: 0.1 });
  const tier1 = Guard.slim(input, { limit: Guard.check(input).estimate - 0.2 * Guard.BYTES });
  assert.equal(tier1.removed.includes("fields"), false);
  const tier2 = Guard.slim(input, { limit: Guard.check(input).estimate - 1.3 * Guard.BYTES });
  assert.equal(tier2.removed.includes("fields"), true);
  assert.equal(tier2.ok, true);
});

test("the importer calls the guard only when the switch is not off, and never throws from a failed measurement", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "services", "USCISFormImporterService.js"), "utf8").replace(/\r\n/g, "\n");
  const at = source.indexOf("TemplateSizeGuard.check(templatePayload)");
  assert.ok(at > 0);
  const block = source.slice(source.lastIndexOf("let payloadToSave", at), at + 900);
  assert.match(block, /sizeMode !== "off"/);
  assert.match(block, /catch \(guardError\)/);
  assert.match(source, /createTemplate\(payloadToSave, user, req\)/);
});
