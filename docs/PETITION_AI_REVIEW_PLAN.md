<!--
  Exact copy of the approved plan (rev 3), moved into the repo for future reference.
  Source: C:\Users\ishaan\.claude\plans\melodic-skipping-muffin.md (2026-11-03).
  Progress per phase is recorded in docs/PETITION_AI_REVIEW_REPORT.md - this file is the plan, not the status.
-->

> **Status as of 2026-11-03:** Phases 0, 1 and 2 DONE (Phase 1 = commit `18d5f33`; 66/66 DB-free tests pass). Phases 3-6 pending, each waiting for owner approval.
> **One deliberate change from the plan text below:** the PDF reader runs in a separate **child process**, not a worker thread - terminating a worker thread after pdf.js had run crashed the whole Node process (segfault), so it was moved out of process during Phase 1. Everything else is as written.

# Petition AI Review - plan (rev 3)

## Context
Internal team uploads each petition (PDF, often 500-700 pages). Nobody checks it except by eye, so typos, a wrong name, a wrong FedEx / mailing address, or wording that breaks company rules ("Immiglance is not a law firm" style) can reach the client or USCIS.
New subsystem: the moment a petition is uploaded it is scanned automatically, page by page, and a per-page findings summary ("page 112: wrong name; page 340: address differs; page 501: legal-advice wording") appears inside that petition's row in the Admin petition list, behind its own button.

Confirmed: existing AI platform (Gemini key in env) + optional dedicated overrides; pages sent as PDF slices (typed and scanned); checks = case data + company rules + typing/wording.

**What "guaranteed" means here (honest scope):** the *implementation* is guaranteed complete - every phase below has written acceptance tests that I run myself, database-free, and the feature is not called done until all pass. What cannot be guaranteed is the AI's judgement on any one page (it can miss or over-flag), so the UI labels findings "AI-assisted - verify before acting" and every finding carries page, quoted text and confidence.

## Hard rules (nothing existing may break, error, or slow down)
- **Additive only.** All logic in new files (`Backend/src/modules/petition-ai-review/`, new models, new Admin components). Existing files get only tiny guarded hooks: upload hook, route registration, worker start, one button in the petition row.
- **Master switch** `PETITION_AI_REVIEW=off` disables everything with no side effects (rollback = env + restart).
- Shared `document-intelligence/gemini.service.js` and the form-mapping / document-intelligence flows are **not modified**; the scan has its own Gemini caller.
- Upload response (`201 {success, message, document}` / `200 {duplicate}`) untouched; the scan starts **after** the response, non-awaited, fully try/caught. Petition list responses get no new fields.
- Missing key => status `not_configured` (a readable message), never an error. Worker never crashes the server.
- **Speed guarantees (website must not slow down):**
  - PDF parsing/slicing of a large file runs in a **worker thread** (not the web request thread), so the event loop of the API is never blocked by a 200 MB PDF.
  - Hard caps: 1 scan at a time per server by default (`PETITION_AI_CONCURRENCY`, default 1 scan x 2 parallel AI calls), a memory ceiling (one PDF buffer in memory, slices released after each batch), and a per-tick page cap; the worker sleeps between batches (`PETITION_AI_BATCH_DELAY_MS`) so it cannot starve other requests.
  - Reuses the already-cached petition buffer (`readDocumentBuffer`) - no second storage read.
  - New indexes only on the new collections; findings are paginated (default 50) and the case list returns counts only; summary stored precomputed, so opening the panel is one small read.
  - Admin UI: panel code lazy-loaded (code-split) so the petition page's bundle and first paint are unchanged; progress events throttled (max 1 per 2 s per scan); no polling loops (socket + one fetch on open).
  - Tests measure it: the hook adds < 5 ms to the upload path (asserted), and a synthetic 700-page scan does not block the event loop (event-loop-lag assertion).
- No CI/CD edits, no reading `Backend/.env`, no writes to the shared DB in tests, no real Gemini calls until the owner approves one small capped smoke test.

## Why Gemini may not be producing output - root causes in the current code (read from `gemini.service.js`, `ai-provider.registry.js`)
1. **Empty answers not recognised.** A safety / recitation block or empty candidate gives `""` and the code throws a misleading "Gemini returned invalid JSON"; `finishReason` / `promptFeedback.blockReason` are never captured.
2. **Truncated output.** No `maxOutputTokens` or response schema, and `gemini-flash-latest` is a thinking model whose thinking tokens eat the output budget, so JSON stops mid-way (`MAX_TOKENS`).
3. **Quota / billing 429 retried as temporary** (5x, short backoff). Earlier runs failed with "exceeded your current quota ... billing".
4. **Model drift.** Stored `AIProviderConfig` model, then env, then the moving `latest` alias; `gemini-2.5-flash` was already retired for this key.
5. **Timeouts** (90 s) with PDF input.
Fix built into the new caller (Phase 2): response schema + `maxOutputTokens` + small thinking budget; every reply's `finishReason`, `blockReason`, `usageMetadata` read and mapped to precise errors (`EMPTY_RESPONSE`, `BLOCKED`, `TRUNCATED`, `QUOTA`); `TRUNCATED` -> halve the batch and retry; `BLOCKED` -> retry that page alone, then record an `unreadable_page` finding with the reason; `QUOTA` -> stop, status + Retry button (no hammering); per-batch diagnostics (model, finishReason, tokens, latency) stored on the scan and shown in the UI.

## Robustness rule (owner's instruction): every error is solved in code, every step has a backup
No failure may need a person to fix it by hand. Each failure mode has a coded fallback, applied automatically:
| Failure | Automatic backup |
|---|---|
| PDF cannot be sliced (encrypted / damaged structure) | Fallback reader: pdf.js (decrypts owner-password PDFs, tolerant parser) extracts each page's text -> text-mode review of those pages; pages with no text become `unreadable_page` findings |
| PDF reader worker crashes / hangs / runs out of memory | Worker is restarted automatically and the batch retried (bounded); if it keeps failing, the text fallback is used |
| Gemini answer cut off (`MAX_TOKENS`) | Batch halved and re-sent, down to one page |
| Gemini blocked / empty answer for a slice | Same pages re-sent as extracted TEXT instead of the PDF slice; if still nothing, page recorded as `unreadable_page` (never silently skipped) |
| Bad / invalid JSON from Gemini | Re-asked once with a stricter repair prompt; invalid findings dropped, valid ones kept |
| 5xx / timeout / network | Backoff retries; then the batch is re-queued and the scan continues with the next one, coming back to it at the end |
| Quota 429 / billing 402 (credits depleted) | If another AI provider with a key is configured (e.g. the stored Anthropic config), switch to it automatically; otherwise the scan pauses and an automatic re-check (cheap probe every 30 min) resumes it by itself from the same page as soon as billing works again |
| Server restart mid-scan | Lease expires, another worker resumes from the saved page cursor |
| Notification / socket failure | Logged only; the scan result is stored regardless and the UI reads it on open |
| Summary AI call fails | Deterministic summary built in code from the stored findings |

## Working protocol (owner's instruction): one phase at a time, report, STOP
- Only one phase is worked on at a time. When it is finished, I stop and wait; the next phase starts only after the owner explicitly approves it.
- After every phase the report (given in chat AND appended to the single living document `docs/PETITION_AI_REVIEW_REPORT.md`) always has these sections:
  1. **Done** - exactly what was built in this phase (files, behaviour), in plain words.
  2. **Tested** - which tests ran, how many passed, and what they prove (all database-free).
  3. **Not done in this phase** - anything planned for the phase that was not finished, and why.
  4. **What you (the owner) need to do** - concrete actions (e.g. top up Gemini billing, provide the FedEx addresses, set env vars on the server, restart / rebuild) or "nothing right now".
  5. **Remaining** - the phases still to come and the open items, with the current status table.
  6. **Next step** - what the next phase will do, waiting for approval.
- `docs/PETITION_AI_REVIEW_REPORT.md` keeps one status table for all phases and one section per phase in that same format, so it covers every phase in one file.

## Phases - each lists exactly what is built, and the acceptance tests that must pass before the next phase starts

### Phase 0 - Gemini diagnosis (read-only, no code behind it)
Build: a read-only look at the stored gemini `AIProviderConfig` model name and the env model/key presence (key never printed); `scripts/diagnoseGemini.js` (prints key-present yes/no, model, HTTP status, finishReason, tokens; refuses to call without `--live`).
Done when: the findings above are confirmed or corrected against the real stored config, written into the report; the script runs offline and refuses live calls without the flag (tested). Any live call waits for the owner's approval.

### Phase 1 - Foundations: models, rules, env, PDF slicer, batch planner
Build: `PetitionAiScan` and `PetitionAiFinding` models (indexes: `documentId`+`createdAt`, `scanId`+`page`, `caseId`); rules store seeded from `compliance.constants.js` (disclaimers, prohibited terms, Immiglance-only branding) + editable list of correct FedEx/filing addresses; env parsing with safe defaults and `.env.example` entries; `pdfSlicer` (page count; copy page range -> small PDF; runs inside a worker thread); `batchPlanner` (pages -> batches, resume from cursor, split-in-half, cap by `PETITION_AI_MAX_PAGES`).
Acceptance tests (DB-free): generate a 37-page PDF in-test -> count correct; slices for pages 1-4, 5-8 ... 37 have the right page counts; planner covers every page exactly once, resumes from any cursor with no overlap or gap, halving keeps coverage; encrypted / corrupt / 0-page PDFs return a clean typed error; slicing a large generated PDF in the worker thread leaves event-loop lag under the threshold; model validators accept/reject as designed (local test DB only if needed).

### Phase 2 - AI layer: own Gemini caller, prompt, validation, summary
Build: `petitionGemini.js` with the fixes above; prompt builder (reference facts: case number, client / petitioner / beneficiary / employer names, visa type, correct addresses; rules; "return strict JSON findings, page index relative to this slice"); response schema; finding validator (page must be inside the slice, category/severity enums, excerpt required, drops hallucinated pages, clamps confidence); absolute-page mapping done in code; dedupe; `summaryBuilder` (counts + page -> issues + short AI executive summary from findings text only; deterministic fallback summary if the AI summary call fails).
Acceptance tests (stubbed Gemini): normal JSON -> findings with correct absolute pages; empty candidate -> `EMPTY_RESPONSE` retried then page flagged `unreadable_page`; safety block -> `BLOCKED` path; `MAX_TOKENS` -> batch halves and finishes; 429 quota -> `QUOTA` stops run with resumable state and no repeated hammering; 503 / timeout -> backoff retries then clean failure; malformed / schema-violating JSON rejected; out-of-range page numbers discarded; duplicates merged; summary totals equal finding counts; no key -> `not_configured`.

### Phase 3 - Durable job, worker, automatic trigger
Build: `PetitionAiScanService` (enqueue, claim, heartbeat, fenced writes, dead-letter - the lease/fence pattern of `FormPipelineJobService`); worker started in `server.js` beside the others and cleared on shutdown; trigger hook in `documents/document.service.js` right after the existing petition `ensureReview` call (petition type only, skip duplicates), also on chunked-upload completion if it does not already reach that code path (verified first); manual re-scan creates a new scan; cancel supported.
Acceptance tests (fake store + stubbed Gemini): upload hook enqueues exactly one scan, never throws, never delays the response (< 5 ms asserted), skipped for duplicates / other document types / flag off; worker claims, scans all batches in order, writes findings, finishes `completed`; simulated crash mid-scan (lease expires) -> another worker resumes from the cursor with every page scanned exactly once; lost lease stops cleanly (no stale writes); gaps -> `completed_with_gaps`; retry / cancel behave; 700-page synthetic petition completes with bounded memory and event-loop lag.

### Phase 4 - API and notifications
Build: `/api/petition-ai-review` (staff only, existing auth + case-access): list by case (counts only), scan detail + paged findings, manual re-scan, retry, cancel; realtime event `petition:ai_review` (throttled) + a bell notification to the uploader when finished; route registered behind the master switch.
Acceptance tests: auth required; a user without case access gets 403; non-staff roles blocked; pagination; responses never include other cases' data; notification and socket calls are best-effort and cannot throw; flag off -> routes absent / inert.

### Phase 5 - Admin UI
Build: in `PetitionUploadPanel.jsx` a guarded **AI Review** button + live status chip in each petition row; lazy-loaded `PetitionAiReviewPanel.jsx` (severity counts, findings grouped by page, severity / category filters, "Open page N" jumping the existing viewer, Re-scan, Retry, diagnostics line when a batch failed, "AI-assisted - verify before acting"); themed confirm modal for re-scan; socket subscription like `petition:review`.
Acceptance tests: component tests (idle / scanning / done / failed / not configured), existing `PetitionUploadPanel.test.jsx` still passes (new API call mocked, panel absent when the feature is off or the API 404s), Admin production build succeeds, the petition page bundle size unchanged (panel is a separate chunk).

### Phase 6 - Full verification and report
Run: all new tests, `petition-review/tests/*`, document + chunked-upload tests, form-pipeline job tests, `npm run test:safe`, Admin + Client builds. Write `docs/PETITION_AI_REVIEW_REPORT.md` (design, test results, env list, limitations). Nothing is marked done until every phase's acceptance tests and these regression runs pass.

## Environment (owner sets on the production server; `.env.example` only here)
`PETITION_AI_REVIEW` (on/off), optional `PETITION_AI_API_KEY` / `PETITION_AI_MODEL` (fall back to `GEMINI_API_KEY` / `GEMINI_MODEL`), `PETITION_AI_PAGES_PER_CALL` (4), `PETITION_AI_CONCURRENCY` (2), `PETITION_AI_MAX_PAGES` (1500), `PETITION_AI_TIMEOUT_MS`, `PETITION_AI_BATCH_DELAY_MS`. Backend restart + Admin rebuild needed.

## Open items for the owner
Correct FedEx / filing address(es) and any extra company rules; enough Gemini quota (~175 calls per 700-page petition); permission for one small capped live Gemini smoke test (it spends quota).
