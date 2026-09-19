# Client Authentication & Journey Flow

Landing page simplification, email-first client sign-in, and a backend-authoritative
client journey state machine. Admin, Attorney, and staff authentication are
unchanged by this work.

> **Superseded note (see Addendum at the end of this document):** sections
> 3–8 below describe the email-first login/signup UI as living in the
> Landing app. It has since moved to the Client app entirely — Landing now
> performs zero authentication and only redirects "Client Login" cross-
> origin. The UX/contract/security content in those sections is otherwise
> still accurate; only *which app renders the page* has changed. See the
> Addendum for the full detail and for an unrelated credential-leak fix
> made in the same follow-up pass.

## 1. Architecture before this change

- **Landing's `Login.jsx`** exposed a cosmetic `ROLE_TABS` selector
  (Client / Attorney / Team member). The tab was purely a frontend
  presentation choice — `roleTab` was never sent to the backend, and
  post-login routing was already decided entirely by role (`AuthGate.jsx`'s
  `isStaff`/`isAttorney` branches, `OAuthCallback.jsx`'s `STAFF_ROLES`
  check). The tab selector implied other portals existed to any visitor of
  the public landing page, which is what this change removes.
- Sign-in was a single-step `email + password` (or `caseId + password`)
  form — no way to give different feedback (invited-but-passwordless,
  Google-only, unknown email) before the user had already typed a password
  and gotten a generic failure.
- `Register.jsx` had a referral-code field. `GET /api/auth/session-context`
  returned only `{ hasCase, isLegacyNoCaseAccount, leadId, mustSetPassword,
  caseRole, ... }` — no notion of *why* a case-less client had no case yet.
  `AuthGate.jsx` could only route a case-less client to `/onboarding/intake`
  or `/legacy-holding`, regardless of whether they'd already completed the
  eligibility quiz, already booked a consultation, or had been rejected.
- `Lead` (the anonymous pre-signup entity created by the eligibility quiz)
  had no relationship to `User` at all. Completing the quiz and booking a
  consultation anonymously, then signing up afterward, produced a brand-new
  account with zero memory of that history — the client always restarted at
  intake.

## 2. New architecture

Three independent, additive changes:

1. **Landing UI**: `Login.jsx`/`Register.jsx` now present client-only UI.
   Sign-in is an email-first two-step flow. No code path on Landing
   references Admin/Attorney/staff login.
2. **Anonymous Lead → account linking**: `registerClient` now looks up a
   pre-existing, unclaimed `Lead` (by `sessionId` first, email as fallback)
   and sets the new `User.leadId` to it, so quiz/consultation history
   carries into the new account instead of being orphaned.
3. **Backend-authoritative journey state**: `GET /api/auth/session-context`
   derives a `journeyState` field from the linked `Lead.status`, and
   `AuthGate.jsx` (the client portal's single routing authority) uses it to
   send a case-less client to the right screen — resume booking, show a
   waiting-for-approval page, or show a distinct rejection message — instead
   of always falling through to the intake questionnaire.

None of this touches Admin, Attorney, or staff authentication, which remain
on their own login pages and their own already-independent routes to
`/auth/login`.

## 3. Entry flow (Landing page)

The landing page and `Login.jsx` show **only** a Client Login path: a Google
button, an email-first form, and a secondary Case ID login option. There is
no role selector, no "For Professionals" section, and no link to Admin or
Attorney anywhere in this flow — confirmed by grep across
`Immiglance/Landing/src/Pages/Auth` for `roleTab`/`ROLE_TABS`/staff-facing
copy; none remain.

Admin (`Admin/frontend/src/pages/Login.jsx`) and Attorney
(`Attorney/src/auth/LoginPage.jsx`) already have their own login pages on
their own origins/ports and were never reachable through Landing — no change
was needed for staff/attorney access, since it never ran through the tab
selector to begin with.

## 4. Signup flow

`Register.jsx`:
- No referral code field (the backend's `applyReferralOnSignup`/
  `generateUniqueReferralCode` are untouched and still available to any other
  caller — they're simply no longer invoked from this form).
- First Name / Last Name (joined into one string at submit) instead of a
  single Full Name field.
- Reads the anonymous eligibility-quiz `sessionId`
  (`utils/eligibilitySession.js`'s `getSessionId()` — `sessionStorage`-backed,
  survives reloads/navigation in the same tab, cleared on tab close) and
  passes it to `signup()` → `authApi.register()` as an additional, always-
  optional field.

Backend (`auth.service.js`'s `registerClient`):
- Accepts `sessionId` in the payload (validated as an optional, `≤200`-char
  string in `auth.routes.js`; never trusted as an identity claim — a stale
  or unrecognized `sessionId` is simply a no-op lookup).
- After creating the `Client`/`User`, calls `findLinkableLead(sessionId,
  email)`:
  - Looks up an unclaimed `Lead` by `sessionId` first.
  - Falls back to an email match only if the `sessionId` lookup found
    nothing (covers a quiz-then-close-tab-then-signup-later-in-a-new-tab
    visitor, who has no surviving `sessionId`).
  - Guards against double-linking: before linking, confirms no other `User`
    already has `leadId` pointing at that `Lead`.
  - If found, sets `newUser.leadId = lead._id` — reusing the existing
    `User.leadId` field (the same one `createLeadFromIntake` already sets
    for the logged-in intake flow); no schema change.

## 5. Email-first login flow

`Login.jsx`'s email-first path (`loginMethod === "email"`):

1. **Step "enter"**: Google button + email input + Continue. Continue calls
   `POST /auth/check-email`.
   - `exists: false` → "We couldn't find an account with this email" +
     link to signup.
   - `pendingInvite: true` → the existing invited-but-passwordless UI
     (resend-invite button), shown here instead of only after a failed
     login attempt.
   - `exists: true, hasPassword: false, pendingInvite: false` (Google-only
     account) → "This account signs in with Google — use the button above",
     never a wrong "incorrect password" message.
   - `hasPassword: true` → advance to step "password".
   - `check-email` request failure (network error, etc.) → falls through
     directly to step "password" rather than blocking the user; the real
     `/auth/login` call is the actual source of truth regardless.
2. **Step "password"**: email shown read-only (with a "Change" link back to
   step "enter"), password field, Sign In, forgot-password link — the
   pre-existing, unmodified `handleLogin` logic.

**Hard architectural rule**: `check-email` is a UX hint only. `POST
/auth/login` independently and fully validates the credential every time,
regardless of what `check-email` returned or whether it was called at all.
No frontend code treats `check-email`'s result as authorization.

## 6. Google auth flow

Unchanged. `loginWithGoogle()` → Firebase redirect/popup → Backend's existing
`authService.loginWithVerifiedIdentity` (email-only lookup, no password
check, no `authProvider`/`googleId` field). `OAuthCallback.jsx` still routes
staff straight to Admin and everyone else to `/dashboard`, where `AuthGate`
takes over — unaffected by any of this work, since it was already keyed
purely off role, never off `roleTab`.

The Google-vs-password edge case (a Google-only account attempting the
password step, or a password account trying Google) is handled entirely by
`check-email`'s `hasPassword` signal in the email-first flow (§5) — no
backend change to the Google login path itself was needed or made.

## 7. Assessment / consultation / case-creation flows

Unchanged in this pass. The eligibility quiz still creates a `Lead` (via
`lead.service.js`), consultation booking still transitions `Lead.status`
through `booked` → `consultation_scheduled` → `consultation_confirmed` →
`consultation_completed` → `approved`/`rejected`, and case creation is still
a separate staff-driven action. What's new is that `journeyState` now
*surfaces* this existing state machine to the frontend — no new states were
added to `Lead.status`, and no lead/consultation/case-creation logic was
modified.

## 8. Set-password / invite flow

Unchanged. `User.mustSetPassword` + `clientInvite.service.js`/
`employeeInvite.service.js`'s opaque, SHA-256-hashed, expiring,
single-use invite tokens (`inviteTokenHash`/`inviteTokenExpiresAt`) still
gate `/accept-invite` exactly as before. This work *reuses* `inviteTokenHash`
as a more precise signal inside `checkEmail` (see §12) but does not change
how invites are created, sent, or accepted.

## 9. Journey state machine

`journeyState` — new field on `GET /api/auth/session-context`, computed only
when the caller is a client-portal role (`client`, `employer`, `employee`,
`beneficiary`) with `hasCase: false`. Absent entirely when the account has
no `leadId` at all (preserves the original `/onboarding/intake` behavior for
a client who never touched the quiz).

| `journeyState` | Derived from `Lead.status` | Meaning |
|---|---|---|
| *(field absent)* | no `user.leadId` | No assessment yet — intake questionnaire. |
| `CONSULTATION_REQUIRED` | `new`, `contacted`, `consultation_requested` | Assessment/Lead exists, no consultation booked. |
| `CONSULTATION_BOOKED` | `booked`, `consultation_scheduled` | Consultation on the calendar, hasn't happened yet. |
| `WAITING_FOR_CASE` | `consultation_confirmed`, `consultation_completed`, `approved`, `converted` | Consultation done/approved, case not yet created. |
| `CASE_REJECTED` | `rejected`, `closed` | Kept **distinct** from `WAITING_FOR_CASE`, even though today's frontend renders similar copy for both — preserving this as its own value avoids baking the ambiguity in as technical debt, and lets a future rejection-specific UI change without a backend change. |

`hasCase: true` is checked first and always wins — `journeyState` is only
ever consulted on the no-case path, exactly as planned.

`AuthGate.jsx` precedence (verified against the actual code, not reordered
by this change):

```
authLoading / isStaff / isAttorney (redirect effects in flight)
  -> error state
  -> unauthenticated
  -> role not in CLIENT_PORTAL_ROLES
  -> mustSetPassword                    -> /accept-invite
  -> isEmployeeAccount                  -> confined to /dashboard, /dashboard/documents, /dashboard/profile
  -> hasCase                            -> /dashboard (bounces out of /onboarding/intake specifically)
  -> isLegacyNoCaseAccount              -> /legacy-holding
  -> [NEW] journeyState WAITING_FOR_CASE | CASE_REJECTED
                                         -> /waiting-for-approval
  -> [NEW] journeyState CONSULTATION_BOOKED | CONSULTATION_REQUIRED
                                         -> /consultation/book?leadId=...
  -> no leadId at all                   -> /onboarding/intake
```

The three new branches were inserted at the single existing point (after
`isLegacyNoCaseAccount`, before the final intake fallback) — no earlier
branch (`mustSetPassword`/staff/attorney/`hasCase`/legacy) was reordered or
modified.

`WaitingForApproval.jsx` (new page, `/waiting-for-approval`, standalone —
no `PortalLayout`, matching `Intake.jsx`'s minimal-header pattern) branches
its copy on `journeyState === "CASE_REJECTED"` specifically (destructive-
colored icon, "We're unable to move forward right now") vs. the default
waiting copy (primary-colored icon, "Your consultation has been booked") —
the distinction is preserved in the component's render even though both
currently route to the same page/component.

## 10. Admin / Attorney authentication architecture

Unchanged. Both already authenticate directly against `/auth/login` from
their own origins (`Admin/frontend`, `Attorney`), independent of Landing.
`OAuthCallback.jsx`'s `STAFF_ROLES` redirect-to-Admin logic and `AuthGate`'s
`isStaff`/`isAttorney` short-circuit are unaffected by any change in this
pass — verified by re-reading both files; neither references `roleTab` or
anything Phase 1 removed.

## 11. API changes

**`POST /auth/check-email`** (new) — public, same global rate limiter and
`auditAuth("auth.check_email")` logging every other auth route gets.
Request: `{ email }`. Response — exactly:
```json
{ "success": true, "exists": true, "hasPassword": true, "pendingInvite": false }
```
Never returns `userId`/`role`/`leadId`/`caseId`. Scoped to
`role: { $in: CLIENT_PORTAL_ROLES }` — a staff/admin/attorney email always
returns `exists: false` here.

**`POST /auth/register`** — added optional `sessionId` field (validated,
`≤200` chars, trimmed). No existing field's behavior changed.

**`GET /auth/session-context`** — added optional `journeyState` field (see
§9). Every previously-existing field is unchanged; the field is entirely
absent for staff/attorney roles and for any client with `hasCase: true` or
no `leadId`.

## 12. Database / model changes

**None.** No new fields, collections, or indexes were added.

- `sessionId` on `/register` is a request-body field only — not persisted
  onto `User`.
- `journeyState` is computed on read from the existing `Lead.status` enum;
  no new field on `Lead` or `User`.
- Anonymous-Lead linking reuses the existing `User.leadId` field (already
  present, already set by `createLeadFromIntake` for the logged-in intake
  path) rather than adding a new relationship.
- `checkEmail`'s `pendingInvite` computation reads the existing
  `inviteTokenHash` field (already present on `User`, `select: false` by
  default) rather than adding anything new.

## 13. Migration considerations

None required. Every new field (`sessionId` on register,
`journeyState` on session-context) is additive and optional — an existing
client with no `leadId` sees no behavior change (`journeyState` stays
absent, same as before this change existed), and every existing signup/login
call site that doesn't send `sessionId` behaves exactly as before.

## 14. Security considerations

- `check-email` is filtered to `CLIENT_PORTAL_ROLES` — cannot be used to
  confirm a staff/admin/attorney account's existence.
- Response body is exactly `{ exists, hasPassword, pendingInvite }` — no
  `userId`, `role`, `leadId`, or `caseId` under any input.
- Same global rate limiter as every other route (`app.js`'s `app.use(
  rateLimit(...))`), same `auditAuth` logging as `/login`/`/register`, so
  abuse attempts are logged identically to a login-guessing attempt.
- **`check-email` is never an authorization decision.** `/auth/login`
  independently and fully validates credentials on every call, regardless
  of what `check-email` returned or whether it was called at all — a client
  could skip `check-email` entirely with no change in what `/auth/login`
  accepts.
- Anti-enumeration posture matches the existing precedent set by
  `registerClient`'s own duplicate-email check (which already reveals
  "this email is already registered" today) — `check-email` doesn't
  introduce a new exposure beyond what already existed, and is scoped
  strictly narrower (role-filtered, three fields only).
- `checkEmail`'s `pendingInvite` signal was deliberately changed from the
  ambiguous `isPendingInvite`/`isPendingClientInvite` helpers (`role === X
  && !password`, which cannot distinguish a real staff-issued invite from a
  Google-only account with no password) to `Boolean(user.inviteTokenHash)`
  — set only by `createClientInviteToken`/`createEmployeeInviteToken`, never
  by a Google signup. This closes a real misclassification bug found during
  testing (see §16) that would have shown a Google-authenticated user an
  incorrect "you've been invited, set your password" prompt instead of
  directing them to Google sign-in.
- Anonymous-Lead linking's double-link guard (`User.findOne({ leadId })`
  before linking) prevents two different signups from both claiming the
  same `Lead`, including under a duplicate/retried signup request with the
  same `sessionId`.

## 15. Test results

**Unit (`Backend/src/modules/auth/tests/journeyAndLeadLinking.test.js`,
DB-free/mocked-model style, `node --test`)** — 9/9 passing:
- `checkEmail`: unknown email, role-scoped query assertion (staff/admin
  emails excluded), existing account with a password, Google-only account
  (no password, no `inviteTokenHash`) never reports `pendingInvite`, a real
  staff-issued invite (`inviteTokenHash` set) correctly reports
  `pendingInvite: true`.
- `findLinkableLead`: `sessionId` match takes priority over email (email
  lookup never attempted once `sessionId` resolves); falls back to email
  when `sessionId` finds nothing; a `Lead` already claimed by another `User`
  is never re-linked; no match returns `null` without throwing.

**Unit (`Immiglance/Landing/src/utils/eligibilitySession.test.js`, vitest +
jsdom)** — 3/3 passing: `getSessionId()` mints an id on first read and
returns the identical id on every subsequent read within the same
`sessionStorage` — the guarantee both the reload case and the
duplicate/retried-signup case depend on.

**Live, against the running dev backend and real database:**
- `check-email` for a real staff account → `exists: false` (role-scoping
  confirmed live, not just in the mocked unit test).
- `check-email` for a made-up email → `exists: false`.
- `check-email` for a real account with no password and no `inviteTokenHash`
  (`ishaanoberoi04@gmail.com`, a genuine Google-only account, confirmed by
  direct DB read) → `hasPassword: false, pendingInvite: false` — this is the
  exact case that was misclassified as `pendingInvite: true` before the
  `inviteTokenHash` fix; now correct.
- `check-email` for a real account with an unexpired `inviteTokenHash`
  (`embtelcloud@gmail.com`) → `hasPassword: false, pendingInvite: true`.
- `journeyState` resolution against real `Lead`/`User` documents through
  `getSessionContext` directly (not mocked): every mapped `Lead.status`
  value (`new`, `booked`, `consultation_completed`, `approved`, `rejected`,
  `converted`, `closed`) resolved to its expected `journeyState`, and a
  `leadId`-less account correctly omitted the field entirely. 8/8 passing.
  Test fixtures were created and cleaned up in the same run.
- Anonymous-Lead linking, live: created a `Lead` with a known `sessionId`,
  registered two different accounts against that same `sessionId` via real
  `POST /auth/register` calls. Confirmed only the first account's `leadId`
  was set to that `Lead`; the second registration succeeded (as a normal
  new account) but did **not** re-link the already-claimed `Lead` — proving
  the double-link guard live, not just in the mocked unit test. Test
  fixtures cleaned up afterward.
- Landing's `/login` and `/signup` routes render (HTTP 200) after the full
  `Login.jsx`/`Register.jsx` rewrites; no build/HMR errors.

**Not independently re-verified with live staff/attorney credentials in
this pass** (see §16) — covered instead by full-file code inspection
confirming zero coupling between the removed `roleTab` state and any
backend call or routing decision (`roleTab` was never transmitted to the
backend before this change, and staff/attorney routing has always been
keyed off `role` from the JWT, in `AuthGate.jsx` and `OAuthCallback.jsx`,
both unmodified by this pass).

## 16. Unresolved edge cases / explicitly deferred

- **Staff/attorney live-login regression check** was verified by code
  inspection (§10, §15) rather than an actual staff-credential login through
  the now-tab-less `Login.jsx`. Risk is low — `handleLogin`'s real logic was
  untouched, and `roleTab` never reached the backend even before this
  change — but a real click-through with staff/attorney test credentials is
  recommended before considering this fully closed.
- **No dedicated rejection-management workflow.** `CASE_REJECTED` is a
  distinct `journeyState`, but what a rejected client can actually *do*
  (re-apply, appeal, contact staff) beyond seeing a distinct message is not
  built out.
- **No `authProvider`/`googleId` field added.** The existing `hasPassword`
  signal remains sufficient for the Google-vs-password UX without a schema
  migration; if a future requirement needs to distinguish "signed up via
  Google" from "has both a password and a linked Google identity," this
  will need revisiting.
- **`employeeInvite.service.js`'s equivalent invite-token fields** were
  confirmed to exist (`inviteTokenHash`/`inviteTokenExpiresAt`, same shape
  as the client side) but `checkEmail`'s scope is `CLIENT_PORTAL_ROLES`,
  which includes `employee` — an employee's pending invite is correctly
  covered by the same `inviteTokenHash` check as a client's, no separate
  logic needed.
- **Expired-but-not-yet-deleted invite tokens** still report
  `pendingInvite: true` in `checkEmail` (deliberately — the UX is "resend
  invite" either way, matching this file's existing "deliberately not gated
  on expiry" comment for the older helpers). If a future requirement wants
  `checkEmail` to distinguish "invite pending" from "invite expired,"
  `inviteTokenExpiresAt` is already available to add that distinction
  without a schema change.

## Addendum — auth pages relocated to the Client app; unrelated credential leak fixed

Two follow-up changes made in the same pass, after the above was written.

### A. Login/Signup/Forgot-Reset-Password/Accept-Invite/OAuth-callback moved from Landing to Client

**Why:** the original design (sections 3–8 above) hosted the email-first
login/signup UI in the Landing app, with a successful login handed back to
the Client app cross-origin. On review, this was changed: the Client app
(`Immiglance/Client`, port 5175) is now a fully self-contained portal,
exactly like Admin's and Attorney's own login pages — it hosts its own
`/login`, `/signup`, `/forgot-password`, `/reset-password`, `/accept-invite`,
and `/auth/callback` (Google OAuth landing page). Landing performs **zero**
authentication of any kind; its Navbar's "Client Login" link is now a plain
cross-origin `<a href>` straight to Client's `/login`, carrying the
anonymous eligibility-quiz `sessionId` as a URL query param (since
`sessionStorage` doesn't cross origins) rather than an in-app React Router
`<Link>`.

**What made this low-risk:** the codebase already had a mature, bidirectional
cross-origin redirect pattern (`CrossAppRedirect.jsx`, present in both apps)
built for exactly this kind of split, and the backend's Google OAuth
callback (`env.clientUrl`, the `CLIENT_URL` env var) already targeted the
Client app's origin, not Landing's — the previous design was actually
routing through an extra, unnecessary hop (backend → Client's catch-all →
forwarded to Landing → Landing's `OAuthCallback.jsx`). Client's own
`AuthContext.jsx` and `services/api.js` already had nearly every method the
ported pages needed (`login`, `signup`, `loginWithGoogle`, `acceptInvite`,
`forgotPassword`, `resetPassword`, `getInviteDetails`, `resendInvite`) —
this was dormant, unused capability left over from before the original
Landing/Client repository split, not new backend work.

**Changes:**
- Ported (not rewritten) `Login.jsx`, `Register.jsx`, `OAuthCallback.jsx`,
  `AcceptInvite.jsx`, `ForgotPassword.jsx`, `ResetPassword.jsx`, plus the
  `AuthShell`/`PasswordField`/`BrandMark` UI atoms they depend on, from
  `Immiglance/Landing/src/Pages/Auth/` (and `components/`) to the identical
  paths under `Immiglance/Client/src/`. Deleted the originals and the two
  now-orphaned shared components (`AuthShell.jsx`, `PasswordField.jsx` —
  `BrandMark.jsx` stayed, still used by Landing's `Navbar`) from Landing.
  `Register.jsx` no longer reads the quiz's `sessionId` from local
  `sessionStorage` (`eligibilitySession.js`, Landing-only) — it reads it
  from a `?sessionId=` URL query param instead, since that's the only way
  it can cross the origin boundary.
- Client's `App.jsx`: added the 6 pages as public routes, deliberately
  outside `AuthGate` (which would otherwise redirect an unauthenticated
  visitor straight back to `/login`, looping) — each page's own
  "already logged in" guard handles that case instead, unchanged from the
  Landing originals. `AuthGate.jsx` itself needed **no changes** — its
  existing `<Navigate to="/login">` / `/accept-invite` already resolve
  locally now that real routes exist for them.
- Client's `services/api.js`/`context/AuthContext.jsx`: added the one
  missing piece, `authApi.checkEmail` and a `sessionId` param on
  `register`/`signup` (both already existed on Landing's copies from the
  original work above; Client's copies had simply never needed them until
  now).
- Landing's `App.jsx`: removed the 6 auth routes/lazy imports; added
  `CrossAppRedirect`-forwarded routes for the same 6 paths (mirroring the
  pre-existing `/dashboard`, `/onboarding/*` pattern) so old bookmarks/
  emailed links still resolve correctly instead of 404ing.
- Backend: 5 email templates that build a link into `/accept-invite` or
  `/reset-password` (`password-reset.js`, `client-portal-invitation.js`,
  `staff-invitation.js`, `family-beneficiary-invitation.js`,
  `employee-case-invitation.js`) were changed to build that link from
  `env.clientUrl` (the same value the OAuth callback already trusted)
  instead of a separate, ad hoc `IMMIGLANCE_FRONTEND_URL` fallback chain
  that defaulted to Landing's port in dev. Also fixed one unrelated,
  pre-existing instance of the same bug in `case.controller.js`'s
  case-manager-assignment notification link, which built a `/dashboard/...`
  URL (always Client-only, never Landing) against the same wrong fallback —
  discovered as a side effect of auditing every `IMMIGLANCE_FRONTEND_URL`
  usage, unrelated to the page relocation itself.
- **No backend route, model, or `/auth/*` contract changes.** `check-email`,
  `login`, `register`, `session-context`, `journeyState`, and every
  security property described in sections 9–14 above are completely
  unaffected — only which frontend app renders the login/signup UI changed.

**Verified:** both apps build cleanly (`vite build`); Client's full test
suite (22 tests, including the ported `PasswordField` test) and Landing's
(5 tests, after removing the now-relocated test) pass; both apps' dev
servers serve HTTP 200 for `/login`, `/signup`, `/forgot-password` (Client)
and for the old `/login`, `/signup` paths on Landing (now served by
`CrossAppRedirect`); Landing's production bundle was inspected directly and
confirmed to contain the expected `/login?sessionId=` cross-origin link
with the correct `localhost:5175` fallback baked in. **Not verified live in
a real browser** (no headless browser tool was available in this pass) —
the click-through verification called for in section "Verification" of the
original plan (Google OAuth round-trip end-to-end, forgot-password email
link landing on the new page) should still be done manually before this is
considered fully closed.

### B. Unrelated: real staff credentials found hardcoded in `Backend/scripts/create-staff-accounts.js`

While working in this area, a plaintext-credential leak was found and
fixed — unrelated to the auth-page relocation above, flagged separately by
GitHub's secret scanning (`Backend/scripts/create-staff-accounts.js`, real
`@immiglance.com` staff emails with real plaintext passwords, already
pushed to `origin/main`, `origin/refactor`, and `origin/features`).

**Fixed:**
- All 5 exposed accounts' passwords were rotated immediately to fresh
  `crypto.randomBytes`-generated values (relayed to their owners
  out-of-band, not committed anywhere).
- The script itself no longer contains any hardcoded password — it
  generates one per account at runtime and prints it to stdout once,
  never persisting it to disk.

**Not done in this pass:** the leaked plaintext passwords remain in git
history on all three branches above (rotating the credentials makes the
leaked values themselves harmless, but the file's prior contents are still
visible in `git log`). Purging git history (`git filter-repo`/BFG +
force-push) was deliberately not attempted — it's a destructive operation
affecting shared branches that requires explicit sign-off before touching,
separate from this fix.
  without a schema change.
