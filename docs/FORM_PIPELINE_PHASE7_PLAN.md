# Phase 7 - Fully autonomous editions (APPROVED 2026-10-22, rev 4)

> **Rev 3 (2026-10-22, after reading the real errors on the Form Import page).** Adds the error catalog below (what is failing today and why), a new release **7.E Error Resolution Engine** built FIRST, the owner's "no error without a solution" standard as measurable acceptance tests, and the list of things only the owner can do. 7.0 and part of 7.1 are already built (behind `FORM_PIPELINE_AUTONOMY=off`); the build order is now 7.E -> 7.2 -> 7.3 -> {7.4, 7.5, 7.7} -> 7.6 -> 7.8.

## A. The errors on the Form Import page today (read-only analysis of the real database, 2026-10-22)
| # | What the page shows | Facts | Root cause (verified) |
|---|---|---|---|
| E1 | 141 jobs in dead-letter, code `QPDF_NOT_FOUND` at stage import (G-1041, G-1041A, G-1055, G-1145, G-1256, G-1450, G-1566, G-1650, G-1651, G-28I, G-325R, AR-11, I-191, I-192, I-193, I-212, G-639 ...), 5 attempts each, repeated by every 12 h sync | `QPDF_PATH` in `.env` points to a file that EXISTS and runs (`qpdf 12.3.2`; a fresh Node process normalizes a PDF fine with it). So the failing process was the long-running backend process, started before qpdf was installed or with a stale environment, and the code reported "not found" for any `ENOENT` (it also fires for a missing temp file) | (a) `normalizePdf` treats every ENOENT as "qpdf missing"; (b) `ensureQpdf` caches nothing useful and its probe uses a 15 s timeout, which under load looks like "missing"; (c) no alternative normalizer; (d) the error is classified transient, so 5 retries, then dead-letter; (e) the sync re-creates the same failing job every 12 h (failure memory is built but off) |
| E2 | 56 finished jobs show "USCIS unreachable"; 374 of the 400 most recent carry the qpdf message as their `checkError` | These are LIVE forms (I-129, I-130, I-131, I-485, I-765, N-400 ...) | A forced "check" re-imports the whole form through qpdf even when nothing changed (`hasNewEdition` compares unlike checksums, audit claim, unconfirmed), then reports a qpdf failure as "USCIS unreachable". Live forms are never actually checked |
| E3 | `USCIS page fetch failed: 404` for I-485J and I-539A (25 times) | **Corrected by the owner and verified live (GET, read-only):** the pages DO exist. I-485J is at `https://www.uscis.gov/i-485supj` (200) and its PDF at `/sites/default/files/document/forms/i-485supj.pdf` (200); I-539A has no page of its own, but `https://www.uscis.gov/i-539` links `/forms/i-539a.pdf` (200, application/pdf). Our code asked for `/i-485j` and `/i-539a` (both 404). Neither template stores a page or PDF URL (both empty in the database) | Wrong address derivation, not a missing page: the importer builds the page slug from the form code, but USCIS slugs differ (`i-485j` -> `i-485supj`) and a supplement can live on its parent's page (`i-539a` on `i-539`). Nothing stores the working address after the first success, so every sync repeats the 404 |
| E4 | `USCIS page fetch failed: 503` (1), `USCIS_PDF_UNRESOLVED` (1) | transient and a missing link | single retry only; no alternate resolution |
| E5 | 28 review/draft editions with NO certification at all (I-918 and supplements, I-864A, I-130A, I-485A, G-1055, G-325R, I-193, I-212, I-956F, AR-11 ...) | They never reached the certify stage because import died first | the pipeline stops at the first stage error and never resumes at certify; a certification is not attempted on demand |
| E6 | Brand-new forms nobody asked for appear and fail (I-191, I-192, I-193, I-212, G-639 ...) | the catalog sync imports every unseen form on uscis.gov | no policy for which forms to import; each new form adds failures |
| E7 | 5 editions kept in review with mapping `needs_review` (G-1041A, G-1041, AR-11, G-1055 ...) | rename carried as `needs_review`, or no mapping | human-only until 7.3/7.4 |

**Honest finding:** E1 and E2 are one defect class (an environment/tool problem misreported and retried blindly), and they explain almost every red row. They are code-solvable, but the error was also hiding that live forms are not being checked.

## B. 7.E Error Resolution Engine (built first)
Principle: **no error is terminal until every known and generic alternative has been tried and verified, and the whole attempt is recorded.** Everything below is code; no step needs a person.

1. **Diagnose before retrying.** `form-pipeline/resolution/Diagnoser`: turns a raw failure into a precise `diagnosis` with evidence instead of a class guess. Example for ENOENT: does the tool path exist? does it run? is the temp dir writable? is the input file there? was the process started before the tool appeared? Output: `{ signature, cause, evidence, fixable }`. `signature` = stable hash of (stage, error code, normalized message, cause).
2. **Strategy catalog (ordered alternatives per cause).** `resolution/catalog/*.js`, each entry `{ cause, strategies:[{ id, run(ctx), verify(ctx), safe }] }`, tried in order, each VERIFIED (not assumed), each attempt recorded on the job (`resolutions[]`: strategy, input, outcome, evidence). Examples that fix today's errors:
   - **Tool missing/unrunnable (E1):** (1) re-probe now, ignoring cache and the configured path (PATH name, `QPDF_PATH`, well-known locations, `where`/`which`); (2) retry with a long timeout (the 15 s probe is not proof); (3) copy the input to a fresh temp dir and retry (separates temp-file ENOENT from tool ENOENT); (4) **alternative normalizer in pure JS** (`pdf-lib` load with `ignoreEncryption`, save without object streams, then the same structural checks as the qpdf output: field count, page count, same field names) so import continues with no external tool; (5) only if all fail: hold with `TOOL_UNAVAILABLE`, preflight alert, auto-resume when the tool probe passes.
   - **Misreported checks (E2):** `checkError` carries the real stage and cause; a failed normalize never reads "USCIS unreachable"; unchanged forms skip the re-import (`hasNewEdition` fixed with a test first).
   - **404 page (E3): a source resolver that finds the real address and REMEMBERS it.** Ordered candidates, each verified by a 200 plus a PDF/page that names the form: (1) the address stored on the template or registry from the last success (`sourcePageUrl`, `officialPdfUrl`); (2) slug aliases derived from the code, including USCIS's supplement pattern (`I-485J` -> `i-485supj`, `I-485A` -> `i-485supa`, `I-918 SUPPLEMENT A` -> `i-918supa`, letter suffixes, with and without the dash); (3) the parent form's page, scanned for a link whose file name matches the form (`/i-539` -> `/forms/i-539a.pdf`); (4) the stable official PDF URL `https://www.uscis.gov/sites/default/files/document/forms/<slug>.pdf` for every alias, plus the `-instructions` variants; (5) the all-forms directory entry for the form name. The first candidate that verifies is **written back as the form's stored source** (the learned solution) so the next sync goes straight to it; if none verifies, hold `NO_OFFICIAL_SOURCE` listing every address tried. Seed the known aliases (I-485J, I-539A, I-485A, I-130A, I-864A, I-918 supplements) as data, not code, and replay the 25 real 404s as a test (I-485J and I-539A must resolve with the addresses above).
   - **Network (503/429/timeouts/TLS/reset):** backoff with jitter, then alternate host form (`www.` / apex), HTTP/1.1 retry, smaller request, then a cached copy if the checksum matches; escalates to a timed hold, never a dead-letter.
   - **HTML instead of PDF, junk before `%PDF-`, truncated download:** trim and re-validate, re-download once with a cache-busting header, resolve the PDF link again from the page, try the alternate PDF link on the page.
   - **qpdf exit 2/damaged, owner-password, corrupt xref:** `qpdf --qdf --recover` flags, `pdf-lib` re-save, re-download; empty-password decrypt first, otherwise blocked with reason.
   - **XFA-only / zero fields (`NORMALIZED_SCAN_EMPTY_FIELDS`):** try the AcroForm companion PDF on the page, the previous edition's field structure as a template, the `pdf-lib` field scan with `updateFieldAppearances:false`; otherwise a precise hold with auto re-check when the official file hash changes.
   - **16 MB template / BSON overflow:** shrink in order (drop duplicated structures, then externalize the largest to storage), verified by a round-trip read; D5.
   - **Scanner exception on one field:** isolate the field, continue, record it as an unmapped-needs-review item rather than failing the import.
   - **Certification check failed:** per-check repair already built (renormalize, rediscover components, cache clear) plus: re-run once with the alternative normalizer, remap via the 7.3 matcher, re-render probe with the font fallback.
   - **Promotion busy / lease lost / policy hold / migration failure:** wait-and-retry with a bounded budget; migration failures re-queue the failed case forms only (7.7).
3. **Alternative discovery (for an error with no catalog entry).** `resolution/Discovery`: a generic portfolio of safe alternatives per stage (re-fetch with a different resolver, alternate parser/normalizer, smaller unit of work, fresh process, longer timeout, isolate-and-skip) tried in order of past success for similar signatures. Each trial is verified against the stage's own checks, recorded, and **the first strategy that verifies becomes the stored solution for that signature** (`ErrorSolution` collection: signature, strategy id, success count, last used); next time that signature tries the stored solution FIRST.
4. **Nothing is ever just "dead".** After the portfolio is exhausted the job becomes a documented hold (7.0 contract) with the diagnosis, every attempt, and `releaseConditions`; it is re-run automatically when the resolver version changes (a new strategy ships), when the environment changes (tool appears, source changes) or after the escalation period raises it. Dead-letter keeps only for programming errors in our own code, and still carries its signature.
5. **Unknown signature feedback loop.** Every new signature raises ONE alert with its diagnosis and attempts; a developer (the owner or me) adds a catalog strategy for it, bumps `resolver` in `evaluatedWith`, and every held job with that signature re-runs by itself. The standard for "done" is: after each shadow/chaos run, zero signatures are without a stored solution or a documented hold.
6. **Environment self-healing.** Preflight (7.1) re-probes tools each tick; when qpdf becomes available the held `TOOL_UNAVAILABLE` jobs resume by themselves; the stale-process case (E1) is covered by re-probing at failure time.
7. **Replay of real history.** All 141 dead-letter and 400 mislabeled records are replayed against the engine in tests (their stored messages and stages) and must each end in a resolution or a documented hold.

Files (new): `form-pipeline/resolution/{Diagnoser,Resolver,Discovery,catalog/*}.js`, `models/ErrorSolution.js` (+ index script), hooks in `FormPipelineRunner` (replaces the single repair step), `utils/normalizePdf.js` (precise errors + fallback normalizer, same output contract), `utils/ensureQpdf.js` (re-probe, no install at runtime in production), `USCISScannerService.js` (`hasNewEdition`, real `checkError`), `OnDemandFormAcquisitionService.js` (source fallbacks, certify-on-resume), `FormCatalogSyncService.js` (import policy E6), governance overview (resolutions and signatures shown per job).

### B8. Last resort: the "forms stuck" e-mail to the developer
When a form is still not imported or not production ready AFTER diagnosis, every catalog strategy, alternative discovery and the retries have been exhausted, the system e-mails the developer. **New e-mail template `form-pipeline-stuck` and new trigger `form-pipeline-stuck`** (registered like the Phase 5 e-mails: template file, `emailPolicy.js`, `emailTriggers.registry.js`, `email.service.js`, notification type).
- **Recipient:** new env `DEVELOPER_EMAIL` (set in `.env` and `.env.example` to `ishaan@embtelsolutions.com`; comma list allowed). If unset it falls back to `FORM_PIPELINE_ALERT_EMAIL`, then to the same default address. No address is hard-coded in the logic.
- **When it is sent:** the moment a job enters the exhausted state (documented hold or dead-letter after the portfolio ran), and as a **daily reminder** (`FORM_PIPELINE_STUCK_REMINDER_HOURS`, default 24) while forms are still stuck. Never while a strategy is still pending or a timed retry is queued.
- **What it says (one e-mail lists all forms stuck at that time):** per form: code, edition (old -> new), the stage it is stuck at (fetch / normalize / import / map / certify / promote / migrate), the plain-language reason, the error signature, **every strategy that was tried and its result**, the hold's release conditions, how long it has been stuck, whether the previous edition is still serving, and the admin link. No secrets, tokens, client data or raw stack traces (same sanitizer as the other pipeline e-mails).
- **Dedupe/noise:** one e-mail per distinct stuck set; an unchanged set is not resent before the reminder time; a form that gets resolved is listed once as "resolved" in the next e-mail and then disappears. Switch `FORM_PIPELINE_EMAIL_STUCK` (default true).
- **Fallbacks:** no provider configured or send fails -> in-app notice to every admin; an e-mail failure never blocks or fails the pipeline.
- **Tests:** mocked provider only (no real send), recipient from `DEVELOPER_EMAIL`, content lists tried strategies, dedupe, reminder timing, resolved-then-gone, switch off, in-app fallback, no secrets. A real test send happens only with the owner's explicit go-ahead.

## C. Policy for brand-new forms (E6)
The 12-hour sync imports only forms that are in the registry, linked to a visa type, or on an owner-approved allow-list; other new USCIS forms are recorded as "discovered, not imported" and listed on the Operations screen. Switchable (`FORM_CATALOG_IMPORT_POLICY = registry | allowlist | all`); the owner picks (D11).

## D. Definition of done for "the subsystem works end to end" (measured, not claimed)
After 7.8, with the engine on in shadow then on:
1. The chaos suite injects every error class in section B (tool missing, 404, 503, HTML-for-PDF, truncated, encrypted, XFA-only, zero fields, oversize template, field exception, cert failure, lease loss, migration failure) on old/new edition fixtures: **each ends resolved or in a documented hold, none dead-lettered, none stuck without a recorded attempt.**
2. The replay of the real history (E1-E7) passes the same bar.
3. A new edition of each fixture form goes detect -> release -> case migration with loss rate 0 and corruption rate 0 (7.7), then autofills, edits, saves and downloads like today's forms (existing form tests plus an edition-switch test).
4. **Nothing stays stuck silently:** every form that remains un-imported or not production ready after all effort appears in the "forms stuck" e-mail to `DEVELOPER_EMAIL` with its reasons and the strategies tried (B8); a chaos test proves an exhausted job produces exactly one such e-mail and a daily reminder.
5. The shadow run on I-131, I-485 and I-129 on the real system reports its autonomy rate and every hold's reason. Anything below target is fixed by adding strategies, not by lowering the bar.
Honest limit stated once: a never-before-seen failure cannot be solved before it happens; the engine's job is that it is diagnosed, tried against generic alternatives, learned if solved, and otherwise held with evidence and auto-resumed when a solution ships.

## E. What needs YOUR effort (everything else is code)
1. **Restart the backend** after each release (the dead-letters came from a long-running process). Needed for any of this to take effect.
2. **Approve the deploy changes** (D6): pinned qpdf install, index scripts, worker app. Without it production can repeat E1.
3. **Approve one shared-database action:** re-queue the 141 dead-letter jobs (and clear the 400 wrong "unreachable" outcomes) once the engine is in, so history is reprocessed instead of left red. I do not touch them without your word.
4. **Decide D11 import policy** (all new USCIS forms, or registry/allow-list only) and **D3** (which visa types a brand-new form belongs to).
5. **Approve shadow runs and the performance baseline** on the shared database (D7), and a real PM2 worker kill test.
6. **Gemini quota/billing** and a **domain reviewer** for the golden set, if you want AI mapping to ever open its gate (not required for the rest).
7. **Approve the template-size restructure** (D5) if the I-129 template reaches the 16 MB limit.
8. Answer D1, D2, D4, D8, D9, D10 (recommendations in the table at the end).
8a. **Confirm `DEVELOPER_EMAIL=ishaan@embtelsolutions.com`** (I add it to `.env` and `.env.example`) and that a real test send may be made once (the only real e-mail, on your go-ahead).
9. **Source the I-485 older edition** (the stored "2026-04-09" file prints 2026-09-04) or accept redefining the test pair.

## Context
Phases 0-6 made the form pipeline durable, gated and safe, but six read-only audits (2026-10-22: slicing, mapping, case migration, fetch/import, approval/release, rendering) show it cannot take a never-seen USCIS edition from "published" to "cases use it" without a person, or without silent damage. The owner wants the whole chain (detect, fetch, normalise, import, map, slice components, certify, release, migrate open cases, render/file) to need no human in normal operation. Phase 7 builds that and keeps every legal-safety rule.

Root causes: (1) fields matched by name, not meaning; (2) gates check "valid", not "complete and correct"; (3) human-only steps and swallowed failures; (4) server setup assumed; (5) brittle detection/fetch; (6) hard-coded form knowledge; (7) case-migration data gaps; (8) weak render/filing checks. Verified in code: broken `\d` regexes in `USCISFormComponentDiscoveryService.js:241-242`; `summarizeResult` (`FormPipelineRunner.js:12`) ignores migration results; `fitChoiceValue` drops "Yes"/`true` for radios (tested in isolation; live effect still to be measured).

## Review of the seven requested changes (all accepted; two correct mistakes in rev 1)
| # | Change | Verdict | Effect on the plan |
|---|---|---|---|
| 1 | A hold must not be a dead end | Helpful. Rev 1 promised both "held and re-evaluated" and "nothing unresolved forever", which a machine cannot guarantee | New hold contract (7.0): reason, release conditions, automatic re-evaluation triggers, escalation after a period, never force-promote. "Autonomy contract" reworded |
| 2 | Stronger data conservation | Helpful, and it exposes a flaw: rev 1's "highest provenance wins, archive the rest" could keep the wrong address. Phase 3 is stricter (different values on one target = park that case), and rev 1 would have loosened it | 7.7 rewritten: conflicts are never settled by rank on value-bearing fields; every old value recoverable; before/after snapshot; reconciliation proof; idempotency; corruption tests. D2 replaced |
| 3 | Precise completeness definition | Helpful. A coverage percentage cannot say why a box is safe to leave blank | 7.4: per-field inventory with explicit classification and stated reason; no percentage gate. Caveat: new boxes with no predecessor cannot be mapped without a source, so a new edition that adds protected-role or conditionally-required boxes will hold. That is correct, but it lowers the autonomy rate; shadow runs measure it |
| 4 | Prove the final artifact | Helpful. Rev 1 only read values back. No rasterizer is installed (`pdfjs-dist` and `pdf-lib` exist, no canvas), so checks are geometric and structural, not pixel diffs | 7.6 splits data correctness from artifact correctness; an artifact failure blocks that filing artifact, not the whole edition |
| 5 | Separate, observable stage states | Helpful. `activated_with_gaps` conflated release and migration | Explicit stage ladder and five distinct availability levels (7.0, 7.6); migration is its own queued stage that can never hide behind a "released" status |
| 6 | No installs at start-up | Helpful, and rev 1 was wrong: it proposed `apt-get update` inside `utils/ensureQpdf.js`. Today that file already installs qpdf lazily at the first normalize (`QPDF_AUTO_INSTALL` defaults true, 10-minute install). Risk in the fix: production may rely on that runtime install, so turning it off before deploy provisions qpdf would break normalizing | 7.1: provision and pin qpdf in deploy, verify version in preflight, then flip the production default off. Sequenced behind D6. Index creation becomes an explicit deploy step |
| 7 | Stricter test acceptance | Helpful, with one limit: the 28 test files that connect to the shared database cannot be run under our standing rules | 7.8: fix failures in changed areas, evidence for the rest, full regression on the final revision, fixtures proven against official sources. The 28 shared-DB files need a decision (D9) |

## Autonomy contract (what "no human" means)
1. Every edition change ends **released** or **held with a recorded reason and release conditions**; the previous edition keeps serving. A hold never waits for a click, and is never force-promoted to clear a queue.
2. **Zero data loss and zero data corruption** (both tested): every saved answer is carried by a validated rule, converted by a validated rule, or archived and recoverable; none is silently altered.
3. **No silent failure**: every stage has its own status and reason, in the job outcome, the Operations screen and alerts.
4. Unchanged: USCIS refusal => not accepted; frozen cases never move; no guessing on legal fields; hot path untouched; tests never touch the shared DB; no case created.
5. Honest limit: not "zero errors"; an error never reaches a client silently, and autonomy rate and loss/corruption rate are measured.

Rollout switch: `FORM_PIPELINE_AUTONOMY = off | shadow | on` (default off); `shadow` records "would have done X" on the job without acting.

## Releases (order: 7.0 and 7.1-part-1 DONE -> **7.E** -> 7.2 -> 7.3 -> {7.4, 7.5, 7.7} -> 7.6 -> 7.8; the harness of 7.8 and the chaos/replay suites of section D are built alongside; 7.2's fetch and detection items use the 7.E strategies instead of fixed retries)

### 7.0 Hold contract and stage states (S) - foundation for everything below
- **Hold record** on the job: `{ reasonCode, detail, releaseConditions[], firstHeldAt, lastEvaluatedAt, evaluatedWith: { matcherVersion, gateVersion, certVersion } }`. Built on the existing states (`FormPipelineJobService` already re-checks held jobs every 12 h and blocked jobs every 24 h).
- **Automatic re-evaluation** when: a transient failure clears (existing backoff), new evidence appears (new edition checksum, new decision), or a relevant code/rule version changes (`evaluatedWith` differs from the running versions => requeue).
- **Escalation**: a hold older than a configurable period (default 7 days) raises one deduped alert and appears in a "persistent holds" review queue on the Operations screen, with the reason and what would release it. Escalation never changes the decision.
- **Stage ladder** (additive, on the template lifecycle and job outcome): `detected -> fetched -> imported -> mapped -> certified -> release_eligible -> released -> migration_pending -> migration_complete | migration_partial`, each with its own status and reason. Five separate answers, never one flag: edition in the registry / approved for new cases / eligible for existing cases / this case migrated / this filing artifact validated.
- Existing job states and `summarizeResult` statuses stay; the ladder is added beside them.

### 7.1 Stop silent damage (S)
- Fix `\d` regexes + hard-coded `I-` in `uscis-forms/services/USCISFormComponentDiscoveryService.js`.
- `summarizeResult` + `OnDemandFormAcquisitionService.js`: migration, components and ai_map results go into the outcome via the 7.0 ladder; failures logged warn, recorded, alerted, re-queued (stop swallowing at `OnDemand:358-361` and `VersionManagementService.js:145`). No `activated_with_gaps` flag; a released edition shows `migration_pending/partial` separately.
- New `startup/pipelinePreflight`: qpdf runs **and meets the pinned minimum version**, required indexes exist, worker mode and `schemaVersion`, evidence flag, an admin exists. Failure => overview shows it, alert, the pipeline worker refuses to claim jobs. Preflight only verifies; it installs nothing.
- **qpdf and indexes are provisioned by deploy, not by the API**: deploy workflow installs a pinned qpdf and runs the index scripts as an explicit step (own approval, D6). After provisioning is confirmed on the server, `QPDF_AUTO_INSTALL` defaults to false in production (`utils/ensureQpdf.js` keeps its dev/local behavior). Until D6, preflight runs in report-only mode and the runtime install stays as is, so nothing breaks.
- `FormCatalogSyncService.js`: failure memory (skip blocked/held/dead-letter or already-tried edition keys; drain until empty or a time budget).
- `OfficialFormDownloadService.js`: a filing-status download is refused unless the artifact passed validation; `FilingPackageService` / `PetitionAssemblyService` use the clean official render, never the watermarked copy. First read-only confirm the audit claim that packages embed `generatedPdfDocument`.
- `AutoFillService.generate()`: `caseFormId` option.

### 7.2 Detection, fetch, import hardening (M)
- `USCISScannerService.js` + `FormCatalogSyncService.js`: per-table-row parsing; one form-code pattern (covers I-9, I-864EZ); edition from page "Edition Date" then PDF footer (reuse `readPrintedEdition`); reject future dates; same date + new PDF = new revision; instructions PDFs excluded.
- Downloads through the existing hardened fetcher (`OfficialSourceFetcher.js`, `accept: pdf`): timeout, size cap, per-hop validation; trim junk before `%PDF-`; HTML body re-resolves once; `NORMALIZE_INPUT_NOT_PDF`, qpdf exit 2, password PDF => blocked with reason and conditions (`errorClassifier.js`).
- `hasNewEdition` (`USCISScannerService.js:326`): reproduce "always true" in a test first; fix only if confirmed.
- XFA-only: blocked with reason, auto re-check when the official file hash changes (no converter, D4).
- Template size (I-129 ~15.85 MB of 16 MB): read-only measurement; restructure only after approval (D5); pre-save size guard => clear blocked code.

### 7.3 Semantic field identity (L, foundation)
- `form-mapping/matching/FieldFingerprint` + `FieldMatcher`: stable name, label, section, page, type, option set, normalised geometry, group, ordinal; one-to-one claims; confidence + reasons. Additive `stableKey` (hash of stable name + group) in `PDFFieldScannerService.js`; **existing `fieldId`s are never changed** (that would orphan saved answers).
- Reuse/extend `EditionMigrationService.findRenamedTarget` and `fieldEquivalence.js` as the core. Used by `carryForwardGraph`, `PartyFieldMappingService` (rules get semantic anchors; page/index become hints) and `CaseFormMigrationRecovery`. `FieldDiffService`'s character-overlap rename stops deciding.
- Policy: high confidence automatic; medium only if contract validator + type/option compatibility pass; low => unmatched and listed. Matcher version is stamped into `evaluatedWith` (7.0).

### 7.4 Dynamic mapping + field-inventory gate (L)
- `carryForwardGraph`: new boxes become `unmappedTargets`.
- **Per-field inventory of the exact edition**, every field explicitly classified with a stored reason: `mapped`; `non_data` (office-use, signature, barcode, instruction); `deliberately_blank` (no source can be established; reuses the existing keep-blank feature, set by the system with the reason); `conditional` (with the condition); `unmapped_needs_source`. Roles considered: applicant, petitioner, beneficiary, employer, dependent. Radios, checkboxes, dropdowns, repeated and grouped controls are handled as groups. Removed, renamed and structurally changed fields are listed. Required supplements and separate supporting forms are inventoried too.
- **Gate (new `ReleaseGate` check `inventory`)**: hold if any applicable protected-role, required or conditionally-required field is `unmapped_needs_source` or of unknown applicability (a new field with no predecessor in a protected role); optional non-protected new boxes may be classified `deliberately_blank` with the reason shown. **No percentage score.** First 3 real editions run report-only, then enforce.
- Extend `FieldRuleInferenceService` to label + context; MappingPolicy ranks it `inferred`. Option/value re-derivation for radio/checkbox/dropdown from the new PDF; no clear match => unmapped. **Measure read-only how many live radio/dropdown values drop today before changing any rendering.** Gemini stays optional behind its existing gate.

### 7.5 Dynamic components (M)
- Registry-free discovery (headings, "Part N", page-number resets, outline, boilerplate runs); stable component code = heading slug + parent, carried across editions; old->new by heading similarity.
- Certification: every parent page is core, one component, or known boilerplate; an unclaimed run is a new-component candidate and is held, never absorbed; `resolveCorePages` excludes review-required ranges; `components_slice` non-vacuous on a first edition, with plausibility checks, and critical. Separate-PDF supplements are checked in the same job; `formTemplateFormCode` resolved automatically.

### 7.6 Autonomous release and artifact proof (L)
- `FormEditionComparisonService`: auto-acknowledge only added-only or high-confidence-carried diffs (machine acknowledgement keyed to a diff hash, actor `system:pipeline`, audited); otherwise try the 7.3 remap; otherwise hold with conditions.
- Certification stores mapping version + graph checksum; `ReleaseGate` rejects a mismatch; re-certify on mapping activation. Approval actor `system:pipeline` (replaces oldest-admin at `pipelineExecutor.js:336-348`).
- **Data correctness** (certification, on a probe render): every mapped box filled through the real `PDFRenderer.render` with realistic maximum-length values for every widget type; value read back against the post-transform value; choice values equal actual options of the new PDF; values land on the right party's field; required values not dropped; non-Latin probe handled per field.
- **Artifact correctness** (probe render at release, and the filing artifact at generation): text inside its box and not clipped (font metrics vs widget rectangle), widget overlaps, checkbox/radio appearance state present and equal to the chosen state, page count and order vs the previous edition, component boundaries, barcode and signature widgets, document integrity (reopens, no leftover XFA), and a clean official form (no watermark, not stale, not blank, checksum verified). Uses `pdfjs-dist` and `pdf-lib` already installed; **no pixel or visual diff** unless a rasterizer dependency is approved (D9).
- A data-correctness failure blocks release; an artifact failure blocks that filing artifact from being marked ready (7.0 level 5) and the edition release when it occurs on the probe render. `viewer_download` and `components_slice` become critical in `certPolicy.js`. Every new critical check is **calibrated read-only on all live forms first** (zero false failures), as in Phase 3.
- `VersionManagementService.activate` queues case migration as its own stage/job (release status never depends on it). Brand-new forms register with safe defaults (D3).

### 7.7 Autonomous case migration with data conservation (L)
- Carry via the 7.3 matcher; every carried value validated against the new box type/options and converted only by a **named, validated migration rule**; otherwise archived with the reason.
- **Collisions**: two different values for one target are never resolved by provenance rank on value-bearing fields (addresses, dates, names, party data). That case form stays on its old edition (which keeps working), is marked `parked` with reason and release conditions, and is re-evaluated automatically when the matcher/rules change (7.0). Only equal values, or a user-typed/verified value against an autofill/default value (validated rule), merge automatically. Both conflicting answers are always kept in `archivedAnswers`.
- **No overwrite** of typed, approved, verified or manually overridden values, and un-attributed non-blank values are treated as protected; migration autofill fills blanks only (the audit found autofill currently overwrites un-attributed typed values).
- **Conservation proof per case form**: stored checksummed before-and-after snapshot; explicit reason for every conversion, archive, collision and unmapped value; a reconciliation check that every old value has a documented destination or is recoverable in the archive; restore only when no newer edit exists (existing Phase 3 behavior).
- **Idempotency**: rerunning a migration neither duplicates, overwrites nor progressively alters answers (tested by running every scenario twice and comparing).
- Save/restore `status`, `reviewState`, `versionNumber`, `versions` around autofill; one shared protected-status set with `AutoFillService`; verify status. Remap comments, fieldHistory, sectionReviews, syncState; mark old generated PDFs stale.
- Scale and safety: cursor paging, bounded concurrency, per-case time budget, lease check, re-queue; skip forms already on a newer edition; compare-and-set on `updatedAt` in the `interactive-form-review.service.js` save path (conflict returned instead of overwrite, additive).
- `migration_partial` always lists every parked case, with escalation per 7.0.

### 7.8 Proof (M)
- **Fixtures** are not golden until verified: each old/new PDF pair records source URL, SHA-256 and the footer edition read by `readPrintedEdition`, checked against the official USCIS page and edition dates (real I-485, I-129, I-131 pairs from our stored files and official downloads). Mutants are labeled synthetic and generated with `pdf-lib`: rename, renumber, inserted page/supplement, removed field, radio option change, XFA-only, password PDF, HTML response, oversize, qpdf missing, fetch outage.
- Simulation harness on a throwaway local DB (`pipelineDb.js`) with synthetic cases; reports autonomy rate and the loss **and corruption** rate (both must be 0).
- Fault injection: worker kill mid-stage, lease expiry, repeated jobs, partial DB failure mid-migration, restart recovery, qpdf failure, run each scenario twice (idempotency).
- **Test acceptance (not the Phase 6 baseline)**: fix every existing failure in areas this phase changes (`PDFFidelityService` 7, `PDFRenderer`/AC tests 4, `normalizePdf` and qpdf 2, `FormMetadataService` 1, plus `i485J` provisioning check); classify the rest (disclaimer wording, route count, task creation, `updateQuestion`) with reproducible evidence (they fail identically at commit 33794ea) for your sign-off; full regression plus all four builds on the final combined revision; the fixed-local-database group (47 files) runs with `--include-local-db`; any remaining failure needs a written explanation before rollout. The 28 shared-database test files are handled per D9.
- With approval only: shadow runs on the shared DB, performance baseline and budget, real PM2 kill test. `FORM_PIPELINE_AUTONOMY` -> `on` family by family only after shadow comparison. Completion report appended to `docs/FORM_PIPELINE_IMPLEMENTATION_REPORT.md`.

## What still needs a person, by design
1. A brand-new form's business linkage (which visa/case types need it) unless a deterministic rule decides it (D3).
2. Persistent holds and parked cases the code cannot prove safe: held automatically, previous edition keeps serving, re-evaluated automatically, escalated to a short review queue after the period in 7.0.
3. Anything USCIS itself refuses stays blocked.
A wrong guess on a legal form is worse than a hold, so the code never guesses past what it can prove.

## Reusable pieces (do not rebuild)
`readPrintedEdition`, `OfficialSourceFetcher`, `EditionMigrationService.findRenamedTarget` / `fieldEquivalence.js`, `form-mapping/contract/keepBlank.js`, `form-mapping/config/caseFormFreeze.isFrozen`, `MappingPolicy`, `MappingContractValidator`, `ReleaseGate`, `certPolicy`, `CaseFormMigrationSnapshot`, `FormPipelineJobService` (hold/blocked re-check, `shadow` flag), `PDFFidelityService`, `FieldValueFitter`, `scripts/runSafeTests.js`, `test-utils/pipelineDb.js`, `scripts/perf/*`, the signed golden set.

## Decisions needed (recommendation first)
| # | Question | Recommend |
|---|---|---|
| D1 | Completeness gate | Per-field inventory with stated reasons, no percentage; hold on unmapped protected/required/conditional/unknown-applicability fields; first 3 real editions report-only |
| D2 | Collision policy | Park the case on its old edition; keep both answers; auto-merge only equal values or typed-over-autofill by validated rule |
| D3 | Brand-new form attached to visa types | Only by deterministic rules |
| D4 | XFA-only PDFs | Blocked + auto re-check, no converter |
| D5 | Template size restructure | Measure first, restructure only after approval |
| D6 | Deploy changes: pinned qpdf install, index scripts as explicit steps, separate worker app; then production `QPDF_AUTO_INSTALL=false` | Yes, own approval, before turning the autonomy switch `on` |
| D7 | Shadow runs + performance baseline on the shared DB | I-131, I-485, I-129 |
| D8 | Remove the 13 old test records found in Phase 6 | Yes, dry run first |
| D9 | The 28 shared-DB test files, and a rasterizer for visual diffs | Port the useful ones to the throwaway local DB; add a rasterizer only if geometric checks prove insufficient |
| D10 | Escalation period for persistent holds | 7 days |
| D11 | Which new USCIS forms the 12-hour sync imports | Registry + owner allow-list; the rest "discovered, not imported" |
| D12 | Re-queue the 141 dead-letter jobs and clear the 400 wrong outcomes (shared-DB write on pipeline job records only) after 7.E | Yes, dry run first |

## Safety rules for every release
Behind `FORM_PIPELINE_AUTONOMY`; additive and fail-safe; hot path untouched; no case/user/company created; tests only via `npm run test:safe` or throwaway local DBs; real-DB writes limited to index scripts and what the pipeline writes on a real new edition; deploy changes and shadow runs need their own approval; each release ends with a completion report and the four app builds.

## Verification
Per release: tests that fail before and pass after for each root cause; `npm run test:safe` compared with the Phase 6 run (only the explained failures, shrinking as 7.8 fixes them); four app builds; from 7.3 on, harness metrics (precision vs the golden set with zero critical role violations; loss and corruption rate 0; idempotent reruns; autonomy rate reported). Final: shadow-run comparison and performance baseline after D7.

## On approval, first actions
Replace the earlier draft `docs/FORM_PIPELINE_PHASE7_PLAN.md` with this plan (one version only), add the status row to `docs/FORM_PIPELINE_RELIABILITY_PLAN.md`, then build 7.0 and 7.1 and the 7.8 fixture manifest.
