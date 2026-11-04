# One client, many cases — completion report

Plan: `docs/MULTI_CASE_CLIENTS_PLAN.md`. One report for all phases; each phase adds its section. Phases run one at a time with owner approval in between.

| Phase | Status |
|---|---|
| 1 — Link many cases to one login (backend) + staff see it (Admin) | Done (2026-11-05) — awaiting owner approval for Phase 2 |
| 2 — Client Portal: My Cases + switching | Not started |
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
