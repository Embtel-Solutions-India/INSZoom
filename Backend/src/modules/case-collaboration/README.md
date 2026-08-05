# Case Collaboration Module

`modules/case-collaboration` centralizes case activity, requests, tasks, comments, assignments, readiness, and role dashboards while reusing existing platform models.

## Reused Models

- `Case.timeline`, `Case.auditHistory`, `Case.documentChecklist`, `Case.checklistItems`
- `Task` for case-level operational tasks
- `Message` for contextual case/document/task/request comments
- `Document`, `CaseForm`, `AuditLog`, and notification infrastructure

## APIs

- `GET /api/cases/:caseId/timeline`
- `POST /api/cases/:caseId/comments`
- `POST /api/cases/:caseId/tasks`
- `POST /api/cases/:caseId/requests`
- `GET /api/cases/:caseId/readiness`
- `POST /api/cases/:caseId/assignments`
- `GET /api/dashboard/client`
- `GET /api/dashboard/attorney`
- `GET /api/dashboard/employer`

## Design Rules

- Communication remains contextual to cases, documents, tasks, requests, or forms.
- Timeline events are append-only through service methods.
- Client/employer views filter internal-only timeline events.
- Requests and tasks emit notifications through the existing notification service.
