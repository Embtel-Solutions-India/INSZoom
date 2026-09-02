# Regression Results — Enterprise Audit Track 32

**Date:** 2026-09-01
**Scope:** Full backend test suite (`node --test`), both frontend vitest suites (BAIS/Frontend, INSZoom/frontend), and a read-only verification of the known-suspect Playwright spec `INSZoom/frontend/e2e/uscis-form-render.spec.js`.
**Mode:** Discovery only. **No source file or test file was modified.** No failure was repaired. No server was started, stopped, or restarted. No data was deleted.

**Database:** live dev Atlas cluster, DB name `immigration_crm` (38 `cases`, 2 `caseforms` at time of audit).

---

## 1. Suite result summary

| Suite | Command | Files | Tests | Passed | Failed | Skipped |
|---|---|---:|---:|---:|---:|---:|
| Backend (`Backend/`) | `npm test` → `node --test "src/**/*.test.js"` | _see §2_ | _see §2_ | _see §2_ | _see §2_ | _see §2_ |
| BAIS Frontend | `npx vitest run` | 5 | 24 | 22 | 2 | 0 |
| BAIS Frontend (2nd full run) | `npx vitest run` | 5 | 24 | 23 | 1 | 0 |
| INSZoom Frontend | `npx vitest run` | 4 | 29 | 29 | 0 | 0 |
| INSZoom E2E (Playwright) | **not executed** (rate-limit budget) — analysed statically | 3 spec files | 7 tests × 2 projects in the suspect spec | — | — | — |

---

## 2. Backend suite

### 2.0 Run conditions

- 133 `*.test.js` files under `Backend/src`, executed by Node v22.20.0's built-in runner (`node --test`), default file-level concurrency.
- The suite runs **against the live dev Atlas database** (`immigration_crm`) — there is no test database or in-memory Mongo. Collection counts observed fluctuating during the run confirm this:

  | Sample | `cases` | `users` | `caseforms` |
  |---|---:|---:|---:|
  | ~5 min into run | 38 | — | 2 |
  | ~25 min into run | 34 | 44 | 1 |

  The transient `caseforms` row cycled through `B030-A` → `B031-A` case numbers, i.e. tests are creating and tearing down real `Case`/`CaseForm` documents in the shared dev DB as they run. The one persistent, non-test `CaseForm` (`B003-A`'s I-129, `_id 6a9211128b7dd5514d33bff7`) was verified present both before and during the run — it was **not** disturbed.
- Only two backend test files drive HTTP in-process (`form-generation-http.integration.test.js`, `uscis-form-rendering-pipeline.integration.test.js`); none use supertest against `:7000` and none require Redis/BullMQ, so the suite did **not** consume the shared `:7000` rate-limit budget.
- `Backend/.env` defines no `REDIS_URL`, but no test depends on one.

---

## 3. BAIS/Frontend (vitest)

### 3.1 Per-file results

| File | Tests | Pass | Fail |
|---|---:|---:|---:|
| `BAIS/Frontend/src/App.test.jsx` | 2 | 1 | **1** |
| `BAIS/Frontend/src/Pages/Dashboard/Documents.test.jsx` | 8 | 7 | **1** (non-deterministic) |
| `BAIS/Frontend/src/components/auth/PasswordField.test.jsx` | 2 | 2 | 0 |
| `BAIS/Frontend/src/hooks/useQuestionnaireAnswers.test.js` | 5 | 5 | 0 |
| `BAIS/Frontend/src/utils/questionnaireEngine.autofill.test.js` | 7 | 7 | 0 |

**Totals: 24 tests — 22 passed, 2 failed, 0 skipped.**

### 3.2 Failure BF-1 — `App.test.jsx › renders the eligibility quiz standalone, without the global Navbar`

**Error**

```
TestingLibraryElementError: Unable to find an element by: [data-testid="quiz-page"]
Ignored nodes: comments, script, style
<body>
  <div />
</body>
  at src/App.test.jsx:38  →  expect(await screen.findByTestId("quiz-page")).toBeTruthy();
```

**Reproducibility:** deterministic. Fails on every run (full suite and isolated, 3/3 runs).

**Classification: (b) stale/incorrect test assertion.**

**Evidence**

- `BAIS/Frontend/src/App.jsx:118-120` — the route still exists and is still wrapped exactly as the test's comment describes:
  ```jsx
  <Route element={<BlockIfHasCase />}>
    <Route path="/eligibility/quiz" element={<EligibilityQuiz />} />
  </Route>
  ```
  So the routing behaviour under test is intact; the route simply renders nothing because its guard never resolves.
- `BAIS/Frontend/src/components/eligibility/BlockIfHasCase.jsx` was rewritten in Phase 3 (commit `3ab9201` "Architectural changes (Phases 1-9)"). It **no longer uses `useHasCase`**. It now calls `authApi.sessionContext()` (`GET /api/auth/session-context`) directly in a `useEffect`, and deliberately renders `null` while that call is in flight:
  ```js
  // Render nothing while the check is in flight rather than showing the
  // quiz for a moment and then redirecting away from it.
  if (remoteHasCase === null && !isError) return null;
  ```
- `BAIS/Frontend/src/App.test.jsx` (unchanged since `47c4b4c` "Initial commit" — `git log` confirms it has never been touched since) mocks exactly three things: `./components/Navbar`, `./context/AuthContext` (returning a logged-in `role: "client"` user with `authLoading: false`), and **`./hooks/useHasCase`** — the hook the guard no longer imports. It does **not** mock `./services/api`, so `authApi.sessionContext()` is left unmocked.
- Consequence: `shouldCheck` is `true` (user present, not employee, not loading), the unmocked network call never resolves inside jsdom within the 1 s `findBy*` window, `remoteHasCase` stays `null`, and `BlockIfHasCase` correctly returns `null` — hence the empty `<body><div /></body>`.

**Verdict:** the production code is behaving as designed and as documented in its own comment. The test's mock surface is stale relative to the Phase-3 guard rewrite. Fixing it means mocking `authApi.sessionContext` (or `./services/api`) instead of `./hooks/useHasCase`. **Not a product defect.**

### 3.3 Failure BF-2 — `Documents.test.jsx` (which test fails varies per run)

**Error observed in the full-suite run**

```
FAIL  src/Pages/Dashboard/Documents.test.jsx > Documents.jsx — data persistence & autosave removal (Bug A/B, AC2, AC-S1/S4)
      > AC2 — editing a field fires zero save calls; Save progress fires exactly one batched save
AssertionError: expected +0 to be 1 // Object.is equality
  at src/Pages/Dashboard/Documents.test.jsx:222
     await waitFor(() => expect(server.saveAnswerCalls.length).toBe(1));
```

**Reproducibility: NON-DETERMINISTIC.** Isolated re-runs of the same file:

| Run | Result | Failing test |
|---|---|---|
| Full suite, run 1 | 7/8 pass | `AC2 — editing a field fires zero save calls…` |
| Isolated run 1 | 7/8 pass | **`AC-S3 — Save progress and Submit send the identical answer-persistence payload…`** (a *different* test) |
| Isolated run 2 | 8/8 pass | — |
| Isolated run 3 | 8/8 pass | — |
| **Full suite, run 2** | **8/8 pass** | **—** (whole file green; only `App.test.jsx` failed that run) |

A different test fails on different runs, the file passes cleanly on 3 of 5 runs, and a *second full-suite run* was completely green for this file. That is the signature of a timing flake, not a stable assertion mismatch.

**Classification: (d) flaky.**

**Evidence**

- `BAIS/Frontend/vite.config.js` declares only `test: { environment: "jsdom", globals: true }` — **no `setupFiles`, no `testTimeout`, no `waitFor` timeout override.** The suite therefore runs on RTL's default `waitFor` timeout of **1000 ms**.
- The full-suite run reports `transform 35.45s, import 53.01s, environment 67.11s` against `tests 15.22s` — i.e. the harness spends far more wall-clock on module transform/environment setup than on test bodies. Under that load a 1 s `waitFor` on an async React Query round trip is marginal.
- The test file's own header comment already documents a prior instance of exactly this problem ("…was the source of an intermittent full-suite-only flake (isolated single-test runs never reproduced it; tests slowed down and occasionally exceeded waitFor's default timeout as more trees piled up)"), and added an explicit `afterEach(cleanup)` to mitigate it. The mitigation reduced but did not eliminate the flake.
- The failing assertions are all `waitFor(...)` on the in-memory fake server's call log — no real network, no DB — so an environment/service cause is ruled out.

**Verdict:** flaky test harness, not a product defect and not a stale assertion (the same assertions pass on a quieter run).

**Secondary code observation (not the failing assertion, recorded for follow-up):**
`BAIS/Frontend/src/hooks/useQuestionnaireAnswers.js:251-267` — `commitAll()` skips the network call entirely when the answers map is empty:

```js
const entries = Object.entries(answers).map(([questionKeyValue, value]) => ({ questionKey: questionKeyValue, value }));
const response = entries.length
  ? await questionnairesApi.saveAnswer(questionnaire._id, { caseId, responseId, answers: entries })
  : null;
...
setLastSavedAt(new Date().toLocaleTimeString(...));
setSaveState("saved");
```

…but still sets `saveState: "saved"` and stamps a `Saved at HH:MM` timestamp. The failure DOM dump confirms the UI rendered `Saved at 11:35 pm` in a run where zero save requests were made. So a "Save progress" click that finds an unhydrated/empty answer map tells the user their work was saved when nothing was sent. This is a latent UX/data-confidence issue in production code; it is **not** the cause of the audited test failure (the audited failure is timing-driven), and per this track's mandate it was **not** fixed.

---

## 4. INSZoom/frontend (vitest)

| File | Result |
|---|---|
| `INSZoom/frontend/src/components/CaseCreatedSuccessModal.test.jsx` | pass |
| `INSZoom/frontend/src/components/uscis/USCISFormRenderer.test.jsx` | pass |
| `INSZoom/frontend/src/services/api.blobError.test.js` | pass |
| `INSZoom/frontend/src/utils/PDFFieldChangeAdapter.test.js` | pass |

**Totals: 4 files, 29 tests — 29 passed, 0 failed, 0 skipped.** Clean.

Noise (not failures, recorded for completeness):
- Many `Warning: An update to USCISFormRenderer inside a test was not wrapped in act(...)` messages from `INSZoom/frontend/src/components/uscis/USCISFormRenderer.jsx:550`.
- One `Error: Not implemented: navigation (except hash changes)` from jsdom during the "Download filing copy" test (jsdom cannot follow the download anchor). Test still passes.

`INSZoom/frontend/vite.config.js` correctly excludes `e2e/**` from vitest, so the Playwright specs are not (and must not be) picked up by `npm test`.

---

## 5. Known-suspect item: `INSZoom/frontend/e2e/uscis-form-render.spec.js`

Determined **by code reading and a read-only DB query only** — the spec was deliberately **not executed** (Playwright drives a real Chromium against `:7000` and would consume the shared 300-req/15-min rate-limit budget).

### 5.1 The `localStorage.getItem('token')` assertion — CONFIRMED STALE / GUARANTEED TO FAIL

`INSZoom/frontend/e2e/uscis-form-render.spec.js:51-52`:

```js
const token = await page.evaluate(() => localStorage.getItem('token'))
expect(token, 'login must produce a stored access token').toBeTruthy()
```

Against current app code this can **never** be truthy:

1. `INSZoom/frontend/src/services/api.js:13-16` — the access token is a module-scoped in-memory variable, and the module **actively deletes** the legacy key at import time:
   ```js
   let accessToken = null
   // Remove bearer tokens written by older releases during migration.
   localStorage.removeItem('token')
   localStorage.removeItem('refreshToken')
   ```
   `api.js` is imported by `AuthContext.jsx`, so this runs on every page load, including the login page — before login even happens.
2. `INSZoom/frontend/src/contexts/AuthContext.jsx:103-121` — the login path stores **`loginTime` only** and hands the token to the in-memory setter:
   ```js
   localStorage.setItem('loginTime', Date.now().toString())
   setAccessToken(accessToken || newToken)
   ```
3. A repo-wide grep for `setItem('token'` / `setItem("token"` across `INSZoom/frontend/src/` returns **zero hits**. Nothing in the app writes that key any more.

**Corroboration that this is staleness, not an intentional invariant:** the *other* e2e assets were migrated to the new key and this one was missed —
- `INSZoom/frontend/e2e/fixtures.js:69` → `localStorage.getItem('loginTime')`
- `INSZoom/frontend/e2e/golden-path-session.spec.js:38, 83` → `localStorage.getItem('loginTime')`
- `INSZoom/frontend/e2e/uscis-form-render.spec.js:51` → `localStorage.getItem('token')` ← the only remaining user of the removed key

**Classification: (b) stale test assertion.** It would fail in `loginAsCaseManager()` for **all 7 form-code tests**, in both the `desktop` and `laptop` Playwright projects — 14 test runs, all failing before reaching any USCIS-form rendering logic. This means the spec currently provides **zero** real coverage of the thing it exists to prove.

### 5.2 A second, earlier blocker in the same helper — missing env vars

`uscis-form-render.spec.js:33-34, 45-46`:

```js
const CASE_MANAGER_EMAIL = process.env.CASE_MANAGER_EMAIL || ''
const CASE_MANAGER_PASSWORD = process.env.CASE_MANAGER_PASSWORD || ''
...
expect(CASE_MANAGER_EMAIL, 'CASE_MANAGER_EMAIL must be provided ...').toBeTruthy()
```

`CASE_MANAGER_EMAIL` appears **nowhere** in the repo except this spec — not in `INSZoom/frontend/.env`, `.env.development`, `.env.example`, `.env.production`, and not set by `playwright.config.js`'s `globalSetup` (`e2e/global-setup.js` only seeds the throwaway staff fixtures used by the *golden-path* specs, via `e2e/fixtures.js`). So this spec aborts at line 45 before the `token` assertion is even reached.

**Classification: (c) environment/configuration issue**, stacked on top of the (b) staleness above. Note that the sibling golden-path specs were migrated to the self-seeding `fixtures.js` account model; this spec still expects a human's credentials in the environment. Same migration miss as §5.1.

### 5.3 The 7 hardcoded case IDs — 1 of 7 resolves; 6 of 7 point at non-existent cases

Read-only query against the live dev DB (`immigration_crm`), joining `cases._id` and `caseforms.caseId` (the model's real field name is `caseId` — `Backend/src/models/CaseForm.js:5`):

| Form code | Pinned case ID | Case exists? | CaseForms on that case | Matching `formCode`? |
|---|---|---|---|---|
| I-129 | `6a91c30a1afc8b73d9431db9` | **YES** — `B003-A` / H-1B | `["I-129:under_review"]` | **YES** |
| I-129F | `6a74bfe3bbec82d3647476f7` | NO | — | no |
| I-130 | `6a67eb59093e002d62cad815` | NO | — | no |
| I-134 | `6a74bfe3bbec82d3647476f7` | NO | — | no |
| I-539 | `6a7b860765aadcb329cad887` | NO | — | no |
| I-539A | `6a7b860765aadcb329cad887` | NO | — | no |
| I-907 | `6a727ef124b33bd1cd261c46` | NO | — | no |

The entire database contains only **two** `caseforms` documents, both `I-129`:

```
{_id: 6a9211128b7dd5514d33bff7, formCode: "I-129", status: "under_review",  caseId: 6a91c30a1afc8b73d9431db9 (B003-A)}
{_id: 6a9714903a84f416524a6f7e, formCode: "I-129", status: "ai_filled",     caseId: 6a9714623a84f416524a5bd7 (B030-A)}
```

This exactly matches the spec's own in-file comment (the Phase-12/P12-M3 note): the I-129 pin was re-pinned to a real record, and the other six were **knowingly left stale** so the spec "fails loudly and specifically on those 6". That is still true today — 6 of the 7 pinned IDs do not correspond to any `Case` document at all, let alone a `CaseForm` of the expected form code.

**Classification: (c) environment/test-data issue** — the six visa types (K-1/I-130/I-134/I-539/I-539A/I-907) have never been driven end-to-end in this database, so no fixture exists to point at. It is documented and intentional, not an accidental regression.

**Net status of this spec: 14 of 14 test runs would fail, for three independent reasons (missing env credentials → stale `token` key → 6 stale case IDs), none of which is a product defect in the USCIS form renderer.** The spec is currently a permanently-red artifact that proves nothing about the feature it names.

---

## 6. Classification roll-up

_(completed after the backend results — see §7)_

---

## 7. Certification impact

_(completed after the backend results)_
