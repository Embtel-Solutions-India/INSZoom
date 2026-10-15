// Release 0a read-only guarantees. DB-free: a fake database handle records every call.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { readOnlyDb } = require("../lib/readOnlyDb");

// a stand-in for the native driver: every method records that it was called
function fakeDb() {
  const calls = [];
  const collection = (name) => new Proxy({}, { get: (_t, method) => (...args) => { calls.push({ collection: name, method: String(method), args }); return { toArray: async () => [] }; } });
  return { calls, collection };
}

test("reads go through: find, aggregate, countDocuments, distinct", () => {
  const db = fakeDb();
  const reader = readOnlyDb(db);
  reader.collection("things").find({}, { projection: { a: 1 } });
  reader.collection("things").aggregate([{ $group: { _id: "$a" } }]);
  reader.collection("things").countDocuments({});
  reader.collection("things").distinct("a");
  assert.deepEqual(db.calls.map((call) => call.method), ["find", "aggregate", "countDocuments", "distinct"]);
});

test("every write is refused before it reaches the driver", () => {
  const db = fakeDb();
  const reader = readOnlyDb(db);
  for (const method of ["insertOne", "insertMany", "updateOne", "updateMany", "replaceOne", "deleteOne", "deleteMany", "findOneAndUpdate", "findOneAndDelete", "bulkWrite", "drop", "createIndex", "dropIndex", "rename"]) {
    assert.throws(() => reader.collection("things")[method]({}), /read-only database handle/, method);
  }
  assert.equal(db.calls.length, 0, "nothing was sent to the driver");
});

test("database-level operations are refused (dropDatabase, createCollection, command)", () => {
  const reader = readOnlyDb(fakeDb());
  for (const method of ["dropDatabase", "createCollection", "command", "dropCollection", "admin"]) assert.throws(() => reader[method], /read-only database handle/, method);
});

test("an aggregation that would write ($out / $merge) is refused", () => {
  const db = fakeDb();
  const reader = readOnlyDb(db);
  assert.throws(() => reader.collection("things").aggregate([{ $match: {} }, { $out: "copy" }]), /\$out/);
  assert.throws(() => reader.collection("things").aggregate([{ $merge: { into: "copy" } }]), /\$merge/);
  assert.equal(db.calls.length, 0);
});

test("readOnlyDb rejects a handle that is not a database", () => {
  assert.throws(() => readOnlyDb(null), /collection/);
  assert.throws(() => readOnlyDb({}), /collection/);
});

// Static guard: the two Release 0a scripts contain no database write at all, and the only file write is the explicit --out.
const SCRIPT_DIR = path.join(__dirname, "..");
const SCRIPTS = ["formEditionPolicyRolloutReport.js", "formSourceRedirectCrawl.js"];
const FORBIDDEN = [
  /\.save\(/, /\.create\(/, /insertOne|insertMany/, /updateOne|updateMany/, /deleteOne|deleteMany/, /findOneAndUpdate|findByIdAndUpdate|findOneAndDelete/,
  /bulkWrite|replaceOne/, /\.drop\(|dropDatabase|dropCollection/, /createIndex|syncIndexes|ensureIndexes/, /\$set\b|\$push\b|\$unset\b|\$out\b|\$merge\b/, /connectDB\b/, /\.remove\(/,
];

for (const file of SCRIPTS) {
  test(`${file} contains no database write and writes a file only through writeOutputFile`, () => {
    const source = fs.readFileSync(path.join(SCRIPT_DIR, file), "utf8");
    // comments may talk about writes ("writes nothing"); only code is checked
    const code = source.split("\n").filter((line) => !line.trim().startsWith("//")).join("\n");
    for (const pattern of FORBIDDEN) assert.equal(pattern.test(code), false, `${file} must not contain ${pattern}`);
    const fileWrites = code.match(/fs\.(writeFile|writeFileSync|appendFile|appendFileSync|createWriteStream|mkdir|mkdirSync|rm|rmSync|unlink|unlinkSync|rename|renameSync)\b/g) || [];
    assert.deepEqual(fileWrites, ["fs.writeFileSync"], "exactly one file write, inside writeOutputFile");
    const inside = code.match(/function writeOutputFile\([^)]*\) \{[\s\S]*?\n\}/);
    assert.ok(inside && inside[0].includes("fs.writeFileSync"), "the file write lives in writeOutputFile");
  });

  test(`${file} does nothing when only required (no connection, no network, no output)`, () => {
    const before = process.listenerCount("exit");
    require(path.join(SCRIPT_DIR, file));
    assert.equal(process.listenerCount("exit"), before);
  });
}
