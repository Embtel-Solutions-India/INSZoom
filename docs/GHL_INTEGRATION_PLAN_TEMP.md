# GoHighLevel (GHL) Integration: Implementation Plan (TEMP), Revision 2

Status: **DRAFT, awaiting approval. No code has been written.**
Scope: Backend, Admin frontend. Landing, Client portal and Attorney portal are not touched.

### What changed from Revision 1

| # | Change |
|---|---|
| 1 | **No fake visa type.** GHL cases are created with `visaType = null` and `visaSelectionStatus = "pending"`. Visa-driven provisioning (checklists, forms, questionnaires) runs only after the team lead selects a visa. A GHL custom field for visa type is the preferred source, after we inspect GHL (§6.2, §6.6). |
| 2 | **Conflict resolution rewritten.** The "pending job exists, otherwise GHL wins" rule is gone. It is replaced by version and timestamp metadata with a deterministic rule (§6.5). |
| 3 | **Hard worker invariant:** a job re-checks its own status and version immediately before it calls GHL (§6.4). |
| 4 | **Two mandatory duplicate guards:** `webhookId` dedupe **and** a unique compound index on `locationId + opportunityId` (§5.2, §7). |
| 5 | **Atomic job claim with lease** for multi-instance safety, made an explicit requirement (§6.4). |
| 6 | **Contact sync is GHL → CRM only in Phase 1.** Field-level ownership is declared in config so bidirectional sync can be added later (§10). |
| 7 | **Sync status** is `SYNCED / PENDING / FAILED`, and only admins and super admins ever see `FAILED`. Internals are stripped from responses for everyone else (§8, §9). |
| 8 | **Webhook event state machine** with attempt counters (§5.3). |
| 9 | **Integration health panel** specified (§9.3). |
| 10 | **Origin recorded** per case: `initial_sync`, `webhook` or `reconciliation`, shown in the timeline and audit (§6.1, §6.2). |
| 11 | **Stage rename and config drift detection.** Mappings stay keyed by stage ID, but a renamed or missing GHL stage puts the integration into `config_mismatch` and alerts an admin (§5.1, §6.7). |
| 12 | **Six extra tests** added (§12). |
| 13 | **MCP is explicitly out of the production sync path** (§3). |
| 14 | `createCase` is **not** refactored. This is now a firm decision, not an option (§6.2). |

---

## 1. Goal

Add GHL as a **third source of cases**, next to Lead conversion and the "Create Case" button.

- Two GHL pipelines, **Immigrant Documentation Pipeline** and **Non-Immigrant Documentation Pipeline**, share the same stages. Both are shown in Admin as **one unified Kanban board**.
- A new GHL opportunity automatically creates a case in the CRM. The client and the team lead get emails, and the case lands in the team lead's queue. The team lead assigns it to a case manager, selects the visa, and the normal workflow continues.
- Dragging a card to another stage in Admin moves it **instantly** in the UI. The backend updates GHL in the background, with retries. The UI never waits on GHL.
- A stage change made in GHL flows back into the CRM through webhooks.
- Moving a card only ever changes **that opportunity** in **its own source pipeline**. The other pipeline and its data stay untouched.

### Hard guarantee: do not break anything existing

- Every change is **additive**: new module, new collections, one optional sub-document on Case, new routes, new page.
- A master switch, `GHL_ENABLED`, guards everything. When it is off or GHL is down, the rest of the app behaves exactly as today.
- Existing `createCase`, lead conversion, assignment, notifications and emails are **reused, not modified**. `createCase` is not refactored.
- GHL failures are logged and retried in the background. They never throw into an existing request path.
- **Two concepts stay separate:** `Case.stage` is the internal immigration workflow stage (`intake`, `forms`, ...). `Case.integrations.ghl.unifiedStageKey` is the CRM pipeline position. Dragging a card or receiving a GHL stage event **never touches `Case.stage`** and never triggers the workflow engine, form provisioning or checklists.

---

## 2. Findings from the codebase analysis

| Area | What exists | How we use it |
|---|---|---|
| GHL code | None. `Backend/.env` already has `GHL_PRIVATE_INTEGRATION_TOKEN`, `GHL_LOCATION_ID`, `GHL_PIPELINE_ID` (values not read). | Greenfield. Add `GHL_*` vars to `.env.example`. |
| App wiring | `app.js` mounts `/api` routes. Stripe webhook is registered with `express.raw` **before** `express.json`. | GHL webhook copies this raw-body pattern. |
| Module layout | `modules/<name>/{routes,controller,service}.js` plus `tests/`. | New code goes in `Backend/src/integrations/ghl/` (as requested), exposed through a thin route module. |
| Case model | `Backend/src/models/Case.js`: `visaType` (**currently required**), `stage` (`CRM_STAGES`), `status`, `assignedCaseManager`, `assignedTeamLead`, `creationSource`, `stageHistory`, `timeline`. | Add `integrations.ghl`, `visaSelectionStatus`, `category`, and `ghl` in `creationSource`. Make `visaType` conditionally required (see §6.2). |
| Case creation | `createCase` in `case.controller.js` (~1015–1530): case number, client user, audit, `setStage("intake")`, then in `setImmediate` `lifecycleOrchestrator.initializeCase` sends the client and team emails and notifications. | `ghlCaseFactory` calls the same lower-level services. `createCase` stays untouched. |
| RBAC | `authenticate`, `authorizeRoles`, `authorizePermissions`. `applyCaseRoleFilter` limits a `case_manager` to assigned, primary or secondary cases. | Reuse `applyCaseRoleFilter` for the board. |
| Realtime | `realtime.gateway.js` has `emitToUser`, `emitToRole`. | Emit `ghl:pipeline:updated` for live board refresh. |
| Jobs | `setInterval` loops in `server.js` via `scheduleInitialRun`. `bullmq` and `ioredis` are installed but unused. | Reuse `setInterval`, but all work is claimed atomically from Mongo so several instances are safe. No Redis dependency. |
| HTTP | No axios in Backend. Node 22 global `fetch` is available. | `fetch` with a retry wrapper. |
| Frontend | `@dnd-kit/*` installed. `@tanstack/react-query` barely used. `SocketContext` exposes `subscribe`. `api.js` is an axios instance with `casesApi`-style objects. | Board with `@dnd-kit`, local state for optimistic moves, add a `ghlApi` object. |
| Existing "pipeline" | UI-only section in `Leads.jsx`. No Kanban, no backend model. | New Pipeline page. Leads is untouched. |
| Settings | No Integrations tab. The `integrations.registry.js` was deleted earlier. | Small standalone "GoHighLevel" admin panel. |

### Must read before coding (Phase 1 audit)

The visa decision (§6.2) depends on what these existing pieces do with `visaType`, so I will read them first and report back:
- `lifecycleOrchestrator.initializeCase` and `workflowService.caseCreated`
- `case.service.setStage` and whatever currently provisions checklists, forms and questionnaires after a case is created or its visa changes
- The `case_created` email templates (do they require a visa value?)
- The visa/case-type update path used by the team lead today (the hook point for deferred provisioning)

---

## 3. Architecture

```
GHL (2 pipelines)
   │  webhooks (Ed25519 signed)              ▲ PUT /opportunities/{id}
   ▼                                         │ (background worker, retried)
POST /api/integrations/ghl/webhooks     GHLSyncJob queue
   │ verify → dedupe → persist → 200        ▲
   ▼ async worker                           │
ghlWebhookService ──► ghlSyncService ──► Case (Mongo)  ◄── PATCH /api/cases/:id/pipeline-stage
                                         │                          ▲
                                         ▼ socket event             │ optimistic drag
                                   Admin Kanban (unified board) ────┘
```

Principles:
1. **The frontend only talks to our backend.** It never calls GHL.
2. **Identity is `locationId + opportunityId`, never email.** One person can have several opportunities.
3. **Field-level source of truth** (§10).
4. **Config is stored in the database**, not hard-coded. No `if (pipelineId === "abc")` anywhere.
5. **Stages are mapped by IDs.** Names are only used to build the unified columns, once (§5.1).
6. **MCP is not part of production sync.** Production is: Private Integration token → GHL REST API, plus GHL webhooks → our backend. MCP can come later for operator questions ("show failed GHL syncs", "why didn't this opportunity create a case?"), never in the transactional path.

---

## 4. Files

### To add

```
Backend/src/integrations/ghl/
├── ghl.config.js              # env parsing, GHL_ENABLED, base URL, API version
├── ghlClient.js               # fetch wrapper: Bearer token, Version header, retry/backoff, 429 + Retry-After
├── ghlPipelineService.js      # list/get pipelines, build/refresh stage mappings, drift detection
├── ghlOpportunityService.js   # paginated search, get, update stage/status
├── ghlContactService.js       # get contact, normalise name/email/phone
├── ghlWebhookService.js       # signature verify, dedupe, event state machine, routing
├── ghlSyncService.js          # inbound upsert, outbound queue + worker, initial sync, reconciliation
├── ghlCaseFactory.js          # opportunity + contact → CRM case, via existing lower-level services
├── ghlHealthService.js        # status / health summary
├── ghl.routes.js
├── ghl.controller.js
└── tests/

Backend/src/models/
├── GHLIntegration.js          # config + stage mappings (one per location)
├── GHLWebhookEvent.js         # idempotency log + processing state machine
├── GHLSyncJob.js              # outbound queue
└── GHLLock.js                 # (or a field on GHLIntegration) reconciliation lock

Admin/frontend/src/
├── pages/Pipeline.jsx
├── components/pipeline/{Board,Column,Card,GhlStatusPanel}.jsx
├── hooks/usePipelineBoard.js
└── api.js gets `ghlApi`; App.jsx gets a route; Layout sidebar gets an entry

docs/GHL_INTEGRATION.md          # final reference (replaces this temp file)
docs/PHASE_N_COMPLETION_REPORT.md  # per project convention
```

### Existing files to modify (minimal)

| File | Change |
|---|---|
| `Backend/src/models/Case.js` | Add optional `integrations.ghl`, `visaSelectionStatus`, `category`; add `ghl` to `creationSource`; make `visaType` required **unless** `visaSelectionStatus === "pending"`; add the unique compound partial index (§5.2). |
| `Backend/src/app.js` | Register the GHL webhook with `express.raw` next to Stripe. |
| `Backend/src/routes/index.js` | One mount line for `/integrations/ghl`, plus the pipeline-stage route. |
| `Backend/src/server.js` | Start the outbound worker, webhook-event worker and reconciliation job, only if `GHL_ENABLED`. |
| `Backend/.env.example` | Add `GHL_*` variable names (no values). |
| The visa-update path (identified in the Phase 1 audit) | One small hook: when a GHL case's visa is set, flip `visaSelectionStatus` to `selected` and run the deferred provisioning. A no-op for all other cases. |
| `Admin/frontend/src/{App.jsx, layouts/Layout.jsx, services/api.js}` | Route, sidebar entry, API object. |

The `visaType` change is the only model constraint that loosens. The condition only matches GHL cases, so for every existing creation path the field stays required exactly as today.

---

## 5. Data model

### 5.1 `GHLIntegration` (one per location)

```js
{
  locationId, enabled,
  status: "healthy" | "config_mismatch" | "degraded" | "disabled",
  pipelines: [{ ghlPipelineId, ghlPipelineName, category: "immigrant"|"non_immigrant", enabled,
                lastFetchOkAt, lastFetchError }],
  unifiedStages: [{ key, name, order }],
  stageMappings: [{
    ghlPipelineId, ghlStageId, ghlStageName,       // name as last seen in GHL
    unifiedStageKey, unifiedStageName
  }],
  visaFieldMapping: { ghlCustomFieldId, valueMap: { "<ghl value>": "<visaType>" } },  // §6.6, optional
  contactFieldOwnership: { name: "ghl", email: "ghl", phone: "ghl" },                  // §10
  lastInitialSyncAt, lastReconcileAt, lastWebhookAt, lastApiOkAt,
  createdAt, updatedAt
}
```

**Stage mapping rule.** On setup we fetch both pipelines and build the unified columns from the stage lists. Names and order are used **only at this moment** to pair up the two stage sets. After that every runtime operation uses `(ghlPipelineId, ghlStageId)` from `stageMappings`.

**Stop on mismatch.** If the two pipelines do not have identical stages, setup **stops and reports the difference**. It never builds a union and never guesses. We resolve it together, then continue.

**Drift detection (§6.7).** If a mapped GHL stage is renamed, deleted, or a new stage appears, the integration moves to `config_mismatch` and an admin is alerted. Nothing is silently re-mapped.

### 5.2 `Case.integrations.ghl` and related fields

```js
visaType: null | "<existing visa value>",
visaSelectionStatus: "pending" | "selected",       // only "pending" for GHL cases without a known visa
category: "immigrant" | "non_immigrant" | null,    // from the source pipeline

integrations: { ghl: {
  locationId, opportunityId, contactId,
  pipelineId, pipelineStageId,                     // current GHL position
  sourcePipelineId, sourceStageId,                 // where it entered
  unifiedStageKey,                                 // current board column (NOT Case.stage)
  opportunityStatus,                               // open / won / lost / abandoned
  origin: "initial_sync" | "webhook" | "reconciliation",
  flags: { deletedInGhl: false, needsAttention: false },
  lastSyncedAt,
  sync: {
    state: "synced" | "pending" | "failed",
    version,            // integer, incremented on every accepted stage change
    source,             // "immiglance" | "ghl"
    changedAt,          // timestamp of the last accepted stage change
    operationId,        // UUID of the last accepted change
    lastSyncedStageId,  // last stage ID known to be in agreement with GHL
    lastError, attempts
  }
}}
```

**Two mandatory duplicate guards, both required, neither optional:**
1. `GHLWebhookEvent.webhookId` unique, which catches the same delivery repeated.
2. **A unique compound partial index** on `integrations.ghl.locationId + integrations.ghl.opportunityId` (partial, so cases without GHL data are not affected). This catches a *different* webhook ID for the same opportunity, for example when our response was lost and GHL re-sent with a new ID. Case creation must also handle the duplicate-key error by loading the existing case instead of failing.

### 5.3 `GHLWebhookEvent` (processing state machine)

```js
{
  webhookId (unique), eventType, eventVersion, locationId, opportunityId, contactId,
  payload, receivedAt, eventTimestamp,
  status: "received" | "processing" | "processed" | "ignored" | "failed" | "dead",
  processingAttempts, lastAttemptAt, nextAttemptAt, lastError, processedAt,
  lockedUntil     // lease for atomic claim
}
```

- `received → processing → processed`, or `→ ignored` (unconfigured pipeline, unmapped stage, our own echo), or `→ failed` (retry with backoff) `→ dead` after max attempts, which an admin can requeue.
- TTL index of about 30 days on `receivedAt`, except for `failed` and `dead` records.

### 5.4 `GHLSyncJob` (outbound queue)

```js
{
  caseId, opportunityId, pipelineId, pipelineStageId,
  caseSyncVersion,         // the case's sync.version this job was created for
  operationId,
  status: "pending" | "processing" | "done" | "failed" | "superseded",
  attempts, nextAttemptAt, lockedUntil, lastError, createdAt, completedAt
}
```

---

## 6. Flows

### 6.1 Setup and initial import (admin "Sync now")

1. `GET /opportunities/pipelines?locationId=…`, select the two pipelines (configured IDs, falling back to a name match).
2. Build and store `unifiedStages` and `stageMappings`. **Stop and report if the stage sets differ.**
3. **Inspect the opportunity and contact custom-field structure** and report whether a visa type field exists (§6.6).
4. For each pipeline: `GET /opportunities/search` with `pipeline_id` and `location_id`, **fully paginated** until no records remain. Each pipeline is processed in isolation (see §6.7).
5. For each opportunity: `GET /contacts/{contactId}`.
6. Upsert by `locationId + opportunityId`.
   - **New:** create via `ghlCaseFactory` with `origin: "initial_sync"` and **no client or team lead emails** (default off; confirm). The timeline and audit entry reads **"Created from GHL — Initial Sync"**.
   - **Existing:** update only GHL-owned fields (§10).
7. Idempotent and resumable. Running it twice creates no duplicates.

### 6.2 GHL → CRM: new opportunity (`OpportunityCreate`)

```
verify signature → check locationId → dedupe webhookId → persist event → return 200
  → (worker) claim event atomically
  → pipeline configured? no → ignored
  → find case by locationId+opportunityId → exists? update fields, stop
  → fetch contact
  → ghlCaseFactory creates the case (below)
  → map stage by (pipelineId, stageId) → save integrations.ghl (origin: "webhook")
  → timeline + audit: "Created from GHL — OpportunityCreate webhook"
  → emails/notifications through the existing lifecycleOrchestrator path
  → case sits in the team lead queue (pending_assignment, no case manager)
  → socket event → board refreshes
```

**`ghlCaseFactory`:** calls `CaseNumberService`, the client-user find-or-create logic, `case.service` and `lifecycleOrchestrator` directly, **without** calling or editing `createCase`. We accept a little duplicated glue code to get zero regression risk on the existing path.

**Visa type: no placeholder, no fake value.**
- The factory sets `visaType = null`, `visaSelectionStatus = "pending"`, and `category` from the source pipeline (immigrant or non-immigrant).
- If a visa value is found in a GHL custom field and it maps through `visaFieldMapping.valueMap`, use it and set `visaSelectionStatus = "selected"` (§6.6).
- **No visa-driven provisioning runs while the status is `pending`.** That means no checklists, no forms, no questionnaires, no conditional forms and no document requirements. The team lead sees a clear **"Visa selection required"** state on the case.
- When the team lead selects the visa, the small hook in the visa-update path sets `selected` and runs the same provisioning the existing flow runs for any other case.
- The exact gating points come from the Phase 1 audit. If any existing hook would provision on case creation regardless of visa, the factory bypasses it for pending cases and the audit tells us how.

**Missing email:** the case is still created and flagged `needsAttention`. It is never dropped. The client user is created later when an email appears.

### 6.3 GHL → CRM: stage change (`OpportunityStageUpdate` / `OpportunityUpdate`)

1. Find the case by opportunity ID. Not found? Treat as a create (events can arrive out of order).
2. Map `(pipelineId, pipelineStageId)` through `stageMappings`. Unmapped → `ignored`, logged, and flagged as drift (§6.7).
3. Apply the conflict rule in §6.5. This includes recognising the echo of our own write (`operationId` / `lastSyncedStageId` match), which updates `lastSyncedAt` only and **never writes back to GHL**.
4. If accepted: update `pipelineId`, `pipelineStageId`, `unifiedStageKey`, bump `sync.version`, set `source = "ghl"`, `changedAt`, add a timeline entry, emit a socket event. **`Case.stage` is not modified.**

`ContactCreate` / `ContactUpdate` update only name, email and phone on linked cases, GHL → CRM only (§10).

### 6.4 CRM → GHL: drag and drop

`PATCH /api/cases/:caseId/pipeline-stage` with `{ unifiedStageKey, moveId }`.

1. Authorize: admin, super_admin and team_lead for any GHL case; case_manager only for their own (`applyCaseRoleFilter`).
2. Resolve the target GHL stage from the case's **own** `integrations.ghl.pipelineId` and `stageMappings`. Case A in Pipeline A gets A's stage ID, case B in Pipeline B gets B's, even when both go to the same column. The unified stage ID is **never** sent to GHL.
3. In one atomic update on the case: new `unifiedStageKey`, `pipelineStageId`, `sync.version + 1`, `source = "immiglance"`, `changedAt = now`, new `operationId`, `state = "pending"`. Then create a `GHLSyncJob` carrying that `caseSyncVersion`, and mark any older `pending` jobs for this case `superseded`.
4. **Return 200 immediately** with the updated card.
5. **Worker** (outbound):
   - **Atomic claim, mandatory:**
     `findOneAndUpdate({status:"pending", nextAttemptAt:{$lte: now}}, {status:"processing", lockedUntil: now+lease})`.
     A claimed job whose lease expires (crashed instance) is released back to `pending`. Two instances can never process the same job.
   - **Hard invariant: stale-job check immediately before the GHL call.** The worker reloads the job and the case and sends **only if** the job is still `processing` (not `superseded`) **and** `job.caseSyncVersion === case.sync.version`. Otherwise it marks the job `superseded` and sends nothing. We do not rely on the frontend serialising moves.
   - Example: user drags A→B, A→C, A→D. Jobs 1 and 2 are `superseded`, and only D ever reaches GHL.
   - **Success:** job `done`. The case is `synced` only if the version still matches, otherwise it stays `pending` for the newer job.
   - **Retryable failure** (network, 5xx, 429): exponential backoff (10s, 30s, 2m, 10m, 30m, up to about 8 attempts, honouring `Retry-After`).
   - **Permanent failure** (404, other 4xx): `sync.state = "failed"`, `flags.needsAttention`, admin alert. Reconciliation can still repair it.
6. A column the case's pipeline cannot map is refused with a clear 4xx **before** any local change is made.

The frontend never sees any of step 5, apart from the admin-only `FAILED` indicator (§9).

### 6.5 Conflict resolution (rewritten)

No rule based on "whether an outbound job happens to exist". Every stage change on a case, from either side, is recorded as `{ source, changedAt, operationId, version }`.

**Rule:**

> The most recent accepted stage change wins, **unless there is an unresolved outbound operation for the same opportunity**, in which case our pending change wins until that operation resolves.

In detail:
1. **Echo of our own write:** an inbound event whose resulting stage equals the stage of our most recent operation (`operationId`, `lastSyncedStageId`) is recorded, never applied again, and never written back.
2. **Unresolved outbound operation** (a `pending` or `processing` job for the same case at the current version): the inbound event is stored as `deferred`. When our job completes, the worker compares GHL's final state with ours:
   - GHL already holds our target → done.
   - GHL moved elsewhere **after** our `changedAt` (per GHL's own event timestamp) → GHL's change is newer and is applied.
   - Otherwise our change is sent (it is the newer one).
3. **No unresolved operation:** compare the inbound event's GHL timestamp with `sync.changedAt`. Newer wins; older is ignored (a late or reordered delivery).
4. **Reconciliation** uses exactly the same comparison, with GHL's `dateUpdated` against `sync.changedAt`. It never uses "GHL wins" or "ours wins" as a blanket default.
5. Ties on timestamps are broken by `source`: the side whose operation is currently unresolved wins, otherwise GHL.

All decisions are logged on the timeline (`stage accepted from GHL`, `stage change from GHL ignored: older than the local change`, and so on).

### 6.6 Visa type source (use GHL custom field if it exists)

1. During setup (§6.1 step 3) we **inspect the real GHL opportunity and contact custom fields**. We do not invent a field.
2. If a suitable field exists (for example `immigration_visa_type`), store its ID and a value map in `GHLIntegration.visaFieldMapping`. The factory then sets `visaType` directly and no team lead action is needed for those cases.
3. If it does not exist, or a value does not map, the case stays `visaSelectionStatus = "pending"` for the team lead.
4. Recommendation to you: if you control the GHL account, adding that custom field makes the whole flow hands-free.

### 6.7 Reconciliation, isolation and drift (every 15–30 min)

- Runs per pipeline, **independently**. If Pipeline A's fetch fails, Pipeline B still reconciles and Pipeline A is marked `degraded` with `lastFetchError`. One failing pipeline never blocks the other.
- Compares GHL opportunities with linked cases using the §6.5 rule. Missing cases are created with `origin: "reconciliation"`.
- **Deleted in GHL:** the case is **never deleted**. It gets `flags.deletedInGhl = true` and sync status flagged, and an admin is alerted. Per your standing rule, removal only ever happens by an explicit permanent-delete action.
- **Config drift:** each run (and "Refresh stages") re-reads stage definitions and compares them with `stageMappings` by **stage ID**.
  - A stage renamed ("Documents" → "Document Collection"), removed, or newly added → integration `status = "config_mismatch"`, admin alert, and affected inbound events are held, not silently mapped.
  - The admin reviews and confirms the mapping from the panel.
- Uses a lock with a lease so two instances never run it at once.
- Throttled to stay inside GHL rate limits.

---

## 7. Webhook security and reliability

- Route: `POST /api/integrations/ghl/webhooks`, **public**, raw body so the signature is verified byte-for-byte.
- Verify `X-GHL-Signature` (Ed25519, Node `crypto`). Fall back to `X-WH-Signature` only while GHL still sends it. 401 on failure.
- Reject stale timestamps (replay protection), a wrong `locationId` and unknown event types.
- **Both duplicate guards apply** (§5.2): `webhookId` dedupe on arrival, and the unique `locationId + opportunityId` index during case creation. A repeated `OpportunityCreate` with a new webhook ID is handled as an update of the existing case.
- Persist, return **200 fast**, process asynchronously through the event state machine (§5.3). Non-2xx is reserved for signature and validation failures, so our own bugs don't trigger GHL's retry storm.
- Dedicated rate limit, structured logs with no tokens or payload secrets.
- Handled events: `OpportunityCreate`, `OpportunityUpdate`, `OpportunityStageUpdate`, `OpportunityStatusUpdate`, `ContactCreate`, `ContactUpdate`.

---

## 8. API surface (new)

| Method + path | Auth | Purpose |
|---|---|---|
| `POST /api/integrations/ghl/webhooks` | signature | Inbound events |
| `GET /api/integrations/ghl/board` | admin, super_admin, team_lead, case_manager (scoped) | Unified board: columns plus cards |
| `PATCH /api/cases/:caseId/pipeline-stage` | same, scoped | Move a card |
| `GET /api/integrations/ghl/status` | admin, super_admin | Health summary (§9.3) |
| `POST /api/integrations/ghl/sync` | admin, super_admin | Initial sync / "Sync now" |
| `POST /api/integrations/ghl/refresh-stages` | admin, super_admin | Re-pull stage config, run drift check |
| `POST /api/integrations/ghl/mappings/confirm` | admin, super_admin | Confirm mappings after drift |
| `POST /api/integrations/ghl/jobs/:id/retry` | admin, super_admin | Manual retry of a failed job |
| `POST /api/integrations/ghl/events/:id/requeue` | admin, super_admin | Requeue a `dead` webhook event |

Every endpoint enforces roles. Each write adds an audit log entry, and each case change adds a timeline entry.

**Response shaping:** card payloads carry a simplified `syncStatus` of `SYNCED | PENDING | FAILED`. For roles other than admin and super_admin, `FAILED` is reported as `SYNCED`/`PENDING` and **no** operation IDs, retry counts, HTTP codes, GHL response bodies or error strings are included.

The board is one request: columns plus cards (name, email, visa type or "Visa selection required", case number, assignee, priority, internal source pipeline), paginated per column (for example 50 per column with "load more").

---

## 9. Frontend (Admin)

### 9.1 Kanban board

- New **Pipeline** page and sidebar entry for admin, super_admin, team_lead and case_manager.
- **Visibility is enforced server-side:** admin, super_admin and team_lead see all GHL cases. A case manager sees only cases assigned to them.
- `@dnd-kit` with pointer, touch and keyboard sensors and a drag overlay.
- **Optimistic update:** the card moves in local state on drop. The API call runs in the background. No spinner blocks the board.
  - Failure of the call to **our** backend: roll back with a small toast.
  - A GHL failure after our backend accepted the move is **never** shown as a rollback. The backend retries it.
- Rapid moves of one card are serialised on the client and the last drop wins, but this is only a UX nicety. Correctness comes from the backend version checks in §6.4.
- Socket events patch the board without a reload and without disturbing an in-progress drag. Echoes of our own moves are ignored via `moveId`.
- Memoised cards and per-column "load more" to avoid lag on large boards.
- Card: client name, email, visa type (or a **"Visa required"** chip), case number, assignee, priority. Clicking opens the existing case detail. The source pipeline is kept as internal metadata, a tooltip rather than prominent text.

### 9.2 Sync status visibility

- Normal users see nothing about syncing.
- Admin and super_admin see a small **"Failed to sync"** marker on a failed card, with a retry action. They don't see raw HTTP codes or response bodies on cards. Technical detail is only in the status panel.

### 9.3 Integration health panel (admin, super_admin)

```
GoHighLevel Integration
────────────────────────────────
Connection               ✓ Connected
Location                 <locationId>
Immigrant pipeline       ✓
Non-Immigrant pipeline   ✓
Stage mapping            ✓  (or ⚠ config mismatch: review)

Last webhook             2 min ago
Last reconciliation      11 min ago
Last API check           Healthy

Pending jobs             3
Failed jobs              0
Dead webhook events      0

[Sync now]  [Refresh stages]  [Review mappings]
```

---

## 10. Source of truth per field

| Data | Owner |
|---|---|
| Opportunity ID, pipeline ID, stage ID, opportunity status | GHL (stage is bidirectional) |
| Board column (`unifiedStageKey`) | Bidirectional, resolved by §6.5 |
| Name, email, phone | **Phase 1: GHL → CRM only.** CRM edits are not pushed back. |
| Case ID, case number, **visa type**, forms, checklists, questionnaires, documents, OCR, USCIS workflow, assignments, `Case.stage` | CRM only (visa may be *seeded* once from a GHL custom field, then CRM owns it) |

Contact ownership is stored as explicit per-field config (`contactFieldOwnership`). If bidirectional contact sync is wanted later, it is enabled **per field** with its own conflict rule. We will not build a generic "sync everything both ways" mechanism.

---

## 11. Phases

1. **Foundation + audit:** config, `ghlClient`, models, indexes, Case fields, env docs. Read the visa/provisioning code (§2 audit). **Read-only** GHL calls: list both pipelines, **compare stages**, inspect custom fields. *Checkpoint: I report the stage comparison, the custom-field findings and the audit results before going further.*
2. **Import:** pipeline service, mappings and drift detection, paginated fetch, "Sync now" without emails, origin tagging.
3. **Inbound webhooks:** signature, both duplicate guards, event state machine, case creation with emails, deferred visa handling, stage updates and the conflict rule.
4. **Outbound sync:** the pipeline-stage endpoint, job queue, atomic claim, version re-check, retry and supersede logic.
5. **Frontend:** Kanban page, optimistic hook, socket updates, health panel.
6. **Reconciliation, hardening, docs:** per-pipeline isolation, locks, alerts, rate limiting, `docs/GHL_INTEGRATION.md`, completion report.

Each phase is a separate commit and is switchable with `GHL_ENABLED=false`.

---

## 12. Testing

### Unit
Signature verification (valid, tampered, stale), mapping resolution per pipeline, echo/loop guard, conflict rule (every branch of §6.5), retry and backoff, supersede logic, atomic claim and lease expiry, pagination, webhook state-machine transitions.

### Integration (Mongo, GHL mocked)
Webhook create → exactly one case even when delivered twice. Same opportunity re-sent with a **different** `webhookId` → still one case (unique-index guard). Out-of-order stage-before-create. Drag sends the correct per-pipeline stage ID. GHL down → the move still succeeds locally and the job retries. Case manager scoping. Stale job is not sent after a newer drag.

### The six additional tests
1. **Same email, two opportunities:** two opportunities with `john@gmail.com` create **two** cases.
2. **Same stage name, different stage IDs:** Pipeline A "Documents" = `A123`, Pipeline B "Documents" = `B456`. Move both to Documents → A gets `A123`, B gets `B456`.
3. **GHL stage renamed:** "Documents" becomes "Document Collection" → integration goes to `config_mismatch`, an alert is raised, nothing is silently re-mapped.
4. **One pipeline unavailable:** Pipeline A's sync fails, Pipeline B keeps working. A is `degraded`.
5. **GHL opportunity deleted:** the CRM case remains and is flagged `deletedInGhl`, with sync status flagged.
6. **No visa on a GHL case:** the case is created, `visaType` is null, `visaSelectionStatus = "pending"`, and **no visa-driven checklist, form or questionnaire is provisioned**. After the team lead selects a visa, provisioning runs as it does for any other case.

### Regression
Existing case-creation tests, lead conversion, assignment, notification and email suites still pass. All four apps still build with `npm run build`. With `GHL_ENABLED=false` the app is byte-for-byte behaviourally unchanged.

### Live checks
Read-only calls against the real GHL location to confirm pipelines, stages and custom fields. Any test case, user or company I create in the shared DB is **deleted afterwards**. Any write to GHL needs your explicit OK first, since it is your real CRM.

---

## 13. Decisions still needed from you

Resolved by your review and now built into this plan: no fake visa, GHL → CRM only for contacts in Phase 1, stop on stage mismatch, no emails on historical import, `createCase` untouched.

1. **Second pipeline ID.** `.env` only has one `GHL_PIPELINE_ID`. May I list the location's pipelines and match by name ("Immigrant Documentation Pipeline", "Non-Immigrant Documentation Pipeline"), or will you give me both IDs?
2. **Webhook URL.** What public HTTPS URL will GHL call? For local testing I'd use a tunnel. May I hard-code GHL's published Ed25519 public key, or should it be an env var?
3. **Visa custom field.** I'll inspect GHL for one. If none exists, are you able to add one (`immigration_visa_type` or similar), or should every GHL case start in "Visa selection required"?
4. **Opportunity status** (won / lost / abandoned). Show it read-only on the card, or also sync it from the board?
5. **Real GHL writes during testing.** May I move a real or test opportunity in GHL to verify the outbound path, or mocks only?
6. **Emails for live GHL cases.** The plan sends the existing `case_created` client email and team lead email for live webhook-created cases. If the client template mentions a visa or portal invitation, I'll check that it reads sensibly with no visa yet, and show you the result before enabling.

---

## 14. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Breaking existing case creation | `createCase` untouched, separate factory, feature flag, regression suites |
| Wrong visa-driven provisioning | `visaType = null` + `pending` status, no provisioning until selected, test 6 |
| Duplicate cases | Unique `webhookId` **and** unique partial index on `locationId + opportunityId` |
| Infinite sync loop | `operationId` / `lastSyncedStageId` echo guard; echoes are never written back |
| Ambiguous conflicts | Version + timestamp rule (§6.5), no blanket "who wins" |
| Stale or replayed stage pushes | Hard version re-check immediately before every GHL mutation |
| Multi-instance double-processing | Atomic `findOneAndUpdate` claims with leases, reconciliation lock |
| GHL outage | UI unaffected; local state saved; jobs queue and retry; reconciliation repairs drift |
| Rate limits (429) | Backoff, `Retry-After`, throttled bulk jobs |
| One pipeline failing | Per-pipeline isolation and `degraded` status |
| GHL stage renamed or changed | Mapping by stage ID, drift detection, `config_mismatch`, no silent re-map |
| Email flood on import | Emails suppressed during initial sync |
| Leaking sync internals | Response shaping; only admins see `FAILED` |
| Token leakage | Token only in env, never logged, never sent to the frontend |
| Webhook spoofing | Ed25519 verification, timestamp and location checks |
