# Phase 7 - Fully autonomous editions (APPROVED 2026-10-22, rev 2)

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

## Releases (order: 7.0 -> 7.1 -> 7.2 -> 7.3 -> {7.4, 7.5, 7.7} -> 7.6 -> 7.8; the harness of 7.8 is built alongside 7.1-7.3)

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

## Safety rules for every release
Behind `FORM_PIPELINE_AUTONOMY`; additive and fail-safe; hot path untouched; no case/user/company created; tests only via `npm run test:safe` or throwaway local DBs; real-DB writes limited to index scripts and what the pipeline writes on a real new edition; deploy changes and shadow runs need their own approval; each release ends with a completion report and the four app builds.

## Verification
Per release: tests that fail before and pass after for each root cause; `npm run test:safe` compared with the Phase 6 run (only the explained failures, shrinking as 7.8 fixes them); four app builds; from 7.3 on, harness metrics (precision vs the golden set with zero critical role violations; loss and corruption rate 0; idempotent reruns; autonomy rate reported). Final: shadow-run comparison and performance baseline after D7.

## On approval, first actions
Replace the earlier draft `docs/FORM_PIPELINE_PHASE7_PLAN.md` with this plan (one version only), add the status row to `docs/FORM_PIPELINE_RELIABILITY_PLAN.md`, then build 7.0 and 7.1 and the 7.8 fixture manifest.
