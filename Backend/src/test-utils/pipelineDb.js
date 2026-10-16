// Test isolation for the form pipeline (plan Phase 0): DB-backed tests run ONLY against a LOCAL, dedicated test database - never the shared one.
//
//   - default database:  a THROWAWAY database per test process, mongodb://127.0.0.1:27017/form_pipeline_test_<pid>_<random>, dropped when the process finishes - node
//                        runs test files in parallel, and files sharing one database would claim and delete each other's jobs. MONGODB_PIPELINE_TEST_URI
//                        overrides it with a database of your choice (then nothing is dropped, and the files should be run one at a time: --test-concurrency=1);
//   - the URI is refused unless the host is this machine AND the database name starts with "form_pipeline_test" or ends with "_test"
//     AND it is not the application's own database (env.mongoUri);
//   - tests create documents with unique ZZ-PIPE-* form codes, record every id they create, and delete exactly those ids afterwards;
//   - a test refuses to continue when a template it created is referenced by a case form;
//   - when no local MongoDB answers, the DB-backed tests are SKIPPED (not failed), so a machine without one can still run the suite.
// The older immigrationcrm_test database (H7 golden-path tests, protected master data) is deliberately NOT used here.
const mongoose = require("mongoose");
const crypto = require("crypto");

const DEFAULT_URI = "mongodb://127.0.0.1:27017/form_pipeline_test";
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/** Pure. { ok, reason?, database } - may this URI be used for DB-backed tests? `realUri` is the application's own connection string. */
function checkTestUri(uri, realUri = "") {
  let parsed;
  try {
    parsed = new URL(uri);
  } catch {
    return { ok: false, reason: "not a valid mongodb:// URI" };
  }
  if (!/^mongodb(\+srv)?:$/.test(parsed.protocol) || parsed.protocol === "mongodb+srv:") return { ok: false, reason: "only a plain mongodb:// URI to this machine is allowed" };
  const hosts = parsed.host.replace(/^[^@]*@/, "").split(",").map((host) => host.replace(/:\d+$/, "").toLowerCase());
  if (!hosts.length || !hosts.every((host) => LOCAL_HOSTS.has(host))) return { ok: false, reason: `host ${hosts.join(",")} is not this machine` };
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  if (!database) return { ok: false, reason: "the URI names no database" };
  if (!(database.startsWith("form_pipeline_test") || database.endsWith("_test"))) return { ok: false, reason: `database "${database}" is not a test database (name must start with form_pipeline_test or end with _test)` };
  if (realUri) {
    try {
      const real = new URL(realUri);
      const realDatabase = decodeURIComponent(real.pathname.replace(/^\//, ""));
      if (realDatabase && realDatabase === database && real.host.replace(/^[^@]*@/, "") === parsed.host.replace(/^[^@]*@/, "")) return { ok: false, reason: "that is the application's own database" };
    } catch {
      // an unparsable real URI cannot be the same database
    }
  }
  return { ok: true, database };
}

let perProcessDatabase = null;
/** The throwaway database of THIS process: form_pipeline_test_<pid>_<random> (same name for every call in the process). */
function perProcessUri() {
  if (!perProcessDatabase) perProcessDatabase = `form_pipeline_test_${process.pid}_${crypto.randomBytes(3).toString("hex")}`;
  return `mongodb://127.0.0.1:27017/${perProcessDatabase}`;
}
const usesThrowawayDatabase = () => !process.env.MONGODB_PIPELINE_TEST_URI;

function testUri() {
  return process.env.MONGODB_PIPELINE_TEST_URI || perProcessUri();
}

/**
 * Connects mongoose to the test database. Resolves { ok: true, database } or { ok: false, reason } (unsafe URI, or no local MongoDB): never throws and never
 * connects anywhere that failed the check. The collections and indexes of the models a test lists are built explicitly, so unique-index behavior is really exercised.
 */
async function connectPipelineTestDB() {
  const realUri = (() => { try { return require("../config/env").mongoUri || ""; } catch { return process.env.MONGODB_URI || ""; } })();
  const uri = testUri();
  const verdict = checkTestUri(uri, realUri);
  if (!verdict.ok) return { ok: false, reason: verdict.reason };
  if (mongoose.connection.readyState === 0) {
    try {
      await mongoose.connect(uri, { serverSelectionTimeoutMS: 2500, autoIndex: false, autoCreate: false }); // only the models a test lists are created (ensureIndexes), not every loaded model
    } catch (error) {
      return { ok: false, reason: `no local MongoDB answered (${error.message})` };
    }
  }
  const connected = mongoose.connection.name;
  if (connected !== verdict.database) { // belt and braces: whatever mongoose is connected to must be the checked database
    await mongoose.disconnect();
    return { ok: false, reason: `connected to "${connected}", expected "${verdict.database}"` };
  }
  return { ok: true, database: connected };
}

async function disconnectPipelineTestDB() {
  if (mongoose.connection.readyState !== 0) {
    // the throwaway database of this process (and only that, by name) is dropped; a database chosen explicitly through the environment is left alone
    if (usesThrowawayDatabase() && /^form_pipeline_test_\d+_[0-9a-f]{6}$/.test(mongoose.connection.name || "")) await mongoose.connection.dropDatabase().catch(() => null);
    await mongoose.disconnect();
  }
}

/** A form code no real form can have: ZZ-PIPE-<random>. */
const uniqueFormCode = (prefix = "ZZ-PIPE") => `${prefix}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;

/** Remembers every document a test creates so cleanup deletes exactly those, nothing else. */
function createRecorder() {
  const created = []; // { modelName, id }
  return {
    created,
    track(model, doc) {
      const id = doc?._id || doc;
      created.push({ modelName: model.modelName, id });
      return doc;
    },
    /** Creates through the model and records the id. */
    async create(model, data) {
      return this.track(model, await model.create(data));
    },
    async cleanup() {
      const byModel = new Map();
      for (const { modelName, id } of created) byModel.set(modelName, [...(byModel.get(modelName) || []), id]);
      let deleted = 0;
      for (const [modelName, ids] of byModel) {
        const result = await mongoose.model(modelName).collection.deleteMany({ _id: { $in: ids } });
        deleted += result.deletedCount || 0;
      }
      created.length = 0;
      return deleted;
    },
  };
}

/** Throws when any case form references one of these template ids (a test must never touch a template a case form uses). */
async function assertNoCaseFormReferences(templateIds) {
  if (!templateIds?.length) return;
  const CaseForm = require("../models/CaseForm");
  const count = await CaseForm.countDocuments({ formTemplateId: { $in: templateIds } });
  if (count) throw new Error(`${count} case form(s) reference these test templates; refusing to continue`);
}

/** Builds the indexes of the given models in the test database (the application connects with autoIndex off, so tests must do it explicitly). */
async function ensureIndexes(models) {
  for (const model of models) {
    await model.createCollection().catch(() => null); // already exists is fine
    await model.createIndexes();
  }
}

/**
 * node:test helper: registers before/after hooks that connect, build indexes and clean up, and returns { db, recorder } where db.ok says whether the
 * DB-backed tests can run. Use `if (!db.ok) return t.skip(db.reason)` at the top of each test, or the skip helper below.
 */
function useTestDatabase({ before, after }, models = []) {
  const state = { ok: false, reason: "not connected", recorder: createRecorder() };
  before(async () => {
    const result = await connectPipelineTestDB();
    state.ok = result.ok;
    state.reason = result.reason || "";
    state.database = result.database;
    if (result.ok) await ensureIndexes(models);
  });
  after(async () => {
    if (state.ok) await state.recorder.cleanup().catch(() => null);
    await disconnectPipelineTestDB();
  });
  return state;
}

module.exports = {
  DEFAULT_URI, checkTestUri, testUri, perProcessUri, usesThrowawayDatabase, connectPipelineTestDB, disconnectPipelineTestDB, uniqueFormCode, createRecorder, assertNoCaseFormReferences, ensureIndexes, useTestDatabase,
};
