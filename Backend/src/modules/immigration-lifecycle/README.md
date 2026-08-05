# Immigration Lifecycle Module

`modules/immigration-lifecycle` manages post-preparation immigration operations while reusing existing `Case`, timeline, audit, notification, task, document, and form infrastructure.

## Covered Workflows

- Filing registry and package history
- USCIS receipt recording
- Government status history
- RFE tracking and deadlines
- Approval and denial history
- Deadline and expiration monitoring
- Future renewal/extension recommendations
- Client, employer, and attorney lifecycle dashboards

## APIs

- `POST /api/lifecycle/cases/:caseId/file`
- `POST /api/lifecycle/cases/:caseId/receipt`
- `POST /api/lifecycle/cases/:caseId/rfe`
- `POST /api/lifecycle/cases/:caseId/approval`
- `POST /api/lifecycle/cases/:caseId/denial`
- `POST /api/lifecycle/cases/:caseId/status`
- `GET /api/lifecycle/cases/:caseId/timeline`
- `GET /api/lifecycle/cases/:caseId/status`
- `GET /api/lifecycle/cases/:caseId/deadlines`
- `GET /api/lifecycle/dashboard`

## Storage

Lifecycle records are stored on existing `Case.immigrationLifecycle` to preserve a single source of truth and avoid duplicate collections.
