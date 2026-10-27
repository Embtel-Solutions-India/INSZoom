# USCIS News Synchronization and News & Updates Portal

Status: implemented and tested (2026-10-28). Public pages live at `/news` and `/news/:slug` on the Immiglance Landing site.

## 1. Audit of the existing architecture (Phase 1)

| Question | Finding (traced in the repository) |
| --- | --- |
| Public site | `Immiglance/Landing/` - Vite + React 19 + React Router 7 + Tailwind 4 SPA (dev :5173). Public, never behind `AuthGate`; separate from `Immiglance/Client/`, `Admin/`, `Attorney/`. |
| Navbar / routing / layout | `components/Navbar.jsx` (`LINKS`), routes in `App.jsx`, `layout/MainLayout.jsx`. Theme tokens (`bg-card`, `border-border`, `text-foreground`, `bg-primary`, light + dark) in `index.css`. The "Latest USCIS Forms" page (`Pages/Forms/Forms.jsx`) was the sibling design reference. |
| Backend | `Backend/` - Node 22, Express 4, Mongoose 8, one MongoDB connection, one router table (`src/routes/index.js`). Public read-only precedent: `/api/public-forms`. Staff APIs: `authenticate` + `authorizeRoles`. |
| Models / indexes | `Backend/src/models/*.js`, indexes on the schema. No migration framework. |
| Schedulers | `setInterval` jobs wrapped in `withJobLock(name, ttl, fn)` (`utils/jobLock.js`, MongoDB lease with heartbeat and token fencing - safe across restarts and instances). Reused as is. |
| Logging / errors | `utils/logger` (redacting), `middleware/errorHandler`, public routes set `Cache-Control` and use `express-rate-limit`. |
| Dependencies | No HTML parser or sanitizer existed. **Added to `Backend/package.json` + lockfile: `cheerio` ^1.2.0, `sanitize-html` ^2.18.1.** |

Decision: everything lives in the existing backend (`Backend/src/modules/news/`) and the existing Landing app (`Pages/News/`). No new application, no second DB connection, no new scheduler.

## 2. Source verification (Phase 2) - verified live 2026-10-28

* `https://www.uscis.gov/newsroom/all-news` links its RSS feed as **`https://www.uscis.gov/news/rss-feed/59144`**: RSS 2.0, 249-250 items (news releases + alerts), newest first, back to Nov 2024, with `ETag`, `Last-Modified`, `Cache-Control: max-age=900`.
* **`/news/rss-feed/all` is NOT the news feed** (it lists every updated page on uscis.gov). It must not be used.
* Feed items carry title, link, description (**an excerpt only**), `dc:creator`, `guid` and a `pubDate` with a **two-digit year** (`Mon, 26 Oct 26 11:44:18 -0400`; `Date.parse` reads it as 1926 - a dedicated parser handles it). No full text, no images.
* Address shapes: `/newsroom/news-releases/<slug>` (170), `/newsroom/alerts/<slug>` (79), and a few older `/newsroom/<slug>` items. The section of the address becomes the category (`news-release`, `alert`, `news`); nothing is guessed.
* Article pages are server-rendered Drupal: `article.node--type-news-item` containing `h1.page-title`, `.field--name-field-display-date time[datetime]` (release date), one `.field--name-body`, `.field--name-field-reviewed-updated-date time[datetime]` ("Last Reviewed/Updated"); `<link rel="canonical">` present. Verified on long alerts (nested ordered/unordered lists, inline links), short releases, and articles with images (3, 9 and 1 images in the first ten imported). No table-bearing article was found in the sample; tables are covered by fixtures.
* `robots.txt`: **`Crawl-delay: 10`**; `/newsroom/` and `/news/rss-feed/` are not disallowed. The client never goes below a 10 s gap between requests and identifies itself (`ImmiglanceNewsSync/1.0 (+https://immiglance.com; ...)`).
* No authentication, anti-bot or access control was met or bypassed. A 401/403/404 is recorded as a failure, never worked around.

## 3. Architecture

```
USCIS RSS feed ─► NewsSyncService ─► NewsArticle (MongoDB) ─► /api/news (public, read-only) ─► Landing /news, /news/:slug
 (conditional GET)   │  feed → stubs → bounded article imports        ▲
USCIS article pages ─┘  (uscisHttp: allowlist, pacing, retries)       └─ /api/news/admin/* (staff only)
                        articleExtractor: cheerio + sanitize-html
```

### Backend files (`Backend/src/`)

| File | Role |
| --- | --- |
| `models/NewsArticle.js` | the article (see §4) |
| `models/NewsSyncRun.js` | one record per synchronisation run |
| `modules/news/news.config.js` | all environment-driven settings, allowed hosts, URL sections |
| `modules/news/uscisHttp.js` | the only network client: https + `uscis.gov` allowlist (SSRF), per-hop redirect validation, crawl-delay pacing, timeout, size cap, conditional requests, bounded exponential retry |
| `modules/news/feedParser.js` | RSS parsing, two-digit-year dates, address validation/normalisation, feed-entry digest |
| `modules/news/articleExtractor.js` | page → title, dates, sanitised body, images, hash, warnings (§5) |
| `modules/news/NewsRepository.js` | persistence behind a small interface (an in-memory twin is used in tests) |
| `modules/news/NewsSyncService.js` | the synchronisation (§6) |
| `modules/news/news.job.js` | scheduler tick, started from `server.js` |
| `modules/news/news.service.js`, `news.admin.service.js`, `news.routes.js` | read API and staff operations |
| `server.js` (3 lines), `routes/index.js` (1 line) | start the job; mount `/api/news` |

### Frontend files (`Immiglance/Landing/src/`)

| File | Role |
| --- | --- |
| `Pages/News/News.jsx` | listing: search, type filter, database-side pagination, loading/empty/error states, official-source link |
| `Pages/News/NewsArticle.jsx` | article page: exact title, both source dates, attribution, original link, body, explicit completeness notice, not-found page |
| `Pages/News/news.css` | styles scoped under `.news-article-body` (imported only by the article page) |
| `Pages/News/newsFormat.js` | date formatting (US Eastern, as USCIS publishes) |
| `App.jsx` | two lazy routes under `MainLayout` |
| `components/Navbar.jsx` | "News & Updates" link; links no longer wrap at 1024 px |
| `components/SiteFooter.jsx` | "USCIS News & Updates" footer link |

## 4. Database model (`newsarticles`)

Unique: `canonicalUrl`, `slug`. Other indexes: `{listed, publishedAt:-1}`, `{listed, category, publishedAt:-1}`, `{syncStatus, nextAttemptAt}`, `{needsRefresh}`, `{sourceGuid}` (sparse), text index `news_text` (title ×10, excerpt ×4, bodyText ×1). Mongoose creates them on first start (`autoIndex`); no migration is needed.

Fields: `source`, `sourceUrl`, `canonicalUrl`, `sourceGuid`, `slug`, `category`, `title`, `publishedAt` + `updatedAtSource` (the source's own dates, separate from `createdAt`/`updatedAt`), `excerpt` (the feed's text), `contentHtml` (sanitised), `bodyText` (search only, never returned), `images[]` (sequence, src, alt, caption, credit, width, height, rights, originalSrc), `contentHash`, `syncStatus` (`pending | complete | incomplete | failed | duplicate`), `syncWarnings`, `listed`, `lastSyncedAt`, `lastCheckedAt`, retry state (`attempts`, `lastError`, `nextAttemptAt`), refresh state (`needsRefresh`, `feedDigest`, `pendingFeedDigest`), HTTP validators (`etag`, `lastModified`). `NewsSyncRun` records each run: trigger, status, feed result, counts, backlog, failures.

## 5. Fidelity, sanitising and images

* The body is read exactly as published: the article container only (the site header/footer/menus/banners/scripts are never copied); no LLM, no rewording. Block structure, heading order, nested lists (including `type="i"` numbering), tables (header cells, captions, spans), blockquotes, emphasis, alignment classes and links are kept.
* **Fidelity guard:** the visible text before and after sanitising must be identical (blocks are spaced the same way on both sides; inline spaces are compared exactly). A difference marks the article *incomplete* with a warning. This guard caught a real bug during development (a whitespace-only `<span>` holding the space in "United States").
* **Allowlist sanitiser:** a fixed tag/attribute/class list; scripts, styles, event handlers, `javascript:`/`data:` URLs, forms, iframes, objects, SVG and unknown tags are removed (unknown tags are unwrapped, their words stay). Relative links become their absolute `uscis.gov` destination; every web link gets `target="_blank" rel="noopener noreferrer"` and is marked and announced on the page as opening a new tab. A body `h1` is shown as `h2` (the page title is the only `h1`).
* **Never silent:** embedded media, an unread content block, an image that cannot be reproduced, or a text difference produce a warning and `syncStatus = incomplete`. The article page states this and links to the original. `notice:` warnings are informational only.
* **Images - policy:** images are **referenced at their original `uscis.gov` address; no bytes are copied, stored or re-hosted** (`rights: "linked-from-source"`), with alt text, width/height, order and (when USCIS gives them) captions kept; they render responsively (`max-width:100%; height:auto`, never cropped). An image from any other host, a `data:` image, a non-https image, or any image when `NEWS_SYNC_IMAGE_MODE=omit` is **not reproduced**: only its caption/credit is kept, a small notice is shown, a warning is recorded and the article is marked incomplete. No stock, generated or invented images.
* Treat all fetched content as untrusted: server-side allowlist sanitising is the control; the client renders only the stored, sanitised HTML.

## 6. Synchronisation

1. **Feed** - conditional GET (stored `ETag`/`Last-Modified`; a 304 = nothing new). Each valid entry (https, `uscis.gov`, newsroom article) is stored once as a `pending` stub (never shown publicly). An existing entry whose title/excerpt/date digest changed is flagged `needsRefresh` - articles are identified by canonical URL and refreshed on *content* change signals, not by publication date.
2. **Articles** - per run, at most `NEWS_SYNC_MAX_ARTICLES_PER_RUN` (20), one request at a time at the crawl-delay pace, in this order: new, changed, failed, then the oldest unchanged ones (a periodic re-check after `NEWS_SYNC_REFRESH_AFTER_HOURS`, default 7 days, using the stored validators - catches body-only edits). The first backfill of the ~250 feed entries runs in ~13 runs at 2-minute spacing, then settles to the normal interval.
3. **Failures** - one failing article never stops the others. Transient failures (network, 429, 5xx) are retried inside the request up to `NEWS_SYNC_MAX_RETRIES` (2 s, 4 s, 8 s ...), then on later runs with back-off (15 min doubling, capped at 6 h). After `NEWS_SYNC_MAX_ARTICLE_ATTEMPTS` (5) a never-imported article is shown with its excerpt and the official link (`failed`) - unless the page is a 404/410/403, in which case it is not listed (a dead link is not offered). An article that was imported before **keeps its stored text** when a refresh fails (a 404 later only adds a visible warning).
4. **USCIS down** - if the feed itself is unreachable the run is recorded as failed and no article is requested. The public pages only read MongoDB, so they are unaffected.
5. **No overlap** - `withJobLock("news-sync")` (MongoDB lease, 15 min, heartbeat) plus an in-process flag; scheduled, manual and multi-instance runs cannot overlap. A run left `running` by a crashed process is closed as failed by the next run. A restart just restarts the clock (waiting articles live in MongoDB).
6. **Duplicates** - impossible by the unique indexes; two addresses of one article become a hidden `duplicate`.

## 7. API

Public (read-only, rate limit 120/min/IP, `Cache-Control: public`):

| Route | Purpose |
| --- | --- |
| `GET /api/news?page=&limit=&q=&category=` | listed articles, newest first; `limit` 1-50 (default 12), `page` 1-1000, `q` ≤100 chars (MongoDB text index, relevance first), `category` ∈ `news-release | alert | news`. Returns `items, page, limit, total, totalPages, hasMore, source` |
| `GET /api/news/latest` | newest article's slug/title/dates |
| `GET /api/news/:slug` | one article; `contentStatus` = `complete | incomplete | unavailable`, `warnings`, `sourceUrl`, `source`; 404 for an invalid or unknown slug |

Staff only (`authenticate` + roles `super_admin`, `admin`, `team_lead`):

| Route | Purpose |
| --- | --- |
| `GET /api/news/admin/status` | enabled flag, settings, article counts by status, last/recent runs |
| `GET /api/news/admin/failures?limit=` | failed / incomplete / erroring articles with warnings and errors |
| `POST /api/news/admin/sync` `{force?}` | start a run in the background (202; 409 if one is running) |
| `POST /api/news/admin/retry-failed` | clear back-off of failed/waiting articles and start a run |

## 8. Configuration (all optional)

| Variable | Default | Meaning |
| --- | --- | --- |
| `NEWS_SYNC_ENABLED` | `true` | `false` switches the scheduled job off (stored articles keep being served) |
| `NEWS_SYNC_FEED_URL` | `https://www.uscis.gov/news/rss-feed/59144` | must stay on `uscis.gov` |
| `NEWS_SYNC_INTERVAL_MS` | 1 800 000 (30 min; min 5 min) | normal spacing of runs |
| `NEWS_SYNC_BACKLOG_INTERVAL_MS` | 120 000 | spacing while articles are waiting |
| `NEWS_SYNC_INITIAL_DELAY_MS` | 120 000 | first run after start |
| `NEWS_SYNC_REQUEST_DELAY_MS` | 10 000 (**floor 10 000**, the site's crawl-delay) | gap between requests |
| `NEWS_SYNC_REQUEST_TIMEOUT_MS` | 20 000 | per request |
| `NEWS_SYNC_MAX_RETRIES` | 3 | in-request retries |
| `NEWS_SYNC_MAX_ARTICLES_PER_RUN` | 20 | bound per run |
| `NEWS_SYNC_MAX_ARTICLE_ATTEMPTS` | 5 | attempts before the official-link fallback |
| `NEWS_SYNC_REFRESH_AFTER_HOURS` | 168 | periodic re-check of unchanged articles |
| `NEWS_SYNC_MAX_BYTES` | 5 242 880 | response size cap |
| `NEWS_SYNC_IMAGE_MODE` | `link` | `omit` = never reference any image |
| `NEWS_SYNC_USER_AGENT` | `ImmiglanceNewsSync/1.0 (+https://immiglance.com; ...)` | identification |

No new secrets are needed.

## 9. Tests (all DB-free and network-free unless noted)

Backend `src/modules/news/tests/` - **60 tests, all passing**:
* `feedAndExtractor.test.js` (19): date parsing, address allowlist, real feed sample (7 entries incl. the `/newsroom/<slug>` shape), two real article fixtures, exact-text fidelity, order of headings/lists/tables/quotes, link rules, images (linked / not reproduced / omit), hostile HTML, unread blocks, failures that invent nothing.
* `uscisHttp.test.js` (10): SSRF allowlist (look-alikes, internal IPs, credentials, ports, redirects to internal hosts), crawl-delay floor and pacing, conditional requests, retry/back-off bounds, no retry on 404/403, size cap, timeout.
* `NewsSyncService.test.js` (22): new article appears; no duplicate across runs; feed 304; updated article refreshed in place; body-only edit via periodic re-check + validators; bounded batches and backlog; one failure does not stop others; back-off; fallback after attempts; failed refresh keeps content; withdrawn article keeps text + warning; incomplete import; USCIS outage; non-RSS feed; foreign/internal feed links ignored; slug collisions; duplicate canonical; run overlap guard; interrupted-run recovery and retry.
* `newsApi.test.js` (9): parameter bounds, database-side query shape, content status, invalid slug never queried, public routes, controlled DB error, staff endpoints require authentication (401 without/with a forged token), `admin` cannot be a slug, staff 202/409/retry flows.

Frontend `src/Pages/News/News.test.jsx` - **11 tests passing** (listing fields, summary-only marker, debounced search, type filter and pagination, empty and error states with retry, article fields/order/links/not-found/incomplete/unavailable/server-error).

Live verification against uscis.gov (real client + real feed, in-memory store, no database): 250 feed entries parsed, 10 articles imported in 100 s (crawl-delay respected), **10 complete, 0 failed, 0 warnings**; articles with images kept them in order with alt and dimensions. Visual check (Chromium, mocked API): 1440, 1024, 768 and 390 px - no horizontal overflow, no page errors, long titles/words wrap, wide table scrolls inside its own box, image proportions kept.

Regression: Landing `npm run build` passes. `App.test.jsx` "eligibility quiz standalone" fails **both with and without these changes** (pre-existing). Backend `npm run test:safe` (356 files, real-DB files never run): at the time of writing the run showed the same 18 failures as the pre-change baseline and none in the news module; the news tests are included and pass.

## 10. Deployment

1. Deploy the backend (new dependencies `cheerio`, `sanitize-html` are in `package.json`/`package-lock.json`: `npm ci`). Restart the backend: the job starts 2 minutes after boot; indexes are created automatically.
2. Build and deploy Landing (`cd Immiglance/Landing && npm run build`). No server/route configuration change is needed beyond the SPA fallback Landing already uses (`/news`, `/news/:slug` are client routes).
3. Optional: set the `NEWS_SYNC_*` variables above. Release switch: `NEWS_SYNC_ENABLED=false` keeps the job off (the routes and navbar link still work and show "No news has been imported yet").
4. First backfill: ~250 stubs are created in the first run; articles import ~20 per run at 2-minute spacing (about 25-30 minutes in total, dominated by the 10 s crawl-delay).
5. Monitoring: `GET /api/news/admin/status` and `/admin/failures`; logs `news_sync_finished`, `news_sync_article_failed`, `news_sync_feed_failed`.
6. Manual recovery: `POST /api/news/admin/retry-failed` (clears back-off), `POST /api/news/admin/sync {"force":true}` (ignores conditional requests).

## 11. Rollback

Set `NEWS_SYNC_ENABLED=false` and restart (stops all USCIS traffic). To remove the feature entirely: revert the navbar/footer/route lines, remove the `/news` mount in `routes/index.js` and the 3 job lines in `server.js`; the `newsarticles` and `newssyncruns` collections can be dropped (`db.newsarticles.drop()`); no other collection is touched. The two npm packages can stay.

## 12. Known limitations

* **Image rights are not verified per image.** USCIS is a federal agency, but a photo can carry a third-party credit that the page does not state. Images are therefore only *referenced* at uscis.gov (never copied) and can be switched off with `NEWS_SYNC_IMAGE_MODE=omit`. There is no image caching on Immiglance storage.
* The feed gives no categories, so only the address-derived type (News Release / Alert / News) is filterable.
* The listing excerpt is the feed's own description; if the feed has none, none is shown (nothing is generated).
* The Landing site is a client-rendered SPA: article pages are not server-rendered, so link previews/SEO rely on crawlers executing JavaScript (the same as every Landing page).
* A body-only edit that does not change the feed entry is picked up by the periodic re-check (up to 7 days by default, tunable), not immediately.
* The feed holds ~250 items (Nov 2024 onward); older newsroom history is not imported.
* Embedded media (video/iframe) is not reproduced and is reported as such.
