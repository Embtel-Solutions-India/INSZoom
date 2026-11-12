# GoHighLevel sync: deletions, restore and "never give up" retries (Phase 1)

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

## Still to do (next phases, not started)
- **Phase 2:** faster inbound sync (the 30-second pass reads each opportunity with several sequential database calls and can take longer than 30 s), and **GHL webhooks** (zero events have ever arrived; set them up in GHL pointing at `/api/integrations/ghl/webhook` and set `GHL_WEBHOOK_PUBLIC_KEY`, `GHL_WEBHOOK_PUBLIC_URL` on the production server).
- **Phase 3:** a sync-health view and a "retry all" button; clearer card states (waiting for e-mail / deleted in GHL).
- Open item: **B456** (the employer matter with no e-mail) shows old failed "link employer" jobs; they no longer repeat. **B513-A**: its GHL card is gone, so with the new default it moves to the Recycle Bin after the confirmation; restoring it brings the card back in Submitted.

## Deploy
Restart the backend. No new env vars (optional: `GHL_DELETE_CASES_REMOVED_IN_GHL=false`, `RECYCLE_BIN_ENABLED`).
