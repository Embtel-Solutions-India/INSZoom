# USCIS Lifecycle Module

`modules/uscis-lifecycle` manages USCIS form monitoring, version imports, comparisons, administrator review, activation, retirement, and case compatibility.

## Data Model

- Uses existing `USCISFormTemplate` for all form editions.
- Uses existing `CaseForm.formTemplateId`, `formVersion`, `formEditionDate`, and `formVersionLock` to preserve historical case compatibility.
- Uses existing `AuditLog` and notification infrastructure.

## Status Flow

`draft` → `review` → `active` → `retired` → `archived`

Only one `active` version is maintained per `formCode`. Existing cases stay locked to their original `formTemplateId`.

## APIs

- `GET /api/uscis/forms`
- `GET /api/uscis/forms/:formType/versions`
- `GET /api/uscis/forms/:formType/compare/:version`
- `POST /api/uscis/forms/import`
- `POST /api/uscis/forms/scan`
- `POST /api/uscis/forms/:version/approve`
- `POST /api/uscis/forms/:version/activate`
- `POST /api/uscis/forms/:version/retire`

## Monitoring

Set `USCIS_MONITORING_ENABLED=true` to run the monitoring job on server startup.
Set `USCIS_MONITORING_INTERVAL_MS` to override the default daily interval.
