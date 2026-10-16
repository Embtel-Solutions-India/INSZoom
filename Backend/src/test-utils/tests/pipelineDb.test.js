// The test-database guard is pure and DB-free: it must refuse anything that is not a local test database, above all the shared one.
const test = require("node:test");
const assert = require("node:assert/strict");
const { checkTestUri, DEFAULT_URI, uniqueFormCode, createRecorder, perProcessUri, testUri } = require("../pipelineDb");

const REAL = "mongodb://appuser:secret@18.210.74.196:27017/immigration_crm?authSource=admin";

test("the default test database is local and dedicated", () => {
  assert.deepEqual(checkTestUri(DEFAULT_URI, REAL), { ok: true, database: "form_pipeline_test" });
  assert.equal(checkTestUri("mongodb://localhost:27017/form_pipeline_test_ci", REAL).ok, true);
  assert.equal(checkTestUri("mongodb://localhost/immigrationcrm_test", REAL).ok, true, "any local *_test database is acceptable");
  assert.equal(checkTestUri("mongodb://u:p@127.0.0.1:27017/x_test?authSource=admin", REAL).ok, true);
  assert.equal(checkTestUri("mongodb://[::1]:27017/form_pipeline_test", REAL).ok, true);
});

test("the shared database, any remote host and any non-test database name are refused", () => {
  for (const uri of [
    REAL,
    "mongodb://18.210.74.196:27017/form_pipeline_test", // right name, wrong machine
    "mongodb://127.0.0.1:27017,18.210.74.196:27017/form_pipeline_test", // one remote member in the replica list
    "mongodb://127.0.0.1:27017/immigration_crm", // local but not a test database (the user's local copy of the app database)
    "mongodb://127.0.0.1:27017/inszoom_crm",
    "mongodb://127.0.0.1:27017/",
    "mongodb://127.0.0.1:27017",
    "mongodb+srv://cluster.example.net/form_pipeline_test",
    "https://localhost/form_pipeline_test",
    "not a uri",
    "",
  ]) assert.equal(checkTestUri(uri, REAL).ok, false, uri);
});

test("a test URI that is the application's own database is refused even when it looks local", () => {
  const local = "mongodb://127.0.0.1:27017/app_test";
  assert.equal(checkTestUri(local, local).ok, false);
  assert.match(checkTestUri(local, local).reason, /application's own database/);
  assert.equal(checkTestUri(local, "mongodb://127.0.0.1:27017/other").ok, true);
});

test("form codes are unique and unmistakably test data", () => {
  const codes = new Set(Array.from({ length: 200 }, () => uniqueFormCode()));
  assert.equal(codes.size, 200);
  for (const code of codes) assert.match(code, /^ZZ-PIPE-[0-9A-F]{6}$/);
});

test("the recorder remembers exactly what it was handed", () => {
  const recorder = createRecorder();
  const model = { modelName: "Thing" };
  recorder.track(model, { _id: "a" });
  recorder.track(model, "b");
  assert.deepEqual(recorder.created, [{ modelName: "Thing", id: "a" }, { modelName: "Thing", id: "b" }]);
});

test("each test process gets its own throwaway database, which passes the guard; an explicit URI overrides it", () => {
  const first = perProcessUri();
  assert.equal(perProcessUri(), first, "stable within a process");
  assert.match(first, /^mongodb:\/\/127\.0\.0\.1:27017\/form_pipeline_test_\d+_[0-9a-f]{6}$/);
  assert.equal(checkTestUri(first, REAL).ok, true);
  const previous = process.env.MONGODB_PIPELINE_TEST_URI;
  try {
    delete process.env.MONGODB_PIPELINE_TEST_URI;
    assert.equal(testUri(), first);
    process.env.MONGODB_PIPELINE_TEST_URI = "mongodb://127.0.0.1:27017/mine_test";
    assert.equal(testUri(), "mongodb://127.0.0.1:27017/mine_test");
  } finally {
    if (previous === undefined) delete process.env.MONGODB_PIPELINE_TEST_URI; else process.env.MONGODB_PIPELINE_TEST_URI = previous;
  }
});
