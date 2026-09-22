# Session Report — 2026-09-22/23

Three pieces of work, done back-to-back in one session: a Questionnaire Templates performance fix, a Client Portal login-redirect fix, and an OCR/Smart Scan architecture overhaul. This doc covers what was done, what went wrong along the way, how it got fixed, the working style behind all three, and — since it's the part most worth remembering — how a change in one place forced or unlocked a change somewhere else.

---

## 1. Questionnaire Templates page — 2-minute load, then a timeout

**Problem.** Admin's Questionnaire Templates page showed a loading spinner for ~2 minutes, then failed outright with `AxiosError: timeout of 120000ms exceeded`, no checklists ever rendering.

**Investigation.** The page calls `GET /questionnaires/defaults` before listing anything. That endpoint runs `ensureDefaultVisaTemplates()` — a "make sure every default checklist exists in the DB" reconciler that walks ~20 checklist definitions (SB-1, TN, AR-11, EB-2/3, GC-NVC, I-90, N-400/565/600, EB-1B, I-130, Green Card, I-131, 4× change-of-address, H-1B, …), some with 70+ questions each. The code already had a 5-minute in-memory cache guarding this, but the *uncached* path itself — one `await Question.create()`/`.save()` per question, sequentially — was the real cost. Every nodemon restart (frequent, since checklist files were being actively edited this same day) wiped the cache, so the next page load paid the full multi-minute cost.

**Solution.** Two changes to `Backend/src/modules/questionnaires/questionnaire.service.js`:
- Collapsed the per-question sequential `create`/`save` calls into a single `Question.bulkWrite(ops, { ordered: false })` per definition.
- Parallelized the ~20 definitions themselves with `Promise.all`, since each only ever touches its own `key` and that questionnaire's own questions — provably independent.

**Verified against the live remote DB** (not synthetically): cold reconciliation went from timing out past 120s to **18.1s**; warm/no-op reconciliation to **5.9s**. Both comfortably under the requested 30s target.

**Working style note.** Didn't guess at the fix from the symptom — read `ensureDefaultVisaTemplatesUncached` in full first, found the exact O(N) sequential-await pattern, and *timed the actual fix against production data* rather than trusting the diff would work. A throwaway timing script was written to the Backend root, run, and deleted immediately after — no leftover scaffolding.

---

## 2. Client Portal (`localhost:5175`) redirecting to production Admin

**Problem.** Opening the Client portal locally immediately bounced to `https://admin.bayareaimmigrationservices.com/auth/sso?token=...` and failed with "couldn't sign you in, network error."

**Investigation.** This wasn't a bug in the redirect logic itself — `AuthGate.jsx` correctly detects an authenticated staff session (the browser had one, because `localhost` cookies are shared across every port, so a session from testing Admin leaked into the Client app) and bounces it to "its own portal." The actual defect was one line: `Immiglance/Client/.env` had `VITE_ADMIN_URL` pointing at the **production** Admin URL instead of a local dev address, so the token handoff went to a server that couldn't validate a token minted by the local backend.

**Solution — and where it grew.** The user didn't want the `.env` pointed at localhost either; they wanted to be able to test every portal side-by-side on one machine without logging out between them. That meant: skip the cross-origin bounce entirely on `localhost`, in both `AuthGate.jsx` *and* — discovered only by tracing the render path — `Login.jsx`, which has its own independent "already logged in → go to `/dashboard`" guard that would otherwise immediately undo AuthGate's redirect-to-login and land on an "Access unavailable" screen instead. Production behavior is untouched; only the `hostname === "localhost"` branch changed.

**Working style note.** The first instinct (fix the `.env`) would have been half-right and shipped a subtly broken experience — the user's actual complaint ("just show me the login page") wasn't satisfiable by config alone. Traced the *rendered outcome* (Login.jsx's own guard) rather than stopping once AuthGate.jsx looked correct, which is what surfaced the second required file.

---

## 3. OCR / Smart Scan Overhaul

This was the largest piece: a ~700-line implementation prompt asking for Gemini OCR registration, expanded canonical/questionnaire field mappings, a new "Smart Scan" checklist step, and conditional-section UX — spanning 5 backend files and 5 frontend files (one new).

### Working style: verify before writing a single line

The prompt itself demanded this ("do not edit until dependencies are verified"), but it was followed literally: three parallel research agents were sent to independently verify the prompt's every structural assumption against the actual repository before any plan was written. That surfaced real gaps between what the prompt assumed and what the code did:

| Prompt assumed | Actually found |
|---|---|
| Provider registry needs building | Already exists (`document-intelligence-provider.registry.js`) — Gemini just wasn't registered in it |
| `CanonicalBuilderService` has some document-type routing already | Flat lookup only; `documentType` was computed but never used for path resolution |
| Document-type aliases (`employee_i94_copy` → `i94`) need inventing | Already exist and run upstream (`normalizeDocumentType`) — the raw-slot-name keys the prompt's own example table used would have been dead code |
| "Actual checklist" = `Case.documentChecklist` | Actually a live set of `type: "file"` Questions, server-filtered by `getQuestionnaireForCase` |
| Need a new OCR capability registry | Already exists (`AUTOFILL_DOCUMENT_TYPES`) — just needed reusing, not rebuilding |

Every one of these, if implemented as the prompt literally described, would have produced *working-looking, dead* code — new tables no code path ever reads, aliases already handled a layer up, a capability registry duplicating an existing one. Catching this before writing code is the difference between a plan that looks complete and one that actually does something.

### Where the plan itself got corrected

The first draft of the plan was reviewed and sent back with eight concerns — provider ambiguity, unverified end-to-end wiring, missing precedence/confidence/provenance handling, duplicate-vs-versioned uploads, "show results before applying." Re-investigating each against the running pipeline (not just reasoning about them) found that **six of the eight were already correctly implemented** — `applyAnswerMatches` already refuses to silently overwrite a manually-entered answer (flags it as a conflict instead), confidence and provenance are already threaded through every OCR-derived answer, and old-vs-new document revisions already version instead of duplicating via checksum comparison. Those didn't need new code, just verification and documentation in the plan. The two real changes: keep Google Document AI as the *active* provider (the reviewer explicitly didn't want Gemini becoming primary — Gemini is registered as *available*, nothing about `DOCUMENT_INTELLIGENCE_PROVIDER` changed), and show per-field scan results instead of a bare "Scanned" badge, using data the endpoint already returned.

### How one change forced another (the actual cross-cutting effects)

This is the part worth remembering for next time:

1. **Normalizing `field-mapping.registry.js`'s alias handling broke its own assumption test.** It originally hand-rolled two special cases (`cv`→resume, `certified_lca_eta9035`→lca). Pointing it at the shared `normalizeDocumentType()` instead — the correct fix, since that's the one real alias table — meant re-verifying by hand that `mappingsFor("i94")`, `mappingsFor("employee_i94_copy")`, and `mappingsFor("academic_certificates")` all resolved to the *same* field set afterward. They did (confirmed with a live `node -e` smoke test), but this is exactly the kind of change where "it compiles" isn't evidence it's still correct — a table swap like this can silently drop the case nobody thought to check.

2. **Deciding `DOC_TYPE_OVERRIDES` should be keyed by canonical types, not raw checklist-slot names, came directly from finding the normalizer.** The prompt's own example table mixed both (`i94` *and* `employee_i94_copy` as separate keys). Once it was confirmed that `extraction.documentType` is *always* already-normalized by the time `CanonicalBuilderService` sees it, half of that example table became provably dead code — so the raw-slot-name keys were dropped rather than copied in, even though the prompt wrote them out explicitly.

3. **The new `caseScanOptions` endpoint's correctness depends entirely on a fact discovered while investigating something else** — that a file-type Question's `key` *is* the raw checklist-slot document-type name (`buildQuestion(doc.documentType, doc.name, "file", ...)` in `employmentChecklists.js`). Without that one line, there would have been no way to intersect "this case's real checklist" with "the OCR capability allowlist" without inventing a third mapping table — which the prompt explicitly forbade ("do not create a duplicate global registry if one already exists").

4. **A one-field mapping mistake caught itself only because of the "verify, don't assume" discipline carried through implementation, not just planning.** While writing the `marriage_certificate` field mapping, `spouseOneName`/`spouseTwoName → client_spouseFirstName/client_spouseLastName` was drafted and then caught as wrong before committing — those are two *different people's* names, not one person's first/last name split. Fixed by mapping only the unambiguous `marriageDate` field and leaving the names unmapped, then documenting why in the code and flagging it as a known gap in the final report, rather than shipping a field that would silently write one spouse's name into the wrong person's answer.

5. **Registering Gemini touched a file outside the original scope, and that was flagged rather than done silently.** The provider registry's own comment ("no provider is registered here right now...") became factually false the moment Gemini or Google Document AI got registered. Fixing that one comment meant editing a file the prompt's target list didn't include — called out explicitly in the plan and approved before touching it, rather than quietly expanding scope.

6. **Removing the inline `AutofillButton` UI required proving it had exactly one call site first**, specifically because it shares an import line with `QuestionInput`'s default export — deleting the whole import line would have broken the page. Confirmed via a full-file grep before touching either the import or the JSX.

### Verification approach

No backend or frontend server was started, per the task's own constraint. Verification was: `node --check` on every backend file, `eslint` on every frontend file, a live `node -e` sanity pass confirming both OCR providers register and resolve correctly (Google Document AI still wins by default, exactly as required), and a live smoke test of the alias-resolution logic. The five pre-existing lint findings that surfaced (`react-hooks/set-state-in-effect`) were confirmed, line by line via `git diff`, to be on code nobody touched this session — not new problems introduced by this work.

---

## Working style, across all three

- **Read the real implementation before touching it, every time** — not just for the 700-line OCR prompt where it was mandated, but for the one-line `.env` fix, where the fast/wrong answer would have shipped something that looked fixed but wasn't.
- **Verify against live data, not just "the code looks right."** The questionnaire fix was timed against the production database; the provider registration was resolved live; the alias table was smoke-tested with real inputs.
- **Catch mistakes made *during* implementation, not just review ones made by someone else.** The marriage-certificate field mapping is the clearest example — a genuine error introduced while writing the fix, caught by the same discipline that was applied to auditing the original prompt.
- **Scope discipline, but not silently.** Every place this session touched a file or added scope beyond what was strictly asked (the registry's stale comment, the `Login.jsx` addition, the dropped `spouseOneName`/`spouseTwoName` mapping) was called out explicitly to the user rather than either over-asking for permission on trivial things or under-disclosing real scope creep.
