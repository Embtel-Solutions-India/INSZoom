# Functional Audit — End-to-End Workflow (Lead → Case → Questionnaire → Forms)

**Date:** 2026-09-01
**Scope:** Adapted from the originating "Functional Audit and End-to-End Workflow Certification" prompt. Part 1 (Lead lifecycle: consultation booking, confirm-consultation, approve) and FUNC 7 (setup-credentials) were dropped before running anything — those endpoints do not exist in this codebase (see below) and running them would only have produced meaningless 404s. Everything else was run for real against the live server (:7000) and the live dev database, using real HTTP calls (not mocks), with real distinct user identities per role. All test data created was deleted afterward.

## Endpoint reality-check (done before running anything)

| Assumed in the prompt | Reality |
|---|---|
| `POST /leads/:id/consultation`, `PATCH /leads/:id/confirm-consultation`, `PATCH /leads/:id/approve` | **Do not exist.** `lead.routes.js` has exactly three endpoints: `POST /public`, `POST /` (quiz), `POST /from-intake`. Both lead-creation controllers are explicitly commented "NEVER creates a Case or User" — there is no automated lead-approval-to-case pipeline to test. |
| `POST /auth/setup-credentials` with `{caseId, token, password}` | **Does not exist.** Real flow is `GET /auth/invite/:token` + `POST /auth/invite/:token/accept` (token in the URL path). |
| `PATCH /uscis-forms/case/:caseId/forms/:formId/workspace/field` | Wrong path — real route (confirmed in Phase 13) is `PATCH /uscis-forms/case/:caseId/:formId/workspace/field`, no `/forms/` segment. |
| `POST /employer-profile/:id` body `{legalName, ein, address: {...}}` (flat/nested) | Wrong shape — real body is `{fields: {legalName, ein, "address.street", "address.city", ...}, source}`; `fields` values must be **flattened dot-paths**, not nested objects (`validateFieldPaths` 400s on a nested `address` object). |
| `GET /cases/:principalId/dashboard` | Not found in `case.routes.js`; the real per-case data comes through `GET /cases/my` / the case document itself, not a dedicated dashboard sub-route. |
| `PATCH /cases/:principalId/data-entry-mode`, `POST /cases/:principalId/invite-employee` | **Confirmed correct**, matches exactly. |

## Results (26 checks run against the real system)

**23/26 passed on the first fully-corrected run.** The 3 failures all trace to one root cause (below), not three separate bugs.

| Area | Result |
|---|---|
| Case creation transaction (H-1B, employer_employee, 2 children): principal/child roles, EmployerProfile, EmployeeProfile × 2, stub user `mustSetPassword=true`, CaseForms provisioned on **both** children with zero questionnaire data | **PASS**, all 7 checks |
| Single-visa structure (I-131) creates exactly 1 case, 0 children | **PASS** |
| `client` role blocked from `POST /cases` | **PASS** (403) |
| Employer questionnaire write does not contaminate either EmployeeProfile | **PASS** |
| DataEntryMode is one-time / irreversible (second attempt → 409 `DATA_ENTRY_MODE_ALREADY_SET`) | **PASS** |
| Employee invite flow: two distinct employees invited, distinct stub users, `mustSetPassword=true` | **PASS** |
| Employee A's questionnaire submission isolated to Employee A only; Employee B's own pre-seeded name (from their own invite, not contamination) confirmed distinct | **PASS**, after correcting a wrong test assumption (B's `firstName` is legitimately pre-seeded from the invite's `employeeName`, `source: "import"` — not a leak from A) |
| RBAC/IDOR, real distinct Employee A identity: blocked from principal case (403), blocked from EmployerProfile (403), blocked from sibling Employee B's profile (403), allowed into own case (200) | **PASS**, all 4 checks — no IDOR |
| `generate-forms` succeeds on both children with no questionnaire-completion gate | **PASS** |
| Employee A's submitted name appears only in Child A's CaseForm, not Child B's | **PASS** |
| Employer legalName autofilled into both child CaseForms | **FAIL** — see root cause |
| Manual-override-survives-re-autofill test | **SKIPPED** — cascaded from the failure above (no populated company field existed to override) |

## Root cause of the 3 failures — confirmed, reproducible, real defect

**Not an isolation bug. A silent-data-loss bug in the employer's own questionnaire submission.**

`case.controller.js`'s `createCase` unconditionally initializes the new `EmployerProfile` like this (lines ~1082–1088), regardless of whether an employer name was actually supplied at case-creation time:

```js
legalName: { value: trimmedEmployerName || null, source: "case_manager_edit", updatedAt: new Date(), updatedBy: req.user._id },
contact: { email: { value: trimmedEmployerEmail || null, source: "case_manager_edit", ... } },
```

When a case is created the normal way (no `employerName` in the request — which is the common case; `employerName` isn't even in `case.routes.js`'s validated request body), this stamps `legalName` as `{value: null, source: "case_manager_edit"}` — an **empty placeholder tagged as if a staff member had already authoritatively edited it.**

Later, when the real employer submits their actual company name through `POST /employer-profile/:id` with `source: "questionnaire"`, `canonicalFieldWriter.buildCanonicalUpdate()` (line 126) checks only `STAFF_AUTHORITATIVE_SOURCES.has(existing?.source)` — **not whether the existing value is actually non-empty.** Since `case_manager_edit` is in that staff-authoritative set, the questionnaire write is treated as a lower-priority source colliding with an authoritative one, and is silently rejected:

```
API response: { success: true, updatedFields: [], conflictedFields: ["legalName"], ... }
DB after:     legalName.value = null (unchanged)
              legalName.conflictPending = { conflictValue: "the employer's real name", conflictReason: "staff_override", ... }
```

**The API call reports `success: true`** — there is no error surfaced to the employer or to whoever built the questionnaire UI. The employer's real legal name is silently discarded into a `conflictPending` sub-object that nothing in the normal flow surfaces or resolves. The same applies to `contact.email`. Every downstream consumer of `EmployerProfile.canonicalData.legalName` — `CanonicalBuilderService`, `AutoFillService`, the I-129 crosswalk, every child case's CaseForm — sees `null` forever unless a case manager manually finds and resolves this specific conflict through a conflict-resolution path.

**This is not related to Phase 13, Phase 13.5, or anything this session has previously changed.** It is pre-existing behavior in `case.controller.js` and `canonicalFieldWriter.js`, first surfaced because this is the first time in this project's history an employer's questionnaire submission was tested against a case created without a pre-supplied `employerName` — which is the normal path.

**Likely blast radius:** every H-1B (and any other `employer_employee`-structured) case created through the standard "just clientName/clientEmail/visaType" flow has its EmployerProfile's `legalName` and `contact.email` fields silently un-settable by the employer through the normal questionnaire. `dbaName` and other fields are unaffected (they aren't pre-stamped at creation).

## Recommendation (not applied — this audit does not auto-fix)

The fix belongs at the origin, not in `canonicalFieldWriter.js` (whose staff-wins logic is correct and used correctly elsewhere): `case.controller.js` should not stamp `source: "case_manager_edit"` on `legalName`/`contact.email` when `trimmedEmployerName`/`trimmedEmployerEmail` are empty — either omit those fields from the initial `EmployerProfile.create()` call entirely when there's no real value, or set them with no `source` (leaving the schema's own default) so the first real write — staff or questionnaire — applies normally.
