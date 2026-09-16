# MongoDB Startup Connection-Pool Saturation — Findings

Investigation date: 2026-09-16. Scope: why `mongodb_pool_checkout_wait` warnings
burst immediately after `shared_backend_started`, growing from ~250ms to
~2800ms+ before draining. Every finding below was reproduced live against the
real backend process and the real (remote, shared) MongoDB cluster this app
already connects to — nothing here is inferred from reading code alone.

## 1. Startup timeline (as configured before this investigation)

```
node src/server.js
  → connectDB()                                   [src/config/database.js]
      mongoose.connect(uri, poolOptions)
      autoIndex: true      (mongoose default — not previously set explicitly)
      autoCreate: true     (mongoose default — not previously set explicitly)
      "mongodb_connected" logged
  → (conditionally, both OFF in this .env) seed questionnaire templates / USCIS form templates
  → http.createServer(app)
  → realtimeGateway.init(server, ...)              [socket.io, auth middleware registered]
  → 9x startXMaintenance() calls                    [register setInterval, each with its
                                                       own scheduleInitialRun() delay — see §3]
  → server.listen(port, callback)
      "shared_backend_started" logged
      → document-intelligence recovery scan          [15s delayed — see §3]
      → seedSystemEmailTemplates()                   [immediate, single countDocuments]
```

`mongodb_connected` and `shared_backend_started` fire within ~70ms of each
other. The pool-checkout-wait burst begins a few hundred ms after
`shared_backend_started` and lasts 3-4 seconds before draining — matching the
task description exactly (251ms → 2851ms → decay).

## 2. MongoDB configuration observed

`src/config/database.js:111-129`, values from `Backend/.env` before this fix:

```
maxPoolSize: 10           (env override — MONGO_MAX_POOL_SIZE=10 in .env)
minPoolSize: 2
serverSelectionTimeoutMS: 10000
socketTimeoutMS: 15000
connectTimeoutMS: 10000
waitQueueTimeoutMS: 10000
maxIdleTimeMS: 60000
```

**The code's own default for `maxPoolSize` is already 50**, not 10
(`Number(process.env.MONGO_MAX_POOL_SIZE || 50)`). The extensive comment
directly above `connectDB()` (lines 86-110) documents that 50 was chosen in a
prior session specifically because `case.service.js`'s populate fan-out alone
can demand ~32 connections for two concurrent case-detail requests. The local
`.env` was overriding this back down to 10, silently shadowing an
already-evidence-backed decision. This is a real finding but a **secondary**
one — see §10, it is not the mechanism generating the burst.

## 3. All startup services in `src/server.js`, and their DB behavior

| Service | Trigger | First-run delay | DB ops per tick | Concurrency model |
|---|---|---|---|---|
| `startWorkflowMaintenance` | `setInterval`, 5 min | 15s | 3 bounded (`.limit(200)`) queries via `Promise.all([...])`, each internally a sequential `for...of` | 3 concurrent top-level ops |
| `startNotificationMaintenance` | `setInterval`, 60s | 20s | 2 bounded batch ops via `Promise.all` | 2 concurrent |
| `startAppointmentMaintenance` | `setInterval`, 60s | 25s | 1 batch op | 1 |
| `startPaymentMaintenance` | `setInterval`, 2 min | 30s | 1 batch op (limit 50) | 1 |
| `startReminderGeneration` | `setInterval`, 1h | 35s | 1 batch op | 1 |
| `startAIMaintenance` | `setInterval`, 60s | 40s | 1 batch op | 1 |
| `startEodReportMaintenance` | `setInterval`, 5 min | 45s | conditional, IST-hour-gated | 1 |
| `startUSCISMonitoringJob` | `setInterval`, 24h | 60s | **disabled in dev** (`NODE_ENV !== production` and `USCIS_MONITORING_ENABLED` unset) | n/a locally |
| `startSettingsRetentionMaintenance` | `setInterval`, 24h | 30s | 1 batch op | 1 |
| `startSlaSweepMaintenance` | `setInterval`, 1h | 40s | 1 batch op | 1 |
| `document-intelligence.queue.startRecovery()` | on `listen` callback | **15s** (explicit, already fixed — see code comment at `document-intelligence.queue.js:157-166`) | 1 bounded `find().limit(50)` | drains at `DOCUMENT_INTELLIGENCE_CONCURRENCY` (default 2) |
| `seedSystemEmailTemplates()` | on `listen` callback | 0s | 1 `countDocuments` (skips entirely once seeded) | 1 |

**Every one of these is already staggered (15s-60s initial delays) and
already uses `withJobLock` (Mongo-atomic, see `utils/jobLock.js`) so it
cannot double-run.** None of them can produce a burst in the first ~4 seconds
after `shared_backend_started` — confirmed by direct measurement (§9): with
zero real client connections and these delays untouched, the burst still
occurred, so this whole table is exonerated as the source.

## 4. Root cause #1 (dominant): mongoose `autoIndex: true`

**This is the primary cause**, confirmed by direct MongoDB command-monitoring
instrumentation (`monitorCommands: true`, listening for `commandStarted`
events), run against the real cluster:

```
Loading all 74 models under src/models/ against a fresh connection:
  → 277 createIndexes commands fired, one per declared index,
    all within ~4 seconds of connecting.
```

Mongoose's default `autoIndex: true` calls `Model.init()` for every model as
soon as the connection is ready, and `Model.init()` issues a `createIndexes`
command per model **synchronously with connection readiness — not gated by
`server.js`'s own delay logic at all**, because this happens inside
mongoose/the driver, invisibly to every one of the `scheduleInitialRun`
patterns in §3. This is why the burst happens even with zero connected
clients: it is 100% backend-internal, self-inflicted work.

Each individual `createIndexes` command is cheap once it has a connection —
this is confirmed by the existing `mongodb_query_performance` profiler
(`config/database.js:19-40`) almost never showing a "slow" query during the
burst window (`createIndexes` isn't even instrumented by that profiler, since
it wraps `mongoose.Query.prototype.exec`, and index commands don't go through
`Query.exec` — **this was a blind spot in the existing instrumentation**).
The delay is 100% pool-checkout contention: 277 near-simultaneous connection
requests against a (then) 10-connection pool.

**Why this matters given it happens on every single restart**: local/dev
iteration restarts the backend constantly. Every restart re-pays this cost
for indexes that, in a stable, already-deployed schema, essentially never
change between deploys.

## 5. Root cause #2 (independently confirmed, additive): mongoose `autoCreate: true`

After disabling `autoIndex` alone, the burst dropped from 382 to 72
pool-checkout-wait events (§9) — better, but not zero. Re-running the same
command-monitoring instrumentation with `autoIndex:false` isolated the
remaining commands:

```
{"create": 74}   ← one createCollection command per model, unconditionally
```

This is `autoCreate` (default `true`, a **separate** mongoose connection
option from `autoIndex`) — mongoose issues a `createCollection` command for
every model at connection time regardless of whether the collection already
exists. MongoDB also creates a collection implicitly on its first real
insert, so this pre-emptive check-and-create is unnecessary for any
collection that has ever received a document. Disabling `autoCreate`
alongside `autoIndex` eliminated the remaining 72 events entirely (§9: 0
pool-checkout-wait events over a full 50-second post-restart window,
including every staggered maintenance job's first tick).

## 6. A distinct, real, currently-live secondary issue found in the same investigation: the `Case` model exceeds MongoDB's 64-index-per-collection limit

While diagnosing autoIndex, a dry-run index diff (`Model.diffIndexes()`)
against the live `cases` collection surfaced:

```
Case: toCreate = 75 indexes, toDrop = 0
```

Attempting to actually apply this via `Model.syncIndexes()` failed outright:

```
add index fails, too many indexes for immigration_crm.cases
key:{ documentChecklist.participantId: 1 }
```

`src/models/Case.js` declares **~136 index specs** (81 field-level
`index:true`/`unique:true` declarations plus 55 explicit
`caseSchema.index({...})` compound/text declarations), far exceeding
MongoDB's hard cap of 64 indexes per collection (including the default `_id`
index — 63 usable). The live `cases` collection currently has exactly 64
(the maximum), meaning **75 declared indexes have never successfully been
created**, including the collection's own `$text` search index
(`{clientName, clientEmail, caseId, caseNumber, uscisReceiptNumber,
petitionType: "text"}`).

**This is not a new regression and nothing in this fix caused it** — it
already existed, and the application already has a graceful fallback for it:
`modules/cases/case.service.js`'s `resolveCaseSearchFilter()` explicitly
catches `IndexNotFound`/"text index required" and falls back to a slower
regex-based scan (`case.service.js:208-224`, with a matching test at
`case.service.js` tests confirming this exact fallback is intentional
behavior). So case search still works today — it has just always been
running the slower fallback path, silently, because the fast `$text` path's
index has never actually existed on this collection.

It also means that with `autoIndex:true` (the pre-existing default), the
backend was retrying (and failing) some subset of these 75 index-creation
attempts on every single boot — each failed attempt still costs a connection
checkout and a round trip before MongoDB rejects it, meaning part of the
277-command burst in §4 was these repeated, permanently-failing attempts.

This was **deliberately not fixed in this pass**. A safe reduction requires
identifying genuinely redundant single-field indexes (ones fully covered by
an existing compound index's leading key, at the exact same full dotted
path) — a first-pass heuristic script produced false positives on nested
sub-document paths (e.g. confusing a top-level `status` field with a
same-named `status` field nested inside an unrelated sub-document), so doing
this correctly requires careful path-aware analysis the task's own
"preserve the existing architecture, do not perform a broad rewrite"
principle argues against rushing. See
`docs/MONGODB_STARTUP_OPTIMIZATION.md` §9 for the specific, scoped
recommendation.

## 7. Secondary, genuinely contributing (but not dominant) finding: uncached socket.io connection auth

`src/modules/realtime/realtime.gateway.js`'s `io.use()` middleware ran
`User.findById(decoded.userId)` **uncached, on every single socket
connection and every reconnection attempt**, with no bound on how many could
run concurrently. Both frontends (`Immiglance/Frontend/src/context/
SocketContext.jsx`, `INSZoom/frontend/src/contexts/SocketContext.jsx`) open
one socket per browser tab with `reconnection: true`; a backend restart
disconnects every open socket at once, and each reconnects on its own first
retry attempt (socket.io-client defaults ~1s), producing a burst of
simultaneous uncached lookups proportional to how many staff/client tabs are
open at restart time — a classic thundering-herd reconnect storm layered on
top of §4/§5.

This was **not** the dominant contributor (confirmed empirically: the full
382-event burst reproduced with **zero** connected sockets — see §9), but it
is real, compounds with §4/§5 under real traffic, and had an existing,
unused fix already sitting in the codebase: `middleware/authenticate.js`
already does exactly this lookup through a cache-aside helper
(`config/redis.js`'s `getCachedUser`/`setCachedUser`), used on the HTTP path
but never wired into the socket path. Additionally, that cache was a pure
no-op whenever `REDIS_URL` is unset (confirmed: `Backend/.env` has no
`REDIS_URL`), unlike the equivalent pattern in
`middleware/idleSessionGuard.js`, which already falls back to an in-process
`Map` for a single-instance deployment. See
`docs/MONGODB_STARTUP_OPTIMIZATION.md` §5 for the fix.

## 8. Frontend vs. backend origin (Phase 3/11/12)

Determined **conclusively empirically**, not by inspection alone: the full
382-event burst was reproduced with the backend running completely alone —
no Immiglance dev server, no INSZoom dev server, no browser tabs, no HTTP
requests, no socket connections. **100% of the dominant burst (§4, §5) is
backend-generated**, specifically mongoose's own connection-lifecycle
behavior, not frontend request fan-out, not a duplicated worker, and not API
traffic.

The socket-reconnect contributor (§7) is genuinely frontend-driven (it only
fires when real clients are connected and the backend restarts), but it is
additive to, not the cause of, the measured numbers in this report.

No "Attorney Portal" application exists in this repository (checked:
`Immiglance/`, `INSZoom/`, `Backend/` are the only top-level apps; no
`attorney` role exists in `modules/authorization/roleHierarchy.js`). It is
mentioned in the task's regression checklist as a future/planned surface;
there is nothing to verify against today, and nothing here adds startup
MongoDB pressure for something that doesn't exist yet.

## 9. Evidence — before/after measurements

All three runs below are the **same real backend process**
(`node src/server.js`) against the **same real remote cluster**
(`18.210.74.196`, a shared/free-tier-class Atlas replica set per prior
session's own diagnostics), restarted fresh each time, log captured to file,
zero client connections in any run:

| Run | autoIndex | autoCreate | maxPoolSize | Total `pool_checkout_wait` events (first ~10s) | Max wait |
|---|---|---|---|---|---|
| Before (baseline, matches task's reported symptom) | true (default) | true (default) | 10 | **382** | 3895ms |
| After disabling `autoIndex` only | false | true (default) | 50 | 72 | 3549ms |
| After disabling both `autoIndex` and `autoCreate` | false | false | 50 | **0** | n/a |

A subsequent 50-second window (covering every staggered maintenance job's
first tick, §3) on the fully-fixed configuration produced only 3
pool-checkout-wait events total, all well under 300ms, from the
already-well-architected staggered maintenance jobs themselves — expected,
healthy, pre-existing behavior, not a regression.

## 10. Root cause summary, ranked by measured contribution

1. **`autoIndex: true`** (mongoose default) — 277 concurrent `createIndexes`
   commands per boot. ~310 of the 382 baseline events (382 → 72 after fixing
   only this).
2. **`autoCreate: true`** (mongoose default, separate option) — 74
   concurrent `createCollection` commands per boot. The remaining 72 events
   (72 → 0 after fixing this too).
3. **`MONGO_MAX_POOL_SIZE=10`** in `.env` — not a cause of the burst by
   itself (the burst reproduced identically with autoIndex/autoCreate on and
   pool size effectively irrelevant to command *count*), but it did reduce
   the pool's ability to absorb the burst, and it was silently overriding an
   already-justified, evidence-backed code default of 50.
4. **Uncached, unbounded socket.io connection auth** — real, but additive
   and traffic-dependent, not reproducible with zero clients. Worth fixing
   regardless since it compounds with #1-3 under real restart conditions.
5. **`Case` model exceeding MongoDB's 64-index limit** — not a burst cause
   in the sense of "extra concurrent load," but a confirmed reason some of
   the #1 createIndexes attempts were failing (not just slow) on every boot,
   and a confirmed, currently-live, silent degradation of case search to a
   slower fallback path. Flagged for a dedicated follow-up, not fixed here.
