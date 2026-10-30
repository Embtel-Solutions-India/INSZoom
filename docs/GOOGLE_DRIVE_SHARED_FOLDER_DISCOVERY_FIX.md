# Google Drive: shared-folder discovery, search and paging

Date: 2026-10-30. Extends the existing "Add to Drive" feature (see `GOOGLE_DRIVE_INTEGRATION_PLAN.md`). Additive: no route, model field or
screen was removed, and the feature stays behind `GOOGLE_DRIVE_INTEGRATION_ENABLED`.

## 1. What was inspected (Phase 1)

| Question | Finding |
|---|---|
| OAuth scopes requested | `drive.client.js` asks for **one** Drive scope plus `openid` and `email`. The Drive scope is `https://www.googleapis.com/auth/drive` (full) when `GOOGLE_DRIVE_SCOPES` contains it, otherwise `https://www.googleapis.com/auth/drive.file`. Read in one place: `config/env.js` (`googleDrive.driveScope`). On the developer machine where this was checked the effective scope is **`drive` (full)**. The value on the production server was not checked (the server's environment is not accessible from here) - confirm it there. |
| Does Drive share OAuth config with Google login? | They share only the Google **client ID/secret** (`env.google.oauthClientId/Secret`). Everything else is separate: Drive has its own redirect URI (`GOOGLE_DRIVE_OAUTH_REDIRECT_URI`), its own routes/state table, `include_granted_scopes: false` (so the login grant is never merged), and the login flow asks only `openid email profile`. No file in `modules/auth` was changed. |
| Folder listing code | `listAppFolders` (the in-app browser) listed only the children of **one parent**, starting at `root`. It had **no entry point for "Shared with me" or "Shared drives"**, **no paging** (a response over 100 folders was silently cut at 100), **no search**, and did not say whether a folder was writable. |
| Google Picker | Already configured with three views: My Drive, Shared with me (`setOwnedByMe(false)`), Shared drives (`setEnableDrives(true)`, `SUPPORT_DRIVES`). It is Google's own window and is unchanged. |
| How the folder reaches the backend / uploads | The chosen folder ID goes to `POST /folders/validate` then `POST /sync`; `createJob` calls `getFolder` (exists, is a folder, not trashed, `canAddChildren`) before any upload, and the upload sends `supportsAllDrives=true`. |

## 2. Root cause

Several causes, not one:

1. **Query logic (confirmed in code).** The in-app browser could only walk down from My Drive's top level. A folder owned by someone else and shared with the account is not a child of My Drive, so it was unreachable there; shared drives had no way in at all. Nothing paged past 100 folders.
2. **OAuth scope (conditional).** With the narrow `drive.file` scope Google only exposes folders the app created or the user picked, so *no* API listing can show other people's folders. With the full `drive` scope (what is configured locally) the API can. This fix does **not** change the scope (see section 5).
3. **Picker configuration** was already correct for the three areas; it was not changed.

## 3. Changed files

Backend
- `Backend/src/modules/google-drive/drive.client.js` - new `listFolders` (My Drive / inside a folder / Shared with me / shared drives / search, paged, newest-modified first) and `listSharedDrives`; `getFolder` now also returns `parentId` and `driveId`. `listAppFolders` is kept untouched for compatibility.
- `Backend/src/modules/google-drive/google-drive.controller.js` - `GET /folders` accepts `parentId`, `view=shared|drives`, `q`, `pageToken`; validates every input; returns `nextPageToken` and `fullAccess`; explains the narrow-scope limitation (`SCOPE_LIMITED`).
- `Backend/src/modules/google-drive/sync.service.js`, `Backend/src/models/GoogleDriveJob.js` - the job now also stores the destination's `folderParentId` and `folderDriveId` (optional, additive).

Admin frontend
- `Admin/frontend/src/services/api.js` - `listFolders(parentId, options)`; with only a parent ID it behaves exactly as before.
- `Admin/frontend/src/components/GoogleDriveExport.jsx` - the in-app folder browser.

Tests (new)
- `Backend/src/modules/google-drive/tests/folder-discovery.test.js`
- `Admin/frontend/src/components/GoogleDriveFolderBrowser.test.jsx`

## 4. What it does now

Folder browser (opens from "Search or browse your folders here instead", or automatically when Google's window cannot be used):
- **Tabs:** My Drive, Shared with me, Shared drives.
- **Search box:** type two or more letters; matches folder names across My Drive, Shared with me and shared drives (debounced 350 ms). A result opens like any folder.
- **Nested folders:** open any folder, including folders inside a shared folder or shared drive; breadcrumbs go back up.
- **Paging:** "Load more folders" fetches the next page; earlier pages stay on screen.
- **Newest first:** folders are ordered by last modified, most recent at the top (shared drives stay in Google's order - Google gives them no timestamp).
- **Permissions:** a folder the account can only view shows "View only" and cannot be selected. Trashed folders are never listed. Shared folders show who shared them.
- **Create folder** is offered only inside a real folder (never silently in My Drive while a Shared/Search list is on screen).
- **Padding:** list rows have slightly more room.

Safety (before anything is uploaded): `getFolder` still checks existence, folder type, trash state and `canAddChildren` for the connected account; the server re-checks at job start, so a folder un-shared in the meantime fails with a clear message instead of an upload error.

Isolation: connections are **per user** (not per organisation as the brief assumed - stricter). Every request resolves `requireActive(req.user)`, so one user's tokens are never used for another user or organisation. Folder IDs, view names, search text (100 chars) and page tokens are validated; search text and IDs are escaped before they enter a Drive query.

## 5. OAuth scopes actually requested

`https://www.googleapis.com/auth/drive` (or `drive.file` if `GOOGLE_DRIVE_SCOPES` does not list `drive`), `openid`, `email`. **Unchanged by this work.**

Limitation: with `drive.file`, Shared with me, Shared drives and search cannot be listed by the API. The screen then shows a clear message ("Shared folders and search need full Google Drive access...") and Google's own window remains the way to pick. Moving to the full scope is a decision for the owner: `drive` is a Google **restricted** scope, so until the app passes Google's verification and security assessment only test users (or an Internal Workspace) can connect. Accounts saved with the narrower grant are asked to reconnect once.

## 6. Test results (what was actually run)

Run on 2026-10-30, mocked Google and Mongo (no network, no database):

| Suite | Result |
|---|---|
| `google-drive.test.js` + `sync.service.test.js` (existing, before the change) | 41 / 41 passed |
| the same two + `folder-discovery.test.js` (after the change) | 54 / 54 passed (13 new) |
| `GoogleDriveExport.test.jsx` (existing) + `GoogleDriveFolderBrowser.test.jsx` (new) | 37 / 37 passed (11 new) |
| `modules/auth/auth.security.test.js` (Google login configuration) | 16 / 16 passed |
| `Admin` production build | built without errors |

New automated coverage: My Drive query shape; nested/shared-drive folder query and ID escaping; Shared with me (with sharer name and original parent ID); shared drives; search (quote escaping); paging; newest-first ordering parameter; view-only folders; destination check keeping folder/parent/drive IDs; revoked or un-shared folders (404 -> clean error); endpoint input validation; narrow-scope explanation; tabs, search, load-more, view-only and empty states in the screen.

**Not run - needs real Google accounts (not available in this environment).** The two-account scenario in the brief (Account A owns a folder, Account B connects and is granted access) and the live Shared-drive, read-only, revoked-permission and Google-login-in-browser checks were **not executed** against Google. The automated tests above prove what the app *asks Google for* and how it handles the answers; they do not prove Google's answers. Manual checklist:
1. Account A creates folder `Shared Test` with subfolder `Nested`, shares it with Account B as Editor.
2. Account B connects in "Add to Drive" -> Next -> browse here -> Shared with me: `Shared Test` appears; open it; `Nested` appears; select it; upload one document.
3. Change A's share to Viewer: the folder shows "View only" and cannot be chosen; if chosen via Picker, the check refuses it.
4. Remove B's access: the next list/upload reports the folder as not found or inaccessible.
5. Add B to a Shared drive: it appears under Shared drives; open a folder and upload.
6. Search part of a folder name in each of the three places.
7. Sign in with Google on the Landing page to confirm login is unaffected.

## 7. Limitations and notes

- Needs the full `drive` scope on the server for Shared with me / Shared drives / search in the in-app browser (section 5).
- Search matches the start/contains of folder names, not folder contents; very large Drives may return "incomplete" results from Google's all-drives search - narrow the text if so.
- Shared drives are listed in Google's order (no modified time).
- Google verification: the full `drive` scope is restricted (verification + security assessment) before non-test external users can connect.
- Production env to confirm: `GOOGLE_DRIVE_SCOPES` (expected `https://www.googleapis.com/auth/drive`), plus the existing `GOOGLE_DRIVE_INTEGRATION_ENABLED`, `GOOGLE_DRIVE_OAUTH_REDIRECT_URI`, `ADMIN_PORTAL_URL`, `GOOGLE_TOKEN_ENCRYPTION_KEY`. No new environment variables were added; no CI/CD files were touched.

## 8. Follow-up (2026-10-31): Back button and speed

- **Back button** (in-app folder browser, left of the breadcrumb): goes up exactly one Drive folder, to the list of the parent folder. It stays in the same tab (My Drive / Shared with me / Shared drives) and never leaves the folder-choosing step. At the top of a tab it is disabled; on a search result list it closes the search. The footer button that returns to the file-selection step is now labelled "Back to files" so the two cannot be confused.
- **Faster, nothing removed:**
  - The browser shows a list it has already seen (Back, returning to a tab) at once and refreshes it quietly in the background; a failed refresh keeps the list on screen. The memory lives only while the browser is open and is never shared between accounts.
  - The server remembers an identical folder list for 30 seconds per connected account and lets simultaneous identical requests share one Google call. Creating a folder clears that account's lists; errors are never remembered. Optional env `DRIVE_LIST_CACHE_MS` (default 30000, `0` turns it off) - nothing needs to be set on the production server.
- Tests: backend Drive tests 60/60 (6 new in `folder-list-cache.test.js`), frontend Drive tests 42/42 (3 + 2 new), Admin build clean. Not measured against live Google (no real account here), so the real-world speed-up is not quantified.
