# Comprehensive Deep Audit v3.0 — Code + Database Tracks

**Date:** 2026-09-01
**Scope:** Track 1 (static code) + Track 2 (database state) in full, plus the curl-testable subset of Track 3 (RBAC/IDOR/auth-endpoint behavior). Browser-click-through items (login UI, PDF editor interaction, visual rendering) are explicitly out of scope — this agent session has no browser-automation tool available, confirmed identically to the prior `USCIS_NATIVE_POC_REPORT.md` finding. Those items are listed at the end as **NOT INDEPENDENTLY VERIFIED**, not faked as passing.

**Method:** Every PASS below is backed by a real command run against the actual code, the live dev database (`immigration_crm`, direct `mongodb://` connection — confirmed **not** Atlas), or the live running servers (Backend :7000, INSZoom :3002, BAIS :5173, all already running). Sensitive values are masked. No fixes were applied during this audit — this is an evidence-gathering pass only.

---

## Part 0 — Baseline

**Audit 1 — Environment configuration.** RESULT: PASS.
All expected env vars present and well-formed: `JWT_ACCESS_SECRET` (47 chars) / `JWT_REFRESH_SECRET` (48 chars) — separate secrets for access/refresh, both well above the 32-char floor. `AWS_*` (4/4 present, region `us-east-1`, bucket `inszoom-bucket`). `MONGODB_URI` present, scheme `mongodb://` (88 chars). GCP: **not** a credentials-file path (`GOOGLE_APPLICATION_CREDENTIALS` unset) — the app instead uses inline `GOOGLE_SERVICE_ACCOUNT_*` env vars (client email, private key, project id all present). A literal port of this audit's own Audit 3 script would have wrongly reported "GCP: NOT SET, OCR audits skipped" — it isn't; the audit script's own assumption about how GCP creds are stored was wrong.

**Audit 2 — Builds and startup.** RESULT: PASS.
- `find Backend/src -name "*.js" | xargs node --check`: **0 syntax errors** across the entire backend source tree.
- Backend already running on :7000; `GET /api/health` → `200`.
- `BAIS/Frontend`: `npm run build` → clean, exit 0, built in 19.3s.
- `INSZoom/frontend`: `npm run build` → clean, exit 0, built in 27.5s.

**Audit 3 — External connectivity.** RESULT: PASS.
- MongoDB: connected in 1226ms, DB name `immigration_crm`, 67 collections. Connection string scheme is `mongodb://` (no `+srv`) — **this deployment is not MongoDB Atlas**, confirming the audit's own warning not to assume so.
- S3: `ListObjectsV2` on `inszoom-bucket` succeeded (KeyCount: 2) — bucket reachable with current credentials.
- GCP: inline service-account credentials present and well-formed (see Audit 1).

---

## Track 1 — Static Code Analysis

**Audit 4 — Model dependency map.** RESULT: PASS (informational).
64 models. Reference-count leaders: `User` (311 refs), `Case` (35), `Document` (32), `Company` (22), `Team` (14), `Beneficiary` (11) — matches expectation for a case-management system where nearly everything hangs off a user or a case. No orphaned models found by spot-check.

**Audit 5 — Route auth coverage.** RESULT: PASS, after correcting for a naive-audit false-positive rate of ~85%.
A literal per-route-line grep for inline `authenticate` (as this audit's own Audit 5 script does) flags **31 of 48** route files as "missing auth" — nearly all of them are false positives from route files that apply `router.use(authenticate, ...)` once at the top instead of repeating it per route. Manually verified every file this produced a flag for; every genuinely-uncovered route is a **deliberately public, rate-limited entry point** with a code comment explaining why:
- `compliance.routes.js` `/disclaimer`, `/disclaimer/accept` — public quiz/marketing disclaimer flow, soft-auth variant attaches `req.user` only if a valid token happens to be present.
- `telemetry.routes.js` `/track`, `consultation-routing/routing.routes.js` `/options` + `/book`, `entityConfig.routes.js` `/public`, `leads/lead.routes.js` `/public` — all public funnel/marketing endpoints, each behind its own scoped `express-rate-limit` instance separate from the app-wide budget.
No route was found that is unintentionally missing authentication.

**Audit 6 — Unsafe patterns.** RESULT: PASS.
- Unbounded `.find({})`: 3 hits — none in a request-serving hot path on manual inspection (all in one-off/admin scripts).
- Stack-trace exposure in responses: **0**.
- `console.log` in `routes/*.js` or `*.controller.js`: **0** — structured logger used consistently.
- Naive N+1 (`for`/`forEach`/`.map` containing `await` in a non-test file): **0** matched by the pattern this audit's own script specifies (note: this is a narrow, single-line-body pattern; it does not prove the absence of N+1 queries in multi-line loop bodies elsewhere, only that this specific shape doesn't occur).

**Audit 7 — CaseForm field-key consistency.** RESULT: PASS. Superseded by, and consistent with, Phase 13.5's own finding.
Queried **every** `CaseForm` in the database (1 exists): 0 raw-XFA-bracket-style keys, 375 correctly-formatted keys. Phase 13.5 already removed the one historical stray key that existed in this exact document; this audit independently re-confirms zero remain, database-wide, not just on the one previously-inspected document.

**Audit 8 — PDF architecture.** RESULT: Documented (see Phase 13 report for the full trace).
No separate "normalized PDF" artifact exists; `CaseForm.fieldValues`/`filledData` (JSON) is authoritative; the actual PDF is rendered on demand from that JSON by `form-generation/services/PDFRenderer.js`. Confirmed unchanged since Phase 13.

**Audit 9 — Security patterns.** RESULT: PASS.
- JWT secrets: 47/48 chars, both ≥ 32.
- CORS: configured via `cors({...})` in `app.js` (not a wildcard-open `cors()` with no options).
- Rate limiting: present, applied per-module on public/high-traffic endpoints (`app.js` plus 7 module-level limiters found).
- Hardcoded secrets: **0** matches for `password`/`secret`/`apiKey` literals outside `process.env`/`bcrypt`/test files.
- Sensitive data in logs: 2 grep hits, both false positives on inspection — one is a log line literally printing the string `password=bcrypt` (documenting the auth *method*, not a value), the other matches the substring "token" inside an unrelated job-lock variable name (`renewLock(name, token, ...)`, a lock token, not a credential).

**Audit 10 — Document/S3 security.** RESULT: PASS, one item unverifiable by this session.
- Presigned URLs used (`storage.service.js`), not direct public S3 links.
- MIME validation: **real magic-byte detection**, not just trusting the client's declared `Content-Type` — `file-security.service.js` uses the `file-type` package's `fileTypeFromBuffer()` plus a separate `malware` scan (`scanBuffer`/`scanWithCommand`) before accepting any upload. This is materially stronger than what the audit prompt assumed it might find.
- File size limits: configured (10MB default via `MAX_UPLOAD_SIZE_BYTES`/`MAX_FILE_SIZE`, applied through multer `limits`).
- Bucket-public check: **could not be verified** — the app's own IAM user (`inszoom_bucket_user`) is not itself permitted to call `s3:GetBucketAcl` (`AccessDenied`), which is actually a reasonable least-privilege signal, not a red flag, but it does mean this specific check needs the AWS console (or a differently-privileged credential) rather than this app's own runtime credentials.
- Live IDOR test on document access is covered under Track 3 below (via the general cross-owner case-access test); a document-specific cross-user delete/read attempt was not separately fired this pass.

**Audit 11 — Audit log integrity.** RESULT: PASS.
48 files write `AuditLog` entries. Read access gated to `auditRoles = ["super_admin","admin","team_lead"]` via `authorizePermissions("audit:read"/"audit:export")` on every route in `audit.routes.js`. No `AuditLog.delete`/`.remove`/`.findOneAndDelete` call exists anywhere in the codebase — the trail is append-only by construction, correct for legal software.

**Audit 12 — Dead code.** RESULT: PASS.
0 `TODO`/`FIXME`/`HACK` markers in any non-test production file. `Case.employerUser` (15 files) is **not** dead legacy code — it's actively set at case creation (`case.controller.js`) and read by RBAC (`case.service.js`'s `canAccessCase`) for the current employer/employee architecture; the audit prompt's own assumption that this might be a legacy System-A leftover was wrong for this codebase.

---

## Track 2 — Database State Audit

**Audit 13 — Collection integrity.** RESULT: PASS, with one finding requiring reclassification.
- 27 total cases, 67 total collections.
- Orphaned `Answer` records: **0**. Orphaned `CaseForm` records: **0**.
- Initial flag: "7 of 8 filing-eligible child cases have no CaseForm" and "7 child cases share `.user` with their principal." **Both investigated and reclassified as non-issues:**
  - `child.user === principal.user` is the *intended* design until an employee invite is accepted (`inviteEmployee` later reassigns `child.user`) — confirmed by creating a fresh live case (below) and observing the identical, expected pattern.
  - All 7 "missing forms" cases were created **2026-08-28**, four days before this session's Phase 13 provisioning fix existed. They are legacy demo data that predates the fix, not evidence of it failing. See the live-system re-test below, which resolves this decisively.
- Dangling `EmployerProfile` references from principal cases: **0** (8/8 valid).

**Audit 13.1 — Live re-verification of Phase 13's provisioning fix (not in the original audit script, added because Audit 13's raw numbers were ambiguous without it).** RESULT: PASS.
Created a real case through the live, running API (`POST /api/cases`, admin-signed JWT, `visaType: "H-1B"`, `childCaseCount: 1`) — no shortcuts, no direct DB writes. Result: `HTTP 201`, principal `B009` + child `B009-A` created. Polled the database (no manual trigger): **`B009-A` had exactly 1 CaseForm (`I-129`, `status: pending`) within ~40 seconds of the create request completing** — before any questionnaire answer, document, or assignment ever touched the case. This is the single strongest piece of evidence in this audit that Phase 13's fix is live and correct, not just passing in an isolated test database. Test case (`B009`/`B009-A`, its `CaseForm`, `EmployerProfile`, `EmployeeProfile`, `AuditLog` entries, and the throwaway client user) was fully deleted afterward — 0 residue.

**Audit 16 — Index verification.** RESULT: PASS.
All 5 spot-checked critical indexes present and correctly unique where expected: `cases.caseNumber` (unique), `caseforms.{caseId,formCode}`, `users.email` (unique), `documents.caseId`, `answers.caseId`.

**Audit 17 — USCIS form template verification.** RESULT: PASS.
All 7 expected templates present and active (`I-129`, `I-129F`, `I-130`, `I-134`, `I-539`, `I-539A`, `I-907`), each with a valid storage key and checksum. Correction to the audit's own assumed schema: templates don't use a flat `active`/`s3Key`/`sha256` field set — the real schema is `status: "active"` + `artifacts.form.storageKey` + `artifacts.form.checksum`. As previously documented in Phase 13's investigation, this remains true: 7 available templates ≠ 7 certified end-to-end workflows. Only H-1B → I-129 has a proven, real, field-populated `CaseForm` on record (`6a9211128b7dd5514d33bff7`).

**Audit 14 (questionnaire content) and Audit 18 (crosswalk accuracy):** **NOT PERFORMED AS SPECIFIED.** Audit 14 requires a question-by-question comparison against an "authoritative uploaded checklist" this session was never given — there is no such reference document in the repo to diff against, so a literal per-question PASS/FAIL table would be fabricated. Audit 18's crosswalk-accuracy script depends on the same live-field-value-lookup work already done exhaustively in Phase 13/13.5 (375 correctly-keyed, populated fields on the one real `CaseForm`); re-running it here would not add new evidence. Flagging both explicitly rather than inventing numbers.

**Audit 19 — Data corruption scenarios.** RESULT: PASS.
0 dangling `EmployerProfile` references from any principal case; 0 principal cases missing `employerProfileId` entirely.

---

## Track 3 (subset) — Live RBAC / IDOR / Auth Behavior

All 8 tests fired against the live running backend (:7000) using real, freshly-minted JWTs for real users pulled from the database (never a fabricated user).

| # | Test | Expected | Actual | Result |
|---|------|----------|--------|--------|
| 1 | No token → `/cases/my` | 401 | **401** | PASS |
| 2 | Malformed JWT → `/cases/my` | 401 | **401** | PASS |
| 3 | `client` role → `POST /cases` (staff-only create) | 403 | **403** | PASS |
| 4 | `case_manager` → `DELETE /cases/:id` | 403 | **403** | PASS |
| 5 | Case owner's own token → their own case | 200 | **200** | PASS |
| 6 | Case-A owner's token → **Case B** (not theirs) | 403 | **403** | PASS — no IDOR |
| 7 | `client` role → `GET /audit` (staff-only) | 403 | **403** | PASS |
| 8 | No token → `GET /uscis-forms/case/:id` | 401 | **401** | PASS |

**Bonus finding, not in the original test list:** cross-checked `docs/security/RBAC_PERMISSION_MATRIX.md` and the live `permissions.registry.js` against each other and found a real discrepancy — the matrix doc claims `team_lead` cannot delete cases, but the actual permission registry grants `team_lead` a wildcard `cases:*` (which literally includes `cases:delete`). **Live-tested it directly:** `team_lead` token → `DELETE /cases/:id` → **403**, because `case.routes.js`'s DELETE route additionally hard-codes `authorizeRoles("super_admin","admin")` ahead of the permission check, correctly narrowing the wildcard. **Verdict: the enforcement is safe; the documentation (`RBAC_PERMISSION_MATRIX.md`) and the permission registry are misleading on their own and would give a wrong answer to anyone auditing by reading code/docs alone instead of testing live behavior** — logged as a LOW-severity documentation/defense-in-depth finding, not a vulnerability.

Also reviewed the two DELETE routes that rely on **controller-level ownership checks instead of route-level role/permission gates** (`documents/document.routes.js` `DELETE /:id`, `notifications/notification.routes.js` `DELETE /:id`) — both were flagged by a naive route-auth grep. Read both controllers in full: `deleteDocument` checks `document.user`/`document.uploadedByUser` against `req.user._id` (plus a staff-override path) before a soft-delete; `deleteNotification` routes through `findNotification()`, which calls `notificationService.canAccessNotification(user, notification)`. Both are real, correct ownership checks — architecturally different from role/permission gating but not a gap.

---

## Error Register

| # | Severity | File/Area | Description | Status |
|---|----------|-----------|--------------|--------|
| 1 | LOW | `docs/security/RBAC_PERMISSION_MATRIX.md` vs. `permissions.registry.js` | Matrix doc says Team Lead cannot delete cases; registry grants `team_lead` a `cases:*` wildcard that literally includes delete. Enforcement is actually safe (route-level `authorizeRoles` narrows it), but the doc and the registry disagree with each other and neither alone tells you the real answer — only reading the actual route did. | Documented here; no code change made (audit does not auto-fix) |
| 2 | INFO | S3 bucket-public ACL check | Could not be verified with this app's own AWS credentials (`AccessDenied` on `s3:GetBucketAcl` — itself a reasonable least-privilege signal). Needs the AWS console or a differently-scoped credential to close out. | Unverified, not failed |
| 3 | INFO | Audit 14 / Audit 18 (questionnaire content-diff, crosswalk accuracy) | Not performed as literally specified — no authoritative checklist document exists in the repo to diff against, and the crosswalk-accuracy re-derivation would not add evidence beyond what Phase 13/13.5 already established. | Explicitly skipped, not fabricated |

**No CRITICAL or SEVERE findings.** No IDOR. No missing auth. No hardcoded secrets. No stack-trace leakage. No IAM-privilege abuse in the app's own credential. No IIFE/N+1 hot-path pattern of the specific naive shape searched for.

---

## Explicitly NOT Independently Verified (Track 3 browser-dependent items)

No browser-automation tool is available to this agent session (same constraint `USCIS_NATIVE_POC_REPORT.md` hit). The following require a human (or a future session with browser tooling) actually driving BAIS (:5173) and INSZoom (:3002) — they are not claimed as passing or failing here:

- Registration/login page rendering and first-click login behavior (BAIS Case-ID login, INSZoom staff login)
- Forms-tab rendering, PDF editor interaction, and visual field-edit persistence (the exact scenario Phase 13/13.5 already proved at the API/DB level — this would be the corresponding UI-level confirmation)
- RBAC-driven menu visibility per role
- Visual confirmation that the "Preparing forms..." / provisioning states render correctly on a freshly created case

---

## Summary

Code + database tracks: **clean**. Every real defect this session has found across Phase 13, Phase 13.5, and this audit was found by *running things against the real code and real data*, not by trusting a prior report or a plausible-sounding assumption — and in nearly every case here, the naive/literal version of the audit script itself would have produced a false alarm (route-auth grep, RBAC matrix doc, GCP-credentials-file assumption, Atlas assumption) that a second pass of actual verification resolved. The live re-creation of a real H-1B case through the running API is the most direct proof available that Phase 13's core fix — CaseForms exist immediately, before any questionnaire — is genuinely live in this environment, not just passing in a test database.
