# ISSUE-004: Background Queue Started At Module Import

## Issue

`document-intelligence.queue.js` started `recoverPendingJobs` via `setImmediate()` at import time. Because `app.js` imports routes before the server is listening, DB polling could start during backend startup and add connection pressure/noise before the app was usable.

## Evidence

Startup logs showed repeated `documentprocessingjobs.find` slow queries while `/api/health` was not listening. After removing import-time startup, clean startup emitted only the actual blocker: `querySrv ETIMEOUT _mongodb._tcp.cluster0.eqpju6f.mongodb.net`.

## Proposed Plan

1. Remove import-time `setImmediate(recoverPendingJobs)`.
2. Export `startRecovery()`.
3. Call `startRecovery()` only after `server.listen()`.
4. Keep an env flag to disable startup recovery if needed.

## Contradictions / Alternatives

Do not solve this by increasing Mongo pool size. Import-time workers are an application lifecycle bug.

## Delivered

`document-intelligence.queue.js` exports `startRecovery()`, and `server.js` calls it after `shared_backend_started`.

## Future Learning

Route imports must be side-effect light. Background workers belong in explicit startup orchestration after DB connection and HTTP readiness.

