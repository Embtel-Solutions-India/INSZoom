# GoHighLevel (GHL) integration

Two GHL pipelines ("Immigrant Documentation pipeline", "Non-Immigrant Documentation pipeline") are kept in sync with Immiglance. Every GHL opportunity is one case card on a drag-and-drop board. Everything runs in the backend (`Backend/src/integrations/ghl/`); the frontend never waits on GHL. With `GHL_ENABLED=false` nothing is scheduled and the app behaves exactly as before.

## Configuration (`Backend/.env`, never committed)

| Variable | Purpose |
|---|---|
| `GHL_ENABLED` | master switch |
| `GHL_API_TOKEN`, `GHL_LOCATION_ID` | Private Integration Token and location |
| `GHL_PIPELINE_IMMIGRANT_ID`, `GHL_PIPELINE_NON_IMMIGRANT_ID` | pipeline ids (looked up by name if unset) |
| `GHL_WEBHOOK_PUBLIC_KEY` | GHL's official Ed25519 public key (no Immiglance private key exists) |
| `GHL_WEBHOOK_PUBLIC_URL` | `https://<host>/api/integrations/ghl/webhooks` (what to register in GHL) |
| `GHL_IMPORT_SENDS_EMAILS` | `true` to email clients for cards created by sync/reconciliation (default off) |
| `GHL_WORKER_INTERVAL_MS` | event/job worker tick (default 5s) |
| `GHL_EMPLOYEE_SWEEP_MS` | employee-sync safety sweep (default 5 min) |
| `GHL_RECONCILE_MS` | reconciliation interval (default 30 s: a stage moved in GHL shows on the board within about half a minute) |
| `GHL_RECONCILE_PACE_MS` | optional pause between per-opportunity API calls (rate limits) |
| `GHL_RECONCILE_MISSING_CHECKS` | max "is it deleted in GHL?" lookups per run (default 50) |

## How data flows

**GHL to Immiglance**
1. *Webhook* `POST /api/integrations/ghl/webhooks` (public, raw body). The `X-GHL-Signature` Ed25519 signature is verified on the raw bytes before any parsing. Events are stored (idempotent by `webhookId`), answered 200, and processed by a worker with retries (`received, processing, processed, ignored, deferred, failed, dead`).
2. *Reconciliation* every `GHL_RECONCILE_MS` and on demand ("Reconcile now", admin): reads every opportunity of each pipeline, creates missing cards, applies stage differences by the same conflict rule as the webhook, and only **flags** opportunities that vanished from GHL (`deletedInGhl`, confirmed by a 404, never deleted). One failing pipeline is marked `degraded` and never blocks the other. This is also the only inbound path if webhooks are not delivered.

**Immiglance to GHL** (a queue, `GHLSyncJob`; atomic claim with lease, retries with backoff up to 8, stale-job check, per-card serialisation, admin alert on permanent failure; admins can retry a failed card from the board)
- Drag a card: stage update.
- Add Employee under a GHL-known employer: a new opportunity (marker `immiglance:<caseNumber>` makes retries and webhook echoes idempotent).
- Employee named: opportunity renamed "Employer, Employee". Removed: abandoned. Restored: reopened (only if Immiglance abandoned it; a status GHL set itself is never touched).

**Conflict rule:** an unresolved local move wins until it resolves; an older GHL change never overwrites a newer local one; echoes of our own writes are recognised and ignored. `Case.stage` (the immigration workflow stage) is never changed by a pipeline move.

## Case model

- One opportunity = one card. Identity is `locationId + opportunityId` in `GHLCaseLink` (the `cases` collection has no free index slots).
- **Individual visas:** one case. **Employer visas:** one employer matter (shared `EmployerProfile`) and one employee card per opportunity. **Family visas:** one case per opportunity (GHL contact = petitioner, beneficiary identified later); no child cases.
- The Service Type custom field maps to a visa through an editable table (`visaMapping`); an unmapped value stays "visa required" and nothing visa-driven runs.
- Employer matching: linked contact first, then exact email; anything ambiguous goes to Needs Attention.
- Mixed-visa employers and repeat petitioners are handled by core services (not GHL specific): each extra visa adds its own employer checklist as a draft for the case manager to approve; a petitioner's later family case is pre-filled from their earlier case.

## Operating it

- Admin Pipeline page: tabs per pipeline, status panel (Sync now, Reconcile now, mapping confirmation), failed cards show "Retry".
- Case managers see only their assigned cards; admins, super admins and team leads see all.
- Sync state shown to users: SYNCED / PENDING / FAILED (FAILED only to admins).
- **If GHL changes never arrive:** check the webhook is registered in GHL with `GHL_WEBHOOK_PUBLIC_URL`, the events (opportunity and contact create/update/stage/status) are ticked, and that the host is reachable from the internet (a local dev backend needs a tunnel). Reconciliation still picks changes up within about 30 seconds.
- **If Immiglance changes do not reach GHL:** only cards linked to a GHL opportunity queue jobs. Look at the card's sync state and the failed-job count in the status panel.

## Tests

`Backend/src/integrations/ghl/tests/` (unit) plus isolated-database scripts that mock GHL (each creates a throwaway database and drops it). Real GHL writes are never made by tests.
