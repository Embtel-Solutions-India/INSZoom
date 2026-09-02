# Route Shadowing (§17) & Negative Workflow Matrix (§24)

**Scope:** `Backend/src` — static analysis only. No HTTP request was issued to the running
backend (`localhost:7000`); the 300-req/15-min budget was left untouched.
The one execution performed was an **in-process Express router simulation** that mounts only
the literal route-path strings copied from the repo's route files — no application code, no
database, no network. Script retained at
`%TEMP%/claude/.../scratchpad/shadow.js`.
**Date:** 2026-09-01 · **Branch:** `refactor` @ `c86c446`
**Line-number baseline:** the **working tree** as read, not the commit. `case.controller.js` had
one uncommitted hunk at `:1079-1096` (`+7` lines, EmployerProfile `canonicalData` construction)
at the time of analysis; every `case.controller.js` citation **after** line 1096 in this document
is offset `+7` from `c86c446`. All other files were clean.

---

# TASK 3 — Route-order and shadowing bugs

## T3.0 How Express resolves these

`router.use(prefix, subRouter)` matches when the request path starts with `prefix` followed by
`/` or end-of-string. If the sub-router then matches **no** route, it calls `next()` and the
parent router continues to the next mount. So a shorter prefix mounted **after** a longer one
only shadows the paths the earlier router actually defines — not the whole namespace.

That distinction is what makes the reported finding precise rather than catastrophic, and it
is why it had to be resolved per-endpoint rather than per-prefix.

## T3.1 Verification method

```js
// scratchpad/shadow.js  (abridged) — mounts ONLY path strings, in routes/index.js order
api.use("/uscis-forms", uscisFormsR);            // routes/index.js:23
api.use("/uscis/forms", importR);                // routes/index.js:24
api.use("/uscis",       lifecycleR);             // routes/index.js:25
api.use("/forms",       formGenR);               // routes/index.js:26
api.use("/forms",       uscisFormsR);            // routes/index.js:27
api.use("/",            collabR);                // routes/index.js:29
api.use("/cases",       casesR);                 // routes/index.js:30
```

Each leaf handler answers with its own `module:METHOD path` identity; probes were fired against
an ephemeral in-process `127.0.0.1` listener.

### Raw output

```
GET    /api/uscis/forms                        -> uscis-form-import:GET /
GET    /api/uscis/forms/I-129/versions         -> uscis-lifecycle:GET /forms/:formType/versions
GET    /api/uscis/forms/I-129/compare/2024     -> uscis-lifecycle:GET /forms/:formType/compare/:version
POST   /api/uscis/forms/import                 -> uscis-form-import:POST /import
POST   /api/uscis/forms/scan                   -> uscis-lifecycle:POST /forms/scan
POST   /api/uscis/forms/07-2025/approve        -> uscis-lifecycle:POST /forms/:version/approve
POST   /api/uscis/forms/07-2025/activate       -> uscis-form-import:POST /:id/activate
POST   /api/uscis/forms/07-2025/retire         -> uscis-form-import:POST /:id/retire
POST   /api/forms/definitions/validate         -> form-generation:POST /:caseFormId/validate
POST   /api/forms/definitions/import           -> uscis-forms:POST /definitions/import
GET    /api/forms/registry                     -> uscis-forms:GET /registry
GET    /api/forms/case/abc123                  -> uscis-forms:GET /case/:caseId
POST   /api/forms/packages/generate            -> form-generation:POST /packages/generate
GET    /api/cases/abc123/timeline              -> case-collaboration:GET /cases/:caseId/timeline
GET    /api/cases/abc123                       -> cases:GET /:id
GET    /api/cases/my                           -> cases:GET /my
```

## T3.2 ✅ **The prior finding is CONFIRMED — exactly four, and these four**

**Claim:** *"`/uscis/forms` is mounted before `/uscis` in `routes/index.js`, causing four
lifecycle endpoints to resolve to the form-import module instead."*

**Verdict: CONFIRMED, precisely.** `routes/index.js:24` mounts
`modules/uscis-form-import/routes/uscisFormImportRoutes` at `/uscis/forms`; `routes/index.js:25`
mounts `modules/uscis-lifecycle/routes/uscisLifecycleRoutes` at `/uscis`. Every one of the
lifecycle router's eight routes lives under `/forms`, so all eight requests enter the import
router first. Four of them find a matching import route and are consumed there; the other four
fall through and reach the lifecycle module as intended.

| # | Intended endpoint | Intended handler | **Actually reaches** | Impact |
|---|---|---|---|---|
| 1 | `GET /api/uscis/forms` | `USCISLifecycleController.listForms` (`uscisLifecycleRoutes.js:9`) | `USCISFormImportController.list` (`uscisFormImportRoutes.js:23`) | Returns the **import catalogue** instead of the lifecycle form list. Silent wrong-shape response — no error, so a consumer sees a plausible-looking but different payload. |
| 2 | `POST /api/uscis/forms/import` | `USCISLifecycleController.importForm` (`uscisLifecycleRoutes.js:12`) | `USCISFormImportController.importFromUrl` (`uscisFormImportRoutes.js:34`) | Different import pipeline entirely. Both are SA/A + `forms:create`, so no privilege change — but `normalizeImportBody`/`validateSystemImport` run instead of the lifecycle validator, so a lifecycle-shaped body 400s. |
| 3 | `POST /api/uscis/forms/:version/activate` | `USCISLifecycleController.activate` (`uscisLifecycleRoutes.js:15`) | `USCISFormImportController.activate` (`uscisFormImportRoutes.js:36`) | `:version` (e.g. `"07-2025"`) is consumed as `:id`, an **import-record ObjectId**. A version string is never a valid ObjectId → CastError → 500 (or 404). **The lifecycle activate step is unreachable.** |
| 4 | `POST /api/uscis/forms/:version/retire` | `USCISLifecycleController.retire` (`uscisLifecycleRoutes.js:16`) | `USCISFormImportController.retire` (`uscisFormImportRoutes.js:37`) | Same as #3. **The lifecycle retire step is unreachable.** |

**Not shadowed** (verified, contradicting a naive "whole prefix is swallowed" reading):
`GET /forms/:formType/versions`, `GET /forms/:formType/compare/:version`, `POST /forms/scan`,
`POST /forms/:version/approve` — the import router defines no matching route at those
shapes (`/:id/versions`, a 3-segment `/:id/compare/:x`, `/scan`, `/:id/approve` do not exist
there), so each falls through to the lifecycle router.

**Net effect:** the USCIS form lifecycle can be **scanned and approved but never activated or
retired**, and its form list never renders. The state machine is broken at its last two
transitions.

**Fix:** swap `routes/index.js:24` and `:25` — mount `/uscis` **before** `/uscis/forms`? No:
that would shadow the import module instead. The correct fix is to **rename one namespace**,
e.g. mount the import router at `/uscis/form-import` (`routes/index.js:24`), or move the
lifecycle routes off the `/forms` sub-path. Two sibling routers cannot safely share
`/uscis/forms` while both define `/` and `/:x/{activate,retire}`.

## T3.3 Two further shadowing bugs of the same class

### (a) `POST /api/forms/definitions/validate` → **form-generation**, not uscis-forms

`routes/index.js:26` mounts `form-generation` at `/forms`; `:27` mounts `uscis-forms` at the
same `/forms`. `formGenerationRoutes.js:12` declares `POST /:caseFormId/validate`, which
matches `/definitions/validate` with `caseFormId === "definitions"` and consumes it before
`uscis-form.routes.js:15`'s `POST /definitions/validate` is ever reached.

| | |
|---|---|
| Intended | `uscis-form.controller.ctrl.validateDefinition` — SA/A + `forms:create` |
| Actual | `FormGenerationController.validate` — STAFF + `forms:read` + `requireCaseFormAccess` |
| Impact | `requireCaseFormAccess` does `CaseForm.findById("definitions")` → CastError. **Endpoint is dead** on the `/forms` alias. It still works at `POST /api/uscis-forms/definitions/validate` (`routes/index.js:23`), which is why this has not been noticed. |
| Note | `POST /api/forms/definitions/import` is **not** shadowed — form-generation has no `/:caseFormId/import`. Verified. |

**Fix:** stop double-mounting `uscis-form.routes` at `/forms` (`routes/index.js:27`), or move
form-generation to its own prefix (e.g. `/form-generation`).

### (b) `GET /api/cases/:id/timeline` → **case-collaboration**, not cases

`routes/index.js:29` mounts `case-collaboration/routes/collaborationRoutes` at the API root
`"/"`, **one line before** `/cases` at `:30`. `collaborationRoutes.js:7` declares
`GET /cases/:caseId/timeline`, so it wins over `case.routes.js:118`'s `GET /:id/timeline`.

| | |
|---|---|
| Intended | `case.controller.getTimeline` (`case.controller.js:2032-2043`) — `getAccessibleCaseOrThrow`, returns `caseData.timeline` |
| Actual | `CollaborationController.timeline` — `CollaborationService` merged activity feed |
| Impact | **Silent semantic divergence**, not an error: both are 200s with a `timeline`, both are case-scoped (`CollaborationService.js:17` `canAccessCase`), but the payloads differ. `case.controller.getTimeline` is dead code. Authorization is equivalent, so this is a correctness/dead-code bug, not a security bug. |
| Not shadowed | `/comments`, `/tasks`, `/requests`, `/readiness`, `/assignments` — `case.routes.js` declares none of these. |

**Fix:** mount collaboration at an explicit prefix, or delete the now-unreachable
`case.controller.getTimeline` and its route (`case.routes.js:118`).

## T3.4 Mount-order checks that came back **clean**

| Pair | `routes/index.js` | Verdict |
|---|---|---|
| `/uscis-forms` (`:23`) vs `/uscis` (`:25`) | | ✅ `/uscis` does not prefix-match `/uscis-forms` — after `/uscis` comes `-`, not `/` |
| `/eligibility-quiz/admin` (`:59`) before `/eligibility-quiz` (`:60`) | | ✅ longer prefix first |
| `/consultation-routing` (`:61`) before `/consultation` (`:62`) | | ✅ longer prefix first |
| `/petition-intelligence` (`:47`) before `/petition` (`:48`) | | ✅ longer prefix first |
| `/document-intelligence` (`:46`) vs `/documents` (`:45`) | | ✅ disjoint |
| `/audit` (`:16`) vs `/audit-logs` (`:18`) | | ✅ disjoint segments |
| `/cases` (`:30`) vs `/cases` autofill (`:31`) | | ✅ `case.routes` declares no `/:id/forms/...`; autofill's 3+-segment shapes fall through cleanly |

## T3.5 Intra-file param-shadowing checks — all **clean**

Every route file was checked for a `/:param` route declared before a more specific literal
path at the same depth. **No violations found.** Representative confirmations:

| File | Evidence |
|---|---|
| `users/user.routes.js` | `/dashboard`, `/assignable`, `/case-managers`, `/presence` (`:40-47`) all precede `/:id` (`:50`); `/:id/activity` + `/:id/performance` (`:48-49`) precede `/:id` |
| `cases/case.routes.js` | `/my`, `/config`, `/dashboard/*`, `/bulk`, `/create-with-client` (`:14-57`) all precede `/:id` (`:65`) |
| `uscis-forms/uscis-form.routes.js` | `/registry*`, `/sync*`, `/definitions/*`, `/check-updates`, `/case*` (`:9-52`) all precede `/:id/pdf` and `/:id` (`:53-54`) |
| `questionnaires/questionnaire.routes.js` | `/library`, `/question-library*`, `/defaults*`, `/case/:caseId*`, `/import`, `/ai-generate`, `/responses/:responseId*` (`:14-27`) all precede `/:id` (`:29`) |
| `messages/message.routes.js` | `/case/:caseId`, `/unread-count`, `/search`, `/analytics/summary`, `/templates*`, `/conversations/:id*` (`:12-21`) all precede `/:threadId` (`:41`) |
| `documents/document.routes.js` | `/me`, `/user/:userId`, `/folders`, `/missing`, `/evidence/*`, `/requests`, `/bulk*`, `/uploads/*`, `/upload` (`:14-51`) all precede `/:id*` (`:64+`) |
| `audit/audit.routes.js` | `/summary`, `/export`, `/user/:userId`, `/entity/:t/:i` (`:9-12`) precede `/:id` (`:13`) |
| `notifications/notification.routes.js` | all literal paths (`:11-94`) precede `/:id/*` (`:96-102`) |
| `document-intelligence/*.routes.js` | `/dashboard`, `/review-queue`, `/analyses*`, `/evidence-categories`, `/upload`, `/autofill`, `/case/*`, `/documents/*` (`:21-39`) precede `/:id*` (`:41+`) |
| `tasks/task.routes.js` | `/stats/dashboard`, `/calendar`, `/my-tasks`, `/team-tasks`, `/bulk-status` (`:12-16`) precede `/:id` (`:18`) |
| `payments/payment.routes.js` | `/summary`, `/create-*`, `/confirm-*`, `/dashboard/stats`, `/gateway/*`, `/requests*`, `/ledger`, `/webhooks/*`, `/reconciliation/*`, `/reports` (`:21-51`) precede `/:id` (`:64`) |
| `workflows/workflow.routes.js` | `/templates*`, `/trigger`, `/sla/check`, `/scheduled/process`, `/retries/process`, `/cases/:caseId/start`, `/analytics/summary` (`:11-28`) precede `/:id` (`:32`) |

## T3.6 Structural sibling: the unmounted `sync` router

`Backend/src/modules/sync/sync.routes.js` is never mounted — `routes/index.js` has no `/sync`
entry, and `grep -rn "sync.routes\|sync/sync" Backend/src` finds no `require` of it. Its 11
routes (`:9, 18, 27, 42, 51, 60, 69, 70, 71, 72, 73`) are `authenticate`-only with **no role,
permission or ownership check** and would expose every `Client`, every `Case`, and arbitrary
case status writes. Not a shadowing bug, but the same class of mounting defect (a file that
looks live and is not) and a landmine if anyone "fixes" it by wiring it up.

---

# TASK 4 — Negative Workflow Matrix (§24)

Enforcement key: **SERVER** = real, server-side, non-bypassable · **CLIENT-ONLY** = only a
frontend guard exists · **ABSENT** = neither · **PARTIAL** = enforced on some paths only.

## Summary

| # | Forbidden action | Enforcement | Live-verifiable? |
|---|---|---|---|
| 1 | Public quiz creating a Case | **SERVER** ✅ | Yes |
| 2 | Client intake creating a Case | **SERVER** ✅ | Yes |
| 3 | Unapproved lead converting to a Case | **ABSENT** ❌ | Yes |
| 4 | Employee A accessing Employee B's case/profile | **SERVER** ✅ | Yes |
| 5 | Employee accessing employer internal data | **PARTIAL** ⚠ (read SERVER, write asymmetric) | Yes |
| 6 | Client calling an admin endpoint | **SERVER** ✅ | Yes |
| 7 | Case Manager accessing an unauthorized case | **PARTIAL** ⚠ (43 endpoints unguarded) | Yes |
| 8 | Case Manager deleting a case | **PARTIAL** ⚠ (`DELETE` blocked, bulk-archive open) | Yes |
| 9 | Duplicate case creation on retry / double-click | **PARTIAL** ⚠ (state guard, no idempotency key, race window) | Yes |
| 10 | Questionnaire required before forms provisioned — **MUST NOT be required** | **CORRECTLY NOT ENFORCED** ✅ | Yes |
| 11 | Direct URL navigation bypassing RBAC | **SERVER** ✅ for role gates; inherits #7's gaps | Yes |

---

## T4.1 Public quiz creating a Case — **SERVER ✅**

| | |
|---|---|
| Surface | `POST /api/eligibility-quiz/submit` — `modules/eligibility-quiz/quiz.routes.js:35` (public, `optionalAuthenticate`, 60/min limiter `:13-18`) |
| Enforcement | `quiz.service.js:83` → `submit()` calls `rejectIfHasCase(req)` first, then scores and creates **only** a `Lead`. `Case` is `require`d at `quiz.service.js:9` **solely** for the `Case.exists()` duplicate check at `:29` — there is no `Case.create`/`new Case` anywhere in the module. |
| Secondary guard | `quiz.service.js:26-35` — if a logged-in submitter already owns a case, 409 `CASE_EXISTS`. Comment at `:21-25` documents this as defense-in-depth behind the frontend's `BlockIfHasCase`. |
| Frontend (not relied on) | `BAIS/Frontend/src/components/eligibility/BlockIfHasCase.jsx` |
| Verdict | **Server-side. Real.** Case creation is structurally impossible from this endpoint — the only `Case` write path is `POST /api/cases` (`case.routes.js:22`, SA/A/TL) and `POST /api/cases/create-with-client` (`:40`, STAFF). |

**Live probe:**
```
POST /api/eligibility-quiz/submit
Content-Type: application/json
(no Authorization header)
{ "visaPathway":"EB1A", "email":"probe+quiz@example.com", "fullName":"Probe User",
  "criteriaAnswers":[{"key":"awards","value":2}] }
```
**PASS =** 201/200 whose body contains a lead/score/recommendation and **no** `caseId`/`case`.
Confirm with `db.cases.countDocuments({clientEmail:"probe+quiz@example.com"}) === 0`.
Repeat with a valid client Bearer token whose account already has a case → **expect 409 `CASE_EXISTS`**.

## T4.2 Client intake creating a Case — **SERVER ✅**

| | |
|---|---|
| Surface | `POST /api/client-intake/me/submit` — `client-intake.routes.js:22-30` (`authenticate` + `authorizeRoles("client","user")` + `clients:update`) |
| Enforcement | `client-intake.service.js:271` — `submitMyIntake` resolves the case via `assertCaseAccess(caseId, user)` (`:235-237` → `getAccessibleCaseOrThrow`) or `getActiveCaseForClient(client, user)` (`:222-232`). Both **look up an existing case**; neither creates one. No `Case.create`/`new Case` exists in the file — the only `Case` write is via an already-fetched document. |
| Related | `POST /api/leads/from-intake` (`lead.routes.js:43-49`) carries an explicit invariant at `lead.controller.js:89-91`: *"never creates a Case document, User document, Client document, or any canonical/form data."* |
| Verdict | **Server-side. Real.** |

**Live probe:**
```
POST /api/client-intake/me/submit          Authorization: Bearer <client with NO case>
{ }
```
**PASS =** 403/404 (no accessible case) or 200 that mutates only the intake — never a new `Case`.
Then: `POST /api/leads/from-intake` with a client token → **PASS =** 201 with a `lead` and
`db.cases` count unchanged.

## T4.3 Unapproved lead converting to a Case — **ABSENT ❌**

**This is the one negative-workflow rule with no server-side enforcement at all.**

The lead state machine is real and documented — `quiz.service.js:257-262`:

> *"The four functions below enforce the Phase 6 lead state machine
> (new/booked → consultation_confirmed → consultation_completed → **approved** →
> [converted, **handled entirely by POST /api/cases**] …)"*

Each transition validates its predecessor:
`confirmConsultation` requires `new|booked` (`quiz.service.js:265-267`);
`completeConsultation` requires `consultation_confirmed` (`:285-287`);
`approveLead` sets `status="approved"` (`:301-310`).

But the final `approved → converted` hop is delegated to `POST /api/cases`, and
`case.controller.js:778-844` performs **only three** lead checks:

```
case.controller.js:825   if (creationSource === "lead_conversion" && !leadId)   -> 400 LEAD_REQUIRED
case.controller.js:835   const sourceLead = leadId ? await Lead.findById(leadId) : null;
case.controller.js:836   if (creationSource === "lead_conversion" && !sourceLead) -> 404 LEAD_NOT_FOUND
case.controller.js:839   if (sourceLead?.convertedCaseId)                       -> 409 LEAD_ALREADY_CONVERTED
...
case.controller.js:1160  if (creationSource === "lead_conversion" && sourceLead) {
case.controller.js:1161    sourceLead.status = "converted";
```

**There is no `if (sourceLead.status !== "approved")` anywhere.** `Lead.status` (`models/Lead.js:69-85`)
admits `new, contacted, booked, converted, closed, consultation_requested,
consultation_scheduled, consultation_confirmed, consultation_completed, approved, rejected` —
and a lead in **any** of those states (including `new` and, critically, **`rejected`**) converts
successfully. `case.controller.js:1161` then stamps it `converted`, laundering the illegal
transition into a legal-looking terminal state.

Compounding it: `PATCH /api/eligibility-quiz/leads/:id/status` (`quiz.routes.js:42`) is described
in-file at `:47-48` as *"an unrestricted admin override"* with no transition validation, so even
the documented state machine can be sidestepped from the same admin surface.

| | |
|---|---|
| Enforcement | **ABSENT** — not server-side, and no client-side guard was found either (no `status === "approved"` gate on a convert control) |
| Blast radius | SA / A / TL (the `PHASE5_CASE_CREATE_ROLES` set, `case.controller.js:65`) |
| Fix | Insert after `case.controller.js:840`: `if (creationSource === "lead_conversion" && sourceLead.status !== "approved") return res.status(409).json({success:false, code:"LEAD_NOT_APPROVED", message:"Lead must be approved before conversion"});` |

**Live probe (2 calls):**
```
1) POST /api/leads                    (public)
   { "fullName":"Probe Lead","email":"probe+lead@example.com","phone":"+15550100" }
   -> capture lead._id ; confirm status === "new"

2) POST /api/cases                    Authorization: Bearer <admin>
   { "clientName":"Probe Lead", "clientEmail":"probe+lead@example.com",
     "visaType":"H-1B", "creationSource":"lead_conversion", "leadId":"<lead._id>" }
```
**Expected-correct =** 409 `LEAD_NOT_APPROVED`.
**Actual (predicted) = 201 Created**, with the lead flipped to `converted`.
A 201 here **proves the finding**. Repeat with a lead PATCHed to `"rejected"` first
(`PATCH /api/eligibility-quiz/leads/:id/status`) — that should be the loudest failure.

## T4.4 Employee A accessing Employee B's case/profile — **SERVER ✅**

Two independent, correctly-implemented layers.

**Case access** — `case.service.js:102-104`:
```
function canAccessCase(user, caseData) {
  const role = normalizeRole(user.role);
  if (isRestrictedPortalRole(role)) return canAccessRestrictedChildCase(user, caseData, role);
```
`isRestrictedPortalRole` (`:67-69`) short-circuits `employee`/`beneficiary` **before** any of the
broad ownership fall-throughs at `:107-125`. `canAccessRestrictedChildCase` (`:71-84`) then
requires **all three** of:
1. `normalizeRole(caseData.caseRole) === role` (`:73`) — it must be a child case of your own kind
2. `userCaseIdSet(user).has(String(caseData._id)) || sameId(caseData.user, user._id)` (`:76-78`)
3. `parentCase === user.principalCaseId` when `user.principalCaseId` is set (`:80-82`)

**List queries** — `applyCaseRoleFilter` (`:128-142`) routes `employee` and `beneficiary` to
`buildRestrictedCaseOwnershipFilter` (`:86-94`), which returns `{_id: null}` when the user has no
`caseIds` — a fail-closed empty result, not an unfiltered one.

**Profile access** — `employee-profile.service.js:34-45`:
```
async function canAccess(caseId, user, childCase) {
  if (STAFF_ROLES.has(user.role)) return true;
  if (!userCaseIdSet(user).has(String(caseId))) return false;
  if (RESTRICTED_PORTAL_ROLES.has(user.role)) {
    if (!childCase) return false;
    if (childCase.caseRole !== user.role) return false;
    if (user.principalCaseId && String(childCase.parentCase || "") !== String(user.principalCaseId)) return false;
  }
  return true;
}
```
Called on both read (`:48`) and write (`:60`). The invariant is written out at `:28-33`:
*"there is deliberately no broader 'any sibling' or 'any employer' read/write grant here."*

| Verdict | **Server-side. Real, and the strongest gate in the codebase.** |

**Live probe:**
```
GET /api/employee-profile/<Employee B childCaseId>   Authorization: Bearer <Employee A>
GET /api/cases/<Employee B childCaseId>              Authorization: Bearer <Employee A>
GET /api/cases                                       Authorization: Bearer <Employee A>
```
**PASS =** 403 `"Access denied"`, 403 `"Not authorized to access this case"`, and a list
containing **only** A's own child case.
⚠ Also fire the bypass route: `GET /api/eligibility/<Employee B childCaseId>/results` with A's
token — that one is expected to **leak** (see T4.7).

## T4.5 Employee accessing employer internal data — **PARTIAL ⚠ (read blocked, write asymmetric)**

**Read: correctly blocked.** `employer-profile.service.js:49-55`:
```
async function canRead(principalCaseId, user) {
  if (STAFF_ROLES.has(user.role)) return true;
  if (RESTRICTED_PORTAL_ROLES.has(user.role)) return false;   // <-- employee/beneficiary
  const ids = userCaseIdSet(user);
  if (ids.has(String(principalCaseId))) return true;
  return false;
}
```
Invariant at `:45-48`: *"EmployerProfile has exactly one full read/write path. Invited
employee/beneficiary accounts use `getEmployerProfileSummaryForUser()` for a minimized
read-only summary and never receive the full EmployerProfile."* The summary path
(`:66-81`) returns only `legalName`, `dbaName` and primary-contact fields
(`summarizeEmployerProfile`, `:31-43`) — no financials, no EIN.

**Write: the guard is not mirrored.** `employer-profile.service.js:57-60`:
```
async function canWrite(principalCaseId, user) {
  if (STAFF_ROLES.has(user.role)) return true;
  return userCaseIdSet(user).has(String(principalCaseId));    // <-- no RESTRICTED_PORTAL_ROLES check
}
```
`canWrite` omits the `RESTRICTED_PORTAL_ROLES` denial that `canRead` has. An `employee` or
`beneficiary` whose `caseIds` ever contains the **principal** case id — which is exactly what
happens under `dataEntryMode: "fill_self"` before an invite is accepted, per the comment at
`employee-profile.service.js:28-33` — could `POST /api/employer-profile/:principalCaseId` and
write employer canonical data they are forbidden to read. Route: `employer-profile.routes.js:13`
(`authenticate` only).

| Verdict | Read **SERVER ✅**. Write **PARTIAL ⚠** — a defense-in-depth gap, not a confirmed live break. |
| Fix | Add `if (RESTRICTED_PORTAL_ROLES.has(user.role)) return false;` as the second line of `canWrite`. |

**Live probe:**
```
GET  /api/employer-profile/<principalCaseId>          Authorization: Bearer <employee>
GET  /api/employer-profile/summary/me                 Authorization: Bearer <employee>
POST /api/employer-profile/<principalCaseId>          Authorization: Bearer <employee>
     { "fields": { "legalName": "TAMPERED" }, "source": "employee_portal" }
```
**PASS =** 403 on the first; 200 with **only** name/dba/contact on the second; **403 on the third**.
A 200 on the third confirms the `canWrite` asymmetry. Verify no `EmployerProfile.canonicalData.legalName` mutation.

## T4.6 Client calling an admin endpoint — **SERVER ✅**

`modules/admin/admin.routes.js:6` applies a **router-level** gate before any handler:
```
router.use(authenticate, authorizeRoles("admin", "super_admin"));
```
`authorizeRoles` (`middleware/authorizeRoles.js:5-9`) 403s on `hasRole` failure;
`hasRole` (`rbac.service.js:4-8`) matches the raw role and its normalized form only — a `client`
matches neither `"admin"` nor `"super_admin"`. `DELETE /demo-data` adds a second gate
(`admin.routes.js:13`, `authorizeRoles("super_admin")`).

The same router-level pattern secures the other admin surfaces:
`eligibility-quiz/admin/quizAdmin.routes.js:7` (`authenticate` + SA/A + `eligibility_quiz:admin`),
`team-management.routes.js:6-7`, `settings.routes.js:7-8`, `users/user.routes.js:51-54`.

Belt-and-braces at the permission layer: `client` has no `users:*`, `settings:*`,
`audit:*`, `billing:*`, `analytics:*`, `entity_config:*` or `leads:*` grants
(`permissions.registry.js:49`), so even a route missing `authorizeRoles` (e.g.
`GET /api/users/:id`, `user.routes.js:50`) still 403s for clients on `authorizePermissions`.

| Verdict | **Server-side. Real.** |

**Live probe (fire all five with one client Bearer token — all must be 403):**
```
GET    /api/admin/overview
GET    /api/admin/users
DELETE /api/admin/demo-data
GET    /api/settings
GET    /api/users
GET    /api/eligibility-quiz/leads
GET    /api/audit
```
**PASS =** 403 `"User role client is not authorized to access this route"` (or
`"Missing required permission"`) on every one. Any 200 or 500 is a failure.

## T4.7 Case Manager accessing an unauthorized case — **PARTIAL ⚠**

**Where it works.** `case.service.js:116`:
```
if (role === "case_manager") return sameId(caseData.assignedCaseManager, user._id)
                                 || sameId(caseData.primaryOwner, user._id);
```
and for lists, `applyCaseRoleFilter` (`:130`) `$and`s in
`{$or:[{assignedCaseManager:user._id},{primaryOwner:user._id},{secondaryOwner:user._id}]}`.
This is correctly reached by `GET /api/cases/:id` (`case.controller.js:660`),
`PUT /api/cases/:id` (`:1242`), all `/workflow/*` and `/knowledge-plan*` routes
(`case-lifecycle-orchestrator.service.js:221,437,532`), every `/api/uscis-forms/case/**` route
(`uscis-form.service.js:260`), all `/api/canonical/*` (`CanonicalProfileService.js:121,129,170,211,308,359`),
`/api/documents/*` (`document.service.js:71-73`), `/api/messages/*` (`message.service.js:91,107`),
`/api/payments/*` (`payment.service.js:44`), `/api/lifecycle/*`, `/api/petition-intelligence/*`,
`/api/questionnaires/*` (`questionnaire.service.js:727,1117,1996,2255,2318`), and
`POST /api/cases/bulk` (`case.service.js:657`).

**Where it does not.** 43 endpoints are role-gated but never resource-checked. `case_manager`
holds `cases:read`, `cases:update`, `forms:read`, `forms:update`, `forms:approve`
(`permissions.registry.js:41`), which is sufficient for every one of them:

| Cluster | Route file:line | Missing-check evidence |
|---|---|---|
| `/api/eligibility/*` (6) | `eligibilityRoutes.js:9-14` | `grep -rn "canAccessCase\|403" modules/eligibility-engine/` → **0 matches** |
| `/api/cases/:caseId/forms/:formType/*` (10) | `autoFillRoutes.js:8-17` | `grep -rn "canAccessCase\|403" modules/form-mapping/` → **0 matches** |
| `/api/petition/**` (11) | `petition.routes.js:16-27` | only `PetitionAssemblyService.js:231` has a check, reached by `assemble` alone; `petition.controller.js:20-27,29-37` are raw `find`/`findById` |
| `case.controller` gaps (5) | `case.routes.js:129,133,137,138,126` | `getCaseOr404` (`case.controller.js:374-381`, **404-only**) with no following `canAccessCase` at `:2197, 2115, 2282, 2304, 2390` |
| `/api/case-managers/:id/*` (5) | `case-manager.routes.js:11-15` | no self/team check — any CM reads any other CM's cases/payments/analytics |
| `/api/users/:id*` (3) | `user.routes.js:48,49,50` | no self/team check |
| `POST /api/forms/packages/generate` | `formGenerationRoutes.js:10` | the only route in that file without `requireCaseFormAccess` |
| `POST /api/workflows/cases/:caseId/start` | `workflow.routes.js:27` | `workflow.controller.js:154-164` bare `Case.findById`; `grep -rn "canAccessCase" modules/workflows/` → **0 matches** |
| `PUT /api/calendar/availability/:userId` | `calendar.routes.js:29` | arbitrary `userId` |

| Verdict | **PARTIAL** — the primitive is correct and widely applied, but 43 endpoints route around it. |

**Live probe (Case Manager A's token, Case Manager B's `caseId`):**
```
GET  /api/cases/<B-caseId>                                   -> expect 403   (control: proves the gate works)
GET  /api/eligibility/<B-caseId>/results                     -> expect 403, PREDICT 200
GET  /api/cases/<B-caseId>/forms/I-129/preview               -> expect 403, PREDICT 200
GET  /api/petition/cases/<B-caseId>/packages                 -> expect 403, PREDICT 200
POST /api/cases/<B-caseId>/approve-questionnaire  {}         -> expect 403, PREDICT 200
POST /api/cases/<B-caseId>/checklist/generate     {}         -> expect 403, PREDICT 200
PUT  /api/cases/<B-caseId>/reopen                 {}         -> expect 403, PREDICT 200
GET  /api/case-managers/<B-userId>/cases                     -> expect 403, PREDICT 200
POST /api/workflows/cases/<B-caseId>/start        {}         -> expect 403, PREDICT 201
```
Any 200/201 where 403 is expected **proves** the corresponding row. The first call is the
control — it must be 403, otherwise the test fixture is wrong.

## T4.8 Case Manager deleting a case — **PARTIAL ⚠**

**Direct delete: blocked.** `case.routes.js:67`:
```
router.delete("/:id", authenticate, authorizeRoles("super_admin","admin"),
              authorizePermissions("cases:delete"), ctrl.archiveCase);
```
Double-gated: `case_manager` is excluded by `authorizeRoles`, **and** `cases:delete` is absent
from its grant list (`permissions.registry.js:41` has `cases:read`, `cases:create`,
`cases:update` — deliberately no `cases:delete`; contrast `team_lead`'s `cases:*` at `:58`).

**Bulk archive: open.** `case.routes.js:20`:
```
router.post("/bulk", authenticate, authorizeRoles(...managerRoles),
            authorizePermissions("cases:update"), ctrl.bulkActions);
```
`managerRoles` (`case.routes.js:12`) = `["super_admin","admin","team_lead","case_manager"]`, and
the permission required is `cases:update` — which `case_manager` **has**.
`case.service.js:660` then executes the archive:
```
case.service.js:657   if (!canAccessCase(user, caseData)) { return {...success:false...}; }
case.service.js:660   if (action === "archive")  await archiveCase(caseData, user, req);
case.service.js:661   else if (action === "reopen") await reopenCase(caseData, user, req);
```

So a `case_manager` **can** archive (soft-delete) any case they are assigned to, via
`POST /api/cases/bulk` with `action:"archive"` — reaching the exact same `archiveCase` service
function that `DELETE /api/cases/:id` is restricted to SA/A for. The `canAccessCase` guard at
`:657` limits the blast radius to their **own** cases, but the role restriction on deletion is
nonetheless bypassed.

The same route also exposes `action:"reopen"` to `case_manager`, mirroring the separately-broken
`PUT /:id/reopen` (T4.7).

| Verdict | **PARTIAL** — the named delete endpoint is properly gated; an unnamed alias for the same operation is not. |
| Fix | In `case.service.js:660`, require `isAdmin(user)` for `action === "archive"`; or narrow `case.routes.js:20` to `authorizeRoles("super_admin","admin","team_lead")` and split destructive bulk actions onto their own permission (`cases:delete`). |

**Live probe (2 calls, Case Manager's own `caseId`):**
```
1) DELETE /api/cases/<own-caseId>            Authorization: Bearer <case_manager>
   -> expect 403  "User role case_manager is not authorized to access this route"

2) POST /api/cases/bulk                      Authorization: Bearer <case_manager>
   { "caseIds": ["<own-caseId>"], "action": "archive" }
   -> expect 403 ; PREDICT 200 with a per-id success entry
```
A 403 on (1) plus a 200-with-success on (2) **proves** the bypass. Verify
`db.cases.findOne({_id:<own-caseId>}).status === "archived"`. Use a throwaway case — this is a
destructive probe (soft delete; recoverable via `PUT /:id/reopen`).

## T4.9 Duplicate case creation on retry / double-click — **PARTIAL ⚠**

**No idempotency-key mechanism exists for case creation.** `Idempotency-Key` is CORS-allowed
(`app.js:43`), but `grep -rn "idempotency" Backend/src` shows it consumed **only** by the
payments module (`payment.service.js:69,73,160-161,183`; `models/PaymentRequest.js:6` carries the
`unique: true` index that actually enforces it). `case.controller.js` never reads
`req.headers["idempotency-key"]`.

What does exist are **state-based** guards inside `createCase`:

| Guard | File:line | Blocks |
|---|---|---|
| `sourceLead.convertedCaseId` → 409 `LEAD_ALREADY_CONVERTED` | `case.controller.js:839-844` | a second conversion of the same lead |
| existing user is non-client → 409 `EMAIL_OWNED_BY_NON_CLIENT` | `:854-859` | email collision with staff |
| `existingUser.primaryCaseId \|\| existingUser.caseIds.length` → 409 `CLIENT_ALREADY_HAS_CASE` | `:860-865` | a second case for the same client email |
| `rejectIfHasCase` → 409 `CASE_EXISTS` | `quiz.service.js:26-35` | the quiz funnel |

These make a **sequential** double-submit fail correctly with a 409. But:

1. **Read-then-write race.** `User.findOne` (`:853`) → checks (`:854-865`) → `User`/`Case` writes
   (`:1036+`) are not wrapped in a transaction and there is no unique index enforcing
   "one primary case per user". Two concurrent identical requests — precisely the double-click
   case — can both pass `:860` before either writes. The compensating logic at
   `cleanupPhase5Create` (`case.controller.js:140-155`) unwinds a *failed* create; it does not
   detect a concurrent duplicate.
2. **Case-number allocation is outside any lock.** `CaseNumberService.nextPrincipalCaseNumber()`
   (`:867`) is called after the checks; two racing requests would draw two numbers.
3. **`POST /api/cases/create-with-client`** (`case.routes.js:40`) is a **second, differently-guarded**
   creation path. It does **not** carry `CLIENT_ALREADY_HAS_CASE`; instead
   `case.controller.js:2438-2452` returns 409 `CLIENT_ALREADY_REGISTERED` when the email already
   maps to a User **with a password**, and 409 `PENDING_CLIENT_INVITE` when
   `clientInviteService.isPendingClientInvite(existingUser)` is true. A sequential double-submit
   is therefore caught (the first request leaves a pending-invite User), but the guard keys on
   **account state, not case count** — so it does not prevent a second case for a client who
   already has one by another route, and it shares the same read-then-write race as `createCase`.
4. **No per-route rate limiter** on either create endpoint; only the global 300/15 min
   (`app.js:47-52`). Compare `checkoutLimiter` 10/min on payments (`payment.routes.js:13-19`).

| Verdict | **PARTIAL** — well-guarded against sequential retries, unguarded against a genuine concurrent double-submit. |
| Fix | Add a unique partial index on `users.primaryCaseId`, or accept an `Idempotency-Key` header in `createCase` and persist it the way `PaymentRequest` does (`models/PaymentRequest.js:6`). |

**Live probe (concurrency required — sequential will not reproduce it):**
```
Fire 2 IDENTICAL requests in parallel (same millisecond, e.g. two curl processes / Promise.all):
POST /api/cases    Authorization: Bearer <admin>
{ "clientName":"Dup Probe", "clientEmail":"probe+dup@example.com",
  "visaType":"H-1B", "creationSource":"admin_direct" }
```
**PASS =** exactly one 201 and one 409 `CLIENT_ALREADY_HAS_CASE`;
`db.cases.countDocuments({clientEmail:"probe+dup@example.com"}) === 1`.
**FAIL (predicted under true concurrency) =** two 201s and two Case documents.
Also send both with an identical `Idempotency-Key` header to confirm the header is ignored.
Then repeat sequentially — that **should** pass, and confirms the state guard works.

## T4.10 Questionnaire completion required before forms provisioned — **CORRECTLY NOT ENFORCED ✅**

This row inverts the others: the requirement is that such a gate **must not exist**. It does not.

**Forms are provisioned at case creation, before any questionnaire exists.**
`case-lifecycle-orchestrator.service.js:328-341`, invoked from `:306` during case
initialization, with the rationale at `:312-327`:

> *"Phase 13 — CaseForms belong to the case, not the questionnaire. As soon as a case's
> required form set is determinable (its visaType/petitionType/plan are known — true
> immediately at creation, **before any client, questionnaire, or document ever exists**), the
> actual filing case(s) should already have their USCIS forms assigned, so a case manager can
> open and edit the real form right away."*

It iterates the child cases (or the case itself for a `single` structure) and calls the
idempotent `uscisFormService.ensureAssignedForms(target, user, req)` (`:335`), swallowing
template-configuration errors (`:336-338`) so a form problem cannot block case creation.

**The generate/autofill endpoint has had its questionnaire gate explicitly removed.**
`case-lifecycle-orchestrator.service.js:452-459`:

> *"Deliberately not gated on questionnaire/document completion anymore — AutoFillService
> leaves any field with no resolvable value untouched (missingFields) and never overwrites a
> manually-reviewed/overridden field, so running this against a partially-answered case is
> always safe to repeat once more data arrives."*

The only remaining blocks on `POST /api/cases/:id/workflow/generate-forms` are:
- `canAccessCase` — 403 (`:437`)
- no `assignedCaseManager` and caller is not SA/A — 409 (`:438`)
- **unresolved canonical conflicts** — 422 `CANONICAL_NEEDS_REVIEW` (`:470-474`)

`hasCanonicalErrors` (missing required fields — i.e. incompleteness) is recorded as a
`blockingIssues` entry but, per the comment at `:463-469`, is deliberately **not** thrown;
only `hasUnresolvedConflicts` (two sources actively disagreeing) is fatal. That is a
correctness gate on bad data, not a completeness gate on the questionnaire.

`questionnaireComplete` (`:130-137, 159`) is computed for readiness/progress display and stage
inference (`:209`, `case-gating.config.js:27`) — but never used to withhold form provisioning.

| Verdict | **The forbidden coupling is absent. Correct.** |

**Live probe:**
```
1) POST /api/cases     Authorization: Bearer <admin>
   { "clientName":"Forms Probe","clientEmail":"probe+forms@example.com",
     "visaType":"H-1B","creationSource":"admin_direct" }
   -> capture case._id ; DO NOT touch any questionnaire

2) GET  /api/uscis-forms/case/<case._id>            Authorization: Bearer <admin>
3) POST /api/cases/<case._id>/workflow/generate-forms   Authorization: Bearer <admin>  {}
```
**PASS =** (2) returns a **non-empty** form list on a case with zero questionnaire answers, and
(3) returns 200/201 — **not** a 4xx citing questionnaire completion.
A 409/422 mentioning "questionnaire" on (3) would be a **regression** against this requirement.
(A 422 `CANONICAL_NEEDS_REVIEW` is *not* a failure — that is the intended conflict gate.)

## T4.11 Direct URL navigation bypassing RBAC — **SERVER ✅ for role gates**

**Client-side guards exist but are not the enforcement.**
`BAIS/Frontend/src/components/ProtectedRoute.jsx:15` (auth state) and `:9-13`
`BlockEmployeeRoute` (redirects `employee` accounts to `/dashboard/documents`);
`INSZoom/frontend/src/components/ProtectedRoute.jsx:5-51` checks `requiredRoles` (`:34`),
`requiredPermissions` (`:39-44`) and `canAccessModule` (`:49`), and force-logs-out client-portal
roles (`:9-11, 29-31`). All of these are **cosmetic** — bypassable by typing a URL, editing
`localStorage`, or calling the API directly.

**The server does not depend on them.** Every privileged route independently re-checks:
`authorizeRoles` (`middleware/authorizeRoles.js:3-13`) and `authorizePermissions`
(`middleware/authorizePermissions.js:3-11`) run per request, deriving the role from the JWT
subject re-loaded from Mongo/Redis in `authenticate.js:20-30` — **never** from a client-supplied
field. `tokenVersion` is re-verified on every request (`authenticate.js:28`), so a role change or
forced logout invalidates outstanding tokens immediately.

Router-level `router.use(...)` gates (`admin.routes.js:6`, `quizAdmin.routes.js:7`,
`team-management.routes.js:6-7`, `dataRights.routes.js:7`, `ai.routes.js:13`) mean the gate
cannot be skipped by a route added later in the file.

| Verdict | **Server-side. Real** — for the **role/permission** dimension. Direct navigation cannot escalate role. |
| Caveat | It **inherits the resource dimension's gaps**: typing a URL for a case you do not own works on the 43 endpoints in T4.7. RBAC is not bypassable; **object-level authorization is, on those routes**. |

**Live probe (browser + API, one client account):**
```
Browser: navigate directly to  /admin  ,  /dashboard/settings  ,  /teams
API    : GET /api/admin/overview        Authorization: Bearer <client>   -> expect 403
         GET /api/settings              Authorization: Bearer <client>   -> expect 403
         GET /api/team-members          Authorization: Bearer <client>   -> expect 403
```
**PASS =** the SPA redirects **and** every direct API call is 403 (the API result is the one
that matters). Then confirm the caveat:
`GET /api/petition/packages/<some other case's packageId>` with the same client token —
**expect 403, PREDICT 200**, which demonstrates that RBAC held while object-level authorization
did not.

---

## Consolidated remediation order

| P | Item | Fix location |
|---|---|---|
| **P0** | T4.3 — no `status === "approved"` gate on lead→case conversion | insert after `case.controller.js:840` |
| **P0** | T4.7 — `/api/petition/**` (11 routes) have no case-access check | `petition.controller.js:20-142` — add `canAccessCase` via the package's `caseId` |
| **P0** | T4.7 — `/api/cases/:caseId/forms/:formType/*` (10 routes) | `autoFillRoutes.js` — add a `requireCaseAccess` middleware, mirroring `requireCaseFormAccess.js` |
| **P0** | T4.7 — `/api/eligibility/*` (6 routes) | `EligibilityController.js` / `EligibilityEngineService` |
| **P1** | T3.2 — 4 USCIS-lifecycle endpoints unreachable | rename the `/uscis/forms` mount, `routes/index.js:24` |
| **P1** | T4.8 — `case_manager` can archive via `POST /api/cases/bulk` | `case.service.js:660` or `case.routes.js:20` |
| **P1** | T4.7 — 5 `case.controller` handlers use `getCaseOr404` with no `canAccessCase` | `case.controller.js:2115, 2197, 2282, 2304, 2390` |
| **P1** | T4.7 — `/api/case-managers/:id/*` cross-CM data exposure | `case-manager.routes.js:11-15` |
| **P2** | T4.9 — concurrent duplicate case creation | unique index on `users.primaryCaseId`, or honour `Idempotency-Key` |
| **P2** | T4.5 — `canWrite` missing the restricted-role denial | `employer-profile.service.js:57-60` |
| **P2** | T3.3(a) — `POST /api/forms/definitions/validate` dead | `routes/index.js:26-27` |
| **P3** | T3.3(b) — `case.controller.getTimeline` unreachable dead code | `case.routes.js:118` / `routes/index.js:29` |
| **P3** | T3.6 — delete or gate the unmounted `sync` router | `modules/sync/sync.routes.js` |
