# ISSUE-007: Auth Refresh Returns 500 Under Concurrent Refresh (Session-Rotation Race)

## Issue

`POST /api/auth/refresh` returns `500 Internal Server Error` in production (captured live in the user's browser DevTools: `AuthContext.jsx:65`). This is a distinct root cause from the Cases/Forms 503s (ISSUE-005/006) — it is not a database-availability problem, it is a concurrency bug in session rotation.

## Evidence

- `Backend/src/modules/auth/session.service.js:30-42` — `rotateSession(session, newRefreshToken, req)` does: (1) `AuthSession.create(replacement)`, then (2) `session.revokedAt = new Date(); await session.save();` on the *original* session document, loaded earlier by `findActiveSession`.
- `Backend/src/models/AuthSession.js` declares no `optimisticConcurrency`/custom `versionKey` policy — Mongoose's default `__v` versioning applies.
- Two refresh calls sharing the same still-valid refresh token (a realistic trigger: a slow page load where multiple components independently react to token expiry, or a double-fire from a retry-after-401 path) both read the *same* active session via `findActiveSession` before either revokes it. Both then call `rotateSession`; the second `session.save()` targets a document whose `__v` has already advanced from the first call's save, so Mongoose throws `VersionError: No matching document found for id ... version N`.
- `Backend/src/middleware/errorHandler.js:11-30` (`isDatabaseUnavailableError`) checks only 7 specific Mongo driver error names plus error code 50 — `VersionError` is not among them, so it falls through to the generic `status = error.status || error.statusCode || 500` default at line 51.
- Side effect: the losing call's `AuthSession.create(replacement)` (step 1) already succeeded before the failing `save()` — a valid, unreturned session is silently created and orphaned server-side on every occurrence of this race.

## Proposed Plan

1. Make `rotateSession` atomic: use a single conditional update (e.g. `AuthSession.findOneAndUpdate({_id: session._id, revokedAt: null}, {revokedAt: new Date(), replacedBy: replacement._id})`) instead of load-then-save, so a losing concurrent call gets a clean "already rotated" result instead of a `VersionError`.
2. On losing the race, return the *existing* valid replacement (or instruct the client to retry `/me`) rather than a 500 — mirroring the idempotent-reuse pattern already implemented correctly for `generateForms` (ISSUE-002).
3. Add a`VersionError` branch to `errorHandler.js` (or handle it locally in `auth.service.js`) so it never surfaces as an undifferentiated 500 anywhere else it might occur (e.g. the previously-reported questionnaire `VersionError`, or the documented `CanonicalProfileService.rebuild` vs. in-flight `Case` save race).

## Contradictions / Alternatives

Do not simply retry the whole refresh request client-side on 500 — that treats a symptom (an opaque 500) rather than the cause (an avoidable race), and a blind retry could itself race against a third caller. Fix the write path to be race-safe first.

## Delivered

Not yet delivered — audit finding only.

## Future Learning

Any model using Mongoose's default optimistic-concurrency versioning that is written via a load-then-save pattern is exposed to this exact failure shape under concurrent access. This is not unique to `AuthSession` — the model-inventory audit found the identical pattern risk on `Case` (via `CanonicalProfileService.rebuild`) and confirmed it as the historically-reported mechanism behind the questionnaire `VersionError`. Treat "does this write path use find-then-save on a versioned document reachable from more than one concurrent caller" as a standing question for every new write path, not just the one that gets reported.
