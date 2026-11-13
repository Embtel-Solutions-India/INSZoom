# GoHighLevel sync: deletions, restore, "never give up" retries (Phase 1), fast inbound sync (Phase 2), sync-health view (Phase 3)

Date: 2026-11-13

## The rules now
- **Deleted in GHL -> the case goes to the Recycle Bin here** (30 days), never a hard delete. Two-step as before: sync finds the card gone, flags the case, and after a confirmation delay (2 min) asks GHL again; only if still gone is the case moved to the bin. Now **on by default** (`GHL_DELETE_CASES_REMOVED_IN_GHL=false` switches it off); it is also off whenever the Recycle Bin itself is off (`RECYCLE_BIN_ENABLED=false`), so nothing is ever deleted without a way back.
- **Deleted here -> the case goes to the Recycle Bin AND its GHL card is deleted** (already so; now reliable, see "Bug fixed").
- **Restored from the Recycle Bin -> the card comes back.** A restored case queues one durable `restore_opportunity` job (`integrations/ghl/ghlRestore.js`) that recreates the card in the **same pipeline and same stage** it was deleted from, with the same name, contact, service type and money, and **re-links it to the same case** (the dead link is replaced). It is the old case revived: nothing is created as a new case or a new opportunity. If the old card is somehow still in GHL, it is kept and its pending delete cancelled. If the stored stage no longer exists, the card goes to the pipeline's first stage.
- **No duplicate import:** the recreated card carries the case's marker, and the 30-second sync / webhook now links a marker card to its case instead of importing a second case.

## Bug fixed on the way
When a case was moved to the Recycle Bin, the sweep also moved its queued "delete the GHL card" jobs and its case<->card link into the bin, so a slow GHL could leave the card behind and the next sync would **re-import it as a brand-new case**. Those two records now stay while the case is in the bin (`case-deletion.service.js`).

## Never give up (retries)
- Every error (timeout, 429, 5xx, bad request, missing contact...) goes back to pending with a capped backoff (10 s, 30 s, 2 min, 10 min, then every 30 min) **for as long as it takes**. Previously only transient errors retried, 8 times, then the card sat on "Failed to sync" forever.
- After 8 tries the card is flagged "needs attention" and admins are alerted **once per case per day** (it was one alert per failure: 148 alerts); the job keeps retrying.
- **A 404 on an existing card is checked against GHL itself.** If the card is really gone it is a deletion made in GHL (no retry loop): the case is flagged and follows the card into the bin. A 404 on a card that exists is retried.
- A 404 while **creating** an employee's card (the employer's GHL contact is gone) now **recreates the employer contact** from the employer's own details, repoints the link and retries. This fixed **B197-A and B197-B** (about 200 failed jobs each): both now have GHL cards (`case_onboarded`, synced).
- Creating a card no longer wrongly flags a case "deleted in GHL" (that stopped those cases from ever being planned again).
- **Less wasted work:** an employer matter that is already linked, or a case with no e-mail yet, no longer gets a new job every 5-minute sweep (about 91,000 discarded `link_employer` jobs had piled up).

## Files
`integrations/ghl/{ghlRestore.js (new), ghlDeletedInGhl.js, ghlOutboundService.js, ghlAuxOutbound.js, ghlCaseOutbound.js, ghlReconcileService.js}`, `models/GHLSyncJob.js`, `modules/cases/case-deletion.service.js`, `modules/recycle-bin/recycle-bin.service.js`; tests `ghl-retry-and-restore.test.js` (7, new), `ghl-delete-sync.test.js` (updated for the new default).

## Tests
GHL + recycle-bin + case-deletion suites: 180 pass; the 2 failures (`ghl-import-stage-rules`: "marking an imported case completed", "an individual case takes its GHL card's name") fail the same way without my changes (files untouched). Not run: a real delete -> bin -> restore round trip with GHL, webhook delivery.

## Phase 2 - fast and complete inbound sync (done)
- **The 30-second pass was taking 91 seconds** (266 database operations): three sequential round trips per opportunity even when nothing had changed (link lookup, case lookup, a "last synced" write), so passes overlapped and were skipped - which is why GHL additions and changes could look late or missing. Now one batch read per pipeline loads every linked case, and an opportunity that provably matches its case (same pipeline + stage, status, name, e-mail, money; nothing pending or flagged) costs nothing; their "last synced" stamp is a single write. Anything that differs still goes through the unchanged per-opportunity rules, so no sync rule is bypassed. **Measured on your data: 91 s / 266 ops -> 5 s / 11 ops.**
- Leftover links: 17 stale case<->card links (cases deleted, cards already gone) were re-checked every pass (a GHL call and two no-op writes each); they are now cleaned up once. 4 leftover GHL cards without a case ("Tmp GC-NVC" x3, "Tmp I90") are counted without queries. They are still in GHL: delete them in GHL, or tell me and I will remove them with the existing orphan-cleanup tooling.
- **Webhooks:** the server side is ready and configured (`GHL_WEBHOOK_PUBLIC_KEY` and `GHL_WEBHOOK_PUBLIC_URL` are set here) but **GHL has never delivered one event** (0 ever). That is a setting in GoHighLevel, not code: send Opportunity events (create / stage change / update / delete) to `https://<your server>/api/integrations/ghl/webhook`, and the production server must be reachable from the internet. Until then changes sync within ~30 s through the pass above. The new Sync health panel shows "Webhooks received (24 h)" and says what to do when it is 0.

## Phase 3 - sync-health view and clearer states (done)
- **Pipeline -> Integration -> "Sync health"** (admins): last pass (age and duration), webhooks received in 24 h, waiting / retrying jobs, cards in GHL without a case, and a list of every card that is not in sync with the reason and the next try time, a **Retry** per card and **Retry all now** (`GET /integrations/ghl/sync-health`, `POST /integrations/ghl/sync/retry-all`).
- **Cards (admins) now say why**: "Deleted in GHL" (the case is moving to the recycle bin), "Waiting for e-mail" (sent to GHL as soon as an e-mail exists), "Retrying" (with the error on hover), or "Failed to sync" after 8 tries (still retried). Retry now works on waiting jobs too.
- A card left red by an old failure goes back to "synced" once nothing is waiting for it (it used to stay red for good), and "needs attention" caused by something else (an unmapped visa, e.g. B523-A) is no longer shown as a sync problem.

## Files (phases 2-3)
`integrations/ghl/{ghlReconcileService.js, ghlHealthService.js (new), ghlSyncState.js (new), ghlBoardService.js, ghlOutboundService.js, ghl.controller.js, ghl.routes.js}`, `models/GHLIntegration.js`; Admin `components/pipeline/{SyncHealthSection.jsx (new), GhlStatusPanel.jsx, Card.jsx}`, `services/api.js`. Tests: `ghl-reconcile-fast-path.test.js` (3), `ghl-sync-health.test.js` (3), Admin `SyncHealth.test.jsx` (5).

## Tests (all phases)
GHL suite 180 pass (the same 2 failures that fail without my changes: `ghl-import-stage-rules`); Admin Pipeline + sync-health 26 pass; Admin build OK. Not run: a real GHL webhook delivery or a delete -> bin -> restore round trip.

## Deploy
Restart the backend. No new env vars (optional: `GHL_DELETE_CASES_REMOVED_IN_GHL=false`, `RECYCLE_BIN_ENABLED`).
