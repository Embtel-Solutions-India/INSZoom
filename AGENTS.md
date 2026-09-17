# AGENTS.md

# ImmigrationCRM Workspace

## Project Overview

This workspace contains the complete Immigration CRM Platform.

The platform consists of four applications that together form one enterprise system.

1. Immiglance

   * Client Portal
   * Used by immigration clients.
   * Handles onboarding, questionnaires, document uploads, payments, appointments, messaging, and case tracking.

2. Admin

   * Internal CRM (formerly named "INSZoom" — renamed; the directory, package names, env vars, DB enum values, and code comments have all been updated to "Admin")
   * Used by Case Managers, Team Leads, Paralegals, Finance Team, HR, and Administrators.
   * Handles case management, workflow automation, USCIS forms, analytics, document review, reporting, and administration.

3. Attorney Portal

   * External-counsel portal, standalone app (`Attorney/`), a peer of Immiglance and Admin — not a page inside either.
   * Used by attorneys granted access to specific cases (`Case.attorneyAccess[]`, granted/revoked from Admin's case detail page).
   * Handles: case review (read-oriented — Overview, Documents, USCIS Forms, Petition, USCIS Tracking, Timeline), Tasks (self-assigned only), and Messages/Feedback — a staff-only dialogue with the case manager (never the client-facing Conversation system Immiglance/Admin use for client messaging).
   * See `Attorney/docs/ATTORNEY_PORTAL.md` for the full reference.

4. Backend

   * Shared backend.
   * The single backend used by Immiglance, Admin, and the Attorney Portal.
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

Client Portal only.

Responsibilities

* Authentication
* Client Dashboard
* Case Tracking
* Questionnaires
* Document Upload
* Payments
* Messaging
* Notifications
* Appointments
* Profile

Never implement admin-only functionality here.

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

Immiglance and Admin currently contain duplicate functionality.

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
* Ensure Immiglance, Admin, and the Attorney Portal all remain functional after every change.

Treat this project as an enterprise SaaS platform, not as two independent applications.
