# Petition review: attorney review, client review, Petition page, feedback

## What it does

1. **Case manager (Admin → case → Petition tab).** An uploaded petition is visible to the case team only. Right after an upload (and per petition afterwards) the case manager chooses:
   * **Attorney review** - every attorney with active access to the case is e-mailed (`petition-attorney-review`) and sees the petition in the Attorney Portal. The staff-only Feedback message the old single "Review by Attorney" button posted is still posted.
   * **Client review** - only the case's *petition audience* is e-mailed (`petition-client-review`) and sees the petition on the new **Petition** page of the Client Portal. Both can be sent, in any order, and sent again.
   A themed, centred confirmation names who will be e-mailed before anything is sent.
2. **Audience (client side).** single-person case -> that person; family case -> the petitioner (never the beneficiary); employer-employee case -> the employer only (never the employee). Resolved in `petitionAudience.js` from `caseStructure`, `employerUser`, `petitionerUser`, `user` and the parent case of a child case (legacy cases without a structure: an employer/petitioner on the case wins, otherwise the one client). The beneficiary, the employee, other clients and attorneys get a 404 for a petition outside their audience.
3. **Client Portal → Petition (sidebar).** Lists the petitions sent for the client's review. Each row: the petition name as the heading, **View**, **Download**, **Feedback**, and - in the same card - the latest 5 feedback messages (lightly highlighted, compact) with an unread badge; clicking them opens the whole conversation (Messages-style window). **View** opens the petition full-screen: the PDF takes 75% and a **Feedback** column (heading, messages, message box, Send) 25%; stacked on small screens. Close buttons are a cross.
4. **Feedback thread.** Between the audience and the case team only (attorneys are not in it); live in both portals (`petition:message`), Enter sends, a retried send is never posted twice, bell notification for the other end (no e-mail per message). The case manager sees the latest messages under each petition row in Admin and answers from the same conversation window (possible once the petition was sent to the client).
5. **Attorney Portal.** No UI change: its Petition tab reads through the Documents API, which is now gated (below). Its preview retries quietly.

## Access rules (the gate)

Before this feature the generic Documents API would have shown any petition upload to anyone with case access, including the client. `petition-review/petitionGate.js` now applies, to every list / open / download of a `petition_manual_upload` document:
* case team: always; attorney: once sent for attorney review (**petitions uploaded before this feature have no review record and stay visible to attorneys exactly as before**); everybody else: never through the Documents API (the Petition page has its own audience-checked endpoints). Fails closed for non-staff.

## Opening a big petition fast, and never an error for slowness

A 300+ page PDF used to be downloaded whole (storage read + decrypt + transfer) before anything showed, and the portals gave up after their request time limit.
* The viewer loads the PDF **by URL into the browser's own PDF viewer with byte ranges**, so page 1 appears while the rest loads (`GET /api/petition-review/stream/:token`, 206/416/304, ETag).
* The URL carries a **signed token** (`petitionViewToken.js`: one petition, one person, 1 hour) and **access is re-checked on every request** (released? audience? active account? role?).
* The server keeps the decrypted bytes of petitions in a bounded in-memory cache (`petitionBufferCache.js`, `PETITION_CACHE_MAX_MB` default 300, 0 = off; `PETITION_CACHE_TTL_MINUTES` default 30), reads them ahead when a petition is released, when a viewer link is created and when the View button is hovered.
* **Every document read is retried** with growing pauses (`DOCUMENT_READ_ATTEMPTS`, default 6) - storage hiccups never reach the person; a missing file is not retried.
* The viewer long-polls `GET /stream/:token/ready` (about 12 s per answer) and keeps asking by itself: the person sees "Opening your petition..." and never a timeout. Only a petition that is really gone, or ten minutes of trying, ends in a message with "Try again". Download uses the same prepared stream.
* Admin's petition viewer is full-screen: the PDF fills the screen, and the file name, Download and close (cross) are a small floating bar inside the PDF box.

## API (`/api/petition-review`)

Staff (case manager, team lead, admin, super admin, with access to the case): `GET /cases/:caseId`, `POST /cases/:caseId/documents/:documentId/attorney-review`, `POST /cases/:caseId/documents/:documentId/client-review`.
Client Portal: `GET /client/petitions`, `GET /client/petitions/:documentId/file[?download=1]`.
Viewer: `POST /documents/:documentId/view-link`, `GET /stream/:token/ready`, `GET /stream/:token[?download=1]` (token-authenticated; may be framed only by the portals' origins).
Thread: `GET|POST /documents/:documentId/messages`, `POST /documents/:documentId/messages/read`.

## Data

`petitionreviews` (one per petition document: `attorneyReview`, `clientReview` {sentAt, sentBy, note, count}) and `petitionfeedbackmessages` (caseId, documentId, authorId, side `client|staff`, body ≤ 4000, clientMessageId, readBy). Nothing existing is modified. A petition's review record is created at upload.

## E-mails (new template + trigger each)

`petition-client-review` (client-only: never copied to staff, never the beneficiary/employee) and `petition-attorney-review`, registered in `email.service.js`, `emailPolicy.js` and `emailTriggers.registry.js` (editable like the other triggers in Admin → Email Templates).

## Tests

Backend `src/modules/petition-review/tests/` (32): audience matrix, gate, release flows and who is e-mailed, listings, file access, feedback thread, HTTP layer, token, cache, retries, ranges, re-checked access. Client `Petition.test.jsx` (16), Admin `PetitionUploadPanel.test.jsx` (14).

## Rollback

Remove the `/petition-review` mount in `routes/index.js`, the two `petitionGate` hooks in `documents/document.service.js` + `document.controller.js` and the `ensureReview` line at upload; the Client route/nav item and the Admin panel changes can be reverted from git. The two collections can be dropped; no other data is touched.
