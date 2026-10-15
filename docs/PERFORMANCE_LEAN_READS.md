# Faster case page, Cases list and document viewing - lean reads

## What was measured (2026-10-15, dev machine -> remote MongoDB/S3 in AWS us-east-1)
A tiny query costs ~0.3 s (round trip) but throughput over that link was only ~40-100 KB/s, so time was dominated by **how many bytes** each request pulled, not by the app's own logic (the backend answers /health in 3 ms).

| Request (largest case B243-A, 409 KB document) | Before | Notes |
|---|---|---|
| `GET /api/cases/:id` | 20.6 s, 826 KB response | `canonicalHistory` = 292 KB of the 409 KB document |
| `GET /api/client-intake/cases/:id` | 27.3 s, 869 KB | the page waited for it, yet used only the client profile |
| `GET /api/cases/:id/related` (polled every 30 s) | 5-10 s, 134-213 KB | loaded every document/message/notification/payment/task/workflow; only child cases were read |
| Cases list, 20 cases | 967 KB from the DB | whole documents, no projection |
| Open a document (View) | 10 s (whole case read for the access check) + 43 s (1.7 MB S3 object) | |

## What changed (all additive; nothing removed, nothing written differently)
1. **Case detail** - `GET /cases/:id` no longer reads `canonicalHistory` (no screen or read path uses it). `getAccessibleCaseOrThrow(id, user, { omit })` is opt-in; every other caller gets the same document as before.
2. **Page opens on the case alone** - the Admin case page no longer waits for the client-intake call. It asks for `GET /client-intake/cases/:id?view=client` (client profile only, same access check and same client resolution) in the background. Without `?view` the full bundle is unchanged.
3. **Employees panels** - `GET /cases/:id/related?scope=children` returns only the principal/child links (same access check, same child rows, same restricted-role rule). The Admin case page and the client portal's Employees dashboard (30 s poll) use it. Without `?scope` the full response is unchanged.
4. **Cases list** - the page of documents is trimmed inside the database (`caseListSlimStage`): `canonicalHistory`, `auditHistory`, `knowledgePlan`, `questionnaireData` removed; `canonicalProfile` reduced to `{missingFields, conflicts}` and `timeline` to the last 5 - exactly what `summarizeCase` reads. Switch off with `CASE_LIST_SLIM=false`.
5. **Checklist reads** - `getQuestionnaireForCase` and `listCaseChecklists` skip `canonicalHistory` (they never save the case). Opening a document checks access on a lean case read.
6. **Documents** - a bounded in-memory cache of S3 objects (still encrypted, 10-minute TTL, 64 MB cap `STORAGE_READ_CACHE_MB`, dropped on every write/delete of that key): a second View/Download of the same file is instant.
7. **Opening a file** - the new tab is opened on the click itself and the file is loaded into it when it arrives (a tab opened after a long wait is blocked by the browser); a failure now closes that tab and shows the server's message.

## Verified on real data (read-only)
* Cases list: 967 KB -> 112 KB (8.6x smaller); `summarizeCase` identical for every case; every untouched field identical.
* Children-only vs full related: identical child and parent rows. Lean intake vs full intake: identical client. Case detail: identical apart from `canonicalHistory`.
* Tests: `cases/tests/case-lean-reads.test.js` (9), `uploads/tests/storage.read-cache.test.js` (5), updated `case-list-pagination.test.js`.

## Not changed / honest limits
* The remaining cost is the distance to the database: from a laptop in India to a database in us-east-1 each round trip is ~0.3 s and bandwidth is limited. A deployed backend in the same region as the database does not have this problem; for day-to-day development a database/S3 closer to the developer (or a local dump) would help most.
* The documents tab still reads each checklist (and the answers) the first time it opens.
* No data is written or changed by any of this; `canonicalHistory` etc. stay in the database untouched.
