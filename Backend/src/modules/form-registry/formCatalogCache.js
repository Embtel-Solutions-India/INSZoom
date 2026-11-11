// A short-lived, in-process copy of the Form Governance catalog (GET /api/form-registry/catalog).
//
// Building it reads every form template (114 of them, ~470 MB on the shared database), which takes several seconds, and the page asks for it every time it opens. This keeps the
// finished catalog for a few seconds so reopening the page, a second tab or a quick refresh does not repeat that read, and lets simultaneous requests share ONE build.
//
// It can never show stale data after a change made through this server: any save / update / delete of a form template, a form mapping or a component definition clears it at once
// (watch() below is attached to those three models), and the endpoints that change catalog data clear it explicitly. A change made from ANOTHER process (a one-off script, a second
// server) is picked up when the short time limit passes. If anything about the cache fails, the catalog is simply built fresh - it is never a reason for an error.

const TTL_MS = 20 * 1000;
let entry = { at: 0, value: null, promise: null, version: 0 };
let version = 0; // bumped by every invalidate(); a build that started before a bump is never stored

function invalidate() {
  version += 1;
  entry = { at: 0, value: null, promise: null, version };
}

/** The cached catalog, or a fresh build via `build()` (shared by simultaneous callers). Never throws because of the cache itself. */
async function cached(build) {
  const now = Date.now();
  if (entry.value && now - entry.at < TTL_MS) return entry.value;
  if (entry.promise) return entry.promise;
  const startedAtVersion = version;
  const promise = Promise.resolve()
    .then(build)
    .then((value) => {
      if (version === startedAtVersion) entry = { at: Date.now(), value, promise: null, version }; // not stored if something changed while it was being built
      else if (entry.promise === promise) entry = { at: 0, value: null, promise: null, version };
      return value;
    })
    .catch((error) => {
      if (entry.promise === promise) entry = { at: 0, value: null, promise: null, version }; // a failure is never kept
      throw error;
    });
  entry = { at: 0, value: null, promise, version };
  return promise;
}

const QUERY_HOOKS = ["updateOne", "updateMany", "findOneAndUpdate", "findOneAndReplace", "findOneAndDelete", "replaceOne", "deleteOne", "deleteMany"];
const DOCUMENT_HOOKS = ["save"];

/** Attach to a model's schema (before the model is compiled): any write through this server clears the cache. Never throws. */
function watch(schema) {
  try {
    for (const name of [...QUERY_HOOKS, ...DOCUMENT_HOOKS]) {
      try { schema.post(name, function clearFormCatalog() { invalidate(); }); } catch (_error) { /* a hook name this Mongoose does not take: the time limit still covers it */ }
    }
    try { schema.post("insertMany", function clearFormCatalog() { invalidate(); }); } catch (_error) { /* same */ }
  } catch (_error) { /* never stops a model from loading */ }
}

module.exports = { cached, invalidate, watch, TTL_MS };
