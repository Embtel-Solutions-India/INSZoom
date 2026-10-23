// Phase 7 regression guard: the pure parts of the behavior snapshot (no database, no network).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { pathsOf, compareSnapshots } = require("../formBehaviorSnapshot");

test("pathsOf collects every canonical path an edge reads", () => {
  const paths = pathsOf({ sourcePath: "beneficiary.name", fallback: "person.name", transform: { fields: ["a.b"], source: "c.d", countryPath: "e.f" }, condition: { all: [{ field: "case.visaType" }, { any: [{ path: "x.y" }] }] } });
  assert.deepEqual([...new Set(paths)].sort(), ["a.b", "beneficiary.name", "c.d", "case.visaType", "e.f", "person.name", "x.y"]);
});

const snap = (over = {}) => ({ forms: [{ formCode: "I-131", version: "2025-01-20", edgeCount: 10, projectedCount: 10, mappingsHash: "m", valueCount: 8, valuesHash: "v", render: { ok: true, pageCount: 4, fieldCount: 90, writtenCount: 8, readbackHash: "r" }, ...over }] });

test("identical snapshots compare equal; every kind of behavior change is listed", () => {
  assert.deepEqual(compareSnapshots(snap(), snap()), []);
  assert.match(compareSnapshots(snap(), snap({ valuesHash: "x" })).join("\n"), /valuesHash/);
  assert.match(compareSnapshots(snap(), snap({ render: { ok: true, pageCount: 4, fieldCount: 90, writtenCount: 7, readbackHash: "r" } })).join("\n"), /render\.writtenCount/);
  assert.match(compareSnapshots(snap(), { forms: [] }).join("\n"), /missing from the after snapshot/);
  assert.match(compareSnapshots({ forms: [] }, snap()).join("\n"), /only in the after snapshot/);
});

test("the script never writes to the database or storage (only the explicit --out file)", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "formBehaviorSnapshot.js"), "utf8").split("\n").filter((line) => !/^\s*\/\//.test(line)).join("\n");
  assert.ok(/readOnlyDb/.test(source));
  for (const token of [".insertOne", ".insertMany", ".updateOne", ".updateMany", ".deleteOne", ".deleteMany", ".replaceOne", ".bulkWrite", ".save(", ".create(", "createIndex", "putObject", "writeBuffer"]) assert.equal(source.includes(token), false, `must not contain ${token}`);
});
