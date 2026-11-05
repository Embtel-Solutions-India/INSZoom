# Payment figures from GoHighLevel (2026-11-06)

All amounts are **US dollars** (never cents). The Admin portal's payment analytics now read only these figures; the Stripe payment records are no longer used for any analysis.

## Where the numbers come from (each case's GoHighLevel card)
| GoHighLevel field | Meaning | Stored on the case |
|---|---|---|
| **Value** (opportunity amount) | the company's own total fees (USCIS fees not included) | `finance.totalAmount` |
| **USCIS Fee** (custom field) | the USCIS fees (may also be paid to the company) | `finance.uscisFee` |
| **QB Amount Paid** (custom field) | what the client has paid, out of the Value | `finance.amountPaid` |
| QB Invoice No. (custom field) | QuickBooks invoice number | `finance.invoiceNo` |

Outstanding = Value - QB Amount Paid (never below 0). USCIS Fee is shown separately and is not added to Outstanding.

## Sync
- **Live:** every GoHighLevel opportunity update (webhook) records the figures, and the 30-second reconcile pass records them for every card, so a missed webhook is caught. A write happens only when a figure changed.
- **Backfill (done):** all 69 existing cards were read; the 2 that carry money were recorded (B498: total $100, USCIS $50, paid $90; B447-A: total $10,000).
- Each change clears the dashboard cache and sends a live `payment:updated` update to the Admin screens, so they refresh at once.
- Cards with no money on them leave their case without figures (counted as nothing).
- Stored apart from the `Payment` collection (the client portal's), so nothing a client sees or pays is touched.

## Where the Admin portal reads them
Dashboard cards (Total Revenue, Pending Payments), Analytics > Revenue and Payments tabs, **Payments Overview** (new table: one row per case, with total, USCIS fee, paid, outstanding, status, invoice), the Case Managers list / details / payments tab / analytics panel (Collected, Outstanding, Balance due), the financial report, company dashboards, and a **Payment Summary** card on each case's Overview. New endpoint: `GET /api/analytics/payments/cases`. `GET /analytics/payments|revenue|dashboard` keep their shape, now in dollars (they also return `total` and `uscisFees`).
Statuses: Paid (nothing left), Partially paid, Unpaid; a case whose Value is 0 is "no fee set".
Monthly "collected" is dated by when the paid amount last increased (the first sync dates historical payments at the card's last update).

## Clients see nothing
The figures are removed from every case response for a client, employer, employee, beneficiary or attorney (case.service `serializeCaseForUser`), and the analytics return zeros to client-side requesters. The existing client message ("Payments are handled outside the client portal…") is unchanged.

## Files
Backend: `integrations/ghl/ghlFinance.js` (new), `modules/finance/caseFinance.service.js` (new), `models/Case.js` (`finance`), `ghlWebhookService.js`, `ghlReconcileService.js`, `dashboard.service.js` + `dashboard.controller.js` + `analytics.routes.js`, `case-manager.controller.js`, `case-manager-analytics.service.js`, `reports/report.service.js`, `companies/company.service.js`, `cases/case.service.js`, tests `integrations/ghl/tests/ghl-finance.test.js`.
Admin: `PaymentsOverview.jsx` (rewritten), `Dashboard.jsx`, `Analytics.jsx`, `CaseManagerAnalyticsPanel.jsx`, `CaseManagerDetails.jsx`, `CRMCaseDetail.jsx`.

## Production
Restart the backend (new fields, hooks). Rebuild and deploy **Admin**. The same sync runs on production by itself; to load the existing cards there, run the backfill once (ask me) or wait: the 30-second reconcile fills every card within a minute. No new environment variable.

## Not changed
Stripe code, the client portal, the Payment collection and its endpoints (`GET /payments` etc.) are untouched; they are simply no longer used by the Admin analytics.
