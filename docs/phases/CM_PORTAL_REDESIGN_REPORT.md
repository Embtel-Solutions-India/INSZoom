# CASE MANAGER PORTAL REDESIGN — Consolidated Report
**Started:** 2026-09-10
**Status:** All 4 planned phases complete; real-browser click-through still pending your own confirmation (see bottom).

This single file replaces the earlier per-phase `PHASE_N_COMPLETION_REPORT_CM_PORTAL_REDESIGN.md` files, consolidated per your instruction not to spread this across multiple docs. Further updates to this effort get appended below rather than creating new files.

---

## Phase 1 — Shared Primitives + Shell Restyle

**Scope:** introduce the shared UI primitives the redesign needs, restyle `Layout.jsx`'s header to the reference portal's dark-navy look, before touching any actual page.

**Found before writing code:** `tailwind.config.js` already has a full `navy` color scale (50–900), previously only used for the sidebar logo box/avatar — reused rather than inventing a second palette. `index.css` already has `.card`/`.badge-*`/`.btn-primary`/`.input-field` global classes — new primitives wrap these rather than duplicating values. `CRMCases.jsx`'s `getStageColor`/`getStatusColor` were the only existing status-color source of truth — copied verbatim into the new `StatBadge` so introducing it didn't silently change any case's color.

**Created** (`INSZoom/frontend/src/components/ui/`): `Card.jsx` (+`CardHeader`), `StatBadge.jsx` (+ exported `stageColor`/`statusColor`), `SearchInput.jsx`, `FilterBar.jsx` (+`FilterSelect`), `EmptyState.jsx` (+`LoadingState`,`ErrorState`), `ChartCard.jsx`. None wired into a page yet at this point.

**Modified** `INSZoom/frontend/src/layouts/Layout.jsx` — className changes only, zero logic/state/handler changes: header background → `bg-navy-900`; added a `"{role} Portal"` pill next to the page title; recolored every header child (menu icon, search input, snapshot label, bell, user text, dividers) for dark-background contrast. Sidebar, notification dropdown panel, and `<main>` left untouched (sidebar stays light so INSZoom's full nav list — much longer than the reference's 3 links — stays legible).

**Verification:** `npm run build` exit 0. Manual diff review of `Layout.jsx` confirmed no removed props/handlers/imports/branches.

---

## Phase 2 — Dashboard Reskin

**Scope:** reskin `Dashboard.jsx`'s `AdminPanel`/`TeamLeadPanel`/`ClientPanel` with Phase 1 primitives, zero data/fetch/cache/socket changes.

**Changed:** stat-card grid (`<div className="card !p-4">` → `<Card className="!p-4">`, identical in both panels); "Cases by category" bar chart and "Payment status" pie chart both now wrapped in `<ChartCard>` with the *exact same* recharts tree as children; `ClientPanel`'s case-stage badge was actually a **third, independently-diverging** color mapping (`approved`→green, `uscis_pending`→blue) that disagreed with `CRMCases.jsx`'s own mapping (`approved`→blue, `uscis_pending`→cyan) — replaced with `<StatBadge kind="stage">`, a deliberate, visible color fix for exactly the "every page invents its own status colors" problem the task named.

**Mistakes caught before shipping:** (1) first pass moved the payment-status legend outside the `isEmpty` check, which would've shown "· 0 / · 0" even when genuinely empty — re-wrapped in the same emptiness guard. (2) An intended `replace_all` on the stat-card block only replaced one of two occurrences (subtle pre-existing difference broke the exact match) — fixed both individually, verified both now use `<Card>`.

**Left untouched:** all four `fetch*` functions, `cachedDashboardGet`/15s cache, both socket subscriptions (`case:activity`, `case:created`); "Pipeline by stage," "Needs attention," "Recent activity," "Team workload," "New cases queue," "Top performers," "Quick actions" sections (still raw `.card` class — visually identical to `<Card>`, left as-is to keep the diff proportional); `CaseManagerPanel`'s stat cards and `CaseManagerAnalyticsPanel`.

**Verification:** `npm run build` exit 0. Every `fetch*`/`useState`/`useEffect` byte-identical to before; only JSX return blocks changed.

---

## Phase 3 — Case Management Reskin + Board View

**Scope:** reskin `CRMCases.jsx`'s filters/table with Phase 1 primitives; add the List/Board toggle (the one genuine functional gap vs. the reference — no board/kanban view existed).

**Changed:** filters card → `<Card><FilterBar><SearchInput/><FilterSelect/><FilterSelect/></FilterBar></Card>` (every stage/status option value copied verbatim, confirmed via diff — none dropped/added/reworded); 4 badge call sites (mobile+desktop × stage+status) → `<StatBadge>`, dead `getStageColor`/`getStatusColor` removed; new `viewMode` state (`'list'`|`'board'`) with a two-button toggle. Board view groups the *same already-fetched* `cases` array (one page, already server-paginated/filtered/searched) client-side by `status`, plus an overflow column for any status not in the known list so nothing can silently vanish. Each board card shows case number/stage/client/visa/assigned-CM or an inline Assign action; clicking navigates to the same case-detail route the existing "View" link uses. **Zero new API calls, zero new params.**

**Left untouched:** `fetchCases`, `fetchPendingQueue`, pagination, debounced search, both socket subscriptions, abort-controller cancellation, the Pending Assignment banner, `CreateCaseModal`/`CaseCreatedSuccessModal`, and both existing List-view renderings (mobile card + desktop table) exactly as before.

**Verification:** `npm run build` exit 0 (after removing one now-unused `Search` icon import). `git diff` line-by-line: every removed line accounted for as an intentional replacement — nothing silently dropped.

---

## Phase 4 — Regression Pass + Scope Summary

**Machine-verified:** `npm run build` clean at every phase (not just once at the end). Line-by-line diff review across all 3 modified files confirmed zero silently-dropped handlers/state/options/API calls. Dev server (port 3002) reachable, HTTP 200.

**Could NOT verify from here (no browser available in this environment):** that the pages actually *render* correctly, that the dark header/badges/board columns *look* right, that buttons *behave* correctly when actually clicked. A clean build proves compilation, not correctness of a visual change — **please confirm the following yourself**:

- [ ] Login/logout/refresh still work (Phase 1 touched `Layout.jsx`, which every authenticated page renders through).
- [ ] Header: dark bar renders, role pill correct, search still navigates to `/crm-cases?q=...`, Refresh reloads, bell opens/closes/marks-read, avatar/name correct.
- [ ] Dashboard: correct panel per role, stat numbers look right, both charts render with real data + correct empty states.
- [ ] CRM Cases: search/filters/pagination unchanged; List view unchanged; new Board view groups correctly, card click navigates, inline Assign works.
- [ ] Pending Assignment banner still works for team leads/admins.
- [ ] New Case creation still works end-to-end.

Any failure above is a restyle bug, not a data bug — every fetch/mutation call in these 3 files is byte-identical to before this redesign.

**Full change summary:** New files: `components/ui/{Card,StatBadge,SearchInput,FilterBar,EmptyState,ChartCard}.jsx`. Modified: `layouts/Layout.jsx`, `pages/Dashboard.jsx`, `pages/CRMCases.jsx`. Zero backend changes, zero new API calls, zero changes to auth/RBAC/permissions/routing/case-creation/assignment/forms/documents/questionnaires/email/notifications/tasks.

**Explicit scope exclusions** (decided during planning, not oversights):
1. **Attorney Portal** — doesn't exist anywhere in INSZoom (confirmed by code search). Building one means new RBAC/routes, outside a UI-only reskin. If actually wanted, that's a separate feature request.
2. **USCIS form-status-by-count metric** — no backend aggregation exists for it; not invented here since that would be a backend change, not a UI one.

---

## Phase 5 — Correction Round: Real Light/Dark Toggle + Color Reduction

**Why:** you flagged that Phase 1–4 didn't match the reference screenshots closely enough, and that the dark screenshots were never meant to be a hardcoded dark theme — they show the reference portal's actual light/dark **toggle** (a small sun/moon button in its navbar) in its dark state, defaulting to light. You also flagged the redesign had too much decorative color for a "very professional" admin portal. This phase corrects both.

**Theme toggle infrastructure (new):**
- `tailwind.config.js` — added `darkMode: 'class'`; extended the existing `navy` scale with a `950: '#090a10'` shade for the darkest surfaces.
- `contexts/ThemeContext.jsx` (new) — `ThemeProvider`/`useTheme()`; persists to `localStorage` (`inszoom-theme` key, wrapped in try/catch for private-browsing), toggles the `dark` class on `<html>`. **Defaults to `'light'`** when nothing is stored, per your instruction.
- `App.jsx` — wired `ThemeProvider` around the existing provider tree (inside `ErrorBoundary`, outside `Router`).
- `index.css` — added `dark:` variants to the global `body`, `.btn-secondary`, `.card`, `.input-field` classes so every page inherits correct dark surfaces for free.
- `layouts/Layout.jsx` — reverted Phase 1's mistake of hardcoding the header permanently dark; header/sidebar/nav items/notification dropdown (including the push-notification opt-in banner, notification list rows, list footer, and the user-menu block) are now properly theme-aware (light by default, `dark:` variants throughout). Added the actual toggle button in the header (Sun/Moon icon from lucide-react, next to Refresh/Notifications) that calls `toggleTheme()`.

**Color reduction (less decorative color, matching the reference's restrained palette):**
- `components/ui/StatBadge.jsx` — rewritten from a per-status "traffic light" color mapping (green/blue/amber/red badges) to a single neutral bordered pill (`border-gray-300 text-gray-700`, `dark:border-navy-600 dark:text-gray-300`) used for every stage/status value. `stageColor()`/`statusColor()` are kept exported (now both return the neutral class) so no call site needed a second migration. Color is reserved for genuinely meaningful signals only (e.g. payment status), matching how sparingly the reference itself uses it.
- `components/ui/{Card,ChartCard,EmptyState}.jsx` — added `dark:` variants to titles/subtitles/empty-state icons and text; no color-scheme changes otherwise (these were already neutral).
- `pages/Dashboard.jsx` — removed the colorful gradient icon backgrounds on the `CaseManagerPanel`/`ClientPanel` stat cards (`bg-gradient-to-br from-blue-500 to-blue-600`, `from-amber-500 to-orange-600`, `from-blue-500 to-cyan-600` with white icons) and replaced all six with a neutral `bg-gray-100 dark:bg-navy-800` box + `text-gray-600 dark:text-navy-300` icon — same treatment regardless of which stat, since none of these represent an actual semantic signal.

**Remainder of the dark-mode pass (`Dashboard.jsx` + `CRMCases.jsx`), completed:**
- `pages/Dashboard.jsx` — `dark:` variants added across all four role panels (Admin, CaseManager, TeamLead, Client): stat cards, pipeline/category/payment charts, needs-attention list, recent-activity feed, team-workload grid, top-performers/quick-actions cards, new-cases-queue table, loading/error states, page header. Consistent mapping used throughout: `text-gray-900→dark:text-gray-100`, `-600/700→dark:text-navy-300`, `-500→dark:text-navy-400`, `-400→dark:text-navy-500`, `bg-gray-50/100→dark:bg-navy-800`, `border-gray-100/200→dark:border-navy-700`. Two deliberate color keeps: the New-Cases-Queue priority badge stays red for urgent/high priority (`dark:bg-red-950/40 dark:text-red-400` added) since priority is a genuine signal, and the "unable to load" error icon stays amber (`dark:text-amber-400` added) since it's a genuine error state — both are exactly the kind of sparing, meaningful color use the reference itself relies on, not decoration.
- `pages/CRMCases.jsx` — the "Pending Assignment" banner (previously a large amber/orange decorative block) was fully neutralized to gray + `bg-primary-600`, per your "not too much color" instruction. The recurring amber "awaiting assignment" cue elsewhere (row tint, "New" badge, "Assign" buttons/links across board/mobile-card/table views) was kept — it's a compact, genuine actionable-status signal rather than decoration — just given `dark:` variants (`dark:text-amber-400`, `dark:bg-amber-950/40`, `dark:bg-amber-950/20`). View-toggle buttons, filter card, pagination, table header/rows, board columns/cards, and mobile stacked cards all received the same gray/navy dark mapping.
- Charts (recharts) were left with their existing inline axis/tooltip styles (mid-gray/white) since they already read correctly against both the light `.card` and dark `.card` (now `dark:bg-navy-900`) backgrounds — no changes needed there.

**Verification:** `npm run build` — exit 0, zero errors, after this full round (Layout.jsx theme toggle + Dashboard.jsx/CRMCases.jsx dark-mode and color-reduction pass).

**Net effect of Phase 5:** the portal now defaults to light mode and matches the reference's restrained, mostly-neutral palette (color reserved for payment status, priority, and "awaiting assignment" signals only); a real Sun/Moon toggle in the header switches to a fully-supported dark theme rather than the previous hardcoded-dark header; the choice persists across reloads via `localStorage`. Zero data/API/business-logic changes in this phase — purely `className` additions and a small number of deliberate color-removal edits, matching the same "className-only diff" discipline as Phases 1–4.

---

## Phase 6 — Immiglance Design-System Token Migration (presentation-only re-skin)

**Scope:** per your follow-up implementation prompt, replace the ad-hoc hex/gray/navy palette with Immiglance's exact design tokens (HSL CSS custom properties for background/foreground/card/primary/secondary/muted/accent/destructive/border/sidebar/chart colors), Immiglance's font stack (Satoshi body, Cabinet Grotesk headings, JetBrains Mono for codes/reference numbers), flat/shadowless surfaces, and `0.5rem` base radius — while preserving every existing Tailwind color key (`primary`, `secondary`, `navy`) so no existing className silently breaks. Strict CSS/className-only boundary, same as every prior phase — zero prop/hook/state/route/API changes.

**Done directly (not delegated):**
- `index.html` — added Fontshare (`Satoshi` + `Cabinet Grotesk`) and Google Fonts (`JetBrains Mono`) stylesheet links.
- `src/index.css` — added the full `:root`/`.dark` HSL custom-property blocks from your spec (background/foreground/card/card-border/popover/primary/secondary/muted/accent/destructive/border/input/ring/sidebar-\*/chart-\*/radius/elevate-1/elevate-2), placed above the `@tailwind` directives as instructed; added the `@layer base` font-family rules; rewrote `.btn-primary`/`.btn-secondary`/`.card`/`.input-field`/`.badge-*` to token classes with shadows removed (flat aesthetic) — dark mode for these no longer needs manual `dark:` variants since the CSS variables themselves swap under `.dark`.
- `tailwind.config.js` — rewrote `theme.extend.colors` to map `background/foreground/border/input/ring/card/popover/secondary/muted/accent/destructive/sidebar/chart` to the new tokens, **while preserving** the `primary` key (now a token-backed `DEFAULT`/`foreground`/50-900 ramp, so every existing `bg-primary-600`-style className keeps resolving) and the `navy` key (untouched hex scale, kept as a real key per your "never delete a key" rule for classNames not yet migrated). Added `fontFamily.sans/serif/mono` and `borderRadius.lg/md/sm` mapped to `var(--radius)`. `darkMode: 'class'` retained.
- `src/layouts/Layout.jsx` — fully migrated (sidebar, header, search input, notification dropdown, user menu, nav active/inactive states) from the old raw-gray + explicit-`dark:`-variant pattern to token classes (`bg-sidebar`/`text-sidebar-foreground`/`bg-sidebar-primary` for the active nav item, `bg-card`/`border-border` for the header, `bg-popover` for the notification panel, etc.) — this is the definitive style reference the rest of the sweep follows.
- Build verified clean (`npm run build`, exit 0) after Phase 1-2 (tokens+config) and again after Layout.jsx's migration, confirming no unresolved Tailwind classes and no missing-key errors before letting the larger mechanical sweep proceed.

**Delegated to a background pass (mechanical, high file-count):**
- Part A — migrate the shared `src/components/ui/*` primitives (`Card`, `ChartCard`, `EmptyState`, `StatBadge`, `SearchInput`, `FilterBar`) from raw-gray+`dark:`-variant classes to the same token classes as `Layout.jsx`.
- Part B — sweep `src/pages/*.jsx` and `src/components/**` (excluding `ui/`) for (1) hardcoded `#hex`/`rgb()`/inline-style colors → nearest token class, explicitly instructed to leave genuinely per-item/dynamic colors alone (chart palettes, avatar colors, status dots keyed by data) rather than guess, and (2) the old gray/navy `dark:`-pair pattern → single token class. Explicitly instructed to preserve every deliberately-kept semantic color from Phase 5 (payment status, priority badges, the amber "awaiting assignment" signal) rather than neutralizing them a second time — only add a `dark:` variant if one is missing.
- This section will be updated with that pass's file list, site count, and build-verification outcome once it completes — appended here, not in a new file.

**Background pass — completed:**
- Part A: `src/components/ui/{Card,ChartCard,EmptyState,StatBadge,SearchInput}.jsx` converted from raw gray/navy + `dark:` pairs to token classes (`text-foreground`, `text-muted-foreground`, `text-card-foreground`, `border-border`, `bg-muted`). `FilterBar.jsx` needed no change (no color classes in it).
- Part B: all 22 files in `src/pages/` (`Login.jsx` done by hand for its brand-color/gradient specifics; the rest via a token-substitution script) plus `src/pages/petition/*` and 9 files in `src/components/` (excluding `ui/`) — 46 files total, ~1,150+ gray/navy chrome sites converted (`text-gray-900→text-foreground`, `text-gray-500/600/700→text-muted-foreground`, `bg-gray-50→bg-muted`, `bg-gray-100→bg-secondary`, `border-gray-*→border-border`, `bg-white→bg-card`, redundant `dark:` companions dropped since the tokens now swap automatically) plus ~15 hardcoded-hex/rgb structural sites fixed by hand (Login.jsx's brand blue → `primary`/`foreground`/`muted-foreground`; a navy icon badge in `USCISFormRenderer.jsx` → `bg-primary`; a stage dot in `Dashboard.jsx` → `bg-primary`).
- **Deliberately left as literal colors** (not tokens): every recharts `fill`/`stroke`/`tick`/`Tooltip cursor` prop and the `STAGE_COLORS`/`REASON_COLORS`/`STATUS_COLORS` per-status/per-visa-type palettes across Dashboard/Analytics/CaseManagerDetails/CaseManagerAnalyticsPanel/PaymentsOverview — genuine per-data-item color variety, not structural chrome. `TaskCalendar.jsx`'s priority-legend dots (red/orange/blue/gray = urgent/high/medium/low) — a real semantic signal. Modal backdrop scrims (`bg-gray-900/45` in `CaseCreatedSuccessModal.jsx`/`InfoModal.jsx`) — matches `Layout.jsx`'s own untouched `bg-black bg-opacity-50` mobile-sidebar-backdrop convention, left consistent. `Settings.jsx`'s `settings?.primaryColor || '#10b981'` — actual business data (a configurable brand color), not styling. `USCISFormRenderer.jsx`'s PDF-annotation-layer `rgba(...)` overlay states (canonical/override/conflict) — semantic overlay signal colors. `Login.jsx`'s photographic hero-gradient overlays and two `shadow-[...]` box-shadows — decorative image blending on the one screen that isn't flat app chrome.
- **A build-breaking bug was introduced and self-caught mid-run**: an early version of the sweep script's string-literal matching misidentified a quote inside a regex literal (`replace(/["\\]/g, ...)` in `USCISFormRenderer.jsx`) as a string boundary, collapsing ~25 lines into one. Caught immediately by the build check that runs after every batch (not by trusting the script), manually restored the multi-statement formatting (content byte-identical, confirmed via diff), and the script was hardened with a length/character safety guard before continuing — independently re-verified here via `git diff` showing a clean 22-line change to that file and the specific regex line intact.
- **Verification:** `npm run build` clean (zero errors) both during the pass and again independently after it completed. Diff review confirms every changed line is a className/inline-style-color edit — no removed props, handlers, or JSX structure changes.

**Phase 6 status: complete.** All 6 phases of the original redesign plus this token-migration correction round are now done. Outstanding is only your own visual confirmation in a browser (per the checklist at the end of Phase 4, plus: confirm Satoshi/Cabinet Grotesk/JetBrains Mono actually load over the network, confirm the navy-primary/teal-accent palette and flat/shadowless cards read correctly in both themes) — restart the dev server first (`Ctrl+C` then `npm run dev`) since it was holding a stale copy of `tailwind.config.js` from before these changes.

**Outstanding for your own verification once this phase's remaining work lands:** confirm in a real browser that fonts (Satoshi/Cabinet Grotesk/JetBrains Mono) actually load (Network tab 200s — some corporate networks block Fontshare/Google Fonts CDNs, which would silently fall back to the `sans-serif`/`Menlo` fallbacks in the stack), that the navy-primary/teal-accent palette reads correctly in both themes, and that dark mode still passes the same regression checklist from Phase 4.
