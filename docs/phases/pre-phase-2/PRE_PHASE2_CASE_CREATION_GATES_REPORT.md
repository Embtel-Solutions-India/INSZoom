# PRE-PHASE 2 CASE CREATION GATES REPORT

## Change Table

| Path | File | Lines changed | Before | After |
| --- | --- | --- | --- | --- |
| `POST /api/cases` | `Backend/src/modules/cases/case.routes.js` | 22-31 | `authenticate`, then `authorizePermissions("cases:create")`; no role guard on this route. | Added `authorizeRoles("super_admin", "admin", "team_lead", "case_manager")` at line 25 before `authorizePermissions("cases:create")`. |
| `POST /api/family-workflow/cases` | `Backend/src/modules/family-workflow/family-workflow.routes.js` | 14-21 | `authorizeRoles("client")`. | Replaced with `authorizeRoles("super_admin", "admin", "team_lead", "case_manager")` at line 17. |
| `POST /api/employment-workflow/cases` | `Backend/src/modules/employment-workflow/employment-workflow.routes.js` | 16-24 | `authorizeRoles("employer", "client")`, then `authorizePermissions("cases:create")`. | Replaced with `authorizeRoles("super_admin", "admin", "team_lead", "case_manager")` at line 19, before permissions. |
| `POST /api/single-party-filings/cases` | `Backend/src/modules/single-party-filings/single-party-filing.routes.js` | 4, 15-25 | Only `authenticate` and `authorizePermissions("cases:create")`; no role guard. | Imported `authorizeRoles` at line 4 and added `authorizeRoles("super_admin", "admin", "team_lead", "case_manager")` at line 18 before permissions. |
| `ensureCaseForCompletedClient` auto-trigger | `Backend/src/modules/clients/client.service.js` | 179-189 | Function created/linked a `Case`, generated a case number, updated client case references, and resolved document requirements. | Function is now an intentional no-op stub that logs `[ensureCaseForCompletedClient]` and returns `null` without creating any document. |

## Verification Results

| Verification | Result | Observed |
| --- | --- | --- |
| 1. Start backend server | Blocked by environment | `npm start` reached MongoDB startup but failed with `MongooseServerSelectionError: connect EACCES 18.210.74.196:27017`. Retrying outside the sandbox was rejected because it would connect to an external MongoDB and launch startup jobs against potentially shared data. |
| Server syntax check | Pass | `npm run check` completed successfully: `node --check src/server.js`. |
| Changed-file syntax checks | Pass | `node -c` completed successfully for all five modified source files. |
| Route stack inspection | Pass | All four route files loaded successfully. The target POST routes now include the inserted/replaced role middleware before downstream validators/permissions as required. |
| Direct role middleware behavior | Pass | `authorizeRoles("super_admin", "admin", "team_lead", "case_manager")` returned 403 for `client` and `employer`, and called `next()` for `team_lead`, `case_manager`, `admin`, and `super_admin`. |
| 2. HTTP `POST /api/cases` with client/team_lead JWTs | Not run | Requires a running backend and MongoDB-backed users because `authenticate` rehydrates `req.user` from MongoDB before role checks. Startup was blocked by MongoDB network access. |
| 3. HTTP `POST /api/family-workflow/cases` with client JWT | Not run | Same MongoDB-backed HTTP authentication blocker. |
| 4. HTTP `POST /api/employment-workflow/cases` with client JWT | Not run | Same MongoDB-backed HTTP authentication blocker. |
| 5. HTTP `POST /api/single-party-filings/cases` with client JWT | Not run | Same MongoDB-backed HTTP authentication blocker. |
| 6. Trigger `saveProfile` with `completed: true` | Not run | Requires a live authenticated client request and database observation. The local backend could not be started against MongoDB in this environment. Static review confirms the call site accepts the new `null` return. |

## Discrepancies

- The prompt described `ensureCaseForCompletedClient(client, user, req)`. The actual function signature was `ensureCaseForCompletedClient(client, data = {}, user, req)`. I preserved the existing four-argument signature and replaced only the function body so the existing call site remains compatible.
- The prompt estimated the `ensureCaseForCompletedClient` call inside `saveProfile` around line 338. In the current file it is at line 297:
  `const relatedCase = await ensureCaseForCompletedClient(client, data, user, req);`
- `single-party-filing.routes.js` contained a comment documenting that `cases:create` had been granted to `client`; the implementation added the required staff role guard and left the comment text unchanged.

## `saveProfile` Null Handling

`saveProfile` handles the `null` return gracefully. The call site is:

```js
const relatedCase = await ensureCaseForCompletedClient(client, data, user, req);
if (relatedCase && client.completed) {
  await notifyCaseOfClientSubmission(relatedCase, client, user, req, { isFirstSubmission: !wasCompleted }).catch(() => null);
}
```

Because notification work is guarded by `if (relatedCase && client.completed)`, the new `null` return skips notification and continues to `writeAuditLog(...)`, then returns the saved client payload normally.

## Files Modified

1. `Backend/src/modules/clients/client.service.js`
2. `Backend/src/modules/cases/case.routes.js`
3. `Backend/src/modules/family-workflow/family-workflow.routes.js`
4. `Backend/src/modules/employment-workflow/employment-workflow.routes.js`
5. `Backend/src/modules/single-party-filings/single-party-filing.routes.js`
6. `PRE_PHASE2_CASE_CREATION_GATES_REPORT.md`

## Files Read

1. `Backend/src/modules/clients/client.service.js`
2. `Backend/src/modules/clients/client.controller.js`
3. `Backend/src/modules/cases/case.controller.js`
4. `Backend/src/middleware/authorizeRoles.js`
5. `Backend/src/modules/cases/case.routes.js`
6. `Backend/src/modules/family-workflow/family-workflow.routes.js`
7. `Backend/src/modules/employment-workflow/employment-workflow.routes.js`
8. `Backend/src/modules/single-party-filings/single-party-filing.routes.js`
9. `Backend/package.json`
10. `Backend/src/server.js`
11. `Backend/src/middleware/authenticate.js`
12. `Backend/src/config/env.js`
13. `Backend/src/app.js`
14. `Backend/src/modules/auth/token.service.js`
