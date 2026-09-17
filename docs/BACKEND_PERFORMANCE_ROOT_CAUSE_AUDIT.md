# Backend Performance Root-Cause Audit — Intermittent `tasks`/`workflows`/`settingvalues` Latency

Investigation dates: **2026-09-17** (first pass) and **2026-09-18** (this extended pass).
Read-only investigation, both passes — no repository file other than this report was
created, edited, or deleted; no index, document, or server setting was modified; no
additional backend/frontend process was started or restarted; no package was
installed/updated. All MongoDB diagnostics were run through short-lived, throwaway
read-only `MongoClient` connections (scratch scripts kept outside the repo, in the
session scratchpad, and deleted immediately after use) that reused the existing
`Backend/.env` connection string.

This pass extends, re-verifies, and in one place **corrects** the 2026-09-17 report
rather than replacing it. Every finding below is labeled either **carried over
(re-verified)**, **carried over (unchanged, not re-tested)**, or **new this pass**, and
every status uses one of: `CONFIRMED`, `LIKELY`, `POSSIBLE`, `NOT SUPPORTED`,
`RULED OUT`, `UNABLE TO VERIFY`.

---

## 1. Executive Summary

The original symptom — `settingvalues.findOne` 7095ms, `tasks.find` 3188ms,
`workflows.find` 4240ms, `mongodb_pool_checkout_wait` 4004ms, against a backdrop of
structurally identical operations elsewhere completing in 230-290ms — was already
narrowed by the 2026-09-17 pass to a **LIKELY** primary cause: high, fairly constant
network latency to a remote MongoDB host (18.210.74.196) combined with a connection
pool that decays to `minPoolSize=2` between this app's own legitimate bursts of
concurrent Mongo operations.

This pass **re-measured that network cost from scratch, 24 hours later, and it
reproduced almost exactly** (§9, §11): average round-trip time 248.2ms today vs.
250.7ms on 2026-09-17; cold-connection cost 1507ms today vs. 1793ms on 2026-09-17;
20-connection concurrent burst cost 2380ms today vs. 3000ms on 2026-09-17. The same
backend process (PID 10496, unchanged since the prior pass — §7) is still the only
thing listening on port 7000. This independent reproduction raises the network/pool
mechanism from "measured once" to "measured twice, 24 hours apart, with consistent
results" — meaningfully strengthening (not proving) the LIKELY primary root cause.

This pass's actual job, however, was to go past that mechanism and inventory *every*
request/job pattern in this codebase capable of demanding a burst of concurrent
connections, and the results are more severe than the 2026-09-17 pass knew about:

- **The dashboard/analytics endpoint (`GET /api/dashboard`, `/api/analytics/*`) fans
  out to roughly 45-58 concurrent Mongo aggregate/count operations per single HTTP
  request** (§8.2, §17) — larger than the case-detail fan-out the prior report
  flagged as the worst offender — **and its caching layer is completely inert in
  this environment** (`cachedDashboardCompute` returns `compute()` directly whenever
  Redis isn't configured, with no in-memory fallback, unlike the auth-user cache and
  idle-session guard, both of which do have one — §10, §16). `REDIS_URL` is
  confirmed unset in `Backend/.env`, so **every single dashboard load in this dev
  environment recomputes the full ~45-58-operation burst from scratch, uncached,
  every time.** This is the single largest newly-identified amplifier in this
  investigation.
- At least **six more unbounded, headcount/data-scaled fan-outs** exist elsewhere in
  the codebase (admin document-overview, case-manager list/analytics, leaderboard
  calculation, bulk case update, settings catalog) that were not in scope for the
  prior pass at all (§17).
- **Ten recurring background jobs** run on the shared connection pool, not two —
  the prior report only knew about `startWorkflowMaintenance` (5 min) and
  `startNotificationMaintenance` (60s); this pass finds eight more registered in
  `server.js` (§13), three of which cluster within 5-20 seconds of each other every
  minute by construction.
- **A confirmed request-path amplifier independent of MongoDB entirely**: SMTP email
  (via Resend, `SMTP_HOST=smtp.resend.com` — genuinely configured in this dev
  `.env`, not hypothetical) has no configured connection/socket timeout anywhere in
  the codebase, and several request handlers (case-manager assignment, team-lead
  assignment, ownership transfer, employee invitation, password reset) `await` it
  synchronously before responding (§16). The team has already fixed this exact
  failure mode once, for case creation specifically (a documented, previously
  profiled ~2-minute stall, `case.controller.js:1225-1237` — confirmed by direct
  read), but did not apply the same fix to the other five endpoints that still
  await the same call chain.
- **Frontend request amplification is real, but uneven across the three apps**:
  Immiglance and Admin both use React Query and it demonstrably deduplicates
  same-key requests; Attorney has no client-side cache at all and has a **confirmed,
  reproducible duplicate request** (`GET /attorney/dashboard` fired twice per
  dashboard load, once from a shared layout hook and again from the page itself —
  §14). React StrictMode is present in Immiglance and Attorney (doubling raw
  `useEffect`-driven fetches in dev only) but absent in Admin.

None of this replaces the network/pool mechanism as the best-evidenced explanation
for *why* an individual slow operation takes multiple seconds once a burst
arrives (§9-§11 continue to show query execution itself is single-digit
milliseconds server-side). What this pass adds is a much larger, more precise
account of *how often and how large* those bursts really are, plus several
independent, non-MongoDB latency risks on specific routes that can produce
multi-second-or-worse tail latency on their own.

**No manual validation gap from the prior pass has been closed.** `serverStatus`/
`currentOp` are still refused for lack of privilege (§9.4, identical error text to
2026-09-17); no persisted log file exists; the replica-set-vs-standalone topology
discrepancy is unchanged. These remain the largest genuine unknowns (§22).

---

## 2. Problem Statement

Users of all three frontends (Immiglance client portal, Admin/INSZoom internal CRM,
Attorney portal) intermittently observe multi-second page loads on case-detail and
dashboard views, while structurally identical requests elsewhere complete in
200-300ms. The originally reported symptom lines (`settingvalues.findOne` 7095ms,
`tasks.find` 3188ms, `workflows.find` 4240ms, `mongodb_pool_checkout_wait` 4004ms)
were captured from the existing query-performance/pool-diagnostic instrumentation
already built into `Backend/src/config/database.js`, not from ad-hoc logging added
for this investigation. This pass's task, per its own scope, was explicitly **not**
to re-litigate whether that mechanism is real, but to go deeper into everything the
first pass did not fully cover: full request waterfalls, an exhaustive concurrency
map, frontend request amplification with actual proof, job-lock and worker
scheduling detail, retry/amplification behavior repo-wide, and external-service
critical-path exposure.

---

## 3. Observed Timings

Carried over verbatim from 2026-09-17 (not re-captured this pass — no persisted log
exists to pull a fresh incident from, §22):

| Operation | Observed duration |
|---|---|
| `settingvalues.findOne` | 7095ms |
| `tasks.find` | 3188ms |
| `workflows.find` | 4240ms |
| `mongodb_pool_checkout_wait` | 4004ms |
| `workflows.find` (fast case) | 288-289ms |
| `tasks.find` (fast case) | 232ms |
| `joblocks.updateOne` (fast case) | 227ms |
| `notifications.find` (fast case) | 238ms |

New, real timings captured this pass (2026-09-18, §11) sit alongside these for
comparison in §9 and §11.

---

## 4. Existing Configuration

Re-verified directly from the live files on 2026-09-18 (unchanged from 2026-09-17):

`Backend/src/config/database.js:133,141`:
```js
autoIndex: process.env.MONGO_AUTO_INDEX === "true",
autoCreate: process.env.MONGO_AUTO_CREATE === "true",
```
`Backend/.env` defines neither variable, so both are `false`. No
`MONGO_MAX_POOL_SIZE` override is present (removed deliberately, per its own
in-file comment), so the following live:
```js
maxPoolSize: Number(process.env.MONGO_MAX_POOL_SIZE || 50),   // = 50
minPoolSize: Number(process.env.MONGO_MIN_POOL_SIZE || 2),    // = 2
socketTimeoutMS: Number(process.env.MONGO_SOCKET_TIMEOUT_MS || 15000), // = 15000
```
`MONGODB_URI` in `Backend/.env:4` is unchanged: `mongodb://Ishan_Ins:***@18.210.74.196:27017/immigration_crm?authSource=admin`.

**New this pass**: `Backend/.env` was also checked for `REDIS_URL` — **it is not
set**. This single fact is load-bearing for §10/§16: every Redis-backed cache-aside
in this codebase (`config/redis.js`) has an explicit, well-commented in-memory
`Map` fallback for the *auth-user cache* and *idle-session last-active* — **except
the dashboard/analytics cache (`cachedDashboardCompute`), which has none.**

**Status: CONFIRMED unchanged.**

---

## 5. Prior Findings Summary (2026-09-17, carried over)

For readers who only want the earlier pass's conclusions:

- Old `autoIndex`/`autoCreate` startup storm — confirmed still fixed.
- No duplicate/competing backend process — confirmed one instance on :7000.
- No missing/bad indexes and no 64-index-cap recurrence on `tasks`/`workflows`/
  `settingvalues`/`notifications`/`joblocks` — confirmed via live `.explain()`.
- No large data volume on those five collections.
- Directly measured ~250ms baseline Mongo round-trip time, ~1.8s cold-connection
  cost, ~3s for a 20-connection concurrent burst.
- `case.service.js`'s case-detail fan-out (19-path populate + 9-way
  `Promise.all` in `getRelatedRecords`) and the two background jobs then known
  (5-min workflow maintenance, 60s notification maintenance) identified as
  request patterns that legitimately demand 20-30+ concurrent Mongo operations.
- Primary root cause: **LIKELY**, not `CONFIRMED` — network latency + connection
  pool decay meeting this app's own concurrency bursts.
- Two big gaps: `serverStatus`/`currentOp` refused for privilege; no persisted
  log file to correlate timestamps.

Every one of these is re-examined below where this pass has new evidence, and
carried forward unchanged where it doesn't.

---

## 6. Methodology

Same discipline as the prior pass, extended:

- **Static analysis**: `Grep`/`Read` across `Backend/src`, `Immiglance/Frontend/src`,
  `Admin/frontend/src`, `Attorney/src` for the specific patterns each scope item
  (A-M in this pass's brief) asked for — `Promise.all`/`allSettled`/`race`/`any`,
  `.map(async`, `.forEach(async`, `for await`, `retry`/`retries`/`backoff`,
  `setInterval`/polling hooks, `React.StrictMode`, external-service SDK/`fetch`
  calls and their timeout options.
- **Live process inspection**: `Get-CimInstance Win32_Process`, `netstat -ano`,
  `Get-Process`, `Get-Counter` — read-only, no process was started, stopped, or
  restarted.
- **Live, read-only MongoDB checks**: a single throwaway script (`netcheck.js`,
  written to the session scratchpad, deleted immediately after this pass) reusing
  the real `Backend/.env` connection string, doing only `{ping:1}`, `{hello:1}`,
  a doomed `{serverStatus:1}`/`{currentOp:1}` (expected-refusal, recorded, not
  worked around), and one concurrent burst of 20 pings on a fresh client. No
  write, no index change, no admin command that alters state.
- **Live, safe HTTP checks against the already-running dev backend** (`:7000`):
  `curl` timing against `GET /api/health` (touches no database) and an
  unauthenticated `GET /api/cases/:id` (401s before reaching Mongo) — both
  read-only, no credentials were fabricated or guessed, and no authenticated
  Mongo-touching request was attempted (no valid JWT was available in this
  read-only pass — see §22 for what this leaves unverified).
- Delegated three background research passes (bounded to READ-ONLY code
  investigation, explicitly instructed not to edit/write/run any state-changing
  command) to cover the sheer file-count of B (concurrency mapping), C (frontend
  amplification), and E/F/G/H (job-lock, worker, retry, external-service audits)
  in parallel with this session's own direct reads; every citation from those
  passes that appears below was either independently spot-checked by this session
  (§8, §13, §16) or is presented with its file:line citation intact so it can be
  independently re-verified.

---

## 7. Startup Timeline / Process Verification (re-verified)

```
PID 15456  cmd.exe /d /s /c nodemon src/server.js
PID 21992  node .../nodemon.js src/server.js   (same PID as 2026-09-17)
PID 10496  node src/server.js                   (same PID as 2026-09-17 — the real backend)
PID 5316   vite (Immiglance/Frontend)           -> LISTENING [::1]:5173 (same PID)
PID 23280  vite (Attorney)                      -> LISTENING [::1]:5174 (same PID)
```
`netstat -ano | findstr :7000` shows exactly one listener, PID 10496.

**This is not a coincidental match — these are the literal same OS process IDs as
the 2026-09-17 pass.** The backend has been running continuously across both
investigation dates (~24+ hours of uptime at time of this check), which means:
(a) the "duplicate backend instance" question is trivially still RULED OUT, and
(b) the network re-measurements in §9/§11 were taken against the same live
process/connection-pool state the original symptom was presumably observed
against, not a fresh unrelated run.

Resource snapshot of PID 10496 (new this pass, §20): working set ~137MB, ~11.3s
cumulative CPU time, 269 handles, several threads, sampled at ~0% CPU at the
instant checked.

**Status: RULED OUT (duplicate instance), re-confirmed. CONFIRMED (same
long-running instance across both passes).**

---

## 8. HTTP Request Analysis — Per-Request Latency Waterfalls (new this pass, scope item A/D)

### 8.1 `GET /api/cases/:id` (case detail)

Route: `case.routes.js:68` — `router.get("/:id", authenticate, authorizePermissions("cases:read"), ctrl.getCase)`.

| Stage | Component | Real/estimated | Cost |
|---|---|---|---|
| 1 | TCP/TLS + HTTP arrival | dev: loopback, no TLS | negligible (dev); unmeasured for prod's reverse-proxy hop |
| 2 | Express middleware stack (`helmet`, `compression`, `requestContext`, `perfMiddleware`, `cors`, rate-limiter, `morgan`, body parsers, `cookieParser`, `sanitizeRequest`) | **measured** via `GET /api/health` (same stack, no auth, no Mongo) — 5 samples: 132, 74, 77, 74, 88ms via loopback `curl` | ~75-90ms steady state (includes `curl` process-spawn overhead, so true in-process cost is likely lower; labeled honestly as an upper bound, not a clean server-side number) |
| 3a | `authenticate()`: JWT verify (sync) | estimated | negligible (single sync crypto verify) |
| 3b | `authenticate()`: `getCachedUser` — Redis unset in this env → **in-memory `Map` fallback** (`config/redis.js:70-72`) | code-confirmed | cache hit: negligible; cache miss (first request or >60s TTL expiry): 1 Mongo `User.findById` round trip |
| 3c | `authenticate()`: `isIdleTimedOut` — `settingsEngine.getEffective("security.session.idleTimeoutMinutes")` (30s in-process TTL cache, `settingsCache.js:6`, confirmed) + Redis-unset in-memory `lastActive` Map (`idleSessionGuard.js`) | code-confirmed | cache hit: negligible; cache miss: 1 Mongo `settingvalues.findOne` round trip |
| 4 | `authorizePermissions("cases:read")` — pure in-memory RBAC check (`authorizePermissions.js`), no I/O | code-confirmed | negligible |
| 5 | `caseService.getAccessibleCaseOrThrow` → `populateCaseQuery(Case.findOne(...))` — 1 base find + **19** populate paths (`case.service.js:506-527,568-569`) | code-confirmed (unchanged from 2026-09-17) | **warm pool**: dominated by whichever populate query is slowest, ~1 RTT if parallelized well (~250ms, §9); **cold/decayed pool**: driver must open new connections for some/all of the 19 paths — §9's burst measurement (20 concurrent new connections ≈ 2.4-2.8s) is the direct analogue |
| 6 | `serializeCaseForUser` + `summarizeCase` — synchronous, in-process | code-confirmed | negligible |
| 7 | JSON response serialization + network egress | estimated | negligible for a single case document |

**Correction to the 2026-09-17 report**: that report characterized `GET /:id` as
demanding "~28 concurrent pool checkouts" by combining `populateCaseQuery`'s 19
populates with `getRelatedRecords`'s 9-way `Promise.all` **as if both ran inside the
same request**. Direct reads this pass show they do not:
`case.controller.js:697-705` (`exports.getCase`) calls only
`getAccessibleCaseOrThrow` (the 19-populate path) — it never calls
`getRelatedRecords`. `getRelatedRecords` is only called from
`case.controller.js:2073`, inside `exports.getRelated`, which backs the
**separate** route `GET /:id/related` (`case.routes.js:120`). That handler itself
calls `getAccessibleCaseOrThrow` (19-populate) and **then, sequentially — not
concurrently —** `getRelatedRecords` (9-way `Promise.all`). So:

- A single `GET /:id` request's peak concurrency is **~19-20**, not ~28.
- A single `GET /:id/related` request's peak concurrency is also **~19-20** during
  its populate phase, followed by a **separate, later** peak of **~9-10** once that
  phase resolves — never simultaneously.
- The ~28-30 concurrent figure only becomes plausible again at the **page-load**
  level, if a frontend fires both endpoints close together (§14 shows Admin's
  `CRMCaseDetail.jsx` does call `casesApi.get(id)` and, conditionally,
  `casesApi.getRelated(id)`, on the same mount) — in which case two overlapping
  19-populate phases (one from each request) can coincide, giving a peak in the
  **~38-40** range for that instant, tapering to ~9-10 once the `/related` request
  moves past its own populate phase. This is a real, if smaller and later,
  refinement of the prior claim — not a full reversal of it.

**Status: LIKELY** (connection-acquisition component) carried over;
concurrency-count claim **CORRECTED** this pass with direct code evidence.

### 8.2 `GET /api/dashboard` (dashboard/analytics — new endpoint examined this pass)

Route: `dashboard.routes.js:13` — `authenticate, authorizeRoles(...), authorizePermissions("dashboard:read"), ctrl.getDashboard`.

Stages 1-4 are identical to §8.1. From the controller on:

| Stage | Component | Cost |
|---|---|---|
| 5 | `dashboard.controller.js:13-20` (`getDashboard`) → `cachedDashboardCompute(key, () => dashboardService.roleDashboard(...))` | **`config/redis.js:132-134`: `if (!redis) return compute();` — since `REDIS_URL` is unset (§4), this line always executes and the "cache" is a complete no-op, every single request, with no in-memory fallback of any kind.** This is a direct, code-level finding, not an inference. |
| 6 | `dashboardService.roleDashboard` → `buildAnalytics(query, user)` (`dashboard.service.js:310-323`) — a **9-way `Promise.all`** (`caseAnalytics`, `revenueAnalytics`, `userAnalytics`, `documentAnalytics`, `workflowAnalytics`, `questionnaireAnalytics`, `messagingAnalytics`, `appointmentAnalytics`, `evidenceAnalytics`), **each of which is itself its own 2-10-way `Promise.all`** of `.aggregate()`/`.countDocuments()` calls (verified line-by-line, §17) | **~45 concurrent Mongo aggregate/count operations**, fired essentially simultaneously (10+5+5+6+5+3+5+4+2, per-branch counts in §17) |
| 7 | `roleDashboard` then (sequentially, only for `super_admin`/`admin` roles) awaits `executiveMetrics(query)` — its own 9-way `Promise.all` (`dashboard.service.js:92-104`) | +9 more concurrent Mongo ops, second burst |
| 8 | `roleDashboard` then sequentially awaits `StaffPerformance.find(...).populate(...)`, `Conversation.find(...)`, `Case.find(...)` (`dashboard.service.js:329-334`) | +3 more sequential ops |
| 9 | Response JSON serialization | negligible |

**Total for an admin/super_admin dashboard load: ~45 + 9 + 3 ≈ 57 Mongo operations
per single HTTP request, every time, uncached.** For non-admin roles (no
`executiveMetrics`), it is ~45 + 2-3 ≈ 47-48. Either way this exceeds the
case-detail fan-out this codebase's own `database.js` comment and the 2026-09-17
report both singled out as the worst offender.

**Status: CONFIRMED** (direct code read of `dashboard.controller.js`,
`dashboard.service.js`, `config/redis.js` — not inference).

### 8.3 `GET /api/cases` (list endpoint — the other endpoint type this pass was asked to cover, offered as a positive counterexample)

`case.controller.js:646-695` (`getCases`): a **bounded** 2-way `Promise.all`
(`Case.countDocuments(filter)` + one `.aggregate([$match,$sort,$skip,$limit])`
capped at `limit ≤ 100`, then a single batched `populateCaseListDocs` over ~10
populate paths, `case.service.js:34-44,549-555`). This is a well-bounded,
low-risk pattern — cited here deliberately to show not every list/detail endpoint
in this codebase has the dashboard's or case-detail's fan-out problem.

**Status: RULED OUT** as a concurrency risk for this specific endpoint.

---

## 9. MongoDB Connection Analysis (re-verified + extended)

`database.js`'s pool: `maxPoolSize=50`, `minPoolSize=2`, `maxIdleTimeMS=60000`,
`socketTimeoutMS=15000` — unchanged (§4). The reasoning already laid out on
2026-09-17 (pool decays to 2 warm connections after 60s idle; this app's traffic
is bursty by both user behavior and its own background-job cadence; the next
burst after a quiet period pays the new-connection cost measured in §11) is
**carried over unchanged** — this pass found no evidence to revise it, and found
substantially more evidence (§13, §17) of just how large and how frequent those
bursts really are, which strengthens rather than weakens the mechanism.

**New this pass**: `config/redis.js`'s comment block (`redis.js:5-16`) documents a
related, already-fixed instance of the same family of problem — a backend restart
used to disconnect every open socket.io client at once, each reconnecting within
its first retry attempt and producing a burst of simultaneous *uncached*
`User.findById` lookups racing for the same pool slots; the in-memory/Redis
cache-aside for the user lookup was added specifically to blunt that. This is
direct, additional evidence (from the codebase's own comments, not this
investigation's inference) that this exact "burst of concurrent
connection-acquisitions on a high-latency link" failure mode has already
manifested and been partially treated once before, for a *different* trigger
than the one named in this ticket's symptom.

**Status: LIKELY, carried over. Reinforced by a second, independently-documented
historical instance of the same mechanism.**

---

## 10. Query/Index Analysis (carried over, not re-run this pass)

The 2026-09-17 `.explain()` results (every code-path query shape on `tasks`,
`workflows`, `settingvalues`, `notifications`, `joblocks` is an `IXSCAN`, not a
`COLLSCAN`; collection sizes trivial; no 64-index-cap recurrence) were not
re-executed this pass, since nothing found this pass suggests the schema or
indexes changed, and re-running `.explain()`/`collStats` against the shared
remote cluster adds load for no new information. This is carried over as-is.

**New this pass, directly relevant to §8.2**: `JobLock`'s own indexing was
examined for the first time (§12) — `name` carries a `unique` index that fully
serves `jobLock.js`'s acquire query; no compound index is needed given the
uniqueness constraint. There is **no TTL index** on `JobLock` — expiry is purely
an application-level `lockedUntil` comparison at acquire time, so a crashed
job's lock document persists indefinitely until the next successful acquire
overwrites it (not itself a performance bug, but a genuine correctness/ops gap
worth naming).

**Status: RULED OUT (carried over, unchanged). New: JobLock indexing confirmed
adequate (CONFIRMED); no-TTL-index gap noted (POSSIBLE ops risk, not a latency
cause).**

---

## 11. Network Analysis (re-measured this pass, 2026-09-18)

A fresh, independent throwaway `MongoClient` script (not reused from
2026-09-17 — written fresh this session, deleted after use) reproduced every
measurement type from the prior pass:

| Measurement | 2026-09-17 | 2026-09-18 (this pass) |
|---|---|---|
| Cold connection establishment | 1793ms | **1507ms** |
| Steady-state RTT, 10x `{ping:1}` | avg 250.7ms (240-312ms range) | avg **248.2ms** (247-250ms range — tighter than before) |
| 20-connection concurrent burst (fresh client) | 3000ms total | **2380ms** total |
| `hello` topology | `isWritablePrimary:true`, no `setName` | **identical**: `isWritablePrimary:true`, `setName:null` |
| `serverStatus`/`currentOp` | refused, "not authorized" | **refused, identical error text**, same credential |

Every number this pass measured lands within the same order of magnitude as the
2026-09-17 measurement, several within a few percent. This is a real,
independent re-run 24 hours later against the same live host and the same
long-running backend process (§7) — not a repeat of the same script/session —
and it reproduces cleanly. This meaningfully increases confidence that the
~250ms baseline and ~1.5-1.8s cold-connect cost are **stable, reproducible
properties of this specific host/link**, not a transient anomaly from either
measurement session.

The "fast" reported symptom durations (228-290ms, §3) continue to land almost
exactly on the measured single-RTT baseline; the "slow" durations (3188-7095ms)
remain small integer multiples of it, consistent with queuing behind one or more
new-connection establishments rather than slow query execution (§10 already
rules out the latter).

The replica-set-vs-standalone topology discrepancy flagged on 2026-09-17 (this
investigation's own live `hello` calls show a standalone-looking topology; the
prior team's characterization of "Atlas M0... shared/free-tier" was inferred
from reverse-DNS naming, not a live topology check) **persists unresolved** —
today's `hello` result is identical to yesterday's.

**Status: CONFIRMED (re-verified, independently reproduced 24h later) — baseline
RTT and connection-establishment cost. UNABLE TO VERIFY (unchanged) —
server-side load from other clients; replica-set-vs-standalone topology.**

---

## 12. Node.js Analysis (carried over + lightly extended)

The 2026-09-17 search for CPU-blocking synchronous code on the request/job hot
path (`execSync`, `spawnSync`, sync crypto, large sync JSON/file ops) found
nothing outside test/verification scripts — carried over unchanged. This pass's
resource snapshot (§7, §20) adds a live data point: at the moment sampled, the
live backend process shows ~0% CPU, ~137MB working set, no signs of an
overloaded event loop. This is a single point-in-time snapshot, not a load test,
and is labeled accordingly.

**Status: NOT SUPPORTED (carried over, unchanged).**

---

## 13. Worker/Background-Job Analysis (substantially extended this pass — scope item G)

The 2026-09-17 report only knew about two recurring jobs. Reading `server.js` in
full this pass (lines 32-263) surfaces **ten recurring jobs plus one one-shot
boot-time job**, every one registered and started in the same `connectDB().then()`
block (`server.js:212-221,232-234`):

| Job | Interval (default) | Models/collections touched | `withJobLock`? | Notes |
|---|---|---|---|---|
| `startSettingsRetentionMaintenance` | 24h (`SETTINGS_RETENTION_INTERVAL_MS`) | `AuditLog` | Yes (`"settings-retention-sweep"`) | Low risk — daily, isolated |
| `startSlaSweepMaintenance` | 60min (`SLA_SWEEP_INTERVAL_MS`) | `Case` | Yes (`"sla-sweep"`) | Shares `Case` with several others below |
| `startWorkflowMaintenance` | 5min (`WORKFLOW_MAINTENANCE_INTERVAL_MS`) | `AuditLog`, `Case`, `Task`, `User`, `Workflow`, `WorkflowTemplate` | Yes (`"workflow-maintenance"`) | Already documented 2026-09-17; runs `checkSlaBreaches`+`processScheduledWorkflows`+`retryFailedActions` concurrently |
| `startNotificationMaintenance` | 60s (`NOTIFICATION_MAINTENANCE_INTERVAL_MS`) | `AuditLog`, `Notification`, `NotificationPreference`, `NotificationTemplate`, `User` | Yes (`"notification-maintenance"`) | Already documented 2026-09-17 |
| `startAppointmentMaintenance` | 60s (`APPOINTMENT_REMINDER_INTERVAL_MS`) | `AuditLog`, `Appointment`, `Case`, `CalendarAvailability`, `CalendarEvent`, `CalendarIntegration`, `CalendarResource`, `User` | Yes (`"appointment-reminders"`) | **New this pass** |
| `startPaymentMaintenance` | 2min (`PAYMENT_RECONCILIATION_INTERVAL_MS`), batch 50 | `AuditLog`, `Case`, `Payment`, `PaymentLedgerEntry`, `PaymentRequest`, `User`; also calls Stripe (§18) | Yes (`"payment-reconciliation"`) | **New this pass**; Stripe retries can extend this job's lock hold |
| `startReminderGeneration` | 60min (`REMINDER_GENERATION_INTERVAL_MS`) | `Answer`, `Beneficiary`, `Case`, `Document`, `Payment`, `Task` | Yes (`"reminder-generation"`) | **New this pass** |
| `startAIMaintenance` | 60s (`AI_JOB_RECOVERY_INTERVAL_MS`) | `AIJob`, `AIProviderConfig`, `AuditLog`, `User` | Yes (`"ai-job-recovery"`) | **New this pass** |
| `startEodReportMaintenance` | 5min (`EOD_REPORT_CHECK_INTERVAL_MS`), gated by IST hour + once-per-day guard | `AuditLog`, `Beneficiary`, `Case`, `Company`, `Document`, `EODReport`, `Message`, `Payment`, `ReportExecution`, `ReportTemplate`, `Task`, `User`, `Workflow` | Yes (`"eod-report-maintenance"`) | **New this pass.** When it does run, it loops **sequentially over up to 31 backfill days inside one single lock hold/heartbeat cycle** — by far the longest-held lock in the set, and it touches nearly every model in the system |
| `startUSCISMonitoringJob` | 24h (`USCIS_MONITORING_INTERVAL_MS`), only if enabled/prod | `USCISFormTemplate`, `USCISFormSyncRun`; also outbound HTTPS to uscis.gov | **No** — only an in-process `running` boolean | **New this pass.** Has its own bespoke, non-atomic 3-step Mongo lock inside `USCISScannerService.scanAll` (`findOne` → `updateMany` stale → `create`) — a real TOCTOU race under >1 backend instance, unlike every `withJobLock`-wrapped job |
| Document-intelligence recovery | one-shot, 15s after boot, not recurring | `DocumentProcessingJob` | No — plain `find()`, no atomic claim | **New this pass.** Low risk under a single instance; would double-process under horizontal scaling |

**Clustering finding (new this pass)**: because each job's initial delay is a
fixed, process-start-relative offset (`scheduleInitialRun`), the three 60-second
jobs — `notification-maintenance` (20s + 60s), `appointment-reminders` (25s +
60s), `ai-job-recovery` (40s + 60s) — are **permanently phase-locked within 5-20
seconds of each other**, every minute, for the entire life of the process. This
is a real, previously-undocumented scheduling property (not random jitter), and
it means every minute this backend runs, there is a several-second window where
three independent jobs are concurrently touching `Notification`, `Appointment`,
`Case`, `AIJob`, and `AuditLog` at once — exactly the kind of moment a
concurrent real-user request burst is most likely to also land in (login
storms, dashboard loads, page navigation).

`workflow-maintenance` and `eod-report-maintenance` (both 5-minute period) are
not phase-locked as tightly (15s vs. 45s initial delay) but do recur on the same
period and share `Case`/`Task`/`Workflow`.

**Status: LIKELY (amplifier), substantially extended this pass with 8 previously
undocumented jobs and a new phase-clustering finding. UNABLE TO VERIFY the
USCIS-monitoring/document-intelligence-recovery race conditions actually firing
in practice (theoretical from code reading, not observed) — flagged as a
correctness gap independent of the network/pool story.**

---

## 14. Frontend Request Analysis (new this pass — scope item C)

Investigated directly (StrictMode) and via a dedicated background pass
(auth-init, interceptors, polling, page-load request counts) across all three
apps. StrictMode findings were independently cross-checked by this session by
reading each app's entry file directly — both checks agree.

### 14.1 React StrictMode

| App | StrictMode | Source |
|---|---|---|
| Immiglance | **Yes** | `Immiglance/Frontend/src/main.jsx:21` |
| Attorney | **Yes** | `Attorney/src/main.jsx:7` |
| Admin/INSZoom | **No** | `Admin/frontend/src/main.jsx:16-20` — no `React.StrictMode`/`StrictMode` anywhere in the file |

In dev, StrictMode double-invokes effects, so raw `useEffect`+`fetch`/`axios`
calls fire twice per mount in Immiglance and Attorney (not in Admin). Where
React Query's `useQuery` is used instead (both Immiglance and Admin configure
it), same-key requests are deduplicated by the query cache regardless of
StrictMode, so this only actually doubles traffic on the *raw-effect* fetches
(e.g. Immiglance's `Dashboard.jsx` addons fetch).

### 14.2 Auth-init request count (varies materially by app — proven, not assumed)

- **Immiglance**: the access token lives in a **plain in-memory module
  variable** (`services/api.js:41`, not persisted to `localStorage`), so on a
  genuinely fresh page load `verifySession()` (`AuthContext.jsx:67-72`)
  short-circuits and returns **without firing any HTTP request at all** — the
  refresh-token cookie is never even consulted on this path. A real login
  submit fires 2 requests (`POST /auth/login` then `GET /auth/session-context`).
- **Admin/INSZoom**: `AuthContext.jsx:36-101` unconditionally fires
  `POST /auth/refresh` on every single page load, including `/login` (1
  request); if it succeeds, a second effect run fires `GET /auth/me` (2 requests
  total for an authenticated load).
- **Attorney**: unconditionally fires `GET /auth/me` on every mount (1 request,
  any page); a 401 triggers the interceptor's silent refresh-and-retry (up to 3
  round trips worst case).

This is a real, previously-uncharacterized divergence: the same architectural
pattern (JWT + refresh cookie) produces 0, 1, or 2 unconditional requests per
page load depending only on which app's `AuthContext` implementation the user
happens to be in.

### 14.3 Interceptors

All three apps implement a bounded single-retry token-refresh-and-replay
pattern (de-duped in-flight refresh promise, a `_retry`/`retry` guard to
prevent a second loop). None of the three implements an unbounded retry loop.
This is a **positive** finding — not itself a source of amplification.

### 14.4 Polling inventory (larger than the 2026-09-17 report knew)

The prior report only knew about Attorney's two polls. This pass finds:

| Interval | Site |
|---|---|
| 15s | `Immiglance/Frontend/src/Pages/Dashboard/Messages.jsx:622` (active thread only), `Payments.jsx:109`; `Admin/frontend/src/pages/Messaging.jsx:555` |
| 30s | `Attorney/src/hooks/useUnreadCounts.js:21`; `Admin/frontend/src/contexts/NotificationContext.jsx:133`; `Admin/frontend/src/components/settings/LockedUsersPanel.jsx:21` |
| 60s | `Attorney/src/components/NotificationBell.jsx:23`; `Admin/frontend/src/contexts/NotificationContext.jsx:140`; `Admin/frontend/src/contexts/AuthContext.jsx:87` (local-only, not HTTP) |
| 120s | `Admin/frontend/src/pages/CRMCaseDetail.jsx:640` (payments tab only, while active); `Admin/frontend/src/pages/PaymentsOverview.jsx:45` |

### 14.5 Page-load request counts, per app (measured from code, not assumed)

| | Login (fresh) | Dashboard | Case-detail |
|---|---|---|---|
| **Immiglance** | 0 (short-circuits) | ~4-6 (React Query dedupes `useMyCase`/`useMyProfile` across `PortalLayout` + `Dashboard.jsx` — same page as case-overview, no separate route) | same page as dashboard |
| **Admin/INSZoom** | 1 (`POST /auth/refresh`, fails) | ~9 (2 auth + 2 notification-context + 5 independent stat fetches, no react-query dedup on this page) | ~11 (2 auth + 2 notification-context + 3 base case calls + **3 near-duplicate questionnaire calls with different `targetRole` query params, not deduped against each other** + 1 checklist call) |
| **Attorney** | 1 (`GET /auth/me`, 401s) | 4, **including 1 confirmed exact duplicate** — `GET /attorney/dashboard` is called both by `AppLayout`'s `useUnreadCounts` hook and again by `Dashboard.jsx`'s own effect, with no cache of any kind (Attorney has no react-query/SWR anywhere) to catch it | 4 (no duplicate on this route) |

**The Attorney duplicate is a concrete, reproducible bug** (not a modeled
estimate): `Attorney/src/layouts/AppLayout.jsx` mounts on every authenticated
route (dashboard *and* case-detail, since both sit under the same layout route)
and calls `useUnreadCounts()`, which fires `attorneyApi.dashboard()`
(`GET /attorney/dashboard`) on mount; `Attorney/src/pages/Dashboard.jsx` then
independently fires the *same* `attorneyApi.dashboard()` call in its own effect.
Because Attorney has zero client-side caching, both fire as real, separate
network requests every time the dashboard route is visited.

**Status: CONFIRMED** (all of the above — direct code reads, cross-checked by
this session for StrictMode). This materially extends and partially
supersedes the 2026-09-17 report's frontend section, which only knew about
Attorney's two poll intervals and had not examined auth-init or duplicate
requests in any app.

---

## 15. Authentication Analysis (new synthesis this pass)

Backend-side, `authenticate()` (`middleware/authenticate.js`) is the single
choke point for every authenticated request across all three frontends (§8.1,
stage 3). It is backed by two independent, TTL-bounded caches — the
Redis-or-in-memory user cache (60s TTL, `config/redis.js:16`) and the
30-second settings-engine cache used by `isIdleTimedOut`'s
`security.session.idleTimeoutMinutes` lookup (`settingsCache.js:6`) — both of
which correctly fall back to an in-process `Map` when `REDIS_URL` is unset
(confirmed, §4), so **neither of these two specific caches is a latency risk in
this dev environment.** The one cache in this codebase that does *not* have
that fallback is the dashboard cache (§8.2, §10) — a materially different,
much larger-impact gap than either of the two auth-path caches.

Frontend-side, the three apps' materially different auth-init behavior (§14.2)
means the *effective* number of unconditional per-page-load Mongo-touching
requests differs by app even though the backend-side cost of each individual
one is identical.

**Status: CONFIRMED** — both cache-fallback design and its one meaningful gap
(the dashboard cache) are direct code findings.

---

## 16. Notification / Email / Document-Processing Analysis (new this pass — scope item H)

Investigated whether any external-service call sits on a request's critical
path (awaited before the HTTP response) versus being genuinely backgrounded.

| Service | Blocking or background | Timeout configured? | Where |
|---|---|---|---|
| SMTP (nodemailer, via Resend — `SMTP_HOST=smtp.resend.com` **confirmed configured** in this dev `.env`) | **Blocking** on: password reset (`auth.controller.js:405`), case-manager assignment, client "case manager assigned" notice, team-lead assignment, ownership transfer (up to 4 assignees via `Promise.all`), employee case-invitation | **NO TIMEOUT CONFIGURED** — `nodemailer.createTransport(...)` (`nodemailer.provider.js:22-29`) sets no `connectionTimeout`/`greetingTimeout`/`socketTimeout` | Confirmed by direct read this session |
| SMTP (same transport) | **Background** on: case creation | n/a (off critical path) | `case.controller.js:1225-1264` — `setImmediate(...)` wrapper, with an in-file comment explicitly documenting a **previously profiled ~2-minute stall** that this exact fix resolved (P12-S1). Confirmed by direct read this session. |
| AWS S3 (document upload/download) | **Blocking** (necessarily — the caller needs upload confirmation) | **NO TIMEOUT CONFIGURED** on `S3Client` | `modules/uploads/storage.service.js` |
| Google Document AI / classifier / Google Drive sync | **Blocking** via `/document-intelligence/autofill`, `/case/:caseId/autofill`, `/documents/:id/classify`\|`extract`; **background** via the plain `/document-intelligence/upload` route (correctly queued, positive counterexample) | **NO TIMEOUT CONFIGURED** anywhere in this chain (Document AI client, classifier `fetch`, Drive `fetch`) | `document-intelligence.service.js`, `document-classifier.service.js`, `integrations/google-drive.service.js` |
| Gemini (general AI module) | **Blocking by default** unless caller passes `background:true` | **NO TIMEOUT** — unlike its OpenAI/Anthropic siblings in the same provider registry, which get a 60s `AbortController` default | `ai-provider.registry.js` |
| In-app `Notification.create` itself | Fast, synchronous, not a risk on its own | n/a | `notification.service.js:368-390` |
| Email-channel dispatch triggered *from* `createNotification` | **Entirely caller-dependent** — blocking when the caller awaits `createNotification` inline (true for the assignment/invite/password-reset paths above), background when the caller `setImmediate`s or omits `await` (true for case creation and lead/quiz intake) | inherits SMTP's no-timeout | `notification.service.js:302-333,384` — the codebase is **inconsistent** about which side of this fork each call site uses |

**Compounding finding**: the document-intelligence `/autofill` path chains *two*
independent retry loops serially inside one synchronous controller call —
`classifyWithRetry` (up to 3 attempts, ~1-2s backoff) then
`syncDocumentToDrive`/`syncDocument` (up to 3 attempts, ~1-3s backoff, capped
10s) — both detailed further in §18. Worst-case combined backoff sleep alone
(before counting actual call latency) is on the order of several seconds inside
one HTTP response.

**This is an independent, non-MongoDB explanation for at least some of the
"3-7+ second" symptom bucket**, isolated to a small, specific set of routes
(case assignment/reassignment/invite, password reset, default-mode AI
endpoints, document-intelligence autofill) rather than being systemic like the
network/pool mechanism. The two mechanisms are not mutually exclusive and would
compound if they coincided.

**Status: CONFIRMED** (direct code reads by both the background pass and this
session's own spot-check of `nodemailer.provider.js` and the case-creation
`setImmediate` fix).

---

## 17. Concurrency Analysis — Exhaustive Promise-Mapping (new this pass — scope item B)

A repo-wide grep for `Promise.all`, `Promise.allSettled`, `Promise.race`,
`Promise.any`, `.map(async`, `.forEach(async`, `for await` across `Backend/src`
found far more fan-out sites than the 2026-09-17 report's single
`case.service.js` finding. Full detail tables (by module) are preserved as
gathered; the highest-severity findings are summarized here.

### 17.1 Unbounded fan-outs that scale with headcount/data volume (worse in kind than case-detail's fixed ~19-20)

| Site | Trigger | Scales with | Peak concurrent ops |
|---|---|---|---|
| `admin.controller.js:157` (`getDocumentOverview`) | GET admin document-overview page | **every client/user in the system** (`User.find`, no limit) | unbounded — hundreds/thousands possible, one `Question.find` per user with an active case |
| `case-manager.controller.js:59-81` (`getCaseManagers`) | GET case-managers list | every `case_manager` user, no limit | unbounded — 4 ops × N managers |
| `case-manager.controller.js:319-323` (`getCaseManagerAnalyticsPanel`, aggregate mode) | GET case-manager analytics | every case manager in scope | unbounded — ~15 ops × N managers (nested `buildPanel`) |
| `leaderboard.controller.js:13-25` (`calculate`) | Leaderboard calculation (admin action, possibly cron-driven) | every `case_manager`/`team_lead` user, no limit | unbounded — 4 ops × N staff |
| `case.service.js:698-723` (`bulkUpdateCases`) | Bulk case action | client-supplied `ids.length`, no batching | unbounded by request size |
| `settingsEngine.service.js:101-112` (`getCatalog`) | GET settings catalog (every admin settings-page visit) | fixed at ~99 registry entries, but all launched together | ~99 concurrent entry-resolution chains |

### 17.2 Dashboard/reports trees (the largest fixed-size fan-outs found)

- `dashboard.service.js:310-323` (`buildAnalytics`): **9-way outer, ~45 total inner** ops — detailed in §8.2.
- `dashboard.service.js:325-334` (`roleDashboard`): adds `executiveMetrics`'s 9-way (admin-only) after `buildAnalytics`.
- `dashboard.service.js:371-393` (`collaborationSummary`): 8-way.
- `report.service.js` (`getCaseReport`/`getFinancialReport`/`getUserReport`/`getCompanyReport`/`getOcrReport`/`getWorkflowReport`): each an independent 4-7-way `Promise.all`, only one per request.
- `report.service.js:403-414` (`automaticMetrics`, inside the EOD background job): 5-way, but the **outer loop over staff members is a sequential `for...of`**, not concurrent — a positive counterexample cited by the background pass.
- `workflow.service.js:947-964` (workflow analytics summary): 8-way.
- `task.controller.js:99-112` (`stats`): 5-way.

### 17.3 Per-entity "related records" family (the same pattern as `case.service.js`'s, previously undocumented elsewhere)

`companies/company.service.js:225-241` (`getRelated`, 9-way),
`clients/client.service.js:341-357` (`getRelated`, 7-way),
`beneficiaries/beneficiary.service.js:429-450` (`getRelated`, 8-way) — the exact
same architectural pattern the prior report flagged only in `case.service.js`
recurs, independently, across Companies, Clients, and Beneficiaries.

### 17.4 Positive, bounded-concurrency counterexamples (worth naming — this codebase does know the pattern in places)

- `modules/realtime/realtime.gateway.js`: a hand-rolled semaphore
  (`AUTH_LOOKUP_CONCURRENCY`, default 8) gates concurrent `User.findById`
  during socket-auth cache misses — the clearest bounded-concurrency example in
  the codebase, explicitly built to bound a "fleet of simultaneously
  reconnecting sockets" scenario.
- `notifications/notification.service.js:392-412` (`createForRoles`): explicit
  `BATCH_SIZE = 10`, processed as sequential batches — comment explicitly
  documents this was done to avoid "hundreds of simultaneous writes/realtime
  emits."
- `notifications/notification.service.js:480-499` (`processScheduled`): a
  single `bulkWrite` for up to 100 notifications, not N serial saves —
  documented as an explicit prior fix.
- `uscis-forms/uscis-form-health.service.js:170-177`, `USCISScannerService.js:272-280`: explicit batch-of-8 / batch-of-5-10 concurrency caps (bound HTTP/S3 calls, not Mongo, but the same discipline).

### 17.5 Routine, low-risk pattern (not a concern)

The `Promise.all([Model.find(...), Model.countDocuments(...)])` two-way
pagination shape recurs across nearly every list endpoint in the codebase
(`crudFactory.js`, and per-module list handlers) — fixed at 2 concurrent ops
per request, not a meaningful risk.

**Status: CONFIRMED (direct code reads).** This section is the single largest
expansion over the 2026-09-17 report's scope — it had examined exactly one file
(`case.service.js`); this pass examined the entire `Backend/src` tree for the
same class of pattern and found it recurring in at least 25 additional
locations, several materially worse in kind (unbounded-by-headcount) than
anything the prior pass had seen.

---

## 18. Retry Analysis (extended this pass — scope item F)

| Retry site | Attempts | Backoff | Critical-path? |
|---|---|---|---|
| Mongo driver `retryReads` (default on, unchanged) | 1 automatic | none | Yes — doubles `socketTimeoutMS` (15000ms) exposure to ~30s worst case on any query hitting a silently-dead pooled connection; carried over from 2026-09-17, now cross-referenced against the pool-decay mechanism (§9) |
| ioredis reconnect (`config/redis.js:50-55`) | `maxRetriesPerRequest:1`; reconnect capped at 5 attempts | `min(times*200, 2000)`ms | Low/bounded — falls back to direct DB reads on failure (documented in-file) |
| Stripe SDK (`payment.gateway.js`) | `STRIPE_MAX_NETWORK_RETRIES` default **3** | Stripe SDK's internal backoff | Extends `payment-reconciliation` job's lock hold on failures (§13); not confirmed synchronous on a user-facing checkout request in this pass |
| Google Drive sync (`google-drive.service.js:31-37,162-195`) | `GOOGLE_DRIVE_MAX_ATTEMPTS` default **3** | `min(1000*2^(n-1), 10000)`ms → 1s, 2s | **Confirmed on critical path** — chained inside `processDocument`, called synchronously by `uploadAndExtractNowDetailed`, itself called directly from `document-intelligence.controller.js:33` |
| Document classifier (`document-classifier.service.js:21-34`) | `DOCUMENT_CLASSIFICATION_MAX_ATTEMPTS` default **3** | `min(1000*n, 3000)`ms → 1s, 2s | **Confirmed on critical path — same synchronous chain as Google Drive above, serially before it.** Combined worst-case backoff sleep alone: ~6s, inside one HTTP response |
| USCIS PDF download (`USCISFormImporterService.js:111-116`) | default **3** (max 6) | flat ~500ms per attempt | Inside the daily, unlocked USCIS monitoring job (§13) — not user-request path |
| CRM lead webhook (`crmSync.service.js:4-5,51-84`) | hardcoded **3** | `500*2^(n-1)`ms → 500ms, 1000ms | **Not** on critical path — explicit fire-and-forget (`.catch(() => {})`, never awaited by the response) |
| AI job requeue (`ai-orchestration.service.js:158,261-265`) | per-job `maxAttempts`, default 3 | none inline — cooperative with the 60s `ai-job-recovery` tick | Not inline; shows up as repeated 60s-interval scans, not request latency |
| Frontend token-refresh-and-replay (all three apps, §14.3) | exactly 1 replay | none (immediate) | Low — bounded, standard pattern |

**Status: LIKELY (Mongo `retryReads` tail risk, carried over, unconfirmed
firing). CONFIRMED (document-intelligence autofill's chained Google
Drive+classifier retries as a real, independent, request-path latency risk —
new this pass). NOT SUPPORTED (CRM webhook, AI job requeue, frontend
refresh-replay as amplifiers).**

---

## 19. Resource Analysis (new this pass)

Live snapshot of the running backend process (PID 10496, §7):

| Metric | Value |
|---|---|
| Working set | ~137MB |
| Cumulative CPU time | ~11.3s (over its multi-hour uptime — i.e. almost entirely idle) |
| Handle count | 269 |
| CPU at sampled instant | ~0% |
| Host total RAM | 15.4GB |
| Host free RAM at sample time | **1.3GB** |

The process itself shows no signs of memory or CPU pressure. The **host's** free
memory (1.3GB of 15.4GB, ~92% utilized) is notably tight for a development
machine also running VS Code, three Vite/Node dev servers, and this backend
simultaneously — this is a genuinely new observation this pass, but it was
**not** correlated against the timing of any slow request (no persisted log
exists to do that correlation against, §22), so it cannot be promoted past
"worth flagging."

**Status: POSSIBLE** (host memory pressure as a contributing factor to
occasional latency, e.g. via OS-level paging or scheduling jitter affecting
network I/O timing) — **UNABLE TO VERIFY** whether this actually correlates
with the reported symptom; this is a snapshot, not a monitored trend, and this
machine's dev-environment resource contention may not reflect whatever
environment actually served the original symptom's requests (§22).

---

## 20. Job-Lock Contention Detail (new this pass — scope item E)

`Backend/src/utils/jobLock.js` (backed by `models/JobLock.js`), read in full:

- **Acquisition** is a single atomic `findOneAndUpdate({name, lockedUntil:{$lte:
  now}}, {$set:{lockedAt, lockedUntil, token}}, {upsert:true})`. If a live lock
  already exists, the upsert's insert path collides with the unique index on
  `name` (Mongo error `11000`), which `acquireLock` catches and turns into
  `null` — no throw, no retry.
- **Index**: `name` carries a `unique` single-field index (`models/JobLock.js`)
  — fully serves the query given uniqueness. No compound index needed; **no
  TTL index** exists (expiry is app-level only, §10).
- **No retry/sleep on failed acquisition** — a skipped tick is simply skipped
  (`job_lock_skipped_overlap` logged), not queued; the next chance is the next
  `setInterval` fire.
- **Heartbeat**: while `fn()` runs, a `setInterval` at `max(ttlMs/3, 1000)`ms
  renews `lockedUntil` via a small `updateOne`, so a slow-but-alive job never
  self-expires — only a genuinely crashed holder (heartbeat stopped) can let
  `ttlMs` lapse.
- **Connection-holding risk**: none of `acquireLock`/`renewLock`/`releaseLock`
  pin a session/transaction to one pooled connection for the job's lifetime —
  each is an ordinary short round trip. The one caveat: a very long-running job
  (the EOD backfill, §13, capable of looping over 31 days inside one lock hold)
  generates a steady trickle of extra small writes for as long as it runs — not
  a held connection, but added periodic load correlated with job duration.
- **Gap**: `startUSCISMonitoringJob` is **not** wrapped in `withJobLock` — only
  an in-process boolean — and its own bespoke lock inside
  `USCISScannerService.scanAll` is a non-atomic 3-step sequence
  (`findOne` → `updateMany` stale → `create`), a real TOCTOU race under more
  than one backend instance (this app currently runs as exactly one instance,
  §7, so this is a latent, not active, risk).

**Status: CONFIRMED** (direct file read). The lock mechanism itself is sound
and does not hold connections improperly; the one gap found (USCIS job) is a
correctness/scaling risk, not a contributor to the currently-reported
single-instance latency symptom.

---

## 21. Extended Root-Cause Matrix

| Category | Suspect | Evidence | Measurement | Finding | Status | Confidence | Impact |
|---|---|---|---|---|---|---|---|
| Startup config | `autoIndex`/`autoCreate` regression | `database.js`+`.env` read | Re-verified 2026-09-18, unchanged | Both env-gated false | RULED OUT | High | None |
| Process | Duplicate backend instance | `netstat`/`Get-CimInstance` | Same PID (10496) both dates | Single, continuously-running instance | RULED OUT | High | None |
| Query plan | Missing/bad indexes on 5 named collections | Live `.explain()` (2026-09-17, not re-run) | IXSCAN, single-digit ms | Not a bottleneck | RULED OUT | High | None |
| Index cap | 64-index limit recurrence | Live index counts (2026-09-17) | 19/24/3/46/2, far under cap | Doesn't recur | RULED OUT | High | None |
| Data volume | Large collections/documents | `collStats` (2026-09-17) | 34-5,954 docs, sub-3KB avg | Trivial | RULED OUT | High | None |
| Network | Baseline RTT to remote host | `{ping:1}` x10, both dates | 250.7ms (9/17) vs 248.2ms (9/18) | Matches "fast" ops almost exactly, reproduced 24h later | CONFIRMED | High | High — floors every Mongo op |
| Network | Cold/burst connection cost | Direct measurement, both dates | 1793/3000ms (9/17) vs 1507/2380ms (9/18) | Reproduces multi-second-per-burst cost | CONFIRMED | High | High |
| Pool config | `minPoolSize=2`/`maxIdleTimeMS=60000` decay | Config read + traffic-shape analysis | Unchanged both dates | Plausible mechanism linking RTT to bursty traffic | LIKELY | Medium-High | High |
| Topology | Replica set vs. standalone | Live `hello`, both dates | Identical: no `setName` both times | Discrepancy vs. prior "Atlas M0" doc claim, unresolved | UNABLE TO VERIFY | Low | Unknown |
| Server load | Noisy-neighbor on shared host | `serverStatus`/`currentOp`, both dates | Identical refusal both times | Cannot be measured with this credential | UNABLE TO VERIFY | N/A | Unknown |
| App code | Case-detail fan-out | `case.controller.js`/`case.service.js` read | 19-populate per request, corrected concurrency math (§8.1) | ~19-20 per request, ~38-40 at page-load if both endpoints overlap | LIKELY (amplifier) | High | Medium-High |
| App code | **Dashboard/analytics fan-out (new)** | `dashboard.service.js`/`dashboard.controller.js`/`config/redis.js` read | ~45-58 concurrent ops per request, **zero caching in this env** | Larger than case-detail; uncached every time | **CONFIRMED** | High | **High — largest single amplifier found** |
| App code | Unbounded headcount-scaled fan-outs (admin overview, case-manager list/analytics, leaderboard, bulk update, settings catalog) | Repo-wide `Promise.all`/`.map(async)` grep, this pass | 6 distinct sites, scale with data/headcount not fixed count | Worse-in-kind than case-detail/dashboard as the org grows | **CONFIRMED** | High | Medium-High, growing over time |
| Background jobs | 2 known jobs (5min/60s) | `server.js` read, 2026-09-17 | Indexed, lock-guarded | Adds to burst concurrency | LIKELY (amplifier) | High | Low-Medium |
| Background jobs | **8 additional jobs + phase-clustering (new)** | Full `server.js` read, this pass | 10 recurring + 1 one-shot; 3 jobs cluster within 5-20s every minute | Materially larger total background concurrency footprint than previously known | **CONFIRMED** | High | Medium |
| Job locking | `JobLock` mechanism itself | `jobLock.js`/`models/JobLock.js` read, this pass | Atomic acquire, unique index, no connection pinning | Sound; not itself a latency cause | RULED OUT (as a cause) | High | None |
| Job locking | USCIS job unlocked / non-atomic 3-step lock | `USCISMonitoringJob.js`/`USCISScannerService.js` read, this pass | TOCTOU race under >1 instance | Latent correctness gap, not active (single instance today) | POSSIBLE (future risk) | Medium | Low today |
| External services | SMTP with no timeout, blocking on 5 named routes | `nodemailer.provider.js`, `auth.controller.js`, `case.controller.js` assignment paths, this pass | `SMTP_HOST` genuinely configured; no timeout option set anywhere | Independent multi-second-or-worse risk, isolated to specific routes | **CONFIRMED** | High | Medium (narrow but sharp) |
| External services | Same class of bug already fixed once, for case creation | `case.controller.js:1225-1264` read, this pass | In-file comment documents a previously profiled ~2-min stall, fixed via `setImmediate` | Team is aware of this exact pattern; fix wasn't generalized | **CONFIRMED** | High | Informative — shows a known-good template exists |
| External services | Document-intelligence autofill: chained retries, no timeouts | `document-intelligence.service.js`, `document-classifier.service.js`, `google-drive.service.js`, this pass | 2 retry loops serially, ~6s worst-case backoff alone, no ceiling on actual call latency | Independent, confirmed multi-second risk on autofill routes specifically | **CONFIRMED** | High | Medium (narrow) |
| Frontend | Attorney portal 30s/60s polling | `useUnreadCounts.js`/`NotificationBell.jsx`, 2026-09-17 | Confirmed unchanged this pass | Real, additive, small | LIKELY (minor amplifier) | High | Low |
| Frontend | **StrictMode doubling raw-effect fetches (new)** | Direct `main.jsx` reads, all 3 apps, this pass | Immiglance/Attorney: yes; Admin: no | Dev-only effect; real but small | **CONFIRMED** | High | Low (dev-only) |
| Frontend | **Attorney dashboard duplicate request (new)** | `AppLayout.jsx`/`Dashboard.jsx` read, this pass | `GET /attorney/dashboard` fired twice per load, no cache to catch it | Concrete, reproducible waste, not modeled | **CONFIRMED** | High | Low-Medium |
| Frontend | **Uneven auth-init cost across apps (new)** | `AuthContext.jsx` read, all 3 apps, this pass | Immiglance: 0 requests (short-circuit); Admin: 1-2 unconditional; Attorney: 1 unconditional | Materially different per-app baseline load | **CONFIRMED** | High | Low |
| Retry/amplification | Mongo `retryReads` doubling a dead-connection stall | Driver default + `socketTimeoutMS` math, 2026-09-17 | Bound (~30s) doesn't match observed range; no live evidence of firing | Unconfirmed contributor at the tail | POSSIBLE | Low | Low-Medium |
| Retry/amplification | **Document-intelligence chained retries (new, see above)** | this pass | see above | see above | CONFIRMED | High | Medium |
| Event loop | CPU-heavy sync code | Grep, 2026-09-17 | None found outside tests | Not a contributor | NOT SUPPORTED | Medium-High | None |
| Resources | **Host memory pressure (new)** | `Get-CimInstance`/`Get-Process`, this pass | 1.3GB free of 15.4GB at sample time | Notable but uncorrelated with any timestamped incident | POSSIBLE | Low | Unknown |

---

## 22. Manual Validation Required

Honestly unresolved, both from 2026-09-17 and newly surfaced this pass — none of
these can be settled from the repository or this machine alone:

1. **`serverStatus`/`currentOp` visibility.** Refused both on 2026-09-17 and
   2026-09-18 with identical error text on the app's own credential
   (`Ishan_Ins`). Requires either a credential with `clusterMonitor`-equivalent
   role, or direct access to the hosting provider's own dashboard/metrics for
   this instance (18.210.74.196). Without this, whether another client on this
   host is holding locks or consuming resources at the exact moments the
   symptom occurs remains completely unknown.
2. **No persisted log file.** `logger.js` writes only to stdout/stderr; nothing
   is captured to disk. This means neither pass could correlate the *exact*
   timestamps of the originally reported slow lines (7095ms/3188ms/4240ms/
   4004ms) against this investigation's own timeline of job ticks or measured
   network bursts — every conclusion in this report is built from
   independently reproduced mechanisms, not a captured joint timeline. This
   also blocked this pass's attempt to build a genuinely timestamped incident
   timeline (§I in the brief) — instead, §11's fresh, timestamped
   *re-measurement* of the underlying mechanism is offered as the closest
   substitute achievable without a log sink or authenticated production
   traffic to observe.
3. **Replica-set vs. standalone topology.** Both passes' live `hello` calls
   show a standalone-looking topology (no `setName`); the original
   characterization as an "Atlas M0" replica set was inferred from reverse-DNS
   naming, not confirmed via a live topology check. Neither this nor the prior
   pass could resolve which is correct — a replica-set-aware proxy in front of
   a single advertised endpoint would reconcile both observations, but this was
   not independently verified either time.
4. **Whether ~250ms baseline RTT matches the intended deployment region.**
   Neither pass has visibility into the intended/expected topology (same-region
   vs. deliberate cross-region deployment). If cross-region is intentional, the
   remediation calculus changes materially (§ Recommended Remediation, item 4).
5. **No authenticated, Mongo-touching HTTP request was exercised against the
   live backend in either pass.** This pass added real timing for the
   unauthenticated/no-Mongo layer (`/api/health`, unauthenticated
   `/cases/:id`) but had no valid JWT to safely exercise `authenticate()`'s
   Mongo-touching branches or the case-detail/dashboard controllers end to end
   without either fabricating credentials (out of scope for a read-only pass)
   or adding real load to a shared resource other users may depend on. The
   full per-request waterfalls in §8 are therefore a **reasoned
   reconstruction** from measured component costs (middleware-stack timing,
   Mongo RTT/connect cost, code-level operation counts), not a captured,
   end-to-end authenticated trace — labeled as such throughout, not presented
   with false precision.
6. **Whether the newly-identified unbounded fan-outs (§17.1) have actually
   caused an observed incident.** This pass confirms they exist and are
   unbounded by code inspection; it did not (and could not, read-only, without
   generating real load) measure their actual wall-clock cost against today's
   real headcount/data volume in this specific deployment.
7. **Whether host memory pressure (§19) correlates with any real incident.**
   Flagged from a single snapshot; would need either a monitoring tool
   sampling over time or correlation against a persisted log (see item 2)
   to move past POSSIBLE.
8. **Exact reproduction of the originally quoted symptom values** was again
   not attempted by generating synthetic load against the shared,
   production-adjacent cluster — judged out of scope for a read-only
   investigation in both passes, and flagged rather than silently skipped.

---

## 23. Confirmed / Likely / Ruled-Out / Unresolved — Consolidated

**CONFIRMED** (directly measured or directly read, both passes combined):
- `autoIndex`/`autoCreate` still disabled.
- Single backend instance on :7000, same process across both investigation
  dates.
- Every code-path query shape on the five named collections uses an index
  scan (2026-09-17, not re-run).
- ~250ms baseline Mongo RTT and ~1.5-1.8s cold-connect cost, independently
  reproduced 24 hours apart.
- Dashboard/analytics endpoint's ~45-58-operation fan-out and its completely
  inert cache in this environment (new this pass — the single largest new
  finding).
- Six additional unbounded, headcount-scaled fan-out sites beyond
  case-detail and the dashboard (new this pass).
- Ten recurring background jobs (up from 2 known), with a real phase-clustering
  property among three of them (new this pass).
- `JobLock`'s own mechanism is sound and does not pin connections (new this
  pass).
- SMTP has no configured timeout and is genuinely awaited on the critical
  path of five specific routes; the same bug pattern was already fixed once,
  for case creation only (new this pass).
- Document-intelligence autofill chains two independent retry loops serially
  on its critical path with no timeouts (new this pass).
- Frontend: StrictMode present in Immiglance/Attorney, absent in Admin; a
  real, reproducible duplicate request in Attorney's dashboard; materially
  different auth-init request counts per app (new this pass).

**LIKELY**:
- Network latency + pool decay as the primary explanation for *why* an
  individual burst-queued operation takes multiple seconds (carried over,
  reinforced by re-measurement).
- Case-detail's 19-populate fan-out as a real amplifier, with corrected
  concurrency math (§8.1).
- The 10 background jobs collectively as amplifiers of burst concurrency.

**POSSIBLE** (flagged honestly, not resolved):
- Mongo driver `retryReads` amplifying a dead-connection stall at the tail.
- USCIS-monitoring job's non-atomic lock causing double-processing (latent,
  not active under today's single-instance deployment).
- Host memory pressure as a contributing factor.

**NOT SUPPORTED**:
- CPU-heavy synchronous code blocking the event loop.
- Dev-mode `nodemon` restarts as an explanation for steady-state (not
  startup) latency.
- CRM-webhook retry, AI-job requeue, and frontend token-refresh-replay as
  amplifiers (all explicitly bounded/backgrounded, confirmed by code read).

**RULED OUT**:
- Duplicate/competing backend process.
- Missing or bad indexes, 64-index-cap recurrence, large data volume on the
  five named collections.
- `JobLock`'s own acquire/renew/release mechanism as a source of held
  connections.
- `GET /api/cases` (list endpoint) as a concurrency risk — bounded, capped,
  cited as a positive counterexample.

**UNABLE TO VERIFY** (unchanged both passes):
- Server-side load from other clients on the shared host (privilege refused
  both times, identical error).
- Replica-set vs. standalone topology (identical `hello` result both times,
  contradicts the prior team's "Atlas M0" documentation).
- Whether the measured RTT matches the intended deployment topology.

---

## 24. P0-P3 Ranking

**P0 — fix first, highest confirmed impact:**

1. **Dashboard/analytics cache is completely inert without Redis (§8.2, §10).**
   *Why*: every dashboard load recomputes ~45-58 Mongo operations from scratch,
   uncached, in this environment — the single largest concurrency amplifier
   found in either pass. *How*: `config/redis.js:132-134`'s
   `if (!redis) return compute();` has no in-memory fallback, unlike the
   auth-user cache and idle-session guard which both do. *When*: every single
   `GET /api/dashboard`/`/api/analytics/*` request, in this dev environment,
   unconditionally. *Where*: `Backend/src/config/redis.js`,
   `Backend/src/modules/dashboard/dashboard.service.js`. *Evidence*: direct
   code read, §8.2. *Expected impact of fixing*: an in-memory TTL fallback
   (mirroring the existing `USER_CACHE_TTL_SECONDS`/`inMemoryUserCache`
   pattern already in the same file) would cut the dashboard's Mongo load by
   roughly the same factor Redis would provide in production, at effectively
   zero additional complexity given the pattern already exists twice in the
   same file.

2. **SMTP has no configured timeout and blocks 5 specific request handlers
   (§16, §18).** *Why*: a slow/unreachable SMTP relay has no bounded worst
   case on password reset, case-manager/team-lead assignment, ownership
   transfer, and employee invitation. *How*: `nodemailer.createTransport(...)`
   sets no `connectionTimeout`/`greetingTimeout`/`socketTimeout`. *When*: any
   time Resend's SMTP endpoint is slow or momentarily unreachable — genuinely
   possible, since `SMTP_HOST` is a real, configured external dependency, not
   a stub. *Where*: `Backend/src/modules/email/providers/nodemailer.provider.js`;
   callers in `Backend/src/modules/cases/case.controller.js` (assignment/
   transfer/invite) and `Backend/src/modules/auth/auth.controller.js`
   (password reset). *Evidence*: direct code read, this pass. *Expected
   impact of fixing*: bounds a currently-open-ended failure mode to a known
   ceiling, and the codebase already has the exact right template to follow
   (`case.controller.js:1225-1264`'s `setImmediate` fix for case creation,
   which explicitly documents resolving a previously profiled ~2-minute
   stall this same way).

**P1 — fix soon, confirmed but narrower or slower-building impact:**

3. **Six unbounded, headcount/data-scaled fan-outs (§17.1)** — will get worse
   as the org grows, independent of any network fix. *Where*:
   `admin.controller.js:157`, `case-manager.controller.js:59-81,319-323`,
   `leaderboard.controller.js:13-25`, `case.service.js:698-723`,
   `settingsEngine.service.js:101-112`.

4. **Document-intelligence autofill's chained retries with no timeouts
   (§16, §18)** — confirmed real, isolated to a specific set of routes.

5. **Pool decay configuration (`minPoolSize=2`/`maxIdleTimeMS=60000`)** —
   carried over from 2026-09-17, reinforced by this pass's re-measurement;
   see the original report's remediation item 1 (unchanged recommendation).

**P2 — worth doing, lower urgency:**

6. **Case-detail's 19-populate fan-out**, with corrected concurrency math
   (§8.1) — still real, but smaller than previously characterized once the
   `getCase`/`getRelated` conflation is corrected.

7. **Background-job phase clustering (§13)** — the three 60s jobs' fixed
   initial-delay offsets could be spread further apart with no functional
   change, reducing (not eliminating) the every-minute clustering window.

8. **USCIS-monitoring job's unlocked/non-atomic scheduling (§13, §20)** —
   latent under today's single-instance deployment; worth fixing before any
   horizontal scaling.

9. **Frontend fixes**: Attorney's confirmed duplicate `/attorney/dashboard`
   request (§14.5); Attorney/Admin's lack of a shared query cache comparable
   to Immiglance's React Query usage.

**P3 — cosmetic / low-impact, do opportunistically:**

10. `JobLock`'s missing TTL index (§10, §20) — an ops/correctness nicety, not
    a performance issue given the current low `JobLock` document count.

11. `Task`'s `checkSlaBreaches` queries falling back to single-field indexes
    rather than purpose-built compound ones (carried over from 2026-09-17,
    unchanged — not costly at today's volume).

**Unresolved, not rankable without external access:** the four items in §22 —
`serverStatus`/`currentOp` privilege, persisted logging, replica-set topology,
and intended-region confirmation.

---

## 25. Recommended Remediation

*(Documented only — nothing below has been implemented in this pass, consistent
with this being a read-only investigation both times.)*

1. **Problem**: dashboard/analytics cache is a complete no-op without Redis
   (P0 #1). **Recommended change**: add the same in-memory `Map`-with-TTL
   fallback `config/redis.js` already implements for the auth-user cache
   (`inMemoryUserCache`) to `cachedDashboardCompute`, keyed the same way, with
   the same ~45-second TTL already defined (`DASHBOARD_CACHE_TTL_SECONDS`).
   **Expected improvement**: cuts per-dashboard-load Mongo operation count by
   roughly the cache-hit ratio the TTL allows, in every environment, not just
   ones with Redis configured. **Risk**: low — mirrors an existing, proven
   pattern in the same file. **Scope**: `Backend/src/config/redis.js`.
   **Priority**: P0.

2. **Problem**: SMTP has no timeout and blocks 5 specific request handlers
   (P0 #2). **Recommended change**: add `connectionTimeout`/
   `greetingTimeout`/`socketTimeout` to `nodemailer.createTransport(...)`
   (e.g. a few seconds each), and apply the same `setImmediate`-backgrounding
   pattern already used for case creation to the assignment/transfer/invite/
   password-reset call sites, or — for password reset specifically, where the
   user genuinely needs to know the email was queued — background the send
   but keep a fast, synchronous "queued" acknowledgment. **Expected
   improvement**: bounds a currently-unbounded failure mode; removes SMTP
   entirely from several routes' critical path. **Risk**: low-medium — needs
   care that password-reset UX still communicates success/failure
   appropriately. **Scope**: `Backend/src/modules/email/providers/
   nodemailer.provider.js`, `Backend/src/modules/cases/case.controller.js`,
   `Backend/src/modules/auth/auth.controller.js`. **Priority**: P0.

3. **Problem**: six fan-outs scale with headcount/data volume, not a fixed
   count (P1 #3). **Recommended change**: apply the same bounded-concurrency
   pattern already used elsewhere in this codebase (`realtime.gateway.js`'s
   semaphore, or `notification.service.js`'s batch-of-10) to
   `admin.controller.js:157`, `case-manager.controller.js`'s two unbounded
   `.map(async)` sites, `leaderboard.controller.js:13-25`, and add a batch
   size cap to `case.service.js:698-723`'s `bulkUpdateCases`. For
   `settingsEngine.service.js`'s ~99-entry catalog resolution, consider
   caching the whole catalog response for a short TTL rather than resolving
   every entry fresh on every settings-page visit. **Expected improvement**:
   removes a class of fan-out that gets strictly worse as the organization's
   headcount grows, independent of any network/pool fix. **Risk**: low —
   purely a concurrency-shape change, no behavior change if done correctly.
   **Scope**: the five files named above. **Priority**: P1.

4. **Problem**: document-intelligence autofill chains two retry loops with no
   timeouts (P1 #4). **Recommended change**: add explicit timeouts to the
   Google Document AI client call, the classifier's underlying call, and the
   Google Drive `fetch` (an `AbortController` with a reasonable deadline,
   matching the pattern already used for the OpenAI/Anthropic provider paths
   in `ai-provider.registry.js`). **Expected improvement**: bounds worst-case
   latency on this endpoint to a known ceiling instead of an open-ended one.
   **Risk**: low — additive only. **Scope**:
   `Backend/src/modules/document-intelligence/**`,
   `Backend/src/modules/integrations/google-drive.service.js`. **Priority**: P1.

5. **Problem**: pool decays to `minPoolSize=2` after 60s idle on a
   high-latency link (carried over from 2026-09-17, unchanged). **Recommended
   change**: raise `minPoolSize` (e.g. 8-15, informed by the concurrency
   figures this pass newly measured — the dashboard alone can want ~45-58 at
   once) and/or raise `maxIdleTimeMS` to several minutes. **Expected
   improvement**: fewer bursts pay the ~1.5-1.8s cold-connect cost measured in
   §11. **Risk**: holds more idle connections against the remote host
   continuously — needs to be weighed against that host's own connection
   ceiling (unknown, §22). **Scope**: `Backend/src/config/database.js`.
   **Priority**: P1 (unchanged from the prior report's High).

6. **Problem**: three 60-second background jobs are permanently phase-locked
   within 5-20 seconds of each other (new this pass, §13). **Recommended
   change**: spread their `_INITIAL_DELAY_MS` env defaults further apart
   (e.g. 10s/40s/70s instead of 20s/25s/40s against a shared 60s period) so
   they don't reliably cluster every minute. **Expected improvement**: reduces
   (does not eliminate) one recurring source of coincident background-job
   concurrency landing on top of real-user traffic. **Risk**: very low — a
   pure scheduling-offset change. **Scope**: `Backend/src/server.js` env
   defaults. **Priority**: P2.

7. **Problem**: `startUSCISMonitoringJob` isn't wrapped in `withJobLock` and
   its own bespoke lock is non-atomic (new this pass, §13, §20).
   **Recommended change**: wrap it in `withJobLock` like the other nine jobs,
   and replace `USCISScannerService.scanAll`'s 3-step `findOne`→`updateMany`→
   `create` sequence with the same atomic `findOneAndUpdate` pattern
   `jobLock.js` already implements. **Expected improvement**: removes a
   latent double-processing race before any horizontal scaling makes it
   active. **Risk**: low. **Scope**:
   `Backend/src/modules/uscis-lifecycle/jobs/USCISMonitoringJob.js`,
   `Backend/src/modules/uscis-lifecycle/services/USCISScannerService.js`.
   **Priority**: P2.

8. **Problem**: Attorney's dashboard fires a confirmed duplicate
   `GET /attorney/dashboard` request; Attorney and Admin lack a shared
   request-deduplication layer comparable to Immiglance's React Query usage
   (new this pass, §14). **Recommended change**: adopt React Query (or
   equivalent) in Attorney, and have `AppLayout`'s `useUnreadCounts` and
   `Dashboard.jsx` share one cached call instead of two independent ones; for
   Admin, migrate `CRMCaseDetail.jsx`/`Dashboard.jsx` off their hand-rolled
   5s/15s TTL maps and onto the React Query client the app already configures
   but doesn't use on these two pages. **Expected improvement**: removes
   confirmed duplicate network calls and closes the gap where Admin's own
   dashboard fires 5 independent stat requests with no cross-mount dedup.
   **Risk**: low-medium — a real frontend refactor, needs testing per page.
   **Scope**: `Attorney/src/layouts/AppLayout.jsx`,
   `Attorney/src/pages/Dashboard.jsx`, `Admin/frontend/src/pages/
   CRMCaseDetail.jsx`, `Admin/frontend/src/pages/Dashboard.jsx`. **Priority**: P2.

9. **Problem**: no persisted logs; no cluster-monitoring credential (carried
   over, §22). **Recommended change**: unchanged from the 2026-09-17 report —
   request a `clusterMonitor`-equivalent read-only credential, and add a
   file/aggregator transport to `Backend/src/utils/logger.js`. **Priority**:
   P0 for closing the evidence gap itself, even though it's not a code fix.

10. **Problem**: `Task`'s `checkSlaBreaches` queries use single-field indexes
    instead of purpose-built compound ones (carried over, unchanged, low
    urgency at today's volume). **Recommended change**: unchanged from the
    2026-09-17 report — add `{status:1, "reminders.date":1,
    "reminders.sent":1}` and `{status:1, dueDate:1, "sla.breachedAt":1}`
    compound indexes via the existing `syncIndexes.js` script. **Priority**: P3.

---

## 26. Final Conclusion

Some operations in this app take 3-7+ seconds while structurally identical ones
take ~230-290ms for the same underlying reason both investigation passes kept
landing on: **every single Mongo operation this backend makes has to cross a
~250-millisecond, fairly constant network gap to a remote database host, and
opening a *new* connection across that gap costs roughly six times that —
somewhere around 1.5 to 1.8 seconds — a cost this investigation has now
measured twice, 24 hours apart, with nearly identical results both times.**
Whether any given request feels "fast" or "slow" comes down almost entirely to
whether it lands on a connection the pool already has warmed up (fast: ~250ms,
matching the measured baseline almost exactly) or arrives just after the pool
has been allowed to idle down to its 2-connection floor and has to pay that
new-connection cost for some or all of the operations it needs (slow: a small
multiple of the baseline, matching the reported 3-7+ second range). This
investigation's deeper pass found that the app hands the pool far more
opportunities to get caught in exactly that position than previously known —
not just the case-detail page's ~19-20 concurrent operations, but a dashboard
endpoint that fans out to roughly 45-58 concurrent operations on *every single
load* because its cache is silently disabled in this environment, six more
endpoints whose concurrency scales with the number of staff or clients in the
system rather than any fixed cap, and ten background jobs (not two) running on
the same shared pool, three of which are scheduled to reliably overlap every
single minute. None of these bursts is expensive because MongoDB itself is
slow to answer — every query this investigation checked, in both passes,
executes in single-digit milliseconds once it actually reaches the server —
they are expensive because of how many *new connections across a slow link*
they can each demand at once, and how often the pool's own idle-timeout
configuration guarantees it will have let those connections lapse right before
the next burst arrives. Layered on top of that single, dominant mechanism, this
deeper pass also found a small number of specific routes (case reassignment,
ownership transfer, employee invitation, password reset, and the
document-intelligence "autofill" endpoint) that can independently stall for
several seconds or more for an unrelated reason — an external SMTP or
AI/document-processing call with no configured timeout, awaited directly on
that route's response — which would explain some slow requests even in a world
where the MongoDB connection story were fully fixed. Fixing the dashboard's
inert cache and the pool's idle-decay configuration would very likely eliminate
most of the multi-second cases this report and its predecessor were built to
explain; fixing the unbounded fan-outs and the unbounded external-call timeouts
would close off the two most concrete ways this problem could get worse, or
recur in a different shape, as the system grows.
