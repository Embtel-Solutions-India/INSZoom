# Attorney Portal — Setup & Manual Configuration

## Running it locally

```bash
# Backend (port 7000) — already running for the other portals
cd Backend && npm run dev

# Attorney Portal (port 5174)
cd attorney-portal && npm install && npm run dev
```

Then open http://localhost:5174/login.

Ports in use across the monorepo: Immiglance `5173`, INSZoom `3002`,
Attorney Portal `5174`, backend `7000`.

## Environment variables

### `Backend/.env` — already applied

```
# Appended to the EXISTING CLIENT_URLS list (that one list is what CORS
# reads, via config/env.js -> app.js). Do not add a separate CORS variable.
CLIENT_URLS=...,http://localhost:3002,http://localhost:5173,http://localhost:5174

# Used for the link in the attorney-assignment email only.
ATTORNEY_PORTAL_URL=http://localhost:5174
```

For production, set `ATTORNEY_PORTAL_URL` to the real subdomain (e.g.
`https://attorney.yourdomain.com`) **and** add that same origin to
`CLIENT_URLS`.

### `attorney-portal/.env.development` — already applied

```
VITE_API_URL=http://localhost:7000/api
VITE_ATTORNEY_PORTAL_URL=http://localhost:5174
VITE_FIREBASE_*        # copied from INSZoom/frontend/.env
VITE_FIREBASE_VAPID_KEY
```

### `Immiglance/Frontend/.env` — already applied

```
VITE_ATTORNEY_PORTAL_URL=http://localhost:5174
```

Used by `AuthGate.jsx` to redirect an authenticated attorney to the portal.

## Manual steps that still need a human

1. **Create attorney user accounts.** There is no attorney self-signup. An
   admin creates a user with role `attorney` (the role is now valid in the
   User model). Until at least one exists, the INSZoom "Attorney Access"
   dropdown is empty and says so.

2. **Firebase Web App registration (optional but recommended).** The portal
   currently reuses INSZoom's Firebase Web App config (same project
   `white-cedar-504623-u1`, same `appId`). This works — FCM web push is not
   origin-locked — but a dedicated registration is cleaner for
   analytics/rotation. If you create one in the Firebase Console:
   - update `VITE_FIREBASE_APP_ID` in `attorney-portal/.env*`, **and**
   - update the same value inside
     `attorney-portal/public/firebase-messaging-sw.js` by hand — a service
     worker in `/public` is served as a static file and never sees Vite's
     env pipeline.

3. **Push notifications require HTTPS or localhost** and an explicit user
   gesture to grant permission. `initializeNotifications()` (called on
   login) only re-registers an already-granted token — it never prompts, by
   design, matching the other two portals. There is currently no "Enable
   notifications" button in this portal, so a first-time attorney will not
   be prompted; add one wired to `requestPermissionAndGetToken()` if that
   flow is wanted.

4. **Production deploy** needs the new app added to whatever builds/deploys
   Immiglance and INSZoom today (the repo has no workspace root — each app
   is standalone, so this is a new build target, `npm ci && npm run build`
   in `attorney-portal/`, serving `dist/` with SPA fallback).

5. **MongoDB index** — deliberately NOT added; see the completion report §6.
   `Case.js` is at MongoDB's 64-index ceiling, so nothing can be added to
   that collection until the existing index bloat is resolved.

## Verifying it works

```bash
# Backend API suite (31 assertions against the live server + database)
cd Backend
node src/scripts/e2eFixtures.js seed
node src/scripts/verifyAttorneyPortal.js
node src/scripts/e2eFixtures.js teardown

# Browser suite (needs backend on :7000 and the portal on :5174)
cd INSZoom/frontend
npx playwright test e2e/attorney-portal.spec.js --project=desktop
```

## How access actually works

An attorney sees a case only if `Case.attorneyAccess[]` contains an entry
for them with `status: "active"`. That single rule is enforced in three
places that all share one implementation
(`caseService.hasActiveAttorneyAccess`):

- `canAccessCase()` — every reused staff controller (case detail,
  documents, forms, questionnaires, timeline).
- `applyCaseRoleFilter()` — every list query.
- `middleware/requireAttorneyAccess.js` — the `/api/attorney/*` namespace.

Granting is done by a Case Manager, Team Lead or Admin from the "Attorney
Access" card on the INSZoom case detail page, which calls
`PATCH /api/cases/:caseId/attorney-access`. Revoking flips the entry to
`status: "revoked"` (kept for history) and access stops immediately.
