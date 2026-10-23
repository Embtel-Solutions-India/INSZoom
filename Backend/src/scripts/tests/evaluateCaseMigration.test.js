// Phase 7.7 evaluation script: the pure parts, and the guarantee that it cannot write (no database, no network).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { tally, counter, planBoth } = require("../evaluateCaseMigration");
const Recovery = require("../../modules/form-mapping/services/CaseFormMigrationRecovery");

test("planBoth plans a real-shaped case form with today's rules and the 7.7 rules; tally counts them", () => {
  const image = Recovery.imageOf({ filledData: { part1: { name: "Ana" } }, fieldValues: { "part1.name": "Ana" }, manualOverrides: {}, fieldValueProvenance: { [Recovery.encodeKey("part1.name")]: { source: "canonical" } } });
  const field = { fieldId: "part1.name", fieldName: "part1.name", fieldType: "text" };
  const { off, on } = planBoth(Recovery, image, () => field, () => field);
  assert.equal("proof" in off, false);
  assert.equal(on.proof.ok, true);
  const a = tally(counter(), on);
  assert.deepEqual([a.caseForms, a.wouldMigrate, a.parked, a.carried], [1, 1, 0, 2]);
});

test("the script reads through the read-only handle and contains no write call", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "evaluateCaseMigration.js"), "utf8").split("\n").filter((line) => !/^\s*\/\//.test(line)).join("\n");
  assert.ok(/readOnlyDb/.test(source));
  for (const token of [".insertOne", ".insertMany", ".updateOne", ".updateMany", ".deleteOne", ".deleteMany", ".bulkWrite", ".save(", ".create(", "createIndex", "setState", "casUpdate", "createSnapshot"]) assert.equal(source.includes(token), false, `must not contain ${token}`);
});
