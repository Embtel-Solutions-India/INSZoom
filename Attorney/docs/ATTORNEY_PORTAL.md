# Attorney Portal — Complete Reference

Written 2026-09-17. This is the current, authoritative description of the
Attorney Portal: what it is, everything it can do today, how it's built,
and the full history of decisions and fixes that got it here. Two older
documents (`attorney-portal-completion-report.md`, `attorney-portal-setup.md`)
cover the original build in more granular, phase-by-phase detail — this
file supersedes them as the day-to-day reference and folds in everything
that changed since.

---

## 1. What this is

A third, standalone frontend application (alongside **Immiglance**, the
client portal, and **INSZoom**, the internal staff CRM) for **external
counsel** — attorneys who need to review specific cases, exchange messages
with the case team, and work assigned tasks, without ever becoming a
managed internal staff account and without ever seeing client-facing
conversations.

| | |
|---|---|
| Directory | `Attorney/` (originally scaffolded as `attorney-portal/`, renamed to match the `Immiglance`/`INSZoom` capitalization convention) |
| Dev URL | `http://localhost:5174` |
| Backend | The same shared Node/Express/MongoDB backend the other two apps use (`Backend/`, port 7000) — no separate API, no separate database |
| Stack | React 18, Vite 5, React Router 6, Tailwind CSS 3, `lucide-react`, `firebase` (Cloud Messaging), `axios` |

An attorney account has **no authority over other accounts, no case
creation, no billing/payment access, and no ability to reach the general
client-facing conversation system.** Everything it can do is scoped to
cases it has been explicitly granted, by a Case Manager or Admin, from
INSZoom.

---

## 2. Everything it can do (current feature set)

### Authentication
- **Direct login** at `/login` — same email/password credentials as any
  other account; a non-attorney account is rejected client-side and
  server-side with "this portal is for attorneys only."
- **SSO from Immiglance** — an attorney who signs in at the Immiglance
  client-portal login page is redirected here automatically
  (`AuthGate.jsx`'s `isAttorney` branch), landing on `/auth/sso?token=...`
  and establishing a session with no second login.
- Access token in memory only, refresh token in an httpOnly cookie, one
  silent-refresh-then-redirect-to-login on a 401 — identical contract to
  the other two portals.

### Dashboard
Real counts, not placeholders: assigned case total, active case count,
unread-messages total, and the 5 most recently updated assigned cases with
their status and unread badge.

### My Cases
Every case with an active grant, sorted by last update, with client name,
visa type, status, the date access was granted, and an unread-messages
badge. Clicking a row opens the case.

### Case detail (`/cases/:caseId/...`)
Read-oriented tabs, each pulling from the exact same backend routes the
Case Manager's own case page uses (not a duplicate set of endpoints):

| Tab | Shows |
|---|---|
| Overview | Case number, client, visa type/category, stage, status, priority, receipt number, dates |
| Documents | Every document on the case, with download |
| USCIS Forms | Generated forms and their status |
| Petition | Petition package versions (view/download, no assemble/finalize) |
| USCIS Tracking | Filing/receipt/biometrics/interview timeline fields (read-only) |
| Feedback | The case-scoped review dialogue with the case manager — see "Messages" below; this tab is one of its two entry points |
| Timeline | The case's audit/event history |

**Not present, on purpose:** Payments (no billing access), Expert Letters
(a stub upstream that never loads real data anywhere), Strategy (an
eligibility-scoring view — removed as a deliberate product decision), Notes
(the general internal staff notes log — removed as redundant with
Feedback), and Questionnaire (a client-intake artifact, not case-review
material this role needs — `questionnaires:read` was removed from the
attorney's permission grant entirely, not just hidden in the UI).

### Messages / Feedback — the portal's real communication surface

One backend thread (`models/Feedback.js`), reached two ways:

- **`/messages`** (top-level nav) — lists every assigned case with its
  unread count; opening one goes to `/messages/:caseId`, a standalone page,
  for messaging across cases without being "inside" any one of them.
- **The Feedback tab** (`/cases/:caseId/feedback`) — the same thread,
  reached from inside a case you're already looking at. Sending from one
  entry point shows up immediately through the other — it's the same data,
  not two parallel systems.

- Threaded (reply-to-any-message), with per-recipient unread tracking.
- **File attachments** — the paperclip button attaches one or more files
  (any type/size accepted by the same upload pipeline documents already
  use), shown as removable chips before sending and as downloadable pills
  once sent.
- **Enter to send, Shift+Enter for a newline** — the standard chat-app
  convention.
- Real-time-ish: in-app notification bell + browser push (Firebase Cloud
  Messaging) fire the moment the other side replies, deep-linking straight
  back to the thread.
- **Staff-only, structurally** — this is *not* the same conversation system
  clients use. An attorney's message goes to the case's assigned Case
  Manager (or whichever attorney/staff member is the counterpart on a
  reply); a client can never be a participant, see it, or be notified about
  it. See §5.2 for exactly what this required reverting.

### Tasks
`/tasks` — every task assigned to this attorney (backend-scoped: the
`/tasks/my-tasks` route forces `assignedTo = req.user`), each showing its
linked case, priority, due date, and a status dropdown the attorney can
change themselves (their own task only — enforced server-side).

### Theming
Uses the **exact same design-token system** as Immiglance and INSZoom —
the same `src/index.css` (copied verbatim: HSL CSS variables for
background/foreground/primary/card/sidebar/etc., light+dark mode), the same
Tailwind config extending those variables, the same Satoshi/Cabinet
Grotesk/JetBrains Mono fonts loaded from Fontshare/Google Fonts, the same
`.card`/`.btn-primary`/`.btn-secondary`/`.input-field`/`.badge-*` component
classes, and the same sidebar+header shell shape as INSZoom's `Layout.jsx`.
Primary color is the shared navy blue (`hsl(217 68% 32%)`); background is
near-white. A dark-mode toggle in the header works exactly like INSZoom's.

### Push notifications
Firebase Cloud Messaging, not a generic Web Push implementation — this
portal reuses the exact mechanism (`firebase-messaging-sw.js`, `firebase/
messaging`'s `getToken`/`onMessage`) the other two portals already have
built and working, currently sharing INSZoom's Firebase Web App
registration (see §7 for the one manual step this still needs).

---

## 3. What a Case Manager/Admin sees in INSZoom

Two additions to `CRMCaseDetail.jsx` (the existing case-detail page — no
new INSZoom route was created):

1. **"Assigned Staff" card** — alongside the existing Case Manager
   assignment, shows any attorney(s) currently granted access, with a
   Revoke button. Granting is done through the page's existing "Assign
   Staff" modal (Role dropdown: Case Manager / Team Lead / **Attorney**),
   reusing the same flow rather than a separate UI.
2. **"Attorney Messages" panel** — appears only when the case actually has
   an active attorney grant. The staff-side view of the exact same thread
   the attorney sees in the portal: same reply-threading, same file
   attach/download, same Enter-to-send. A case manager here is talking
   *to* the attorney, never accidentally into the client's conversation.

---

## 4. Access control — how a grant actually works

One rule, enforced in exactly one place, reused everywhere:

> An attorney can see/act on a case **only if** `Case.attorneyAccess[]`
> contains an entry for them with `status: "active"`.

That single check (`caseService.hasActiveAttorneyAccess`) backs:
- `canAccessCase()` — used by every reused staff controller (case detail,
  documents, forms, questionnaires, timeline, the general Messages
  system's access checks).
- `applyCaseRoleFilter()` — every list/search query.
- `middleware/requireAttorneyAccess.js` — the `/api/attorney/*` route
  namespace specifically.

Granting is a Case Manager/Admin/Team Lead action:
`PATCH /api/cases/:caseId/attorney-access { attorneyId, action: "grant" }`.
It writes the grant, records an audit-log entry
(`attorney_access_granted`), and sends the attorney an email. Revoking
(`action: "revoke"`) flips the entry to `status: "revoked"` — kept for
history, not deleted — and access stops on the very next request; nothing
needs to be re-synced or expire.

`attorneyAccess` is deliberately a separate concept from `Case.
assignedAttorney` (the pre-existing "attorney of record" field the forms
pipeline reads for G-28 inclusion) — one is portal access, the other is a
forms/filing fact, and conflating them would have been wrong.

### Permission grant (role: `attorney`)

```
cases:read, clients:read, beneficiaries:read, companies:read,
documents:read, documents:create, document_intelligence:read,
notifications:*, dashboard:read, forms:read,
feedback:* (the Messages/Feedback backend), tasks:read, tasks:update
```

No `cases:create/update/delete`, no `users:*`, no `billing:*`/`payments:*`,
no `settings:*`, and — critically — **no `messages:*`** (see §5.2).

---

## 5. Decisions and fixes made along the way

### 5.1 Consolidating Notes + Feedback + Messages, then restoring Feedback as a tab

The portal originally had three separate, overlapping concepts stacked into
a case's tab bar: a read-only **Notes** tab (`Case.internalNotes`, a
general staff notes log), a **Feedback** tab (a purpose-built attorney↔case-
manager thread with reply-threading and notifications), and a **Messages**
tab (the pre-existing, client-inclusive Conversation system). First pass:
Notes was judged redundant with Feedback and removed outright; Feedback's
backend (already correct, already staff-only, already tested) became the
*only* messaging surface, rebranded as a **top-level-only "Messages" nav
item**, with the per-case tab removed entirely; and the general
client-inclusive Conversation system was removed from this portal
altogether rather than kept as a second, parallel channel.

Second pass, on further direction: the case-scoped **Feedback tab was
restored** alongside the top-level Messages hub — not as a separate system,
but as a second entry point into the exact same backend thread (confirmed
by test: a message sent from the tab appears immediately when the same
case is opened through `/messages`). Notes and Strategy stayed removed;
Questionnaire was separately removed as well (§5.6) — Feedback specifically
was the one the product direction wanted back as in-context, case-scoped
access, distinct from the cross-case Messages hub's purpose.

### 5.2 Reverting the attorney's access to the client-inclusive Messages system

Before the consolidation, the attorney portal briefly *did* reuse the
general Conversation/Message system (the same one INSZoom and Immiglance's
clients use) for its case-level "Messages" tab, on the reasoning that it
already had file-attachment support built in. Once the product decision
became "attorney talks to the team only, never the client," that access had
to be removed **at the backend**, not just hidden in the UI — an attorney
who could still call `POST /api/messages` directly would still be able to
post into the same thread a client reads, regardless of what the frontend
shows. So this was a real revert, not a cosmetic one:

- `message.routes.js`'s `messageRoles` — `attorney` removed.
- `permissions.registry.js`'s attorney grant — `messages:*` removed.
- `message.service.js`'s `canAccessConversation`/`buildConversationFilter`
  — the attorney-inclusion branches removed, back to staff-only.
- `Message.js`'s `sender` enum — `"attorney"` removed.

A dedicated check now exists in the backend verification script proving
the attorney gets a 403 from both `GET /api/messages` and
`POST /api/messages` — a permanent regression test for this boundary.

### 5.3 File attachments added to Feedback (now "Messages")

`models/Feedback.js` gained an `attachments[]` array (same field shape
`message.service.js`'s own attachment storage already uses); a small
`storeAttachments()` helper was added to `feedback.service.js` wrapping the
same `storage.service.js` every other upload feature uses (no new storage
mechanism); both the attorney-side and staff-side feedback routes gained
`upload.array("attachments", 5)` plus a scoped attachment-download route.

**Bug found and fixed via real Playwright testing, not just the API
script:** a browser-driven, file-only (no text) send returned a 500. The
service layer already allowed "text OR attachment," but the Mongoose
schema still declared `message: { required: true }` — an empty string
fails Mongoose's required check even though the business rule was already
satisfied. Fixed by making `message` schema-optional (default `""`) and
relying entirely on the service-layer guard for the actual "must have
something" rule. This was caught specifically *because* the browser test
exercised a file-only send that the Node-script verification never had
(every prior script test happened to include message text alongside a
file) — a concrete example of why real UI testing matters beyond
status-code checks.

### 5.4 Retheme

The portal originally shipped with an ad hoc teal/slate color scheme,
independently invented rather than matching the other two apps. Every
component was rewritten to use the shared `bg-primary`/`text-foreground`/
`.card`/`.btn-*` tokens instead of hardcoded Tailwind colors, and
`index.css`/`tailwind.config.js`/font `<link>` tags were copied from
INSZoom verbatim. Verified with a real Playwright check reading
`getComputedStyle` on the login page — confirmed `rgb(26, 69, 137)` (navy
blue) and `rgb(249, 250, 251)` (near-white), not the prior green/teal.

### 5.5 Real cross-portal test data

Three real, non-demo cases already in the system (B109 – Rajesh Kumar,
B110 – Wei Chen, B111 – Fatima Al-Sayed) were granted to
`attorney@immiglance.com` through the real `PATCH /attorney-access` API
(not written directly to MongoDB), so an actual back-and-forth between the
Attorney Portal and INSZoom can be exercised end-to-end by any staff
account, not just throwaway test fixtures.

---

## 6. Verification

### Backend — `Backend/src/scripts/verifyAttorneyPortal.js`

45 assertions against a live server and real database state (not mocks,
not status-code-only checks): grant→200→revoke→403 transitions, cross-
attorney isolation (a second attorney fixture denied a case granted only to
the first), the client-Messages-system lockout described in §5.2, real
multipart file upload/download with access control, notification deep-links
in both directions, unread-count correctness (a message never counts
against its own author), and audit-log/email-log side effects.

```bash
cd Backend
node src/scripts/e2eFixtures.js seed
node src/scripts/verifyAttorneyPortal.js
node src/scripts/e2eFixtures.js teardown
```

### Browser — `INSZoom/frontend/e2e/attorney-portal.spec.js`

5 real-Chromium Playwright specs covering direct login + role rejection,
scoped dashboard/case-list data, case-access isolation, the full Messages
round-trip (including a genuine Enter-key send and a genuine file upload
through `page.setInputFiles`), and the Documents/Forms tabs loading real
data.

```bash
cd INSZoom/frontend
npx playwright test e2e/attorney-portal.spec.js --project=desktop
```

Both suites currently pass in full (45/45, 5/5).

---

## 7. Running it / manual setup

```bash
cd Backend && npm run dev            # already running for the other portals
cd Attorney && npm install && npm run dev   # http://localhost:5174
```

Environment variables already applied — `Backend/.env`'s `CLIENT_URLS`
includes `http://localhost:5174` for CORS, plus `ATTORNEY_PORTAL_URL` for
the assignment-email link; `Attorney/.env*` has `VITE_API_URL`,
`VITE_ATTORNEY_PORTAL_URL`, and the shared `VITE_FIREBASE_*` values;
`Immiglance/Frontend/.env` has `VITE_ATTORNEY_PORTAL_URL` for the SSO
redirect.

**One remaining manual step**: the portal currently reuses INSZoom's
Firebase Web App registration for push. This works (FCM web push isn't
origin-locked the way Firebase Auth's authorized domains are), but a
dedicated Web App registration is cleaner long-term — that requires the
Firebase Console (cannot be done from code) and, if created, needs updating
in both `Attorney/.env*` and `Attorney/public/firebase-messaging-sw.js` by
hand (a service worker in `/public` never sees Vite's env pipeline).

---

## 8. Known limitations / deliberately out of scope

- No document **upload** UI in the portal yet (the attorney does hold
  `documents:create`; only download/view was built).
- No compound MongoDB index on `Case.attorneyAccess` — `Case.js` is
  already at MongoDB's 64-index-per-collection ceiling (a pre-existing,
  separate issue tracked in `Backend/docs/MONGODB_STARTUP_LOAD_FINDINGS.md`
  §6), so queries on this field are correct but unindexed. Fine at current
  case volumes; revisit alongside that broader index cleanup before scale.
- Case creation, user/team management, billing, and settings access:
  never in scope for this role, by design.
- Attorney-to-attorney messaging: not built (no product ask for it).
