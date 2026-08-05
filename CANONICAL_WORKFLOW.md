# ImmigrationCRM — Canonical Workflow (Source of Truth)

> This document is the **authoritative end-to-end workflow** for the platform.
> Any agent (Codex / Claude Code) working on this repo must treat it as memory:
> read it before touching case, questionnaire, document, form, email, or
> integration code, and keep it in sync when the flow changes.
>
> It complements `AGENTS.md` (architecture rules). `AGENTS.md` says *how to build*;
> this file says *what the product must do, in order*.

---

## 0. The three apps (recap)

| App | Role | Location |
|-----|------|----------|
| **BAIS** | Client Portal (React) | `BAIS/Frontend` |
| **INSZoom** | Internal CRM — team lead, case manager, admin (React) | `INSZoom/frontend` |
| **Backend** | Shared Express/Mongo API — all business logic | `Backend/src` |

One MongoDB database, one source of truth per entity. No duplicated collections, models, or business logic.

---

## 1. The canonical flow (12 steps)

### Step 1 — Client completes the intake questionnaire and selects a package → a Case is created
- The client fills the **existing onboarding questionnaire** and reaches **Plan / Package selection**.
- When the client selects a package, **a Case is created and its `visaType` is set from the visa the client chose.**
- Frontend: `BAIS/Frontend/src/Pages/Dashboard/PlanSelection.jsx` → `casesApi` (`services/api.js`).
- Backend: case creation runs through `Backend/src/modules/cases/*` and the
  **lifecycle orchestrator** `case-lifecycle-orchestrator.service.js`.

### Step 2 — Case appears on the Team Lead portal + emails go out
- A new case surfaces in INSZoom for the **team lead** (`realtimeGateway.emitToRole("team_lead", "case:created", …)`).
- **Two emails fire on creation** (already wired in `case-lifecycle-orchestrator.service.js → notifyCaseCreated`):
  - **To the client** — template `case-created-client` ("your case has been created").
  - **To the team lead** — template `case-created-team-lead`, linking to `/crm-cases/:id?assign=case_manager`.
- Email templates live in `Backend/src/modules/email/templates/`. **Exact copy for each email is TBD — the client will provide wording; update the template files, not the code.**

### Step 3 — Team Lead assigns a Case Manager → email to Case Manager
- Team lead opens the case and assigns a case manager.
- **Email to the case manager** — template `case-assigned-case-manager` ("a new case has been assigned to you").
- Lifecycle stage moves `case_assigned → case_manager_review` (`case-lifecycle-orchestrator.service.js`).

### Step 4 — Client fills personal info + documents in the Client Portal
- In BAIS the client completes personal details and uploads required documents.
- Pages: `Pages/Dashboard/Intake.jsx`, `Documents.jsx`, `Profile.jsx`, `Dashboard.jsx`.
- The **required document set is driven by the visa type** (see §2 single-source-of-truth).

### Step 5 — Auto-fill via OCR ("Auto-fill through passport / resume / …")
- The client sees an **auto-fill button** on document-backed fields. Uploading a
  passport, resume, degree, etc. runs OCR, extracts fields, and **pre-fills the
  form fields, which the client can then edit.**
- Backend: `Backend/src/modules/document-intelligence/` —
  `services/document-intelligence.service.js`, `extractors/`, `classifiers/`,
  `config/autofill-document-types.js`, `config/field-mapping.registry.js`,
  `dto/passport-extraction.dto.js`, `services/semantic-field-matcher.service.js`.
- Frontend affordances: `components/PrefillBadge.jsx`, `components/QuestionnaireFieldSection.jsx`, `hooks/useCaseQuestionnaire.js`.
- **Rule: OCR output is always editable by the client before submit. Never auto-commit extracted values silently.**

### Step 6 — Client hits Submit → data shown to the Case Manager on that case
- On submit, the client's answers + documents become visible to the assigned case
  manager **inside that specific case** in INSZoom (`CRMCaseDetail.jsx`, `Documents.jsx`).
- **Email to case manager** — template `client-intake-submitted-case-manager`.
- Backend: `Backend/src/modules/client-intake/`.

### Step 7 — Persist submission to Excel + save documents to a Google Drive folder
- Submitted **structured details are written to an Excel workbook** (one per case).
  Backend: `Backend/src/modules/document-intelligence/services/case-workbook.service.js`.
- **Uploaded documents are copied into a per-case Google Drive folder.**
  Backend: `Backend/src/modules/integrations/google-drive.service.js`
  (real Drive REST API — needs valid service-account / OAuth credentials in env).

### Step 8 — Auto-fill the official USCIS forms from the submission + OCR
- Client data + OCR-extracted values are **mapped into the official forms**.
- Backend: `Backend/src/modules/form-mapping/`, `Backend/src/modules/uscis-forms/`,
  `Backend/src/modules/canonical/` (canonical profile → form fields),
  `Backend/src/modules/document-intelligence/services/extraction-mapping.service.js`.

### Step 9 — Forms are editable by the Case Manager
- The case manager can review and **edit every field** before finalizing.
- Backend: `form-mapping` + `form-generation`; model `CaseForm.js`. Frontend: `INSZoom/frontend/src/pages/USCISForms.jsx`.

### Step 10 — On completion, generate the Word document
- When a form is complete it is **imported into a Word document**.
- Backend: `Backend/src/modules/form-generation/services/PetitionWordPackageService.js`.

### Step 11 — The Word petition package is assembled in order
- Order inside the Word doc: **(a) cover letter, (b) personal letter, (c) supporting
  documents/exhibits, then (d) the filled forms.**
- Backend: `CoverLetterService.js`, `FilingPackageService.js`, `PetitionWordPackageService.js` (all in `form-generation/services/`).

### Step 12 — Print & submit to FedEx
- When the petition is complete it is **printed and submitted to FedEx** for filing.
- (Shipping/FedEx step — confirm whether this is manual today or needs an integration.)

---

## 2. Questionnaire / checklist = ONE source of truth (critical rule)

The **same questionnaire/checklist per visa type** must appear, identically, in every one of:

1. INSZoom **admin Questionnaire page** — `INSZoom/frontend/src/pages/QuestionnaireTemplates.jsx`
2. INSZoom **Case → Documents sub-page** — `INSZoom/frontend/src/pages/CRMCaseDetail.jsx`, `Documents.jsx`
3. **Every "pending documents" section** (both portals)
4. BAIS **client Dashboard** — `BAIS/Frontend/src/Pages/Dashboard/Dashboard.jsx`
5. BAIS **Profile** — `Profile.jsx`
6. BAIS **Documents** — `Documents.jsx`

**Assignment is automatic from the client's visa-type selection** (Step 1). The
mechanism already exists: `Questionnaire` model has `visaType` / `visaTypes` /
`assignmentRules.visaTypes` / `checklistRole` / `isDefault`, and
`questionnaire.service.js → getCaseQuestionnaire` resolves the right template by visa type.

### ⚠️ Known divergence to fix (found during audit)
The checklist currently lives in **multiple, already-out-of-sync places**:
- `Backend/src/config/visaChecklists.js` — **50 lines, 5 visa types, fewer docs**
- `BAIS/Frontend/src/config/visaChecklists.js` — **221 lines, ~10+ visa types, more docs** (claims to "mirror" the backend but does not)
- `Backend/src/modules/questionnaires/employmentChecklists.js`
- `Backend/src/modules/employment-workflow/questionnaires/{h1b,l1a,shared,registry}.js`
- Seeded default templates inside `questionnaire.service.js` (`ensureDefaultVisaTemplates`)

**Target state:** one canonical definition (backend), everything else derives from it
(frontend fetches from the API rather than hardcoding). When the client provides each
visa's checklist, reconcile **all** of the above so they are 100% identical, then
prefer removing the frontend hardcoded mirror in favor of an API-driven list.

---

## 3. How the client will deliver the checklists
The client will provide the **questionnaire/checklist one visa type at a time.**
For each one:
1. Check whether it already exists and is **100% accurate** across all §2 locations.
2. If accurate → confirm, no change.
3. If not → fix it in the canonical backend source, propagate to all §2 surfaces, and
   verify auto-assignment by visa type works end to end.

---

## 4. Rules that must hold for every change
- OCR-extracted values are **always editable** before commit (client at intake, case manager on forms).
- Emails are **content-driven by template files**; wording comes from the client — edit templates, not logic.
- Case creation, assignment, and intake-submit each fire **both a notification and an email** to the correct role.
- Everything is **role-gated** (see `AGENTS.md` roles) and **audit-logged**.
- Never duplicate models/logic; extend the shared Backend.

---

## 5. Reusable agent prompt (paste this to start a work session)

> You are working on **ImmigrationCRM** (BAIS client portal + INSZoom internal CRM +
> shared Backend, one MongoDB). Read `AGENTS.md` and `CANONICAL_WORKFLOW.md` first and
> treat the latter as the authoritative end-to-end flow.
>
> The canonical flow is: client fills intake → selects package → **Case created with
> `visaType`** → team lead sees it + emails to client & team lead → team lead assigns
> case manager + email to case manager → client fills details/docs with **OCR
> auto-fill (editable)** → submit → case manager sees it in-case + email → details to
> **Excel**, docs to **Google Drive** → data + OCR **auto-fill USCIS forms (case-manager
> editable)** → complete → **Word petition** assembled as cover letter → personal letter
> → documents → forms → **print & FedEx**.
>
> The **same questionnaire/checklist per visa type** must appear identically in: admin
> Questionnaire page, Case→Documents sub-page, all pending-docs sections, and the client
> Dashboard, Profile, and Documents — auto-assigned from the visa the client selects.
> There is currently one canonical definition target in the Backend; the frontend mirror
> and other copies are out of sync and must be reconciled.
>
> When I give you a checklist for a visa type: verify it's 100% accurate in every
> location above; if not, fix it in the canonical backend source, propagate everywhere,
> and verify visa-type auto-assignment. Follow `AGENTS.md`: analyze first, explain the
> plan, keep both portals working, no duplicate logic, report changed files.
