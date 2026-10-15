# Form Pipeline Reliability - Implementation Report (living document)

This is the ONE document that records the implementation of the approved plan in [FORM_PIPELINE_RELIABILITY_PLAN.md](FORM_PIPELINE_RELIABILITY_PLAN.md) (rev 9). Every phase appends its own section here instead of creating a separate report. Each section follows the same shape: **scope and authorization, what was built, how safety was kept, results, expected vs actual, findings for review, what was not done, and the next gate.** The plan asks for a completion report plus regression results before the next phase may start (Rule I); this document is that report for every phase.

**Rules that apply to every phase (from the plan):** nothing here may break or slow a current feature; each phase is approved on its own; database writes, deploys, the PM2 worker, migrations, load tests on the shared database and real emails each need their own approval; USCIS acceptance decisions are never invented.

## Phase status

| Phase | Status | Approval needed to start |
|---|---|---|
| **Release 0a** - read-only pre-rollout report + redirect-chain crawl | **DONE 2026-10-16 - awaiting your review** | given 2026-10-16 |
| **Release 0b-1** - evidence-resolution path, no enforcement | **DONE 2026-10-16 - awaiting your review** | given 2026-10-16 |
| Release 0b-2 - fail-closed gate wired into every entry point | Not started | separate approval after your 0b-1 review, the unrun index script and the database walkthrough |
| Phase 0 remainder (frozen-status module, cache fix, job locks, ...) | Not started | per the plan's sequence |
| Phases 1 - 6 | Not started | each separately |

---

# Release 0a - read-only pre-rollout report and redirect-chain crawl

## 1. Scope and authorization
You told me to implement the plan, starting with Release 0a. The plan limits that instruction to exactly this: (1) a read-only pre-rollout report script, (2) a read-only redirect-chain crawl script, (3) tests with injected/mocked dependencies. Both scripts live under `Backend/src/scripts/`, only READ the database, send GET requests only to `uscis.gov`, and write nothing to the database or to application data. **Nothing else from the plan was started.** No application file was changed (0 tracked files modified; 6 new files).

## 2. What was built

| File | Purpose |
|---|---|
| `Backend/src/scripts/formEditionPolicyRolloutReport.js` | The pre-rollout report. For every tracked form it simulates what the edition-acceptance gate WOULD do, counts case forms per form / edition / status, ranks forms by open work, and lists data anomalies. |
| `Backend/src/scripts/formSourceRedirectCrawl.js` | The redirect-chain crawl (plan Rule H). Follows each tracked form page / PDF URL's redirect chain by hand and reports every hop. |
| `Backend/src/scripts/lib/readOnlyDb.js` | A database handle that can only read. Both scripts use it, so "writes nothing" is enforced at run time, not just promised. |
| `Backend/src/scripts/tests/formEditionPolicyRolloutReport.test.js` | 23 tests |
| `Backend/src/scripts/tests/formSourceRedirectCrawl.test.js` | 18 tests |
| `Backend/src/scripts/tests/readOnlyDb.test.js` | 9 tests (read-only handle + static "no write anywhere" guard on both scripts) |

**How to run (from `Backend/`):**
```
node src/scripts/formEditionPolicyRolloutReport.js            # readable report (add --json for JSON, --out <file> to also save it)
node src/scripts/formSourceRedirectCrawl.js                    # crawl every tracked url (2 at a time, 250 ms apart); --url <one url> for a single check
node --test "src/scripts/tests/*.test.js"                      # the 50 tests (no database, no network)
```

## 3. How safety was kept
- **Read-only at run time.** The database handle the scripts receive exposes only `find`, `findOne`, `aggregate`, `countDocuments`, `estimatedDocumentCount` and `distinct`. Every other collection or database operation (insert, update, delete, drop, create index, bulk write, command, ...) throws before reaching the driver, and an aggregation containing `$out` or `$merge` is refused. The connection is opened with `autoIndex: false, autoCreate: false`.
- **Static guard.** A test fails if either script's code ever contains a database write token, and the only file write allowed is the explicit `--out` option, inside one function.
- **Light reads.** The templates are read with a projection (about 40 small fields); the heavy fields (`formFields`, `definition`, `mappingGraph`, ... up to ~16 MB on I-129) are never loaded. A test enforces that.
- **Crawl safety (Rule H applied to the crawler itself).** `redirect: "manual"`; every hop is validated BEFORE it is requested (https only, host `uscis.gov` or `*.uscis.gov`, no credentials in the URL, no IP literal, default port only, no loop, at most 5 hops); no cookies or credentials; the response body is never read (cancelled as soon as headers arrive); 15 s timeout per request; low concurrency.
- **Zero runtime effect.** Nothing in the application imports these files. They run only when someone runs them.

## 4. Interpretations I made (tell me if any is wrong)
1. **"Tracked form"** = every form code with a template in the database (52). The form registry is also compared (forms the registry tracks but with no template are listed).
2. **"Open" case form** = status not `finalized` / `filed` / `archived`. **"Frozen"** = Rule G's eight-status union (`finalized, filed, approved, generated, ready_for_pdf, locked, receipt_received, archived`) or `isLocked`. **"Rule J watch"** = `approved`, `under_review`, `ready_for_pdf` (the statuses next to the filing-ready steps). The plan's wording ("open ... esp. approved / under_review / ready_for_pdf") overlaps with Rule G, so the report shows all three counts separately instead of picking one.
3. **Gate simulation.** The gate does not exist yet. The report applies the plan's conservative rules to stored data: no policy exists for any form (so every form "needs initial evidence" and every pending edition would be held), live editions are grandfathered (serve-only, not filing-eligible). Extra reasons come only from stored data: `edition_date_untrusted` (date source `version_backfill`), `edition_date_conflict` (page date differs from stored date), `version_edition_mismatch`.
4. **Not assessable read-only** (reported, never guessed): `stale`, `notice_detected`, `unverifiable`. They need an outbound evidence fetch, which is Release 0b.
5. **Crawl URLs** = every distinct URL stored on templates (form page, form PDF, official PDF, instructions PDF). It does not discover new pages; and it validates headers only (it does not read page or PDF content).
6. **Documentation shape.** The plan names `PHASE_N_COMPLETION_REPORT.md`; you asked for one continuing document, so this file replaces those per-phase files.

## 5. Verification and regression

| Check | Result |
|---|---|
| New tests (no database, no network) | **50 / 50 pass** (0 database connections opened during the run) |
| Four app builds (Admin, Client, Landing, Attorney) | **4 / 4 build** |
| Tracked files modified | **0** (6 new files only) |
| Backend health during and after | OK throughout |
| Scripts run against the live data | Report 4.4 s, crawl about 14 s, both exit 0 |
| Collections the report reads, modified during the run | `caseforms`, `visaformmappings`, `uscismappingversions`: 0 modified. `uscisformtemplates`: `lastChecked` stamps written by the backend's own scanner (3 after my first script started: I-130, I-131, I-134) - see 6.3 |
| Entry-point matrix, performance budget | Not applicable to 0a (no entry point or hot path changed) |

## 6. Results of the real run (2026-10-15 19:54-19:56 UTC)

### 6.1 Pre-rollout report
- **52 forms tracked, 58 editions stored, 30 live editions (all grandfathered).** All 52 forms "need initial evidence" - no policy record exists for any form, as the plan predicted.
- **23 editions await promotion across 21 forms** (20 in `review`, 3 in `draft`); every one would be HELD (`no_policy`). Of them: certification passed 7, failed 4, none 12; mapping `active` 5, `biographic_active` 13, `needs_review` 5. **None is newer than a live edition** (only one form, G-28, has both a live and a pending edition, and the pending one is older).
- **22 forms have no live edition at all** (only imported, un-promoted editions). Five of them are fully ready on paper (certification passed and mapping active) and would stay held: G-1041, G-1041A, G-1256, G-1566, G-28I.
- **Case forms: 46 total, all 46 open, 0 frozen, 0 next to the filing-ready steps.** By status: `ai_filled` 42, `pending` 4. By form: I-129 39, I-907 3, G-28 2, I-539 2.
- **Edition-date trust.** Of 58 editions, 53 have no recorded date source, 3 are `version_backfill` (G-28, I-131, I-589 - all LIVE), 2 are `uscis_page`.
- **`version` does not equal the edition date on 16 live editions** (I-129S, I-140, I-360, I-526, I-526E, I-612, I-751, I-765, I-824, I-829, I-864, I-864EZ, I-90, N-400, N-565, N-600). The pattern is clear: for these, `version` is the import / activation date (2026-09-xx), not the form edition.
- **Certification on record:** only 5 of 30 live editions have a passing certification; 25 have none.
- **Rescue candidates (retired editions the existing half-way rescue could re-activate with no gate):** I-129 (2026-02-27), I-131 (2025-01-20), I-485 (2026-04-09), I-485 SUPPLEMENT A and J (2026-09-30) - all five uncertified.
- **Other anomalies:** I-485 SUPPLEMENT A and J are `retired` but `currentStatus: review` (2 status mismatches). Registry forms with no installed template: 0.

### 6.2 Redirect-chain crawl
- **61 distinct tracked URLs** (13 form pages, 41 form PDFs, 7 instructions PDFs), all on `www.uscis.gov`.
- **61 / 61 answered 200 directly. Zero redirects. Zero violations. No chain leaves uscis.gov, drops to http or loops.** Content types: 48 `application/pdf`, 13 `text/html`. Request time min 28 ms, median 280 ms, max 965 ms.
- **Verdict: hardening the existing import fetchers (per-hop validation) will not break any tracked URL.**

### 6.3 One thing to know about the "modified during the run" check
The `uscisformtemplates` collection showed documents with a newer `updatedAt` around my run: 10 forms stamped between 19:41 and 19:56 UTC (G-1055, G-325A, I-129, G-28, I-589, I-129F, I-129S, I-130, I-131, I-134), 3 of them (I-130, I-131, I-134) after my first script started. They were written by your backend's own scheduled USCIS scanner, not by my scripts: each change is a `lastChecked` stamp on a different form, spaced about a minute apart in the scanner's order, and the stamping continued after my scripts had finished. My scripts cannot write (the handle refuses it, and tests prove it). I also noticed that adding files under `Backend/src/` makes the dev server (nodemon) restart, which re-arms its scheduled USCIS jobs; this is how existing behavior works and is harmless, but it explains why the scanner was active during the run.

## 7. Expected vs actual

| Item | Expected (from the plan) | Actual |
|---|---|---|
| Report writes nothing | No database or application writes | Confirmed by design (read-only handle + static guard + tests); runtime check: 0 modifications in the caseforms / registry / mapping-version collections; template stamps explained in 6.3 |
| Every form needs initial evidence | All forms | 52 of 52 |
| Pending editions would be held | Held with a reason | 23 of 23 held (`no_policy`) |
| Live I-131 anomaly flagged | `version_backfill` date; official page edition 01/20/25 differs; retired 2025-01-20 edition has a different checksum | `version_backfill` flagged; retired edition shown as uncertified rescue candidate. **Page-date disagreement could not be measured**: the page date is stored on 0 editions. Checksum difference is not part of this report. |
| Forms with `version` vs `editionDate` mismatch | "I-765, I-864" | **16 live editions**, including those two |
| Untrusted (`version_backfill`) dates | "the live I-131" | **3 live editions**: G-28, I-131, I-589 |
| Forms with a pending newer edition | Identify them | 21 forms have pending editions; 0 are newer than a live edition (G-28's live date is itself a backfilled import date, so even that comparison is weak) |
| Open case forms by edition and status | Quantify to prioritise evidence | 46 case forms, all open, none next to the filing-ready steps |
| Rescue editions that could be re-activated | List them | 5 forms, all uncertified |
| Redirect crawl | "No chain leaves uscis.gov" (the plan's earlier spot check: I-131 / I-485 pages 200, apex redirects once to www) | 61 / 61 direct 200, 0 redirects, 0 violations |
| Tests DB-free | Injected / mocked only | 50 / 50, no database connection opened |
| Four app builds | Green | 4 / 4 |

## 8. Problems found and fixed during the work
- **Registry comparison was case-sensitive** (the registry stores `i-129` while templates use `I-129`), which made the first run report 28 registry forms "not installed". Fixed by comparing upper-cased codes, with a regression test; the real figure is 0.
- **Open case forms of a form whose template is missing were invisible** in the per-form list. They are now included in the priority list (marked "template missing") and as an anomaly.
- Two of my own test expectations were wrong at first (a count and a regex); corrected, and no product code was weakened to make a test pass.

## 9. Findings for your review (these shape Release 0b)
1. **Enforcing Rule J later would block nothing today.** No case form is in `approved`, `ready_for_pdf`, `locked`, `generated`, `finalized` or `filed`. The disruption the plan worried about does not exist in current data; it can change as cases progress.
2. **25 of 30 live editions have no certification on record.** Under Rule I(b) ("no certification on record = held"), re-activating or promoting any of them would first need certify-on-demand. Serving them is unaffected.
3. **`version` is unreliable as an edition identifier** (16 live forms use an import date). The policy keys in 0b-1 must use the verified edition date with its source, as Rule D already says.
4. **Three live editions have a backfilled date** (G-28, I-131, I-589), more than the plan's single I-131. Per decision 12 I did not touch any of them.
5. **22 forms are tracked but not live.** Five (G-1041, G-1041A, G-1256, G-1566, G-28I) already have a passing certification and an active mapping and would sit in `review` until evidence exists. This matches the plan's stated effect: no promotion for any form until its evidence exists.
6. **The page-date check is inert on stored data**: `publishedEditionDate` is recorded on no edition, so "page disagrees with stored date" can only be measured by the Release 0b evidence fetch.
7. **Five retired editions could be silently re-activated by the existing rescue step** (I-129, I-131, I-485, I-485 SUPPLEMENT A and J). This is the exposure Release 0b-2 closes.

## 10. What was NOT done
Everything outside 0a: the edition-policy and evidence models, the redirect-safe fetcher used by the app, the gate and its entry points, the Admin screen, the frozen-status module, cache and lock fixes, the worker, Gemini mapping, emails and migrations. No database write, no deploy, no real email, no change to any current feature, workflow or file.

## 11. Gate before the next phase
Per the plan, Release 0b may start only after you have reviewed this report (including the live I-131 anomaly and the grandfather list in the appendix) and approved it separately. Release 0b-1 would then add the evidence-resolution path WITHOUT enforcement. Decisions I need from you at that point: (a) confirm the grandfather list (appendix A) matches what you expect to be live; (b) whether to centralize the frozen-status constant now or in the Phase 0 remainder; (c) the order evidence is submitted in (nothing is blocking today, see finding 1).

---

# Release 0b-1 - evidence-resolution path (no enforcement)

## 1. Scope and authorization
You told me to continue with 0b-1 on 2026-10-16. The plan defines 0b-1 as the evidence-resolution path **without wiring the gate into any activation path**: the decision / source models, the redirect-safe fetcher, verbatim-quote verification, explicit reviewer confirmation, immutable audit, the `admin` / `team_lead` API, and a minimal Admin screen. **Nothing is enforced. No existing feature, workflow or file behavior changed.** Release 0b-2 (the fail-closed gate at every entry point) is not started and needs its own approval.

## 2. What was built

**Backend (`Backend/src/`)**

| File | Purpose |
|---|---|
| `models/FormEditionDecision.js` | One row per `{formCode, editionIdentifier}` (unique index): decision, status, effective / rejection / grace dates, evidence references, decider, review-by date, version. No `acceptedEditionDates[]`. |
| `models/FormEditionSource.js` | IMMUTABLE evidence snapshots: URLs, redirect chain, status, fetch time, sha256 of the extracted text, the text itself. |
| `models/FormEditionAuditEvent.js` | PERMANENT append-only audit trail (no TTL), the plan's six event types linked by `evidenceCaseId`. |
| `models/helpers/appendOnly.js` | Refuses every update, delete and non-insert bulk write on the two append-only models. |
| `modules/form-edition-policy/officialUrl.js` | The ONE URL validator (https, uscis.gov / *.uscis.gov, no credentials, no IP, default port). The Release 0a crawl now imports it instead of keeping its own copy. |
| `modules/form-edition-policy/OfficialSourceFetcher.js` | Rule H fetcher: manual redirects, every hop checked BEFORE it is requested, loop and hop limits, timeout, size cap while reading, content-type allow-list, no cookies. |
| `modules/form-edition-policy/htmlText.js` | Stable HTML to text extraction (the text is hashed as evidence). |
| `modules/form-edition-policy/EvidenceVerifier.js` | Eight checks (see 4), outcome `verified` / `conflicting` / `unverifiable`. |
| `modules/form-edition-policy/EditionPolicyGate.js` | `check(formCode, editionIdentifier)` -> `{allowed, decision, status, reasons}`; fail closed; looked up by the exact edition. **Wired into nothing.** |
| `modules/form-edition-policy/EvidenceService.js` | submit evidence, record decision, read a case, list editions. Roles, confirmation, four-eyes, audit. |
| `modules/form-edition-policy/EditionPolicyStore.js` | The Mongoose persistence behind the service (light projections only). |
| `modules/form-edition-policy/form-edition-policy.{routes,controller}.js` | The API, mounted at `/api/form-edition-policy` (one line added to `routes/index.js`). |
| `scripts/createFormEditionPolicyIndexes.js` | Creates the unique indexes. **Dry-run by default; NOT run** (a database change needs your approval). |

**Admin (`Admin/frontend/src/`)** - `components/FormEditionEvidenceSection.jsx` (a section of the Form Governance page), `services/api.js` (`formEditionPolicyApi`), and two small additions to `pages/FormGovernance.jsx` (a "Show Edition Evidence" button and the section, both only for admin / team_lead).

**Tests** - 75 backend tests in `modules/form-edition-policy/tests/` and 8 Admin tests; none touches a database or the network.

## 3. How safety was kept
- **No enforcement, no behavior change.** Three tests fail if anything outside the new module (and the routes file, models and the 0a crawl) imports the gate or the service, or if any form-pipeline file (import, lifecycle, registry, mapping, generation, forms) mentions the module.
- **Exactly `admin` and `team_lead`.** The route guard is the exact-match `authorizeRoles`; `authorizePermissions` is not used (it would admit super_admin and wildcard holders). The service re-checks the role on every call, the Admin section checks it again and Form Governance renders it only for those two roles. Tests cover admin and team_lead allowed and super_admin, case_manager, attorney, paralegal, finance, hr, client, reviewer, employer, professor, other-case and empty roles refused, both in the guard and over real HTTP.
- **A typed claim never decides anything.** The system fetches the page itself; the quote must appear word for word (whitespace collapsed only) in the system's own snapshot; the edition must be named in it; the template, the page edition and the official PDF must agree; claimed dates must appear in the quote.
- **Explicit confirmation required.** No decision is written without a confirmation naming the same decision, form and edition. A matching quote proves only that the text exists on the official page; the conclusion is the reviewer's.
- **Four-eyes.** An `accepted` decision needs verified evidence AND a decider different from the submitter. `held` and `not_accepted` (which only restrict) may be recorded by one person; `not_accepted` additionally needs a quote the system found that names the edition.
- **`not_accepted` is final for these roles:** an explicitly not-accepted edition can never be marked accepted by an admin or team lead.
- **Fail closed.** The gate returns held for a missing record, an error, a bad input or a throwing store; it never throws and never allows by default.
- **Immutable audit.** Five of the six events are written (`OUTCOME_RECORDED` belongs to entry points that do not exist until 0b-2); each is also copied best-effort to the existing `AuditLog` (2-year TTL), which never blocks the permanent record.
- **Database impact.** The three new collections do not exist yet and nothing was written. The application runs with indexes off, so the unique indexes need the (unrun) index script; until then the service serializes writes per edition, re-reads inside the lock and checks versions on update.

## 4. Verification

| Check | Result |
|---|---|
| Release 0b-1 backend tests | **75 / 75** (fetcher 11, verifier + gate 20, service 24, routes and wiring 9, models 6, end-to-end readiness 5) |
| Release 0a tests after the crawl refactor | **50 / 50** |
| Admin tests | **127 / 127** (119 existing + 8 new) |
| Existing backend regression (79 tests: form review, invites, checklist gate, emails, GHL) | **79 / 79** |
| Four app builds | **4 / 4** |
| Live backend | healthy; new endpoints answer 401 without a login; an existing endpoint unchanged |
| Database connections opened by the tests | **0** |

**The eight verifier checks:** source is an https uscis.gov address (every hop), source fetched within 24 h, quote verbatim in the snapshot, edition named in the snapshot, quote itself names the edition (advisory only), template edition date matches (and is not `version_backfill`, and matches a recorded page edition), official PDF sha256 equals the imported PDF's, claimed dates appear in the quote.

**Readiness gate (DB-free, through the real HTTP handlers):** submit -> verification results -> explicit confirmation -> decision persisted -> gate re-run and returned, by a different reviewer; the submitter is refused; no confirmation is refused; every ambiguous case (quote not on the page, page not fetchable, backfilled template date, PDF mismatch, no template, dates not in the quote) stays held and cannot be accepted; `not_accepted` cannot be reversed; every other role gets 403.

**Live read-only dry run against real data** (real uscis.gov page and PDF, real template, in-memory store, nothing written): G-1055 edition 2026-10-07, quote taken from the real page - all eight checks passed, a second reviewer's acceptance flipped the gate to "would allow", five audit events in order.

## 5. Expected vs actual

| Item | Expected (plan) | Actual |
|---|---|---|
| Behavior of existing features | Unchanged | Unchanged: 0 existing source files changed except the 0a crawl's validator import, one route line and Form Governance (button + section) |
| Evidence path usable on day one | Resolves every supported hold end to end | Proven DB-free end to end and by a live dry run; **real use also needs the unrun indexes script, a database walkthrough on a test record (your approval) and the screen's first run** |
| Role restriction | Exactly admin and team_lead | Enforced in the route, the service and the screen; super_admin refused |
| Gate wired into nothing | Yes | Yes, enforced by tests |
| PDF checksum check | Re-downloaded official PDF equals imported PDF | **First attempt failed against live data (0 of 45).** Cause: the template holds two checksums and I compared the wrong one (the normalized stored copy's). Fixed to the raw-download checksum with a test; **41 of 45 now match** |
| Where the screen lives | "A minimal Admin screen" | You asked why it was a separate page; moved into **Form Governance** as a section (no new route or menu item) |
| Editions that can take evidence | All tracked editions | **34 of 58.** 24 have no edition date on file (see 7) |

## 6. Problems found and fixed during the work
- **Wrong checksum compared (found only by checking live data).** `artifacts.form.checksum` is the sha256 of the qpdf-normalized copy the app stores (1.46 MB for I-90), while `importMetadata.checksum` / `lifecycle.sourceChecksum` are the sha256 of the raw download (508 KB) and equal today's re-download. With the wrong field every submission would have been "conflicting" and the screen unusable. Fixed, with a test using the live shape (the two checksums differ).
- **Two concurrent decisions could both pass the "already decided" check.** The case is now re-read inside the per-edition lock.
- **Duplicate URL validator removed.** The 0a crawl now imports the shared one (its 50 tests still pass).
- **Screen location** changed after your question (see section 5).
- Several of my own test expectations were wrong at first (an IP literal correctly trips two rules; Mongoose adds its own update hooks for timestamps); corrected without weakening any product behavior.

## 7. Findings for your review
1. **24 of 58 editions have no edition date** (20 in `review`: AR-11 x2, G-1041, G-1041A, G-1055, G-1145, G-1256, G-1450, G-1566, G-1650, G-1651, G-28, G-28I, I-130A, I-485A, I-864A, I-918 and its two supplements, I-956F; 2 in `draft`: I-918SUPA / SUPB; 2 `retired`: I-485 supplements A and J). The evidence path needs the edition date to bind a decision to an edition, so **these cannot take evidence yet** - they are precisely the imported-but-unpromoted forms. Setting a date from a verified source (PDF or page) is a decision for you; I did not invent one.
2. **3 live editions have a backfilled date** (G-28, I-131, I-589): evidence for them would come back "conflicting" until the date is corrected.
3. **4 official PDFs differ from what was imported** (G-1055 review, I-485A review, and the retired I-485 supplements A and J): these would correctly come back "conflicting" (held). I first guessed they were sliced copies; the slicing check (section 9) showed that is wrong: the I-485 supplements have their own PDFs and USCIS has re-published all four files since they were imported (G-1055's official file is now 60 pages / 66 fields versus the 58 / 64 imported, matching the 2026-10-07 edition; the I-485 files changed bytes and need qpdf normalization to be read, as usual for these PDFs).
4. **USCIS pages rarely say "accepted".** The live dry run's quote was "we published a new edition of Form G-1055". It verified, but whether that means "accepted for filing" is a human judgment - which is why the confirmation step exists. Until real notice fixtures exist (Phase 2) nearly every acceptance is a human decision, as the plan predicted.
5. **Four-eyes needs two eligible reviewers.** With one admin or team lead nobody can record an `accepted` decision; holds and not-accepted still work.
6. **Assumptions I made (please confirm or change):** snapshot freshness window 24 h; a decision's review-by date 90 days after it is recorded; sources must be HTML pages on uscis.gov (PDF or other content stays held); the quote must be 25-2000 characters; one decision per evidence case (new evidence to change it); effective / rejection / grace dates come only from the verified claim, never from the decision request.

## 8. What was NOT done
Wiring the gate into any entry point (0b-2); the `grandfathered` rows for the 30 live editions (a database write; belongs with 0b-2 and needs your confirmation of the list in Release 0a's Appendix A); creating the indexes (script written, not run); DB-backed tests and the walkthrough on a test record (separate approval); machine auto-acceptance (stays off by plan); certify-on-demand; the scheduled refresh and notice scanner (Phase 2); the fresh official re-fetch just before promotion (it belongs to the entry points).

## 9. Slicing check (you asked for it)
How slicing works: a "component" (for example I-129's H classification supplement) is a page range inside ONE parent PDF, defined per parent template edition (`USCISFormComponentDefinition`). At render time the page resolver keeps only those pages and **throws if there is no ACTIVE definition for the exact edition a case form uses (it never falls back to the full form)**. A new edition therefore needs its components discovered again before it goes live (the certification's `components_slice` check and the readiness check cover that). Checked read-only against the real data:

| Check | Result |
|---|---|
| Component definitions | 19, **all ACTIVE, all I-129** (10 on the retired 2026-02-27 edition, 9 on the live 2026-09-09 edition) |
| Live I-129 (2026-09-09): fields vs pages | 980 fields = **218 on the core form + 762 across 9 components**; for every component: 0 fields missing from the template, 0 outside its pages, 0 on its pages but not owned; **0 fields owned by two components** |
| Live vs previous edition | the same 9 page ranges (9-10, 11-12, 13-20, 21-23, 24-27, 28-30, 31, 32-36, 37-38) |
| Page ranges | all valid and inside the parent's 38 pages |
| Certification's slicing check | **16 of 16 certified templates passed `components_slice`** (the only failed certification checks, 4 each of `mapping_valid`, `fill_roundtrip`, `viewer_download`, are on not-yet-live review / draft forms, not slicing) |
| Case forms that are components | **0 exist today**, so none can fail to slice right now |
| Overlap | the retired 2026-02-27 edition has two ACTIVE definitions on the same pages (`I129_E_1_E_2_CLASSIFICATION_S` and `I129_E_CLASSIFICATION_SUPPLEM`, both pages 9-10, 79 fields); the live edition has only the second, so nothing live is affected |
| I-485 supplements A / J, I-485A, I-918 supplements, I-539A | **not sliced components**: they are standalone templates with their own PDFs (no component definitions exist for them) |

What this means for the evidence path: evidence is recorded per FORM edition (for example I-129), so it covers that form's components automatically; no slicing code was touched. Two things to keep in mind: (a) because a missing definition is a hard failure, promoting a new I-129 edition without re-discovering its components would break component case forms, which is exactly the kind of check Release 0b-2's certification requirement must keep; (b) nothing exercises slicing in the current data (0 component case forms), so a live render test of a real component form is still worth doing when you next create an H-1B case.

## 10. Gate before the next release
The plan requires, before Release 0b-2: (1) the end-to-end readiness proof - done DB-free; the walkthrough on a test record needs your approval for database writes (and the index script run first); (2) your review of this report; (3) confirmation of the grandfather list and of the assumptions in 7.6; (4) a decision on finding 7.1 (the 24 editions without a date). Release 0b-2 then needs its own approval.


---

## Appendix A - Per-form results (generated from the run)

Case forms count all statuses; "open" = not finalized / filed / archived. Every row "needs initial evidence".

| Form | Live edition (grandfathered) | Awaiting promotion (would be HELD) | Rescue candidate | Case forms | Flags |
|---|---|---|---|---|---|
| AR-11 | — | 2022-11-02 [review, cert ✗, map: biographic_active]<br>2026-02-01 [review, no cert, map: needs_review] | — | 0 | no live edition |
| G-1041 | — | 2024-04-01 [review, cert ✓, map: active] | — | 0 | no live edition |
| G-1041A | — | 2024-04-01 [review, cert ✓, map: active] | — | 0 | no live edition |
| G-1055 | — | 2026-09-09 [review, no cert, map: needs_review]<br>2026-10-07 [draft, cert ✗, map: biographic_active] | — | 0 | no live edition |
| G-1145 | — | 2014-09-26 [review, cert ✗, map: biographic_active] | — | 0 | no live edition |
| G-1256 | — | 2015-08-10 [review, cert ✓, map: active] | — | 0 | no live edition |
| G-1450 | — | 2026-02-06 [review, cert ✓, map: biographic_active] | — | 0 | no live edition |
| G-1566 | — | 2024-04-01 [review, cert ✓, map: active] | — | 0 | no live edition |
| G-1650 | — | 2025-06-03 [review, cert ✓, map: biographic_active] | — | 0 | no live edition |
| G-1651 | — | 2025-06-03 [review, cert ✗, map: biographic_active] | — | 0 | no live edition |
| G-28 | 2026-09-22, version_backfill, cert ✓ | 2026-02-01 [review, no cert, map: needs_review] | — | 2 (2 open) | date from version_backfill |
| G-28I | — | 2018-05-23 [review, cert ✓, map: active] | — | 0 | no live edition |
| G-325A | 2025-01-20, uscis_page, cert ✓ | — | — | 0 | — |
| I-129 | 2026-09-09, source n/a, no cert | — | 2026-02-27, no cert | 39 (39 open) | rescue edition uncertified |
| I-129F | 2025-01-20, source n/a, no cert | — | — | 0 | — |
| I-129S | 2026-09-22 (ed. 2025-01-20), source n/a, no cert | — | — | 0 | version≠edition date |
| I-130 | 2024-04-01, source n/a, no cert | — | — | 0 | — |
| I-130A | — | 2026-09-23 [review, no cert, map: biographic_active] | — | 0 | no live edition |
| I-131 | 2026-09-18, version_backfill, cert ✓ | — | 2025-01-20, no cert | 0 | date from version_backfill; rescue edition uncertified |
| I-134 | 2025-01-20, source n/a, no cert | — | — | 0 | — |
| I-140 | 2024-07-06 (ed. 2024-06-07), source n/a, no cert | — | — | 0 | version≠edition date |
| I-360 | 2026-09-22 (ed. 2025-01-20), source n/a, no cert | — | — | 0 | version≠edition date |
| I-485 | 2026-09-18, source n/a, no cert | — | 2026-04-09, no cert | 0 | rescue edition uncertified |
| I-485 SUPPLEMENT A | — | — | 2026-09-30, no cert | 0 | no live edition; rescue edition uncertified |
| I-485 SUPPLEMENT J | — | — | 2026-09-30, no cert | 0 | no live edition; rescue edition uncertified |
| I-485A | — | 2026-10-07 [review, no cert, map: biographic_active] | — | 0 | no live edition |
| I-485J | 2026-09-18, source n/a, no cert | — | — | 0 | — |
| I-526 | 2026-09-22 (ed. 2025-01-20), source n/a, no cert | — | — | 0 | version≠edition date |
| I-526E | 2026-09-22 (ed. 2025-01-20), source n/a, no cert | — | — | 0 | version≠edition date |
| I-539 | 2024-08-28, source n/a, no cert | — | — | 2 (2 open) | — |
| I-539A | 2024-08-28, source n/a, no cert | — | — | 0 | — |
| I-589 | 2026-09-15, version_backfill, cert ✓ | — | — | 0 | date from version_backfill |
| I-612 | 2026-09-22 (ed. 2024-04-01), source n/a, no cert | — | — | 0 | version≠edition date |
| I-693 | 2025-01-20, source n/a, no cert | — | — | 0 | — |
| I-751 | 2026-09-22 (ed. 2024-04-01), source n/a, no cert | — | — | 0 | version≠edition date |
| I-765 | 2026-09-22 (ed. 2025-08-21), source n/a, no cert | — | — | 0 | version≠edition date |
| I-824 | 2026-09-22 (ed. 2024-04-01), source n/a, cert ✓ | — | — | 0 | version≠edition date |
| I-829 | 2026-09-27 (ed. 2025-01-20), source n/a, no cert | — | — | 0 | version≠edition date |
| I-864 | 2026-09-22 (ed. 2026-08-24), source n/a, no cert | — | — | 0 | version≠edition date |
| I-864A | — | 2026-09-22 [review, no cert, map: biographic_active] | — | 0 | no live edition |
| I-864EZ | 2026-09-23 (ed. 2026-08-24), source n/a, no cert | — | — | 0 | version≠edition date |
| I-90 | 2026-09-22 (ed. 2025-01-20), source n/a, no cert | — | — | 0 | version≠edition date |
| I-907 | 2024-04-01, source n/a, no cert | — | — | 3 (3 open) | — |
| I-918 | — | 2026-09-22 [review, no cert, map: needs_review] | — | 0 | no live edition |
| I-918 SUPPLEMENT A | — | 2026-09-30 [review, no cert, map: biographic_active] | — | 0 | no live edition |
| I-918 SUPPLEMENT B | — | 2026-09-30 [review, no cert, map: biographic_active] | — | 0 | no live edition |
| I-918SUPA | — | 2026-09-23 [draft, no cert, map: biographic_active] | — | 0 | no live edition |
| I-918SUPB | — | 2026-09-23 [draft, no cert, map: biographic_active] | — | 0 | no live edition |
| I-956F | — | 2026-09-27 [review, no cert, map: needs_review] | — | 0 | no live edition |
| N-400 | 2026-09-15 (ed. 2025-01-20), source n/a, no cert | — | — | 0 | version≠edition date |
| N-565 | 2026-09-15 (ed. 2025-02-27), source n/a, no cert | — | — | 0 | version≠edition date |
| N-600 | 2026-09-22 (ed. 2025-01-20), source n/a, no cert | — | — | 0 | version≠edition date |

## Appendix B - Crawl summary
61 URLs crawled on 2026-10-15 19:54 UTC; outcomes `ok_direct` 61; final status 200 for all; hosts `www.uscis.gov` only; kinds: form_page 13, form_pdf 41, instructions_pdf 7; request time min 28 ms / median 280 ms / max 965 ms; redirected 0; violations 0; chains leaving uscis.gov 0; failures 0; blocks hardening: no.

## Appendix C - Change log (append one entry per phase)

| Date | Phase | Summary | Files |
|---|---|---|---|
| 2026-10-16 | Release 0a | Read-only pre-rollout report, redirect-chain crawl, read-only DB wrapper, 50 tests, this document | `Backend/src/scripts/formEditionPolicyRolloutReport.js`, `formSourceRedirectCrawl.js`, `lib/readOnlyDb.js`, `tests/*.test.js`, `docs/FORM_PIPELINE_IMPLEMENTATION_REPORT.md` |
| 2026-10-16 | Release 0b-1 | Evidence-resolution path: 3 models (2 append-only), redirect-safe fetcher, verifier, fail-closed gate (wired into nothing), evidence service + admin/team_lead API, evidence section in Form Governance, unrun index script, 75 backend + 8 Admin tests, slicing check | `Backend/src/models/FormEdition*.js`, `models/helpers/appendOnly.js`, `modules/form-edition-policy/*`, `routes/index.js` (1 line), `scripts/createFormEditionPolicyIndexes.js`, `scripts/formSourceRedirectCrawl.js` (shared validator), `Admin/frontend/src/components/FormEditionEvidenceSection.jsx`, `services/api.js`, `pages/FormGovernance.jsx` |
