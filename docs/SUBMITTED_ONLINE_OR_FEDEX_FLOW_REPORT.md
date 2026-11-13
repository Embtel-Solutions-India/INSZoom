# Moving a case to Submitted: "online" or "FedEx"

Date: 2026-11-13

## What the team now sees
When a case is moved to **Submitted** (Pipeline drag or the Update Stage button on the case page):
1. **How did you submit the case?** - two radio buttons, **Online** / **FedEx**, and **Continue** (disabled until one is chosen; nothing pre-selected).
2. **FedEx** -> the existing popup (FedEx tracking number + optional internal amount, "Add later"). Only the main button's wording changed: "Save tracking number" -> **"Save details"** (it saves both). Then the existing "tell the client?" popup, with the **original e-mail**.
3. **Online** -> a new popup **"Add the USCIS receipt number"** (one field, three letters + ten digits, e.g. IOE1234567890; **Add later** / **Continue**; a note that it can be added later in the case's USCIS Tracking tab, under USCIS Receipt Number). Then the **same** "tell the client?" popup (worded "submitted online").
4. The standalone **Add FedEx number** button is unchanged (goes straight to the FedEx popup).

## Where the data goes
- The receipt number is saved on the case's USCIS Tracking filing record - the **USCIS Receipt Number** field of the Tracking tab - with filing method "online", and on the case's receipt fields (`uscisReceiptNumber`, `uscisNumber`, `receiptTracking.receiptNumber`). It is saved quietly: no USCIS status change, timeline entry, e-mail or notification. The Tracking tab refreshes without a reload.
- Endpoint: `PUT /api/lifecycle/cases/:caseId/tracking/receipt { receiptNumber }` (same roles / permission as the FedEx one), audit-logged as `USCIS_RECEIPT_NUMBER_SET`. Invalid numbers are refused (400) and nothing is written.

## The new e-mail (new template + new trigger)
- Template **`case-submitted-online-client`** ("Case Submitted Online - Congratulations"): same wording as the FedEx e-mail, but "submitted **online**"; the FedEx section is replaced by a **USCIS receipt number** box that appears **only when a valid number is on file** (otherwise hidden).
- Registered like the FedEx ones: template map, client-only list, audience, trigger registry (Settings -> e-mail triggers) and policy text. Sent only when the team chooses "Send the client an e-mail"; never automatic.
- **Once per case across both versions:** if either the FedEx or the online e-mail was already sent, a second one is not sent.
- The FedEx e-mails (`case-submitted-client`, `case-fedex-number-client`) are **unchanged**.
- `POST /api/integrations/ghl/cases/:caseId/submitted-notice` takes an optional `method` (`online` | `fedex`); without it the behaviour is exactly the old one.

## Files
Backend: `integrations/ghl/ghlSubmittedNotice.js`, `ghl.controller.js`, `modules/immigration-lifecycle/{services/TrackingService.js, controllers/LifecycleController.js, routes/lifecycleRoutes.js}`, `modules/email/{email.service.js, emailPolicy.js, emailTriggers.registry.js, templates/case-submitted-online-client.js, templates/receiptSection.js}`.
Admin: `components/{SubmissionMethodModal, ReceiptNumberModal}.jsx` (new), `FedexNumberModal.jsx` (button wording), `SubmittedEmailChoiceModal.jsx` (method), `contexts/FedexPromptContext.jsx`, `pages/CRMCaseDetail.jsx` (refresh on receipt saved), `services/api.js`, `utils/uscisReceipt.js`.

## Tests
- Backend `submitted-online-notice.test.js` (6): online e-mail with / without receipt, FedEx unchanged, once per case across both versions, template wording, receipt validation + quiet save. Existing FedEx notice / tracking tests and the e-mail tests still pass.
- Admin `SubmissionMethodFlow.test.jsx` (5): the question first, Online path, Online "Add later", FedEx path, standalone Add FedEx number. Existing FedEx modal / pipeline tests (button text updated) pass. Admin build OK.
- Not run: a real stage move, a real e-mail, the live Pipeline page (no DB-backed / end-to-end tests).

## Notes
- **Receipt follow-up e-mail (same logic as FedEx):** a receipt number added **after** the online e-mail went out (in this popup's "Add later" path, or typed in the Tracking tab) is e-mailed on its own (`case-uscis-receipt-number-client`, new template + trigger) - but only if the client was already sent the online submitted e-mail, once per number, never for an employer matter or a case with no client login. If the team chose not to inform the client, nothing is ever sent.
- No new environment variables. Restart the backend and reload Admin.
