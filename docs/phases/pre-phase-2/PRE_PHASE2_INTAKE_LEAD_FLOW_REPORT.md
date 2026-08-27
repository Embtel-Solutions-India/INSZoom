# PRE-PHASE 2 INTAKE LEAD FLOW REPORT

## Status

Implementation was stopped before source changes because the mandatory read found discrepancies that contradict the requested implementation constraints.

## Pre-Implementation Read Summary

1. `Backend/src/modules/eligibility-quiz/quiz.service.js` has `submit(payload, req)`, which rejects logged-in users with existing cases, validates `visaPathway`, validates `criteriaAnswers`, recomputes score/recommendation server-side, optionally records disclaimer acceptance, and then calls `leadService.createQuizLead(...)`.
2. The quiz service passes `fullName`, `email`, `phone`, `visaPathway`, `source`, `utm`, `sessionId`, `profileAnswers`, normalized `criteriaAnswers`, `scoreResult`, `disclaimerAcceptedVersion`, `nextStep`, and `ipHash` into `createQuizLead()`.
3. `quiz.service.submit()` returns `{ tier, pathwayString, alternativePathways, evidenceStrength, nextStep, leadId, routing }` to the caller.
4. `Backend/src/modules/leads/lead.service.js` defines `createQuizLead(payload, req)`.
5. `createQuizLead()` writes `fullName`, `email`, `phone`, `visaPathway`, `source: payload.source || "public_quiz"`, `utm`, `profileAnswers`, `criteriaAnswers`, `scoreResult`, `disclaimerAcceptedVersion`, `ipHash`, and `userAgent` to the Lead document.
6. `createQuizLead()` also sends the quiz confirmation email, calls `notifyStaffOfLead(lead)`, tracks `lead.created`, starts fire-and-forget CRM sync, and returns the saved Lead document.
7. `Backend/src/models/Lead.js` has `source: { type: String, default: "" }`; there is no enum, so `"intake"` is already accepted and no source enum change is needed.
8. `Lead.js` does not define a `quizAnswers` field.
9. `Backend/src/modules/eligibility-quiz/quiz.routes.js` defines `POST /submit` with `publicQuizLimiter`, `optionalAuthenticate`, `submitRules`, `validate`, and `ctrl.submit`.
10. `Backend/src/modules/client-intake/client-intake.routes.js` defines `GET /me`, `PUT /me`, `POST /me/submit`, and `GET /cases/:caseId`; all are authenticated and role/permission gated.
11. `saveMyIntake` calls `intakeService.saveClientIntake(...)`; `submitMyIntake` calls `intakeService.submitClientIntake(...)`.
12. `saveClientIntake()` requires an active case, writes flattened intake fields plus `Client.intakeData`, updates `Client.intakeSubmission`, updates the active `Case`, writes timeline/audit data, and returns `buildIntakePayload(client, caseData, user)`.
13. `submitClientIntake()` requires an active case, validates intake completion, writes submitted/locked state to `Client`, updates the active `Case`, sends notification/automation, and returns `buildIntakePayload(client, caseData, user)`.
14. `submitClientIntake()` does not call `ensureCaseForCompletedClient` directly; the auto-case side effect was in `client.service.js:saveProfile`, not this intake module.
15. `BAIS/Frontend/src/Pages/Dashboard/Intake.jsx` currently sends final intake selection through `casesApi.create(buildCasePayloadFromIntake(...))`, which posts to `/api/cases`.
16. After the intake package is selected, `Intake.jsx` stores `bais_intake_selection`, stores `bais_active_case_id`, and redirects to `/dashboard`.
17. `Intake.jsx` does show a package-selection screen when `showResult` is true and `result` is computed.
18. `Intake.jsx` also navigates the `cos_extension_ead` service option directly to `/dashboard/filing-type`.
19. `BAIS/Frontend/src/Pages/Eligibility/EligibilityQuiz.jsx` submits to `eligibilityQuizApi.submit(payload)`, which posts to `/api/eligibility-quiz/submit`.
20. After public quiz submit, `EligibilityQuiz.jsx` redirects to `/eligibility/results/${res.data.leadId}` with `{ result, contact }` in navigation state. It does not redirect directly to `/consultation/book/${leadId}`.
21. `BAIS/Frontend/src/Pages/Eligibility/EligibilityResults.jsx` has the later button that navigates to `/consultation/book/${leadId || result.leadId}`.
22. `BAIS/Frontend/src/Pages/Consultation/BookConsultation.jsx` accepts optional `leadId` from `useParams()`, prefills contact only from `location.state?.contact`, and passes `leadId` to `consultationApi.book(...)`.
23. `BookConsultation.jsx` works without a `leadId`; it simply books without an associated lead id if none is present.
24. `Backend/src/modules/leads/lead.routes.js` currently only defines `POST /public`; there is no `POST /api/leads/from-intake`.
25. I found no existing endpoint that creates a Lead from an authenticated client's intake data.
26. `Backend/src/models/User.js` does not define a `leadId` field.

## Required Questions

1. Does the Lead model's `source` field currently accept `'intake'` as a value? If not, what are the current allowed values?

Yes. `source` is a plain string with `default: ""` and no enum, so it accepts `'intake'`. There are no current allowed enum values.

2. Does `leadService.createQuizLead()` accept a `source` parameter, or is `source` hardcoded inside it?

It accepts `source` through `payload.source`, but defaults to `"public_quiz"` when no source is provided.

3. After the public quiz submits, what exact URL does the frontend redirect to? Does it include the `leadId` in the URL?

It redirects to `/eligibility/results/${res.data.leadId}`. Yes, it includes the `leadId`.

4. After the intake questionnaire submits, what exact URL does the frontend redirect to? Does it create a case, show a package page, or do something else?

`Intake.jsx` first shows a package-selection screen when the questionnaire result is ready. After package selection, it calls `casesApi.create(...)`, stores `bais_active_case_id`, and redirects to `/dashboard`.

5. Does `submitClientIntake` call `ensureCaseForCompletedClient` directly, or does it happen via `client.service.js:saveProfile`?

`submitClientIntake` does not call `ensureCaseForCompletedClient` directly. The old auto-case path happened via `client.service.js:saveProfile`.

6. Is there an existing `POST /api/leads/from-intake` endpoint? If not, does any endpoint currently exist that creates a Lead from an authenticated client's intake data?

No. There is no `POST /api/leads/from-intake`, and I found no endpoint that creates a Lead from authenticated client intake data.

## Discrepancies / Blockers

| Discrepancy | Why it blocks implementation |
| --- | --- |
| The prompt says the public quiz redirects to Book Consultation, but `EligibilityQuiz.jsx` redirects to `/eligibility/results/:leadId`. | The requested target says intake should match the public quiz and also redirect to `/consultation/book/:leadId`. The current public quiz does not directly do that. |
| The requested endpoint must set `user.leadId = lead._id`, but `User.js` has no `leadId` schema field. | With the current Mongoose schema, assigning `user.leadId` would not be persisted. Adding the field would be a User model schema change, which is outside this prompt's allowed model changes. |
| The requested endpoint must store `intakeAnswers` in `lead.quizAnswers`, but `Lead.js` has no `quizAnswers` schema field. | Adding `quizAnswers` would be a Lead model schema change beyond adding `'intake'` to `source`; the prompt forbids other Lead model field changes. |
| `Lead.source` has no enum. | No source enum edit is needed; adding `'intake'` is not applicable. |

## Change Table

No implementation changes were made because the discrepancies above required stopping before source edits.

| File path | What was removed or added | Before state | After state |
| --- | --- | --- | --- |
| `PRE_PHASE2_INTAKE_LEAD_FLOW_REPORT.md` | Added blocker/read report. | File did not exist. | File documents mandatory read findings and stop reasons. |

## Verification Results

| Verification | Result | Observed |
| --- | --- | --- |
| 1. Log in as client and load `/dashboard/intake` | Skipped | Implementation was stopped before source edits due blocker discrepancies. |
| 2. Complete intake and confirm lead creation/redirect | Skipped | Implementation was stopped before source edits. |
| 3. Confirm no Case was created | Skipped | Implementation was stopped before source edits and no database-backed flow was run. |
| 4. Confirm authenticated User `leadId` is set | Skipped | `User.js` has no `leadId` field, so this cannot be implemented as requested without a forbidden schema change. |
| 5. Complete public quiz as anonymous visitor | Skipped | Public quiz source was read but not modified; no browser/backend verification was run because implementation stopped. |

## Public Quiz Regression Confirmation

No public quiz source files were modified. The existing public quiz behavior remains as read: `POST /api/eligibility-quiz/submit` creates a Lead through `createQuizLead()`, returns `leadId`, and the frontend redirects to `/eligibility/results/:leadId`.

## Case Creation Confirmation

No implementation changes were made and no verification flow was executed. Static read confirms the current `Intake.jsx` still contains the legacy `casesApi.create(...)` path because implementation was stopped before editing.

## Files Modified

1. `PRE_PHASE2_INTAKE_LEAD_FLOW_REPORT.md`

## Files Read

1. `Backend/src/modules/eligibility-quiz/quiz.service.js`
2. `Backend/src/modules/leads/lead.service.js`
3. `Backend/src/models/Lead.js`
4. `Backend/src/modules/eligibility-quiz/quiz.routes.js`
5. `Backend/src/modules/client-intake/client-intake.routes.js`
6. `Backend/src/modules/client-intake/client-intake.controller.js`
7. `Backend/src/modules/client-intake/client-intake.service.js`
8. `Backend/src/modules/leads/lead.routes.js`
9. `Backend/src/modules/leads/lead.controller.js`
10. `BAIS/Frontend/src/Pages/Dashboard/Intake.jsx`
11. `BAIS/Frontend/src/Pages/Eligibility/EligibilityQuiz.jsx`
12. `BAIS/Frontend/src/Pages/Consultation/BookConsultation.jsx`
13. `BAIS/Frontend/src/App.jsx`
14. `BAIS/Frontend/src/services/api.js`
15. `BAIS/Frontend/src/Pages/Eligibility/EligibilityResults.jsx`
16. `Backend/src/routes/index.js`
17. `Backend/src/models/User.js`
