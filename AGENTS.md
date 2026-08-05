# AGENTS.md

# ImmigrationCRM Workspace

## Project Overview

This workspace contains the complete Immigration CRM Platform.

The platform consists of three applications that together form one enterprise system.

1. BAIS

   * Client Portal
   * Used by immigration clients.
   * Handles onboarding, questionnaires, document uploads, payments, appointments, messaging, and case tracking.

2. INSZoom

   * Internal CRM
   * Used by Case Managers, Attorneys, Paralegals, Finance Team, HR, and Administrators.
   * Handles case management, workflow automation, USCIS forms, analytics, document review, attorney collaboration, reporting, and administration.

3. Backend

   * Shared backend.
   * This will become the single backend used by both BAIS and INSZoom.
   * All business logic must eventually live here.

---

# Project Goal

The objective is NOT simply to recreate INSZoom.

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

The finished product should exceed INSZoom in functionality.

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

BAIS/

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

INSZoom/

Internal CRM only.

Responsibilities

* Dashboard
* Case Management
* Users
* Companies
* Workflows
* USCIS Forms
* Analytics
* Attorney Workspace
* Document Review
* Reports
* Settings

Never implement client-only functionality here.

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

BAIS and INSZoom currently contain duplicate functionality.

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
* Ensure both BAIS and INSZoom remain functional after every change.

Treat this project as an enterprise SaaS platform, not as two independent applications.
