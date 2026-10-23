// Phase 7.5: the pure comparison of the read-only evaluation script, and a guard that the script cannot write.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { compare } = require("../evaluateComponentDiscovery");

const def = (componentCode, start, end, status = "ACTIVE") => ({ componentCode, status, pageRanges: [{ startPage: start, endPage: end }] });
const seg = (componentCode, start, end, codeSource = "carried") => ({ kind: "component", startPage: start, endPage: end, componentCode, codeSource, headingText: "h" });

test("compare: identical ranges agree; a missing, an extra and a changed code are each reported", () => {
  assert.equal(compare([def("A", 3, 4), def("B", 5, 6)], { segments: [seg("A", 3, 4), seg("B", 5, 6)] }).agree, true);
  const result = compare([def("A", 3, 4), def("B", 5, 6), def("R", 9, 9, "REVIEW_REQUIRED")], { segments: [seg("A", 3, 4), seg("X", 5, 7, "derived"), seg("B2", 8, 8)] });
  assert.equal(result.agree, false);
  assert.deepEqual(result.missing, [{ componentCode: "B", range: "5-6" }]);
  assert.equal(result.extra.length, 2);
  assert.deepEqual(compare([def("A", 3, 4)], { segments: [seg("A_RENAMED", 3, 4)] }).codeMismatch, [{ stored: "A", segmenter: "A_RENAMED", range: "3-4" }]);
});

test("the evaluation script never writes", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "evaluateComponentDiscovery.js"), "utf8").split("\n").filter((line) => !/^\s*\/\//.test(line)).join("\n");
  assert.ok(source.includes("readOnlyDb"));
  for (const token of [".insertOne", ".insertMany", ".updateOne", ".updateMany", ".deleteOne", ".deleteMany", ".replaceOne", ".bulkWrite", ".save(", ".create(", "createIndex", "writeFileSync"]) assert.equal(source.includes(token), false, `must not contain ${token}`);
});
