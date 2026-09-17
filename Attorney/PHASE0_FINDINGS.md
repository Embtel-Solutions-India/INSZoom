# Attorney Portal — Phase 0 Reconnaissance Findings

Real paths, real field names, real enum values — grepped/read directly from
the repo on 2026-09-17. Where a finding **contradicts** an assumption in the
implementation prompt, it's called out explicitly — the prompt's own D-gates
say "inspect first, no default," so those corrections are the point of this
document, not a deviation from it.

## 1. User model / role enum

`Backend/src/models/User.js:19` — `role: { type: String, enum: USER_ROLES,
default: "client", index: true }`. `USER_ROLES` comes from
`Backend/src/modules/authorization/roleHierarchy.js`:

```js
CANONICAL_ROLES = ["super_admin", "admin", "team_lead", "case_manager", "employer", "employee", "client", "beneficiary"]
LEGACY_ROLES = []
ROLE_HIERARCHY = { super_admin:0, admin:1, team_lead:2, case_manager:3, employer:4, employee:4, client:4, user:4, beneficiary:4 }
```

**D1 resolved: `attorney` does not exist.** Adding it: append to
`CANONICAL_ROLES` and give it a rank in `ROLE_HIERARCHY` (peer to
`employer`/`employee`/`client`/`beneficiary` at rank 4 — it has no authority
over other accounts, only over its own assigned cases).

## 2. Case model — existing attorney-adjacent fields

`Backend/src/models/Case.js:567` — `assignedAttorney: { type:
mongoose.Schema.Types.ObjectId, ref: "User", index: true }`, with a comment
(lines 560-566) explaining this is the **attorney of record for
form-generation purposes** ("already reads caseData.assignedAttorney to
decide G-28 inclusion and attorney presence in the merge context") — a
single, forms/filing-scoped reference, not an access-control list. There is
also `filingAttorney` (line 737, nested under
`immigrationLifecycle.tracking.filing`), same purpose, different lifecycle
stage.

**Neither is an access-control structure** (no `assignedBy`, no history, no
revocation, single value only — can't represent "these 3 attorneys currently
have portal access, this 4th one had access revoked last month"). Per
§5.2's own instruction to adapt an existing structure only if one actually
serves the need: **no existing structure serves this need** — proceeding
with the new `attorneyAccess[]` array as specified, kept explicitly distinct
from `assignedAttorney`/`filingAttorney` (documented via code comment on the
new field, so nobody later conflates "has portal access" with "is attorney
of record on the forms").

**Also confirmed independently (§6 of the just-completed MongoDB
investigation, same session): `Case.js` already has ~136 declared index
specs against MongoDB's 64-per-collection hard limit — the collection is
already at the ceiling.** The new `attorneyAccess[]` compound index
(§5.2 of this prompt) **cannot be added** until that pre-existing overflow
is resolved (tracked separately in
`Backend/docs/MONGODB_STARTUP_OPTIMIZATION.md` §9 as an unfixed follow-up).
This is a real `BLOCKER` for the index specifically, not for the field —
resolution below in §12.

## 3. Feedback model

**Does not exist.** No `Feedback` model, no `feedback` module, no feedback
routes anywhere in `Backend/src`. The closest existing analog is
`Case.js`'s embedded `internalNotes`/`externalNotes` arrays
(`internalNoteSchema`, `Case.js:41-66`: `author, note, isInternal, category,
visibility (team/private), pinned, mentions[], attachments[], editHistory[],
deletedAt/deletedBy`) — but this is a **general staff case-notes log**, not
a two-party (attorney ↔ case manager) structured dialogue with reply
threading, per-recipient unread state, or notification/push wiring. It has
none of `authorRole`, `parentFeedbackId`, or `readBy`.

**D2 resolved: build a new, dedicated `Feedback` model** (not a reuse of
`internalNotes` — conflating "general team notes" with "attorney/CM
feedback thread" would be building a second feature into a schema meant for
a different one). Fields, matching the prompt's own D2/§5.3 spec exactly
since nothing pre-exists to constrain the shape:
`caseId, authorId, authorRole, message, parentFeedbackId, readBy[{userId,
readAt}], createdAt`.

## 4. Auth middleware

`Backend/src/middleware/authenticate.js` — verifies the JWT
(`token.service.js`), attaches the full Mongoose user document (minus
password) to `req.user` (cache-aside via `config/redis.js`, extended
earlier this session with an in-process fallback — see
`MONGODB_STARTUP_OPTIMIZATION.md`). Two authorization middlewares layer on
top of it:

- `middleware/authorizeRoles.js` — `authorizeRoles(...roles)`, checks
  `hasRole(req.user, roles)` via `rbac.service.js`. Simple allow-list.
- `middleware/authorizePermissions.js` — `authorizePermissions(...perms)`,
  checks `hasPermission(req.user, permission)` for each `resource:action`
  string against `modules/authorization/permissions.registry.js`'s
  `ROLE_PERMISSIONS` map (wildcard `resource:*` supported).

Existing routes consistently use **both**: `authenticate` → optionally
`authorizeRoles(...)` → `authorizePermissions(...)`. The attorney routes
should follow the same convention rather than inventing a new middleware
shape — `requireAttorney` = `authorizeRoles("attorney")`, no need to
"wrap" `authenticate` itself (it's already always first in the chain
app-wide; there is no precedent anywhere in this codebase for a
route-specific middleware re-verifying the JWT).

## 5. JWT utility

`Backend/src/modules/auth/token.service.js`:
`generateAccessToken(user)`, `generateRefreshToken(user)`,
`verifyAccessToken(token)`, `verifyRefreshToken(token)`. No changes needed —
the attorney portal is a same-JWT-secret, same-issuer consumer, exactly like
INSZoom and Immiglance already are.

## 6. Email service

`Backend/src/modules/email/email.service.js` — `TEMPLATES` object (line 8)
maps a `templateKey` string to a template module; `sendEmail` (or
equivalent, called by feature code) looks it up at line 138. Templates live
one-per-file in `Backend/src/modules/email/templates/` (35 existing, e.g.
`case-manager-assigned.js`, `staff-invitation.js` — both good structural
models for the new `attorney-assignment.js` template). Registration is:
add the file, then add one line to the `TEMPLATES` map — exactly what §6.6
of the prompt already describes, confirmed correct.

## 7. EmailLog model

`Backend/src/models/EmailLog.js` — fields: `templateKey, to, cc[], subject,
status (queued/sent/failed/skipped), error, providerMessageId, attempts,
sentAt, caseId, userId, triggeredBy, data (Mixed), source (Immiglance/BAIS/
INSZoom/shared/system)`. The new email should log with `source: "shared"`
(it's triggered from a Case-Manager action in INSZoom but delivered to an
Attorney Portal user — doesn't cleanly belong to either existing app-scoped
value) and `templateKey: "attorney-assignment"`.

## 8. Notification service

`Backend/src/modules/notifications/notification.service.js` —
`createNotification(payload, actor, req)` is "the ONLY place in the app
that decides" delivery (per its own header comment), dispatching to
in-app + push channels internally. Also `createForRoles(roles, payload,
actor, req)` and `createFromEvent(eventName, context, actor, req)`. The
feedback creation flow should call `createNotification` directly (not
`createForRoles` — a feedback reply has exactly one recipient, the other
party in the thread).

## 9. Push notifications — **this is the prompt's biggest incorrect
assumption; corrected here**

**There is no raw Web Push / generic `sw.js` / `PushSubscription` model /
VAPID-via-`pushManager.subscribe()` anywhere in this codebase.** The actual,
fully-built system is **Firebase Cloud Messaging (FCM) for Web**:

- Backend: `Backend/src/modules/notifications/push.service.js` (FCM via
  `firebase-admin`, see `Backend/src/config/firebase-admin.js`), backed by
  `Backend/src/models/DeviceToken.js` (`userId, token, browser, platform,
  active, lastUsedAt`) via `device-token.service.js`. Called from
  `notification.service.js`'s `dispatchPushChannel`, never directly by
  feature code.
- Routes: `POST /api/notifications/register-device`, `DELETE
  /api/notifications/unregister-device`, `GET /api/notifications/devices` —
  all gated by `authorizePermissions("notifications:read"/"update")`, all
  in the existing `notification.routes.js` — **not** a new `/api/push/*`
  namespace.
- Frontend: `{INSZoom,Immiglance}/frontend/src/services/notificationService.js`
  — `firebase/app` + `firebase/messaging`, `getMessaging`/`getToken`/
  `onMessage`, config from `VITE_FIREBASE_*` env vars +
  `VITE_FIREBASE_VAPID_KEY` (confirmed present in `INSZoom/frontend/.env`).
  `registerServiceWorker()` registers `/firebase-messaging-sw.js`
  specifically (Firebase's SDK requires this exact filename at the origin
  root — not an arbitrary `sw.js`).
- Service worker: `{INSZoom,Immiglance}/frontend/public/firebase-messaging-sw.js`
  — `importScripts` the Firebase compat SDK, `firebase.initializeApp({...})`
  with the **public** web config (not a secret), `messaging.onBackgroundMessage`
  shows the notification, a `notificationclick` handler focuses/opens the
  right window using `event.notification.data.link`.
- Both existing frontends' `firebase-messaging-sw.js` point at the **same**
  Firebase project (`white-cedar-504623-u1`) but **different Web App
  registrations** within it (different `appId` per app — INSZoom's is
  `1:839144138598:web:6c21c955aff3aa003acaa7`).

**D3 resolved differently from how the prompt framed it**: there is no
generic service worker to "add a message handler branch to" — the correct,
codebase-consistent action is to **copy the existing
`firebase-messaging-sw.js` pattern** (not a raw `sw.js`) into
`attorney-portal/public/`, and copy `notificationService.js` verbatim (it is
already generic — nothing in it is INSZoom-specific). No `type:
'attorney_feedback'` branch is needed in the service worker itself — the
existing `onBackgroundMessage` handler already generically shows whatever
`notification.title`/`body` the backend sends and deep-links via
`data.link`, which is exactly what the existing `notification.service.js`
already populates per-notification-type. The "attorney_feedback" distinction
belongs in what `notification.service.js`'s caller passes as `link`
(`/cases/:caseId/feedback`), not in service-worker branching logic.

**Manual step still required (§12 below):** a new Firebase Web App
registration for the attorney portal is not something I can create from
code — it needs the Firebase Console. Reusing INSZoom's existing `appId`/
config for the attorney portal is technically workable (FCM web push is not
origin-locked the way Firebase Auth's authorized-domains list is) and is
the pragmatic default; a dedicated Web App registration is the cleaner
long-term choice but requires manual console action either way for the
`firebase-messaging-sw.js` file (nothing here can be verified end-to-end
against real FCM delivery without it — see §11 test scenario caveats).

## 10. S3 / document storage service

`Backend/src/modules/uploads/storage.service.js` — `storeBuffer`,
`storeImmutableBuffer`, `readBuffer`, `s3GetObject`/`s3PutObject`/
`s3HeadObject`, `objectExists`, `generateDocumentKey({caseId, userId,
originalName})`. Existing case-document download routes already call
through this (not duplicated by anything attorney-specific — the attorney
routes reuse the exact same controller functions, per §6.5 of the prompt).

## 11. CORS

`Backend/src/app.js:38-45` — `cors({ origin: env.clientOrigins, ... })`.
`env.clientOrigins` (`Backend/src/config/env.js:6`) reads
`CLIENT_URLS` (comma-separated) → falls back to `ALLOWED_ORIGINS` → falls
back to `CLIENT_URL` → falls back to a hardcoded dev default. **Simplest,
most consistent fix: append the attorney portal's dev/prod origins to the
existing `CLIENT_URLS` value**, not a new dedicated env var pair — this is
exactly "append to the existing origins array," done at the `.env` level
instead of the code level, matching how INSZoom/Immiglance's own origins
already got in there.

## 12. Route registration

`Backend/src/routes/index.js` — central mount point, one `router.use('/x',
xRoutes)` per module. New attorney routes mount here.

## 13. Existing Immiglance attorney view — **corrects the prompt's premise**

`Immiglance/Frontend/src/Pages/Auth/Login.jsx:20-29`: there is an "Attorney"
tab (`ROLE_TABS`), but the file's own comment says explicitly this is
**"Presentational-only entry hints — NOT an access decision... the
authenticated account's real role... is what decides the post-login
destination, never what the user clicked here."** Selecting it currently
just renders a static "Attorney portal — coming soon" message
(`Login.jsx:235-239`) — it doesn't authenticate differently or route
anywhere, because **no `attorney` role exists yet (§1)**, so nobody can
actually log in as one today.

The real routing authority is `Immiglance/Frontend/src/components/
AuthGate.jsx` — its own header comment: *"This is the ONLY component that
should make this routing decision."* It reads `sessionContext` (from
`GET /api/auth/session-context`, `Backend/src/modules/auth/
auth.controller.js`/`auth.routes.js:66`) and currently branches on
`STAFF_ROLES = ["super_admin","admin","team_lead","case_manager"]` (redirect
to `VITE_INSZOOM_URL`) vs `CLIENT_PORTAL_ROLES = ["client","user",
"employer","employee","beneficiary"]` (client portal flows). **`attorney`
is in neither list today**, so an attorney account, if one existed, would
currently fall through to the `!CLIENT_PORTAL_ROLES.includes(context.role)`
branch and see "Access unavailable" — not "lands inside the client portal"
as the prompt's Context section assumed.

**D4 resolved: this is new logic, not a fix to existing broken behavior.**
The correct, minimal, codebase-consistent change (mirroring the existing
`isStaff`/`useEffect` pattern exactly) is a new `isAttorney` branch in
`AuthGate.jsx`, redirecting to `import.meta.env.VITE_ATTORNEY_PORTAL_URL`,
placed before the `CLIENT_PORTAL_ROLES` check. The Login.jsx "coming soon"
copy should be updated once the portal is real, but the login form/flow
itself needs no change (confirmed by its own comment: whichever tab is
selected calls the same `login()` and the same backend — tab selection was
never wired to any backend behavior).

## 14. Existing case assignment pattern (to mirror for attorney grant/revoke)

Email templates `case-manager-assigned.js` / `case-manager-reassigned.js`
already exist for the case-manager-assignment flow — good structural models
for the new `attorney-assignment.js` template and for the shape of the
grant/revoke audit-log event names (`case_manager_assigned` →
`attorney_access_granted`/`attorney_access_revoked`, for consistency with
existing `AuditLog` event-naming).

## 15. Existing feedback routes

None (§3). New routes needed in full, mounted under the existing case
routes per §6.5-6.7 of the prompt.

## 16. Existing notification API paths

`Backend/src/modules/notifications/notification.routes.js`:
`GET /me`, `GET /unread-count`, `GET/PUT /preferences/me`, `PUT
/mark-all-read`, `PUT /mark-many-read`, `POST /register-device`, `DELETE
/unregister-device`, `GET /devices`, `GET /` (list), `GET /:id/history`, plus
admin-only analytics/template routes. All under `authorizePermissions
("notifications:read"/"notifications:update")` — `attorney` needs both
grants in `permissions.registry.js`.

## 17. Package scripts / scaffolding parity

- **INSZoom** (`INSZoom/frontend/package.json`): `dev`/`build` run custom
  `scripts/dev.mjs`/`scripts/build.mjs` (a hand-rolled Vite server via
  `scripts/vite-options.mjs` — `configFile: false`, port `3002`, proxies
  `/api` and `/socket.io` to `http://localhost:7000`). Deps include
  `firebase`, `axios`, `react-router-dom`, `lucide-react`, `tailwindcss`.
- **Immiglance** (`Immiglance/Frontend/package.json`): plain `"dev": "vite"`
  with an ordinary `vite.config.js` (React + Tailwind v4's `@tailwindcss/vite`
  plugin + a React Compiler babel preset), proxying the same two paths to
  the same backend port.
- **Attorney Portal**: simpler to scaffold as an ordinary `vite.config.js`
  (Immiglance's pattern, not INSZoom's hand-rolled server script — there is
  no reason to adopt INSZoom's custom script, it exists for reasons
  specific to that app not documented here and out of scope to investigate)
  with `server.port: 5174` and the same `/api` + `/socket.io` proxy block.
  No root-level workspace/monorepo tooling exists (`package.json` at the
  repo root is just a single stray dependency, not a workspace root) — each
  app manages its own `package.json` independently, so the new app follows
  the same standalone-directory convention.

## 18. Permissions registry shape (for granting `attorney` access)

`Backend/src/modules/authorization/permissions.registry.js` —
`RESOURCE_ACTIONS` (resource → allowed actions) + a `ROLE_PERMISSIONS` map
(role → array of `"resource:action"` strings, `"resource:*"` wildcard
supported). No `feedback` resource exists (§3) — adding one
(`feedback: ["create","read","update"]`) rather than overloading the
existing `messages` resource, which is a distinct, pre-existing
client-facing messaging feature. `attorney`'s permission set: `cases:read,
documents:read, document_intelligence:read, forms:read, questionnaires:read,
feedback:*, notifications:*, dashboard:read`. No `create`/`update`/`delete`
on `cases`, no `users:*`, no `billing:*`, no `settings:*` — matches §12
"Out of Scope" exactly (no case creation, no user management, no billing).

---

## Corrections to the prompt's stated assumptions (summary)

1. **§1 Context**: "the existing Immiglance Attorney view... currently lands
   attorneys inside the client portal" — not accurate. No attorney role
   exists yet; the Attorney login tab is a cosmetic placeholder
   ("coming soon") wired to nothing. This is new redirect logic, not a bugfix.
2. **§3 / D3 / §8.1**: "existing Web Push service worker," "PushSubscription
   model," VAPID via `pushManager.subscribe()" — the real system is Firebase
   Cloud Messaging end-to-end (`DeviceToken` model, `firebase-messaging-sw.js`,
   `firebase/messaging`'s `getToken`/`onMessage`). Building to the prompt's
   literal spec here would create a second, parallel, non-functional push
   system alongside the real one. Following the actual codebase instead.
3. **§5.2 / D-gate on Case attorney fields**: `assignedAttorney` exists but
   serves a different purpose (forms/G-28 attorney-of-record, not portal
   access) — not adaptable, proceeding with the new array as specified, kept
   clearly distinct.
4. **§9.2 "PushSubscription routes... if not already present"**: they are
   already present, under `/api/notifications/*`, not `/api/push/*`.
5. **The `Case` model cannot currently accept a new compound index** — it is
   already at MongoDB's 64-index ceiling (found independently this session).
   See §12 below for how this is handled without blocking the rest of the work.

## 12 (continued) — Resolution for the Case-model index ceiling

The new `attorneyAccess[]` array field will be added to `Case.js` regardless
(the *field* costs nothing extra toward the index limit by itself). Its
compound index (`{ 'attorneyAccess.attorneyId': 1, 'attorneyAccess.status':
1 }`) **will not be added to the schema's `.index()` declarations** in this
pass — attempting to `syncIndexes()` it would fail exactly like the other 75
already-missing indexes documented in
`Backend/docs/MONGODB_STARTUP_LOAD_FINDINGS.md` §6. Instead,
`GET /api/attorney/cases` is implemented as a query on `attorneyAccess.
attorneyId` + `attorneyAccess.status` **without** relying on a dedicated
index for correctness (MongoDB will collection-scan or use a
less-specific existing index) — correct but not optimal. This is
recorded as a follow-up in `docs/attorney-portal-completion-report.md`,
to be revisited together with the broader Case-model index cleanup
already tracked in the MongoDB optimization doc, rather than adding yet
another index to a model already over its hard limit.
