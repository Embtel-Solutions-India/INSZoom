# ISSUE-006: Cases Endpoints 503 — Dead Pooled Connections Recur (Broader Than Forms)

## Issue

`GET /api/cases` and `GET /api/cases/dashboard/team-lead` return `503 DATABASE_UNAVAILABLE` after ~30.2 seconds in production, reproduced live this session by starting the backend against the real production MongoDB and hitting both endpoints directly. This is the same failure class as ISSUE-005, confirmed to still be occurring on the Cases module specifically (not just the historically-cited Forms endpoint), and it directly matches the user's own live browser capture: `GET /api/cases/dashboard/team-lead` (Dashboard.jsx:998) returning 503 in DevTools.

## Evidence

- Live reproduction (this session): `GET /cases/dashboard/team-lead` → `HTTP 503, 30,224,980µs`; `GET /cases?page=1&limit=20` → `HTTP 503, 30,164,883µs`.
- Server log for both requests: `MongoNetworkTimeoutError: connection <N> to <atlas-shard-ip>:27017 timed out`, immediately preceded by `mongodb_connection_closed` with `reason:"error"` (not `"idle"`/`"poolClosed"`) on the same connection id.
- Independently, a direct read-only MongoDB driver probe against the same cluster (bypassing the app entirely) succeeded in 673ms connect / 50ms ping, with all collection counts ~50ms — ruling out "MongoDB itself is slow" or "MongoDB is unreachable" as the cause.
- `Backend/src/config/database.js:96-108` (pre-existing code comment) already documents this exact mechanism for a different endpoint: connections on this shared/free-tier Atlas cluster die mid-pool silently; the driver only discovers it when a query stalls the full `socketTimeoutMS` (15000ms), and `retryReads`' single automatic retry doubles the exposure to ~30s before surfacing.
- `Backend/src/modules/cases/case.service.js:33-46` — `CASE_LIST_POPULATE` is 12 populate paths (17 for a single-case read via `populateCaseQuery`); each populate is its own query, multiplying the number of chances a single Cases request has of landing on one dead connection.

## Proposed Plan

1. Add `.maxTimeMS()` fail-fast budgets to the Cases-list and Cases-dashboard query paths, matching the pattern already used in `uscis-form.service.js`'s `getAccessibleCase` (bounded primary read, `secondaryPreferred` fallback for read-only endpoints).
2. Reduce the Cases-list populate fan-out (12-17 paths) where fields aren't actually rendered by the list view, to reduce the number of connection-checkout attempts per request.
3. Consider whether `retryReads`' default single-retry-at-full-timeout behavior is the right tradeoff for this cluster tier, or whether a shorter per-attempt timeout with more retries would fail faster without doubling latency.
4. Durable fix (already called out by ISSUE-005 and repeated here): move off the shared/free Atlas tier, since the code-level mitigations only bound the damage, they don't stop connections from dying.

## Contradictions / Alternatives

Do not "fix" this by increasing `MONGO_MAX_POOL_SIZE` or `socketTimeoutMS` — the prior incident already tried larger pools and longer timeouts and made the user-facing hang worse (90s), not better. The correct direction is shorter fail-fast budgets on read paths (as already done for Forms) plus fewer round trips per request, not bigger numbers.

## Delivered

Not yet delivered — this is an audit finding, not a fix. `errorHandler.js`'s 503 classification itself is correct and requires no change (verified narrow and precise, not a source of false-positive 503s).

## Future Learning

A single `.maxTimeMS()` fix applied to one endpoint (Forms) does not protect a different endpoint (Cases) hitting the same unreliable cluster. When a cluster-instability issue is diagnosed, audit every read path for the same "unbounded query on a possibly-dead connection" pattern, not just the one that was reported.
