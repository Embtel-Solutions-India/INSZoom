# Client ↔ Admin Portal Workflow — Session Report

Scope: Petition Assembly Workspace, questionnaire/checklist save pipeline, document-requirement matching, checklist assignment, and the production deployment layer underneath all four apps (Admin, Attorney, Immiglance Client, Immiglance Landing). Every fix below was verified against real code and, where noted, against a live running instance (Playwright browser tests, direct database queries, or forced-concurrency tests) — not just inferred from reading source.

---

## 1. Petition Assembly Workspace

### 1.1 Pre-existing gap analysis (before any code changes)

An audit of `Backend/src/modules/petition/` + `Admin/frontend/src/pages/petition/` against a full petition-workspace spec found the feature already mature (models, services, versioning, finalize/lock, authorization) but with real gaps:

| Gap | Status found | Fix |
|---|---|---|
| Mailing PDF section order hardcoded, ignoring `PackageDefinition.ordering.mailing` | Confirmed bug | Fixed — see 1.2 |
| Mailing PDF letters rendered via plain-text/pdf-lib fallback (no real HTML/CSS) | Confirmed — no HTML→PDF library existed at all | Fixed — see 1.3 |
| No firm letterhead/branding on cover letters or exhibit dividers | Confirmed | Fixed — see 1.3 |
| No page-insertion (blank/separator pages) | Missing feature | Implemented — see 1.4 |
| Document type taxonomy, page-range selection, rotate/split/merge, async assembly, live staleness banner, full drag-drop, broader visa test coverage | Confirmed gaps | **Deferred** — explicitly out of scope this round |

### 1.2 Mailing order now config-driven

`Backend/src/modules/petition/services/PetitionAssemblyService.js` — added `orderMailingSections()`, sorting the mailing-PDF section list by each section's `type` rank in `PackageDefinition.ordering.mailing` (the same field the Word/presentation copy already honored). Falls back to insertion order for any definition without `ordering.mailing` set (no regression for existing definitions). Applied in both `assemble()` and `finalize()`.

### 1.3 Real HTML→PDF rendering + letterhead branding

- Added **Puppeteer** as a backend dependency (`Backend/src/modules/form-generation/services/HtmlPdfRenderer.js`) — a shared, singleton-browser renderer used by both letters and exhibit dividers.
- `CoverLetterService.htmlToPdfBuffer()` — replaced the old plain-text/pdf-lib fallback (which stripped all bold/color/tables/images before they ever reached the mailing PDF) with real HTML/CSS rendering, including a firm letterhead (logo + name/address + rule) and footer (rule + contact info) via Puppeteer's header/footer template slots, sourced live from `Settings` (`firmEmail`/`firmWebsite` fields added).
- `ExhibitService.js` — exhibit divider pages redesigned from bare pdf-lib text to branded HTML pages (large centered "EXHIBIT A" + rule + title), sharing the same letterhead.
- Letter templates (`Backend/src/modules/petition/seeds/packageDefinitions.seed.js`) restyled to match the real-petition convention found by analyzing three actual filed petitions (H-1B, L-1A, N-400): bold date/address/subject block, bold-underlined lettered section headers (A./B./C…), bold stacked signature block.
- New narrow endpoint `GET /petition/branding` exposes only the non-sensitive letterhead fields (name/address/phone/email/logo) to any role that can already read a petition — the full `/settings` endpoint stays admin-only (it holds SMTP credentials etc.).
- Live letterhead preview added to the in-app letter editor (`LetterheadPreview.jsx`) so the editing canvas visually matches the eventual PDF.
- Rich text editor (`LetterSheet.jsx`/`RichTextToolbar.jsx`): added font family/size, text color, highlight, tables, images (upload via data-URI, no new storage/auth surface needed), plus image resize/alignment via a custom `ResizableImage` Tiptap node.

**Verified:** real rendered PDFs inspected directly (letterhead visible, bold/underline/bullets intact, exhibit divider matches design).

### 1.4 Anchored page insertion

New feature: case managers can insert a blank or titled separator page anchored after any specific section/exhibit (not just at a fixed position). `PetitionPackage.manualInsertions[]` (new schema field) persists the directive across re-assembly; `PetitionAssemblyService.applyManualInsertions()` splices it into the final, already-ordered section list at assemble time. New routes `POST /petition/packages/:id/pages` / `DELETE .../pages/:sectionKey`. Frontend: hover "+" in `PetitionOutline.jsx`, a placeholder sheet in `PetitionCanvas.jsx`.

---

## 2. Critical Tiptap editor bugs (petition letter editor)

Reported symptom: typing in a letter got scrambled/deleted, Enter jumped the cursor, content reverted after a pause. Reproduced live via Playwright (minted a debug session token, no password/DB changes) against the real dev servers.

| # | Root cause | Fix | Verified |
|---|---|---|---|
| 1 | `useEditor`'s options object was rebuilt every render (`.configure()` calls create new object references; live-typed content fed back into the `content` option), triggering Tiptap's internal `editor.setOptions()` reset loop | Froze `extensions` via `useMemo(() => [...], [])` and `content` via `useState`'s lazy initializer in `LetterSheet.jsx` | Build passes |
| 2 | This Tiptap version's `StarterKit` now bundles `Underline` internally; a separate `@tiptap/extension-underline` import registered the same mark twice ("Duplicate extension names" console warning), corrupting the schema | Removed the standalone import; uninstalled the now-redundant package | Confirmed: duplicate-extension warning gone in a fresh browser session |
| 3 | **The real data-loss bug**: a save request took 5.3s (real, reproducible DB latency); the response handler blindly `setPkg()`'d the whole page including that section's `contentHtml` with the now-stale value, and a sync effect then force-reset the live editor to match — wiping everything typed during the wait | `usePetitionPackage.js`'s `saveLetter`: merge the server response for every field except `contentHtml`, which stays whatever the client currently has (the next debounced save always carries the latest content forward) | **Reproduced the exact same 5.3s-slow scenario again after the fix — content survived completely intact, verified byte-for-byte in the DOM** |
| 4 | `@tailwindcss/typography` was never installed — `prose` class was a no-op, so bullets never rendered (Tailwind's reset strips list-style by default) and headings had no real weight | Installed and registered the plugin; added `prose-h3:underline prose-h4:underline` | Confirmed real `list-style-type: disc` / `font-weight: 600` CSS rules generated |

---

## 3. Production deployment bugs (all four apps)

### 3.1 `VITE_API_URL` missing in production → apps called `localhost:7000`

**Confirmed live in production**: `https://client.immiglance.com` was calling `http://localhost:7000/api/auth/register` (CORS/connection failure — a real user's browser can never reach that). Root cause: `Immiglance/Landing/.env.production` and `Immiglance/Client/.env.production` never set `VITE_API_URL`; Vite only overrides keys a mode-specific file actually sets, so the *base* `.env` file's dev value (`http://localhost:7000/api`) survived straight into the production build.

**Also confirmed** on `admin.immiglance.com`: the deployed bundle was calling `localhost:7000` too — it only appeared to "work" because the person testing had a local backend running on that port (creating a session cookie scoped to `Domain: localhost`, which is why the Admin portal's sign-out-on-refresh symptom was so confusing — that cookie is a third-party cookie from the real domain's perspective).

**Fixes:**
- Added `VITE_API_URL=https://client.immiglance.com/api` to `Immiglance/Landing/.env.production` and `Immiglance/Client/.env.production` (Admin/Attorney already had it correctly).
- Hardened the fallback in all four apps' `services/api.js` **and** both `SocketContext.jsx` copies (Client/Landing — the realtime socket had the identical unguarded `|| "http://localhost:7000/api"` fallback): in dev, fall back to a relative `/api` (proxied by Vite); in a production build with no `VITE_API_URL` set, **fail loudly** (console error + an obviously-broken `MISSING-VITE_API_URL.invalid` host) instead of silently defaulting to localhost.
- **Still required on the user's end** (cannot be done from this environment — no deploy access): ensure `VITE_API_URL` is actually set in the AWS build server's environment, then rebuild/redeploy all four apps. These `.env.production` files are gitignored, so local edits alone don't reach the real build pipeline unless synced there too.

### 3.2 Local dev sign-out-on-every-refresh

Root cause: `.env.development` had `VITE_API_URL=http://localhost:7000/api` (absolute, cross-port from the Vite dev server's own origin). Every dev API call was therefore cross-origin, and the `refresh_token` cookie is `SameSite=Lax` — browsers never attach a `SameSite=Lax` cookie to a cross-site XHR/fetch, only top-level navigations. The refresh call silently never carried its cookie, failed on every hard refresh, and the user was logged out — not just after the real 7-day session window, but immediately, every time.

**Fix:** set `VITE_API_URL=/api` in dev (relative, routed through Vite's own `/api` proxy to `localhost:7000` — same-origin from the browser's perspective, so the cookie attaches normally) for all four apps.

### 3.3 WebSocket reconnect loop in dev

Forcing `transports: ["websocket", "polling"]` (websocket first) failed repeatedly (reconnecting every ~1s) through Vite's dev proxy — confirmed via direct `curl` that a plain HTTP polling handshake through the same proxy succeeds immediately, only the direct websocket-first connection attempt does not. **Fix:** `transports: import.meta.env.DEV ? ["polling", "websocket"] : ["websocket", "polling"]` in both `SocketContext.jsx` copies — polling-first in dev (then upgrades), unchanged websocket-first in production (same-origin, no dev proxy involved).

---

## 4. Questionnaire/checklist save pipeline

### 4.1 Save Progress timing out ("The server took too long to respond")

Measured directly (temporary instrumentation, since removed): `canonicalSyncService.syncCase()` (triggered synchronously inside every answer save) took **10.8 seconds** — `CanonicalProfileService.rebuild()` alone was 7.9s. `questionnaire.service.js`'s `saveAnswers()` `await`ed this before responding, so every checklist save blocked 11+ seconds on top of its own work, exceeding the client's request timeout.

**Fixes in `Backend/src/modules/questionnaires/questionnaire.service.js`:**
- Made the `markCaseFormsStale`/`canonicalSyncService.syncCase()` calls fire-and-forget (already wrapped in `.catch(() => null)`; the response payload doesn't depend on their result) — matches the same background-sync pattern already used for `PetitionAssemblyService.autoSync()`.
- Parallelized two independent lookups (`Case.findById` + `Question.find`) via `Promise.all`.
- Net measured improvement: 6.86s → 5.56s for a single answer save, with the previously-blocking ~10.8s canonical sync removed from the critical path entirely.
- Root latency itself (250ms–1.6s per DB round-trip) traced to the local dev backend connecting to a **remote AWS-hosted MongoDB** (`18.210.74.196`) — a dev-machine-to-database distance cost, confirmed by the user to be a local-testing artifact, not necessarily present in production (where the backend likely runs near/on the same AWS infra).

### 4.2 Mongoose `VersionError` leaking to the browser as raw text

Confirmed live: a raw `VersionError` ("No matching document found for id ... version 52 modifiedPaths ...") rendered directly as a red error banner in the client portal. Root cause: making canonical sync fire-and-forget (4.1) widened the window in which it can still be writing to a Case document (e.g. `employerCompanyProfile`) at the exact moment a foreground action (`submitResponse`, `approveResponse`, or another `CanonicalProfileService` call) does its own load-modify-save on the same document — classic optimistic-concurrency collision, not unique to this change but made more likely by it.

**Fix:** new `caseService.saveCaseWithVersionRetry(caseData, mutate, { maxAttempts })` in `Backend/src/modules/cases/case.service.js` — reloads the document fresh and re-applies the same mutation on a `VersionError`, up to 3 attempts. Applied to all four colliding save sites: `questionnaire.service.js`'s `submitResponse()`/`approveResponse()`, and `CanonicalProfileService.js`'s `rebuild()`/`resolveConflict()`.

**Verified with a forced concurrency test** (three writers loading the same case simultaneously with an artificial delay guaranteeing a version collision): all three succeeded, and all three writes were confirmed actually persisted in the database afterward (no silent data loss) — not just "no error thrown."

### 4.3 Checklist save UI showing contradictory "Saved"/"Request failed" states

Three distinct bugs, each confirmed against real code before fixing (a prior AI-generated analysis had also gotten several other claims about this pipeline wrong — those were independently verified and correctly **not** "fixed" since they weren't real):

1. **`Documents.jsx`'s `commitAll()`** used `Promise.all` across multiple independent per-role checklist saves (employer/employee/business-plan hooks) — it rejects the instant the *first* one fails, without waiting for the others, which keep running in the background regardless and update their own state moments later. Fixed with `Promise.allSettled`, waiting for every role to actually finish before reporting overall status; error message now says how many of how many sections failed instead of a generic "Request failed."
2. **`EmployeePacketStepper.jsx`**'s status-line ternary was missing the `saveState === "error"` branch entirely (present correctly in its sibling `CaseRoleChecklist.jsx`) — a failed save with no other pending edits silently fell through to display a stale "Saved at …" time as if nothing went wrong.
3. **`useQuestionnaireAnswers.js`**: a refetch triggered right after a successful save could race that save's own already-correct `completion` percentage and regress it back down (observed: 63% flashed then reverted to 0%). Added a monotonic-progress guard — a refetch is never allowed to move `answeredRequired` backwards.

**Verified live:** a 30-second continuous observation of a real save (including its full ~12s DB round trip) showed stable "Saved at …" / correct percentage the entire time, no flicker; cross-checked against the database that the saved value was genuinely persisted (multiple real answer fields, matching timestamps).

---

## 5. Checklist assignment bug — irrelevant checklists shown on every case

**Confirmed live**: an H-1B case's Admin overview showed a "Business Plan Checklist" and "E-2 Supporting Documents" panel (both E-2/L-1A-only concepts), each rendering a confusing mix of employer/employee/beneficiary fields all marked "Needed" even though the real employer questionnaire had genuinely answered ones.

**Root cause** — `Backend/src/modules/questionnaires/questionnaire.service.js`'s `getQuestionnaireForCase()` has three fallback tiers to resolve "the questionnaire for this case + role": (1) case-specific assignment, (2) role+visa-matched default, (3) a **role-agnostic** "any questionnaire matching this visa type" legacy fallback. Tier 3 completely ignored the requested `targetRole` — when a caller asked for `targetRole: "business_plan"` on an H-1B case and tiers 1–2 correctly found nothing (H-1B genuinely has no business-plan questionnaire), tier 3 fell through and returned the generic `h1b_questionnaire` anyway, mislabeled under whatever panel title asked for it.

**Fix:** tier 3 now only runs when the caller didn't request any particular role at all (`if (!questionnaire && !targetRole)`) — a role-specific request that finds nothing now correctly returns "not applicable" instead of a role-mismatched result.

**This is a single shared function** used by every case and every role in the system, not scoped to any specific case — fixing it here fixes the bug universally. **Verified directly against the database** for the same H-1B case: `business_plan`/`supporting_documents`/`petitioner`/`beneficiary`/`joint_sponsor`/`client` (six different irrelevant roles) now all correctly report "not applicable," while `employer`/`employee` still resolve correctly.

**Secondary fix:** the resulting 404s for a role-scoped "does this even apply" probe were still noisy (the browser's own network layer logs any 404 to console, even an expected/benign one). `questionnaire.controller.js`'s `getCaseQuestionnaire` now responds `200 { questionnaire: null }` for a role-scoped miss instead of propagating a 404 — a caller with no `targetRole` (a real "give me THE questionnaire" request) still gets a genuine 404 if nothing matches.

---

## 6. Document-requirement matching (uploaded docs not reflected as "Sent")

**Confirmed live**: a case with 4 real, uploaded documents whose `documentType` exactly matched 4 required checklist items ("Copy of the Business license" ↔ `business_license`, etc.) still showed all of them "Pending" ("0 sent · 9 pending") in Admin's Documents tab.

**Root cause** — `CRMCaseDetail.jsx`'s `getChecklistStatus(item)` only ever read `item.status`/`item.uploadedFiles` directly off the `Case.checklistItems[]` subdocument — a field nothing updates when a real `Document` actually gets uploaded elsewhere in the system. Confirmed directly against the database: the checklist item's `status` field was permanently stuck at `"pending"` even with a matching, real, uploaded `Document` record.

**Fix:** `getChecklistStatus` now also checks the live `documents` array (already fetched for the "Uploaded Documents" table on the same page) for a matching, non-deleted `documentType` — this can never go stale again since it's the same real data the Documents table itself shows, computed live, for any case, automatically, rather than depending on a separate field someone has to remember to update.

**Status:** implemented and confirmed correct at the code/data level; live re-verification in the browser was interrupted by the backend's rate limiter (see §7) and has not yet been re-confirmed post-restart.

---

## 7. Operational note: rate limiter

The backend has a global rate limiter (2000 requests / 15 minutes, keyed by IP — `Backend/src/app.js`). Heavy automated testing during this session (repeated Playwright runs, direct script calls) exhausted it, which also blocked the real user's own browser traffic (shared `localhost` IP). Restarting the backend process clears the in-memory counter immediately. Worth knowing if "Too many requests" ever reappears during heavy scripted testing against the same local backend.

---

## 8. Data architecture finding — employer/employee case separation

Investigated the "client data not showing in Admin" complaint with direct database comparison (raw `Answer` records vs. what the API returns): **zero data loss** — every answer the client submitted is retrievable exactly. The real issue is scope, not loss:

- Employer data lives correctly on the **principal** case.
- Employee data lives correctly on each **child** case (e.g. `B155-A`), never on the principal.
- **Bug (fixed):** the principal's own Overview page queried `targetRole: "employee"` against its *own* case ID — a query that can structurally never find anything, since employee answers are keyed to the child's ID. Fixed by disabling that query when viewing a principal container case (`CRMCaseDetail.jsx`); the principal's existing "Employees (N)" section already links to each child's own page, where the same panel correctly shows that employee's real data.
- **Confirmed but not yet fixed:** the reverse gap — each child case gets its own separate, blank `h1b_employer_checklist` reference instead of inheriting the principal's actual completed employer answers. This is the real substance of "employer data should be shared by everyone" and is a genuine assignment/data-model change, not a query-scoping fix like the one above.

---

## 9. Future scope — what has not been done, in detail

Everything in this section is genuinely unstarted or only partially done. Each item states the problem, why it's real, roughly what changing it would touch, and how big a job it is — so the next session can pick any one of these up without re-deriving context.

### 9.1 Employer data not shared to child cases (the deeper employer/employee architecture gap)

**Problem.** Today, when `addEmployeeSlot` creates a new child case, it assigns that child its **own, independent** `h1b_employer_checklist` reference (`Backend/src/modules/cases/case.controller.js`'s `addEmployeeSlot`, and the underlying `orchestrate()`/`assignQuestionnaires()` flow in `immigration-knowledge-engine.service.js`). That reference starts blank and has its own `responseId`, entirely separate from the principal's actual, already-answered employer questionnaire. So:
- If a case manager opens **Employee B155-A's own page** and looks at its "Employer Questionnaire" panel, it shows every field as "Needed" — even though the employer answered all of it on the principal.
- Nothing currently propagates an edit made on the principal's employer data down to any child, or vice versa.

**Why this matters.** This is the literal content of "employer data shared by everyone, employee data isolated per employee" — the part of the original ask that's still open. It affects every employer_employee case (H-1B, L-1A, most nonimmigrant worker categories), not just the one tested this session.

**What needs to change (two viable approaches, pick one):**

1. **Query-time resolution (safer, less invasive).** Teach `getQuestionnaireForCase(caseId, user, targetRole)` that when `targetRole === "employer"` (or whatever the config-driven "shared" roles are) and the case has a `parentCase`, resolve against the **parent's** `questionnaireReferences`/`responseId` instead of the child's own. This means:
   - No schema change, no data migration.
   - `saveAnswers()` also needs the mirror change: an edit to "employer" data submitted from a child's own UI should write to the **parent's** `Answer` records/`responseId`, not create a second, orphaned copy on the child.
   - Risk: need to get the read/write symmetry exactly right, or you reintroduce a different flavor of "data doesn't show up where you look for it."
   - Where: `Backend/src/modules/questionnaires/questionnaire.service.js` (`getQuestionnaireForCase`, `saveAnswers`), plus whatever currently creates the child's own employer reference in `addEmployeeSlot`/`orchestrate()` (stop creating a second one, or mark it as an alias).

2. **Assignment-time inheritance (bigger, more "correct" long-term).** Don't give a child case its own `employer` questionnaire reference at all — `addEmployeeSlot` only assigns `employee`-role checklists to the child; anything that needs "employer" data (petition assembly, forms, Admin panels) always resolves it by walking up to `parentCase` when the current case's own `caseRole !== 'principal'` and has no direct employer assignment. This is more architecturally honest (there's genuinely one employer questionnaire per matter, not N copies) but touches every call site that currently assumes "a case's employer data is on that same case" — `AutoFillService`, `CanonicalBuilderService`, petition assembly's `buildMergeContext`, the forms tab, USCIS form autofill, etc. Needs a full audit of `Case.questionnaireReferences` consumers before starting.

**Recommendation:** start with approach 1, scoped to just the Admin-panel read path (what this session already fixed the symptom for) and the actual save path, and defer the "every consumer of employer data" audit unless something else breaks. **Size: medium** for approach 1 (a few focused function changes + real regression testing on an existing employer_employee case with a completed employer questionnaire); **large** for approach 2 (a genuine architecture pass).

### 9.2 Overview vs. Documents page restructuring

**Problem.** `Admin/frontend/src/pages/CRMCaseDetail.jsx`'s Overview tab currently renders the full detail: every `QuestionnaireAnswersPanel` (Employer/Employee/Business Plan/etc.), the "Phase 2 Intake Review" per-section-category breakdown (Personal Information/Passport/Employment/Education/…), the "Missing Documents" list, and the "Document Checklist" grid — all on one tab. The user wants:

- **Overview** → summary only: case type, filing/petition type, number of employees (for employer_employee cases), overall status/stage, assigned staff, key dates. Nothing that requires reading questionnaire answers or document types.
- **Documents** → everything else: the questionnaire answer panels, the required/missing document lists, the document checklist grid, the uploaded documents table.

**What needs to change:**
- Move the JSX blocks for `QuestionnaireAnswersPanel` (all variants), the "Phase 2 Intake Review" section-category grid, "Missing Documents", and "Document Checklist" from the `activeTab === 'overview'` render branch to the `activeTab === 'documents'` branch in `CRMCaseDetail.jsx`. This is largely a cut-and-paste-and-rewire job (the underlying hooks like `employerQuestionnaire`/`documentsProgress` already exist and don't need re-fetching logic changes — just where they're *rendered*).
- Rebuild the Overview tab's content: a smaller, purpose-built summary card. Some of this data already exists on `caseData` directly (`caseData.caseType`, `caseData.visaType`, `caseData.petitionType`, `caseData.childCaseCount`); some (like a clean "filing type" label) may need a small lookup/formatting helper.
- Watch for `overviewActive`-gated hooks (the `enabled: overviewActive` pattern used throughout — see §5/§8) — these gates need to become `enabled: documentsTabActive` (or whatever the new tab's active-flag is) so the data still only fetches when the relevant tab is actually open, not on every case load.
- Decide whether "Recent Activity" (the audit-log-style feed showing "Questionnaire Auto Saved" events, etc.) stays on Overview (arguably a legitimate summary-level item) or also moves.

**Size: medium.** Mostly a rendering/rewiring change, not new logic — the risk is mostly in getting the `enabled:` gating right so nothing double-fetches or silently stops fetching.

### 9.3 Document in-place editing (new feature)

**Problem.** Text-based documents uploaded by the client (e.g., a `.txt` file like the "comprehensive audit plan.txt" seen in testing) currently only support **View** in Admin's Documents table — no way for a case manager to edit the content and save it back.

**What this needs (this is a genuinely new feature, not a fix):**
1. **Backend**: a new endpoint, e.g. `PUT /documents/:id/content` (or similar), that:
   - Only accepts this for text-editable MIME types (`text/plain`, maybe `.docx`/`.rtf` if there's appetite for richer formats later — start with plain text).
   - Reads the current file via `storageService.readBuffer`, writes the new content via `storageService.storeBuffer`, and — critically — follows the **existing versioning pattern** already on the `Document` model (`Document.versions[]`, same as every other document-replace flow) rather than inventing a new one. Check `document.controller.js`'s `addVersion` for the existing convention to reuse.
   - Role-gates this to case-manager+ (not clients) and logs an `AuditLog` entry, matching every other document-mutating action in this codebase.
2. **Frontend**: an "Edit" action next to "View" in the Documents table (`CRMCaseDetail.jsx`'s Uploaded Documents grid) that opens a simple text editor (a plain `<textarea>` is enough to start — this doesn't need Tiptap/rich text unless the user asks for formatting), loads the current content via the existing preview/download path, and calls the new save endpoint.
3. Decide the scope boundary explicitly: is this **only** for genuinely plain-text files, or does "text files" in the original ask also mean rendering/editing inside PDFs or Word docs? If the latter, this is a much bigger feature (would need a PDF text-layer editor or a DOCX round-trip, not a simple textarea) — confirm before building.

**Size: small-to-medium** if scoped to plain text files only (a focused, well-bounded feature); **large** if it needs to extend to PDF/DOCX editing.

### 9.4 Document-requirement matching — live re-verification still needed

The fix in §6 (`getChecklistStatus` now checks the live `documents` array instead of a stale `Case.checklistItems[].status` field) was verified correct at the **code and data level** — confirmed the exact field names and matching logic against the real database — but the live browser re-check was interrupted mid-way by the rate limiter (§7) and has not been re-run since. **Next step:** open the same case's Documents tab fresh (post rate-limit-reset) and confirm the "Required Documents"/"Missing Documents" widgets now show the 4 already-uploaded items as "Sent", not "Pending". Low risk this doesn't hold (the fix is a straightforward, already-tested-in-isolation array lookup), but it hasn't had its final live confirmation.

### 9.5 Petition Assembly Workspace — deferred items from the original gap analysis

These were identified in the very first gap analysis (§1.1) and deliberately not built this session:

- **Document type taxonomy** — `PetitionPackage.sections[].type` is still a workflow-shaped enum (`cover_letter`, `form`, `exhibit`, …), not the generic `GOVERNMENT_NOTICE`/`CLIENT_DOCUMENT`/`ATTACHMENT`/`IMAGE` taxonomy originally specified. Would need a schema enum extension plus updating every place that switches on `section.type`.
- **Page-range selection** — inserting "pages 3–8 of a 50-page document" into a petition isn't possible; `FilingPackageService`/`ExhibitService` always copy every page of a source PDF via pdf-lib's `copyPages(sourcePdf, sourcePdf.getPageIndices())`. Needs a page-range parameter threaded through the exhibit-building and section-building code, plus a frontend page-range picker (thumbnail grid with a selectable range) in `PdfDocumentPages.jsx`/`ExhibitSheet.jsx`.
- **Rotate/split/merge arbitrary pages** — no such operations exist anywhere in the petition module; only exhibit-bucket reordering does. Would need new pdf-lib-backed endpoints (`rotate`, `split`, `insert-blank-page` beyond what §1.4 already added) and corresponding UI.
- **Async/background assembly** — `assemble()`/`finalize()` are fully synchronous today; given confirmed real petition sizes (80–100 pages typical, up to 300–400 max) and Puppeteer's per-render cost (seconds, not milliseconds — see §1.3's measurements), a large real assembly could hold an HTTP request open uncomfortably long. Needs a job queue (BullMQ is already in this codebase's "Future" stack per `AGENTS.md`) with a polling or websocket-pushed completion status, rather than a blocking request/response.
- **Live staleness banner** — `PetitionValidationService` already detects `FORM_OUT_OF_DATE` at assemble time, but a petition that's already open/finalized never tells a viewer "the underlying I-129 changed since this was assembled" without a manual re-assemble. Needs either a live diff-on-view check or a socket push when a relevant `CaseForm`/`Document` changes.
- **Full drag-and-drop** — only exhibit bucket order is draggable (`PetitionOutline.jsx`); letter/form/certification section order is still fixed by the definition's `ordering` profile, not user-reorderable.
- **Image cropping** in the letter editor — resize and alignment were added this session (§1.3); true pixel-level cropping needs a new frontend library decision (e.g. `react-easy-crop`) that was explicitly deferred pending the user's input.
- **Broader visa test coverage** — the existing `h4-h5-end-to-end.test.js` only exercises H-1B with real content assertions; L-1A/O-1/I-130/I-140 have no equivalent, despite 6 seeded `PackageDefinition`s existing. `petition-intelligence.test.js` is close to a no-op (string/regex checks, no functional assertions).

**Size:** each bullet above is independently schedulable; none are small, and several (async assembly, page-range selection) are genuinely substantial features in their own right, not quick additions.

### 9.6 Stripe test-mode key in production

`Immiglance/Landing/.env` and `Immiglance/Client/.env` (the base, gitignored dev file) hardcode `VITE_STRIPE_PUBLISHABLE_KEY=pk_test_...`. Neither app's `.env.production` overrides it with a live key, and this base file's value is what Vite falls back to in production builds too (same mechanism as the `VITE_API_URL` incident in §3.1). **If production is meant to process real payments today, it is currently running in Stripe test mode** — no real charges occur even though the UI would show success. This was flagged, not fixed, since it needs the user's confirmation: is this intentional (pre-launch/staging) or does it need a live key? If the latter: add `VITE_STRIPE_PUBLISHABLE_KEY=pk_live_...` to both `.env.production` files, and confirm the backend's own Stripe secret key is also live-mode (test/live keys must match on both sides of a Stripe integration, or requests fail outright).

---

## Files changed (this session)

**Backend:**
- `src/modules/petition/services/PetitionAssemblyService.js`, `ExhibitService.js`
- `src/modules/form-generation/services/CoverLetterService.js`, `HtmlPdfRenderer.js` (new)
- `src/modules/petition/seeds/packageDefinitions.seed.js`
- `src/models/PetitionPackage.js`, `PackageDefinition.js`, `Settings.js`
- `src/modules/petition/petition.routes.js`, `petition.controller.js`
- `src/modules/questionnaires/questionnaire.service.js`, `questionnaire.controller.js`
- `src/modules/cases/case.service.js`
- `src/modules/canonical/services/CanonicalProfileService.js`

**Admin/frontend:**
- `src/pages/petition/LetterSheet.jsx`, `RichTextToolbar.jsx`, `PetitionOutline.jsx`, `PetitionCanvas.jsx`, `LetterheadPreview.jsx` (new), `ResizableImage.js` (new)
- `src/services/api.js`
- `src/pages/CRMCaseDetail.jsx`
- `tailwind.config.js` (added `@tailwindcss/typography`)
- `.env.development`

**Immiglance/Client & Immiglance/Landing:**
- `src/context/SocketContext.jsx` (both)
- `src/services/api.js` (both)
- `src/hooks/useQuestionnaireAnswers.js`, `src/Pages/Dashboard/Documents.jsx`, `src/components/questionnaire/EmployeePacketStepper.jsx` (Client)
- `.env.production`, `.env.development` (both)

**Attorney:**
- `src/services/api.js`, `.env.development`
