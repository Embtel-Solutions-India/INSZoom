# Invoices are now links (the GoHighLevel "Invoice URL")

Date: 2026-11-13

## What changed
The **Invoices** popup (opened from a case's Payment Summary on its Overview, from the employer's employee rows, and from the Payments page) **no longer uploads or lists invoice files.** It now lists invoice **links**:
- the **Invoice URL** of the case's GoHighLevel card, in **both** pipelines (field `opportunity.invoice_url`), read in automatically by the sync;
- any link the team adds in the popup (**Add invoice URL**: a text box and an Add button; each added link joins the list).
Each link opens in the browser's own tab (`target=_blank`, `noopener`); nothing is stored or proxied. With no link the popup says **"No invoice URL has been submitted currently."** Internal only: clients never see it (the data field is hidden from every payload unless asked for).

## How it syncs (both ways)
- **GHL -> here:** every sync pass (and webhook) reads the card's Invoice URL. A link added, replaced, removed or cleared in GHL follows within about 30 seconds (a link removed on the card is removed here too). Checked on your data: B470-A's QuickBooks link shows.
- **Here -> GHL:** every link added **or removed** in the popup is written to the card's Invoice URL - **all links, one per line** - by a durable job (`push_invoice_url`), retried like every other GHL change and sent again if the list changed while it was sending. Removing the last link empties the field. A change still on its way is never overwritten by the card's older value.
- **If GHL refuses several links in that field** (it is a single-link field; I could not test it - writing to a real card was blocked), the **newest** link is written to the card instead, remembered for that case, and the list here keeps them all. The first real add will show which applies.
- Every link can be removed here. A link added for a case that has no GHL card yet stays in its list and is not lost when the card changes.
- Validation: one valid http(s) link per entry, no spaces, up to 2000 characters, up to 50 per case, no duplicates; anything else is refused with a plain message.

## Old uploaded invoices - removed
The database holds **0** uploaded invoices (nothing to delete), and the **upload, file list, file view/download and file delete endpoints are removed** (`/api/case-invoices/...` now only has `employee-payments` and the link endpoints), so nothing can be uploaded again. The old `CaseInvoice` data model file is left only because the person-activity feed still reads it (it has no rows).

## Clients
Clients never see invoices: the client portal has no invoice screen, the endpoints are staff-only (super admin, admin, team lead, case manager), and the link list is stored in a field that is hidden from every case payload unless an internal screen asks for it.

## Files
Backend: `models/Case.js` (`invoiceLinks`, hidden by default), `models/GHLSyncJob.js`, `integrations/ghl/{ghlFinance.js, ghlReconcileService.js, ghlAuxOutbound.js, ghlOutboundService.js}`, `modules/case-invoices/{caseInvoice.service.js, caseInvoice.routes.js}` (`GET|POST|DELETE /api/case-invoices/:caseId/urls`; the file endpoints are gone). Admin: `components/CaseInvoices.jsx` (rewritten), its test.

## Tests
`ghl-invoice-url.test.js` (8) and `CaseInvoices.test.jsx` (5, rewritten); GHL suite 188 pass (the same 2 failures as before my changes); Admin build OK. Not run: adding a link against the live GHL card.

## Deploy
Restart the backend; reload Admin. No new environment variables.
