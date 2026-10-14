# Employer read-only view of an invited employee, live progress, and "grant access again"

Applies to every employer-sponsored visa that uses the principal/employee case structure (`caseStructure: employer_employee`: H-1B, L-1A/B, O-1, TN, EB-1C, PERM, ... - any visa where an employer adds employees). Client portal (`Immiglance/Client`) + Backend. Admin and Attorney portals are unchanged.

## What the employer gets

| Need | Behaviour |
|---|---|
| See an invited employee's progress | The employee's card on the employer's **Employees** dashboard shows two separate, exact bars - **Documents** (uploads) and **Information** (typed answers) - e.g. `56% · 5 of 9`. Both come from the server (`answered / visible questions`), never estimated in the browser. The card refreshes every 30 s. |
| See what they filled in | **"View what {name} filled in - READ ONLY"** opens the employee's own Documents → Information → Review screens, with a prominent **Read only view** banner. Nothing is editable; no Save progress / Submit; uploaded documents can be opened (**View**). The screen re-reads the file every 20 s, so the employee's *Save progress* and *Submit* appear without a reload. |
| Fill it in themselves | **"I'll fill this myself instead"** (banner, card, menu) withdraws the employee's access. Nothing the employee entered is lost; the same screen becomes editable. |
| Give it back to the same employee | **"Grant access to employee"** (in the employee's form) or **"Grant access to {name} again"** (on the card) opens a centred, themed popup. It **saves the employer's progress first**, then grants access. If the save fails, access is **not** granted. The employee sees everything the employer entered. |
| Employee is told | A new email, **"Employee Given Access Again"** (`employee-access-restored`), plus an in-app notification. An employee who never set a password gets the setup link inside it. |

## How it works

### Authorization - one narrow, read-only door
`Backend/src/modules/cases/employer-view-access.js`

* Inviting an employee hands the child case to the employee's account (`Case.user = employee`), so `canAccessCase()` **still denies the employer** - every write path (save answers, upload, remove file, submit) is unchanged and stays closed.
* `canReadInvitedEmployeeCase(user, childCase)` allows a **read** only when all hold: the user is the employer side (principal owner or delegate employer) of that child's own principal case; the child's `parentCase` is that principal; the child is an employee/beneficiary case; the file is currently held by the employee. Anything else (another employer, another employee, a different principal's child) is denied.
* It is consulted **only after `canAccessCase` said no** (no added cost for normal traffic) and **only** in three read paths of `questionnaire.service.js`:
  1. `getQuestionnaireForCase` - the response carries `readOnly: true, viewerMode: "employer_readonly"`.
  2. `listCaseChecklists` - the card progress.
  3. `readAnswerFile` - opening a stored document.
* The answers are read from the same `responseId` the employee writes to (response ids are pinned at hand-over - `pinChildResponseIds` - so employer, employee and Admin always see one data set).

### Accurate progress
`listCaseChecklists` now returns, per checklist, `progress` (all), `documentProgress` (upload questions) and the new `textProgress` (every visible, non-upload, non-layout question). Each has `answeredTotal`, `totalQuestions` and `percent` computed by `calculateDetailedProgress` - the same function the employer's own cards, the Admin portal and Submit use. Conditionally hidden questions are not counted.

### Grant access again
`POST /api/cases/:principalId/invite-employee` (and `PATCH /api/cases/:principalId/employees/:childCaseId/data-entry-mode` with `{ mode: "invite" }`):

* If the e-mail belongs to the **same employee** previously on this case (`child.clientEmail` matches and the account exists) the call is a *re-grant*: audit action `regrant_employee_access`, timeline event "Access granted again", the `employee-access-restored` e-mail and in-app notification instead of a first invitation, response field `regranted: true`.
* A first invitation behaves exactly as before.
* No data moves: the hand-over only changes the owner of the child case; answers belong to the case/response.

### Emails / triggers (new)
| Key | Audience | When |
|---|---|---|
| `employee-access-restored` | employee | Employer gives the same employee access again |

Registered in `email.service.js` (`TEMPLATES`, `TEMPLATE_AUDIENCE`), `emailTriggers.registry.js` (so admins can customise it on the Email Templates page), `emailPolicy.js` (`SEND_RULES`, `NEVER_THROTTLED` - a second grant is always sent). Template: `Backend/src/modules/email/templates/employee-access-restored.js`.

## Changed / added files

Backend
* `modules/cases/employer-view-access.js` (new)
* `modules/questionnaires/questionnaire.service.js` - read-only door in 3 read paths, `textProgress`
* `modules/cases/case.controller.js` - re-grant handling in `inviteEmployee`
* `modules/email/templates/employee-access-restored.js` (new), `email.service.js`, `emailTriggers.registry.js`, `emailPolicy.js`
* Tests: `modules/cases/tests/employer-view-access.test.js`, `modules/email/tests/employeeAccessRestored.test.js`

Client
* `components/questionnaire/GrantAccessModal.jsx` (new)
* `components/questionnaire/EmployeeDashboard.jsx` - live progress for invited cards, read-only entry, grant-again
* `components/questionnaire/PrincipalCaseWorkspace.jsx` - read-only mode, take-back, grant popup
* `components/questionnaire/EmployeePacketStepper.jsx` - Read only banner, View document, Grant access button
* `components/questionnaire/QuestionInput.jsx`, `components/checklist/EntryFileList.jsx` - optional **View** action
* `hooks/useCaseQuestionnaire.js`, `hooks/useQuestionnaireAnswers.js` - optional `pollMs`
* `services/api.js` - `questionnairesApi.viewAnswerFile`
* Tests: `EmployerEmployeeView.test.jsx`, `PrincipalCaseWorkspace.readonly.test.jsx`

## Not changed / limits
* The employer cannot edit, upload, remove or submit anything on an invited employee's file; Admin staff keep their existing full access.
* Live updates are polling-based (cards 30 s, open read-only view 20 s). No new socket events.
* The older single-case employer/employee flow (`EmployeeHandoffModal` in `Documents.jsx`) is untouched.
* Question/answer visibility respects the case manager's checklist approval gate exactly as for the employee.

## Verification
* Backend (DB-free): `employer-view-access.test.js` (5), `employeeAccessRestored.test.js` (4), email registry/link tests (25) pass.
* Client: `EmployerEmployeeView.test.jsx` (10) and `PrincipalCaseWorkspace.readonly.test.jsx` (5) pass; full Client suite and `vite build` pass.
* Not run: DB-backed integration tests (they write to the shared database). A manual pass is recommended: invite an employee, save progress as the employee, open the read-only view as the employer, take the file back, type something, grant access again, sign in as the employee.
