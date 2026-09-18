# AGENTS.md

# ImmigrationCRM Workspace

## Project Overview

This workspace contains the complete Immigration CRM Platform.

The platform consists of five applications that together form one enterprise system.

"Immiglance" is the client-facing product. It is **two separate applications**, split apart from the
single `Immiglance/Frontend/` app that used to hold both: `Immiglance/Landing/` (public, never behind
an auth gate) and `Immiglance/Client/` (everything behind `AuthGate`). See
`docs/REPOSITORY_REARCHITECTURE_IMPLEMENTATION.md` for the split and what is still deferred.

1. Immiglance Landing (`Immiglance/Landing/`, dev port 5173)

   * Public marketing site and every pre-authentication entry point.
   * Used by anonymous visitors and by anyone signing in or signing up — clients, staff, and attorneys alike.
   * Handles the marketing home page, login/signup, OAuth callback, invite acceptance, forgot/reset password, the eligibility quiz, and consultation booking/management.
   * This is the **only** app that originates a session; every other app receives one.

2. Immiglance Client (`Immiglance/Client/`, dev port 5175)

   * The authenticated Client Portal.
   * Used by immigration clients (and invited employees/beneficiaries).
   * Handles onboarding/intake, questionnaires, document uploads and review, payments, plan and filing-type selection, messaging, notifications, QuickBooks, FedEx, and case tracking.
   * Everything here sits behind `AuthGate`, the single routing authority for authenticated sessions.

3. Admin

   * Internal CRM (formerly named "INSZoom" — renamed; the directory, package names, env vars, DB enum values, and code comments have all been updated to "Admin")
   * Used by Case Managers, Team Leads, Paralegals, Finance Team, HR, and Administrators.
   * Handles case management, workflow automation, USCIS forms, analytics, document review, reporting, and administration.

4. Attorney Portal

   * External-counsel portal, standalone app (`Attorney/`), a peer of the Immiglance apps and Admin — not a page inside any of them.
   * Used by attorneys granted access to specific cases (`Case.attorneyAccess[]`, granted/revoked from Admin's case detail page).
   * Handles: case review (read-oriented — Overview, Documents, USCIS Forms, Petition, USCIS Tracking, Timeline), Tasks (self-assigned only), and Messages/Feedback — a staff-only dialogue with the case manager (never the client-facing Conversation system Immiglance/Admin use for client messaging).
   * See `Attorney/docs/ATTORNEY_PORTAL.md` for the full reference.

5. Backend

   * Shared backend.
   * The single backend used by Landing, Client, Admin, and the Attorney Portal.
   * All business logic must eventually live here.

---

# Project Goal

The objective is NOT simply to recreate INSZoom (the internal CRM's original name, before it was renamed to Admin).

The objective is to build an enterprise Immigration Operating System that combines:

* Client Portal
* Immigration CRM
* Workflow Automation
* USCIS Forms Automation
* AI-powered Document Intelligence
* AI Petition Drafting
* Attorney Collaboration
* Employer Portal
* Professor Portal
* Enterprise Analytics

The finished product should exceed the original INSZoom in functionality.

---

# Technology Stack

Frontend

* React
* TypeScript (preferred for new code)
* Tailwind CSS
* React Router

Backend

* Node.js
* Express.js
* MongoDB
* Mongoose
* JWT Authentication

Future

* Redis
* BullMQ
* OpenAI
* OCR Services
* AWS S3
* Docker

---

# Workspace Structure

Immiglance/

The client-facing product, as two independently-runnable Vite apps plus a thin wrapper
`package.json` that delegates into both (`npm run dev:landing`, `npm run dev:client`,
`npm run build`, …). There is no `Immiglance/Frontend/` any more — it was split into the two
folders below.

```
Immiglance/
├── package.json     # wrapper scripts only; not an npm workspace
├── Landing/         # public + pre-auth      (dev :5173)
└── Client/          # authenticated portal   (dev :5175)
```

---

Immiglance/Landing/

Public marketing site and pre-authentication entry points only.

Responsibilities

* Marketing home page (`/`)
* Login, Signup, OAuth callback, Accept Invite, Forgot/Reset Password
* Eligibility quiz
* Consultation booking and management
* Bouncing an already-authenticated staff/attorney session to its own portal (`utils/portalRedirect.js`)

Never put an authenticated client screen here — it must be reachable by a completely anonymous
visitor, which means it cannot assume a session exists.

Never implement admin-only functionality here. (One legacy exception survives at
`Landing/src/Pages/Admin/` — a pre-split duplicate of the Admin app, kept only because the
homepage footer still links to it. It is scheduled for removal; do not extend it.)

---

Immiglance/Client/

The authenticated Client Portal only. Everything here is behind `AuthGate`.

Responsibilities

* Client Dashboard
* Case Tracking
* Onboarding / Intake
* Questionnaires
* Document Upload and Document Review
* Payments, Plan Selection, Filing-Type Selection
* Messaging
* Notifications
* Appointments
* Profile
* QuickBooks, FedEx

Never put a pre-authentication page here — login, signup, invite acceptance and password reset all
live in Landing.

Never implement admin-only functionality here.

**Shared code note:** `services/api.js`, `context/AuthContext.jsx`, `context/SocketContext.jsx`,
`context/ThemeContext.jsx`, `services/notificationService.js`, `hooks/useHasCase.js`,
`utils/{auth,portalRedirect,iconComponents,visaDisplay}.js`, `components/{PageLoader,ThemeToggle}.jsx`
and `src/index.css` are **duplicated verbatim** in Landing and Client, pending the centralized-auth
phase. If you change one of these files, change **both copies**.

---

Admin/ (formerly INSZoom/)

Internal CRM only.

Responsibilities

* Dashboard
* Case Management
* Users
* Companies
* Workflows
* USCIS Forms
* Analytics
* Document Review
* Reports
* Settings
* Granting/revoking attorney access to a case (`Case.attorneyAccess[]`) and the staff side of the attorney Messages/Feedback thread — the actual attorney workspace lives in the separate Attorney Portal app, not here.

Never implement client-only functionality here.

---

Attorney/

External-counsel portal only. A standalone app, not a route inside Admin or Immiglance.

Responsibilities

* Read-oriented case review (Overview, Documents, USCIS Forms, Petition, USCIS Tracking, Timeline) for cases explicitly granted to the signed-in attorney
* Tasks (self-assigned only — an attorney can never assign work to someone else)
* Messages/Feedback — staff-only dialogue with the case manager (file attachments, Enter-to-send); structurally separate from the client-facing Conversation system

Never give this app access to the client-facing Conversation system, billing/payments, user management, or case creation.

See `Attorney/docs/ATTORNEY_PORTAL.md` for the full reference.

---

Backend/

Shared API.

Responsibilities

* Authentication
* RBAC
* Users
* Cases
* Documents
* Notifications
* Messages
* Payments
* Questionnaires
* Workflows
* USCIS Forms
* OCR
* AI Services

Eventually every API should exist only here.

---

# Development Principles

Never duplicate:

* APIs
* MongoDB models
* Authentication
* Business logic
* Utility functions
* Validation
* Services

Always reuse existing modules whenever possible.

---

# Shared Database

Both portals use the same MongoDB database.

There must never be duplicate collections.

Every entity should have a single source of truth.

---

# Roles

Supported Roles

* Super Admin
* Admin
* Case Manager
* Attorney
* Paralegal
* Finance
* HR
* Client
* Professor
* Employer
* Reviewer

Every endpoint must enforce role permissions.

---

# Code Rules

Before writing code:

1. Analyze existing implementation.

2. Search for duplicate functionality.

3. Reuse existing modules whenever possible.

4. Keep architecture modular.

5. Preserve backward compatibility.

6. Do not remove features unless requested.

---

# Workflow

For every task:

Step 1

Analyze

Step 2

Explain the implementation plan

Step 3

Wait for approval if major architectural changes are required

Step 4

Implement

Step 5

Run tests

Step 6

Report changed files

Never modify unrelated modules.

---

# Migration Rules

Immiglance (Landing + Client) and Admin currently contain duplicate functionality.

Separately, the Landing/Client split deliberately left a set of files duplicated verbatim across the
two apps (listed under `Immiglance/Client/` above) rather than extracting them to a shared package.
That duplication is a documented stopgap, not a pattern to copy — it is scheduled to be resolved in
the centralized-authentication phase. Until then, edit both copies together.

During migration:

* Never delete existing code immediately.
* Move functionality gradually.
* Keep both portals working.
* Migrate one module at a time.
* Verify before removing duplicate code.

---

# Coding Standards

Use

* Modular architecture
* Reusable components
* Service layer
* Repository pattern where appropriate
* Consistent folder structure

Avoid

* Large files
* Duplicate logic
* Hardcoded values
* Inline business logic
* Copy-paste implementations

---

# Enterprise Standards

Every new feature should support:

* Audit Logs
* Notifications
* Activity Timeline
* Role Permissions
* Validation
* Error Handling
* API Documentation
* Logging

---

# Long-Term Roadmap

Priority 1

* Shared Authentication
* Shared Backend
* Shared Database
* Workflow Engine
* Questionnaire Engine

Priority 2

* USCIS Forms Engine
* OCR
* AI Petition Drafting
* Attorney Workspace

Priority 3

* Professor Portal
* Employer Portal
* Analytics
* Credential Evaluation

Priority 4

* Predictive AI
* RFE Risk Analysis
* Approval Scoring
* Business Intelligence

---

# Instructions for Codex

Before implementing any feature:

* Analyze the current implementation.
* Check for existing functionality.
* Avoid duplicate code.
* Explain the proposed solution.
* Modify only the required files.
* Keep commits focused on one feature at a time.
* Ensure Immiglance Landing, Immiglance Client, Admin, and the Attorney Portal all remain functional after every change (all four build with `npm run build` in their own folder).

Treat this project as an enterprise SaaS platform, not as two independent applications.
