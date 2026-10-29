# Google Drive Integration — Architecture Audit and Implementation Plan

Status: **PLANNING ONLY. Nothing described here is implemented.** No code, schema, dependency, environment value or Google Cloud setting was changed to produce this report.
Date: 2026-10-29. Branch inspected: `refactor` (working tree has the user's uncommitted edits; they were left untouched).

Labels used throughout:

- **[Verified]** — read directly from the repository during this audit.
- **[Proposed]** — a design recommendation, not existing behaviour.
- **[TBC]** — to be confirmed; not verifiable from the repository (Google Cloud Console, production hosting, Google's current policy).

No secret value from any `.env` file is reproduced in this document. Only variable *names* appear.

---

## 1. Executive Summary

**Headline finding: a Google Drive sync already exists, and it is global, not per-organisation.** `Backend/src/modules/integrations/google-drive.service.js` pushes documents to Drive using a *static access token and root folder ID read from environment variables* (`GOOGLE_DRIVE_ACCESS_TOKEN` or `GOOGLE_API_ACCESS_TOKEN`, `GOOGLE_DRIVE_ROOT_FOLDER_ID`). It is called inline from five places in the upload, intake, OCR, workbook and PDF-generation paths. It is single-tenant, has no OAuth, no token refresh and no organisation scoping. When the env vars are absent it is a recorded no-op (`syncStatus: "not_configured"`). Any new work must coexist with it without disturbing it.

**Second finding: there is no tenant model.** "Organisation" in this codebase means the *client's employer* (`Company`, `Case.organization`, `User.companyId`). The firm itself is a singleton (`Settings` with `key: "global"`). Strict per-organisation isolation therefore has to be introduced for the new integration only, as a forward-compatible `orgId` on the new collections, without touching `Case`, `Document` or `User`.

**Recommended approach [Proposed]:**

1. Build a **separate, self-contained module** (`Backend/src/modules/google-drive/`). Do not modify the legacy service, `Document.googleDrive`, `Case.googleDrive`, or any upload/download/preview code path.
2. Per-organisation OAuth (authorization-code, `access_type=offline`) on the **existing Google OAuth client**, with a **new, dedicated callback** and server-side single-use state, kept fully separate from the login flow.
3. Scope: **`drive.file`** (non-restricted). It cannot browse arbitrary existing Drive content. The default folder strategy is therefore an **app-created root folder** (always accessible under `drive.file`); picking an *existing* folder with Google Picker is optional and must pass a verification spike first (§7). No broader scope is chosen without an explicit decision.
4. New collections only (`GoogleDriveConnection`, `GoogleDriveFolderMap`, `GoogleDriveFileLink`, `GoogleDriveSyncJob`, `GoogleDriveSyncItem`, `GoogleDriveOAuthState`). Refresh tokens encrypted with AES-256-GCM using a **new dedicated key**.
5. Bulk sync as a **Mongo-backed job queue with atomic claim + lease + backoff**, following the existing GHL/form-pipeline pattern. Redis is optional in this deployment and BullMQ is installed but unused, so BullMQ is not recommended.
6. Idempotency through **pre-generated Drive file IDs** (`files.generateIds`) persisted *before* upload, plus a single-flight unique index per document.
7. UI in **Admin only** (Settings → Integrations → Google Drive, plus a case-level "Sync to Google Drive" action). No Drive UI in Client, Landing or Attorney.
8. Everything behind a feature flag, **default off**, with sync being an **explicit user action only** (no automatic hook into uploads) until separately approved.

**Your standing rule — "must not break current functionality"** is treated as a hard invariant, not a goal. §8.1 lists the non-interference guarantees and §16 the regression gates that block release.

**Decisions needed before Phase 3 are listed in §18.** The most consequential: scope (`drive.file` vs. broader), same OAuth client vs. new one, and what to do with the legacy sync.

---

## 2. Existing Architecture Findings

| Area | Finding | Evidence |
|---|---|---|
| Repo layout | `Backend/`, `Admin/frontend/`, `Immiglance/Landing/`, `Immiglance/Client/`, `Attorney/` | [Verified] `AGENTS.md`, directory listing |
| Backend | Node/Express, Mongoose; modules under `Backend/src/modules/*`; routes mounted in `Backend/src/routes/index.js` (e.g. `router.use("/calendar", …)` line 78, GHL at `/integrations/ghl` line 93) | [Verified] |
| Auth transport | **Bearer token in `Authorization` header only** (`middleware/authenticate.js` rejects anything not `Bearer …`) | [Verified] |
| Mongo index policy | `autoIndex` is **off** unless `MONGO_AUTO_INDEX=true`, and `autoCreate` is also disabled (`config/database.js` ~112-146). New collections' indexes will **not** be created automatically. | [Verified] |
| Index pressure | `docs/GHL_INTEGRATION.md` states the `cases` collection "has no free index slots". **No index may be added to `cases` or `documents`.** | [Verified] |
| Background work | (a) `setInterval` workers wrapped in `withJobLock` (`utils/jobLock.js`, `models/JobLock.js`) started from `server.js`; (b) Mongo-backed queues with atomic claim/lease/backoff: `GHLSyncJob` + `integrations/ghl/ghlWorkers.js` (started at `server.js:284`, cleared at :327), `FormPipelineJob`, `DocumentProcessingJob`; (c) a standalone-process worker precedent: `workers/formPipelineWorker.js` (`FORM_PIPELINE_WORKER=external`) | [Verified] |
| Redis/BullMQ | `bullmq` and `ioredis` are in `Backend/package.json`; `config/redis.js` is used only as an optional auth-user cache with in-memory fallback; **no `new Queue`/`new Worker` exists anywhere in `src`** | [Verified] |
| Rate limiting | Global `express-rate-limit` in `app.js:63`; per-route limiters in several modules (consultation, leads, payments, petition-review) | [Verified] |
| Audit | `modules/audit/audit.service.js#recordAuditEvent({req, action, entityType, entityId, details, severity, status, source, metadata})` writing `AuditLog`; documents have their own `writeAuditLog` that swallows errors | [Verified] |
| Realtime | `realtime/caseLiveUpdates.notifyCaseDataChanged` is called after document create/version/audit so Client, Admin and Attorney sessions re-read documents | [Verified] `document.service.js` `announceDocumentChange` |
| Test conventions | Backend: `node --test` (`npm test` is **not** safe — it hits the real DB); `npm run test:safe` (`src/scripts/runSafeTests.js`) is the project's safe runner. Admin frontend uses `*.test.jsx` | [Verified] / project rule |
| CI | `.github/workflows/inszoom-cicd.yml` builds Landing, Client, Attorney, Admin and Backend on every push; `VITE_*` values come from repository `vars` | [Verified] |
| Production process manager / hosting | Not defined in the repo (the form-pipeline worker comment references PM2 as a *proposal*) | **[TBC]** |

### 2.1 Existing defects and gaps noticed (reported, **not** to be fixed in this work)

1. `GOOGLE_DRIVE_SCOPES` appears in `Backend/.env.example` (line 39) but **no code reads it** (no match in `src`, `config/env.js` does not reference it). It currently does nothing.
2. The legacy Drive service reads `GOOGLE_DRIVE_ACCESS_TOKEN`, `GOOGLE_API_ACCESS_TOKEN`, `GOOGLE_DRIVE_ROOT_FOLDER_ID`, `GOOGLE_DRIVE_MAX_ATTEMPTS`, `GOOGLE_DRIVE_MAX_RETRY_DELAY_MS` straight from `process.env`, bypassing `config/env.js`, and none are in `.env.example`.
3. A static Google access token expires in about an hour, so the legacy sync can only work with a manually refreshed token. It cannot be a production design.
4. Legacy `createFolder` is find-then-create by **name** (`findFolder` → `createFolder`), which races under concurrency and creates duplicate folders.
5. Legacy `driveFetch` does `JSON.parse(bodyText)` unguarded; a non-JSON error body (e.g. an HTML 502) throws a `SyntaxError` instead of a Drive error.
6. Legacy `syncDocument` increments `attempts` in two places and saves the document on every failed attempt. When not configured it still **writes** `googleDrive.syncStatus = "not_configured"` to the document and case on each call, i.e. extra writes on the upload hot path. `docs/BACKEND_PERFORMANCE_ROOT_CAUSE_AUDIT.md` (line ~709) already lists it as "confirmed on critical path".
7. `storageService.readBuffer` and `documentService.readDocumentBuffer` load the **whole file into memory**; there is no stream API. Acceptable at the default 10 MB upload cap (`MAX_UPLOAD_SIZE_BYTES`), a problem if the cap is raised.
8. `VITE_GOOGLE_PICKER_API_KEY`, `VITE_GOOGLE_OAUTH_CLIENT_ID`, `VITE_GOOGLE_CLOUD_PROJECT_NUMBER` exist **only in `Admin/frontend/.env`** — not in `.env.example`, `.env.development` or `.env.production`, and not passed in the CI workflow. A production build would not have them. No source file references them yet.
9. `CalendarIntegration` has `accessTokenEncrypted` / `refreshTokenEncrypted` fields, but **no token-encryption helper was found** (the controller only excludes the fields from reads). There is no reusable secret-encryption utility to build on.
10. `google-token` login (`auth.controller.js` `googleToken`) is a stub that returns "temporarily unavailable" (Firebase verifier removed). Unrelated to this work; not to be touched.

---

## 3. Existing Google Authentication Findings

**Login flow [Verified]** — `Backend/src/modules/auth/google-oauth.service.js` + `auth.controller.js`:

- One `OAuth2Client` from **`google-auth-library` ^10.7.0** (already installed). `googleapis` is **not** installed.
- Credentials read via `config/env.js` → `env.google.{oauthClientId, oauthClientSecret, oauthRedirectUri, oauthConfigured, oauthRedirectUriSafe}`. Default redirect (non-production only): `http://localhost:7000/api/auth/google/callback`.
- Routes: `GET /api/auth/google` (start, unauthenticated full-page redirect) and `GET /api/auth/google/callback` (`auth.routes.js` lines 73-74).
- Scopes: `openid email profile`; `access_type: "online"`; `prompt: "select_account"`. **No refresh token is requested or stored.**
- CSRF: random 24-byte `state`, set in cookie `google_oauth_state`, path `/api/auth/google`, 5-minute max-age; callback compares query `state` to the cookie and clears it.
- Production guard: if `clientUrlSafe` or `oauthRedirectUriSafe` is false, the flow is blocked (`auth.controller.js` ~183).
- The auth model is Bearer-token based, so the callback is an anonymous browser navigation. After a successful login it redirects to Landing's `/auth/callback` (a hard-coded URL dependency noted in `docs/REPOSITORY_REARCHITECTURE_IMPLEMENTATION.md` M-6).
- The login path is covered by `modules/auth/auth.security.test.js`.

**Can Drive authorisation be separated from login safely? Yes.** Reasons:

- Different scopes, different grant type (offline vs. online), different callback, different state store, different cookie path. Nothing in the login code needs to change.
- The login state cookie is scoped to `/api/auth/google`; a Drive callback under `/api/integrations/google-drive/…` cannot read or clobber it.
- **Existing Google login must remain byte-for-byte unchanged.** `google-oauth.service.js` and the `googleOAuth*` handlers are not to be edited. The Drive module builds its **own** `OAuth2Client` instance (same package, same client id/secret, different redirect URI) rather than extending the login service.

**Why the Drive connect flow cannot copy the login flow's design [Verified reasoning]:** login's `GET` redirect start has no user identity, and its callback only needs to *establish* identity. Drive connect must bind the grant to a specific authenticated organisation admin, but the callback arrives as an anonymous browser navigation (no `Authorization` header). So the start must be an **authenticated XHR** that records `(orgId, userId, nonce)` server-side and returns the Google URL; the callback is then authorised **only by the single-use state record** (§14.1).

**Redirect URI handling [Proposed]:** add a *new* exact URI to the *same* OAuth client in Google Cloud Console, e.g. `https://<api-host>/api/integrations/google-drive/callback`, and a new env var `GOOGLE_DRIVE_OAUTH_REDIRECT_URI` validated with the same `isUnsafeOrigin` production rule as the login redirect. The existing `GOOGLE_OAUTH_REDIRECT_URI` is not reused or altered. Google requires an exact match. **[TBC]** the actual list of URIs registered in the Cloud Console (not visible from the repo).

**Reuse of credentials:** reusing `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` is technically appropriate (one OAuth client may have several redirect URIs and scopes are per-request). Trade-off and the alternative of a second dedicated client are in §7 and §18 (decision D2).

**Incremental authorization:** the Drive request must **not** set `include_granted_scopes=true`, so the Drive grant never bundles with, or alters, a user's login grant.

---

## 4. Existing Document Lifecycle

### 4.1 Upload and storage [Verified]

- Routes (`modules/documents/document.routes.js`): single upload (`POST /`, `/upload`, `/me`, `/user/:userId`), `POST /bulk-upload` (up to 25 files), resumable chunked sessions (`/uploads/sessions…`), versions (`POST /:id/versions`), restore.
- `documentService.createDocumentFromFile` (`document.service.js:367`) stores bytes through `storageService.storeBuffer` under a key from `generateDocumentKey`.
- `modules/uploads/storage.service.js`: provider `s3` or `local` (`env.storage.provider`). On S3, SSE is applied on every PutObject. App-level AES-256-GCM envelope (`ICRMENC1` header) applies to **new writes** only when `STORAGE_ENCRYPTION_KEY` is set and `STORAGE_APP_ENCRYPTION` is not `off`; `readBuffer` transparently decrypts either form.
- Upload size cap default 10 MB (`MAX_UPLOAD_SIZE_BYTES` / `MAX_FILE_SIZE`).

### 4.2 Document record (`models/Document.js`) [Verified]

Relevant fields: `caseId` (indexed), `companyId`, `storageKey`, `filePath` (legacy), `checksum` (sha256 from `storageService.checksum`), `versions[]` (each with `version`, `storageKey`, `checksum`, `size`), `currentVersion`, `documentType`, `category`, `status` (review status), `uploadedBy` (role enum), `uploadedByUser`, `deletedAt`/`deletedBy` (soft delete), `shares[]`, `visibility` (`internal|client`, inside a sub-schema — **[TBC]** which sub-schema), and the **legacy** `googleDrive{syncStatus,fileId,folderId,folderPath,webViewLink,attempts,…}` block.

### 4.3 Read / download / preview [Verified]

`GET /:id/download|preview|content` → `findAccessibleDocument` → `canAccessDocument(user, doc)` (`document.service.js:75`): super_admin/admin always; owner/uploader; client/beneficiary refs; unexpired shares; employer by `companyId`; otherwise **case access via `caseService.canAccessCase`** (which covers team lead, case manager assignment, attorney via `Case.attorneyAccess[]`, restricted portal roles). Bytes come from `documentService.readDocumentBuffer` → `storageService.readBuffer` (with retries; special cache for `petition_manual_upload`).

Lists are filtered by `buildDocumentFilter`, which also applies the **petition release gate** (`petition-review/petitionGate.listCondition`): an unreleased petition upload must never be visible to a viewer. **The sync eligibility rules must reuse this gate.**

`POST /bulk-download` only returns *metadata and URLs*; there is no server-side zip, so there is no existing bulk-read pipeline to reuse.

### 4.4 Delete / retention [Verified]

`DELETE /:id` is a soft delete (`deletedAt`). Whole-case deletion goes through the recycle bin (30-day, `RecycleBinEntry`; project convention: real hard delete only via explicit action). The Drive integration must never infer a Drive delete from either.

### 4.5 Where the legacy Drive sync is invoked [Verified]

| Caller | File |
|---|---|
| After client intake submission (`runPostClientSubmission` → `syncDocumentsToDrive`) | `modules/cases/case-workflow-automation.service.js:38,100` (reached from `client-intake.service.js`, `PDFGenerationService.js:363`) |
| After OCR/extraction | `modules/document-intelligence/services/document-intelligence.service.js:208-236` |
| Case data workbook | `modules/document-intelligence/services/case-workbook.service.js:253` |
| Generated USCIS PDFs | `modules/form-generation/services/PDFGenerationService.js:261` |
| Petition Word package | `modules/form-generation/services/PetitionWordPackageService.js:192` |

**These are the code paths that must not regress.** Their failure handling is already defensive (try/catch, `recordAutomationIssue`); the new module will not alter them.

### 4.6 Canonical source of truth

Immiglance/S3 (`Document.storageKey`, `versions[]`, `checksum`) remains the source of truth. Drive is a **one-way, additive copy**. No Drive → Immiglance sync is proposed.

---

## 5. Organisation and Tenant Isolation Findings

| Question | Finding |
|---|---|
| How are organisations represented? | **They are not**, in the tenant sense. `Company` = the client's employer. `Case.organization` (ref `Company`), `User.companyId`, `Document.companyId` all point at employer companies. `Settings` is a singleton (`key: "global"`) holding firm identity (`msoEntityName`, `lawFirmEntityName`, `activeBrand`, `brandTokens` "feeds future white-label"). `Team` and `Branch` are display/grouping only. |
| Is an org id on users/cases/documents? | No firm/tenant id on any of them. |
| Tenant isolation in queries? | None needed today; access is by role + per-case relationship (`canAccessCase`, `canAccessDocument`). Admin and Team Lead see all cases system-wide. |
| Separate DBs or shared + identifier? | One shared database (`AGENTS.md`: "Both portals use the same MongoDB database"). Multi-org is not implemented; **[TBC]** whether/when it is planned. |
| Role representation | `permissions.registry.js`: `super_admin`, `admin` (`settings:*`), `team_lead`, `case_manager`, `attorney`, `client`, `employer`, `employee`, `beneficiary`, … The `settings` resource already defines a **`manage_integrations`** action (held by admin via `settings:*`; **not** granted to case_manager or team_lead). |

**Design consequence [Proposed]:**

- Every new collection carries a required `orgId`. Until multi-org exists, `resolveOrgId(user)` returns a single constant default org id (one function, one place to change later).
- **Do not** add `orgId` to `Case`, `Document` or `User` in this work (index pressure, risk, scope). The mapping collections hold the join.
- Every new endpoint derives `orgId` from the authenticated user **server-side**; no endpoint accepts `orgId` from the client. Every query on the new collections includes `orgId`.
- The word "organisation" collides with `Company`/`Case.organization`. In code and API the new concept is named **`orgId` / "workspace"**, never `organization`, to avoid someone joining Drive state to employer companies by mistake.

---

## 6. Business Requirements and Assumptions

### 6.1 Requirements (from the brief)

A. Each organisation connects its own Google account. B. Choose or create destination folders (store folder IDs). C. Bulk-sync case documents asynchronously with progress, partial-failure reporting and retry. D. Repeat sync updates linked files in place; no silent overwrite of unlinked same-name files. E. Configurable folder structure. Plus: strict tenant isolation, least privilege, and **no regression** in existing flows.

### 6.2 Assumptions (all open to correction)

| # | Assumption | Status |
|---|---|---|
| A1 | One Google account per organisation initially (a shared firm account, not per-user accounts) | Proposed; decision D5 |
| A2 | Sync is **one-way** Immiglance → Drive, user-initiated | Proposed |
| A3 | Drive is not the source of truth; Drive edits are not read back | Proposed |
| A4 | Single organisation today; schema is org-ready | Verified (single-tenant) |
| A5 | Files up to the current upload cap (10 MB default) dominate; larger files supported via resumable upload | Verified cap / Proposed handling |
| A6 | Syncing client documents (PII) to the firm's own Google account is acceptable to the firm and its clients | **[TBC]** — a legal/privacy decision, see §14.9 |
| A7 | The legacy env-token sync is either unused in production or will be retired later | **[TBC]** whether it is configured in production; decision D3 |

---

## 7. Google Cloud Configuration and OAuth Scope Decision

### 7.1 What is configured today

[Verified, names only] Backend: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_OAUTH_REDIRECT_URI` (all consumed by login); `GOOGLE_DRIVE_SCOPES` (in `.env.example` only, consumed by nothing). Frontend: three `VITE_GOOGLE_*` variables, `Admin/frontend/.env` only, consumed by nothing. Adding a scope to `.env` or enabling an API in the Console **does not** make the app request it: the backend must pass it to `generateAuthUrl`. **[TBC]** Drive API enabled, Picker API enabled, API key restrictions, consent-screen publishing status, registered redirect URIs.

### 7.2 Scope analysis (`drive.file` vs alternatives)

| Scope | Class (per Google's scope table — **[TBC]** re-check in the Console during Phase 2) | What the app can do | Verification burden |
|---|---|---|---|
| `https://www.googleapis.com/auth/drive.file` | Non-sensitive | Create files/folders; read/update **only files the app created or the user explicitly opened/selected with Picker** | Brand verification only |
| `…/auth/drive.appdata` | Non-sensitive | Hidden app-private folder; not user-visible | Not suitable (users must see the files) |
| `…/auth/drive.readonly`, `…/auth/drive.metadata*` | Restricted | Read/list everything | Restricted-scope verification + annual third-party security assessment |
| `…/auth/drive` | Restricted | Full access to all Drive content | Same as above; also a much larger blast radius if a refresh token leaks |

**`drive.file` limitations for this product (must be designed around, not assumed away):**

1. **Cannot browse the user's Drive.** The backend cannot list "all folders"; `files.list` returns only app-created or user-selected items. A "browse my Drive and pick a subfolder" tree is **not possible** with `drive.file`.
2. **Existing folders** are accessible only if the user selects them in Picker (granting the app access to that item). Children of a picked folder that the app did not create are **not** visible, so the app cannot detect pre-existing same-name files in it. Creating new files/folders inside a picked folder is expected to work **[TBC — must be proven in the Phase 2 spike]**.
3. **Nested existing folders** each need their own pick.
4. **Pre-existing files** are untouchable unless picked. This is a safety feature here: the app **cannot** overwrite a file it does not know about.
5. **Shared Drives:** `supportsAllDrives=true` on every call is required; whether a Picker-selected Shared Drive folder yields write access under `drive.file` depends on the user's role in that Shared Drive **[TBC — spike]**.
6. **App identity for Picker grants:** `drive.file` item grants are per *app* (Cloud project / OAuth client). A folder picked in the browser benefits the backend's token only if the Picker is initialised with the **same project** (`setAppId(<project number>)`) and the token belongs to the **same OAuth client**. **This is the single biggest technical risk** and the first thing the spike must prove.

### 7.3 Recommendation (not a silent choice — see decision D1)

**Use `drive.file` only.** Plus `openid email` to record the connected account's email. Folder strategy:

- **Default (certain to work): app-created root folder.** The backend creates `Immiglance` (name configurable) in the connected account's My Drive. App-created items are always accessible. Everything else is created underneath it. Users can rename/move the folder in Drive; the stored folder **ID** keeps working.
- **Optional (gated on spike): "Use an existing folder"** via Google Picker. The browser needs a short-lived access token. Recommended: the backend mints it from the stored refresh token via an authenticated endpoint (`POST /api/integrations/google-drive/picker-token`), so the grant belongs to the same OAuth client and no second consent is needed. Only the **short-lived access token** reaches the browser; the refresh token and client secret never do. Picker's `setDeveloperKey` (`VITE_GOOGLE_PICKER_API_KEY`) and `setAppId` (`VITE_GOOGLE_CLOUD_PROJECT_NUMBER`) are public browser configuration. `VITE_GOOGLE_OAUTH_CLIENT_ID` would be **unnecessary** with this design (it is needed only if the browser runs its own Google Identity Services token flow — which would create a *second, separate* consent and is not recommended).
- **Why not the broader `drive` scope:** restricted-scope verification plus a security assessment for an app that stores immigration-client PII on its servers, and a leaked refresh token would expose the firm's *entire* Drive. It only buys "browse everything". If the business insists on browsing arbitrary folders, that is a conscious upgrade decision (D1) with a re-consent for existing connections, not something to slide into.

### 7.4 Google Cloud checklist for the person with Console access (not executed here)

- Add the new Drive redirect URI exactly (§3). Do **not** remove the login URI.
- Consent screen: confirm User Type, publishing status. **If the app is in "Testing", refresh tokens expire after 7 days** (a connection would silently break weekly) — must be "In production" for real use **[TBC]**.
- Confirm the scope list on the consent screen includes only `drive.file`, `openid`, `email` (+ `profile` already used for login).
- Picker API enabled; the API key restricted to **HTTP referrers = the Admin origin(s)** and to **Picker API only** (add Drive API only if shown to be required). An API key identifies a project; it is never an authorisation credential for private files.
- If Picker is used, no extra "Authorized JavaScript origins" are needed in the backend-minted-token design **[TBC]**.
- Separate OAuth clients/projects for dev/staging/production so tests never touch the production consent screen (decision D2).

---

## 8. Proposed Architecture

```
Admin UI (Settings → Integrations → Google Drive; Case → Sync to Drive)
        │  Bearer-authenticated XHR only
        ▼
/api/integrations/google-drive/*   (feature-flagged router, org-scoped, RBAC)
        │
        ├── connection.service   OAuth start/callback, token vault, status, disconnect
        ├── drive.client         thin fetch wrapper (google-auth-library for tokens; no new dependency)
        ├── folder.service       root + per-case folder resolution (single-flight)
        ├── eligibility.service  reuses canAccessCase / canAccessDocument / petition gate
        ├── sync.service         create job + items (fast, no Drive calls)
        └── sync.worker          claims items, reads from S3, uploads, writes links
                │
                ├──► storageService.readBuffer / documentService.readDocumentBuffer   (READ ONLY)
                └──► Google Drive REST v3 (files.create / update / get / generateIds, about.get)
Mongo (new collections only): GoogleDriveConnection, …FolderMap, …FileLink, …SyncJob, …SyncItem, …OAuthState
```

### 8.1 Non-interference guarantees (the "do not break anything" contract)

| # | Guarantee | How it is enforced |
|---|---|---|
| N1 | No edits to `google-oauth.service.js`, the `googleOAuth*` handlers, or login routes | Code review gate; login tests must pass unchanged |
| N2 | No edits to upload, download, preview, versioning, chunked upload, `storage.service.js`, `document.service.js`, `document.controller.js` | New module only *calls* read functions; diff gate: those files absent from the change set |
| N3 | No schema changes to `Document`, `Case`, `User`; **no new indexes on `cases`/`documents`** | New collections only |
| N4 | The legacy `google-drive.service.js` and its five callers are untouched | Characterisation tests added *before* anything else (Phase 1) and run in CI |
| N5 | New code never runs in an HTTP request that is unrelated to the Drive feature, and never throws into one | No hooks into upload/intake/OCR paths. Sync is an explicit user action → job → worker. |
| N6 | Feature flag `GOOGLE_DRIVE_INTEGRATION_ENABLED` **default false**: routes not mounted, worker not started, UI hidden; behaviour identical to today | Same pattern as `GHL_ENABLED` |
| N7 | Worker failures are contained: all worker bodies in try/catch, logged, never crash the process; lease-based so a crash recovers | GHL worker pattern |
| N8 | Worker load is capped (concurrency, pacing) so it cannot starve the API event loop; option to run it as a separate process (precedent: `workers/formPipelineWorker.js`) | Config + Phase 11 decision |
| N9 | Client ↔ Admin document sync (shared Mongo + `notifyCaseDataChanged`) is read-only to the new module — it never writes `Document` | Test: Document collection unchanged after a sync (§16) |
| N10 | Index creation is an explicit, reviewable script (autoIndex is off), run only for the new collections | Phase 3 script, modelled on `indexes:case-list` |

### 8.2 Legacy sync coexistence [Proposed]

- The new system **never reads or writes** `Document.googleDrive` / `Case.googleDrive`. The two systems are independent; the new `GoogleDriveFileLink` is authoritative for the new integration.
- **Risk of double-sync:** if production has both the legacy env vars *and* a new connection, a document could be copied to two destinations. Mitigation: a startup log warning and a status-endpoint banner when both are active; decision D3 chooses the long-term outcome: **(a)** leave legacy permanently as-is, **(b)** retire legacy after the new system is proven (separate, later approval; remove env vars, keep fields), or **(c)** re-point the five legacy call sites to enqueue into the new queue behind a flag. Option (c) touches the hot paths and is explicitly **out of scope** until approved.
- Recommended default: **(a) now, (b) later.**

### 8.3 Worker placement

Start in-process like the GHL workers (`server.js`), concurrency 2 per process, but write the worker so it can run via a standalone entry (`workers/googleDriveWorker.js`) with `GOOGLE_DRIVE_WORKER=external`, mirroring the form-pipeline precedent. Whether production runs a second process is **[TBC]** (hosting not in repo).

---

## 9. Database Model Design

All are **new** collections. `orgId` required on all; every unique index includes `orgId`. Indexes must be created by an explicit script (§8.1 N10). Field names are proposals.

### 9.1 `GoogleDriveConnection` — one per org (v1)

| Field | Notes |
|---|---|
| `orgId` | unique |
| `status` | `connected` \| `reconnect_required` \| `disconnected` \| `error` |
| `googleAccountId` (Google `sub`), `googleAccountEmail` | display + detect account switch |
| `grantedScopes[]` | verified at callback; must include `drive.file` |
| `refreshTokenEnc` | `{ ct, iv, tag, keyVersion }` AES-256-GCM, `select:false` |
| `rootFolder` | `{ id, name, webViewLink, createdByApp, pickedViaPicker }` |
| `folderConfig` | structure template, category mapping, `conflictPolicy` default, `syncRenames` |
| `connectedBy`, `connectedAt`, `lastRefreshAt`, `lastSuccessfulSyncAt` | |
| `lastError` | `{ code, message (sanitised), at }` |

Access tokens are **not persisted**; they live in a short in-memory cache with single-flight refresh per org. Retention: removed on explicit "Disconnect and forget"; otherwise kept (status `disconnected`, token deleted).
Encryption: **new** `GOOGLE_TOKEN_ENCRYPTION_KEY` (32-byte, base64) with `keyVersion` for rotation. Deliberately **not** reusing `STORAGE_ENCRYPTION_KEY` (different blast radius and rotation cadence; storage key must stay set for decrypting old objects). A small `secretBox` util is new (no reusable one exists — §2.1 #9).

### 9.2 `GoogleDriveFolderMap` — logical path → Drive folder ID

`orgId`, `caseId?` (null for root), `pathKey` (stable logical key, e.g. `case:<id>` or `case:<id>/cat:identity`), `driveFolderId`, `parentDriveFolderId`, `name`, `status` (`creating` \| `ready` \| `missing` \| `inaccessible`), `leaseUntil`.
Unique: `{orgId, pathKey}`. Idempotency: claim-by-insert (§12.3).

### 9.3 `GoogleDriveFileLink` — Immiglance document ↔ Drive file

`orgId`, `documentId`, `caseId`, `driveFileId`, `driveFolderId`, `driveName`, `sourceVersion` (`Document.currentVersion`), `sourceChecksum` (sha256), `driveMd5`, `driveSize`, `linkStatus` (`pending` \| `linked` \| `conflict` \| `missing_in_drive` \| `trashed_in_drive` \| `source_removed` \| `unlinked` \| `error`), `lastSyncedAt`, `lastJobId`, `lastError`.
Unique: `{orgId, documentId}` and sparse unique `{orgId, driveFileId}`. Drive-side: every created file carries `appProperties { immiglanceDoc: <documentId>, immiglanceOrg: <orgId> }` (enables crash recovery and conflict classification).

### 9.4 `GoogleDriveSyncJob`

`orgId`, `requestedBy`, `scope {caseIds[], documentIds[]}`, `options`, `idempotencyKey`, `status` (`queued` \| `running` \| `paused_reconnect` \| `completed` \| `completed_with_errors` \| `failed` \| `cancelled`), `counts {total, pending, synced, skippedUnchanged, skippedIneligible, conflict, failed}`, `startedAt`, `finishedAt`, `createdAt`.
Unique: `{orgId, idempotencyKey}`. Retention: TTL 90 days after finish (matches `auditLogRetentionDays` default; **[TBC]** policy).

### 9.5 `GoogleDriveSyncItem` — per-document result (separate collection to avoid unbounded sub-array growth)

`orgId`, `jobId`, `documentId`, `caseId`, `sourceVersion`, `status` (`pending` \| `uploading` \| `synced` \| `skipped_unchanged` \| `skipped_ineligible` \| `conflict` \| `failed` \| `permanent_failed` \| `cancelled`), `reason`, `attempts`, `nextAttemptAt`, `lockedUntil`, `preassignedDriveFileId`, `driveFileId`, `errorCode`, `errorMessage` (sanitised).
Unique: `{jobId, documentId}`. **Single-flight:** partial unique `{orgId, documentId}` where `status ∈ {pending, uploading}` — two jobs can never process the same document concurrently. Worker query index: `{status, nextAttemptAt}`.

### 9.6 `GoogleDriveOAuthState`

`stateHash` (SHA-256 of the nonce; raw nonce never stored), `orgId`, `userId`, `codeVerifier` (PKCE, encrypted or hashed per design), `createdAt` (TTL 10 min), `usedAt`. Single use.

### 9.7 Audit

Reuse `recordAuditEvent` with `entityType: "google_drive"`: `connect_started|connected|connect_failed|disconnected|folder_configured|sync_started|sync_completed|sync_item_failed|conflict_resolved|retry_requested`. `metadata` carries IDs/counts only — never tokens, never document contents. **[TBC]** `AuditLog` accepts arbitrary `entityType` strings (the schema shows `entityType: {type:String, required:true}`, no enum seen).

---

## 10. API Endpoint Design

Mounted at `/api/integrations/google-drive` (follows `/integrations/ghl`). All endpoints: `authenticate` → flag check → `authorizeRoles` + `authorizePermissions` → org resolved from the user. These are **proposals**.

| Method & path | Purpose | Roles / permission (default) |
|---|---|---|
| `GET /status` | Connection state, account email, root folder, last sync, last error, legacy-sync warning | admin, super_admin (`settings:manage_integrations`); read-only subset for case_manager/team_lead (`settings:view`) so they can see whether syncing is available |
| `POST /connect/start` | Create state record; return `{authUrl}` | `settings:manage_integrations` |
| `GET /callback` | Google redirect target. **No Bearer** — authorised solely by the single-use state record + cookie nonce; then 302 to the Admin settings URL with a short status code | public, strictly validated, rate-limited |
| `POST /disconnect` | Revoke at Google, delete token, keep maps | `settings:manage_integrations` |
| `POST /reconnect` | Same as `connect/start` with `login_hint` | `settings:manage_integrations` |
| `POST /picker-token` | Short-lived access token for Picker (optional feature) | `settings:manage_integrations`; no-store; rate-limited |
| `POST /folders/root` | Create the app root folder (or register a Picker-selected folder ID after server-side validation with `files.get`) | `settings:manage_integrations` |
| `GET /folders/children` | List **app-visible** child folders of a parent (limited by `drive.file`) | same |
| `PUT /config` | Save structure template, category mapping, default conflict policy | same |
| `GET /cases/:caseId/links` | Per-document Drive status for a case | case access (`canAccessCase`) + `documents:read`; staff roles only |
| `POST /sync` | Body `{caseIds[] \| documentIds[], options, idempotencyKey}` → `202 {jobId}` | `documents:read` + staff roles (super_admin, admin, team_lead, case_manager) + per-case `canAccessCase` |
| `GET /jobs`, `GET /jobs/:id` | History; progress (counts + paginated items) | creator or admin; org-scoped |
| `POST /jobs/:id/retry-failed` | Re-queue only retryable failed items of this job | creator or admin |
| `POST /jobs/:id/cancel` | Stop claiming new items | creator or admin |
| `POST /conflicts/:itemId/resolve` | `{action: skip \| upload_copy \| link_and_replace, confirm}` | admin / team_lead / case_manager with case access |

Not exposed to: `client`, `employer`, `employee`, `beneficiary`, `attorney`. Responses never include token material; `driveFileId`/`webViewLink` only for staff.

---

## 11. Frontend UX and Permissions

### 11.1 Where it lives [Verified structure / Proposed placement]

- **Admin only.** `Admin/frontend/src/App.jsx` routes `settings` to `pages/Settings.jsx` under `ProtectedRoute module="settings"`; settings panels live in `components/settings/` (`CategoryPage.jsx`, `TeamsPanel.jsx`, `BranchesPanel.jsx`, …). The old `integrations` settings category was deleted in the "Settings Overhaul" (`settings/registry/index.js` header comment), so Integrations is **not** an existing tab; the placement of the GHL admin UI **[TBC]**.
- Add **Settings → Integrations → Google Drive** (new panel component) and a **case-level action** on the case Documents area in `pages/CRMCaseDetail.jsx`. Note `CRMCaseDetail.jsx` and `CRMCases.jsx` currently carry the user's **uncommitted edits**; changes there must be small, additive and coordinated, never overwritten.
- **No Drive UI** in Landing, Client or Attorney. Attorneys and clients never see Drive state.
- Use the existing `services/api.js` client and the Admin theme (Tailwind + existing context). Dark-theme token details **[TBC]** — match existing panels; no unrelated UI changes.

### 11.2 Screens

1. **Connection card:** states *Not connected* / *Connected (email, since, last sync)* / *Reconnect required (revoked or expired — one-click reconnect)* / *Error*. Buttons: Connect, Reconnect, Disconnect (confirm dialog explaining files already in Drive are **not** deleted). Banner if the legacy env sync is also active.
2. **Destination:** "Create Immiglance folder" (default) and, if enabled, "Choose existing folder" (Picker). Shows folder name + "Open in Drive" link; stores the ID.
3. **Folder structure:** ordered segment builder from tokens (`{caseNumber}`, `{clientName}`, `{category}`), live preview, default `Root / {caseNumber} - {clientName} / {category}`. Category mapping table (reuses the legacy category intent: Passport, Education, Employment, Immigration, Evidence, Generated Documents, Petitions, USCIS Forms, Letters).
4. **Case → "Sync to Google Drive":** modal listing eligible / already-synced / ineligible counts with reasons, estimated size, confirmation when > 50 files, "Re-sync changed only" (default) vs "Force re-upload".
5. **Progress drawer:** overall bar; counts (pending, synced, skipped, conflict, failed); per-document rows with status and error text; actions *Retry failed*, *Cancel*, *Resolve conflict*, *Open in Drive*. Polls `GET /jobs/:id` every 2–3 s while open; optional realtime reuse later.
6. **Conflict dialog:** shows Drive file name/modified time; choices Skip / Upload as separate copy / Link and replace (typed confirmation; notes Drive keeps the previous revision).
7. **History:** last N jobs with who/when/result.
8. Per-document Drive badge on the case document list, read from `/cases/:caseId/links` — **never** from the legacy `document.googleDrive`.

### 11.3 Roles (defaults; validate against the matrix)

| Action | super_admin | admin | team_lead | case_manager | attorney / client / employer / employee / beneficiary |
|---|---|---|---|---|---|
| Connect / disconnect / change account | ✔ | ✔ | — | — | — |
| Configure folder + structure | ✔ | ✔ | — | — | — |
| View connection status | ✔ | ✔ | ✔ | ✔ | — |
| Start sync for a case | ✔ | ✔ | ✔ | ✔ (own cases via `canAccessCase`) | — |
| Resolve conflicts / retry | ✔ | ✔ | ✔ | ✔ (own cases) | — |

Uses existing permission strings (`settings:manage_integrations`, `documents:read`); a dedicated `google_drive:*` resource is optional and would touch `permissions.registry.js` + its tests (decision D6).

---

## 12. Bulk Sync and Repeat-Sync Algorithms

### 12.1 Request phase (`POST /sync`, must be fast, no Drive calls)

1. Verify flag on, connection `connected`, caller role, `orgId`.
2. For each requested case: load `Case`, require `caseService.canAccessCase(user, case)`; reject the whole request on any denied id (no partial leak, no existence oracle: same 404/403 for unknown vs forbidden).
3. Select documents: `deletedAt` unset, has `storageKey` or readable `filePath`, `canAccessDocument(user, doc)`, **petition release gate** honoured, size ≤ configured max, optional filter by category/type. Anything else becomes `skipped_ineligible` with a reason (visible in the UI, not silently dropped).
4. Caps: ≤ 500 documents and ≤ 25 cases per job (decision D7).
5. Insert job + items in one go; unique `{orgId, idempotencyKey}` makes a repeated POST return the existing job. Documents already `pending/uploading` in another job are reported "already in progress" (partial unique index), not duplicated.
6. Return `202 { jobId }`.

### 12.2 Worker phase (per item)

```
claim item (atomic findOneAndUpdate: status=pending, nextAttemptAt<=now, job not cancelled/paused → uploading, lockedUntil=now+lease)
re-check: connection connected; document still exists / not deleted; requester still has case access  → else skipped/cancelled with reason
buffer = documentService.readDocumentBuffer(doc)            // READ ONLY, existing decrypt/retry
sha = storageService.checksum(buffer)
link = findLink(orgId, docId)
if link && link.sourceChecksum == sha && link.sourceVersion == doc.currentVersion && !options.force:
      → skipped_unchanged (optionally verify driveFileId exists with a cheap files.get once per job)
folder = ensureFolder(orgId, case, category)                // §12.3
if !link:
      id = preassignedId ?? files.generateIds(1)
      persist link{pending, driveFileId=id}                 // BEFORE uploading
      files.create({id, name, parents:[folder], appProperties}, media)   // 409 ⇒ already created: files.get(id), verify appProperties, adopt
else:
      meta = files.get(link.driveFileId, fields=id,trashed,parents,appProperties,md5Checksum)
      404            → link.missing_in_drive  (item=conflict-like "needs decision", default NOT auto-recreate)
      trashed        → link.trashed_in_drive  (no silent untrash)
      otherwise      → files.update(id, media)  // new Drive revision; keep Drive name unless options.syncRenames
verify Drive md5Checksum == local md5 (computed from buffer) ; size check
update link{linked, sourceVersion, sourceChecksum, driveMd5, lastSyncedAt}; item=synced
errors → classify (§13)
```

Files ≤ 5 MB: multipart upload. Larger: resumable upload session, chunked from the in-memory buffer (256 KiB multiples), with the session URI stored on the item so a retry can resume. If the upload cap is ever raised substantially, add a streaming read to `storage.service` as a **separate** reviewed change (not part of this work).

Per-org concurrency: 3 in flight; global: 2 workers × few items; pacing + jitter; honour `Retry-After`.

### 12.3 Folder creation without duplicates

1. Look up `FolderMap{orgId, pathKey}`; if `ready`, optionally verify existence once per job → use it.
2. Else claim by inserting `{status:'creating', leaseUntil}` — the unique index makes exactly one worker the creator; others poll/back off briefly.
3. Creator first searches Drive for a folder with `appProperties.immiglanceKey = <pathKey>` under the parent (crash recovery from a previous attempt), else `files.create` with that appProperty. Never find-by-name.
4. Write `ready` + folder ID. A stale `creating` lease is recoverable after expiry.

**Lazy vs. pre-provisioned:** lazy (on first sync of a case/category) by default — no empty folders for cases that never sync. Optional "Provision case folders now" action for firms that want the tree visible up front.

### 12.4 Edge-case matrix

| Edge case | Behaviour |
|---|---|
| Source renamed | Mapping is by ID; Drive name unchanged unless `syncRenames` is on |
| Source updated (new version/checksum) | Next sync updates the linked file in place (new Drive revision) |
| Source removed/soft-deleted in Immiglance | `source_removed`; **Drive file untouched**; never auto-deleted |
| Drive file renamed or moved | Still found by ID; if moved out of the destination, update `driveFolderId` and keep updating in place |
| Drive file trashed externally | `trashed_in_drive`; surfaced; user picks *Restore & update* / *Re-upload as new* / *Unlink*. Never silently untrashed |
| Drive file hard-deleted | 404 → `missing_in_drive`; user picks re-upload or unlink (bulk "re-upload all missing" button) |
| Destination folder deleted | Folder map → `missing`; app-created case folders are recreated lazily and re-mapped; a missing **root** needs admin action |
| User loses access to destination | 403/404 → folder `inaccessible`; item `failed` (non-retryable until fixed) with guidance |
| Account disconnected / revoked | `invalid_grant` → connection `reconnect_required`, job `paused_reconnect`, items stay `pending` (nothing lost); resume after reconnect to the *same* account |
| Two jobs, same document | Single-flight partial unique index; second is reported "already in progress" |
| Crash after upload, before link saved | Link row was written `pending` with the pre-generated ID **before** upload → retry does `files.get(id)`, verifies `appProperties`, adopts. No duplicate |
| Duplicate request / retry | `idempotencyKey` + unique indexes |
| Sync clicked while one is running | Returns the active job for those documents; UI shows progress |
| Same-name file in destination not linked | Under `drive.file` only *visible* files can be detected. Creation always makes a new file (Drive permits duplicate names), so **nothing is ever overwritten implicitly**. If a visible same-name file lacks our `appProperties` → `conflict` → Skip / Upload as copy (`name (2)`) / Link & replace (explicit confirm) |
| Reconnect with a different Google account | Detected via `googleAccountId`; all folder maps/links flagged `orphaned_account`; requires explicit "Switch account" confirm; Drive data of the old account is untouched; new sync recreates structure |

### 12.5 Retention and deletion policy

Preserve by default. The integration **never calls `files.delete` or trashes** in v1. Source deletion, case deletion, recycle-bin purge, data-rights erasure — none propagate to Drive. Disconnect revokes access but deletes nothing in Drive. A future "delete from Drive" would be a separate, admin-only, typed-confirmation action with its own audit trail (out of scope). Privacy note (§14.9): erasure obligations for data already copied to the firm's Drive remain a firm process.

---

## 13. Error Handling, Retries, and Recovery

| Class | Examples | Action |
|---|---|---|
| Retryable | network error, 429, 5xx, `rateLimitExceeded`, `userRateLimitExceeded`, `backendError` | Exponential backoff with jitter (cap ~5 min), honour `Retry-After`, max 5 attempts, then `failed` (user-retryable) |
| Auth | `invalid_grant`, 401 after refresh | Connection → `reconnect_required`; job → `paused_reconnect`; notify admins via existing notifications |
| Permanent per item | 400, file too large, `storageQuotaExceeded`, 403 `insufficientFilePermissions`, source unreadable/ENOENT | `permanent_failed` with a human message; excluded from "retry failed" until cause is fixed |
| Folder | folder 404/403 | Folder → `missing`/`inaccessible`; items fail with guidance |
| Conflict | visible same-name unlinked file; missing/trashed link | `conflict` awaiting decision |

- **Retry failed only:** `POST /jobs/:id/retry-failed` resets only retryable failed items to `pending` in the *same* job; completed items are untouched, so nothing is re-uploaded.
- **Stuck work recovery:** a periodic reaper (under `withJobLock`) returns items with expired `lockedUntil` to `pending`; the pre-assigned ID makes the redo idempotent.
- **Worker crash / restart:** all state is in Mongo; leases expire; no in-memory queue.
- **Guarded JSON parsing:** the new client must not repeat legacy defect #5.
- **Logging:** use `utils/logger`; log `orgId`, `jobId`, `itemId`, Google error `code`/`reason`; never the token, auth header or document names beyond IDs where avoidable.
- **Quota:** surface Google's "storage full" distinctly — it is the firm's Drive quota, not an Immiglance fault.

---

## 14. Security and Privacy

1. **OAuth state / CSRF:** 32-byte random nonce; server stores only its hash with `{orgId, userId}`, TTL 10 min, single use; the same nonce is also set in an `HttpOnly; Secure; SameSite=Lax` cookie scoped to the Drive callback path (double check). PKCE (`code_challenge` S256) added. Callback rejects: missing/expired/used state, cookie mismatch, `error` param, missing `drive.file` in granted scopes. The initiating user's active admin permission is **re-checked at callback time** (via the state's `userId`).
2. **Redirect URI:** exact string from `GOOGLE_DRIVE_OAUTH_REDIRECT_URI`, HTTPS-only in production, same unsafe-origin guard as login; never taken from the request. Post-callback redirect target is a fixed allowlisted Admin URL; the status is passed as a code, never as free text or token.
3. **Least privilege:** `drive.file` (+ `openid email`). No `include_granted_scopes`.
4. **Token storage:** AES-256-GCM, dedicated key + `keyVersion`, `select:false` field; decryption only inside the token vault; access tokens in memory only (short TTL); key missing ⇒ feature refuses to connect (fail closed), never stores plaintext.
5. **No secrets in the frontend, URLs or logs:** client secret and refresh token backend-only; `picker-token` returns a short-lived access token only, `Cache-Control: no-store`, never logged; error messages are mapped (no raw Google bodies echoed to the UI); a logger redaction test asserts tokens never appear.
6. **Org isolation / IDOR:** `orgId` from the session only; every query includes it; unknown and foreign IDs both return 404; job/item/link endpoints verify the record's `orgId` **and** the caller's case access. Cross-tenant tests are mandatory (§16).
7. **Case/document authorization before sync:** reuses `canAccessCase` and `canAccessDocument` (not re-implemented) + the petition release gate, at request time **and** at execution time.
8. **Rate limits / abuse:** per-user limiter on `POST /sync` and `/picker-token`, per-org cap on active jobs, document/case caps per job, callback limiter. Uses the existing `express-rate-limit` style.
9. **Privacy / data protection:** this feature copies client PII (passports, tax records, A-numbers) to a third party (Google) under the firm's account. Needs a firm decision and likely client-facing disclosure/DPA review; the plan provides the controls (per-category exclusion list, `internal`-visibility handling, audit trail) but the legal decision is **[TBC]** (A6, D8). Immiglance `data-rights` erasure does not reach Drive copies.
10. **Disconnect:** call Google's revoke endpoint, delete the encrypted token, set `disconnected`; keep link/folder rows for reconnection. Revocation failure still deletes the local token and records a warning.
11. **Shared Drives:** `supportsAllDrives=true` on every call; behaviour depends on the user's Shared Drive role **[TBC spike]**. v1 documents it as "supported if the spike passes, otherwise My Drive only".
12. **Google verification for external customer orgs:** `drive.file` is expected to be non-sensitive (**[TBC]** re-verify in the Console), so no restricted-scope security assessment; production publishing status, brand verification, privacy-policy and terms URLs, and an authorized domain are still required. If decision D1 ever moves to `drive`, restricted-scope verification and an annual security assessment apply.
13. **Audit:** every connect/disconnect/config/sync/conflict action via `recordAuditEvent`, IDs and counts only.
14. **Secrets handling in this audit:** only variable names recorded; no `.env` value was copied.

---

## 15. Implementation Phases

Dependency order: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11. Phases 9's static screens can start after 3 in parallel with 5-8. Each phase ends with the **regression gate** (§16.3): login tests, document upload/download/preview, client↔admin document visibility, the five legacy callers' characterisation tests, and all four frontend builds + backend `node --check`.

### Phase 1 — Repository audit and requirements confirmation
- **Files:** this document; add characterisation tests for `google-drive.service.js` (not-configured path writes `not_configured`; `targetFolderName` outputs) as DB-free unit tests — new test files only.
- **DB:** none. **Backend/Frontend:** none beyond tests.
- **Security:** none.
- **Acceptance:** decisions D1–D8 answered in writing; characterisation tests green in `test:safe`.
- **Risks:** legacy production configuration unknown (A7). **Rollback:** delete new test files.

### Phase 2 — Google OAuth and scope validation (spike, throwaway)
- **Goal:** prove in a **dedicated test Google project/account** (never production): (a) `drive.file` + `access_type=offline` yields a refresh token; (b) a Picker-selected folder (Picker initialised with the project number and a backend-minted token) is writable by the **backend** token; (c) children of a picked folder created by the app are visible, others are not; (d) nested/Shared Drive behaviour; (e) refresh-token lifetime under "Testing" vs "In production"; (f) `appProperties` search and `generateIds` + create-with-ID idempotency (409).
- **Files:** scratch scripts in the scratchpad only; **no repo changes**.
- **Acceptance:** written results appended to §7 (replace [TBC] markers); go/no-go on Picker.
- **Risks:** Picker/same-app grant assumption (§7.2 #6). **Fallback:** ship app-created-folder only.
- **Rollback:** none needed.

### Phase 3 — Organisation connection and encrypted token storage
- **Files (expected):** NEW `Backend/src/modules/google-drive/{connection.service,token-vault,oauth-state,routes,controller}.js`; NEW models `GoogleDriveConnection`, `GoogleDriveOAuthState`; NEW `utils/secretBox.js`; additive block in `config/env.js` (`env.googleDrive`: flag, redirect URI, encryption key, scopes); one `router.use` line in `routes/index.js`; `.env.example` (names only); NEW index script.
- **DB:** two new collections + indexes via explicit script.
- **Backend:** `connect/start`, `callback`, `status`, `disconnect`, `reconnect`; token refresh single-flight; revoke.
- **Frontend:** none yet (use API directly / minimal test harness).
- **Security:** §14.1-14.5, 14.10.
- **Acceptance:** two simulated orgs (Google mocked) cannot read each other's connection; state tampering/replay/expiry rejected; refresh token never appears in any response, log or DB plaintext; flag off ⇒ routes 404 and login tests unchanged.
- **Dependencies:** D1, D2, D4 (key provisioning). **Rollback:** flag off; drop new collections (empty of user data).

### Phase 4 — Folder selection and creation
- **Files:** NEW `folder.service.js`, `GoogleDriveFolderMap` model, `drive.client.js`; routes `folders/root`, `folders/children`, `config`; optional `picker-token`.
- **DB:** `GoogleDriveFolderMap` + `config` on connection.
- **Security:** validate any folder ID server-side with `files.get` (must be a folder, accessible, `supportsAllDrives`); never trust an ID from the client without that check.
- **Acceptance:** root created once even under concurrent calls; renamed root still resolves; wrong-type/foreign IDs rejected.
- **Risks:** Picker outcome from Phase 2. **Rollback:** flag off.

### Phase 5 — Document mapping and first single-file sync
- **Files:** NEW `eligibility.service.js`, `GoogleDriveFileLink` model, single-document upload path inside `sync.worker`/`drive.client`. **Read-only** use of `documentService.readDocumentBuffer`, `canAccessDocument`, `petitionGate`.
- **Option:** export `targetFolderName` from the legacy service (additive one-line export) *or* re-implement the small category table in the new module — recommend re-implementing + a unit test asserting parity, so the legacy file stays untouched (honours N4). Decision noted in D6.
- **Acceptance:** one document uploads once, link stored, re-sync is `skipped_unchanged`; Document collection byte-identical before/after (N9).
- **Rollback:** flag off.

### Phase 6 — Bulk sync with background processing and idempotency
- **Files:** NEW `GoogleDriveSyncJob`, `GoogleDriveSyncItem`, `sync.service.js`, `sync.worker.js`, optional `workers/googleDriveWorker.js`; one gated start line in `server.js` (and clear on shutdown, as for GHL).
- **Acceptance:** 100-document job completes without blocking an unrelated HTTP request (latency check on `/api/documents`); duplicate POST returns same job; concurrent jobs on the same document never double-upload; kill the worker mid-job → resumes with no duplicates.
- **Risks:** event-loop contention (N8). **Rollback:** flag off / stop worker; jobs remain in Mongo.

### Phase 7 — Repeat sync and safe updates
- Checksum/version comparison, in-place `files.update`, rename policy, `source_removed` handling.
- **Acceptance:** changing a document version produces exactly one Drive revision and no new file; unchanged documents upload nothing.

### Phase 8 — Conflict handling, retries, recovery
- Conflict classification, `retry-failed`, `cancel`, `missing_in_drive` / `trashed_in_drive` flows, stale-lease reaper, `paused_reconnect` resume.
- **Acceptance:** every row of the §12.4 matrix has an automated test.

### Phase 9 — Frontend settings and sync-progress UI (Admin)
- **Files:** NEW `Admin/frontend/src/components/settings/GoogleDrivePanel.jsx` (+ sub-components), additive hook into `Settings.jsx`; additive controls in `CRMCaseDetail.jsx` (**coordinate with the user's uncommitted edits**); additive functions in `services/api.js`; `*.test.jsx` tests.
- **Acceptance:** all UI states in §11.2 render; roles outside §11.3 see nothing; no change to existing screens' behaviour; Admin `npm run build` and existing tests pass.

### Phase 10 — Security, tenant-isolation and permission tests
- Execute the full §16 security matrix; fix findings; external-style review of OAuth callback and token vault.
- **Acceptance:** all security tests green; no secret in logs/responses (automated grep of captured logs).

### Phase 11 — Production configuration, monitoring, rollout, rollback
- Cloud Console changes (§7.4), env vars via deploy secrets (not committed), `VITE_GOOGLE_*` added to `.env.example`/`.env.production` and CI `vars`, monitoring (job failure rate, `reconnect_required` count, queue depth, oldest pending item age), staged rollout (flag on for internal org first), runbook.
- **Acceptance:** release checklist (§16.4) all pass. **Rollback:** set `GOOGLE_DRIVE_INTEGRATION_ENABLED=false` and restart; optionally revoke tokens; no data migration to undo.

---

## 16. Test Strategy and Acceptance Criteria

### 16.1 Principles

- Unit/integration tests mock Google with an in-process fake Drive (records calls, injectable failures: 401, 403, 404, 409, 429, 5xx, timeouts, partial uploads).
- **No DB-backed test against the real/shared database.** Use named DB-free files in `npm run test:safe`, or an isolated throwaway database only with explicit approval (project rule: tests that touch the real DB write data there).
- Real-Google tests run **manually** against a dedicated test Google account/project; never production customer files or production tokens.

### 16.2 Test matrix

| Area | Test |
|---|---|
| Multi-org | Two orgs, two fake Google accounts: tokens, folders, links, jobs fully separate |
| Cross-tenant | Org A cannot read/resolve/retry/cancel Org B job, item, link, folder, status (404) |
| OAuth | Tampered, replayed, expired, cross-user state; missing cookie; denied consent; missing `drive.file` scope; redirect target not user-controlled |
| Tokens | `invalid_grant` → `reconnect_required`, job paused, no data loss; refresh single-flight; token never in logs/responses |
| Scope | Insufficient scope → clear error, no partial state |
| Folders | Concurrent folder creation → one folder; foreign/wrong-type folder ID rejected; renamed/moved folder still works; deleted folder recovery |
| Single file | Upload once; link persisted; md5 verified |
| Bulk | 100 items, injected partial failures → correct counts, retry-failed re-sends only failures |
| Repeat sync | Unchanged → no upload; changed → in-place update; no duplicate file |
| Conflict | Visible unlinked same-name file → `conflict`; skip/copy/replace each behave as specified |
| Concurrency | Duplicate POST, two jobs same doc, sync-while-running → single upload |
| Network | Failure mid-upload → retry resumes; 429 → backoff honours `Retry-After` |
| Crash | Kill between upload and link save → retry adopts the pre-assigned ID; zero duplicates |
| External changes | Drive file trashed / deleted / moved → matrix §12.4 |
| Permissions | case_manager not on case → denied; attorney/client/employer denied; petition-gated doc excluded; document losing access between request and execution → skipped |
| Large files / limits | > 5 MB resumable path; storage-quota-exceeded; rate-limit responses |
| Disconnect/reconnect | Same account resumes; different account requires confirm and orphans old links |
| **Regression — login** | `auth.security.test.js` and Google login start/callback behave identically; login state cookie unaffected |
| **Regression — documents** | Upload (single, bulk, chunked), version add, download, preview, share, soft delete, S3/local storage, encryption envelope — unchanged; `Document` collection unmodified by sync (N9) |
| **Regression — portals** | Client uploads ↔ Admin sees (and vice versa) via live updates; attorney access scoping unchanged |
| **Regression — legacy sync** | Characterisation tests for `google-drive.service.js` and its five callers pass unchanged; with new flag off, behaviour identical to today |
| Builds | `npm run build` in Landing, Client, Admin, Attorney; `node --check src/server.js` |

### 16.3 Per-phase regression gate (blocks merge)

All of: Backend safe tests green; the four frontends build; login + document regression subset green; diff contains none of the protected files in §8.1 N1–N2.

### 16.4 Release checklist (objective pass/fail)

1. Flag defaults false in every environment file; flag off ⇒ `GET /api/integrations/google-drive/status` returns 404 and no worker is running (**pass/fail**).
2. Cloud Console: redirect URI exact; publishing status "In production"; scopes exactly as §7.4; API key restricted (**checklist signed by Console owner**).
3. Encryption key present in production secrets; a connect attempt without it fails closed.
4. Token plaintext scan of DB, logs, and API responses: zero matches.
5. Two-org isolation suite: 100% pass.
6. 100-document bulk job on staging: ≥ 99% success excluding injected failures; retry-failed completes the rest; zero duplicate Drive files.
7. p95 latency of `GET /api/documents` and document download during an active 100-document job within 20% of baseline (**threshold to be agreed, D7**).
8. Worker kill/restart test passes with zero duplicates.
9. Legacy sync characterisation tests and login tests green.
10. Rollback drill executed on staging: flag off + restart restores prior behaviour.

---

## 17. Deployment and Rollback

- **Configuration:** new env vars (names): `GOOGLE_DRIVE_INTEGRATION_ENABLED`, `GOOGLE_DRIVE_OAUTH_REDIRECT_URI`, `GOOGLE_TOKEN_ENCRYPTION_KEY` (+ optional `…_KEY_VERSION`), `GOOGLE_DRIVE_WORKER`, pacing/concurrency knobs. **No** per-org credentials in env. The unused `GOOGLE_DRIVE_SCOPES` placeholder is either wired into config (to define the requested scopes in one place) or removed from `.env.example` in Phase 3 (D6).
- **Frontend env:** add the `VITE_GOOGLE_*` names Picker needs to Admin's `.env.example` / `.env.production` and the CI `vars` (only if Picker is used; the OAuth-client-id variable is likely unnecessary — §7.3).
- **Index creation:** run the new explicit index script once per environment before enabling the flag (autoIndex is off). New collections only.
- **Process model:** in-process worker first; optional separate worker process using the existing standalone-worker pattern — needs its own deploy approval and PM2 (or equivalent) change **[TBC]**.
- **Rollout:** dev → staging (test Google account) → production with the flag on for the internal org only → broader. 
- **Rollback:** (1) flag off + restart — routes unmounted, worker stopped, UI hidden; (2) in-flight items stay `pending` in Mongo and are harmless; (3) optionally revoke tokens via Google; (4) new collections can remain or be dropped; nothing in existing collections changed, so no data migration to reverse.
- **Monitoring:** log events `gdrive_*`; alert on `reconnect_required`, failure rate, queue depth, oldest-pending age; admin notification on permanent failures.

---

## 18. Risks, Open Questions, and Decisions Required

### 18.1 Risks

| ID | Risk | Likelihood / Impact | Mitigation |
|---|---|---|---|
| R1 | A change accidentally affects upload/download/legacy sync | Low / **Critical** | §8.1 guarantees, protected-file diff gate, regression gates |
| R2 | Picker grant does not carry to the backend token | Medium / Medium | Phase 2 spike; fallback to app-created folder only |
| R3 | `drive.file` too limiting for the firm's expectations ("browse my Drive") | Medium / Medium | Set expectations early (D1); documented limits |
| R4 | Consent screen left in "Testing" ⇒ weekly token expiry | Medium / High | Release checklist item 2; `reconnect_required` UX |
| R5 | Double-sync with legacy env sync | Low / Medium | Warning banner, D3 |
| R6 | In-process worker contends with API event loop | Medium / Medium | Concurrency caps, external worker option, latency criterion |
| R7 | Autoindex off ⇒ missing indexes ⇒ duplicate rows/races | Medium / High | Mandatory index script + startup assertion that indexes exist when flag on |
| R8 | PII copied to a third party without proper approval | Medium / **High** | D8; default-off flag; per-category exclusion |
| R9 | Drive API quotas/rate limits on large firms | Medium / Low | Backoff, pacing, per-org caps |
| R10 | Production hosting/process model unknown | — / Medium | **[TBC]** — confirm before Phase 11 |
| R11 | Uncommitted edits in `CRMCaseDetail.jsx`/`CRMCases.jsx` conflict with UI work | Medium / Low | Additive changes only; coordinate with the owner |

### 18.2 Decisions requiring approval

| ID | Decision | Recommendation |
|---|---|---|
| **D1** | OAuth scope: `drive.file` only vs. restricted `drive` | `drive.file`; revisit only with business justification |
| **D2** | Reuse the existing OAuth client (new redirect URI) vs. a separate Drive OAuth client/project | Reuse in production; **separate test project** for dev/staging |
| **D3** | Legacy env-token sync: leave / retire later / re-point to new queue | Leave now, retire later (separate approval) |
| **D4** | Provision `GOOGLE_TOKEN_ENCRYPTION_KEY` (who/where; rotation policy) | New dedicated key via deploy secrets |
| **D5** | One shared Google account per org vs. per-user connections | One per org for v1 |
| **D6** | New permission resource `google_drive:*` vs. reuse `settings:manage_integrations`; wire or remove `GOOGLE_DRIVE_SCOPES`; touch legacy file for a shared export or not | Reuse existing permission; re-implement category table; wire the scopes var |
| **D7** | Per-job caps (500 docs / 25 cases), concurrency, latency threshold | As proposed, tune after staging |
| **D8** | Business/legal approval to copy client PII to the firm's Google account; categories excluded by default | Required before enabling in production |
| **D9** | Sync trigger: manual only (recommended) vs. later auto-sync on upload/approval | Manual only in this program |
| **D10** | Worker: in-process vs. separate process | In-process first; separate process if D7 latency fails |

### 18.3 Open questions (**[TBC]**)

Production hosting and process manager; whether the legacy env sync is configured in production; Cloud Console state (APIs, consent-screen status, redirect URIs, key restrictions); whether true multi-organisation is planned and its timeline; the retention policy for job history; `Document.visibility` sub-schema location; where the GHL admin UI sits (to place Integrations consistently); whether `AuditLog.entityType` has any hidden validation.

---

## 19. Files Expected to Change

**New (no existing behaviour affected):**
`Backend/src/modules/google-drive/*` (connection, token vault, oauth-state, drive client, folder, eligibility, sync service, worker, routes, controller, tests); `Backend/src/models/GoogleDrive{Connection,FolderMap,FileLink,SyncJob,SyncItem,OAuthState}.js`; `Backend/src/utils/secretBox.js`; `Backend/src/scripts/createGoogleDriveIndexes.js`; optional `Backend/src/workers/googleDriveWorker.js`; `Admin/frontend/src/components/settings/GoogleDrivePanel.jsx` (+ parts and tests).

**Existing files, additive edits only:**

| File | Change |
|---|---|
| `Backend/src/config/env.js` | New `googleDrive` block (flag, redirect URI, key) |
| `Backend/src/routes/index.js` | One gated `router.use("/integrations/google-drive", …)` |
| `Backend/src/server.js` | Gated worker start/stop (as GHL) |
| `Backend/.env.example` | New variable *names* |
| `Backend/package.json` | Optional script entry for the index script (no new dependency) |
| `Admin/frontend/src/pages/Settings.jsx` | Mount the new panel |
| `Admin/frontend/src/pages/CRMCaseDetail.jsx` | Sync action + badges (**has uncommitted user edits — coordinate**) |
| `Admin/frontend/src/services/api.js` | New API functions |
| `Admin/frontend/.env.example`, `.env.production`; `.github/workflows/inszoom-cicd.yml` | `VITE_GOOGLE_*` names/vars, only if Picker ships |
| `Backend/src/modules/authorization/permissions.registry.js` (+ test) | Only if D6 chooses a new resource |

**Explicitly NOT changed:** `google-oauth.service.js`, login handlers/routes, `google-drive.service.js` and its five callers, `Document.js`, `Case.js`, `User.js`, `document.*` (routes, controller, service), `storage.service.js`, Client/Landing/Attorney apps.

---

## 20. Final Recommendation

Proceed, but as a **new, flag-gated, additive module** that treats the existing S3/Immiglance documents as read-only input and the existing Google login and legacy sync as untouchable. Start with **Phase 1 (characterisation tests, decisions)** and the **Phase 2 spike in a dedicated test Google project**, because two facts decide the final shape and neither can be verified from the repository: whether a Picker-selected folder is writable by the backend's `drive.file` token, and the consent-screen/redirect configuration in Google Cloud. If the spike fails, the app-created-root-folder design still fully satisfies the workflow (select-or-create destination, structured case folders, bulk sync, repeat sync) without any broader scope.

Keep `drive.file`; do not move to the full `drive` scope without an explicit business decision (D1). Keep sync manual (D9), keep the flag off until the release checklist (§16.4) passes, and obtain the privacy/legal sign-off (D8) before any client document is copied to a customer Google account.

**Nothing in this report is implemented.**
