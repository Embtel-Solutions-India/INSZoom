# Petition AI Review - implementation report (single living document)

This file is the one place that records every phase of the Petition AI Review subsystem: what was built, what was tested, what is not done yet. It is updated at the end of each phase. Plan: [`docs/PETITION_AI_REVIEW_PLAN.md`](PETITION_AI_REVIEW_PLAN.md) (exact copy of the approved rev 3).

**What it is:** when the internal team uploads a petition (PDF, often 500-700 pages) the petition is scanned automatically, page by page, by an AI (Gemini, key from the server env). The findings ("page 112: wrong name; page 340: address differs ...") are shown in a summary panel inside that petition's row in the Admin petition list, behind its own **AI Review** button.

**Ground rules kept in every phase:** additive only (new files; existing files get tiny guarded hooks), master switch `PETITION_AI_REVIEW=off`, upload responses untouched, scan runs after the response and can never throw into a request, no CI/CD edits, `Backend/.env` never read, no shared-DB writes in tests, no real Gemini spend without the owner's approval.

**How this report works:** one phase is built at a time. After each phase the work stops until the owner approves the next one, and that phase's section below always lists: Done, Tested, Not done in this phase, What you need to do, Remaining, Next step.

## Status

| Phase | What | Status |
|---|---|---|
| 0 | Gemini diagnosis + diagnostic script | DONE |
| 1 | Models, rules, env, PDF slicer, batch planner | DONE |
| 2 | Own Gemini caller, prompt, validation, summary | DONE |
| 3 | Durable job, worker, automatic upload trigger | DONE |
| 4 | API + notifications | DONE |
| 5 | Admin UI | DONE |
| 6 | Full verification + final report | pending |

---

## Phase 0 - Gemini diagnosis (DONE)

**Question:** why might Gemini not produce output for a long petition?

**Checked read-only against the live configuration (key never printed):**
- `GEMINI_API_KEY` is present on this server. No `PETITION_AI_API_KEY` yet (optional override).
- Env model `GEMINI_MODEL = gemini-flash-latest`; the stored provider config (`AIProviderConfig`, key `gemini`) also says `gemini-flash-latest`, enabled. So the retired `gemini-2.5-flash` problem seen in October is **not** present now; the two agree.
- `FORM_AI_MAPPING = on` is set (form mapping shares the same key and therefore the same quota).

**Root causes found in the existing code (`document-intelligence/services/gemini.service.js`), which the new caller avoids:**
1. Empty answers (safety / recitation block, no candidate) were not recognised: text became `""` and the error read "invalid JSON", hiding the real reason; `finishReason` / `promptFeedback.blockReason` were never captured.
2. No `maxOutputTokens` / response schema and `gemini-flash-latest` is a thinking model whose thinking tokens eat the output budget, so a long findings list can be cut off mid-JSON (`MAX_TOKENS`).
3. A quota / billing 429 was retried 5 times as if temporary (earlier runs failed with "exceeded your current quota").
4. Model drift risk: stored config -> env -> a moving `latest` alias.
5. 90 s timeout with a PDF attached.
6. Shared quota: form mapping and the petition scan use the same key, so heavy use of one can starve the other (a dedicated `PETITION_AI_API_KEY` removes this).

**Built:** `Backend/scripts/diagnoseGemini.js` - offline by default (prints configuration only, makes no network call); `--live` makes ONE tiny text-only call (64 output tokens max) and prints HTTP status, latency, `finishReason`, `blockReason`, token use and a verdict (`OK | EMPTY_RESPONSE | BLOCKED | TRUNCATED | QUOTA | HTTP_xxx`). The verdict logic is exported (`classifyReply`) so the real scan uses the same rules.

**Tests (DB-free), `petition-ai-review/tests/diagnoseGemini.test.js`: 8 / 8 pass** - each reply type is classified correctly; the script runs offline, makes no network call and never prints the key (asserted with a fake key).

**Live diagnosis (run 2026-11-03 at the owner's request, one tiny call):**
```
httpStatus 402 - "Your prepayment credits are depleted. Please go to AI Studio at https://ai.studio/projects
to manage your project and billing."   latency 630 ms, no tokens used
```
**This is the real root cause of Gemini producing no output right now:** the Google AI Studio project behind `GEMINI_API_KEY` has no prepaid credits left, so Google refuses every request (form mapping, document intelligence and the petition scan alike). The key and the model name are fine. The code-level causes above are real but secondary. Nothing in the app can fix this; the owner must top up billing in Google AI Studio (or set a different funded key as `PETITION_AI_API_KEY`).
The classifier now names this case `BILLING` (HTTP 402, never retried) - test added, **9 / 9 pass**. The Petition AI Review scan will show "AI billing: prepaid credits are used up - top up in Google AI Studio, then press Retry" instead of failing silently.

**Not done in this phase:** nothing planned for Phase 0 is left. No existing app code was changed.

**What you need to do:**
1. Top up Gemini billing at https://ai.studio/projects (the project behind `GEMINI_API_KEY`), or provide a different funded key to set as `PETITION_AI_API_KEY` on the server. Without this the scanner can be built and tested, but no real petition can be scanned.
2. When convenient, send the correct FedEx / filing address(es) and any extra company rules the scan should check (needed by Phase 1's rules list; it can start empty).

**Remaining:** Phases 1-6 (see the status table). Open items: Gemini billing, FedEx / filing addresses, approval for one small live smoke test in Phase 6.

**Next step:** Phase 1 (models, company-rules list, env settings, PDF page slicer off the main thread, batch planner, with DB-free tests). Waiting for your approval.

---

## Phase 1 - Foundations (DONE)

**Done** (all new files; no existing app file was wired to them yet, so the live app behaves exactly as before):
- `Backend/src/modules/petition-ai-review/constants.js` - the fixed vocabulary: scan statuses, severities (error / warning / info), categories (typo, wrong_name, address_mismatch, company_rule, consistency, unreadable_page), AI outcome codes (incl. `BILLING` for HTTP 402), PDF error codes.
- `config.js` - every setting from env with safe, clamped defaults and the master switch `PETITION_AI_REVIEW`; key precedence `PETITION_AI_API_KEY` -> `GEMINI_API_KEY` -> others; the key value is never part of the config object.
- `batchPlanner.js` - splits a petition into page batches (default 4), resumes from any page, halves a batch, applies the page cap, and maps a page number the AI reports inside a slice to the real page number (out-of-slice numbers rejected).
- `rules.js` - the rule set: fixed company rules always applied (Immiglance is not a law firm / gives no legal advice; "Immiglance" is the only brand, legacy names like BAIS flagged; no promised outcome - factual mentions of a past approval allowed; names / case facts must match the case; addresses must match the expected ones) + the company's own disclaimer and prohibited terms from the existing compliance settings + editable addresses / team rules. Never throws.
- Models: `PetitionAiScan` (durable job with page cursor, lease + fence, gaps, counts, summary, per-batch diagnostics; partial unique index = one open scan per petition), `PetitionAiFinding` (one issue per page, own collection), `PetitionAiRules` (editable expected FedEx / filing addresses + extra rules, versioned).
- The petition page reader: `pdfSlicer.js` (server side) + `pdfSliceWorker.js` (the reader). It runs in a **separate child process**, so a 200 MB / 700-page petition never slows the website and a reader crash can never take the server down.
- `.env.example` - the new settings documented (names and defaults only).

**Robustness built in Phase 1 (every error solved in code, each with a backup):**
| Problem | Automatic backup (tested) |
|---|---|
| pdf-lib refuses the file (encrypted with permissions only, or damaged) | pdf.js backup reader opens it and returns each page's text ("text" mode) |
| pdf-lib hangs or crashes while opening a file | after the load timeout a fresh process opens it straight away with the text reader |
| reader process crashes / runs out of memory during a page request | fresh process started, request retried (bounded, default 2 restarts) |
| reader keeps crashing | stops after the allowed restarts with a typed error - never loops forever |
| file locked with an opening password / unreadable by both readers / empty | typed error with a plain message ("upload an unprotected copy" etc.), never a hang |
| AI later refuses a PDF slice | the same pages are available as text (`reader.text`) for the Phase 2 fallback |

**Found and fixed while building:** terminating a worker *thread* after pdf.js had run crashed the whole Node process (segmentation fault). The reader was therefore moved to a separate child process - a crash there is contained and handled by the restart backup. This was caught by the tests before anything was wired into the server.

**Tested** - `petition-ai-review/tests/phase1.foundations.test.js` + `diagnoseGemini.test.js`: **29 / 29 pass, 0 skipped, run twice (13 s)**, all database-free. They prove: config defaults / switch / key precedence / key never exposed; 37 pages in batches of 4 = every page exactly once; resume from every possible page (pages 1-41 x batch sizes 1-6) with no gap or overlap; page cap; split keeps coverage; slice page mapping; rule set + loadRules never throws when every source fails; model validation (good / bad values, unique open-scan index); every slice of a 37-page petition holds exactly the right pages; the caller's buffer is never changed; corrupt / empty files typed errors; a REAL qpdf-encrypted petition read by the backup reader; an opening-password petition gives a clear typed error; crash-once worker recovered; crash-always stops after restarts; hung loader falls back to text quickly; out-of-range / closed requests refused; **a 700-page petition sliced in full while the server's event loop stayed responsive (< 250 ms lag)**.

**Not done in this phase:** nothing planned for Phase 1 is left. Not yet connected to uploads, the AI or the UI (Phases 2-5).

**What you need to do:**
1. **Reminder: add purchase / top up the prepaid credits in the Google AI Studio project** (https://ai.studio/projects) - Gemini still answers HTTP 402 "prepayment credits are depleted", so no real petition can be scanned until this is done.
2. When convenient, send the correct FedEx / filing address(es) and any extra rules (they go into the editable rules record; the scan works without them, it just cannot check addresses).
3. Nothing to deploy yet - nothing is wired into the running app.

**Remaining:** Phases 2-6. Open items: Gemini billing, FedEx / filing addresses, approval for one small live smoke test in Phase 6.

**Next step:** Phase 2 - the petition's own Gemini caller (response schema, output budget, precise BILLING / QUOTA / BLOCKED / TRUNCATED / EMPTY handling, automatic fallbacks: halve on cut-off, re-send as text when blocked, repair prompt on bad JSON, switch to another configured AI provider or auto-resume when billing returns), the prompt with the case facts and rules, finding validation and the page summary. Waiting for your approval.

---

## Phase 2 - AI layer (DONE)

**Done** (all new files in `Backend/src/modules/petition-ai-review/`; still not connected to uploads, the server or the UI, so the live app behaves exactly as before):
- `replyClassifier.js` - the Phase 0 reply rules moved here, shared by the scan and `scripts/diagnoseGemini.js` (the script now imports it; its output is unchanged).
- `petitionGemini.js` - the petition's own Gemini caller (the shared `gemini.service.js` is not touched). Output budget (`maxOutputTokens`), small thinking budget (1024) and a response schema, so thinking tokens cannot cut the JSON off; every reply mapped to a precise code; 402 / 429 / 403 / 404 sent once, never hammered; 5xx / network / timeout retried with backoff (2 retries); an HTTP 400 on the settings themselves is re-sent once without thinking / schema and the caller stays on the plain settings. The key travels in the `x-goog-api-key` header, never in the URL, so it cannot appear in an error or a log.
- `prompt.js` - system instruction with the case reference facts, expected addresses, every company rule, prohibited terms and the disclaimer; per-batch prompt for PDF mode and for text mode; repair prompt; the response schema. Pages are asked relative to the slice and mapped to real pages in code.
- `findingValidator.js` - parses the answer (tolerates fences / surrounding text), maps pages to real pages and drops any outside the pages sent, enforces categories / severities (with common aliases), clamps confidence, trims text to the model limits, merges duplicates (most severe kept).
- `summaryBuilder.js` - code-built summary (counts, page -> issues, category totals, plain text with unreadable pages and page-cap note, "AI-assisted - verify before acting"); optional short AI executive summary from the findings text only, falling back to the code-built text on any failure.
- `fallbackProvider.js` - backup AI through the existing `ai-provider.registry`: the first non-Gemini provider with a key on the server (OpenAI, Anthropic, Azure OpenAI, private model), text mode only. None configured -> null (the scan pauses instead, Phase 3).
- `batchReviewer.js` - reviews one batch with every backup applied automatically (table below). It only ever returns a result, or a typed "stop the run" error for billing / quota / rejected key when no backup exists - nothing else can escape.

**Every failure solved in code (each one tested):**
| Problem | Automatic solution |
|---|---|
| Answer cut off (`MAX_TOKENS`) | batch halved down to one page; a single page then sent as text; then flagged `unreadable_page` |
| Blocked / empty answer for a PDF slice | same pages re-sent as extracted text; still blocked -> halved to isolate the page; that page alone flagged `unreadable_page` |
| Answer not valid JSON | one stricter repair re-ask; then halved; a single page still bad -> re-queued for the end of the scan |
| Page numbers outside the pages sent | dropped and noted in the diagnostics |
| Slice over the 15 MB inline limit / slicing fails | halved; a single over-size page or a failed slice goes as text |
| Page with no text in text mode (scanned image after pdf-lib failed) | flagged `unreadable_page` without spending an AI call |
| 5xx / timeout / network (after backoff retries) / an unexpected error | batch re-queued (`requeue`, gaps marked `retry`) - pages are never lost |
| Billing 402 / quota 429 / rejected key / no key | switch to the backup AI in text mode (Gemini not called again for that scan); no backup or backup also failing -> typed stop error (Phase 3 pauses the scan and resumes it on its own) |
| AI summary fails | code-built summary kept |

**Tested** - `petition-ai-review/tests/phase2.ai.test.js` (37 tests) + Phase 0/1 tests: **66 / 66 pass, 0 skipped, run twice (21 s)**, database-free, no network (Gemini stubbed). Includes an end-to-end run with the REAL PDF reader and the real Gemini caller on a stubbed network (8-page petition, two batches, findings on the right pages). One test expectation was corrected while building (a page number sent as the string "2" is correctly accepted). `node scripts/diagnoseGemini.js` still runs offline and makes no call.

**Not done in this phase:** nothing planned for Phase 2 is left. The automatic pause + 30-minute re-check when billing / quota stops a run belongs to the Phase 3 worker (Phase 2 delivers the typed stop signal it acts on). Loading the case facts from the database (names of client / petitioner / beneficiary / employer) is done by the Phase 3 worker; the prompt already accepts them.

**What you need to do:**
1. Gemini billing: the live check on 2026-11-03 still answered HTTP 402 "prepayment credits are depleted" after the switch to pay-as-you-go - confirm in https://ai.studio/projects that the project behind the server's `GEMINI_API_KEY` is on pay-as-you-go, or put the new White Cedar key into `GEMINI_API_KEY` / `PETITION_AI_API_KEY` and restart the backend.
2. **Decision before Phase 3:** the master switch `PETITION_AI_REVIEW` currently defaults to **on** in `config.js` and `.env.example` (harmless today - nothing is wired). Recommended: default **off** from Phase 3, so the scan only starts once you set `PETITION_AI_REVIEW=on`.
3. Optional: if you want a backup AI when Gemini fails, set one of `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` on the server (it then reviews petition text automatically). Without one, a billing / quota stop just pauses the scan.
4. Still open: the correct FedEx / filing address(es) and any extra rules.

**Remaining:** Phases 3-6. Open items: Gemini billing, the master-switch default, FedEx / filing addresses, approval for one small live smoke test in Phase 6.

**Next step:** Phase 3 - durable scan job (lease + fence, resume from the page cursor), worker started with the server, automatic trigger after a petition upload (after the response, never throwing), re-queued pages retried at the end, pause + automatic re-check on billing / quota, manual re-scan / cancel. Waiting for your approval.

---

## Phase 3 - Durable job, worker, automatic trigger (DONE)

**Owner decision applied first:** the master switch is now **off by default** - `PETITION_AI_REVIEW` must be set to `on` (or true / 1 / yes / enabled) for anything to happen; unset or any other value = off (`config.js`, `.env.example`, Phase 1 test updated). With it off the server starts no worker and the upload hook returns at once.

**Done:**
- `scanService.js` - every operation on a scan, with the lease + fence pattern of the form pipeline: one open scan per petition (two simultaneous uploads share one scan), atomic claim, a scan whose worker died is claimable again and resumes at its saved page, scans that keep dying are closed as failed, idempotent page-range writes (a range written twice keeps one copy of its findings), pause / backoff release / shutdown hand-back / complete / close, and the team actions for Phase 4: cancel, retry (re-check a waiting scan now, or reopen a failed / cancelled one from the page it reached), re-scan.
- `scanRunner.js` - runs one claimed scan: reads the petition (existing cached `readDocumentBuffer`, no second storage read), opens the page reader (separate process), plans pages on the first claim, reviews batches in rounds (default 2 AI calls in flight), stores each range and moves the cursor, re-reviews temporarily failed pages at the end (at most 2 more times each), builds the summary and finishes. A heartbeat keeps the lease alive during long AI calls. The reader is always closed. It never rejects.
- `worker.js` - one scan at a time per server, polls every 20 s, `kick()` starts at once after an upload, passes never overlap, graceful stop.
- `caseFacts.js` - the case number, visa type and the names of the people / companies on the case for the prompt (read-only, never throws).
- `index.js` - assembly: `startPetitionAiReview()` (null unless switched on, never throws) and the upload hook `onPetitionUploaded()`.
- Models: `PetitionAiScan` gained `retryRanges`, `paused` and `usedFallback` (additive).
- **The only edits to existing files** (both wrapped so they can never throw):
  - `documents/document.service.js` - right after the existing petition `ensureReview` call: `onPetitionUploaded(...)`. It returns at once; the scan is queued on a later tick, after the upload response. It reaches both the normal and the chunked upload (both go through `createDocumentFromFile`); a duplicate upload returns earlier and never reaches it; other document types are ignored.
  - `server.js` - starts the worker beside the other workers and stops it on shutdown.

**Every way a scan can end is decided in code:**
| Situation | What happens automatically |
|---|---|
| Worker / server dies mid-scan | lease expires (2 min), another pass resumes at the saved page; every page is scanned exactly once and the dead worker can write nothing |
| Server shuts down normally | scan handed back without using an attempt; the restart resumes it at once |
| AI billing / quota / rejected key | scan paused, re-checked every 30 min from the same page, resumes by itself (Retry re-checks at once); after a week of waiting it is closed as failed with Retry |
| Backup AI configured | used instead of pausing (text mode) |
| AI 5xx / timeout / bad JSON on some pages | those pages re-reviewed at the end (2 more tries), then flagged `unreadable_page` (status `completed_with_gaps`) - never silently missing |
| Storage error, reader crash, unexpected error | retried with backoff 1, 2, 4, 8 min; after 5 attempts failed with Retry |
| Petition deleted | closed as cancelled with the reason |
| PDF locked with a password / damaged / empty | failed with a plain message ("upload an unprotected copy") |
| No AI key and no backup | `not_configured` with a readable message |
| Team cancels | the worker's next write is refused and it stops; nothing more is written |
| Page cap (`PETITION_AI_MAX_PAGES`) | only the first pages scanned; the summary says which pages were not |

**Tested** - `petition-ai-review/tests/phase3.job.test.js` (27 tests; in-memory store built on the real schemas, AI stubbed, no database, no network) + Phases 0-2: **93 / 93 pass, 0 skipped, run twice (30 s)**. They prove all of the above, including: a worker frozen mid-scan is taken over and every page is still scanned exactly once with zero writes from the stale worker; billing pause and automatic resume from the failing page; the upload hook is off by default, ignores other documents and duplicates, writes nothing during the request, takes < 5 ms and never throws (even when queueing fails); an end-to-end run with the REAL PDF reader and the real Gemini caller on a stubbed network; a 700-page petition completed with every page once and event-loop lag < 250 ms. While building, three test expectations were corrected (the code was right): an expired lease makes a scan claimable again; a stop before the first claim claims nothing; a page number sent as text is accepted.

**Full regression (2026-11-04, `runSafeTests`, 380 database-free test files, run after Phases 3-5):** 3,009 tests, **2,990 pass**. The suite was run without `form-pipeline/tests/sim/errorScenarios.sim.localdb.test.js`, which hangs indefinitely on this machine (it waits for a local test database; it stopped the first full run for about 2 hours). Of the 19 failures: **none is caused by Petition AI Review**; 1 was the old case-manager upload rule (test updated to the owner-approved "case managers work every case" rule - now passes); 1 is the timing of the Phase 1 "reader hangs" backup test under full-suite load (passes on its own, 102/102 twice); 1 ("a renderer that CUTS a long text") is the owner-requested `PDFRenderer.js` rollback (the removed lines are saved to re-apply later); the other 16 are on code not changed by this work (form pipeline / edition policy / questionnaires / compliance / form import / family-workflow text checks / 2 information-request tests proven to fail without these changes too), matching the known failures recorded after the form-pipeline Phase 6.

**Not done in this phase:** nothing planned for Phase 3 is left. Notifications when a scan finishes, and the API for cancel / retry / re-scan, are Phase 4 (the service functions exist; `onFinished` is the hook point).

**What you need to do:**
1. Nothing to switch on yet. Keep `PETITION_AI_REVIEW` unset / `off` until Phase 5 (the screen) is done - otherwise scans would run with no way to see them.
2. Your running backend (nodemon) reloads with these changes; with the switch off it logs `petition_ai_review_off` and does nothing else.
3. Still open: Gemini billing (pay-as-you-go not yet active for the server's key at the last check), FedEx / filing addresses, optional backup AI key.

**Remaining:** Phases 4-6. Open items: Gemini billing, FedEx / filing addresses, approval for one small live smoke test in Phase 6.

**Next step:** Phase 4 - `/api/petition-ai-review` (staff only, existing auth + case access): scans by case (counts only), scan detail + paged findings, re-scan, retry, cancel; live `petition:ai_review` event (throttled) and a bell notification to the uploader when a scan finishes. Waiting for your approval.

---

## Phase 4 - API and notifications (DONE)

**Done** (new files in `Backend/src/modules/petition-ai-review/`, plus one guarded line in `routes/index.js`):
- `reviewApi.service.js` + `petitionAiReview.routes.js` - `/api/petition-ai-review`, **staff only** (super admin, admin, team lead, case manager) **with access to the case**, using the same case lookup and `canAccessCase` as the petition review module:
  - `GET /cases/:caseId` - the case's petitions with their latest scan, **counts only** (no findings, no diagnostics);
  - `GET /scans/:scanId` - status, summary, page -> issues, category totals, gaps, the newest 50 diagnostics (never the worker's lease);
  - `GET /scans/:scanId/findings` - paged (50 by default, at most 200), filters `severity`, `category`, `fromPage` / `toPage`;
  - `POST /cases/:caseId/documents/:documentId/rescan` - a fresh scan from page 1 (the running one is returned if there is one), wakes the worker;
  - `POST /scans/:scanId/retry` - re-check a waiting scan now, or reopen a failed / cancelled one from the page it reached;
  - `POST /scans/:scanId/cancel` - stop a running scan.
  A scan of a case the person cannot access is 403, an unknown one 404 - never another case's data. With `PETITION_AI_REVIEW` off the reads still answer (`enabled: false`, existing results stay visible) and the actions answer 404 "switched off".
- `notifier.js` - live event `petition:ai_review` to the case team while a scan runs (at most once per scan every 2 s) and when it ends (also to the person who started it), and a **bell notification** to that person when the scan reaches an end state (finished / finished with unread pages / stopped / not set up) - not for a pause, which resumes by itself. Uses the existing notification type `general` (no change to the shared type list). It never throws and is never awaited by the scan.
- `scanRunner.js` - a progress hook after each stored page range (fire-and-forget).
- `routes/index.js` - the route is mounted inside a try/catch, so a load problem can never stop the API from starting.

**Tested** - `phase4.api.test.js` (9 tests; the real router in a local HTTP server, an in-memory store on the real schemas, no database, no network): sign-in required; clients / attorneys refused; a case manager of another case gets 403 on that case, its scans and its actions; unknown / malformed ids 404; counts-only case list; scan detail without the lease and with 50 diagnostics; paging and filters (and the 200 cap, unknown filter values ignored); re-scan creates one scan and wakes the worker once, refuses non-petitions, deleted petitions and other cases' petitions; cancel / cancel twice (409) / retry reopens / retry with another open scan (409); feature off; progress throttling; who is notified; bell only for end states; every notification failure swallowed. **All Petition AI Review tests (Phases 0-4): 102 / 102 pass, run twice.**

**Full regression (2026-11-04, `runSafeTests`, 380 database-free test files, run after Phases 3-5):** 3,009 tests, **2,990 pass**. The suite was run without `form-pipeline/tests/sim/errorScenarios.sim.localdb.test.js`, which hangs indefinitely on this machine (it waits for a local test database; it stopped the first full run for about 2 hours). Of the 19 failures: **none is caused by Petition AI Review**; 1 was the old case-manager upload rule (test updated to the owner-approved "case managers work every case" rule - now passes); 1 is the timing of the Phase 1 "reader hangs" backup test under full-suite load (passes on its own, 102/102 twice); 1 ("a renderer that CUTS a long text") is the owner-requested `PDFRenderer.js` rollback (the removed lines are saved to re-apply later); the other 16 are on code not changed by this work (form pipeline / edition policy / questionnaires / compliance / form import / family-workflow text checks / 2 information-request tests proven to fail without these changes too), matching the known failures recorded after the form-pipeline Phase 6.

**Not done in this phase:** nothing planned for Phase 4 is left. The screen that uses this API is Phase 5.

**What you need to do:**
1. Nothing to switch on yet: keep `PETITION_AI_REVIEW` unset / `off` until Phase 5 (the screen) is done.
2. Deploy the backend when convenient - with the switch off the new routes only show existing results (none yet) and refuse actions.
3. Still open: Gemini billing (still HTTP 402 "prepayment credits depleted" at the last check), FedEx / filing addresses, optional backup AI key.

**Remaining:** Phases 5-6.

**Next step:** Phase 5 - the Admin screen: an **AI Review** button and live status chip in each petition row, and the findings panel (severity counts, issues grouped by page, filters, "Open page N", Re-scan / Retry / Cancel, "AI-assisted - verify before acting"). Waiting for your approval.

---

## Phase 5 - Admin UI (DONE)

**Done** (Admin frontend; new files in `Admin/frontend/src/pages/petition/`, a few guarded lines in `PetitionUploadPanel.jsx` and `services/api.js`):
- `services/api.js` - `petitionAiReviewApi` (list for a case, scan, findings, re-scan, retry, cancel).
- `petitionAiStatus.js` - the plain-language status of a scan ("Scanning 40 of 120 pages", "3 issues (1 to fix)", "Waiting - AI billing", "No issues found", "AI review not set up", "AI review stopped"), shared by the row and the panel.
- `PetitionUploadPanel.jsx` - in each petition row a **status chip** and an **AI Review** button. Shown only when AI review is available (switched on, or results exist); if the AI API is off or answers with an error, nothing new appears and the petition list is exactly as before. Live updates through `petition:ai_review` (the chip and an open panel refresh by themselves). "Open page N" opens the existing petition viewer at that page (`#page=N`).
- `PetitionAiReviewPanel.jsx` - the findings window, centred and themed: status, severity counts (to fix / to check / minor), the summary, findings **grouped by page** with severity and kind filters and paging (50 at a time), "Open page N", a one-line note when some AI calls needed a retry or fallback, the pause / stop message (e.g. AI billing), and the actions **Re-scan** (asks first in the themed confirmation window), **Retry now**, **Cancel scan** (asks first). Footer: "AI-assisted - verify before acting." It is **loaded only when opened** (`React.lazy`): a separate 10 kB file (4 kB compressed), so the petition page's own code and first paint are unchanged.

**Tested** - `PetitionAiReview.test.jsx` (10 tests): every status wording; the panel's counts / summary / page groups / disclaimer; Open page N; filters re-ask the server; Re-scan confirmation (Cancel does nothing, confirm starts a new scan and the panel follows it); stopping a running scan; Retry now on a waiting scan; the fallback line; an API error shown, never a crash; a never-scanned petition; the row chip + button opening the panel; nothing shown when the feature is off with no results or the API fails; a live event refreshing the chip. The 14 existing `PetitionUploadPanel.test.jsx` tests pass unchanged. **Admin: all 37 test files pass; production build OK** (the panel is its own chunk).

**Full regression (2026-11-04, `runSafeTests`, 380 database-free test files, run after Phases 3-5):** 3,009 tests, **2,990 pass**. The suite was run without `form-pipeline/tests/sim/errorScenarios.sim.localdb.test.js`, which hangs indefinitely on this machine (it waits for a local test database; it stopped the first full run for about 2 hours). Of the 19 failures: **none is caused by Petition AI Review**; 1 was the old case-manager upload rule (test updated to the owner-approved "case managers work every case" rule - now passes); 1 is the timing of the Phase 1 "reader hangs" backup test under full-suite load (passes on its own, 102/102 twice); 1 ("a renderer that CUTS a long text") is the owner-requested `PDFRenderer.js` rollback (the removed lines are saved to re-apply later); the other 16 are on code not changed by this work (form pipeline / edition policy / questionnaires / compliance / form import / family-workflow text checks / 2 information-request tests proven to fail without these changes too), matching the known failures recorded after the form-pipeline Phase 6.

**Not done in this phase:** nothing planned for Phase 5 is left.

**What you need to do:**
1. Deploy the backend (Phases 3-4) and Admin (Phase 5).
2. To start scanning, set `PETITION_AI_REVIEW=on` on the server and restart the backend. Gemini answers again (HTTP 200 at the last check, 2026-11-04), so scans can run; each scan spends AI credits (about one call per 4 pages).
3. Still open: the FedEx / filing addresses for the address check; optional backup AI key.

**Remaining:** Phase 6 (full verification, one small capped live scan of a real petition - needs your approval because it spends credits - and the final report).

**Next step:** Phase 6. Waiting for your approval.

---

## Phase 6 - Usage and cost, the scan command, first live scan (DONE)

**Done (code):**
- `petitionGemini.js` - every reply's token use split the way Google bills it (input / output / thinking) and the exact `modelVersion` behind the alias; tokens of refused, failed and retried attempts are counted too.
- `batchReviewer.js`, `scanRunner.js`, `scanService.js`, `models/PetitionAiScan.js` - the split is added up per scan (`usage.input / output / thinking`, `modelVersion`), including the closing summary call (it was not counted before). Bad numbers count as 0 and never corrupt the totals.
- `pricing.js` - cost in US dollars from `PETITION_AI_PRICE_INPUT_PER_M` / `PETITION_AI_PRICE_OUTPUT_PER_M` (defaults $0.75 / $3.75 per 1M tokens, Google's published gemini-3.8-flash rates; thinking billed as output). The scan detail API returns `usage.costUsd` (null for older scans without the split).
- `costEstimate.js` - a rough up-front estimate (calibrated on the live scan, deliberately on the high side).
- `scanService.claimNext({ scanId })` - claims only the named scan.
- `scripts/runPetitionAiScan.js` - `--document <id>`: dry run (page count + estimate, nothing sent or written); `--confirm`: the real scan with the server's own code, then findings, tokens and dollars; `--out file.json`. Works while the server switch is off; Ctrl+C hands the scan back.
- Admin AI Review panel - one line "AI use: N calls - tokens - about $X - model version".
- **Fix found by the live scan:** the AI did not know today's date and called a petition dated 2026-10-26 "far in the future". The instruction now carries today's date (`prompt.js`).

**First live scan (2026-11-04):** Rev3_Pratap_Consello_Petition.pdf, case B420 (EB-3), 96 pages, 15.5 MB. Completed in 205 s (about 100 s of that is downloading the PDF from storage; the AI part about 90 s). 25 AI calls (24 x 4 pages + the summary), model `gemini-flash-latest` answered by `gemini-3.8-flash`. Tokens: input 67,905, output 2,699, thinking 0 (total 70,604). **Cost: $0.061** (about $0.0006 per page; a 500-page petition about $0.32 and 10-15 minutes). Findings: 21 to fix, 4 to check, 2 minor; scan id `6aea7ea43206cbc6475c17b8` (kept: it is the real review of a real petition, visible in Admin).

**What the review was based on:** the case reference facts (case number B420, visa type EB-3, petitioner Consello Technologies Inc), the fixed company rules (not a law firm, Immiglance-only branding, no promised outcome, names / case facts must match, addresses must match), the 9 prohibited terms from the compliance settings, and general proof-reading (typos, repeated words, dates, receipt numbers and facts that contradict each other). Each 4-page slice was sent as the real PDF (layout and scanned images included), answers were forced into a fixed JSON schema and validated in code (page numbers checked, duplicates merged).

**Known limits seen in this scan:** (1) the date findings on pages 1, 45, 47 and 73 are false alarms caused by the missing date (fixed above; a re-scan will not repeat them); (2) the beneficiary's name is not in the case facts for B420 (only the employer is linked), so beneficiary-name spelling is checked only for consistency, not against the case; (3) no expected FedEx / filing addresses are stored yet, so addresses are not checked.

**Tested:** `phase6.usage.test.js` (12 tests) + the updated Phase 3 expectation (the summary call is now counted: 4 calls, not 3). **Petition AI Review + documents: 140 / 140 pass.** Admin: `PetitionAiReview.test.jsx` 11 / 11; production build OK.

**Follow-up the same day (owner decisions 2026-11-04):**
- The organisation-name check is **off**: the Bay Area Immigration Services team prepares the petitions in the portal and rightly writes its own name. The rule is kept (`PETITION_AI_BRAND_CHECK=on` brings it back); while off, the AI is told the name is correct and any finding about BAIS / Bay Area is dropped in code (other name findings, e.g. "Corp." vs "Inc", are kept; a typo in the name is still reported).
- The summary is now a **page-by-page bullet list built in code** from the findings (no AI call, so it is exact, complete and costs nothing): one bullet per page in page order; one issue sits on the page's line, two or more become sub-points; each names the **section** of the page (the AI now returns `section`, stored on every finding). Capped at 300 items ("... and N more in the list below"). Admin shows it as a bulleted list with "Page N" links; older scans still show their paragraph.
- Bug found and fixed while doing this: the findings read back for the summary did not include the new `section` field; the test store now honours field selection like MongoDB, and an end-to-end test covers it.
- `.env.example`: `PETITION_AI_REVIEW=on`, `PETITION_AI_PRICE_INPUT_PER_M`, `PETITION_AI_PRICE_OUTPUT_PER_M`, `PETITION_AI_BRAND_CHECK=off`.
- **Re-scan of B420** (scan `6aea82f1e37ec8ac94df1993`): 183 s, 24 calls, 70,128 input + 3,103 output tokens, **$0.064**; 27 issues on 24 pages (19 to fix, 2 to check, 6 minor); no Bay Area findings, no "future date" false alarms on the letters. Tests: **146 / 146** (Petition AI Review + documents), Admin 27 / 27, Admin build OK.

**What you need to do:** deploy; optionally set `PETITION_AI_PRICE_INPUT_PER_M=1.5` and `PETITION_AI_PRICE_OUTPUT_PER_M=7.5` on 2027-01-01 (Google's announced price change); add the FedEx / filing addresses when ready.

