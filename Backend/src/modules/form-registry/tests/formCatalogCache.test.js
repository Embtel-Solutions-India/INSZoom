// The short-lived copy of the Form Governance catalog (formCatalogCache.js). DB-free: pure functions plus a real Mongoose schema that is never compiled into a model.
const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const cache = require("../formCatalogCache");

const deferred = () => { let resolve; let reject; const promise = new Promise((res, rej) => { resolve = res; reject = rej; }); return { promise, resolve, reject }; };

test("a finished catalog is reused: the heavy build runs once for repeated requests", async () => {
  cache.invalidate();
  let builds = 0;
  const build = async () => { builds += 1; return [{ formCode: "I-129" }]; };
  const first = await cache.cached(build);
  const second = await cache.cached(build);
  assert.equal(builds, 1);
  assert.equal(second, first);
});

test("simultaneous requests share ONE build", async () => {
  cache.invalidate();
  let builds = 0;
  const gate = deferred();
  const build = () => { builds += 1; return gate.promise; };
  const calls = [cache.cached(build), cache.cached(build), cache.cached(build)];
  gate.resolve(["catalog"]);
  const results = await Promise.all(calls);
  assert.equal(builds, 1);
  assert.deepEqual(results, [["catalog"], ["catalog"], ["catalog"]]);
});

test("a change clears it at once: the next request builds fresh data", async () => {
  cache.invalidate();
  let version = 0;
  const build = async () => ({ version: (version += 1) });
  assert.equal((await cache.cached(build)).version, 1);
  cache.invalidate();
  assert.equal((await cache.cached(build)).version, 2);
});

test("a build that started BEFORE a change is not kept (it may already be stale), but its caller still gets an answer", async () => {
  cache.invalidate();
  const gate = deferred();
  let builds = 0;
  const slow = () => { builds += 1; return gate.promise; };
  const pending = cache.cached(slow);
  cache.invalidate(); // a template was saved while the catalog was being read
  gate.resolve("old read");
  assert.equal(await pending, "old read");
  const fresh = await cache.cached(async () => { builds += 1; return "new read"; });
  assert.equal(fresh, "new read");
  assert.equal(builds, 2);
});

test("a failed build is never kept: the next request tries again", async () => {
  cache.invalidate();
  await assert.rejects(cache.cached(async () => { throw new Error("database busy"); }), /database busy/);
  assert.equal(await cache.cached(async () => "ok"), "ok");
});

test("the copy expires by itself after its short time limit (changes made by another process)", async (t) => {
  cache.invalidate();
  const realNow = Date.now;
  let clock = realNow();
  t.mock.method(Date, "now", () => clock);
  let builds = 0;
  const build = async () => { builds += 1; return builds; };
  assert.equal(await cache.cached(build), 1);
  clock += cache.TTL_MS - 1;
  assert.equal(await cache.cached(build), 1, "still inside the time limit");
  clock += 2;
  assert.equal(await cache.cached(build), 2, "past the time limit: rebuilt");
});

test("watch() attaches to a real schema without error and a write hook clears the copy", async () => {
  cache.invalidate();
  const schema = new mongoose.Schema({ name: String });
  assert.doesNotThrow(() => cache.watch(schema));
  assert.doesNotThrow(() => cache.watch({})); // never stops a model from loading, even with something that is not a schema
  let builds = 0;
  await cache.cached(async () => { builds += 1; return builds; });
  // run the registered post hooks the way Mongoose does after a write
  const hooks = (schema.s.hooks._posts.get("updateOne") || []).map((item) => item.fn);
  assert.ok(hooks.length > 0, "an updateOne hook is registered");
  hooks.forEach((fn) => fn());
  assert.equal(await cache.cached(async () => { builds += 1; return builds; }), 2);
});

test("the three models that feed the catalog are watched (their write hooks are registered)", () => {
  const USCISFormTemplate = require("../../../models/USCISFormTemplate");
  const VisaFormMapping = require("../../../models/VisaFormMapping");
  const USCISFormComponentDefinition = require("../../../models/USCISFormComponentDefinition");
  for (const model of [USCISFormTemplate, VisaFormMapping, USCISFormComponentDefinition]) {
    const posts = model.schema.s.hooks._posts;
    assert.ok((posts.get("updateOne") || []).length > 0, `${model.modelName}: updateOne`);
    assert.ok((posts.get("save") || []).length > 0, `${model.modelName}: save`);
    assert.ok((posts.get("findOneAndUpdate") || []).length > 0, `${model.modelName}: findOneAndUpdate`);
  }
});
