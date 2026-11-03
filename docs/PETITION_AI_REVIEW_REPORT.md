# Petition AI Review - implementation report (single living document)

This file is the one place that records every phase of the Petition AI Review subsystem: what was built, what was tested, what is not done yet. It is updated at the end of each phase. Plan: `C:\Users\ishaan\.claude\plans\melodic-skipping-muffin.md`.

**What it is:** when the internal team uploads a petition (PDF, often 500-700 pages) the petition is scanned automatically, page by page, by an AI (Gemini, key from the server env). The findings ("page 112: wrong name; page 340: address differs ...") are shown in a summary panel inside that petition's row in the Admin petition list, behind its own **AI Review** button.

**Ground rules kept in every phase:** additive only (new files; existing files get tiny guarded hooks), master switch `PETITION_AI_REVIEW=off`, upload responses untouched, scan runs after the response and can never throw into a request, no CI/CD edits, `Backend/.env` never read, no shared-DB writes in tests, no real Gemini spend without the owner's approval.

**How this report works:** one phase is built at a time. After each phase the work stops until the owner approves the next one, and that phase's section below always lists: Done, Tested, Not done in this phase, What you need to do, Remaining, Next step.

## Status

| Phase | What | Status |
|---|---|---|
| 0 | Gemini diagnosis + diagnostic script | DONE |
| 1 | Models, rules, env, PDF slicer, batch planner | DONE |
| 2 | Own Gemini caller, prompt, validation, summary | pending |
| 3 | Durable job, worker, automatic upload trigger | pending |
| 4 | API + notifications | pending |
| 5 | Admin UI | pending |
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

*(Phases 2-6 are added below as they are completed.)*
