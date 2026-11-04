# One client, many cases — completion report

Plan: `docs/MULTI_CASE_CLIENTS_PLAN.md`. One report for all phases; each phase adds its section. Phases run one at a time with owner approval in between.

| Phase | Status |
|---|---|
| 1 — Link many cases to one login (backend) + staff see it (Admin) | Done (2026-11-05) |
| 2A — Client Portal: case switcher for client / employer / petitioner logins | Done (2026-11-05) |
| 2B — A login that is an employee / beneficiary on one case and a client on another | Done (2026-11-05) — awaiting owner approval for Phase 3 |
| 3 — Carry personal data into each new case | Not started |
| 4 — Hardening, full verification, rollout | Not started |

## Phase 1 — Link many cases to one login + staff see it

### Done
- **Shared link rules** `Backend/src/modules/cases/caseLinks.service.js`: append a new case to a person's `caseIds` (never replace, each id once, so a retried request cannot double-link); keep the person's landing case (`primaryCaseId`) and person-level `caseRole` / `principalCaseId` as they are; a person with no live case gets exactly the old fields. `listPersonCases` lists every live case a person is on (own matters, employer matters, and a case where they are the employee / beneficiary inside someone else's matter).
- **Staff "New case" (`createCase`)**: an email that already has a case no longer gets "This client account is already linked to a case" — the new case is added to the same login; the earlier cases are untouched. A failure part-way still rolls back to the person's previous links (existing snapshot).
- **E-mail for a returning person (owner rule)**: a person getting a 2nd, 3rd ... case **never** gets a new set-password link and their account is never made inactive. They get the "Case Created - log in" e-mail (`case-created-client`) to sign in with their existing details, plus the in-app and browser notice of the same `case_created` notification. A working login is a password **or** an active account with no pending invitation (Google sign-in) — before this fix a Google-login client given a case through New case got a set-password link and was made inactive. A person who never finished activating is offered "resend invitation" by the login page itself.
- **Kill switch** `MULTI_CASE_CLIENTS` (default on): `false` brings back the old refusal exactly.
- **Single-party filings (H-4, EAD, I-765 EAD, change of status …) now belong to the client** (owner approved): they used to record the staff member as the case's user and invite nobody, so they never reached the client portal. New `Backend/src/modules/cases/clientAccount.service.js` links the case to the client named in the form with the same rules as every other case (new login -> set-password invitation; existing login / cases -> case added + "Case Created - log in" e-mail; never a new set-password link for a returning person), the checklist is assigned to the client, a failed save puts the person's links back, and the client is told after the response (in-app + browser + e-mail). The New case notice now shows for every visa type. **Same client login flow for every visa type.**
- **GHL second card (owner chose the recommended option)**: GHL still never links a second card automatically (it cannot tell a new matter from a duplicate card), so the case still arrives unlinked and flagged. New: on such a case — any single-person case on no client login whose client email belongs to an existing client — the case page shows "This case is not on any client login yet. *Name* (email) already has N cases …" with an **Add to this person's login** button and a themed confirmation ("Do this only if it is a new matter, not a duplicate"). `POST /api/cases/:id/attach-to-login` (staff, `cases:update`) uses the same login rules as every new case (append; "Case Created - log in" e-mail; never a new set-password link), refuses a case already on a login / an employer or family case / a child case, records it on the timeline and audit trail, and clears the GHL needs-attention flag only when "Client already has a case" was its only reason.
- **Recycle bin restore** gives a person their landing case back if they were left without one; a person with another landing case keeps it.
- **Staff endpoints (read-only)**: `GET /api/cases/people/lookup?email=` and `GET /api/cases/:id/person-cases` (staff roles, `cases:read`; the second also checks access to the case).
- **Admin**: New case shows "*Name* (email) already has N cases. This new case will be added to the same login - their earlier cases stay exactly as they are." under the client / petitioner / employer email; the case page shows "Other cases for *Name* (email)" with a link to each (visa, capacity, status, date — no case numbers).

### Not done in Phase 1 (decisions needed / later phases)


- **Employee / beneficiary logins** getting their own case: still refused (`EMAIL_OWNED_BY_NON_CLIENT`). Owner decision: done in Phase 2 — the same login may hold several cases; on a case where they are the employee / beneficiary they see only what an employee / beneficiary sees, on a case where they are the client / employer / petitioner they get every feature as a normal client.
- `createCaseWithClient` and `employment-workflow createEmployerCase` are not called by any portal; left unchanged.
- The client portal still opens the landing case only (Phase 2 adds the switcher).

### Tests and builds
- New: `Backend/src/modules/cases/tests/caseLinks.service.test.js` (10), `Admin/frontend/src/components/PersonCases.test.jsx`.
- New backend tests: 13 / 13 (incl. the single-party and attach-to-login wiring). Admin after these fixes: 280 / 280. Single-party module tests: 64 / 65 (the 1 is the long-standing route "guardrail" test, failing before this work). Admin: 278 / 278 (28 files). Builds: Admin, Client, Landing, Attorney all green.
- Full database-free backend suite (`runSafeTests` pure group, 384 files, without `form-pipeline/tests/sim/errorScenarios.sim.localdb.test.js`, which hangs on this machine — same exclusion as the last regression report): **3,054 tests, 3,036 pass, 18 fail**. None of the 18 is in code changed by Phase 1; they are the known failures (form pipeline / edition policy / questionnaires / compliance / information requests / renderer rollback / a timing test). One (`family-workflow.test.js` "Admin CreateCaseModal routes K-1/K-3 …") reads a line that was already absent from `CreateCaseModal.jsx` at the last commit (the list moved to `utils/visaOptions.js`).
- Read-only DB check: `listPersonCases` on case B471's employer returns its one PERM employer matter (employee cases stay inside it).

### Files
Backend: `modules/cases/caseLinks.service.js` (new), `modules/cases/clientAccount.service.js` (new), `modules/single-party-filings/single-party-filing.controller.js`, `modules/cases/case.controller.js`, `modules/cases/case-lifecycle-orchestrator.service.js`, `modules/cases/case.routes.js`, `modules/recycle-bin/recycle-bin.service.js`, `modules/cases/tests/caseLinks.service.test.js` (new).
Admin: `components/PersonCases.jsx` (new), `components/PersonCases.test.jsx` (new), `components/CreateCaseModal.jsx`, `pages/CRMCaseDetail.jsx`, `services/api.js`.

### Production
- Env: `MULTI_CASE_CLIENTS` — leave unset (on) to allow many cases per login; set `false` to keep the old one-case rule.
- No data migration. Restart the backend; rebuild Admin.

## Phase 2A — Client Portal: case switcher (client / employer / petitioner logins)

### Done
- **Backend** (all additive; with no case id every request answers exactly as before):
  - `GET /api/cases/mine` — the signed-in person's cases for the switcher (visa, case number, status, how they are on it) + `defaultCaseId` (their landing case).
  - Optional `caseId` on `GET /cases/my`, `GET /cases/my/pipeline`, `GET /client-intake/me`, `GET /payments/summary`, `POST /payments/create-partial-checkout-session`. Honoured **only within the person's own cases** (`/cases/my` inside the same access filter as before; payments only `user` = the person; intake through `getAccessibleCaseOrThrow`). An old, deleted or someone else's id silently falls back to the usual default — never an error, never another person's case.
- **Client Portal**:
  - `context/ActiveCaseContext.jsx` knows the person's cases and the open one. **One case (or none, or the list cannot load): nothing is selected and nothing changes.** Two or more: the open case comes from `?case=` in the address, else the last one opened in this browser tab, else the landing case; only an id from the person's own list is ever used.
  - Header: for a person with 2+ cases the case number / visa line becomes a menu ("N cases") listing every case (visa, case number, Employer / Petitioner role, status); picking one opens that case's dashboard. One case: the header is unchanged.
  - Every page follows the open case: the "my case" requests carry it (`services/api.js` `activeCaseStore`, set only while a case is open), the cached case is keyed by it, the page is re-created on a switch and the cache is cleared, so nothing of the previous case can show. Documents list only the open case's documents (an employer matter keeps its employees' documents). Messages opens the open case's own conversation (created if the case has none yet).
- `services/api.js` is changed in the **Client** copy only: the Landing copy was already different and has no case switcher.

### Not done in 2A (next steps)
- **2B**: a login that is an employee / beneficiary on one case and the client / employer / petitioner on another (owner decision). About 30 backend modules decide permissions by the login's single role ("employee" / "beneficiary" have a reduced permission set), so 2B makes permissions follow the person's role on the open case.
- E-mail links that open a specific case (`?case=` after sign-in): the sign-in page is in the Landing app and always lands on the dashboard; the switcher already reads `?case=` once signed in. Planned with 2B / Phase 4.
- The documents count badge on the dashboard still counts all the person's documents (display only).

### Tests and builds
- Backend: new `caseLinks.service.test.js` cases (14 / 14 in the file); client-intake, payments and cases tests 154 / 154.
- Client: new `context/ActiveCaseContext.test.jsx` (5): one case -> nothing selected; three cases -> default / `?case=` / foreign id ignored; employee login untouched; switcher lists and switches (remembered per tab); `?caseId=` only while a case is open. Whole Client suite 115 / 115 before the new file. Client build green.
- Read-only DB check: a real employer login with two links (matter + its employee case) lists ONE matter, so it sees no switcher (unchanged); its own case is found with `?caseId=`, someone else's case is not (falls back to the default).

### Files
Backend: `modules/cases/caseLinks.service.js`, `modules/cases/case.controller.js`, `modules/cases/case.routes.js`, `modules/client-intake/client-intake.service.js`, `modules/client-intake/client-intake.controller.js`, `modules/payments/payment.controller.js`.
Client: `context/ActiveCaseContext.jsx` (new), `context/ActiveCaseContext.test.jsx` (new), `components/CaseSwitcher.jsx` (new), `services/api.js`, `hooks/useMyCaseProfile.js`, `layout/PortalLayout.jsx`, `main.jsx`, `Pages/Dashboard/Messages.jsx`.

### Production
No new env vars, no migration. Restart the backend; rebuild the Client portal (order does not matter: an older backend ignores the extra `caseId`, an older portal never sends it).

## Phase 2B — An employee / beneficiary login with cases of its own

### Done
- **Owner rule**: the same login can be the employee / beneficiary on one case and the client / employer / petitioner on others. On the invited case it sees only what an employee / beneficiary sees; on its own cases it gets every client feature.
- **How (backend)**: the login keeps its stored role ("employee" / "beneficiary"), so its invited case works exactly as before. When it opens one of ITS OWN cases in the switcher, the portal sends `X-Active-Case: <id>`. `middleware/activeCaseRole.js` (called by `authenticate`) checks that case: it must exist, not be removed, have the person as `user` / `petitionerUser` / `employerUser` / `delegateEmployerUser`, and NOT as `employeeUser` / `beneficiaryUser`. Only then does that request act as a **client** (client permissions, no employee restriction). The switch is a property of that request's user object only — the stored user document is never changed and a `.save()` cannot write it (tested). Any doubt (no / bad header, someone else's case, the invited case, a removed case, a database error, a client login) leaves the stored role exactly as today.
- `X-Active-Case` added to the API's allowed request headers (`app.js` CORS list). The portal only sends it for an employee / beneficiary login on its own case — such logins only exist after this backend is deployed, so the deploy order cannot break anyone.
- **Case creation**: staff New case (`createCase`), single-party filings and "Add to this person's login" now accept an existing employee / beneficiary login as the client of a new case (the case is added to the same login, "Case Created - log in" e-mail, never a set-password link). Staff and attorney accounts are still refused (`EMAIL_OWNED_BY_NON_CLIENT`).
- **Client portal**: the case switcher now also appears for employee / beneficiary logins that have 2+ cases. One rule, `employeeViewFor(user, openCase)` (`context/ActiveCaseContext.jsx`), decides the restricted employee view by the role on the OPEN case (one case: exactly the old role check) and replaces the role-only check in `AuthGate`, `ProtectedRoute` (BlockEmployeeRoute), `PortalLayout` (menu), `Dashboard`, `Documents` and `Profile`. The own-case signal is never sent on `/auth/*` calls, so the session always reports the login's real role.
- **Admin**: "Add to this person's login" is offered for an invited employee / beneficiary as well as a client.

### Not done in 2B
- The reverse direction — an existing **client** login being invited as someone's **employee / beneficiary** — is unchanged (the invite flow still applies its existing checks). Can be added if wanted.
- E-mail links that open a specific case after sign-in; the dashboard documents count badge (display only) — as in 2A.

### Tests and builds
- Backend: new `middleware/tests/activeCaseRole.test.js` (4): ownership matrix, the switch on the person's own case with the stored user untouched (`modifiedPaths()` empty), every other case keeps the stored role (no header, bad header, someone else's case, invited case, removed, unknown, client login, database error), wiring. Full database-free suite: see the 2B report in the conversation.
- Client: `ActiveCaseContext.test.jsx` 7 / 7 (2B: employee login with its own case gets the switcher; own-case signal only on its own case; employee view follows the open case; signal never on `/auth`), whole Client suite green. Admin `PersonCases.test.jsx` 6 / 6.
- Builds: Admin, Client, Landing, Attorney all green.

### Files
Backend: `middleware/activeCaseRole.js` (new), `middleware/authenticate.js`, `app.js`, `modules/cases/case.controller.js`, `modules/cases/clientAccount.service.js`, `middleware/tests/activeCaseRole.test.js` (new).
Client: `services/api.js`, `context/ActiveCaseContext.jsx`, `context/ActiveCaseContext.test.jsx`, `components/AuthGate.jsx`, `components/ProtectedRoute.jsx`, `layout/PortalLayout.jsx`, `Pages/Dashboard/Dashboard.jsx`, `Pages/Dashboard/Documents.jsx`, `Pages/Dashboard/Profile.jsx`.
Admin: `components/PersonCases.jsx`.

### Production
No new env vars, no migration. Restart the backend (the CORS header list changed); rebuild Client and Admin.
