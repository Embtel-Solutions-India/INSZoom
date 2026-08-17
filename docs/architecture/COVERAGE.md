# Dependency-Graph Coverage & Integrity Audit

This audit does **not** claim a fully exhaustive canonical graph of all ~350 backend routes and every frontend leaf component. It claims exhaustive coverage of the artifacts implicated in a CONFIRMED finding, plus the router-mount/model-inventory level needed to reconcile against Phase 2's full inventory. Gaps are named below, not hidden.

## Artifact coverage

| Category | Investigated / Total | Note |
|---|---|---|
| Router mounts | 29 / 29 | 100% — every mount in `routes/index.js` read and resolved to controller/service. |
| Route definitions | 350 / 350 (inventoried) — ~60 represented as individual graph edges | Full table lives in the Phase-2 agent outputs (`endpoints-core`/`endpoints-forms-docs` inventories, saved under the audit's scratch directory this session, not re-saved into the repo) and is summarized in the chat report's endpoint inventory section. The canonical `dependency-graph.json` includes every route implicated in a confirmed finding, not all 350 individually. |
| Mongoose models | 64 / 64 | 100% — every model file opened and read (models-indexes dimension). |
| Frontend artifacts (BAIS) | ~55 relevant / 79 total files scanned | 24 purely presentational components excluded with reason (see BAIS extraction agent's stated exclusions). |
| Frontend artifacts (INSZoom) | ~26 relevant / 28 total files scanned | 2 excluded (ErrorBoundary, QuestionnaireAnswersPanel) with reason. |
| External integrations | 8 / 8 identified | Firebase, Gemini, Stripe, SMTP, Redis, Google Drive, USCIS.gov scanner, qpdf subprocess — all traced to config source, consumer, and failure handling. |
| Background jobs/workers | 8 / 8 | All 7 `withJobLock`-wrapped jobs + the 1 non-wrapped USCISMonitoringJob enumerated with schedule and write-capability. |

## Relationship coverage

- **Confirmed edges** in `dependency-graph.json`: 60 (all tagged `CONFIRMED_STATIC` or `CONFIRMED_RUNTIME`, each with a `file:line` or live-request citation).
- **Inferred edges**: 0 — every edge in the canonical JSON was verified by opening the cited file; nothing was included on a naming-convention guess. (This is narrower than "every possible edge in the codebase," per the artifact-coverage caveats above — it is not narrower than "every edge this audit asserts.")
- **Unresolved relationships**: the full 350-route table's controller→service→model edges beyond what's in the canonical JSON are documented in prose (Phase 2 agent outputs) but not yet transcribed into the JSON/Mermaid form. Flagged as follow-up work, not silently dropped.

## Data-lineage coverage

- **Critical fields traced**: 9 of 9 requested (given name/family name, DOB, passport number, country of birth/citizenship, address, employer name, job title, salary, visa classification) — traced from OCR extraction → extraction schema → canonical merge → questionnaire answer → CaseForm field → PDF AcroForm field, with named mismatches (see OCR/Questionnaire audit section of the main report).
- **Contract fingerprints recorded**: full fingerprints for the priority endpoint set (`/api/cases*`, `/api/uscis-forms/case/:caseId`, `/api/auth/*`, `/api/questionnaires/*`, `/api/documents/*`, `/api/document-intelligence/*`) — see the API Contract Audit section of the main report. Not every one of the 350 routes has a recorded fingerprint.

## Graph integrity checks performed

- [x] Every node in `dependency-graph.json` maps to a real file (all paths were opened during this session or a prior agent's read).
- [x] Every edge cites `file:line` or a live-request description; none are marked `INFERRED` because none were included without direct verification.
- [x] No duplicate nodes represent the same artifact without justification (the two `uscis-form.routes` mount points are represented as one node with two ROUTE_MOUNT edges, not two nodes).
- [x] The confirmed circular-dependency instance (CanonicalProfileService.rebuild vs. in-flight Case mutations) is flagged in `impact/case-model.mmd`.
- [x] Mermaid syntax: all `.mmd` files use only `flowchart` syntax with quoted labels containing special characters; not independently rendered in a browser this session — **recommend a render-check before treating them as final**, flagged here rather than silently assumed correct.
- [ ] NOT performed: reconciliation of literally all 350 routes against the JSON's node list (see Relationship coverage above — this is the one explicit, named gap).

## Honest limitation

This Stage D deliverable is comprehensive for everything that surfaced a CONFIRMED finding this session, and structurally sound as a template for extending to full route-by-route coverage. It is not a claim that every one of the ~350 routes or every frontend component has a corresponding node — that would have required substantially more agent time than this session's remaining scope allowed after the spend-limit interruption. Treat the "full audit" language elsewhere in this report as scoped to the 18 audit dimensions actually executed, not to 100% mechanical graph completeness.
