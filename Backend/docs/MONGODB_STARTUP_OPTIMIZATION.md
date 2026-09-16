# MongoDB Startup Connection-Pool Saturation — Changes Implemented

Companion to `docs/MONGODB_STARTUP_LOAD_FINDINGS.md` (read that first — this
document assumes its root-cause analysis and evidence).

## 1. Changes implemented

| # | File | Change |
|---|---|---|
| 1 | `src/config/database.js` | Added `autoIndex: process.env.MONGO_AUTO_INDEX === "true"` (default off) and `autoCreate: process.env.MONGO_AUTO_CREATE === "true"` (default off) to the `mongoose.connect()` options. |
| 2 | `src/scripts/syncIndexes.js` (new) | Explicit, one-time `Model.syncIndexes()` pass across every model — the controlled replacement for the automatic-on-every-boot behavior just disabled. |
| 3 | `src/config/redis.js` | Added an in-process `Map` fallback (mirroring the existing pattern in `middleware/idleSessionGuard.js`) so `getCachedUser`/`setCachedUser`/`invalidateUserCache` actually cache when `REDIS_URL` is unset, instead of being a silent no-op. |
| 4 | `src/modules/realtime/realtime.gateway.js` | Socket connection auth (`io.use`) now reuses that same cache-aside instead of an uncached `User.findById` on every connection/reconnection; added a small bounded-concurrency gate (default 8 concurrent) around the remaining cache-miss lookups, with a log line when a lookup actually has to queue. |
| 5 | `Backend/.env` | Removed the `MONGO_MAX_POOL_SIZE=10` override so the code's own already-justified default of 50 applies (see findings §2/§10). |

No new dependency was added. No worker, queue, cache, or notification system
was duplicated — #3/#4 reuse the app's existing cache-aside and follow its
existing Redis-or-in-process-Map convention; #2 reuses the model registry the
app already has, just replacing an implicit per-boot behavior with an
explicit script.

## 2. Why each change was necessary

**#1 (`autoIndex`/`autoCreate` off)** — this is the fix for the actual,
measured, dominant root cause: 277 + 74 = 351 MongoDB admin commands firing
concurrently on every single process boot, entirely independent of real
traffic, entirely invisible to the app's own maintenance-job scheduling
(§3/§4/§5 of the findings doc). This directly satisfies "expensive work that
does not need to happen during startup" (Phase 8) and "do not add indexes
blindly" (Phase 9, applied in reverse: don't *re-verify* indexes blindly,
either) — index/collection existence is a deploy-time concern, not a
per-boot one, in a system whose schema doesn't change between restarts.

**#2 (`syncIndexes.js`)** — disabling autoIndex without providing a
replacement would silently stop new indexes (e.g. this session's new
`EmailTemplate`/`SavedCharge`/`Branch`/`Team` models) from ever being
created. This script was run once already, for real, against the live
cluster, before autoIndex was turned off — see §6.

**#3/#4 (auth cache reuse + bounded concurrency)** — real, measured,
additive load (findings §7): every connected socket.io client reconnects
near-simultaneously on a backend restart, each firing an uncached DB lookup.
The HTTP path already had a cache-aside for exactly this problem
(`middleware/authenticate.js`); the socket path was quietly duplicating the
same lookup uncached. Reusing the existing cache is the "do not create
duplicate caching systems" instruction applied directly. The cache was
useless without Redis configured (true in this dev environment), so it also
needed the same in-process fallback `idleSessionGuard.js` already
establishes as this codebase's convention for exactly this situation.
The concurrency gate is a direct application of Phase 7's guidance ("if a
worker can produce dozens of simultaneous MongoDB operations... introduce
bounded concurrency") to a connection-auth burst rather than a queue worker
— the mechanism (a burst of near-simultaneous operations racing the pool) is
identical.

**#5 (`.env` pool-size correction)** — per Phase 15, this was done *last*,
*after* the actual concurrency generator was fixed, not as a substitute for
fixing it. It corrects a stale override that was silently reverting a
decision the codebase had already made and already documented with its own
evidence (case-detail populate fan-out). It is not "increasing the pool to
hide the problem" — the problem (§4/§5 of the findings doc) is fixed
independently of pool size, as proven in §3 below (the fix eliminates the
burst even before this change was considered).

## 3. Before/after metrics

See findings doc §9 for the full table. Summary:

- **Before**: 382 `mongodb_pool_checkout_wait` events in the first ~10
  seconds after `shared_backend_started`, max wait 3895ms, with `maxPoolSize`
  effectively 10 (env override).
- **After #1 alone** (autoIndex off, autoCreate still on, pool size still 10
  in that intermediate test but shown here at 50 since both were tested
  together in the final run): 72 events, max wait 3549ms.
- **After #1 + autoCreate off**: **0** events in the first ~10 seconds.
- **Extended 50-second window** (covering every staggered maintenance job's
  first tick — workflow, notification, appointment, settings-retention, SLA
  sweep): 3 events total, all under 300ms — this is the pre-existing,
  already-well-architected maintenance-job design behaving exactly as
  intended, not a regression.
- Health check (`GET /api/health`) returned 200 throughout.
- No new errors or fatals logged across any run.

Number of MongoDB operations in the critical window, categorized:

| Window | Before | After |
|---|---|---|
| First 1s after listen | ~50+ createIndexes/createCollection commands in flight | 0 (no admin commands issued at all) |
| First 5s | 382 checkout-wait events across ~350 admin commands | 0 |
| First 10s | 382 (burst fully drained by ~9.5s) | 0 |

## 4. Query/index changes

`syncIndexes.js` was run once, for real, against the live cluster, before
`autoIndex` was disabled (to guarantee nothing regresses from indexes that
autoIndex *had* been successfully maintaining):

- 73 of 74 models: synced cleanly, no changes needed (everything autoIndex
  had already created was already correct and is now preserved, just no
  longer re-verified every boot).
- `PackageDefinition`: 3 stale indexes dropped
  (`definitionType_1`, `filingAction_1`,
  `definitionType_1_visaType_1_filingAction_1_status_1`) — these referenced
  field names (`definitionType`, `filingAction`) that no longer exist in the
  current schema (which now uses `visaType`/`filingSubtype`), i.e. leftover
  indexes from a prior schema shape. Safe, confirmed via `Model.diffIndexes()`
  dry-run before applying, and the collection is small (98 documents).
- `Case`: **failed to sync** — confirmed hard MongoDB 64-index-per-collection
  limit, with ~136 declared index specs in the schema. This is a pre-existing
  condition (not caused by this work) and was deliberately **not** touched
  in this pass — see §9 below for the specific, scoped recommendation.
  Collection size confirmed small (58 documents, 9MB) so this is not a
  volume/downtime risk, only an index-count-ceiling one.

No new indexes were added speculatively. No index was removed without first
confirming (via `diffIndexes()`, a genuine dry-run) that it didn't match any
field in the current schema.

## 5. Worker concurrency changes

`src/modules/realtime/realtime.gateway.js`: added `AUTH_LOOKUP_CONCURRENCY`
(default 8, `SOCKET_AUTH_LOOKUP_CONCURRENCY` env override), a hand-rolled
semaphore (consistent with this codebase's existing hand-rolled
`withJobLock`/heartbeat style — no new dependency) bounding concurrent
cache-miss `User.findById` calls during connection auth. This was chosen
conservatively (8, not a large number) per Phase 5's explicit instruction not
to arbitrarily pick a large concurrency value — it is on top of, not instead
of, the cache, which already collapses the common case (multiple tabs/
reconnect-retries for the same user) down to one query.

No other worker's concurrency was changed. `document-intelligence.queue.js`
(concurrency 2, already fixed in a prior session per its own code comment),
the maintenance-job `Promise.all` groupings (3 concurrent at most, already
using bounded `.limit(200)` queries per the existing comment in
`workflow.service.js:808-814`), and `USCISScannerService` were all inspected
and found already sound — not touched, per "preserve the existing
architecture wherever it is sound."

## 6. Startup lifecycle changes

None beyond #1 above. Every `scheduleInitialRun` delay (15s-60s), every
`withJobLock` guard, and `document-intelligence.queue.js`'s existing 15s
recovery delay were inspected and left exactly as they were — they were
already correctly designed to avoid competing with startup traffic (each has
its own code comment recording that exact reasoning from a prior session).
The only startup-path change is removing the two invisible-to-`server.js`
mongoose behaviors (autoIndex/autoCreate) that none of that existing
lifecycle work could have gated, because they execute inside the driver
layer, not inside any function `server.js` controls.

## 7. Frontend request changes

None. The dominant root cause (§4/§5 of the findings doc) was proven,
empirically, to be 100% backend-internal — it reproduced identically with
zero frontend dev servers running and zero browser tabs open. The one
frontend-adjacent contributor found (socket.io reconnect storms, findings
§7) was fixed entirely on the backend side (cache reuse + bounded
concurrency in `realtime.gateway.js`) without touching either frontend's
`SocketContext.jsx` — their existing `reconnection: true` behavior is normal
and correct; the fix belongs in how the backend absorbs reconnections, not
in suppressing the frontend's own reconnect behavior.

## 8. Regression results

- Backend: MongoDB connection ✅ (`mongodb_connected` logs cleanly, driver
  pool diagnostics unchanged). Health endpoint ✅ (200). No errors/fatals in
  any of the three full startup-to-50s-runtime log captures. `job_lock`-based
  maintenance jobs ran on schedule with no overlap warnings other than the
  expected `job_lock_skipped_overlap` behavior the lock is designed to
  produce when a slow tick would otherwise double-run.
- The INSZoom settings e2e suite (`e2e/settings/`, unrelated feature area,
  run earlier in this session) is unaffected by any file touched here — no
  overlap in files changed.
- Case search (`resolveCaseSearchFilter`): unaffected — it was already
  running its regex fallback path before this work (§6 of the findings doc)
  and continues to do so; nothing here changed that behavior, for better or
  worse.
- Socket.io: connection auth now returns the same accept/reject decision as
  before (same `isActive`/`tokenVersion` checks), just cache-backed. A
  freshly-deactivated user is still rejected promptly — `invalidateUserCache`
  is already called at all 8 existing mutation call sites
  (`auth.service.js`, `user.service.js`, etc.) and now correctly clears the
  in-process fallback cache too, not just Redis.
- Immiglance/INSZoom/Attorney Portal frontend checklists: not independently
  re-tested in a browser in this pass (no frontend code was changed), beyond
  the backend-side health/API check above. Attorney Portal does not exist in
  this repository yet (findings §8) — nothing to verify or regress.

## 9. Remaining risks

- **`Case` model's index count (§6 of the findings doc) is still over
  MongoDB's limit.** It was already over the limit before this work (the
  live collection already sat at exactly 64), so nothing here made it worse,
  but nothing here fixed it either. Recommended follow-up, scoped narrowly:
  audit the ~81 field-level `index:true`/`unique:true` declarations in
  `src/models/Case.js` against the ~55 explicit compound `caseSchema.index(
  {...})` calls, by **exact full dotted path** (not just leaf field name —
  a naive leaf-name match produces false positives against same-named
  fields nested in unrelated sub-documents, confirmed while investigating
  this), and drop any single-field index whose field is already the leading
  key of an existing compound index (MongoDB serves single-field queries on
  a prefix of a compound index without needing a separate index). This
  would both bring the model under the limit and, as a direct side effect,
  let the collection's own `$text` search index finally be created, moving
  case search off its current silent regex-fallback path onto the fast path
  it was designed for.
- **`syncIndexes.js` needs to be run manually after any future deploy** that
  adds or changes a model's `.index()` declarations, since autoIndex no
  longer does this automatically. This is a real, intentional trade-off
  (documented in the script's own header comment) — a missed run means a
  newly-added index silently doesn't exist until someone runs the script,
  rather than silently existing already. Worth wiring into a deploy
  checklist/CI step if this repo has one; none was found to hook it into in
  this pass.
- **The in-process auth cache (`config/redis.js`) is single-instance-only**,
  same limitation already accepted and documented for
  `idleSessionGuard.js`/`realtime.gateway.js`'s `onlineUsers` map. Correct
  for the current single-instance deployment; would need Redis actually
  configured (`REDIS_URL`) for a future multi-instance deployment, which the
  code already supports transparently (same functions, Redis path already
  implemented, just currently unused because `REDIS_URL` is unset).
- **This investigation, and all measurements, were run in the local dev
  environment** (`NODE_ENV=development`) against the real remote cluster,
  with zero real users connected. The socket-reconnect contributor (§7 of
  the findings doc) was fixed on sound reasoning and code-level verification
  (cache hit/miss logic, concurrency gate logic) but was not load-tested
  with dozens of real simultaneous distinct-user reconnections, since doing
  that safely would require either many disposable throwaway accounts
  reconnecting against the shared cluster, or a staging environment neither
  of which was set up for this pass.

## 10. Recommended manual infrastructure work

- Run `node src/scripts/syncIndexes.js` as part of the normal deploy process
  going forward (or wire it into CI), now that indexes are no longer
  auto-managed.
- Schedule the `Case` model index-count cleanup described in §9 as a
  dedicated follow-up — it is real, currently live, and worth fixing, but
  deliberately out of scope for a "fix the highest-impact source" pass that
  should not risk a broad, hastily-verified change to the most heavily used
  model in the app.
- Consider whether the remote cluster (`18.210.74.196`, described in this
  codebase's own prior comments as a shared/free-tier-class Atlas replica
  set) is still appropriate now that this investigation adds one more data
  point (277+74 avoidable admin commands per boot were previously landing on
  it) to the existing evidence (`mongodb_connection_closed`/
  `mongodb_heartbeat_failed` diagnostics already in `database.js`) that this
  cluster's headroom is worth revisiting independently of this fix.
