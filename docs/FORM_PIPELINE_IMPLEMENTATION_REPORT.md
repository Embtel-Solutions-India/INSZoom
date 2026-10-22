# Form Pipeline Reliability - Implementation Report (living document)

This is the ONE document that records the implementation of the approved plan in [FORM_PIPELINE_RELIABILITY_PLAN.md](FORM_PIPELINE_RELIABILITY_PLAN.md) (rev 9). Every phase appends its own section here instead of creating a separate report. Each section follows the same shape: **scope and authorization, what was built, how safety was kept, results, expected vs actual, findings for review, what was not done, and the next gate.** The plan asks for a completion report plus regression results before the next phase may start (Rule I); this document is that report for every phase.

**Rules that apply to every phase (from the plan):** nothing here may break or slow a current feature; each phase is approved on its own; database writes, deploys, the PM2 worker, migrations, load tests on the shared database and real emails each need their own approval; USCIS acceptance decisions are never invented.

## Phase status

| Phase | Status | Approval needed to start |
|---|---|---|
| **Release 0a** - read-only pre-rollout report + redirect-chain crawl | **DONE 2026-10-16 - awaiting your review** | given 2026-10-16 |
| **Release 0b-1** - evidence-resolution path, no enforcement | **DONE 2026-10-16 - awaiting your review** | given 2026-10-16 |
| **Release 0b-2** - automatic evidence + fail-closed gate wired into the pipeline (Rule J not enforced) | **DONE 2026-10-16 - awaiting your review** | given 2026-10-16 (indexes created; no other real-DB write) |
| **Phase 0 remainder** (frozen-status module, cache fix, certification on activate, job locks, one retire, e2e script safety, AI infra) | **DONE 2026-10-16 - awaiting your review** (test isolation deferred: needs an approved local test DB) | given 2026-10-16 |
| **Test isolation (local database)** | **DONE 2026-10-16** | given 2026-10-16 |
| **Phase 1** - durable, resumable, fenced pipeline (worker/PM2 production rollout and queued mode NOT switched on) | **DONE 2026-10-16 - awaiting your review** | given 2026-10-16 |
| **Phase 2** - mapping contract, policy, validator, coverage (live autofill unchanged) | **DONE 2026-10-16 - awaiting your review** | given 2026-10-16 |
| **Phase 3** - certification that proves correctness, release gate, safe activation, safe case migration, rollback (Admin screen, repair strategies and performance baseline NOT done) | **DONE in code 2026-10-22 - awaiting your review** | given 2026-10-22 |
| **Phase 4** - Gemini mapping engine (OFF by default, shadow-first), accuracy gate (closed), plus Phase 3's repair strategies, Admin release screen and performance tooling (live accuracy run blocked: the configured Gemini model is retired) | **DONE in code 2026-10-22 - awaiting your review** | given 2026-10-22 |
| Phases 5 - 6 | Not started | each separately |

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

# Release 0b-2 - automatic evidence and the gate wired into the pipeline

## 1. Scope and authorization

Authorized by you on 2026-10-16: (a) nobody submits a USCIS page URL or quote any more - **everything is fetched automatically**; (b) enforcement is wired in; (c) run the unique-index script; (d) **do not write to the real database** - if a write is ever needed, one single case only, and all later tests on that case only. Your answers to my questions: automatic evidence = "fully automatic acceptance"; enforcement = "pipeline only".

Interpretation you should confirm: "fully automatic" is implemented as **automatic only when USCIS's own page says so explicitly**. The system fetches the form's official page itself and records `accepted` or `not_accepted` only if the page contains an explicit statement naming the edition (patterns below). If the page is silent, ambiguous, cannot be fetched, or the stored PDF differs from the official one, **nothing is recorded and the edition stays held** - I did not make "all checks passed" equal "accepted", because that would let the system file a form USCIS may have stopped accepting. Rule J (blocking the four filing-ready case steps) is **not** enforced (you chose "pipeline only").

## 2. What was built

| Area | Change |
|---|---|
| Statement detector | `form-edition-policy/filingEligibility.js` - `filingEligibilityStatement({text, formCode, editionIdentifier})` returns `accepted` / `not_accepted` / `none`. Patterns: `current_acceptable_edition` (the page points at its "Edition Date" section for the current edition), `explicit_accept` ("will accept / continues to accept ... edition"), `explicit_reject` ("is not accepting / will not accept / no longer accepts / rejects"). Accept and reject for the same edition => `none` (ambiguous). Effective dates are never taken from the page (always null) so a future date can never make an edition usable early. 13 real USCIS pages are stored as fixtures. |
| Automatic check | `EvidenceService.runAutomaticCheck` + `autoCheck`: finds the official page (stored `sourcePageUrl`, else the form's standard page), fetches it through the redirect-safe fetcher, runs the detector and the existing verifier. `accepted` needs the whole verification to pass (incl. PDF checksum); `not_accepted` only restricts, so it needs the quote, the edition and an official source. Everything is computed in memory; **a write happens only when a decision is recorded** (snapshot + 5 audit events + decision row, machine actor `pipeline:official_source`). An existing `not_accepted` is never overturned automatically. |
| API | `POST /form-edition-policy/auto-check` `{formCode, editionIdentifier}` - exactly `admin` / `team_lead` (6 routes now). No URL, quote or dates are accepted from the user. |
| Admin screen | Form Governance > Form Edition Evidence: the URL / quote / date form is gone; each edition has **Check now** and the result is shown in plain words (accepted / not accepted / nothing recorded and why). |
| Enforcer | `EditionPolicyEnforcer.requireAcceptedEdition(template, {entryPoint})` - fail closed, no disable switch; throws `EditionPolicyHeldError` (HTTP 409, `EDITION_POLICY_HELD`) **before** the caller changes anything; any internal error is also a hold. |
| Entry points gated | `VersionManagementService.activate`; `uscis-form-importer.service.activateVersion`; `CaseFormEditionMigrationService.migrateCaseFormsToEdition`; `importLocalForm.js`; **11 bootstrap seeds** (`i129, i129f, i130, i134, i140, i485, i485supj, i539, i539a, i693, i907`); `scripts/replaceFormEdition.js`. |
| Rescue narrowed | `OnDemandFormAcquisitionService` used to reactivate "the most recently retired edition" without any check. It now restores only the exact edition that was live before the attempt (`_id: liveBefore._id`). |
| Pipeline-triggered checks | `FORM_EDITION_AUTO_EVIDENCE=true` makes the enforcer run the automatic check itself when an activation is attempted. **Default OFF** (see section 5). With it off, the system never writes by itself; an admin/team lead clicks Check now. |
| Indexes | `scripts/createFormEditionPolicyIndexes.js` was run with your permission. Verified read-only afterwards: unique `{formCode, editionIdentifier}` on decisions, unique `{evidenceCaseId, seq}` on audit events, supporting indexes on sources/audit; all three collections hold **0 documents**. |

## 3. How "do not write on the real database" was kept

- No test in this release touches the real database: every new test uses the in-memory store and injected fetchers/models. I did **not** run the tests that connect to the real DB (`h0-i129-seed`, `registryAgencyGate`, `FormEditionComparisonService` and similar).
- The coverage dry run used the Release 0a **read-only database handle** (any write throws) for reading templates, real outbound GETs to uscis.gov, and an in-memory store for the decisions.
- The only real-database change in the whole release is the index creation you authorized. No case, user, company or decision row was created, so there was nothing to clean up and the "one test case" allowance was not used.

## 4. Verification

| Check | Result |
|---|---|
| form-edition-policy + scripts tests | 181 pass, 0 fail (detector 19, automatic evidence 15, enforcer 9, entry-point matrix 14 incl. a static scan that fails if a NEW file makes a form edition live without calling the gate, routes/wiring) |
| Entry-point behavior | for VersionManagementService, the importer and case migration: held => throws, nothing mutated; a throwing gate => held; accepted => proceeds |
| Admin | vitest 127 pass (13 files); `npm run build` OK |
| Live backend | `/api/health` 200; `POST /form-edition-policy/auto-check` and `GET /editions` return 401 without a token |
| `ensureCurrentUSCISForm.test.js` | **did not finish in my run (timed out at 100 s)**. Its test 2 passed after 53 s and test 3 (auto-activate off, never reaches the gate) is where it stalls, in the mapping-migration code that talks to an unmocked Mongoose; I did not change that code. I could not confirm against the previous commit (a clean worktree failed to check out), so treat "pre-existing" as likely, not proven. |
| Not run | Client, Landing and Attorney builds (no file in them changed); the other DB-connected backend suites (by design, section 3) |

## 5. Real-data coverage (read-only dry run, 31 editions, 2026-10-16)

What the automatic check would do today against uscis.gov:

| Outcome | Editions | Forms |
|---|---|---|
| **Accepted automatically** | 8 | I-129 (2026-09-09), I-765 (2025-08-21), I-864 (2026-08-24), I-864EZ (2026-08-24), I-90, I-829, N-565, N-600 |
| Held - page has no explicit statement | 14 | I-130, I-134, I-907, I-140, N-400, I-129S, I-360, I-526, I-526E, I-612, I-751, I-824, G-325A, ... |
| Held - statement found but the stored PDF does not match the official PDF (`pdf_checksum_matches`) | 4 | I-129F, I-539, I-693, I-485 |
| Held - no standalone USCIS page (HTTP 404) | 2 | I-539A, I-485J |
| Held - edition date from an untrusted source | 3 | I-589, I-131, G-28 |
| Not accepted | 0 | - |

Nothing was written. The 4 checksum mismatches are a correct hold (the PDF we store may not be the accepted one) and are worth a look by someone who knows those forms.

## 6. Expected vs actual

| Expected | Actual |
|---|---|
| Admin/team lead submits nothing | Done - no URL/quote input anywhere; the API ignores any |
| "Fully automatic acceptance" | **Deviation:** automatic only for explicit USCIS statements (8 of 31 editions today); the rest stay held on purpose |
| Gate in every entry point | Done for 4 services/scripts + 11 seeds + replace script; static scan guards future additions |
| Held edition leaves the live one untouched | Done and tested; the rescue can no longer revive an unrelated retired edition |
| Pipeline writes decisions by itself | **Not enabled:** `FORM_EDITION_AUTO_EVIDENCE` defaults to off to honor "do not write on the real database" |
| Rule J (filing-ready steps) | Not enforced - "pipeline only" |

## 7. Findings for your review

1. **Behavior change that is live now:** the running backend (nodemon) already enforces the gate. Any **new** edition that is promoted/activated/migrated-to is held until a decision exists. Editions already live keep serving cases. Until someone clicks Check now (or you enable the flag), new editions simply wait.
2. A held edition is re-driven by the existing 12-hourly sync, so each cycle re-attempts and is held again (cheap: one decision lookup). With the flag on, each attempt also does one page fetch.
3. Coverage is limited by what USCIS publishes: only some pages state acceptance explicitly. For the rest a person must still decide - there is no screen for that any more (the manual path was removed from the UI per your instruction; the API route `POST /evidence` still exists for admin/team_lead).
4. 14 editions had no statement at all; I-130/I-140/I-907 (the bootstrap forms) will stay held on any new edition until USCIS words it explicitly.

## 8. What was NOT done

Rule J enforcement; the PM2 worker; enabling `FORM_EDITION_AUTO_EVIDENCE`; any real-database write other than the indexes; a decision for any of the 31 editions.

## 9. Gate before the next release

Your review of sections 1, 5 and 7, a decision on enabling `FORM_EDITION_AUTO_EVIDENCE=true` (the first automatic writes to the real database: decision/audit rows for the 8 accepted editions above), and a decision on what should resolve editions USCIS does not state explicitly.


## 10. Addendum (same day, your two follow-ups)

**"The edition date is written at the bottom of every form page."** Correct, and the importer was not reading it. `FormMetadataService` called `pdf-parse` with its old (v1) API while the installed package is v2, the error was swallowed, and the printed edition was therefore never extracted: no template in the database has `editionDateSource = "pdf"`. Fixed (code only, no database writes): the PDF is now read with the v2 API and the edition comes from the footer wording `Edition MM/DD/YY` - the most frequent value across the pages wins, a tie yields nothing. The old fallbacks `Expires` (the OMB approval date) and `Rev.` were removed because neither is an edition and they would have become live once parsing worked. The PDF footer still wins over the date USCIS shows on its page, as the code always intended. New tests: `PrintedEdition.test.js` (5, using in-memory PDFs).

Read-only measurement of the 54 stored editions (44 have an official PDF URL; the official PDFs were downloaded and the footer compared with the stored edition date):

| Result | Editions |
|---|---|
| Footer matches the stored date | 18 |
| Footer differs from the stored date | 2 - **I-589** stored 2026-09-15, footer 2026-07-28; **I-131** stored 2026-09-18, footer 2025-01-20 (both stored dates were `version_backfill`, i.e. import dates, not editions) |
| Footer found, no date stored (review / draft rows) | 17 (e.g. I-918, I-864A, I-130A, G-1055, I-485A) |
| No footer edition in the PDF | 7 (e.g. G-28, AR-11, G-1145) |
| No official PDF URL on the template (not checked) | 10 (I-129F, I-130, I-134, I-539, I-539A, I-907, I-140, I-693, I-485J, I-485) |

**Not applied:** correcting the stored dates (I-589, I-131) and filling the 17 missing ones is a write to live templates, and changing a live template's edition date can make the catalog sync see a "new" edition. It needs your approval; the footer reading is what makes it safe to do.

**"The check after the 12-hour background job is also attached to this subsystem only."** Done: `form-edition-policy/EditionPolicyScheduler.js` - `runScheduledEditionChecks()` asks the official USCIS page about every distinct edition on file (live or pending, trusted date only) through the same `runAutomaticCheck` the Check-now button and the gate use, tagged `scheduled_sync`. `USCISCatalogSyncJob` calls it right after `runCatalogSync` and contains no acceptance logic of its own (a test asserts this). One edition failing never stops the rest and the run never throws. It follows the same switch as the pipeline check: **it does nothing until `FORM_EDITION_AUTO_EVIDENCE=true`**, because a recorded decision is a database write. Tests: `scheduler.test.js` (4); the entry-point matrix now lists the job as the only non-enforcer importer.

Verification after both changes: 194 backend tests pass (form-edition-policy, scripts, PrintedEdition, EditionDate); backend `/api/health` 200 after the reload. `PDFFieldScannerService.test.js` has one failure that is not from these changes: it still expects the old `01/17/2025` version format while the code has produced `yyyy-mm-dd` since the version-normalisation change.

## 11. Addendum 2 (same day): edition dates corrected from the PDF, automatic checks switched on

You lifted the database rule ("you can write in the database, just do not create a case"). No case was created. All writes below are to form templates, their stored files and the three FormEdition* collections.

**I-589 and I-131 corrected to the edition printed in the footer of their own stored PDF** (`scripts/correctEditionFromPdfFooter.js`, dry run first, then `--apply`; the stored PDF is copied to the new name and verified byte for byte before the template is pointed at it; the old file is kept; the update only applies while the version is unchanged; idempotent - a re-run reports "already correct").

| Form | Before | After | Stored file |
|---|---|---|---|
| I-589 | edition/version 2026-09-15 (import date) | **2026-07-28**, source `pdf` | `government/uscis/I-589/2026-07-28/<sha256>/i-589_2026-07-28.pdf` |
| I-131 | edition/version 2026-09-18 (import date) | **2025-01-20**, source `pdf` | `government/uscis/I-131/2025-01-20/<sha256>/i-131_2025-01-20.pdf` |

Changed with the edition: `editionDate`, `version`, `registryId`, `pdfStorageKey`, `pdfTemplatePath`, `localPdfPath`, `artifacts.form.storageKey/storagePath`, `importMetadata.editionDateSource` and the certification's version label (so the next autopilot run does not re-certify for a label change). Nothing was deleted.

**One collision, and what I did about it:** I-131 already had a retired template with version `2025-01-20` (uploaded by hand earlier, status `retired`, no case forms; the unique `formCode+version` and `registryId` indexes would reject a second one). Only that retired row's **label** moved aside: version `2025-01-20` -> `2025-01-20-manual-upload`, registryId `I-131:2025-01-20` -> `I-131:2025-01-20-manual-upload`. Its mapping versions, its file and its status are untouched; the previous values are in this report if you want it reversed. The script does this only with `--relabelRetiredDuplicate`, only for a retired template with zero case forms.

Left as they were: the mapping versions keep their old, immutable `formVersion` label (they are found through the template, not through that label); `mappingConfiguration.version` was not changed (not an edition).

**Missing edition dates filled from the PDF footer** (`scripts/fillMissingEditionDatesFromPdfFooter.js`): 19 templates (the 17 review/draft rows plus two retired I-485 supplements) got `editionDate` and source `pdf`, e.g. I-918 2025-01-20, I-864A 2026-08-24, I-130A 2024-04-01, I-485A 2026-09-18, G-325R 2026-09-04. Only the date was set - not the version, file name or status. Six templates stay without a date because their PDF prints no unambiguous edition: G-28 (review), G-28I, G-1145, G-1256, G-1650, AR-11 (the 2026-02-01 row).

**Automatic checks switched on:** `FORM_EDITION_AUTO_EVIDENCE=true` in `Backend/.env` (git-ignored) and `.env.example`; the backend was restarted to pick it up and answers `/api/health` 200. I then ran one sweep through the scheduler (the same function the 12-hour job calls) to prove it end to end: 47 editions checked - **14 accepted** (G-1041, G-1041A, G-1566, I-129, I-765, I-829, I-864, I-864A, I-864EZ, I-90, I-918, I-956F, N-565, N-600), 21 no explicit statement, 4 held because the stored PDF differs from the official one (I-129F, I-539, I-693, I-485), 6 fetch failed and 2 without an official page (supplements with no standalone page); nothing was recorded as not accepted. Written: 14 decision rows (actor `pipeline:official_source`), 14 snapshots, 70 audit events. **I-589 and I-131 got no decision** - USCIS's pages do not state their acceptance explicitly - so any new edition of them stays held; their currently live editions keep serving.

From now on the check also runs by itself ten minutes after backend start and every 12 hours after the catalog sync, and at every activation attempt.

Tests: 6 new (`correctEditionFromPdfFooter.test.js`); 191 pass across form-edition-policy and scripts.

## 12. Addendum 3 (same day): the published edition IS the accepted edition

**Your decision:** the 12-hourly edition-date check removes the need for USCIS to state acceptance in words. The edition USCIS publishes as current on a form's page (its own "Edition Date" field) is accepted unless the page refuses it. This reverses the plan's "silence never creates acceptance" rule on your instruction.

**What the 12-hour job already does (unchanged, nothing was rebuilt):** `USCISCatalogSyncJob` -> `FormCatalogSyncService.runCatalogSync` every 12 h (10 min after start): lists every form on uscis.gov, compares each page's edition date with the installed one, does nothing for unchanged forms, and for new/changed editions runs the existing pipeline (fetch with retry -> qpdf normalise / XFA removal -> import -> carry the mapping forward or apply authored rules -> certification -> promote only if everything passes, otherwise the installed edition keeps serving). It is pure code with no AI. **Gemini is not part of that pipeline** - field mapping uses the earlier edition's mapping graph or the authored `partyFieldRules` crosswalks, and Gemini appears only in document intelligence (passports, resumes). Using Gemini for mapping was a later phase of the plan, gated behind a golden set; it is not built and was not changed here.

**What changed now**
- `filingEligibility.js`: new pattern `current_official_edition` - accepted when the page's own "Edition Date" equals this edition and no sentence refuses it (a refusal still wins; an edition the page does NOT list as current stays held; contradictory statements stay ambiguous). The quote kept in the audit trail is the page's own "Edition Date <D>" text, verified verbatim in the snapshot.
- Verification stays mandatory: official https uscis.gov source, fresh fetch, the page names the edition, the template's edition matches. For the stored-PDF comparison: if a checksum was compared it must match (a difference always holds the edition); **if no checksum can be compared** (no stored checksum / no official PDF URL on the template) the edition printed in the footer of the stored PDF must equal the edition (`pdf_printed_edition_matches`). New `readPrintedEdition` dependency; tests added (21 detector + 4 new automatic-evidence tests; 196 pass in form-edition-policy + scripts).

**Correction of something I told you earlier:** I reported four forms (I-129F, I-539, I-693, I-485) as "stored PDF differs from the official PDF". That was wrong. They were held because those seeded templates have **no stored checksum to compare with** (and no official PDF URL), not because the PDFs differ. With the footer check they now pass. Sections 5, 7 and 10 above carry the old wording.

**Read-only dry run after the change (49 editions on file, real uscis.gov pages, memory store): 38 accepted** (9 `current_acceptable_edition`, 9 `explicit_accept`, 20 `current_official_edition`), 0 not accepted. Not accepted by the automatic check, correctly: I-539A, I-130A, I-485J, I-485A, I-918 Supplements A/B (HTTP 404 - supplements have no page of their own; the parent form's page governs), I-918SUPA/B drafts (no official page known), G-28 (edition date from an import date and its PDF prints no edition), and two older review rows (G-1055 2026-09-09, G-325R 2026-09-04: not the page's current edition).

## 13. Addendum 4 (same day): every form checked, supplements resolved from their own PDF, manual path removed

**Footer reader improved.** Older forms print the footer as `Form G-28 09/17/18  Page 1 of 4` (no word "Edition"; G-1145 even has a stray letter before "Page"); that shape is now read too. Still footer-only: OMB `Expires` and EOIR `Rev.` / `Exp.` are never read.

**Supplements and forms without a page of their own** (I-130A, I-485J, I-485A, I-539A, I-918 Supplements A/B): their parent form's page is used when it lists them; otherwise the **official PDF at its stable uscis.gov address** (`.../forms/i-130a.pdf`, `i-485supj.pdf`, `i-918supa.pdf`) is the source - its own footer prints the edition, and that footer line is the quote in the audit trail (pattern `current_official_pdf`). If that PDF prints a different edition the result is `official_pdf_edition_differs` and nothing is recorded.

**All 60 templates compared (stored-PDF footer vs stored edition date):** 53 match, 1 corrected (G-28 active: 2026-09-22 import date -> **2018-09-17** from its footer; file now `g-28_2018-09-17.pdf`), 4 review rows still without a date by your instruction (G-1145 2014-09-26, G-1256 2015-08-10, G-1650 2025-06-03, G-28I 2018-05-23 - footers found, nothing written; the fill command had already written them when your instruction arrived and I put them back exactly as they were), 2 review rows whose stored PDF is not a USCIS form at all (**AR-11 and G-28 review rows hold "Form EOIR-29 Rev. 02/2026"** - wrongly imported), 1 retired I-485 row (stored 2026-04-09, footer 2026-09-04; not touched).

**Sweep result:** 46 of 49 editions recorded as accepted (all 8 supplements included, G-28 2018-09-17 included). Not accepted automatically: G-1055 2026-09-09 and G-325R 2026-09-04 (older review rows, not the page's current edition) and I-485A (review row: the stored PDF's checksum differs from the official i-485supa.pdf although the footer edition is the same - a re-posted file).

**Manual path removed.** `POST /evidence`, `GET /evidence/:id` and `POST /evidence/:id/decision` are no longer routed; only `GET /editions`, `GET /gate` and `POST /auto-check` (runs the same automatic check on demand) remain, and the Admin API client lost the three methods. The service code behind them stays as internal, unrouted code with its tests.

Tests: 211 backend (policy, scripts, footer reader), 8 Admin component tests.

# Phase 0 remainder - immediate safety fixes (no new behavior for any single form: every change is form-agnostic)

## 1. Scope and authorization
You said "now implement the next phase" after 0b-2, which in the plan is Phase 0 remainder ("Immediate safety fixes + test isolation"). Code only; no database writes were made in this phase and no case was created. Each item below was checked against the current code first and only what was still wrong was changed.

## 2. What was built

| Plan item | Result |
|---|---|
| `VersionManagementService.activate` invalidates the template cache itself | **Done.** The lifecycle and import routes never did; the registry console did it on its own. Now `activate` and `retire` both drop the cache (non-fatal if it cannot). |
| `activate` requires a passing certification, or an audited non-critical override | **Done.** No certification on record -> refused (409, "certify first", not overridable). A failed critical check (`pdf_fillable`, `mapping_valid`, `fill_roundtrip`) -> refused. Only failed non-critical checks (`viewer_download`, `components_slice`) can be overridden, with `overrideReason` (10+ characters) in the request body; the reason, who and when are stored on the template (`lifecycle.certificationOverride`) and in the audit log. The automatic pipeline always certifies before it promotes, so its behavior is unchanged. Legacy live editions are untouched. |
| `activate` calls the edition gate | Already done in 0b-2 (runs after the certification check, before anything is changed). |
| One frozen-status rule (Rule G) | **Done.** `form-mapping/config/caseFormFreeze.js` exports `FROZEN_CASE_FORM_STATUSES` (finalized, filed, approved, generated, ready_for_pdf, locked, receipt_received, archived) and `isFrozen(caseForm)` (status on the list OR `isLocked`). `CaseFormEditionMigrationService`, `scripts/replaceFormEdition.js`, `scripts/applyPartyMappingsToExistingCases.js` and the rollout report now import it. A test fails if any other hard-coded list appears (the five lists with other meanings are named in the test). `receipt_received` is not a real `CaseForm.status`; kept defensively and asserted as the only such value. |
| Fix the "new_cases_only" impact text | **Done.** The stored impact now says `futureCasesAffected: "new_case_forms"` and states that open case forms stay on their edition until migrated (the automatic pipeline migrates them with all answers; frozen forms never). Nothing read the old value. |
| `withJobLock` on the edition-upgrade and monitoring jobs | **Done** (`uscis-edition-upgrade`, `uscis-monitoring`, 3 h lease like the catalog sync; `server.js` passes it in; without it the job just runs, so nothing else breaks). Their failures now go to the logger instead of `console.error`. |
| Merge the two `retire` implementations | **Done.** `VersionManagementService.retire` is the only one; it sets status, currentStatus and activeFlag together (the lifecycle route used to leave `activeFlag` true) and drops the cache. The registry console's `retireTemplate` delegates to it. |
| `deleteFormFromCatalog` refuses while a job runs | **Done.** 409 `FORM_PIPELINE_JOB_RUNNING` when the catalog sync, edition upgrade, monitoring or autopilot lock is held; checked before anything is looked up or deleted. If the lock store cannot be read the delete is not blocked. |
| `verifyFormImportEndToEnd.js`: record created ids, `--cleanup` only those, refuse if the code pre-existed or a case form references it, dry run | **Done, and it fixed a real hazard:** the old `--cleanup` deleted every template under the form code, including real ones. It now records the ids it created in a run file, deletes only those, refuses when nothing was recorded, an id belongs to another form code, or any case form references one; `--dry-run` changes nothing. |
| Failure paths log warn/error | **Partly.** The lifecycle audit and notification calls and the two job failures now log; this is not an exhaustive sweep of every `.catch(() => null)` in the codebase. |
| AI: crashed `AIJob` in `processing` recovered | **Done.** `recoverStuckProcessingJobs` (runs inside the existing 60-second recovery tick under its lock): a job untouched for 15 minutes (`AI_JOB_STUCK_MS`) goes back to the queue (attempts left) or is failed (none left), claimed atomically. |
| AI: `outputSchema` enforced | **Done.** It was passed to the provider but never checked. `modules/ai/outputSchema.js`: wrong type -> retryable 502; missing keys get their empty value; numbers/booleans sent as strings ("85") are converted, not rejected; keys not in the schema are kept; no schema -> untouched. |
| AI: timeout / AbortController on `gemini.service` | **Done** (the AI provider registry already had one). Every attempt has a deadline (`GEMINI_TIMEOUT_MS`, default 90 s); a timeout or dropped connection is retried like a 503 and ends as a clear 504. |
| Test isolation (`MONGODB_TEST_URI`, `test-utils/db.js`) | **Not built.** The plan makes it conditional on approval of a local test database. Until then every new test is DB-free, as in all earlier releases. |

## 3. Behavior changes you should know about
1. Activating an edition by hand now needs a passing certification (or the audited override above); an uncertified edition that used to activate now gets a 409 with the reason. The Admin screen shows the message; there is no override field in the UI yet (API only).
2. Case-form migration and the party-mapping re-apply now also skip `approved`, `generated` and `ready_for_pdf` forms (the approved union); `replaceFormEdition` now also skips `archived` and explicitly locked forms.
3. Retiring through the lifecycle route now also clears `activeFlag`.
4. Model answers that are the wrong type now fail with a retryable 502 instead of being stored; the common harmless case (a number as a string) is converted.

## 4. Verification
267 backend tests pass (form-edition-policy, scripts, uscis-lifecycle, frozen module, AI infra, existing AI platform and form-registry tests, footer reader); new this phase: certification rules (4), frozen module (3), job locks and delete refusal (5), end-to-end script safety (4), AI infrastructure (7). Backend restarted on its own after the edits and answers `/api/health` 200; `/api/form-edition-policy/editions` still 401 without a token. No test connects to the real database. Not run: the Admin, Client, Landing and Attorney builds (no frontend file changed in this phase).

## 5. What was NOT done
Rule J; the local test database; the PM2 worker; an exhaustive sweep of silent catches; a UI field for the certification override.

## 6. Gate before the next phase
Your review of section 3. Next in the plan: Phase 1 (durable, resumable, fenced pipeline).

# Test isolation in a local database + Phase 1 - durable, resumable, fenced pipeline

## 1. Scope and authorization
You asked for the test isolation in a local database and the next phase, one after another. Test isolation first, then Phase 1. The only writes to the real (shared) database were the indexes of the new `formpipelinejobs` collection (index-only, `createFormPipelineIndexes.js --apply`); no case, user or company was created, and no form template was touched.

## 2. Test isolation (plan Phase 0 item, deferred until now)
Verified read-only first, as the plan requires: the MongoDB on this machine (8.0.15, a Windows service on 127.0.0.1:27017) is the local one, separate from the remote shared database, and holds your own databases (`immigration_crm`, `inszoom_crm`, `usais_db`, the older `immigrationcrm_test`, ...), which are never touched.
- `src/test-utils/pipelineDb.js`: DB-backed pipeline tests connect ONLY to a local database whose name starts with `form_pipeline_test` or ends `_test`, and never to the application's own database (the guard is a pure function with its own tests: remote hosts, replica lists with one remote member, `mongodb+srv`, non-test names and the app database are all refused).
- Each test **process** gets its own throwaway database (`form_pipeline_test_<pid>_<random>`) and drops it when it finishes - needed because Node runs test files in parallel and files sharing a database were deleting each other's jobs (found when the folder was run together). `MONGODB_PIPELINE_TEST_URI` overrides it with a database of your choice (never dropped; run one file at a time).
- Unique `ZZ-PIPE-*` form codes, recorded-id / by-code cleanup, `assertNoCaseFormReferences`, indexes and collections built explicitly for only the models a test names.
- With no local MongoDB (or an unsafe URI) the DB-backed tests are SKIPPED, not failed.
- First use: `policy.localdb.test.js` runs the Release 0b-2 and Phase 0 behavior on the REAL models and real indexes: unique decision per edition, append-only audit trail, held activation leaves the live edition untouched, automatic acceptance, activation after acceptance, certification required, `not_accepted` is final, two racing checks leave one decision row.

## 3. Phase 1 - what was built

| Plan item | Result |
|---|---|
| `FormPipelineJob` | `models/FormPipelineJob.js`: state `pending / running / blocked / held / dead_letter / done`; per-stage `{status, attempts, startedAt, finishedAt, error}`; `currentStage`, `nextAttemptAt`; lease `{lockedUntil, token, fence}`; `lastError{class, code, stage, message}`; `repairsTried[{strategy, outcome, verification, at}]`; artifact ids; `editionKey`; `shadow`; alert-dedupe list; capped history; `schemaVersion`; TTL on finished jobs. **A form has at most one open job**, enforced by a partial unique index (`one_open_job_per_form`, created on the real database). |
| Atomic claim, heartbeat, lease reclaim, fence | `FormPipelineJobService`: `claimNext` is one atomic update (`fence++`, `attempts++`); every later write is conditional on token AND fence, so a worker that lost its lease can change nothing (`LeaseLostError`); `recoverExpired` returns a dead worker's job to the queue or dead-letters it when its attempts are used up. Tested with two racing claimers and a stale worker waking up. |
| Re-check before any commit | The `promote` stage re-reads the job (state, token, fence, unexpired lease, same edition key) before it runs, takes the per-form promotion mutex (`form-promote:<code>`), re-checks inside the mutex, and only then calls the EXISTING guarded activation (certification + readiness + approval + the edition-policy gate). A lost lease or a busy mutex means the promotion code never runs. No new promotion logic. |
| Stages wrap existing services | `ensureCurrentUSCISForm` / `activateOrPromote` take an optional job context and report `detect, import, map, certify, promote, migrate_cases, finalize`. With no context every hook is a plain pass-through (the existing tests prove the old path is unchanged). `activateOrPromote` was NOT split into new functions - splitting a long, swallow-and-continue function was the riskier way to get the same stage records. |
| Edition identity, idempotence | `editionKey = formCode|editionDate|checksum` is recorded once known; one open job per form; repeated requests return the same job. |
| Entry points | Admin Fetch, the mapping-save flow, the 12-hour catalog sync and the edition-upgrade job go through `FormPipeline.runForm`. **`FORM_PIPELINE_MODE=inline` (default): the caller gets exactly the result or exception it always did**; the run is also recorded, a failed run is retried by the worker, and if the job cannot be claimed the original call is made unrecorded. **`queued`: the caller only enqueues** (Admin Fetch answers 202 with the job id) and the worker does the work. Not yet routed: `acquireForCase` and the form-generation check (case-scoped, user waiting; a later step). |
| Worker | `FormPipelineWorker`: one job at a time, bounded jobs per pass, jittered start, alive marker, graceful stop. Runs embedded in the API (default: where the work always ran) or as its own process: `src/workers/formPipelineWorker.js` with `FORM_PIPELINE_WORKER=external`. The API alerts when jobs wait more than 15 minutes and no worker marker is fresh; there is no inline fallback in queued mode. |
| Recovery | Errors are classified (`errorClassifier.js`): transient -> exponential backoff with jitter, then dead-letter after the attempt limit; blocked (bad / missing PDF, page not found) -> slow retry (24 h); held (edition-policy hold reported by the existing activation) -> re-checked every 12 h behind the same gate, attempts not used up; lease lost -> stop quietly. A repair framework (repair, VERIFY, retry once, per-strategy limit, recorded on the job) is in and tested with injected strategies; **no concrete repair strategy is registered yet** (they belong with certification in Phase 3). |
| Visibility | `GET /api/form-pipeline/status`, `GET /jobs?state=&formCode=`, `GET /jobs/:id` (admin, team lead, super admin), `POST /jobs/:id/retry` (admin, super admin); the lease token never leaves the server. No Admin screen was added (the plan asks for the endpoint; the Admin UI change needs your confirmation). |
| Developer alerts | Failure / blocked / dead-letter alerts: recipient `FORM_PIPELINE_ALERT_EMAIL` (default `ishaan@embtelsolutions.com`), template `form-pipeline-alert` on the existing email service, one alert per job per (kind, stage, error class, code), switch `FORM_PIPELINE_EMAIL_FAILURE`, in-app notice for admins when no mail provider is configured or emails are off, alert failures never affect the pipeline, messages carry only a sanitized class / code / one-line message. A BLOCKED result of a run a person started (admin Fetch, mapping save) is not emailed - they already see the error. Success, held and digest emails are Phase 5. |
| Related guards | Deleting a form from the catalog is also refused while a pipeline job for that form is running; the standalone worker, PM2 snippet and `.env.example` settings are documented. |

## 4. Behavior you should know about
1. **Nothing changes for callers by default.** In `inline` mode every entry point returns what it always returned; the difference is that each run is recorded and a failure is retried later by the worker with backoff.
2. **Failures can now email the developer address** (that is the feature you asked for). The email service's `EMAIL_SUPPRESS_STAFF_AND_ATTORNEY` setting still applies if you switch it on.
3. **Held editions**: a job whose edition the gate refused waits and is re-checked every 12 hours; it can only ever be promoted through the gate.
4. Real database: one new collection (`formpipelinejobs`, 0 documents) with its indexes.

## 5. Verification
327 backend tests pass across the touched areas (new this phase: 12 job-service + 13 runner/alerts/entry/worker + 2 real-pipeline-hook + 8 wiring + 7 classifier + 6 test-isolation, all DB-backed ones on throwaway local databases). The real `ensureCurrentUSCISForm` code ran inside a job against a local database with only uscis.gov and the mapping services stubbed. Found and fixed by those tests: a summary bug (a not-promoted edition was reported "activated"), cross-file interference in a shared test database, and `key=` secrets slipping through message sanitizing. The live backend restarted by itself, answers `/api/health` 200, and the new endpoints return 401 without a token; the embedded worker is writing its alive marker. No local databases are left behind.

Known pre-existing issue, not caused by this phase: `ensureCurrentUSCISForm.test.js` still stalls on its third test (it calls un-mocked models without a connection); its first two tests pass.

## 6. Production prerequisites NOT done (each needs its own approval, per the plan)
Running the worker as a separate PM2 process and the deploy-workflow change that restarts both apps in lockstep (`max_memory_restart`); switching the live system to `FORM_PIPELINE_MODE=queued` and `FORM_PIPELINE_WORKER=external`; the Admin UI for enqueue + status polling; a check of whether the API runs PM2 cluster or single instance; a real test email.

## 7. What was NOT done
Concrete repair strategies; routing `acquireForCase` / form generation through the job layer; Phase 5 emails; the performance-budget measurement for the worker; the Admin screen.

## 8. Gate before the next phase
Your review of sections 3, 4 and 6. Next in the plan: Phase 2 (mapping contract, validator, coverage report, edition policy model).

# Phase 2 - mapping contract, policy, validator, coverage (additive; live autofill is provably unchanged)

## 1. Scope and authorization
You said "make the changes to the specific phases and run phase 2". The plan's Phase 0 and Phase 1 sections now carry an "As built" note of what was implemented and where it differs from the text (see the plan). Phase 2 was then implemented. No write to the real database was made in this phase (only reads for calibration); no case was created; every change is form-agnostic.

## 2. What was measured first (read-only, real data)
- 59 active mapping versions, 1,404 edges: **every edge is `active`**, none has an `origin`, and **no field uses the legacy `field.mapping{}`** - so restricting projections to active edges and ignoring legacy `mapping{}` change nothing for any live form today.
- Of the 1,404 live source paths, every one resolves once the real path universe is used (registry + the party aliases + the profile maps + the question library + the authored party rules + children of registered object paths). The first, naive "registry only" reading would have flagged 31 paths falsely (e.g. `petitioner.signatory.*`, `employment.offSiteWorkLocations`), which is why the universe is built from all of these.
- The new contract run over every live edge reports **35 findings in 3 forms**: I-907 (23) and G-28 (10) have edges whose `profileOwner` is `employee` while the path is `petitioner.*` (stale derived metadata), and I-539 (2) has a field whose label says "Beneficiary or Applicant" but whose PDF name says "Petitioner" and reads `company.name`. These are real findings for a person to review; they are legacy edges, so they are **reported, never blocking**.
- The pipeline's own rule step (`PartyFieldMappingService.plan`) was simulated in memory against all 30 live forms and judged by the new contract in the strictest (enforced) mode: **0 errors, 0 policy conflicts**. That run found the missing "authored rules are a verified source of paths" input (12 false errors on I-129) before anything shipped.
- After the change, all 30 live forms projected exactly as many field mappings as they have edges (1,355 = 1,355).

## 3. What was built
| Plan item | Result |
|---|---|
| Additive edge fields and statuses | Edges (the graph is a Mixed object, so no migration) gain `origin` (authored / legacy / inferred / ai / scored), optional `evidence`, `reviewedBy/At`; status `rejected` is valid next to `active` / `needs_review`. |
| `MappingPolicy` (Rule A) | `contract/MappingPolicy.js`: ranking authored < legacy < inferred < ai < scored; a lower-ranked edge never replaces a live higher-ranked one (the attempt goes to `conflicts[]`); a NEW scored / ai suggestion is stored `needs_review`; edges of unknown provenance are `legacy` and are never bulk-deactivated; applied at `persistVersion`. |
| Both projections filtered | `graphToFieldMappings` and `FormMappingService.applyMappingGraph` project only `active` edges. |
| Legacy `mapping{}` guard | It never adds to a field that already has graph mappings; with none it still works and a one-time warning is logged (no live field uses it). |
| `defaultValue` classification | `defaultValueClassifier.js` (checkbox_unchecked, empty_dropdown, empty_value, barcode_token, constant, party_looking, other); committed snapshot `config/defaultValueSnapshot.json` of the 4,020 live defaults (3,119 unchecked checkboxes, 228 empty dropdowns, 312 empty values, 347 barcode tokens, 5 `PRESENT`, 0 person-shaped, 9 flagged `other` for review: G-325A, I-864EZ text/total fields); `scripts/defaultValueReport.js` compares live data with the snapshot (read-only, exit 1 on drift, `--write` refreshes it); a test proves autofill output for every category is unchanged (a default is used only when a field has no mapping). Behavior is preserved; nothing was restricted. |
| Registry metadata | `role`, `description`, `cardinality` (derived from the path unless an entry sets them) and `describe(path)` on `CanonicalFieldRegistryService`; all existing keys untouched. |
| `MappingContractValidator` | `contract/MappingContractValidator.js`: path resolvable, type compatibility (clear contradictions only), supported transform and its referenced paths, supported condition operator and its paths, fallback path, repeating / arrayItem references, party contradiction (the form field speaks about one side, the path belongs to the other), stale derived metadata (`partyRule`, `profileOwner`), valid status and origin; unmapped fields classified intentional / out-of-scope / unresolved / optional. The transform and operator lists are read from `MappingResolver` by a test, so they cannot drift. **New / changed edges are enforced (errors); legacy edges are report-only.** Wired into `validateWithContract`, used by `persistVersion`, `MappingGraphService.activate` (hard gate), the certification `mapping_valid` check and the manual edit API. |
| `MappingCoverageService` | One compact report (fields mapped / required-unmapped, unmapped by class, edges by status and origin, checklist questions with no PDF field, unpopulated sources, unreachable conditions, duplicate targets, contract summary, default classes). Stored on the **mapping version** (`validation.coverage`, never on the template: the I-129 template is ~15.85 MB of the 16 MB limit); read-only route `GET /api/form-mapping/templates/:templateId/coverage`. (Deviation from the plan text: it said `validationSummary.coverage` on the template.) |
| `carryForwardGraph` with equivalence | Exact PDF-name / id matches are claimed first, exactly as before. An edge whose field disappeared may follow a renamed field only when it is provably the same (same type, same printed label ignoring numbering, same section, and the only such field); it is carried as `needs_review` (a person confirms it), reported as `renamedEdges`, and the edition is not auto-activated. Anything else is lost, as before. (The weak FieldDiffService similarity is not trusted to decide.) |
| Origins on the writers | Party rules: `authored` (or `inferred`) and the derived `profileOwner` is recomputed when a rule rewires an edge; admin edits: `authored` + `reviewedBy/At`; scored suggestions: `scored`; the biographic tier: `inferred` (so it stays usable); everything else: `legacy`. |
| Manual edit API | An active edge that breaks the contract is refused with 422 `MAPPING_CONTRACT_VIOLATION` and the reasons; it may still be stored as a `needs_review` suggestion. |
| Edition policy extensions (plan's last bullet) | Delivered earlier (Release 0b-2 and its addenda): automatic evidence from official pages and PDFs, the 12-hourly refresh, stale detection (a decision past its review date is re-checked), Form Governance integration. **Not built:** a separate "scanner-notice early warning" hold - an explicit refusal on the page is already recorded as `not_accepted` by the automatic check. |

## 4. Behavior you should know about
1. Live autofill and live mapping versions do not change (section 2). New behavior applies to NEW graphs: scored / ai suggestions are review-only, a new or changed edge must satisfy the contract before a mapping version can be activated, and a rewired party-rule edge carries a recomputed owner.
2. A mapping that can no longer be activated automatically now stays in review with the contract's reasons (instead of going live with a questionable edge); the previous edition keeps serving.
3. The 35 legacy findings are listed per form in the coverage report; fixing them is per-form work (not done here).
4. `MappingGraphService generates canonical-to-form relationships...` (a scoring test) fails; it asserts which registry path the scorer prefers for "Date of Birth" and does not depend on anything changed here (it was not in the earlier regression runs).

## 5. Verification
565 backend tests pass, 1 fails (the scoring test above). New this phase: 11 policy / path-universe / drift tests, 16 validator / coverage / default-value tests, 10 carry-forward / projection / writer / registry tests, 7 DB-backed tests on real models (throwaway local database: stamping, review-only suggestions, conflict keeping, hard-gate activation, manual edits, read-time projection, coverage). Existing mapping, registry and form tests that do not touch a database all still pass. The live backend restarted by itself and answers `/api/health` 200.

## 6. What was NOT done
Fixing the 35 legacy findings; routing `acquireForCase` through the job layer (Phase 1 note); the Admin screen for the coverage report; a concrete repair strategy for certification; the golden set (a Phase 2 deliverable in the plan that needs a named domain reviewer); the gate for Gemini mapping (Phase 4).

## 7. Gate before the next phase
Your review of sections 2, 4 and 6 and the decision on the golden-set reviewer. Next in the plan: Phase 3 (certification, edition safety, release gate).

## 8. Phase 2 addendum - closing the items section 6 left open (2026-10-16)

| Item | Result |
|---|---|
| 35 legacy contract findings | Fixed and applied live (I-907 v10, G-28 v9, I-539 v13) by `scripts/repairLegacyMappingFindings.js` (dry-run by default, backup to `Backend/backups/forms/`, then a new mapping version + normal activation). It recomputes `profileOwner` from the edge's party rule (derived, never typed) and records two reviewed exceptions (I-539 `P3_Line4_NameofPetitioner[0|1]`, reason stored on the edge; an exception counts only with a reason of 10+ characters). Filled values are identical before and after (tested through `FormMappingService.resolveField`). A read-only scan afterwards: 0 contract violations on all 1,404 live edges, all active, no legacy `mapping{}`. |
| Failing scoring test | Fixed at its cause: the scorer no longer lets the tail word "date" outrank an exact alias. `scoreField` adds `aliasBoost` (+0.3) when the form label equals a registry alias ("Date of Birth" -> `person.dob`). |
| Golden set draft | 424 plain-language entries over 14 forms, generated read-only from the live active mappings (`scripts/buildGoldenSetDraft.js`), each with an example run through the real resolver for a fictional sample client. Meets the plan's bar (>=300 entries, >=25 per box type, >=3 forms in employment / family / single, held-out form I-131). No technical id appears in anything a reviewer sees (tested). |
| Golden set review | `GoldenSetReview` / `GoldenSetSignOff` models, `/api/golden-set` (summary, entries, review, sign-off, CSV export). Answers and sign-off only for the reviewer(s) in `GOLDEN_SET_REVIEWERS` (default `admin@immiglance.com`); an answer is tied to the entry's content hash, so a reworded entry needs a new answer and an old sign-off shows out of date. Sign-off is refused while any box is unanswered / "Not sure" or the Right entries fall below the plan's minimum. Reviewer steps: `docs/GOLDEN_SET_REVIEW_GUIDE.md`. |
| Admin screens | In Form Governance: **Import Progress** (pipeline jobs, plain states and stages, why a job is stuck, Retry for admin / super_admin, auto-refresh, and a queued-fetch (202) message instead of a false "already active"), **Golden Set Review**, and a **Mapping coverage** panel on each form's detail page. |
| Tests | Backend: 12 golden draft (DB-free) + 7 review (throwaway local DB) + 6 repair tests; the named form-mapping files all pass (61 of 61 in the final run). Admin: 150 of 150, build passes. |

Still open: the reviewer has not yet answered the 424 entries (that is the human step); `ensureCurrentUSCISForm.test.js` still stalls on its 3rd test (pre-existing, unmocked mongoose); Phase 3.

# Phase 3 - certification that proves correctness, one release gate, safe activation, safe case migration, rollback

## 1. Scope and authorization
You said "implement phase 3" on 2026-10-22 (after the golden set was signed off again that morning and I-131 was rebuilt). Code, tests, two index-only database writes (below) and this report; **no case, user or company was created**, no real e-mail sent, no deploy, and no benchmark was run on the shared database. Everything is additive and fail-closed: nothing here weakens a Phase 0-2 check. The case-migration half (Rule G) was built by a parallel worker in its own files; the rest by me.

## 2. What was built
| Plan item | Result |
|---|---|
| Certification proves correctness (distinct markers) | `form-release/markerCertification.js`, two new certification checks in `FormCertificationService`: **party_markers** - every party gets a distinct synthetic marker (PETITIONER_TEST_001, BENEFICIARY_TEST_002, COMPANY_TEST_003, PREPARER_TEST_004); each active edge is resolved by the REAL `MappingResolver` (transforms, fallbacks, composite sources) and a box may only receive its own side's marker and never two sides at once. The party a box speaks about comes from its own label / section / PDF name, not from the mapping, so the check is not circular. A reviewed exception on an edge (`contractExceptions`) silences only that code on only that edge. **widget_inputs** - each edge is resolved for a fictional client and judged against its box: tick boxes get booleans, a drop-down gets a choice the PDF renderer can select (it uses the renderer's own `fitChoiceValue`, so "H-1B" finds "H1B - SPECIALITY OCCUPATION"), dates are dates. Only what can be observed is judged; the rest is counted as unobserved. In memory: no PDF, no database. |
| CERT_CHECK_POLICY | `form-release/certPolicy.js`: ONE table. Five critical checks (pdf_fillable, mapping_valid, fill_roundtrip, **party_markers, widget_inputs**), two overridable with a written, audited reason (viewer_download, components_slice). **An unknown check name is now critical** (it used to be overridable, so a crashed certification could have been waved through). |
| One ReleaseGate | `form-release/ReleaseGate.js`: `promote | restricted_degraded | approval_required | held | blocked`, with every check listed; most severe wins; every error inside a check fails closed. It combines preconditions (approved, mapping active, not deprecated), certification, the edition-acceptance decision (read-only, through the enforcer) and the edition diff. `VersionManagementService.activate` uses it for the preconditions + certification (acceptance is still enforced by `requireAcceptedEdition` and the diff by the mapping activation, so nothing is asked twice and nothing is weaker). The full gate is shown by `GET /api/form-release/templates/:id/gate`. |
| Activation protocol | `VersionManagementService.activate`: the **new edition goes live while the old one is still live** (readers take the newest active edition, so there is never a moment without a live form), the change is confirmed, only then the old edition is retired and the intent cleared. The intent `{newId, oldIds, step}` is saved WITH the activation (`lifecycle.promotionIntent`). |
| Crash reconciliation | `VersionManagementService.reconcilePromotions` (run at start-up and every 5 minutes, under a job lock): new live + old live -> finish retiring the old one **only if the acceptance gate still holds**, otherwise retire the new one; neither live -> restore the previous edition **only if the gate still accepts it**, otherwise activate nothing, alert admins and report "no policy-approved edition available"; the single-wording invariant of the plan. |
| Rollback | `VersionManagementService.rollback` + `POST /api/form-release/forms/:formCode/rollback`: goes through `activate`, so the same certification, acceptance gate and protocol apply (an edition USCIS does not accept can never be restored); needs a retired, certified edition whose mapping version is still stored; **cases are not moved back**, the case forms on the replaced edition are listed for reconciliation. |
| Case migration safety (Rule G) | `CaseFormEditionMigrationService` rewritten around `CaseFormMigrationRecovery` and the new `CaseFormMigrationSnapshot` collection: a checksummed **pre-image** of every answer record (values, provenance, attribution, reviews, overrides, status, lock, edition pointers) before anything changes; `migrationState` on the case form (snapshotted -> saved -> autofilled -> verified -> completed); **collisions detected before writing** (different values on one target = unresolved, blocks only that case; equal values merge with a recorded reason); a user-sourced `false` is a real answer; provenance and review metadata travel with the value; **database read-back verification** replaces the circular `carried + archived == total`; **safe recovery**: restore from the pre-image only when the current state equals the migration's own expected intermediate state, otherwise `reconciliation_required` with the snapshot kept (no expiry) and the conflicting fields listed; compare-and-set before each save; idempotent restore; `reconcileIncompleteMigrations` resumes a case form interrupted at any step; `planMigration` / `frozenReconciliationReport` are the no-write dry run. Snapshots expire 90 days after a VERIFIED migration and never while unresolved / failed / waiting / on legal hold. |
| API | `/api/form-release`: `GET /templates/:id/gate`, `GET /forms/:formCode/migration-plan`, `POST /forms/:formCode/rollback`, `POST /reconcile`, `GET /migration-snapshots?caseFormId=` (metadata only, never the answers), `POST /migration-snapshots/:id/restore` (dry run unless told otherwise). Snapshot routes are exactly `admin`; rollback / reconcile `admin` and `super_admin`; gate and plan also `team_lead`. |
| Schema | `USCISFormTemplate.lifecycle`: `promotionIntent`, `retiredWhy`, `certificationOverride` declared (the schema is strict: **Phase 0's `certificationOverride` had been silently dropped on save** - it was still in the audit log - and now persists). `CaseForm.migrationState` (optional, small). |
| Indexes (real database, index-only, run with your standing permission for index scripts) | `scripts/createFormReleaseIndexes.js --apply`: all indexes of `caseformmigrationsnapshots` (new, empty; the TTL index on `expiresAt`) and only `caseforms { "migrationState.step": 1 }` (sparse). |

## 3. How safety was kept
- **Calibrated on live data first** (the Phase 2 lesson): both new checks were run read-only over all 34 live edition graphs (26 have mapped boxes) before being made critical. party_markers: 0 findings (775 mapped boxes actually party-checked). widget_inputs (1,318 boxes checked): the first run showed 55 findings, all noise from the sample client's placeholder answer and from my own dropdown test not using the renderer's matcher; after fixing both, **0 findings**. So no live form fails a new critical check and no edition is blocked by calibration noise.
- **Existing editions are untouched**: certification only runs on import / promotion / re-certification; a stored certification that lacks the two new checks is not a failure.
- **The edition-acceptance gate is unchanged** and still the last word; the ReleaseGate reaches it only through a read-only `peekAcceptance` on the enforcer (a test keeps the pipeline importing the enforcer only).
- **Nothing can make an edition live except `VersionManagementService`**, which already calls the gate (a static test asserts the release module only reads).
- **Recovery never overwrites a newer edit and never activates an edition the gate refuses.**
- All DB-backed tests ran on a throwaway local database (never the shared one); nothing was created in any case.

## 4. Verification
| Check | Result |
|---|---|
| New tests | markerCertification 10, releaseGate 9, routes/wiring 5, **promotion / reconcile / rollback on a local database 6**, migration safety (pure 12, local database 15), updated activation tests 5 |
| Combined run (release, edition policy, pipeline, lifecycle, migration, contract, rewire, I-131, golden, scripts) | **407 tests: 402 pass, 4 skipped (they need real I-140 / I-864 / I-485 templates in the local test database), 1 fail** |
| The 1 failure | the gate-matrix test still lists the old 2026-10-16 `scripts/repairLegacyMappingFindings.js` (it activates a MAPPING version, not an edition). Unchanged since Phase 2; you chose not to touch it. Nothing of Phase 3 is in that list. |
| Backend | restarted by itself on every edit and answers `/api/health` |
| Calibration (read-only, all live forms) | party_markers 0, widget_inputs 0 |
| Not run | the Admin / Client / Landing / Attorney builds (no frontend file changed); no benchmark on the shared database |

### Checks per entry point (Rule I table)
| Entry point | Preconditions + certification (ReleaseGate) | Acceptance gate | Edition diff | Protocol |
|---|---|---|---|---|
| `VersionManagementService.activate` (lifecycle route, import route, pipeline promote, registry console) | yes | `requireAcceptedEdition` | via mapping activation | new live -> confirm -> retire old, intent saved |
| Rollback | same (it calls activate) | same | same | same; cases not moved |
| Promotion reconciler | n/a (finishes / reverts) | re-run on the candidate | n/a | decides from the latest verified policy |
| `migrateCaseFormsToEdition` | n/a | `requireAcceptedEdition` first | n/a | pre-image, verify, safe recovery |
| Importer `activateVersion`, `importLocalForm`, 11 seeds, `replaceFormEdition` | unchanged from Phase 0 | `requireAcceptedEdition` | unchanged | unchanged |

## 5. Expected vs actual
| Item | Plan | Actual |
|---|---|---|
| Certification markers rendered into the PDF and reopened | "resolved in memory via MappingResolver -> rendered -> reopened" | Resolved in memory through the real mapper; the existing `fill_roundtrip` still renders and reopens the PDF. The markers themselves are not written into the PDF. |
| Coverage of the party check | every field | Judged only where a box names one side AND the mapped path has a party root (petitioner / beneficiary / company / checklist keys). Forms whose edges read person.* / contact.* (I-90, I-765, I-485 and parts of others) make no party claim, so they are observed 0 times by this check and rely on the contract's text check. |
| Unified ReleaseGate "replaces the individual checks" | one gate | One structured decision used by activation for preconditions + certification; acceptance and the edition diff keep their existing enforcement points (asked once, no weakening). |
| Concrete repair strategies | with certification | **Not built** (see 7). |

## 6. Findings for your review
1. **Phase 0's certification-override record never reached the template** (strict schema); fixed. Overrides were always audited in the audit log.
2. **The party check cannot see person.* / contact.* forms** (above). Moving those forms to the generic petitioner / beneficiary paths would bring them into the check.
3. **Activation now has a short window with two live editions** of one form (new first, old retired a moment later); readers always take the newest, so cases see the new one. A rollback to an older edition shows the newer one for that moment only.
4. **Frozen-report priority flag**: `frozenReconciliationReport` marks a frozen case "priority" only when the caller supplies `deps.oldEditionNotAccepted` (the enforcer has no read-only "is this edition refused" call beyond `peekAcceptance`, which the pipeline does not yet pass); until then it is `false`.
5. **A value counts as verified** when its review is approved / confirmed / verified or its attribution says so; a typed or verified value with no box on the new edition blocks that case form from migrating (other unmatched values are archived with a reason).
6. **Pre-image access is exactly `admin`** (assumption from the plan; no implicit super_admin or team_lead); retention is the plan's initial 90 days, subject to your organization's rules.

## 7. What was NOT done
Concrete repair strategies for certification failures (the repair framework has none registered); an Admin screen for the gate, the migration plan, rollback and pre-image restore (the API exists); the performance-budget measurement (needs an approved baseline run); `acquireForCase` through the job layer; Rule J; the PM2 worker / queued mode; Phases 4-6 (Gemini mapping, governance screens and e-mails, full regression).

## 8. Gate before the next phase
Your review of sections 5-7. Phase 4 (Gemini mapping) is unlocked on the golden-set side (signed off 2026-10-22, held-out form I-90) but still needs its own approval, the Gemini key / quota, and the pre-approved accuracy gate.

# Phase 4 - Gemini mapping (shadow-first) + the three items moved over from Phase 3

## 1. Scope and authorization
You said "implement phase 4 now" on 2026-10-22 and asked that Phase 3's "not done" list be included in it. Built in three parallel parts (engine, accuracy gate, Phase 3 leftovers). Real-database writes: two index-only runs (below) and the evaluation's job records; **no case, user or company was created**. The engine is OFF by default; the accuracy gate is CLOSED; nothing here can change a live mapping today.

## 2. What was built
| Item | Result |
|---|---|
| Gemini mapping engine | `modules/form-ai-mapping/`: `FORM_AI_MAPPING` = **off (default) | shadow | on** (`mode()`; anything invalid is off). Runs as a distinct `form_mapping` capability on the AI platform (budget gate, per-user rate limit, redaction, audit, job record; the question / master-data matcher is untouched). Input per box: PDF name, widget type, printed label, section / page, parent group, neighbour labels, repeated-field info, a slice of the live canonical registry (path, type, role, description, aliases) and the checklist questions' keys / labels / canonical paths - **never an answer, document or any person's data** (a test proves it; a box that looks like client data - SSN, e-mail, phone, long number - is never sent and goes to review). Labels are passed as delimited untrusted DATA. Missing label => review without calling the model. Batches of 20, two at a time, cache keyed by hash(edition checksum, box, registry version, questionnaire schema version, prompt version, model). |
| Strict output + independent validation | The model may only pick a path FROM the supplied registry with a reason code and the label words it relied on; hand-rolled schema validation, invented paths rejected. Every candidate is re-judged by code (`candidateValidator.js`): registry membership, type / transform compatibility, party ownership from the box's own label / section / name, section-label consistency, questionnaire coverage, repeating / conditional compatibility, conflicts with a live edge through MappingPolicy. The raw Gemini score is stored for audit and never decides. |
| Risk tiers (decision 3) | `auto_use` only for unambiguous low-risk TEXT mappings that pass every check; address blocks, checkbox / radio / dropdown, conditional, repeating, SSN / A-number and other-party fields stay `needs_review` unless corroborated by a trusted sibling-form mapping or a verified golden fixture; invalid ones `rejected`. |
| Modes | **shadow**: suggestions are computed and stored (`FormAiMappingSuggestion`, immutable rows), nothing touches any graph. **on**: additionally adds `auto_use` suggestions ONLY for boxes with no edge, ONLY when the accuracy gate is open, as a NEW mapping version of a pending, non-exclusive edition through the normal contract and activation gates (origin "ai", evidence aiValidated + tier). MappingPolicy: an `ai` edge may stay active only with `evidence.aiValidated === true` and `tier === "auto_use"`; every other `ai` edge is still downgraded to review. |
| Pipeline | One optional stage `ai_map` after the rule mapping, only when the mode is not off, errors logged and swallowed. Deterministic mapping and case creation never depend on Gemini. |
| Accuracy gate (decision 19) | `form-ai-mapping/accuracy/`: pure `evaluate()` against the signed golden set with the plan's PRE-APPROVED constants (an override can only make them stricter): zero critical role violations, zero data-integrity failures (an auto-used suggestion on a verified-blank, checkbox / radio / dropdown / date, conditional, repeating, SSN / A-number / passport or whole-address box), >= 300 verified auto-used text mappings, precision >= 99% (only counted with that sample), >= 3 forms per main family, every held-out form (I-90) evaluated, >= 25 verified fields per widget type per family. `AiMappingGate.isOpen` is **fail-closed**: open only when the latest append-only `AiMappingGateRecord` met every criterion and has not expired, the golden sign-off is current, the record was made against the same golden draft, prompt version and model, and the form's family was evaluated. The prompt version and model are asked from the engine's own provider, so the two can never disagree. |
| Evaluation script | `scripts/evaluateAiMapping.js`: offline and read-only by default (judges the stored shadow suggestions); `--record` stores a gate record; `--live` is the ONLY path that calls Gemini and needs explicit flags, the shadow / on mode and hard caps on boxes and estimated cost. |
| API | `GET /api/form-ai-mapping/status`, `GET /api/form-ai-mapping/suggestions` (read-only; super_admin, admin, team_lead). |
| Moved from Phase 3 (1) Repair strategies | `form-pipeline/repair/`: `renormalize_pdf` (re-normalize an unloadable stored PDF; verifies every field name is kept, stores under a new key, re-certifies, restores everything and deletes only its own object if the checks still fail; refuses live editions), `rediscover_components` (only when components_slice failed; a failed repair deletes the definitions it created), `clear_template_cache` (stale-cache symptoms only, changes nothing stored). **Never auto-repaired:** `mapping_valid`, `party_markers`, `widget_inputs`, held / lease-lost / promotion-busy / mapping-contract errors, unreviewed edition changes. Each repair is recorded with its verification. |
| (2) Admin screen | Form Governance > "Show Release Safety" (super_admin, admin, team_lead): the release-gate decision and every check in plain words, the case-form move preview and frozen list, Rollback (super_admin / admin; says cases are NOT moved back; reason required), "Run recovery check", and a pre-image panel (**exactly admin**; dry-run preview before a confirmed restore; shows counts and field paths, never the answers). |
| (3) Performance tooling | `scripts/perf/`: event-loop / heap meter, the plan's proposed tolerances as constants with a compare that cannot pass until you approve the final numbers, a DB-call counter with the "zero added hot-path DB calls" check, an import scan, and `baselineHttp.js` (dry run by default; `--apply` needs an explicit base URL, token and output file). **Nothing was measured** (see 7). |
| Indexes (real database, index-only) | `scripts/createAiMappingIndexes.js --apply`: `aimappinggaterecords` and `formaimappingsuggestions` (unique on templateId + targetFieldId + inputHash). |

## 3. How safety was kept
OFF by default, a closed gate, and shadow never writes to a graph. The gate fails closed on any error or missing information. The model's answer is untrusted: it can only choose from the registry, and code re-judges it. No client data can enter a prompt. The engine's failure (outage, quota, a retired model) only skips the stage - every box becomes "needs review" - which is exactly what happened in the live run below. All database-backed tests ran on the throwaway local database; Gemini was never called by a test.

## 4. Verification
| Check | Result |
|---|---|
| Engine tests (fake provider) | 44 (input and schema 6, engine 17, tiering / policy / apply 11, wiring 10) |
| Accuracy gate tests | 50 (evaluator 16, gate 11, script 7, local database 4, golden draft 12) |
| Repair tests / perf tests / Admin screen tests | 18 / 10 / 13 |
| Combined backend run (engine, gate, pipeline, release, edition policy, contract, migration, scripts, perf, AI infra) | **468 tests: 467 pass, 1 fail** - the same old 2026-10-16 `repairLegacyMappingFindings.js` line in the gate-matrix test (unchanged; nothing of Phases 3-4 is in it) |
| Admin | `npm run build` passes; full suite 225 of 226 on the worker's run (one renderer test failed under load and passes alone; not re-run in full) |
| Backend | restarted by itself on every edit, `/api/health` ok |

## 5. The live evaluation (honest result)
I ran the one real shadow evaluation on the held-out I-90 (capped at 160 boxes and $0.60). **Gemini never answered: all 10 batches failed** with `models/gemini-2.5-flash is no longer available to new users ... use models/gemini-3.8-flash`. The engine behaved as designed (182 boxes -> needs review, reason no_model_answer, nothing stored, no auto-use, nothing changed), so the run proves the failure path, not the AI's accuracy. **There is therefore no accuracy number yet and the gate stays closed.** Setting GEMINI_MODEL for one command had no effect because the model is read from the stored AI provider configuration; an in-process override of the registry also did not reach the call, and I stopped there rather than change your stored settings.

## 6. Findings for your review
1. **The configured Gemini model is retired for your key**, so every Gemini feature that uses it (this engine, and very likely passport / résumé reading in document intelligence) is failing right now. `Backend/.env` pins `GEMINI_MODEL` and the provider setting stored in the database holds the same name; the code's own default is the always-current alias `gemini-flash-latest`. Fix: change GEMINI_MODEL (to `gemini-flash-latest` or `gemini-3.8-flash`) and update the stored Gemini provider model, then re-run the evaluation. I did not change either.
2. **The gate cannot open yet even with a working model**: the signed golden set holds 267 verified text entries; the plan needs 300 verified auto-used text mappings and 3 evaluated forms in each main family. The answer key has to grow first.
3. **Path equality undercounts accuracy for legacy forms**: many live edges read legacy roots (person.* / contact.*), the model chooses generic roots (beneficiary.*); the evaluator compares paths, so a correct pick can look wrong until an equivalence table exists.
4. **The Phase 3 restore preview returns client answer values to the browser** (the Admin screen discards them); the route should stop sending them.
5. Autofill / mapping code reaches the pipeline and release modules at load time through the case lifecycle orchestrator (existing wiring); the perf import scan records the four known chains as a ratchet.

## 7. What was NOT done
Any accuracy measurement (blocked by finding 1); every performance baseline number (needs your approval for a run against the shared database: the runner's endpoint paths are my guess and the autofill-generate and case-creation endpoints are not in it yet); an Admin screen for AI mapping suggestions and the gate (API only); Phases 5 and 6 (governance screens and e-mails, full regression).

## 8. Gate before the next phase
Your decision on finding 1 (the model), then a live shadow run, then growth of the golden set. "on" mode stays unusable until the gate record says met.

## Phase 4 addendum (same day): model fixed, re-run, switch set, what the gate still needs

- **The retired model was only in the stored AI provider setting** (`aiproviderconfigs`, key gemini: `gemini-2.5-flash`); `.env` already said `gemini-flash-latest`. At your request the stored value was changed to `gemini-flash-latest` (the only write). The 14 "model no longer available" failures are gone.
- **Re-run on the held-out I-90 (182 boxes, 10 batches): only 2 batches completed** - the others failed with **"You exceeded your current quota ... plan and billing details" (5)**, "high demand" (1) and the 90-second timeout (2). That is the Gemini API account's plan / quota, not code. Where Gemini did answer (40 boxes) its picks matched the golden answer key exactly (12 of 13 with a candidate; the 13th chose the registry's synonym for the A-Number); every one was tiered needs_review (no auto_use), because the key's paths are legacy person.* / contact.* roots on which the party cannot be confirmed, and several boxes have no checklist source. The engine behaved as designed: quota failures only skip batches.
- **`FORM_AI_MAPPING=on` was set in `Backend/.env`** (restart the backend to pick it up). With the gate closed, "on" stores suggestions and applies nothing; it applies AI mappings only after an evaluation record meets the thresholds. While the Gemini quota is exhausted each import's `ai_map` stage spends its batch timeouts before giving up (it never fails the import).
- **What the gate needs to open** (no switch, by the plan's design): (1) a Gemini plan with enough quota; (2) live shadow runs over at least 3 forms in each of employment / family / single; (3) a bigger signed golden set - at least 300 VERIFIED auto-used text mappings and 25 verified fields per widget type per family (today 267 verified text entries in total); (4) the engine must actually auto-use that many boxes - it will do so only where the party can be confirmed, which means moving forms from the legacy person.* / contact.* paths to the generic petitioner / beneficiary paths first. Then `evaluateAiMapping.js --live ... --record` stores the record and the gate opens by itself, for 30 days per record.

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
| 2026-10-16 | Release 0b-2 | Automatic evidence from the official USCIS page (explicit statements only), `POST /auto-check`, fail-closed enforcer wired into 4 services, 11 seeds and the replace script, narrowed rescue, Admin screen now "Check now" (no manual entry), unique indexes created, read-only coverage dry run (8 of 31 editions auto-accept), 181 backend + 127 Admin tests | `Backend/src/modules/form-edition-policy/{filingEligibility,EditionPolicyEnforcer,EvidenceService}.js`, controller/routes, gated pipeline files, `tests/*`, `Admin/frontend/src/components/FormEditionEvidenceSection.jsx(+test)`, `services/api.js` |
| 2026-10-16 | Phase 0 remainder | Shared frozen-status module, activate certifies + drops cache, one retire, job locks on edition-upgrade/monitoring, delete refused while a job runs, safe end-to-end import script, AI jobs recovered from `processing`, outputSchema enforced, Gemini timeout; 267 tests | `form-mapping/config/caseFormFreeze.js`, `VersionManagementService.js`, `uscis-form.service.js`, `USCISEditionUpgradeJob.js`, `USCISMonitoringJob.js`, `utils/jobLock.js`, `form-registry.controller.js`, `scripts/verifyFormImportEndToEnd.js`, `modules/ai/outputSchema.js`, `ai-orchestration.service.js`, `gemini.service.js`, tests |
| 2026-10-16 | Test isolation + Phase 1 | Local throwaway-database test harness with guards; FormPipelineJob (one open job per form, lease + fence), job service, runner, worker (embedded or separate process), stage hooks in the existing pipeline, inline/queued entry modes, classified recovery, developer alerts, pipeline API; 327 tests | `test-utils/pipelineDb.js`, `models/FormPipelineJob.js`, `modules/form-pipeline/*`, `workers/formPipelineWorker.js`, `scripts/createFormPipelineIndexes.js`, `OnDemandFormAcquisitionService.js` (hooks), catalog sync / upgrade / admin fetch / mapping-save entry points, `email/templates/form-pipeline-alert.js`, `server.js`, `routes/index.js` |
| 2026-10-16 | Phase 2 | Mapping policy (origins, ranking, review-only suggestions, conflicts), projections filtered to active edges, contract validator (new edges enforced, legacy report-only), coverage report on the mapping version + route, default-value classes + committed snapshot + drift script, rename equivalence in edition carry-forward, registry metadata; calibrated on live data; 565 tests (1 unrelated scoring test fails) | `form-mapping/contract/*`, `MappingGraphService.js`, `FormMappingService.js`, `EditionMigrationService.js`, `PartyFieldMappingService.js`, `BiographicMappingService.js`, `FormCertificationService.js`, `CanonicalFieldRegistryService.js`, `mappingGraphRoutes.js`, `scripts/defaultValueReport.js`, `config/defaultValueSnapshot.json`, tests |
| 2026-10-16 | Phase 2 addendum | Legacy findings repaired live, scorer alias fix, golden set draft (424 plain-language entries) + reviewer API/models + sign-off, Admin screens (Import Progress, Golden Set Review, Mapping coverage), reviewer guide | `scripts/repairLegacyMappingFindings.js`, `scripts/buildGoldenSetDraft.js`, `form-mapping/golden/*`, `models/GoldenSet{Review,SignOff}.js`, `form-mapping/routes/goldenSetRoutes.js`, `routes/index.js`, `MappingGraphService.js`, `contract/MappingContractValidator.js`, `Admin/frontend/src/components/{FormPipelineJobsSection,GoldenSetReviewSection,MappingCoveragePanel}.jsx(+tests)`, `services/api.js`, `pages/FormGovernance*.jsx`, `docs/GOLDEN_SET_REVIEW_GUIDE.md`, `docs/golden-set/GOLDEN_SET_DRAFT.csv` |
| 2026-10-16 | Live form updates (socket only) | When a team member saves or changes a form, everyone who has it open is told over the socket and the screen re-reads it quietly (unsaved typing is kept). Event after the response, no form data in it, join re-checks access; no conflict blocking (last save still wins) | `Backend/src/modules/uscis-forms/caseFormLiveUpdates.js(+test)`, `uscis-form.routes.js` (1 line), `realtime.gateway.js` (join/leave + emit), `Admin/frontend/src/hooks/useCaseFormLiveUpdates.js(+test)`, `contexts/{Socket,Auth}Context.jsx` (optional hooks), `components/uscis/USCISFormRenderer.jsx` (+test) |
| 2026-10-16 | Delete-form fix | Deleting a form was refused whenever ANY recurring import job (autopilot / edition-upgrade / monitoring / catalog sync) held its lock, which is most of the day. Now only a pipeline job running for THAT form blocks it; the form's waiting (pending / blocked / held) jobs are removed on delete so nothing re-imports it | `Backend/src/modules/form-registry/form-registry.controller.js`, `uscis-lifecycle/tests/jobLocks.test.js` |
| 2026-10-22 | Phase 3 | Distinct-marker certification (party_markers, widget_inputs) + one CERT_CHECK_POLICY, unified ReleaseGate, activation protocol (new live before old retired, saved intent) with crash reconciliation, rollback, safe case migration (pre-image, read-back verification, safe recovery, sweeper, dry run), release API, recovery sweeps wired into the server, index script (run) | `Backend/src/modules/form-release/*`, `uscis-lifecycle/services/VersionManagementService.js`, `form-mapping/services/{FormCertificationService,CaseFormEditionMigrationService,CaseFormMigrationRecovery}.js`, `models/{CaseFormMigrationSnapshot,CaseForm,USCISFormTemplate}.js`, `form-edition-policy/EditionPolicyEnforcer.js` (read-only peek), `server.js`, `routes/index.js`, `scripts/createFormReleaseIndexes.js`, tests |
| 2026-10-22 | Phase 4 | Gemini mapping engine (FORM_AI_MAPPING off / shadow / on, form_mapping AI capability, strict validation, risk tiers, shadow store, ai_map stage), accuracy gate + evaluator + script (fail-closed, pre-approved thresholds), MappingPolicy ai_validated tier; repair strategies, Admin release-safety screen, performance tooling; indexes (run) | `Backend/src/modules/form-ai-mapping/*`, `models/{FormAiMappingSuggestion,AiMappingGateRecord,AIJob}.js`, `modules/ai/{ai-orchestration.service,prompt.defaults}.js`, `form-mapping/contract/MappingPolicy.js`, `form-pipeline/{repair/*,FormPipeline,FormPipelineRunner,pipeline.constants}.js`, `OnDemandFormAcquisitionService.js`, `scripts/{evaluateAiMapping,createAiMappingIndexes,perf/*}`, `Admin/frontend/src/components/FormRelease*.jsx`, tests |
| 2026-10-16 | Keep blank + golden-set reasons | Per-box "Keep blank" (a person decides a box stays empty: no canonical mapping, template default value ignored, not required, enforced on every save, inherited by rebuilds and carried into new editions, counted separately in coverage; Undo; mapping the box again clears it). Golden set "Wrong" now asks why + what to fill instead (or "should be blank"). Additive: with no kept-blank boxes nothing changes | `form-mapping/contract/keepBlank.js`, `MappingGraphService.js`, `FormMappingService.js`, `EditionMigrationService.js`, `ValidationService.js`, `uscis-form.service.js`, `MappingGraphController.js`, `mappingGraphRoutes.js`, `MappingContractValidator.js`, `MappingCoverageService.js`, `golden/GoldenSetService.js`, `models/GoldenSetReview.js`, `Admin/.../FormGovernanceDetail.jsx`, `GoldenSetReviewSection.jsx`, `services/api.js`, tests |
