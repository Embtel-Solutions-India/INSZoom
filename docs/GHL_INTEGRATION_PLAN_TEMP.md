# GoHighLevel (GHL) Integration: Implementation Plan (TEMP), Revision 3.1

Status: **Phases 1 to 5 are built and tested. Revision 3.1 is approved. R3-1 (two separate pipeline boards) is DONE and verified. Next: R3-2. Work proceeds one phase at a time, with a report after each.**
Scope: Backend, Admin frontend, Client portal (employer view). Landing and Attorney portals are not touched.

### What changed in Revision 3

| # | Change |
|---|---|
| 1 | **Two separate boards.** The Immigrant and Non-Immigrant GHL pipelines are no longer merged into one. Each has its own board (tabs), tied to its own GHL pipeline (§5.1). |
| 2 | **Stage mapping is per pipeline.** The rule "both pipelines must have identical stages" is dropped. Drift detection stays, per pipeline. |
| 3 | **One opportunity = one individual case card.** For two-party visas, the GHL name and email are the **employer / petitioner**, and each opportunity is **one employee / beneficiary** (§3, §5.3, §5.5). |
| 4 | **Service Type drives the visa** through an editable mapping table (§5.2). It replaces the earlier "single-party visas only" restriction. |
| 5 | **Employer model reused, not rebuilt.** Many opportunities with the same employer email attach to **one shared employer** (one `EmployerProfile`), even when the employees have different visas and sit in different pipelines (§5.3, §5.4). |
| 6 | **Outbound grows:** adding an employee in Immiglance **creates a GHL opportunity**; removing one marks it abandoned, restoring reopens it (§5.6). |
| 7 | **Codebase findings added** (§2), including eight gaps that shape the phases. |
| 8 | **Phases re-planned** as R3-1 to R3-7 (§9). |
| 9 | Carried over from Revision 2 and still true: no fake visa, conflict rule, webhook security, queue invariants, field ownership, safety rules. |

### What changed in Revision 3.1 (after review)

| # | Change |
|---|---|
| A | **Employer matching is a strategy, not an identity.** Email is the first matching signal only. The match order is: existing GHL-linked employer, then exact normalised email, then anything ambiguous goes to **Needs Attention**. Nothing is ever silently attached to an uncertain employer (§5.3, decision 1). |
| B | **The employer is a shared party, not a visa case.** Creating an employer from GHL must not start the normal visa-driven employer workflow from the first employee's visa alone. Visa-specific employer questions belong to the individual employee case (§5.3, §5.4, R3-6). |
| C | **R3-6 is a release gate.** H-1B-only (single-visa) employers can go live after R3-3 and R3-4. **Mixed-visa employers are not declared production-ready until R3-6 passes** (§9). |
| D | **GHL contact = primary contact for the opportunity,** interpreted by the case structure as client (single-party), employer (employment) or petitioner (family), not hard-coded as "employer/petitioner" (§3, §4). |
| E | **Parent relationship rule:** a two-party employee / beneficiary card cannot exist without its employer / petitioner. Single-party visas stay independent (§3). |
| F | **GHL stage and Immiglance workflow stage stay independent in both directions.** Moving the GHL card never starts a workflow step, and a workflow change never moves the GHL card unless explicitly decided later (§1). |
| G | **Employee name** is written to GHL only as a **display name** once the employee is identified ("ABC Technologies, John Smith"). The initial name is the employer's. Identity is always `locationId + opportunityId` (§5.6). |
| H | **Family scope is stated honestly:** R3-5 delivers petitioner matching, beneficiary case creation, GHL linking and stage sync. It does **not** solve repeated petitioner questions; that is R3-6 (§5.5, §9). |
| I | **New tests:** shared employer update, parent-relationship rule, contact interpretation, mixed-visa gate (§11). |
| J | **Decisions** now carry proposed answers for you to confirm (§12). |

---

## 1. Goal

Add GHL as a **third source of cases**, next to Lead conversion and the "Create Case" button, **without disturbing any existing feature**.

- GHL has two pipelines: **Immigrant Documentation pipeline** and **Non-Immigrant Documentation pipeline**. Immiglance shows them as **two separate boards**, each synchronised with its own GHL pipeline.
- A new GHL opportunity creates a case automatically. The right people are notified and the case lands in the team lead's queue, who assigns a case manager, and the normal workflow continues.
- Dragging a card to another stage moves it instantly in the UI. The backend updates GHL in the background with retries. The UI never waits on GHL.
- A stage change made in GHL flows back through webhooks.
- A move only ever changes **that one opportunity** in **its own pipeline**.

### Hard guarantee: do not break anything existing

- Everything is **additive**: new module, new collections, one optional sub-document on `Case`, new routes, new page.
- `GHL_ENABLED` is a master switch. When off, or when GHL is down, the rest of the app behaves exactly as today.
- Existing `createCase`, `addEmployeeSlot`, `removeEmployee`, `inviteEmployee`, lead conversion, assignment, notifications and emails are **reused, never modified**. Only small, guarded, non-blocking hooks are appended, and they do nothing unless GHL is on and the record is GHL-linked.
- Employers and cases that were not created through GHL behave exactly as they do now.
- GHL failures are logged and retried in the background. They never throw into an existing request.
- **Two concepts stay separate, in both directions:** `Case.stage` is the immigration workflow stage (`intake`, `forms`, ...). `Case.integrations.ghl.unifiedStageKey` is the pipeline column. Moving a card or receiving a GHL stage event **never touches `Case.stage`**, never starts a workflow, never provisions forms or checklists. Equally, a change in the Immiglance workflow stage **never moves the GHL card**, unless that behaviour is explicitly designed and approved later.
- Nothing is ever deleted automatically: employees are soft-removed, GHL opportunities are marked, not deleted.
- Ambiguity never auto-resolves. A wrong-account email, a pipeline/visa mismatch or an unmapped Service Type is flagged for a team lead.

---

## 2. Findings from the codebase (investigated, not assumed)

### 2.1 What already exists and will be reused

| Need | Exists? | Evidence |
|---|---|---|
| One employer with many employee cases | **Yes.** An employer matter is a *principal* case with one *child* case per employee. | `Case.parentCase`, `childCases`, `caseRole: principal / employee` |
| Employer data entered once, reused by every employee | **Yes.** One `EmployerProfile` per principal, shared by all children; every child's canonical profile and forms read it. | `CanonicalBuilderService.loadSources` |
| Each employee has their own visa | **Yes.** A child stores its own `visaType` and sub-type. A green-card type (EB-2, EB-3, PERM) under an H-1B employer already works. EB-1A and EB-4 are single-party and cannot be children. | `addEmployeeSlot`, `resolveEmployeeVisa` |
| Add an employee at any time (no fixed count) | **Yes.** `POST /cases/:principalId/add-employee-slot` creates the child, profile, checklist and forms. | `case.controller.js` ~2669 |
| Employer chooses "I fill it" or "invite the employee", per employee | **Yes.** | `employeeDataEntryMode`, `setEmployeeDataEntryMode` |
| Remove an employee without losing data | **Yes.** Soft remove (`status: "removed"`), restorable. | `removeEmployee`, `restoreEmployee` |
| Unnamed employee cards | **Yes.** Admin shows "Not Identified". | `CRMCaseDetail.jsx` |
| Assignment flows from employer to employees | **Yes.** | `cascadeAssignmentToChildren` |
| Admin and Client portal show the same data | **Yes.** Same `Case` documents. | `GET /cases/:id/related` |
| Family: several cases per petitioner | **Yes.** Each beneficiary is its own family case. | `createFamilyCase` |
| GHL fields on Case | **Built** (Phases 1 to 5) | `creationSource: "ghl"`, `integrations.ghl.*`, `visaSelectionStatus` |

### 2.2 Gaps that shape the plan

1. **One principal per employer login.** `createCase` returns `CLIENT_ALREADY_HAS_CASE` for an employer who already has a case. The GHL path must **not** use `createCase`; it finds the employer's existing matter and adds a child (the `addEmployeeSlot` behaviour).
2. **Employer questions follow only the principal's visa.** If the principal is H-1B and a child is PERM/I-140, that child's *employer-side* questions (LCA, prevailing wage, I-140 facts) are never asked. Existing limitation; mixed-visa employers will expose it.
3. **No petitioner profile is shared across a petitioner's family cases.** Petitioner answers are stored per case, so a petitioner with two beneficiaries is asked twice today.
4. **No employer snapshot at submission.** Forms read the live employer profile, so a later edit can alter an old case. Real, but existing and outside this integration; recommended as a separate task.
5. **Removed employees are not excluded** from some provisioning loops (`provisionRequiredForms`, ...). Needs a guard once children are created and removed automatically.
6. **Family cases are not tagged `caseStructure: "family"`;** they are recognised by `petitionerUser`. Anything built must detect them the same way.
7. **The `cases` collection is at MongoDB's 64-index limit.** No new index can be built on it. (Already handled: GHL identity uniqueness lives in its own `GHLCaseLink` collection.)
8. **`canAccessCase` lets any staff role open almost any case.** Board visibility and moves use the Cases-list scope (`buildCaseFilter`) instead. (Already handled.)

### 2.3 Live GHL data (read-only check)

- 19 opportunities across the two documentation pipelines, all status `open`, none with `assignedTo`, none with a phone number, one without an email.
- Custom fields exist for Service Type and the visa details: `opportunity.service_type` (Work Visa / Study Visa / Green Card / Business/Investment / Other), `opportunity.work_visa`, `opportunity.study_visa`, `opportunity.green_card`, `opportunity.business__investment`, `opportunity.documentation_onboarding_type` (Immigrant / Non-Immigrant), `opportunity.opportunity_id` (text, used by our idempotency key in §5.6).
- Only 1 of 19 opportunities has a visa filled in today.

---

## 3. Target model

```
GHL (2 pipelines)                                   Immiglance

Immigrant pipeline  ---------------------------->   Immigrant board
Non-Immigrant pipeline ------------------------->   Non-Immigrant board

One GHL opportunity  =  one case card:

  individual client (single-party visa)  ->  one single case
  employer + employee visa               ->  one EMPLOYEE (child) case under the employer
  petitioner + beneficiary visa          ->  one FAMILY case (petitioner = shared contact)

Employer (principal case + one EmployerProfile)
  |- Employee child A  <- GHL opportunity 101   (H-1B,  Non-Immigrant board)
  |- Employee child B  <- GHL opportunity 102   (EB-2,   Immigrant board)
  |- Employee child C  <- GHL opportunity 103   (H-1B,   Non-Immigrant board)
  Employer details: entered once, used by A, B and C.
```

Principles:
1. **The frontend only talks to our backend.** It never calls GHL.
2. **Identity is `locationId + opportunityId`,** held in `GHLCaseLink` (unique). Employer name/email is never a key for an opportunity: one employer legitimately has many opportunities with the same name and email.
2a. **The GHL contact is the opportunity's primary contact.** The case structure decides what that contact *is*: the **client** for a single-party visa, the **employer** for an employment visa, the **petitioner** for a family visa. Nothing is hard-coded as "GHL name = employer".
2b. **Parent relationship rule.** A two-party employee or beneficiary card cannot exist without its employer or petitioner. Single-party visas (for example EB-1A, individual O-1) remain independent cases, exactly as the existing visa rules classify them. An opportunity that would create a structurally invalid case is held for a team lead instead.
3. **The board shows employee cards, not the employer container.** The employer is a label on each card plus a filter; it has no stage of its own.
4. **Each employee card moves independently;** moving it changes only that employee's opportunity.
5. **Pipeline = where GHL put the opportunity.** Service Type maps to the *visa*; the visa's category is cross-checked against the pipeline and any disagreement is flagged for a human.
6. **Config is stored in the database,** never hard-coded. Stages are mapped by `(pipelineId, stageId)`, never by name.
7. **MCP is not part of production sync.** Production is the Private Integration token to the GHL REST API plus GHL webhooks to our backend.

## 4. Data ownership

| Data | Source of truth |
|---|---|
| GHL pipeline, opportunity, stage | GHL (stage is two-way) |
| Primary contact name and email (client / employer / petitioner, by structure), first seen | GHL, copied once; Immiglance owns it afterwards |
| Service Type to visa | GHL value, translated by an Immiglance mapping table |
| Employer profile (company, FEIN, address, signatory, ...) | Immiglance (employer enters once) |
| Employee / beneficiary details, documents, checklists, forms, OCR, questionnaires, workflow | Immiglance |
| Case manager / team lead assignment | Immiglance |
| Employee name | Immiglance (see decision 2 on writing it to GHL) |
| Visa type | Seeded once from GHL's Service Type mapping, then Immiglance |
| Contact name, email, phone (existing contacts) | GHL to Immiglance only, per-field config (`contactFieldOwnership`) |

---

## 5. Design

### 5.1 Separate boards (replaces the merged board)

- **Stage mapping per pipeline:** each pipeline's own stages are mapped independently by `(pipelineId, stageId)`. The two pipelines may now diverge. Drift detection (renamed, removed or added stage), `config_mismatch` status and admin confirmation stay, per pipeline.
- **Backend:** the board endpoint takes `category=immigrant|non_immigrant` and returns that pipeline's columns and cards. Scoping is unchanged (case manager sees only assigned cards).
- **Frontend:** the Pipeline page gets two tabs, **Immigrant** and **Non-Immigrant**. A case manager sees the same two tabs ("My Pipeline"), only with their own cards. Moves, optimistic updates, live updates and the admin Integration panel stay as built.
- **No data migration:** the integration has never been enabled or synced against real data, and all test records were deleted.

### 5.2 Service Type to visa mapping (editable, not hard-coded)

- A mapping table in the integration config: `GHL value -> { visaType, petitionSubType, expected category }`.
- **Today:** use a detailed `Service Type` if it maps; otherwise combine `Service Type` with the matching detail field (`work_visa`, `study_visa`, `green_card`, `business__investment`).
- **Later:** when Service Type holds detailed values ("H-1B New", "H-1B Extension", "L-1A New", ...), only rows are added. No code change.
- **Unmapped or incomplete** (for example only "Work Visa", or "H-1B" where a sub-type is required) leaves the case with **visa selection pending**, exactly as built, for a team lead to complete. Nothing is guessed. No visa-driven checklists, forms or questionnaires run while pending.
- The mapping decides the **structure**: single-party visa to an individual case, employer visa to the employer model, family visa to the family model.
- The earlier "single-party visas only" restriction on the visa select is **removed** and replaced by structure-aware handling.

### 5.3 Employer-based visas (inbound, GHL to Immiglance)

When an opportunity arrives whose mapped visa is employer-based:

1. **Find the employer with a matching strategy (not an identity).** In this order:
   1. **An existing GHL-linked employer:** the GHL contact id is already stored on an employer matter.
   2. **Exact normalised email match** against employer matters (created from GHL or manually).
   3. **Otherwise** create the employer matter (principal + `EmployerProfile`) seeded with name and email, an inactive employer login with the usual setup invitation, and the usual team-lead notification.
   - **Ambiguity goes to Needs Attention, never to a guess.** This covers: more than one possible employer matter; an email that belongs to a non-employer account (for example an individual client with a case); a shared mailbox that could belong to several employers; and the same email arriving with a clearly different company name. Nothing is attached or created until a team lead decides.
   - **Email is only the first matching signal.** The employer's identity in Immiglance is the employer matter / `EmployerProfile` id. If HR changes email, or a company has several HR contacts, the stored GHL contact link still matches the same employer. Later releases can add more signals (company name, FEIN) without changing the model.
2. **The employer is a shared party, not a visa case.** An employer matter created from GHL must not, by itself, start the normal visa-driven employer workflow on the strength of one employee's visa. Today's model requires a principal to carry a visa and assigns the employer checklist from it, so the plan is explicit about the trade-off:
   - **R3-3 (single-visa employers):** the employer matter takes the first employee's visa as a **provisional container visa**, flagged as provisional, only so today's employer checklist works for an employer whose employees share one visa. Nothing else visa-driven is started on the employer matter.
   - **Mixed-visa employers:** when an employee arrives whose visa differs from the container's, the card is still created, but the employer matter and card get a **"mixed-visa employer" attention flag**, and the system does **not** claim the employer-side questions for that visa are covered.
   - **R3-6 changes the rule properly:** *employer profile data is shared; visa-specific employer questions belong to the individual employee case.* See §5.4. Mixed-visa employers are not declared production-ready until that passes.
3. **Create one employee child** for this opportunity (it always belongs to an employer matter; an employee card never exists without its employer), mirroring `addEmployeeSlot` (child case number, `EmployeeProfile`, role-filtered checklist, forms) with the opportunity's visa and sub-type. The child is "Not Identified" until the employer names the employee.
4. **Link** the child to the GHL opportunity (`GHLCaseLink`, `integrations.ghl` on the child). The principal keeps only the GHL *contact* id for reference.
5. **Assignment:** an already-assigned employer matter gives the child its case manager at once; otherwise the employer matter appears in the team lead's queue as usual.
6. **Emails:** new employer gets the existing invitation. An additional opportunity for a known employer sends no new invitation; the employer sees the new employee card in the portal, and the team lead is notified only if assignment is still needed.
7. **Visa pending:** the child is created in a pending state and provisions nothing visa-driven until completed.

This is built **inside the GHL module, reusing existing services** (`CaseNumberService`, profile creation, checklist resolution, orchestrator). `createCase` and `addEmployeeSlot` are not edited.

### 5.4 Employer data reuse

- Handled by the existing shared `EmployerProfile`: the employer is asked once, every employee's forms read the same data, employee data stays per employee.
- GHL seeds only **name and email**, with a provenance that does **not** staff-lock the fields (to verify, because the current creation path locks them against employer edits).
- **The rule that makes mixed visas correct:** the shared profile prevents repeated data entry (company, FEIN, address, signatory), while the **visa-specific employer questions belong to each employee's case**. John's H-1B employer questions live on John's case, Sarah's EB-2 / PERM / I-140 employer questions live on Sarah's case, and neither reuses the other's. This is **R3-6** and it is a **release gate** for mixed-visa employers (gap 2). It is additive: it assigns the missing employer-side questions per employee case, is idempotent, and never edits an existing checklist.
- **Shared employer updates:** changing a shared employer fact (for example the address) is visible to every employee's employer data. Forms already generated or submitted are **not** snapshotted today (gap 4); the new shared-update test documents the exact current behaviour so the risk is explicit and a separate task can fix it.

### 5.5 Family / two-party visas

- The GHL contact is interpreted as the **petitioner**, Service Type = visa, **each opportunity = one beneficiary's family case**, created through the existing family-case logic with the petitioner matched by the same strategy as employers (§5.3: linked contact, then exact email, ambiguity to Needs Attention). A beneficiary case cannot exist without its petitioner (parent relationship rule).
- **What R3-5 delivers, and what it does not:** petitioner matching, beneficiary case creation, GHL linking, pipeline and stage synchronisation. It does **not** stop a petitioner being asked the same questions again for a second beneficiary.
- **Gap 3:** petitioner answers are not shared across cases today. A shared petitioner profile or prefill copy is new work in **R3-6**, with the same gating as mixed-visa employers.

### 5.6 Outbound: Immiglance to GHL

| Action in Immiglance | GHL effect |
|---|---|
| Staff or employer **adds an employee** under a GHL-linked employer | **Create a new opportunity** (employer name and contact, pipeline from the visa's category, first stage, Service Type from the mapping) |
| Employee **identified** (named by the employer or staff) | Update the opportunity's **display name** from the employer's name ("ABC Technologies") to "ABC Technologies, John Smith". Display only: identity stays `locationId + opportunityId`. The initial opportunity always carries the employer's name only |
| Employee card **moved** | Update that opportunity's stage (already built) |
| Employee **removed** | Mark the opportunity **abandoned** (reversible), not deleted (decision 3) |
| Employee **restored** | Set it back to **open** |
| Employee's visa changes to another category | **Flag for a human**; no automatic pipeline switch in the first release (decision 7) |

- Reuses the queue already built: atomic claim with lease, retries with backoff, per-record serialisation, stale-job re-check, admin alert on permanent failure.
- **Idempotency for "create opportunity":** our child case number is stored in GHL's existing `Opportunity id` custom field on the new opportunity. The inbound webhook for it recognises that value and links it instead of creating a second card, so a retry after a lost response never produces duplicates.
- **Hooks:** one small guarded, non-blocking call after success in `addEmployeeSlot`, `removeEmployee` and `restoreEmployee`. It does nothing unless GHL is enabled **and** the employer matter is GHL-linked. A hook failure is logged and retried in the background and never affects the user's request.
- GHL writes need opportunity-write scope on the token. **Testing stays on mocks** until you approve a real write.

### 5.7 Client portal and Admin stay in sync

- Both read the same cases. New employee cards from GHL show in the employer's portal through the existing refresh (30 seconds today); a socket event will be added so Admin and Client update at once.
- Visibility is unchanged: the employer sees their employees, an invited employee sees only their own case, a case manager sees only assigned cards.

### 5.8 Card and board

- A card shows **employee name** (or "Employee, not identified yet"), **employer name**, visa, stage, case manager, and the existing "Visa required" and sync markers.
- Filter and "group by employer". Clicking the employer opens the existing employer matter, whose "Employees" table keeps Add, Remove and Restore.

---

## 6. Mechanisms carried over unchanged from earlier revisions

### 6.1 Webhooks (built)
`POST /api/integrations/ghl/webhooks`, public, raw body. The Ed25519 `X-GHL-Signature` is verified against the raw bytes with GHL's official public key (`GHL_WEBHOOK_PUBLIC_KEY`) **before** any JSON parsing. No Immiglance private key exists. Duplicates are blocked by `webhookId` (with a content-hash fallback) and again by the unique `GHLCaseLink` identity. The event is persisted, 200 returned fast, and processing runs through an atomic-claim state machine (`received, processing, processed, ignored, deferred, failed, dead`) with backoff. Handled events: `OpportunityCreate`, `OpportunityUpdate`, `OpportunityStageUpdate`, `OpportunityStatusUpdate`, `ContactCreate`, `ContactUpdate`. Legacy `X-WH-Signature` was deprecated by GHL on 2026-09-01 and is not accepted.

### 6.2 Conflict rule (built)
The most recent accepted stage change wins, unless there is an unresolved outbound change for the same opportunity, in which case ours wins until it resolves. Echoes of our own write are recognised and never written back. Late or reordered events are ignored by timestamp. Every decision is logged on the timeline.

### 6.3 Outbound queue (built)
Drag saves locally (compare-and-set on a sync version) and returns at once; a job is queued; newer jobs supersede older pending ones; the worker claims atomically, re-checks the version immediately before calling GHL, serialises writes per case, retries retryable errors with backoff (up to 8), and on a permanent error flags the case and alerts admins. The UI sees only SYNCED / PENDING / FAILED, and only admins see FAILED.

### 6.4 Reconciliation, isolation and drift (R3-7)
Every 15 to 30 minutes, per pipeline and independently (one failing pipeline never blocks the other, it is marked `degraded`). Missing cases are created with origin `reconciliation`; differences are resolved by the §6.2 rule; opportunities deleted in GHL are flagged `deletedInGhl`, never deleted; stage drift puts the integration in `config_mismatch` for admin review. Uses the existing `withJobLock` so two instances never run it at once.

### 6.5 Import
"Sync now" (admin) imports every opportunity from both pipelines with full pagination, idempotently, with **no emails**, and records the origin ("Created from GHL, Initial Sync" versus "OpportunityCreate webhook") on the timeline.

---

## 7. Data model (as built, plus Revision 3 additions)

- **`GHLIntegration`** (one per location): status, pipelines (with category), stage mappings `(pipelineId, stageId) to stage key`, mapping confirmation, contact field ownership, timestamps. *Revision 3 adds:* per-pipeline stage lists, and the Service Type mapping table.
- **`GHLCaseLink`**: unique `(locationId, opportunityId)` to `caseId` (plus contact lookups). Holds the external identity because `cases` has no free index slots.
- **`GHLWebhookEvent`**: idempotency log and state machine with attempt counters and leases.
- **`GHLSyncJob`**: outbound queue. *Revision 3 adds* job types `create_opportunity`, `set_status`.
- **`Case.integrations.ghl`**: locationId, opportunityId, contactId, pipelineId, pipelineStageId, source ids, `unifiedStageKey`, `category`, status, origin, flags, sync `{state, version, source, changedAt, operationId, lastSyncedStageId, attempts, lastError}`. *Revision 3:* lives on the employee / individual case; the employer principal stores only the GHL contact id.
- **`Case.visaSelectionStatus`**: `pending` / `selected`. `visaType` is required unless pending.

---

## 8. Built so far (Phases 1 to 5, all inert unless `GHL_ENABLED=true`)

| Phase | Delivered | Verified |
|---|---|---|
| 1 Foundation | env, client, models, Case fields, stage plan, drift detection | unit tests, live read-only check |
| 2 Import | paginated fetch, contact fallback, case factory (pending visa, no emails), "Sync now", visa-selection hook | unit + DB tests |
| 3 Inbound webhooks | signature, dedupe, event state machine, create/stage/status/contact handling, conflict rule | unit + route + DB tests |
| 4 Outbound | move endpoint, queue, worker, retries, stale-job check, per-case serialisation, admin retry | DB tests with mocked GHL |
| 5 Frontend | optimistic board, live updates, admin panel, visa banner, board and status APIs | 23 frontend tests, build |

Test status: 40 GHL backend tests and all Admin frontend tests pass; the existing case suite is unchanged (97 of 98, one failure that predates this work). Revision 3 modifies parts of Phases 1 and 5 as listed in §10.

---

## 9. Phases (Revision 3)

| Phase | Content | Risk |
|---|---|---|
| **R3-1** | Two separate boards (backend `category` param, tabs); per-pipeline stage mapping | Low, contained to the GHL module and Pipeline page |
| **R3-2** | Service Type mapping table; visa routing for **individual (single-party)** GHL cases; replace the single-only guard | Low |
| **R3-3** | **Employer model, inbound:** matching strategy (linked contact, exact email, ambiguity to Needs Attention), find or create the employer matter, one employee child per opportunity, link, assignment, notifications, "mixed-visa employer" flag | Medium (reuses existing employer services; heaviest testing) |
| **R3-4** | **Outbound:** create opportunity on Add Employee; display-name update when an employee is identified; abandon/reopen on Remove/Restore; the guarded hooks; idempotency; mocks only | Medium |
| **R3-5** | **Family inbound:** petitioner matching, beneficiary case per opportunity, GHL linking, stage sync. Does **not** remove repeated petitioner questions | Medium |
| **R3-6** | **Release gate.** Visa-specific employer questions per employee case (additive, idempotent) for mixed-visa employers, plus the shared petitioner profile / prefill for family | Medium-high: touches existing provisioning; only after its own approval |
| **R3-7** | Reconciliation job, drift refresh, admin retry on failed cards, rate limits, `docs/GHL_INTEGRATION.md`, completion report | Low |

**Release gates.** Employers whose employees all share one visa (for example H-1B only) can be tested and go live after **R3-3 and R3-4**. **Mixed-visa employers, and repeat-petitioner family cases, are not declared production-ready until R3-6 passes.** Until then the system flags them rather than pretending they are fully supported.

Each phase is its own commit and can be switched off with `GHL_ENABLED=false`.

## 10. What happens to what is already built

| Built piece | Fate |
|---|---|
| GHL client, models, `GHLCaseLink`, webhook signature, event state machine, outbound queue and worker, conflict rule, presenter, sync-status rules | **Kept** |
| Stage plan "both pipelines must be identical" | **Changed:** per pipeline, no equality requirement |
| Merged board API and page | **Changed:** per-pipeline tabs |
| `ghlCaseFactory` (single-party cases only) | **Extended:** routes to individual / employer child / family |
| Visa select "single-party visas only" guard | **Replaced** by structure-aware handling |
| `Case.integrations.ghl` | **Kept,** now on the employee / individual case |
| Everything outside `integrations/ghl` | **Untouched,** except the visa-update hook already added and three new guarded hooks (add / remove / restore employee) |

## 11. Testing

- **Unit:** signature, stage mapping per pipeline, drift, conflict rule, retries, supersede, claim and lease, pagination, Service Type mapping, employer matching.
- **Integration (DB, GHL mocked, cleanup after):**
  - Same employer email, three opportunities: **one** employer, three employee cards, one `EmployerProfile`.
  - Same employer, two visas: two pipelines, one employer, and the employer matter carries the "mixed-visa employer" flag until R3-6.
  - **Shared employer update:** employer ABC has John (H-1B) and Sarah (EB-2); change the employer address once. Both employees' employer data show the new address. The test also records what happens to forms already generated, so that behaviour (gap 4) is explicit and not assumed.
  - **Matching strategy:** an opportunity whose contact is already linked matches that employer; exact email matches; two possible employers, a shared mailbox, an individual client's email, or the same email with a different company name all go to Needs Attention and attach nothing.
  - **Parent relationship rule:** an employee or beneficiary card is never created without its employer or petitioner; a single-party visa creates an independent case.
  - **Contact interpretation:** the same GHL contact is a client for a single-party visa, an employer for an employment visa and a petitioner for a family visa.
  - **GHL stage and workflow stage:** moving the GHL card changes no workflow step, and changing the workflow step does not move the GHL card.
  - **Employee identified:** the GHL opportunity display name becomes "Employer, Employee"; identity and links are unchanged; a retry never creates a second opportunity.
  - Duplicate webhook, or the same opportunity re-sent under a new webhook id: no second card.
  - Immiglance-created opportunity echoed by the webhook: linked, **not** duplicated.
  - Retry after a lost "create opportunity" response: still one opportunity.
  - Employee removed: soft-removed, GHL abandoned; restored: reopened; no data lost.
  - An individual client's email used as an employer: flagged, nothing attached.
  - Service Type unmapped or incomplete: pending, nothing provisioned.
  - Pipeline and visa category disagree: flagged, not moved.
  - Moving John's card never changes Sarah's opportunity.
  - Case manager sees only their employees' cards on both boards.
  - Employer data entered once appears in every employee's form data (existing behaviour, regression-asserted).
  - Non-GHL employer: add / remove employee never touches GHL.
  - Same email, two opportunities for **individual** clients: two cases (identity is the opportunity).
  - Same stage name in two pipelines: each card gets its own pipeline's stage id.
  - GHL stage renamed: `config_mismatch`, nothing silently re-mapped.
  - One pipeline unavailable: the other keeps working.
  - GHL opportunity deleted: the case remains, flagged.
- **Regression:** existing case, lead, assignment, notification and email suites; Admin and Client builds and tests. With `GHL_ENABLED=false` the app behaves exactly as today.
- **Live checks:** read-only against the real GHL location. Any test record in the shared DB is deleted afterwards. **No GHL write without your explicit approval.**

## 12. Decisions (proposed answers, awaiting your confirmation)

| # | Question | Proposed decision |
|---|---|---|
| 1 | Employer matching | **Email is the initial matching signal, never the immutable employer identity.** Order: existing GHL-linked employer, then exact normalised email, then anything ambiguous goes to **Needs Attention** for a team lead. Never silently attach to an uncertain employer. A manually created employer matter with that email counts as a match. |
| 2 | Opportunity name | **Yes.** The initial opportunity carries the employer's name. Once the employee is identified, update the **display name** to "Employer, Employee". Identity stays `locationId + opportunityId`. |
| 3 | Removing an employee | **Remove marks the GHL opportunity abandoned; restore sets it open.** The Immiglance case is soft-removed and nothing is deleted. |
| 4 | Create opportunities from Add Employee | **Yes.** Needs opportunity-write permission on the token. Mocks only until you approve a real test. |
| 5 | Service Type | **Editable mapping table; never guess an unmapped value** (it stays pending). Please send the planned detailed values and the Immiglance visa and sub-type each means. Until then today's detail fields are mapped (for example "H-1B - Specialty Occupation") and sub-type-dependent ones stay pending. |
| 6 | Mixed-visa employers | **Build R3-3 first, but do not claim mixed-visa support until R3-6 passes.** Single-visa employers (for example H-1B only) can go live after R3-3 and R3-4. Until R3-6, the first employee's visa is only a **provisional container visa** on the employer matter and mixed-visa employers are flagged. |
| 7 | Visa or category change | **Flag for human review** (Needs Attention). No automatic pipeline switch in the first release. |
| 8 | Family | **After the employer flow.** R3-5 is matching, case creation, linking and sync only; the shared petitioner profile / prefill is R3-6. |
| 9 | Employer snapshot at submission | **Separate task.** The risk is documented here and made explicit by the shared-update test. |
| 10 | Board layout | **Yes:** employee cards with employer label, filter and group-by-employer; the employer container is not a card. |
| 11 | Contact interpretation | **Yes:** the GHL contact is the primary contact; the case structure decides whether it is the client, employer or petitioner. |
| 12 | Parent relationship rule | **Yes:** a two-party employee or beneficiary card cannot exist without its employer or petitioner; single-party visas stay independent. |

One point I want you to explicitly confirm, because it is a trade-off, not a free choice: the existing model requires an employer matter to carry a visa, so in R3-3 the **provisional container visa** (first employee's visa) is how single-visa employers get today's employer checklist. R3-6 then moves visa-specific employer questions onto each employee's case, which removes the dependence on the container visa.

## 13. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Breaking existing employer/employee flows | No edits to existing functions; only guarded, non-blocking hooks; GHL-linked records only; full regression suites each phase |
| Duplicate cards or opportunities | Unique `GHLCaseLink` identity, `webhookId` dedupe, idempotency key on created opportunities, recognise our own echoes |
| Wrong employer match | Email is only a matching signal (linked contact first, then exact email); any ambiguity goes to Needs Attention; never auto-attached to a non-employer account or an uncertain employer |
| Wrong visa provisioning | Unmapped or incomplete Service Type stays pending; nothing visa-driven runs until resolved |
| Infinite sync loops | Operation ids, last-synced stage, echo recognition, no write-back of inbound changes |
| Stale or reordered updates | Version compare-and-set, stale-job check before every GHL write, timestamp rule |
| GHL outage or rate limits | Local state saved first, queue with retries and backoff, per-pipeline isolation, reconciliation |
| Mixed-visa employers missing employer-side questions | Flagged "mixed-visa employer" and **not declared production-ready until R3-6 passes** (release gate); R3-6 is additive and idempotent, and needs its own approval |
| First employee's visa wrongly defining the whole employer | The container visa is provisional and flagged; the employer is a shared party; visa-specific employer questions move to each employee case in R3-6 |
| Repeat petitioners asked the same questions again | Family intake (R3-5) is stated not to solve this; shared petitioner profile / prefill is R3-6 |
| Shared employer edit altering already-generated forms | No snapshot exists today (gap 4); the shared-update test makes the behaviour explicit; fixing it is a separate task |
| Removed employees in provisioning loops | Guard added with the automatic add/remove hooks |
| Secrets | Token and keys only in `.env` (git-ignored); only GHL's public key is used for webhooks; no private key is generated by us |
