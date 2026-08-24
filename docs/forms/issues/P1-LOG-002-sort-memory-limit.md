### [P1-LOG-002] `Sort exceeded memory limit of 33554432 bytes` in USCIS monitoring
- Date: 2026-08-20
- Area / file(s): `Backend/src/modules/uscis-lifecycle/services/USCISScannerService.js` (line 584),
  `Backend/src/modules/uscis-lifecycle/jobs/USCISMonitoringJob.js` (the scheduler that invokes it
  via `USCISScannerService.scanAll`)
- Category: invariant-risk / performance (DB, not forms-pipeline correctness)
- Symptom: per the corrected Phase 1 task's own problem description, a blocking in-memory
  `.sort()` on a large `USCISFormTemplate` result set exceeds MongoDB's default 32MB
  (33,554,432 byte) sort-memory limit. Not independently re-triggered via a live run this session
  (would require running the monitoring job against a populated DB and capturing the exact
  server-side error) — the following root cause was confirmed via static source-tracing, which
  fully explains why this specific query is the one that overflows.
- Reproduction: run `USCISScannerService.scanAll()` (or wait for the scheduled monitoring job -
  `startUSCISMonitoringJob()` in `USCISMonitoringJob.js:7-28`, default daily) against a DB with
  several `USCISFormTemplate` documents.
- Root cause: **confirmed by direct source read** —
  `USCISScannerService.js:584`: `USCISFormTemplate.find(match).sort({ formCode: 1, editionDate: -1, versionNumber: -1 }).lean()`
  with **no `.select()` projection** and **no supporting compound index** for
  `{formCode:1, editionDate:-1, versionNumber:-1}` (confirmed against
  `USCISFormTemplate.js`'s actual indexes: `{formCode:1, editionDate:-1, version:-1}` — note
  `version` not `versionNumber` — plus several `{formCode:1, status:1, ...}` variants and a text
  index; none covers this exact sort key combination). Two things compound: (1) this session
  independently measured a real `USCISFormTemplate` document (I-129) at **15.72MB**
  (see `docs/forms/PHASE1_RUN_JOURNAL.md`/`PHASE1_BASELINE.md`) — just 2-3 such documents alone
  exceed the 32MB sort buffer even before considering the smaller templates also in the
  collection; (2) with no index covering the sort, MongoDB cannot use an index-order scan and must
  materialize + sort full documents in memory. The task's own notes additionally point at the
  `aijobs`/`notifications`/`appointments` collections completing their finds in ~1s in the same
  log window (same class of issue as the earlier compound-index findings referenced elsewhere in
  this repo's history) — not traced further here, out of scope for a record-only ticket.
- Causing action: not investigated via `git blame`/`git log -S` this session.
- Impact: the USCIS monitoring job (form-edition change detection) can fail or degrade under this
  memory limit; does not affect the fill/mapping/generate path (this query is read-only reporting/
  change-detection, not on the render or fill path) — confirmed no golden-fixture PDF generation
  invariant is affected by this finding.
- Phase-1 handling: characterized-only, NOT fixed — this is a DB/perf concern, not a forms-pipeline
  authority/reconciliation concern, and is explicitly out of Phase 1's scope per the task spec's
  own framing ("roadmap Phase 8" / DB perf, not forms re-architecture).
- Status: open
- Planned fix phase: DB/perf roadmap (task spec references "Phase 8"). Fix approach: add an index
  matching the actual query's filter + sort key (`match` fields + `{formCode:1, editionDate:-1, versionNumber:-1}`),
  and/or add a `.select()` projection excluding `definition`/`formFields` (mirroring
  `TEMPLATE_RENDER_EXCLUDE` used elsewhere) so the sort operates on small projected documents
  instead of full ~15MB ones. **Explicitly do not fix this by adding `.allowDiskUse()`** — that
  hides the missing index rather than fixing the root cause, per the task spec's own guidance and
  consistent with this repo's documented lesson from the earlier Cases-503 investigation (larger
  timeouts/pools made things worse, not better — the fix is fewer/cheaper round trips, not a
  bigger buffer).
