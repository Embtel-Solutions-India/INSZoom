# Production Security Audit

Status: remediation in progress. This report records verified repository evidence only. Production infrastructure and live tenant isolation still require authenticated deployment testing.

## Confirmed Findings

### P0: Sensitive values could enter structured logs

- Root cause: `Backend/src/config/database.js` included raw query filters and options in `mongodb_query_performance`; `Backend/src/middleware/errorHandler.js` could print raw 5xx stacks under `DEBUG_ERRORS=true`; HTTP logging included the full URL.
- Impact: query filters may contain email, phone, address, immigration identifiers, or form values; URLs can contain tokens if a caller supplies them.
- Remediation: centralized recursive redaction in `Backend/src/utils/logger.js`; production access logging now records only the URL path; raw console stack printing was removed.

### P0: Bearer access tokens persisted in browser storage

- Root cause: both portals previously stored access tokens in `localStorage`; INSZoom also stored refresh tokens there.
- Remediation: access tokens are now memory-only. Refresh tokens are delivered through the existing HttpOnly cookie and are not returned in login JSON or stored by the portals. A non-sensitive session marker remains in BAIS localStorage so refresh can be attempted after reload.
- Login password state is cleared after the authentication attempt in the client and admin login screens. The password still necessarily exists briefly in the browser to submit the authentication request; it is not persisted by the application.
- Remaining requirement: verify cookie behavior on the deployed custom domains and rotate any tokens exposed by older builds.

### P1: Socket conversation room IDOR

- Root cause: `Backend/src/modules/realtime/realtime.gateway.js` joined `conversation:${conversationId}` without checking the conversation participant or related case access.
- Remediation: conversation joins now validate ObjectId format, non-deleted conversation state, participant membership, and `caseService.canAccessCase()` for case conversations.

### P1: Production CORS could fall back to localhost

- Root cause: `Backend/src/config/env.js` had development origins as a fallback even when `NODE_ENV=production`.
- Remediation: production startup now requires explicit `CLIENT_URLS`/`ALLOWED_ORIGINS`/`CLIENT_URL`, and rejects non-HTTPS or localhost origins.

## Verified Existing Controls

- `User.password` is `select:false` and is bcrypt-hashed by the Mongoose pre-save hook.
- Refresh token hashes are stored in `AuthSession`; password-reset and invite tokens are stored as hashes with expiry fields.
- Document download/preview routes require authentication and resolve documents through an access-checked service path.
- Uploads have memory/file-size limits, extension/content validation, and malware-signature or configured scanner checks.
- Forms workspace and draft-PDF paths use case/form access middleware and server-side case authorization.
- Helmet, CORS, request validation, rate limiting, and trust-proxy handling are present, but deployment verification remains necessary.

## Remaining Audit Work / Limitations

- Live Client A/Client B, staff-scope, document, form, payment, and role-escalation tests require a reachable production-like MongoDB and test accounts.
- Nginx, PM2/systemd, TLS, HSTS, CSP exceptions, and WebSocket upgrade configuration are outside the repository snapshot and need host-level inspection.
- Dependency audit must be run in each package directory and reviewed before upgrades; no blind upgrades are included here.
- Historical Git secrets cannot be inferred solely from the working tree. Run repository history scanning and rotate any credential found there.
- The repository still contains development diagnostics and test fixtures in ignored/local paths; they must not be deployed or tracked.

## Verification Commands

```text
node --test Backend/src/utils/logger.security.test.js
node --check Backend/src/utils/logger.js
node --check Backend/src/modules/realtime/realtime.gateway.js
npm audit --prefix Backend --omit=dev
npm audit --prefix INSZoom/frontend --omit=dev
npm audit --prefix BAIS/Frontend --omit=dev
```

## MongoDB Connection-Pool Incident Remediation (2026-08-13)

### Incident and evidence

The incident was not isolated to Forms. The request path and startup path both contained avoidable database pressure:

- The authenticated INSZoom layout loaded the complete notification history immediately and repeated that work every 30 seconds.
- The unread-message badge used `GET /messages/unread-count`, but on failure it fell back to `GET /messages?isRead=false`. That fallback could load a large message feed precisely while MongoDB was already unavailable or pool-starved.
- The unread-message endpoint hydrated complete `Conversation` documents even though it only needed participant unread counters.
- Socket.IO reconnection was enabled without a finite attempt limit or bounded backoff.
- Backend startup invoked questionnaire initialization and USCIS seed work by default, and USCIS monitoring ran immediately in production. These are application-data jobs, not prerequisites for accepting HTTP traffic.
- The Mongo query profiler included complete filters, fields, and options in slow-query logs. Besides PII risk, this adds serialization/logging overhead during an incident.

The repository does not contain an authoritative process supervisor configuration, so the number of simultaneously running production processes cannot be proven from source alone. It must be checked in PM2/systemd/container orchestration. MongoDB SRV DNS was also unreachable from this environment, so live pool wait measurements and authenticated browser acceptance tests remain deployment verification items.

### Remediation implemented

- `Backend/src/modules/messages/message.controller.js`: unread counts now use `.select("participants unreadClient unreadManager").lean()` and do not hydrate full conversations.
- `INSZoom/frontend/src/contexts/NotificationContext.jsx`: removed the unbounded full-message fallback; transient count failures preserve the last known value. Full notification history is no longer fetched on login or on each poll.
- `INSZoom/frontend/src/layouts/Layout.jsx`: notification history is fetched only when the user opens the notification menu.
- `INSZoom/frontend/src/contexts/SocketContext.jsx`: reconnection is limited to five attempts with bounded exponential-style delay and jitter.
- `Backend/src/config/database.js`: production slow-query logs no longer serialize raw filters, fields, or options. Query detail logging is development-only and explicitly opt-in with `PERF_LOG_QUERY_DETAILS=true`.
- `Backend/src/server.js`: questionnaire initialization and USCIS template seeding on startup are now explicit opt-in operations (`SEED_QUESTIONNAIRE_TEMPLATES_ON_STARTUP=true` and `USCIS_TEMPLATE_SEED_ON_STARTUP=true`). Existing database records are not deleted or overwritten by this change.
- `Backend/src/modules/uscis-lifecycle/jobs/USCISMonitoringJob.js`: the first monitoring run is delayed by 60 seconds by default (`USCIS_MONITORING_INITIAL_DELAY_MS`), allowing the HTTP server and normal request traffic to stabilize first.

### Verification and outcome

- `npm run build` in `INSZoom/frontend`: passed.
- `node --check` passed for the changed backend files.
- `npm test` in `Backend`: 383 tests passed. 39 Mongo-dependent integration tests failed during setup because the configured MongoDB SRV lookup timed out (`querySrv ETIMEOUT _mongodb._tcp.cluster0.eqpju6f.mongodb.net`); these failures are environmental and prevented live endpoint/browser/PDF verification in this workspace.
- No database migration was performed. No CaseForm, USCIS template, mapping, user, or credential data was deleted or rewritten.
- The production deployment must set the explicit startup-seed flags only for a controlled maintenance run, verify one backend process/worker topology, and repeat the Forms HTTP/browser/PDF acceptance suite against reachable MongoDB. Until that is done, live pool saturation resolution and end-to-end Forms acceptance are **not claimed as verified**.

### Future guardrail

Do not reintroduce eager full-list fetches as badge fallbacks, unbounded socket retries, or production startup seed/scan jobs. When a bounded count endpoint fails, surface/retain the last known count and classify the error; do not issue a larger query that increases MongoDB pressure.

## Full Forensic Audit Findings (2026-08-13/14) — New P0/P1 Confirmed

This section records findings from a full-scope forensic audit (18 dimensions: endpoints, models, API contracts, Cases module, auth chain, status-code semantics, DB/N+1, concurrency, background jobs, IDOR/RBAC, forms/PDF pipeline, OCR/questionnaire lineage, storage/integrations, dead code, env/config, plus a dependency-graph system under `docs/architecture/`). Full evidence-cited detail lives in the chat transcript of that session; this section records the confirmed findings in the format this document already uses.

### P0: No per-case authorization on eligibility, package-generation, and auto-fill routes

- Root cause: `Backend/src/modules/eligibility-engine/services/EligibilityEngineService.js` never calls `canAccessCase`/`case.service`; `POST /api/forms/packages/generate` (`formGenerationRoutes.js:10`) omits the `requireCaseFormAccess` middleware every sibling route in the same file carries; `Backend/src/modules/form-mapping/services/AutoFillService.js` never receives a `user` parameter at any of its ten route entry points. A dead-but-unmounted `Backend/src/modules/sync/sync.routes.js` has the identical defect at the router level.
- Impact: any authenticated user holding the relevant role/permission (not necessarily any relationship to the case) can read or write another case's eligibility assessment, generated USCIS PDFs and approved evidence, or auto-filled form data by substituting `caseId`.
- Remediation: not yet implemented. See `docs/forms/issues/ISSUE-008-idor-eligibility-packages-autofill.md`.

### P0: Case model's declared indexes exceed MongoDB's per-collection limit

- Root cause: `Backend/src/models/Case.js` declares 127 total indexes (83 implicit field-level + explicit compound/text indexes at lines 851-897); MongoDB permits a maximum of 64 per collection. Indexes are created in `schema.indexes()` order, so the explicit compound/text indexes (positions 85-128) do not exist on the live collection.
- Impact: the Cases-list endpoint's filter/sort operations likely fall back to unindexed collection scans for exactly the query shapes the missing indexes were meant to serve, compounding the connection-instability-driven 503s (see below).
- Remediation: not yet implemented. Reduce the field-level implicit index count (many are redundant prefixes of the explicit compound indexes — 127 total redundant single-field indexes found across all 64 models, 28 of them on Case alone) before re-declaring the intended compound/text indexes.

### P1: Cases endpoints reproduce the same connection-instability 503 previously diagnosed only for Forms

- Root cause: same mechanism as the MongoDB connection-pool incident recorded above (dying pooled connections on the shared/free-tier Atlas cluster), now confirmed live on `GET /api/cases` and `GET /api/cases/dashboard/team-lead`, neither of which has the `.maxTimeMS()` fail-fast budget already applied to the Forms read paths.
- Evidence: live reproduction this session — both endpoints returned 503 after ~30.2s, with `mongodb_connection_closed(reason:"error")` logged immediately before each failure; a direct driver probe against the same cluster in the same session succeeded in under 1 second, ruling out a general cluster outage.
- Remediation: not yet implemented. See `docs/forms/issues/ISSUE-006-cases-503-dead-pooled-connections.md`.

### P1: Auth-refresh session rotation race produces an undifferentiated 500

- Root cause: `Backend/src/modules/auth/session.service.js:rotateSession` performs an unguarded load-then-save on an `AuthSession` document using Mongoose's default optimistic-concurrency versioning; concurrent refresh calls sharing one still-valid token race, and the loser's `session.save()` throws a `VersionError`, which `errorHandler.js`'s `isDatabaseUnavailableError` allowlist does not recognize, so it falls through to a generic 500.
- Impact: reproducible authentication failure distinct from — and previously conflated with — the database-availability 503s; also silently orphans a valid, unreturned session on every occurrence.
- Remediation: not yet implemented. See `docs/forms/issues/ISSUE-007-auth-refresh-session-rotation-race.md`.

### P1: Server-side login has no central role/portal gate

- Root cause: `POST /api/auth/login` (`auth.service.js`) issues a valid token to any active, credentialed user regardless of role; portal separation (client vs. staff) is enforced only client-side, per-portal, in React state after the token already exists (`INSZoom/frontend/src/contexts/AuthContext.jsx:99`, `BAIS/Frontend/src/Pages/Admin/AdminLogin.jsx:52-56`).
- Impact: whether a client-role token is rejected by staff-only backend routes depends entirely on each individual route carrying its own `authorizeRoles`/`authorizePermissions` check — confirmed present on the routes this session traced, but there is no defense-in-depth central gate if a future route is added without one.
- Remediation: not yet implemented — recommend a documented, enforced convention (or a shared middleware default) rather than relying on per-route diligence alone.

### Verified NOT broken (recorded so it is not re-investigated)

- The 503/`DATABASE_UNAVAILABLE` classifier in `errorHandler.js` is narrow and precise (7 exact Mongo/Mongoose error names + error code 50) — confirmed no non-database error is laundered into a false 503 anywhere in the routes traced this session.
- `TOKEN_EXPIRED` contract between backend and both frontends matches exactly; silent-refresh-then-retry works as designed with no redirect loop on either portal.
- Socket.IO conversation-room IDOR (recorded above as a P1 fix) re-verified PASS in current code; no other joinable room accepts a client-supplied id.
- Stripe webhook signature verification is enforced and correctly configured with an explicit timeout and retry policy — the best-hardened external integration in the codebase.
- The verified I-129 PDF-rendering pipeline (38 pages, 980 AcroForm fields, 349/351 written, 311/311 persisted-value fidelity) was not re-broken by anything found this session.

### Future guardrail

A fix scoped to one endpoint does not protect a structurally identical endpoint hitting the same unreliable dependency — the Cases-503 finding is proof (the Forms `.maxTimeMS()` fix from the prior incident was never extended to Cases). When a connection-instability or authorization gap is found and fixed on one route, grep the rest of the codebase for the same pattern before considering the class of bug closed.
