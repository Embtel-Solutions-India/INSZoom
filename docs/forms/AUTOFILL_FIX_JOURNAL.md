# Autofill Fix Journal

Pre-work complete. Baselines: Backend 481/539, Frontend 20/20.

## Pre-work Findings

- LCA extractor routing: `autofill-document-types.js:50` allows `certified_lca_eta9035`; `document-intelligence.schema.js:97` aliases `certified_lca_eta9035` to `lca`; `extractor-router.service.js:60` routes `lca` through the generic extractor.
- LCA extraction schema: `generic-extractor.service.js:8` currently requests `socCode`, `socTitle`, `jobTitle`, `prevailingWageLevel`, `offeredWageRate`, `wageUnit`, `employmentBeginDate`, `employmentEndDate`, `worksiteAddress`, `employerLegalName`, and `employerFein`.
- LCA deterministic mapping: `field-mapping.registry.js` had passport and resume mappings only; no LCA mapping existed before this fix.
- H-1B question keys confirmed: `h1b.js:304-312` covers company name/FEIN/address/phone/NAICS; `h1b.js:321-335` covers position title/salary/start/SOC/wage level; `h1b.js:364-394` covers employee identity/passport fields.
- Autofill callback: `useQuestionnaireAnswers.js:153-167` applied status/refetch behavior but did not persist prefill payloads from the frontend callback.
- Questionnaire canonical chain: `questionnaire.service.js:1305-1306` marks forms stale and runs `canonicalSyncService.syncCase(...)` after answer saves.

### [AUTOFILL-001] Multer Upload Limit Env Fallback
- Date: 2026-08-26
- File(s): `Backend/src/modules/uploads/upload.middleware.js`, `Backend/src/modules/uploads/tests/upload.middleware.test.js`
- Defect: Upload middleware read `MAX_UPLOAD_SIZE_BYTES` only while the local env used `MAX_FILE_SIZE`.
- Root cause: Environment variable name mismatch made multer fall back to 10MB.
- Fix: Read `MAX_UPLOAD_SIZE_BYTES`, then `MAX_FILE_SIZE`, then the 10MB default.
- Verified by: `node --test src/modules/uploads/tests/upload.middleware.test.js`
- Status: fixed

### [AUTOFILL-002] LCA Deterministic Questionnaire Mapping
- Date: 2026-08-26
- File(s): `Backend/src/modules/document-intelligence/config/field-mapping.registry.js`, `Backend/src/modules/document-intelligence/tests/lca-field-mapping.test.js`, `BAIS/Frontend/src/utils/questionnaireEngine.js`, `BAIS/Frontend/src/utils/questionnaireEngine.autofill.test.js`
- Defect: LCA deterministic mapping did not cover employee, employer, or expanded position fields.
- Root cause: `field-mapping.registry.js` had no `lca` registry entry, and the BAIS allowlist exposed the LCA button only for the original five position keys.
- Fix: Added LCA field mappings for confirmed scalar H-1B keys and expanded the BAIS `certified_lca_eta9035` source list.
- Verified by: `node --test src/modules/document-intelligence/tests/lca-field-mapping.test.js`; `npm test -- src/utils/questionnaireEngine.autofill.test.js`
- Status: partial

### [AUTOFILL-003] Autofill Callback Persistence
- Date: 2026-08-26
- File(s): `BAIS/Frontend/src/hooks/useQuestionnaireAnswers.js`, `BAIS/Frontend/src/hooks/useQuestionnaireAnswers.test.js`
- Defect: The frontend callback did not persist answer-shaped OCR prefill payloads.
- Root cause: `handleAutofillResult` only counted `prefill` items, displayed a status, and refetched.
- Fix: Normalize array/object prefill payloads, immediately apply visible answer entries to local state, and save non-conflicted answer entries through `questionnairesApi.saveAnswer`.
- Verified by: `npm test -- src/hooks/useQuestionnaireAnswers.test.js`
- Status: fixed

### [AUTOFILL-004] HTTP 413 Nginx Limit
- Date: 2026-08-26
- File(s): none
- Defect: Nginx can reject 5MB+ LCA uploads before Node receives them.
- Root cause: Default `client_max_body_size` is commonly 1MB.
- Fix: Operator must add `client_max_body_size 25m;` inside the production `server {}` block and reload Nginx.
- Verified by: Not performed locally; requires production server access and a real 5MB+ upload.
- Status: blocked

## Final Verification

- Backend targeted: `node --test src/modules/uploads/tests/upload.middleware.test.js src/modules/document-intelligence/tests/lca-field-mapping.test.js` -> 5/5 passed.
- Backend full suite: `npm test` -> 486/544 passed, 58 failed. Failure count was already 58 before this task; representative existing failures include MongoDB/S3 `EACCES` integration failures and unrelated route/PDF assertions.
- BAIS targeted: `npm test -- src/hooks/useQuestionnaireAnswers.test.js src/utils/questionnaireEngine.autofill.test.js` -> 12/12 passed.
- BAIS full suite: `npm test` -> 22/22 passed.
- Runtime 413/CORS/auth/OAuth/manual OCR upload verification: not performed locally; requires deployed Nginx/backend and an authenticated test case.
