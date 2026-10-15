# Case manager "Request" on any checklist item (required for that case only)

Admin portal + Backend + Client portal. Extends the existing staff "Request information" flow (`modules/information-requests`); nothing existing was replaced.

## What the case manager gets
* On the case's checklist answers (Admin → case → each checklist panel: Employer, Employee, Business Plan, Supporting Documents, Petitioner, Beneficiary, Joint Sponsor, I-90, GC-NVC, I-907, any approved checklist) **every text answer and every document row**, answered or not, has a **Request** button.
* The button opens a centred popup: the case manager types the details the client should see (optional) and sends. The row then shows a chip - **Requested** (open) or **Received** (the client answered) - and the button becomes **Request again**.
* **Request again** re-sends the e-mail (with the updated note) - it never creates a second request. **Withdraw request** (in the same popup) ends the requirement; the client's answer, if any, is kept.
* If two people could own the checklist (e.g. two employees) the popup asks **Send to**.

## What happens on the client side
* The client is **e-mailed** (`additional-info-requested` - "Action required: please provide {item}") with the case manager's name, the item, the **details**, a line saying the item is **now required**, and a button to the portal. An in-app notification and push go with it.
* That one question becomes **required for this case only**: the portal shows it as Required with "Requested by your case manager: {details}" in its help text, it appears in the "still missing" list, and **Submit stays blocked until it is answered**. The shared questionnaire/template is never edited and no other case is affected.
* **Requested items come first, on the same page.** No extra page or step: on the step-by-step checklist the requested document is the FIRST item on the Documents step and the requested text item is the FIRST group on the Information step; on the single-page checklist they are the top section, above the reusable document baseline. They are not repeated further down, and each shows its "Requested" chip, the case manager's note and Required. Driven only by the per-case flag (`metadata.requestedByStaff`): the shared questionnaire is untouched and a case with no request looks exactly as before. Files: `utils/questionnaireEngine.js` (REQUESTED_SECTION_KEY), `hooks/useQuestionnaireAnswers.js`, `Pages/Dashboard/Documents.jsx`.
* A checklist that was already submitted is re-opened (`in_progress`) so the client can submit again. A Task "Provide: {item}" is created for the client and completed when they answer.
* When the client answers, the request becomes **Received** and the requesting case manager gets a "Requested information received" notification.

## How it works
* Record: a `Case.informationRequests[]` entry with `scope: "existing_question"`, `questionKey`, `responseId` (the one client's one checklist response) and `status` (`open` → `submitted`, or `closed` when withdrawn). Added fields in `models/Case.js`: `scope`, `responseId`.
* Required-ness (`information-requests/requested-fields.js`, pure): an `open/submitted/approved/rejected` request on that `responseId` makes `questionKey` required. `questionnaire.service.js` threads the set into every required check - `isQuestionRequired(question, answers, requestedKeys)`, completion, detailed progress, `assertSubmittable`, strict-submit checklists, `saveAnswers`, `listCaseChecklists`, and the questions returned by `getQuestionnaireForCase` (flagged `required: true`, `metadata.requestedByStaff`). Admin receives `requestedItems` in the same response.
* Safety: the lookup is by case id (no new collection scans); if it ever fails the save/submit proceeds as before (`requested_keys_lookup_failed` is logged). With no requests every code path behaves exactly as it did.
* The request is validated against the checklist the screen showed (`getQuestionnaireForCase`), so only a question really on that checklist can be requested. For a principal's shared roles (employer / business plan / supporting documents on an employee case) the request is stored on the principal case, where that response lives.

## API (staff only: super_admin, admin, team_lead, case_manager; `cases:update`)
| Method | Path | Body |
|---|---|---|
| POST | `/api/cases/:id/information-requests/item` | `{ questionKey, targetRole?, referenceId?, note?, recipientId?, dueDate? }` → `201` (new) / `200 {resent:true}`; `409 RECIPIENT_REQUIRED` with `recipients` when ambiguous |
| POST | `/api/cases/:id/information-requests/:requestId/cancel` | - |

## Files
Backend: `models/Case.js`, `modules/information-requests/{requested-fields.js (new), information-request.service.js, .controller.js, .routes.js}`, `modules/questionnaires/questionnaire.service.js`, `modules/email/templates/additional-info-requested.js` (adds the "now required" line only for item requests).
Admin: `components/ItemRequestControl.jsx` (new), `components/QuestionnaireAnswersPanel.jsx`, `hooks/useCaseQuestionnaire.js`, `services/api.js`, `pages/CRMCaseDetail.jsx` + `components/ApprovedChecklistPanel.jsx` (one prop each).
Client: `utils/questionnaireEngine.js` (a staff-requested question is required).
Tests: `information-requests/tests/item-request.test.js` (10), `Admin .../ItemRequestControl.test.jsx` (8).

## Not changed / limits
* The original "Request information" panel (a brand-new item added to an "Additional Requested Information" checklist) works as before.
* Repeating groups get the button on their heading; composite fields are requested as a whole.
* Withdrawing a request does not delete the client's answer.
* A request made from an employee's page for the employer's shared checklist lives on the principal case, so the Admin "Recent requests" list on the employee page does not list it; the row chip does.
* Not run: DB-backed integration tests. Manual pass recommended: Request a document → client gets the e-mail and sees it Required → Submit is blocked until uploaded → chip turns Received.
