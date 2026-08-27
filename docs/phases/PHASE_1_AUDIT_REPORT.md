# PHASE 1 AUDIT REPORT — ImmigrationCRM Codebase Baseline
**Date:** 2026-08-26
**Auditor:** Agent (Phase 1 — Read-Only), synthesized from 7 parallel read-only research passes plus direct verification of the app entry point, routing table, and select config files
**Status:** COMPLETE — Awaiting human review and approval before Phase 2 begins

---

## 0. Critical Preface — Two Premises in the Audit Brief Do Not Match the Codebase

Before the step-by-step findings, two discrepancies are important enough to flag immediately because they change how "frozen/done" work in the brief should be read:

1. **The brief states the "H-1B petition structure specification" and "visa variant mechanism (`oClassification`, `pClassification`, `Case.visaVariant`)" are already-completed, frozen work.** A full field-by-field read of `Backend/src/models/Case.js` (906 lines) and a codebase-wide grep found **zero occurrences of `visaVariant`, `oClassification`, or `pClassification` anywhere in the repository.** The closest existing fields are `visaCategory` and `visaType` (a required String). Either this work exists somewhere not yet built, was reverted, or the brief describes target/aspirational state. Phase 2 planning should not assume this field exists.
2. **The brief implies `FormTemplate.fieldMappings` already exists as an array with entries that will merely gain a new `profileOwner` field.** No such array exists. `USCISFormTemplate.js` has no `fieldMappings` field at all. The real mapping data lives in a separate model, `USCISMappingVersion` (`graph.edges[]`), with entry shape `{mappingId, formCode, editionDate, version, sourcePath, sourceType, targetFieldId, targetPdfField, targetLabel, targetType, section, pageNumber, mappingType, confidence, status, transform, condition, note}` — no `profileOwner`, no `allowsOccurrenceOverride`, no per-entry `sha256`. Routing between employer/employee data is currently done by string-prefix convention on `sourcePath` (e.g. `"employer.*"` vs `"beneficiary.*"`), not an explicit field. Additionally, only **3 of the 7 required forms (I-129, I-129F, I-130) have any mapping data seeded at all** — I-134, I-539, I-539A, and I-907 have active `USCISFormTemplate` records but **no mapping seed exists for them anywhere in the codebase.**

Both are treated below as CRITICAL findings (§17, §16) and factor into the final readiness verdict (§19).

---

## 1. Project Structure Map

```
ImmigrationCRM/
├── BAIS/Frontend/                     — React/Vite client portal
│   └── src/
│       ├── Pages/{Admin,Auth,Consultation,Dashboard,Eligibility}/
│       ├── assets/, components/{auth,checklist,consultation,eligibility,questionnaire}/
│       ├── config/, context/ (AuthContext), hooks/, layout/, services/ (api.js), utils/
│       ├── App.jsx (router), main.jsx (entry)
├── INSZoom/frontend/                  — React/Vite staff CRM
│   └── src/
│       ├── components/uscis/, contexts/ (AuthContext), hooks/, layouts/, pages/{,petition/}, poc/, services/, utils/, test/
│       ├── App.jsx (router), main.jsx (entry)
├── Backend/                           — shared Node/Express/MongoDB API
│   ├── src/
│   │   ├── app.js (Express app/middleware), server.js (entry point, bootstraps DB, seeds, cron jobs, HTTP+Socket.IO server)
│   │   ├── config/ (env.js, database.js, redis.js, firebase-admin.js, packages.js, visaTypes.js, visaChecklists.js, filingTypes.js)
│   │   ├── middleware/ (authenticate.js, optionalAuthenticate.js, authorizeRoles.js, authorizePermissions.js, auditAuth.js, errorHandler.js, requestContext.js, sanitizeRequest.js)
│   │   ├── models/ (63 Mongoose model files, flat directory — see §3–§4)
│   │   ├── modules/ (63 feature modules, each typically {name}.routes.js/.controller.js/.service.js + tests/)
│   │   ├── routes/index.js (single mount point for all module routers under /api)
│   │   ├── scripts/ (2 POC diagnostic scripts, not wired into any route)
│   │   ├── seeds/ (seedClients.js, seedCases.js, seedUsers.js — demo-data only, gated by assertDemoSeedAllowed())
│   │   ├── test-utils/, utils/
│   ├── dev-assets/, storage/, uploads/ (local file storage for dev)
├── docs/{architecture,forms,security}/ — design docs, including untracked in-progress journals reviewed for context
├── .agents/, .claude/, .runtime-logs/, .VSCodeCounter/ — tooling/meta, out of audit scope
```

**Backend entry point:** `Backend/src/server.js` (bootstraps `connectDB()`, then starts Express `app.js`, Socket.IO realtime gateway, 7 recurring maintenance cron jobs each guarded by a Mongo-backed `withJobLock`, and conditionally runs USCIS form-template seeding on startup).
**Models:** `Backend/src/models/*.js` (flat, 63 files).
**Routes:** each module owns its own `*.routes.js`; all mounted centrally in `Backend/src/routes/index.js` under `/api`.
**Services:** each module owns its own `*.service.js`.
**Middleware:** `Backend/src/middleware/*.js` (auth, authorization, sanitization, error handling, request context).
**Client portal source:** `BAIS/Frontend/src/`.
**Staff CRM source:** `INSZoom/frontend/src/`.
**Config:** `Backend/src/config/*.js` + `Backend/.env.example`.
**Seed scripts:** `Backend/src/seeds/*.js` (demo data) and `Backend/src/modules/uscis-form-import/seeds/*.seed.js` + `Backend/src/modules/form-mapping/seeds/*.seed.js` (USCIS form/mapping data, idempotent, run at startup or via npm scripts).
**Migration scripts:** **None found.** No directory or file matching "migration" performs a schema migration; the only "migration" hits in the repo are unrelated domain services (`MigrationSuggestionService.js` — USCIS status-change suggestions; `ImmigrationTimelineService.js`). There is no migration framework (no `migrate-mongo`, no custom runner) in this codebase.
**Test files:** colocated per module as `Backend/src/modules/*/tests/*.test.js`, plus `Backend/src/routes/tests/`, `Backend/src/seeds/tests/`, `Backend/src/utils/tests/`; frontend tests colocated as `*.test.jsx`/`*.test.js`.

---

## 2. User Model — Current State
**File path:** `Backend/src/models/User.js` (137 lines)

**All current fields:**

| Field Name | Type | Default | Required | Enum Values | Index |
|---|---|---|---|---|---|
| email | String | — | true | — | unique |
| password | String | — | false | — | select:false |
| name | String | — | false | — | — |
| displayName | String | — | false | — | — |
| role | String | "client" | false | `["super_admin","admin","team_lead","case_manager","employer","employee","client","beneficiary"]` | true |
| applicantType | String | "individual" | false | `["individual","employer"]` | true |
| permissions | [String] | `[]` | false | — | — |
| phone | String | — | false | — | — |
| department | String | — | false | — | — |
| specialization | String | — | false | — | — |
| teamId | ObjectId ref Team | null | false | — | — |
| companyId | ObjectId ref Company | null | false | — | — |
| avatar | String | — | false | — | — |
| profileImage | String | — | false | — | — |
| preferences.theme | String | "" | false | `["light","dark","system",""]` | — |
| preferences.language | String | "en" | false | — | — |
| preferences.timezone | String | — | false | — | — |
| preferences.notifications.{email,inApp,sms} | Boolean | true/true/false | false | — | — |
| settings | Mixed | `{}` | false | — | — |
| loginHistory[] | subdoc (loggedInAt,ipAddress,userAgent,success) | — | false | — | — |
| failedLoginAttempts | Number | 0 | false | — | — |
| lockedUntil | Date | — | false | — | — |
| twoFactorEnabled | Boolean | false | false | — | — |
| twoFactorSecret | String | — | false | — | select:false |
| isEmailVerified | Boolean | false | false | — | — |
| emailVerificationTokenHash | String | — | false | — | select:false |
| emailVerificationExpiresAt | Date | — | false | — | — |
| passwordResetTokenHash | String | — | false | — | select:false |
| passwordResetExpiresAt | Date | — | false | — | — |
| inviteTokenHash | String | — | false | — | select:false |
| inviteTokenExpiresAt | Date | — | false | — | — |
| lastLogin | Date | — | false | — | — |
| lastSeenAt | Date | — | false | — | — |
| isActive | Boolean | true | false | — | true |
| deactivatedAt | Date | — | false | — | — |
| deactivatedBy | ObjectId ref User | — | false | — | — |
| tokenVersion | Number | 0 | false | — | — |
| referralCode | String | — | false | — | unique, sparse |
| referredBy | ObjectId ref User | null | false | — | — |
| referredWithCode | String | "" | false | — | — |
| referralDiscountAvailable | Boolean | false | false | — | — |
| referralDiscountReason | String | "" | false | `["","signup","reward"]` | — |
| referralRewardCount | Number | 0 | false | — | — |
| isDemoData | Boolean | false | false | — | true |

Schema option `{ timestamps: true }` adds `createdAt`/`updatedAt`.

**Compound indexes:** `{companyId:1,isActive:1}`, `{teamId:1,isActive:1}`, `{referredBy:1}`.

**Hooks:**
- `pre("validate")`: normalizes legacy `role:"user"` → canonical role; syncs `name`⇄`displayName`.
- `pre("save")`: bcrypt-hashes `password` if modified.

**Methods:** `comparePassword()`, `isLocked()`, `toAuthJSON()` (narrow client-facing serialization — no case-linking field, since none exists).
**Statics:** `roles` (= `USER_ROLES`).
**Virtuals:** none.

**New field collision analysis:**

| New Field | Exists Already | Collision Risk | Notes |
|---|---|---|---|
| primaryCaseId | No | None | No field of this name/purpose anywhere on User. |
| caseIds | No (on User) | None on User | Identical-purpose field already exists on a *different* model: `Beneficiary.caseIds` (`[{type:ObjectId, ref:"Case", index:true}]`) — good precedent to copy the shape from. |
| legacyNoCaseAccount | No | None | No match anywhere. |
| migrationStatus | No | None | No match anywhere. |
| leadId | No (on User) | None on User | Exists on `StrategyCallQueueItem.leadId` (ref "Lead") — different model, no collision on User. |
| mustSetPassword | No | None | `password` is already optional (`required:false`, supports invite-pending/SSO accounts) but no boolean tracks "must set on next login." |
| caseRole (on User) | No | None | No top-level `caseRole` anywhere; Case has nested `role` inside subdocs only. |
| principalCaseId | No (on User) | Conceptual overlap only | Case has a similarly-purposed `principalCaseRef` — not a User-model collision, but naming should stay consistent between the two models. |

**What currently links a User to a Case:** Nothing on the User side — the relationship is entirely Case→User (numerous refs on Case: `user`, `employeeUser`, `employerUser`, `petitionerUser`, `beneficiaryUser`, `createdBy`, `primaryOwner`, `secondaryOwner`, `assignedTeamLead`, `assignedCaseManager`, `assignedAgentUser`, `assignedAttorney`, `participants[].userId`). User.js has zero back-references to Case.

**Case-related indexes on User:** none.

---

## 3. Case Model — Current State
**File path:** `Backend/src/models/Case.js` (906 lines)

**All current fields (top-level; ~15 embedded sub-schemas documented separately below):**

| Field Name | Type | Default | Required | Enum Values | Index |
|---|---|---|---|---|---|
| caseId | String | — | false | — | unique, sparse |
| caseNumber | String | — | **true** | — | unique |
| clientPortalId | String | — | false | — | true |
| user | ObjectId ref User | — | false | — | true |
| employeeUser | ObjectId ref User | — | false | — | true |
| employerUser | ObjectId ref User | — | false | — | true |
| createdBy | ObjectId ref User | — | false | — | true |
| lastModifiedBy | ObjectId ref User | — | false | — | true |
| clientProfile | ObjectId ref Client | — | false | — | true |
| beneficiary | ObjectId ref Beneficiary | — | false | — | true |
| petitioner / petitionerModel | ObjectId (refPath) / String | — / "" | false | petitionerModel: `["User","Client","Company","Beneficiary",""]` | true |
| petitionerName, petitionerEin | String | — | false | — | — |
| employerCompanyProfile | Mixed | `{}` | false | — | — |
| employer, organization | ObjectId ref Company | — | false | — | true |
| parentCase | ObjectId ref Case | — | false | — | true |
| childCases | [ObjectId ref Case] | — | false | — | true (element) |
| linkedCases | [linkedCaseSchema] | — | false | — | — |
| principalCaseRef | ObjectId ref Case | null | false | — | true |
| clientName, clientEmail | String | — | false | — | — |
| employeeInvite | subdoc | — | false | status enum incl "" | — |
| visaCategory | String | "" | false | — | — |
| visaType | String | — | **true** | — | — |
| caseType | String | "immigration" | false | — | true |
| petitionType, petitionSubType | String | — | false | — | true (petitionType) |
| package | String | "" | false | `PACKAGE_NAMES + ""` | — |
| primaryPackage | String | — | false | — | — |
| addons | [addonSchema] | — | false | — | — |
| jobPosition | subdoc | — | false | salaryUnit enum incl "" | — |
| employerEmployeeWorkflow.{employerStatus,employeeStatus,caseManagerStatus} | String | see enums | false | 3 separate enums | true (each) |
| participantApprovals, informationRequests, participants | arrays of sub-schemas | — | false | — | — |
| petitionerUser, beneficiaryUser | ObjectId ref User | — | false | — | true |
| beneficiaryInvite | subdoc | — | false | — | — |
| familyCompletionMode | String | "" | false | `["petitioner_completes","invite_beneficiary",""]` | — |
| familyWorkflow.{petitionerStatus,beneficiaryStatus,caseManagerStatus} | String | see enums | false | 3 separate enums | true (each) |
| currentStage | Number | 0 | false | min0/max7 | — |
| stage | String | "intake" | false | `CRM_STAGES` (21 values) | true |
| workflow.{stage,status,filingReadinessScore,lastTransitionAt,lastTransitionBy} | mixed types | see above | false | mirrors stage/status | — |
| stageHistory | [stageHistorySchema] | — | false | — | — |
| status | String | "active" | false | `CASE_STATUSES` (21 values) | true |
| previousStatus | String | — | false | `CASE_STATUSES` | — |
| priority | String | "medium" | false | `PRIORITIES` (6 values) | true |
| assignedAgent, agentEmail, assignedAgentUser | String/String/ObjectId ref User | — | false | — | — |
| primaryOwner, secondaryOwner | ObjectId ref User | — | false | — | true |
| **assignedTeamLead** | ObjectId ref User | — | false | — | **true** |
| **assignedCaseManager** | ObjectId ref User | — | false | — | **true** |
| assignedAttorney | ObjectId ref User | — | false | — | true (no compound pair, unlike siblings) |
| assignmentHistory | [assignmentHistorySchema] | — | false | — | — |
| companyId, teamId | ObjectId ref Company/Team | — | false | — | true |
| filingDate, rfeDeadline, etc. (7 Date fields) | Date | — | false | — | — |
| uscisNumber / uscisReceiptNumber | String | — | false | — | true (uscisReceiptNumber) |
| receiptTracking | subdoc | — | false | source enum incl "" | — |
| uscisDecision | String | — | false | `["approved","denied","rfe","pending",""]` | — |
| keyDates | [keyDateSchema] | — | false | — | — |
| documentChecklist / checklistItems | [checklistItemSchema] | — | false | — | — |
| documentReferences | [ObjectId ref Document] | — | false | — | — |
| googleDrive, excelWorkbook | subdocs | — | false | syncStatus enums | — (indexed field inside) |
| uscisFormReferences | [referenceSchema] | — | false | — | — |
| questionnaireReferences | [questionnaireReferenceSchema] | — | false | — | multiple compound |
| questionnaireData | subdoc (masterData, responseId, etc.) | — | false | — | — |
| knowledgePlan | subdoc | — | false | status enum | — |
| paymentReferences, taskReferences, workflowReferences, attachmentReferences, notificationReferences | [ObjectId ref respective] | — | false | — | — |
| activityLog, timeline, auditHistory | arrays of sub-schemas | — | false | — | — |
| notes | String | — | false | — | — |
| externalNotes, internalNotes | [internalNoteSchema] | — | false | — | — |
| plan | subdoc (tier, paymentStatus, amount, etc.) | — | false | tier: `PACKAGE_NAMES+""`; paymentStatus: 5 values | — (`plan.paymentStatus` indexed) |
| assessmentAnswers, assessmentMatchPercentage | Mixed/Number | null/0 | false | — | — |
| eligibility | subdoc | — | false | — | — |
| immigrationLifecycle | large nested subdoc (filingStatus, tracking.status, tracking.filing.*, tracking.rfe.*) | — | false | multiple enums | true (filingStatus, tracking.status) |
| **canonicalProfile** (top-level) | subdoc: profile(Mixed), fieldMetadata(Mixed), sources[], conflicts[], validation(Mixed), missingFields[], version(0), status(enum, indexed), lastBuiltAt, lastBuiltBy, sourceFingerprint | — | false | status: `["not_built","valid","needs_review","invalid"]` | true (`.status`) |
| canonicalHistory | array of version snapshots | — | false | — | — |
| journeyProgress | subdoc | — | false | — | true (`.currentMilestone`) |
| filingReadinessScore | Number | 0 | false | min0/max100 | — |
| lastSyncedAt | Date | null | false | — | true |
| legacySource | String | "shared" | false | `["BAIS","INSZoom","shared",""]` | — |
| isDemoData | Boolean | false | false | — | true |

Schema option `{ timestamps: true }`.

**Embedded sub-schemas (all fully read):** `activitySchema`, `auditHistorySchema`, `timelineEventSchema`, `internalNoteSchema`, `assignmentHistorySchema` (has its own `role` enum: primary_owner/secondary_owner/team_lead/case_manager/agent), `keyDateSchema`, `stageHistorySchema`, `checklistFileSchema`, `checklistItemSchema`, `referenceSchema`, `linkedCaseSchema`, `questionnaireReferenceSchema`, `addonSchema` (largest — ~30 intake sub-fields), `participantApprovalSchema`, `informationRequestSchema`, `participantInviteSchema`, `participantProgressSchema`, `caseParticipantSchema` (has its own `role` enum of 11 values including "employer","employee","beneficiary","dependent","petitioner","client","business","case_manager","team_lead","admin", plus a **second, per-participant `canonicalProfile` field** — plain `Mixed`, distinct in shape and level from the top-level `canonicalProfile`).

**Hooks:** exactly one — `pre("validate")` ("syncLegacyFields"): cross-fills `caseId`⇄`caseNumber`⇄`clientPortalId`, mirrors `stage`→`workflow.stage`, `status`→`workflow.status`, `uscisNumber`⇄`uscisReceiptNumber`, `documentChecklist`⇄`checklistItems`; auto-derives `participants[]` entries from legacy flat fields (idempotent). **No pre/post-save hooks.**
**Methods:** none. **Statics:** re-exports of constants (`stageNames`, `crmStages`, `lifecycleStages`, `statuses`, `priorities`). **Virtuals:** none.

**`caseNumber` generation:** not generated by the model — `Backend/src/modules/cases/caseId.js`'s `generateCaseNumber(source="CRM")` produces `"{source}-{year}-{5digit}"`. Different call sites pass different `source` values (`"CRM"` in the generic controller path, `"BAIS"` in the client-intake auto-creation path) — no single-format enforcement.

**Schema-level indexes:** 40 total (listed in full in the underlying research); notable gap — `assignedAttorney` lacks the `{field:1,status:1}` compound pattern applied to `assignedTeamLead`/`assignedCaseManager`/`primaryOwner`/`secondaryOwner`.

**New field collision analysis:**

| New Field | Exists Already | Collision Risk | Notes |
|---|---|---|---|
| caseStructure | No | None | No match anywhere. |
| caseRole (on Case) | No top-level field | None | Only nested `role` inside `assignmentHistorySchema`/`caseParticipantSchema` subdocs. |
| parentCaseId | **Near-duplicate exists** | **Medium — redundant naming** | `parentCase` (ObjectId ref Case, indexed) already serves this exact purpose; recommend reusing it rather than adding a second field with a different name for the same concept. |
| childIndex | No | None | No match. |
| childCaseCount | No | None | `childCases` array exists but no stored count. |
| creationSource | No | **Low — possible confusion, not a true collision** | `legacySource` (enum BAIS/INSZoom/shared) already exists but records *sync origin*, not *creation trigger*. Distinct purpose; naming should avoid conflating the two in documentation/UI. |
| leadId (on Case) | No | None | Not on Case (exists on Lead.js itself and StrategyCallQueueItem, unrelated). |
| consultationId (on Case) | No | None | Exists on `Lead.consultationId` (ref Appointment) — unrelated model. |
| createdBy | **Yes, exists** | **Direct match — additive only if shape unchanged** | Line 406, simple `ObjectId ref User`, not required, already indexed. No action needed unless a richer shape is desired. |
| employerProfileId | No | None | Closest existing: `employer`/`organization` (ref Company), `employerCompanyProfile` (Mixed), `clientProfile` (ref Client). |
| personProfileId | No | None | Closest existing: `clientProfile`, `beneficiary`. |
| dataEntryMode | No | None | No match anywhere. |
| assignmentOverridden | No | None | `assignmentHistory` array and separate `CaseAssignmentEvent` collection track reassignment audit trail but no boolean override flag. |

**Confirmed from completed H-phase work:**

| Field | Present | Exact Name |
|---|---|---|
| visaVariant | **No** | Does not exist anywhere in the codebase. |
| oClassification | **No** | Does not exist anywhere in the codebase. |
| pClassification | **No** | Does not exist anywhere in the codebase. |
| canonicalProfile | Yes (two distinct instances) | `Case.canonicalProfile` (top-level, described above) **and** `Case.participants[].canonicalProfile` (per-participant, plain Mixed) — same field name, different shape/level; any Phase 2 work must disambiguate which one it means. |
| clientUserId | **No** | The actual field is `Case.user` (ObjectId ref User, indexed). |
| assignedTeamLead | Yes | `Case.assignedTeamLead` (ObjectId ref User, indexed). |
| assignedCaseManager | Yes | `Case.assignedCaseManager` (ObjectId ref User, indexed, in 3 compound indexes). |

---

## 4. All Other Models — Current State

63 model files exist total (61 besides User/Case). Every one was read in full; compact field/index/hook summaries for all of them are on record from the research pass. The models most relevant to the upcoming architecture are detailed below; the remaining ~50 (AIJob, AIPromptTemplate, AIProviderConfig, Answer, Appointment, AuditLog, AuthSession, CalendarAvailability/Event/Integration/Resource, Conversation, Dashboard, DataRightsRequest, DeviceToken, DisclaimerAcceptance, Document, DocumentAnalysis, DocumentExtraction, DocumentProcessingJob, DocumentUploadSession, EODReport, EmailLog, JobLock, Message, MessageTemplate, Notification, NotificationPreference, NotificationTemplate, PackageDefinition, Payment, PaymentLedgerEntry, PaymentRequest, PetitionPackage, Question, QuestionLibraryItem, Questionnaire, QuizDefinition, Referral, ReportExecution, ReportTemplate, SavedSearch, ScheduledReport, ScoringConfig, SearchHistory, Settings, StaffPerformance, StrategyCallQueueItem, Task, TelemetryEvent, USCISFormSyncRun, Workflow, WorkflowTemplate) were confirmed to have **no fields colliding with any planned new field or model name**, and are not further detailed here since they are not directly implicated in the Case/User/Lead/Profile architecture change. None reference `EmployerProfile`, `EmployeeProfile`, or `BeneficiaryProfile`.

### Lead.js — ALREADY EXISTS, NARROW SCOPE
**File:** `Backend/src/models/Lead.js` | **Collection:** `leads`

Already fully implemented — **not a placeholder.** Models an anonymous **public eligibility-quiz prospect** (per its own header comment, explicitly distinct from the authenticated case-based eligibility engine). Fields: `fullName, email(indexed), phone, visaPathway(indexed), source, message, utm{}, profileAnswers(Mixed), criteriaAnswers[], scoreResult{tier,pathwayString,routing,...}, disclaimerAcceptedVersion, consultationId→Appointment, strategyQueueId→StrategyCallQueueItem, crmSyncStatus(indexed)/crmSyncedAt/Attempts/Error, status(new/contacted/booked/converted/closed, indexed), assignedTo→User(indexed), seenAt/seenBy, notes[], ipHash, userAgent`.

**No `caseId`/`case` field exists at all** — this Lead model never links to a Case. **Referenced by name:** `StrategyCallQueueItem.leadId` (`ref: "Lead"`, required).

**Collision implication:** `mongoose.model("Lead", ...)` is **already registered**. If the planned new Lead model is a different, broader entity (e.g. tied to Case/Company/User for a general sales pipeline), it will collide with this registration (Mongoose throws `OverwriteModelError` on a second `mongoose.model("Lead", ...)` call, or the second registration silently wins depending on load order — either way, unsafe). This must be resolved explicitly in Phase 2 planning: rename the existing quiz-Lead model, namespace the new entity differently, or design the new Lead model as a superset/migration of this existing schema (and update `StrategyCallQueueItem.leadId`'s reference accordingly).

### CaseForm.js
**File:** `Backend/src/models/CaseForm.js` | **Collection:** `caseforms`

One document per (case, form template, participant) — enforced by partial-unique compound index `{caseId, formTemplateId, participantId}`. `caseId` (ref Case, required) is the sole owning link. `participantId`(bare ObjectId, no `ref`)/`participantRole`(String) is the closest existing precedent to a "profileOwner"-style concept, but it scopes the **whole CaseForm document**, not individual mapped fields, and is not named `profileOwner`. Field data itself is untyped Mixed (`filledData`, `fieldValues`, `sourceAttribution`, `manualOverrides`) — no per-field schema on this model. Also carries `formVersionLock` (immutable point-in-time snapshot of form/mapping/validation/rendering versions), `syncState` (drift-tracking between canonical data and filled values), `versions[]`, `fieldHistory[]`, `reviewState`.

### USCISFormTemplate.js (the "FormTemplate" model)
**File:** `Backend/src/models/USCISFormTemplate.js` | **Collection:** `uscisformtemplates`

See §0 preface and §11 for the full finding. No `fieldMappings` array. Closest analog is `formFields[].mapping` — a **fixed set of named string paths** (`clientField, caseField, beneficiaryField, companyField, questionnaireField, ocrField, staticValue`), not an enum/flag. Real mapping data + versioning lives in the separate `USCISMappingVersion` model (`graph.edges[]`, `checksum`, `status: draft/needs_review/active/retired`). No `normalizedPdfPath` field exists — the actual field is `pdfStorageKey` (plus a richer `artifacts.form.{storageKey,checksum,...}` block). No per-mapping `sha256` field; the closest thing is `USCISMappingVersion.checksum` (a whole-graph checksum, not per-entry).

### Beneficiary.js — precursor candidate for BeneficiaryProfile
**File:** `Backend/src/models/Beneficiary.js` | **Collection:** `beneficiaries`

Large, comprehensive person-profile model already deeply integrated (referenced by `Client.beneficiary`, `Company.beneficiaries[]`, `Answer`, `Document`, `DocumentAnalysis`, `DocumentExtraction`, `CalendarEvent`, `Workflow`). Has `caseIds` (plural array, ref Case) — a many-to-many beneficiary↔case relationship already exists here. Duplicates most of `Client.js`'s field shape (flat+nested passport/visa fields, family members, employment/education history) — this pre-existing near-duplication between `Beneficiary` and `Client` is directly relevant to designing `BeneficiaryProfile`/`EmployeeProfile` and should be resolved rather than compounded.

### Company.js — precursor candidate for EmployerProfile
**File:** `Backend/src/models/Company.js` | **Collection:** `companies`

Already has `employees[]`(ref User), `hrManager`/`hrUsers[]`(ref User), `immigrationPrograms[]`, `beneficiaries[]`(ref Beneficiary) — the closest existing precursor to `EmployerProfile`, but scoped broadly as an org record (billing, offices, documents) rather than narrowly to petition-relevant employer data.

### Client.js — precursor candidate for EmployeeProfile / generic PersonProfile
**File:** `Backend/src/models/Client.js` | **Collection:** `clients`

1:1 linked to `User` (unique/sparse) and to `Beneficiary` (unique/sparse). Carries portal/intake-specific state `Beneficiary` lacks: `intakeData`, `intakeProgress`, `intakeSubmission{status,caseId→Case,...}`, `assessmentAnswers/RecommendedVisa/MatchPercentage`, `selectedPlan`. Otherwise near-identical schema shape to `Beneficiary` — same duplication concern noted above.

### CaseAssignmentEvent.js / CaseHistoryArchive.js
Both are append-only audit/overflow collections, immutable at the model layer (`pre("save")` throws 409 on update). `CaseAssignmentEvent` tracks reassignment events per case, written alongside (not instead of) `Case.assignmentHistory`. `CaseHistoryArchive` is a generic overflow store for any capped array field on any model, not Case-specific despite the name.

### New model collision check
A repo-wide `Glob`/`Grep` for `EmployerProfile`, `EmployeeProfile`, and `BeneficiaryProfile` (as file names and as literal strings) returned **zero matches anywhere in `Backend/src`.** These three names are genuinely greenfield — no naming collision risk. One loose false-positive to be aware of: `DocumentExtraction.syncedTargets.beneficiaryProfile`/`.caseProfile` are plain **Boolean sync-completion flags**, not references to any model named BeneficiaryProfile/CaseProfile — no such models exist; don't mistake this for a pre-existing dependency.

---

## 5. Case Document Creation Points

No creation point anywhere in the codebase wraps its writes in a Mongoose transaction (`startSession`/`startTransaction` — zero matches across `Backend/src/modules`). Every `Case.create()`/`new Case()` is a bare, non-atomic write, frequently followed by separate, unguarded `.save()` calls on newly-created `User`/`Client`/`Beneficiary`/`Company` records with no rollback path if a later step fails.

**Creation Point 1**
- **File:** `Backend/src/modules/cases/case.controller.js`
- **Line:** 653 (`exports.createCase`)
- **Trigger:** `POST /cases` — generic case-creation endpoint
- **Role check present:** No — only `authorizePermissions("cases:create")`, a permission granted to both `client` and `employer` roles (no `authorizeRoles` gate at all)
- **Transaction present:** No
- **Fields set:** caseNumber/caseId, clientPortalId, user/employerUser/employeeUser (defaulted from requester), createdBy/lastModifiedBy, clientProfile, beneficiary, petitioner(+Model), employer, organization, parentCase, clientName/clientEmail, package/primaryPackage/plan.tier, checklistItems, status, assignedTeamLead/teamId, assignedAgent*, primaryOwner, assignedCaseManager, legacySource
- **Child cases/profiles created:** No new User/Client/Beneficiary/Company row (only linked if IDs supplied); `hydrateCaseRelationships` does `$addToSet` updates
- **VIOLATION FLAG: yes** — reachable directly by `client`/`employer` roles with attacker-influenced `req.body` spread onto the document, no staff involvement

**Creation Point 2**
- **File:** `Backend/src/modules/cases/case.controller.js`
- **Line:** 1672 (`exports.createCaseWithClient`)
- **Trigger:** `POST /cases/create-with-client`
- **Role check present:** Yes — `authorizeRoles("super_admin","admin","team_lead","case_manager")` + permission check; comment explicitly documents this as the staff/INSZoom-portal path
- **Transaction present:** No
- **Fields set:** full case document plus new `User`+`Client` creation, invite token + email
- **Child cases/profiles created:** Yes — new User + upserted Client
- **VIOLATION FLAG: no** — correctly staff-gated; this is the intended sole legitimate path per the target architecture

**Creation Point 3**
- **File:** `Backend/src/modules/clients/client.service.js`
- **Line:** 193 (`ensureCaseForCompletedClient`, invoked from `saveProfile` at line 338)
- **Trigger:** `PUT /clients/me` — **fires automatically** whenever a client's own profile-completion flag (`client.completed`) becomes true, with no separate case-creation action
- **Role check present:** Route allows `client` role via `clients:update` permission; no staff check gates the case-creation side effect itself
- **Transaction present:** No
- **Fields set:** caseId (`generateCaseNumber("BAIS")`), caseNumber (`generateCaseNumber("CRM")`), clientPortalId, user, clientProfile, beneficiary, clientName/clientEmail, visaCategory/visaType, stage:"intake", status:"pending_assignment", checklistItems, assessmentAnswers, plan.tier, assignedTeamLead/teamId, stageHistory, legacySource:"BAIS"
- **Child cases/profiles created:** Calls `beneficiaryService.syncFromClient` (creates/updates a Beneficiary)
- **VIOLATION FLAG: CRITICAL** — a Case is auto-created purely as a side effect of a client's own intake/profile submission; exactly the "questionnaire/intake creates a Case" pattern the target architecture forbids

**Creation Point 4**
- **File:** `Backend/src/modules/family-workflow/family-workflow.controller.js`
- **Line:** 202 (`exports.createFamilyCase`)
- **Trigger:** `POST /family-workflow/cases` (K-1/K-3 family petition self-initiation)
- **Role check present:** `authorizeRoles("client")` only (plus a check that blocks "beneficiary" from self-initiating — "client"/petitioner is the intended caller)
- **Transaction present:** No
- **Fields set:** caseNumber/caseId, visaType/Category, petitionType, user, beneficiaryUser, petitionerUser(=req.user), createdBy, beneficiary, beneficiaryInvite, familyCompletionMode, familyWorkflow.*, legacySource:"BAIS"
- **Child cases/profiles created:** Yes — upserts Beneficiary; optionally creates a new User (beneficiary role) via invite
- **VIOLATION FLAG: CRITICAL** — case creation directly and exclusively initiated by a `client` role hitting a self-service endpoint

**Creation Point 5**
- **File:** `Backend/src/modules/employment-workflow/employment-workflow.controller.js`
- **Line:** 310 (`exports.createEmployerCase`)
- **Trigger:** `POST /employment-workflow/cases` (employer/client self-service "add employee case")
- **Role check present:** `authorizeRoles("employer","client")` + permission check — both explicitly intended as self-service callers
- **Transaction present:** No
- **Fields set:** full case document incl. `jobPosition`, `employerEmployeeWorkflow`, `participants[employer,employee]`
- **Child cases/profiles created:** Yes — `ensureEmployerCompany` creates Company if needed; upserts Beneficiary; optionally new User+Client via invite
- **VIOLATION FLAG: CRITICAL** — case creation directly initiated by `employer`/`client` roles

**Creation Point 6**
- **File:** `Backend/src/modules/single-party-filings/single-party-filing.controller.js`
- **Line:** 40 (`exports.createFiling`)
- **Trigger:** `POST /single-party-filings/cases` — literally "selecting a filing type creates the case" (per the file's own comment)
- **Role check present:** **None at all** — only the generic `cases:create` permission every `client` already holds
- **Transaction present:** No
- **Fields set:** caseNumber/caseId, visaType/Category, caseType:"individual_filing", petitionType/SubType, user, principalCaseRef, status:"pending_assignment", stage:"intake", legacySource
- **Child cases/profiles created:** None directly; auto-assigns a default questionnaire
- **VIOLATION FLAG: CRITICAL** — textbook "package/filing-type selection creates a Case," with the weakest guard of all six paths

**Seed script (expected/acceptable):** `Backend/src/seeds/seedCases.js` — not HTTP-reachable, gated behind `assertDemoSeedAllowed()`, explicitly stamps `isDemoData: true`. No action needed.

**Test-only creation sites** (not real app paths, excluded from the violation count): numerous `*.test.js` files under `ai`, `family-workflow`, `form-mapping`, `form-generation`, `h1b-e2e`, `uscis-form-import`, `uscis-forms`, `canonical` use `new Case()`/`Case.create()` purely as fixtures.

**Summary:** 5 of the 6 real, HTTP-reachable Case-creation code paths are directly callable by non-staff roles (`client`/`employer`), and none uses a database transaction to make its associated child-record writes atomic.

---

## 6. Authentication and Auth Middleware — Current State
**Login handler file:** `Backend/src/modules/auth/auth.routes.js` → `auth.controller.js` → `auth.service.js`
**Auth middleware file:** `Backend/src/middleware/authenticate.js` (also `optionalAuthenticate.js`, `authorizeRoles.js`, `authorizePermissions.js`)

**Current accepted credentials:** Email + password only, via `POST /api/auth/login`. `authService.login()` performs exactly one lookup: `User.findOne({ email: email.toLowerCase() }).select("+password")`. **No branch anywhere accepts a Case ID, case number, or any non-email identifier.** Other entry points: Google OAuth redirect flow (`GET /auth/google` → `/auth/google/callback`, also email-keyed), `POST /auth/google-token` (currently disabled, returns 503), `POST /auth/refresh` (refresh-cookie based), invite-token acceptance (not a login).

**JWT payload fields:**
- Access token: `userId`, `role` (raw, unnormalized), `tokenVersion`, + auto `iat`/`exp` (default 7d expiry). **No `email`, `name`, `permissions`, `teamId`, or `companyId` in the token.**
- Refresh token: `userId`, `tokenVersion`, `jti` (random hex, collision-avoidance), + `iat`/`exp`.

**`req.user` fields after middleware:** A full rehydrated Mongoose `User` document minus `password` only (`.select("-password")` overrides all other `select:false` schema flags, so `twoFactorSecret`, `emailVerificationTokenHash`, `passwordResetTokenHash`, `inviteTokenHash` are all present on `req.user`) — every field listed in §2's table, plus document methods. The narrower, client-facing shape (`toAuthJSON()`) is what actually goes into API *responses*, not what's on `req.user` internally.

**Role values recognized:** Canonical enum (matches `User.role`): `super_admin, admin, team_lead, case_manager, employer, employee, client, beneficiary`, plus legacy `user`→`client` normalization. **Unreachable role strings referenced in route guards but not in the actual DB enum:** `attorney`, `paralegal` (`immigration-lifecycle/routes/lifecycleRoutes.js`), `petitioner` (referenced only in a service-level array, not a route guard) — these checks can never match a real `User` document today; pre-existing dead logic worth flagging.

**Existing session-context endpoint:** **No.** Zero matches for `session-context`/`session_context`/`sessionContext` anywhere in `Backend/src`. The closest existing endpoint is `GET /api/auth/me`, which returns `{success, user: toAuthJSON(), features: {unifiedChecklist}}` — no role-based redirect payload, no "where should this user go" logic.

**Answers to explicit questions:**
1. **No caseId-as-alternative-to-email login path exists today.**
2. Minimal touch points to add one (not implemented, for planning only): make `auth.routes.js`'s `emailRule` conditional on which identifier is supplied; branch `auth.controller.js:login` on identifier type; add a second lookup branch in `auth.service.js:login` (there is no `caseId` field on `User` today, so this would require resolving `Case.findOne({caseNumber/caseId}) → linked User field`, following the pattern already used in `employeeInvite.service.js`/`clientInvite.service.js`). Everything downstream of obtaining a `user` document is identifier-agnostic and needs no change.
3. Full JWT field list — see above.
4. Full `req.user` field list — see above (§2's full User field table, minus `password`).
5. `/api/auth/session-context` does **not** exist.
6. **No backend-side role-based redirect exists for standard login** — `authPayload()` returns a flat JSON body with no `redirectUrl`/`Location` header; the frontend interprets `user.role` itself. The **one** partial exception is the Google OAuth callback, which 302-redirects to a fixed `/auth/callback` path carrying `role` as a query param for the *frontend* to interpret — the backend itself picks the same destination path regardless of role.

---

## 7. CORS Configuration — Current State
**File(s):** `Backend/src/config/env.js` (source of truth), `Backend/src/app.js` (Express middleware), `Backend/src/modules/realtime/realtime.gateway.js` (Socket.IO, separate config block)

**Allowed origins:** `env.clientOrigins`, sourced from `CLIENT_URLS` (comma-separated) → `ALLOWED_ORIGINS` → `CLIENT_URL` → dev default `"http://localhost:5173,http://localhost:3002"`. Both BAIS (5173) and INSZoom (3002) dev origins sit as **plain, undifferentiated entries in one flat array** — there is no portal-aware tagging anywhere in the CORS layer. Production boot fails if no origin is configured or if any configured origin is "unsafe" (non-HTTPS or localhost), except two hardcoded `localhost` exceptions carved out specifically so a local INSZoom dev instance can call the production backend.

**Allowed methods:** `GET, POST, PUT, DELETE, PATCH, OPTIONS`.
**Allowed headers:** `Content-Type, Authorization, Idempotency-Key, X-Payment-Request-Id, X-Request-Id, X-Correlation-Id, x-api-key, x-internal-api-key`.
**Credentials:** `true` (required — refresh token travels as an httpOnly cookie scoped to `/api/auth`).
**Preflight handler:** No explicit `app.options()`; the `cors` npm package auto-handles preflight since it's mounted globally ahead of all routes.
**Portal-specific differentiation:** None — one `cors()` call applies identically to every `/api` route regardless of caller portal.
**Single vs. scattered config:** Origins are single-sourced from `env.clientOrigins`, but there are **two independent CORS-configuration call sites** that must be kept in sync by hand: the Express `cors()` middleware in `app.js`, and Socket.IO's own `cors` constructor option in `realtime.gateway.js` (narrower `methods: [GET, POST]` only, its own hardcoded fallback if `origins` were ever omitted). Both currently consume `env.clientOrigins` at runtime so they don't drift in practice, but they are not unified into one shared config object.

**Risk for new endpoints:** Low for simply adding routes (global middleware covers everything under `/api`); Medium if a future frontend origin needs to be added, since it must be added to the shared env var *and* verified against the Socket.IO block's fallback default if that ever gets exercised.

---

## 8. Client Portal Router — Current State
**File(s):** `BAIS/Frontend/src/App.jsx`, `BAIS/Frontend/src/utils/postLoginDest.js`, `BAIS/Frontend/src/components/ProtectedRoute.jsx`, `BAIS/Frontend/src/components/eligibility/BlockIfHasCase.jsx`, `BAIS/Frontend/src/context/AuthContext.jsx`

**All routes:**

| Path | Component | Protected | Guard Logic |
|---|---|---|---|
| `/`, `/about`, `/how-it-works`, `/offers` | Home/About/HowItWorks/Offers | No | none |
| `/eligibility` | EligibilityIntro | No | `BlockIfHasCase` |
| `/eligibility/results/:leadId?` | EligibilityResults | No | none |
| `/eligibility/quiz` | EligibilityQuiz | No | `BlockIfHasCase` |
| `/consultation/book/:leadId?`, `/consultation/booking/:token` | BookConsultation/ManageBooking | No | none |
| `/dashboard`, `/dashboard/profile`, `/dashboard/messages`, `/dashboard/plan`, `/dashboard/filing-type`, `/dashboard/payments*`, `/dashboard/intake` | respective pages | Yes | `ProtectedRoute` → `BlockEmployeeRoute` |
| `/dashboard/documents(/:caseId)`, `/dashboard/document-review` | Documents/DocumentReview | Yes | `ProtectedRoute` only (the one area invited employees can reach) |
| `/login`, `/signup`, `/accept-invite`, `/forgot-password`, `/reset-password`, `/auth/callback` | Auth pages | No | none |
| `/admin`, `/admin/portal` | AdminLogin/AdminPortal | No (route-level) | in-component role check only |

**Answers to explicit questions:**
1. **A backend-aware AuthGate exists but is inconsistently applied**: `postLoginDest.js`'s `resolvePostLoginDest(user)` calls `GET /cases/my` to decide `/dashboard` vs `/dashboard/intake` (staff roles get redirected to the separate INSZoom app entirely). It's used in `Login.jsx` and partially in `Register.jsx`, but **`OAuthCallback.jsx` — the actual working Google OAuth landing page — bypasses it entirely**, hardcoding `navigate(role === "admin" ? "/admin/portal" : "/dashboard")`. This means a staff Google login lands on BAIS's own `/dashboard` instead of being handed to INSZoom, and a brand-new client is sent to `/dashboard` instead of `/dashboard/intake` — a real, already-existing bug relative to the app's own intended contract.
2. **Routing-after-login logic is replicated in four separate places** rather than centralized: `postLoginDest.js` (Login.jsx, partial Register.jsx), `OAuthCallback.jsx` (its own divergent logic), `Dashboard.jsx` (a mount-time fallback effect re-deriving "does this client have a case" via the same `/cases/my` call), and `Intake.jsx` (mirrors the check in the opposite direction). No single component owns this decision.
3. **Routing driven by non-backend-authoritative local/session state:** `Intake.jsx` is the primary offender — an entirely client-side, in-memory quiz (`answers`/`visibleSteps`/`isComplete` local state) determines when the "package selection" screen renders, and `choosePackage()` **stashes the selection in `localStorage` and only then calls the backend** to create the case (or defers to signup with the selection carried in query params if not logged in). `FilingTypeSelection.jsx`, `PlanSelection.jsx`, and `Dashboard.jsx`'s visa-info popup similarly branch navigation on locally-held UI state rather than a backend-confirmed session value.
4. **Redirects to a package/plan page:** `App.jsx` route `/dashboard/plan` → `PlanSelection.jsx` (reachable only by direct link — no code path `navigate()`s there); `Intake.jsx`'s package/plan UI is rendered **inline** on the same `/dashboard/intake` route rather than via a route redirect.
5. **Direct Case-creation triggers from the client portal:** `Intake.jsx:983` → `casesApi.create()` → `POST /cases` (Creation Point 1, §5); `FilingTypeSelection.jsx:63` → `singlePartyFilingsApi.create()` → `POST /single-party-filings/cases` (Creation Point 6, §5). Both are the exact client-portal call sites feeding the two weakest-gated Case-creation endpoints found in §5.

**Routing logic that must be removed per the target architecture:** the entirety of `Intake.jsx`'s local-state-driven quiz→package→case-creation flow, the duplicated post-login destination logic in `OAuthCallback.jsx`/`Dashboard.jsx`/`Intake.jsx`, and both direct case-creation call sites (`casesApi.create`, `singlePartyFilingsApi.create`) once case creation is locked to staff-only per the target architecture.

---

## 9. Staff CRM Router — Current State
**File(s):** `INSZoom/frontend/src/App.jsx`, `INSZoom/frontend/src/components/ProtectedRoute.jsx`, `INSZoom/frontend/src/contexts/AuthContext.jsx`

**All routes:**

| Path | Component | Protected |
|---|---|---|
| `/login` | Login | No |
| `dashboard` | Dashboard | `module="dashboard"` |
| `leads` | Leads | `module="leads"` |
| `crm-cases`, `crm-cases/:id` | CRMCases/CRMCaseDetail | `module="cases"` |
| `messages*` | Messaging | `module="messaging"` |
| `companies` | Companies | `module="companies"` |
| `documents*` | Documents | `module="documents"` |
| `leaderboard`, `analytics` | Leaderboard/Analytics | `module="reports"` |
| `uscis-forms` | USCISForms | `module="cases"` |
| `case-managers*` | CaseManagers/CaseManagerDetails | `module="case-managers"` |
| `eod-reports` | EODReports | `module="reports"` |
| `payments` | PaymentsOverview | `module="payments"` |
| `users*`, `staff-profile/:userId` | Users pages | `module="users"` |
| `settings` | Settings | `module="settings"` |
| `questionnaires` | QuestionnaireTemplates | `module="questionnaires"` |
| `tasks*` | Task pages | `module="dashboard"` |
| `teams` | Teams | `module="teams"` **+ `requiredRoles=['super_admin','admin','team_lead']`** |

Every route is nested under one `Layout` shell; `ProtectedRoute` additionally **actively rejects and force-logs-out any `client`/`user`-role account** found authenticated in this app (not just hides routes — a `useEffect` proactively calls `logout()`). A second, INSZoom-specific gate (`canAccessAdminPortal(user)`) runs both on mount and inside `login()` itself.

**Case creation / Lead / assignment findings:**
- `casesApi.createWithClient` (→ Creation Point 2, §5) is wired from `CaseManagers.jsx`/`CreateCaseModal.jsx` — the actual "New Case" staff UI.
- `casesApi.assignCaseManager` is fully wired (`CRMCaseDetail.jsx`, `CaseManagerDetails.jsx`).
- **Lead management exists but conversion is stubbed**: `Leads.jsx` calls `leadsApi.list/markSeen/updateStatus/addNote`; `'converted'` is only a status label — no `leadsApi.convert(...)`-style call wires a Lead to an actual case-creation flow.
- **No per-case "assign team lead" action exists anywhere** — `team_lead` is only a user-role attribute set via the Teams page (`POST/PATCH /team-members`); unlike case-manager assignment, there is no case-level team-lead-assignment endpoint or UI, a partial/stubbed feature relative to case-manager assignment.

---

## 10. Notification / Email Mechanism — Current State
**File(s):** `Backend/src/modules/notifications/*.js`, `Backend/src/modules/email/*.js`

**Mechanism type:** Hybrid. A genuine centralized `NotificationService` (`notification.service.js`) exists with `createNotification()`, `createForRoles()`, and a true named-event dispatcher `createFromEvent()` — but `createFromEvent` is only exposed via an **admin-only utility route** (`POST /api/notifications/events`), not used as the primary trigger mechanism. The dominant real-world pattern across the app is **inline calls** to `notificationService.createNotification({type, ...})` at the point of each business event, using a shared ~140-value `type` vocabulary (`notification.constants.js`) rather than a decoupled event bus.

**Existing events handled:** `case.created/assigned/status_changed/closed`, `document.uploaded/approved/rejected`, `questionnaire.assigned/submitted`, `workflow.sla_breached`, `message.received`, `payment.failed`, `security.failed_logins` (all only reachable via the admin event route — not otherwise triggered directly by name).

**Ad-hoc nodemailer calls bypassing the email layer:** **None found.** A whole-tree grep confirms `nodemailer`/`sendMail(`/`transporter.` appear **only** inside `email/providers/nodemailer.provider.js` — fully centralized.

**Bypass of NotificationService (not of the email layer) — 8 modules call `emailService.sendTemplateEmail()` directly instead of routing through `notificationService.createNotification({emailTemplate,...})`:**

| File | Template | Context |
|---|---|---|
| `auth/auth.controller.js:317` | password-reset | forgot-password |
| `auth/clientInvite.service.js:70` | client-portal-invitation | client invite |
| `auth/employeeInvite.service.js:76` | employee-case-invitation | employee invite |
| `cases/case.controller.js:1737` | client-portal-invitation | new-case client creation |
| `employment-workflow/employment-workflow.controller.js:258` | employee-case-invitation | employment workflow invite |
| `family-workflow/family-workflow.controller.js:112` | family-beneficiary-invitation | family/beneficiary invite |
| `consultation/consultation.service.js` (4 call sites) | consultation-* templates | booking lifecycle |
| `consultation-routing/routing.service.js:141` | consultation-confirmation | public quiz routing |
| `leads/lead.service.js` (2 call sites) | quiz-lead-internal/confirmation | public quiz lead capture |

These still route through the centralized `EmailLog`/provider abstraction (never touch nodemailer directly), but bypass `NotificationService`'s in-app-notification creation, preference filtering, and audit trail.

**Answers to explicit questions:**
1. Yes, `NotificationService` exists and is genuinely centralized for in-app/realtime/push delivery orchestration.
2. Mixed — a true named-event API exists (`createFromEvent`) but is admin-route-only; the dominant pattern is inline `createNotification({type,...})` calls at each business-event call site.
3. No ad-hoc nodemailer usage exists; 8 modules bypass `NotificationService` (not the email/provider layer) — listed above.
4. To fully centralize: route those 8 call sites through `notificationService.createNotification({..., emailTemplate, emailData, emailTo})` instead of calling `emailService.sendTemplateEmail()` directly — `dispatchEmailChannel()` already supports exactly this pattern (used correctly today by `client-intake.service.js`'s `notifySubmission()`). Call-site change only, no new infrastructure needed.

---

## 11. FormTemplate Model and Seeding — Current State
**Model file:** `Backend/src/models/USCISFormTemplate.js`
**Mapping-data model:** `Backend/src/models/USCISMappingVersion.js`
**Seeding scripts:** `Backend/src/modules/uscis-form-import/seeds/{i129,i129f,i130,i134,i539,i539a,i907}.seed.js` (template activation only) + `Backend/src/modules/form-mapping/seeds/{i129-h1b,i129f-k1,i130-k3}-mapping.seed.js` (mapping-graph seeding — only 3 exist)

**`profileOwner` field present on fieldMappings:** **No — the `fieldMappings` array itself does not exist.** (See §0 preface.)
**`allowsOccurrenceOverride` field present:** **No — zero matches anywhere in the codebase.**
**`sha256` field present:** **No dedicated per-entry field.** Whole-graph checksums exist (`USCISMappingVersion.checksum`, computed via `crypto.createHash("sha256")` in `MappingGraphService.graphChecksum()`) and whole-artifact checksums exist (`USCISFormTemplate.artifacts.form.checksum`) — neither is a per-mapping-entry field.

**Seeded forms status:**

| Form ID | Edition | Template Seeded | `pdfStorageKey` set (via importer) | Mapping-graph seed exists | `profileOwner`/`allowsOccurrenceOverride` on entries |
|---|---|---|---|---|---|
| I-129 | (per active template) | Yes | Yes | **Yes** (`i129-h1b-mapping.seed.js`) | No — field doesn't exist |
| I-129F | — | Yes | Yes | **Yes** (`i129f-k1-mapping.seed.js`) | No |
| I-130 | — | Yes | Yes | **Yes** (`i130-k3-mapping.seed.js`) | No |
| I-134 | — | Yes | Yes | **No mapping seed exists** | N/A |
| I-539 | — | Yes | Yes | **No mapping seed exists** | N/A |
| I-539A | — | Yes | Yes | **No mapping seed exists** | N/A |
| I-907 | — | Yes | Yes | **No mapping seed exists** | N/A |

All seven forms have an **active template record** (verified statically that startup seeding runs `i129.seed.js` through `i907.seed.js` unconditionally when `USCIS_TEMPLATE_SEED_ON_STARTUP=true`; not confirmed against a live DB in this read-only audit). Only three of seven have any field-mapping data at all — I-134/I-539/I-539A/I-907 templates exist but cannot autofill anything today.

---

## 12. AutoFillService — Current State
**File path:** `Backend/src/modules/form-mapping/services/AutoFillService.js`

**Reads from:** `CaseForm` (existing instance, for diffing/version history — not as the primary data source), `USCISFormTemplate` (via `FormMappingService.loadTemplate`), `USCISMappingVersion` (via `FormMappingService.loadMappingVersion`), and — as its **sole source of "canonical" fill data** — `CanonicalDataService.build(caseId,...)`, which **always forces a fresh rebuild** of `Case.canonicalProfile` (not a read of the persisted value) plus a fallback read of `Case.questionnaireData.masterData`.
**Writes to:** `CaseForm` (all fill output/version/audit fields), `AuditLog` (every action), and — only inside `overrideField`, only via `CanonicalProfileService.applyStaffEdit` (explicitly documented in code as "the ONLY place that mutates `Case.canonicalProfile`") — `Case.canonicalProfile`.
**Uses `profileOwner` routing:** No — the field doesn't exist. Employer-vs-beneficiary routing is implicit in string-prefixed `sourcePath` values (`"employer.*"` vs `"beneficiary.*"`) resolved generically against one merged canonical object.
**Reads from `Case.canonicalProfile`:** Indirectly and always freshly recomputed (see above), plus a direct `.select("canonicalProfile.version")` read in `overrideField` for optimistic-concurrency checks.
**Reads from an `EmployerProfile` model:** No such model exists. Employer data comes from `Company`, joined via `Case.companyId` — but this join happens three layers downstream, inside `CanonicalBuilderService`, not in `AutoFillService` itself.
**Reads from an `EmployeeProfile`/`Beneficiary` model:** No `EmployeeProfile` model exists. `Beneficiary` data is joined via `Case.beneficiary`, again only inside `CanonicalBuilderService`.
**Mutates canonical data during fill:** Not during a pure `generate()`/`preview()` call except as a side effect of the forced `canonicalProfile` rebuild (a recompute-from-sources operation, appends to `Case.canonicalHistory`). `overrideField` (a manual field-level correction, arguably a distinct operation from "fill") does directly mutate canonical data via `CanonicalProfileService.applyStaffEdit`.
**Output storage:** `AutoFillService` itself never touches `pdf-lib` or renders a PDF — it only persists JSON (`filledData`/`fieldValues`) on `CaseForm`. Actual PDF rendering lives in a separate, unconnected module (`form-generation/services/PDFFieldMapper.js`), not invoked from this service at all.

---

## 13. CanonicalSyncService — Current State
**Exists:** Yes
**File path:** `Backend/src/modules/canonical/services/CanonicalSyncService.js` (53 lines)
**Direction 1 implemented (canonical → form):** **No.** This service never touches `CaseForm` in either direction — pushing canonical data into a form is done entirely by `AutoFillService.generate()`, a separate, uncoordinated code path.
**Direction 2 implemented (form edit → canonical):** **No.** A form-field manual edit is pushed back to canonical entirely by `AutoFillService.overrideField()` calling `CanonicalProfileService.applyStaffEdit` directly — `CanonicalSyncService` is bypassed for this too.
**What `CanonicalSyncService` actually does:** A third, independent trigger — `syncCase()`/`syncParticipant()`/`syncFromDocument()`/`syncFromExtraction()` — that forces a canonical-profile *rebuild* in response to document/OCR-extraction change events (called from `document-intelligence.service.js`, `document.workflow.service.js`, and `questionnaire.service.js`).
**`profileOwner` routing implemented:** No — doesn't exist anywhere.
**`allowsOccurrenceOverride` handling:** No — doesn't exist anywhere.
**Infinite-loop guards:** None visible in code (no re-entrancy flag, no depth counter), but statically no cycle exists in the current 3-caller call graph. All four call sites swallow sync failures silently (`.catch(() => null)`), so a sync failure never surfaces to the triggering flow.

---

## 14. Questionnaire Submission Handlers — Current State

**No handler in this section creates a Case document directly.** Every path either requires an existing `caseId` (404s otherwise) or, for the public quiz, only performs a read-only `Case.exists()` guard to *block* submission if a case already exists.

**Handler 1 — `saveAnswers`** (`questionnaires/questionnaire.service.js:1105`)
- Endpoints: `POST /:id/autosave`, `POST /:id/answers`, `/:id/answers/files`
- Writes: `Answer` (upsert), `Questionnaire.analytics`, `Case.questionnaireData/journeyProgress/timeline/auditHistory` — **and directly writes `Case.participants[].canonicalProfile.profile` via `flattenForSet()`**, in addition to calling `canonicalSyncService.syncCase()` — a duplicated/parallel canonical-write path, flagged for review.
- Creates Case: No. Redirects to package page: No (API only). Case status change: No. Notification/email: None directly.

**Handler 2 — `submitResponse`** (line 1412, `POST /:id/submit`) — wraps Handler 1 (`status:"submitted"`), same canonical-write characteristics; triggers `workflowService.triggerWorkflow` and `checklistRuleEngineService` downstream (neither creates a Case, confirmed by grep). No notification/email call in this function itself.

**Handler 3 — `approveResponse`** (line 1454, staff review counterpart, not a client submission) — writes `Answer`/`Case.questionnaireReferences` status only. No canonical write, no Case creation.

**Handler 4 — `syncFileAnswerFromDocument`** (line 1374, document-upload adjacent) — delegates to Handler 1's write profile; no new behavior.

**Handler 5 — `assignQuestionnaire`** (line 719, `POST /:id/assign`) — the one handler in this section that **does** call `notificationService.createNotification({type:"questionnaire_sent"})` directly (in-app only, no email template attached).

**Handler 6 — `evaluateChecklistTriggers`** (checklist-rule-engine.service.js:87, internal only, invoked from Handler 2) — confirmed no `Case.create`; only reassigns/deactivates questionnaires via Handler 5's writes.

**Handler 7 — `saveClientIntake`** (`client-intake/client-intake.service.js:269`, `PUT /client-intake/me`) — writes `Client` (~40 flattened fields) and `Case.clientProfile/user/clientName/clientEmail/visaType/visaCategory/journeyProgress` **directly, with no `CanonicalSyncService` call anywhere in this file** — a second, entirely separate canonical-write path from the questionnaire module's. Requires an existing case (404 if none) — does not create one. No notification/email in this function.

**Handler 8 — `submitClientIntake`** (line 369, `POST /client-intake/me/submit`) — same no-Case-creation guard; same direct `Client`/`Case` writes with no `CanonicalSyncService` call; **does** correctly call `notificationService.createNotification()` with an attached `emailTemplate` (the correct centralized pattern), plus a supplementary direct `realtimeGateway.emitToUser()` socket push (minor duplication, not a correctness issue). Delegates possible case-status escalation to an **unaudited** downstream function, `caseWorkflowAutomation.runPostClientSubmission` — flagged as needing follow-up since it's the one place status escalation could plausibly happen off an intake submission, and it was outside this pass's file list.

**Handler 9 — public eligibility quiz `submit()`** (`eligibility-quiz/quiz.service.js:80`, `POST /eligibility-quiz/submit`, public/rate-limited) — creates a **`Lead`** document (not Case, not Client) via `leadService.createQuizLead()`; the only `Case` interaction is the read-only `rejectIfHasCase()` guard. Sends email **directly via `emailService.sendTemplateEmail()`**, bypassing `NotificationService` entirely (consistent with §10's bypass list).

**Two architectural findings to carry forward:** (1) both the questionnaire module and the client-intake module write "canonical" profile fields directly onto `Case`/`Client` rather than exclusively through `CanonicalSyncService` — three uncoordinated canonical-write paths now exist in total (questionnaire's direct write + `canonicalSyncService.syncCase`, client-intake's direct write with no sync-service call at all, and `AutoFillService.overrideField`'s `CanonicalProfileService.applyStaffEdit`); (2) the public quiz's lead-capture flow is one more confirmed member of the §10 NotificationService-bypass list.

---

## 15. New Field and Model Collision Analysis

| Item | Type | Already Exists | Collision Risk | Additive or Modifies | Notes |
|---|---|---|---|---|---|
| User.primaryCaseId | field | No | None | Additive | — |
| User.caseIds | field | No (on User) | None | Additive | Precedent shape at `Beneficiary.caseIds` |
| User.legacyNoCaseAccount | field | No | None | Additive | — |
| User.migrationStatus | field | No | None | Additive | — |
| User.leadId | field | No (on User) | None | Additive | — |
| User.mustSetPassword | field | No | None | Additive | — |
| User.caseRole | field | No | None | Additive | — |
| User.principalCaseId | field | No (on User) | None | Additive | Conceptually parallels `Case.principalCaseRef` |
| Case.caseStructure | field | No | None | Additive | — |
| Case.caseRole | field | No top-level | None | Additive | Nested `role` exists only in subdocs |
| Case.parentCaseId | field | **`parentCase` exists** | **Medium — redundant naming** | Should reuse existing field | Recommend against adding a second field name |
| Case.childIndex | field | No | None | Additive | — |
| Case.childCaseCount | field | No | None | Additive | `childCases` array exists, no count |
| Case.creationSource | field | No (adjacent: `legacySource`) | Low — naming confusion only | Additive | Distinct purpose from `legacySource` |
| Case.leadId | field | No (on Case) | None | Additive | — |
| Case.consultationId | field | No (on Case) | None | Additive | — |
| Case.createdBy | field | **Yes, exact match** | None if shape unchanged | Already present | Simple ref, not required |
| Case.employerProfileId | field | No | None | Additive | — |
| Case.personProfileId | field | No | None | Additive | — |
| Case.dataEntryMode | field | No | None | Additive | — |
| Case.assignmentOverridden | field | No | None | Additive | — |
| Lead (model) | model | **Yes — different scope** | **High — Mongoose model-name collision** | Requires explicit decision | Existing model is a narrow anonymous-quiz-prospect entity, hard-referenced by `StrategyCallQueueItem.leadId` |
| EmployerProfile (model) | model | No | None | Additive (greenfield) | `Company` is the closest conceptual precursor |
| EmployeeProfile (model) | model | No | None | Additive (greenfield) | `Client` is the closest conceptual precursor |
| BeneficiaryProfile (model) | model | No | None | Additive (greenfield) | `Beneficiary` is the closest conceptual precursor; pre-existing Client/Beneficiary duplication should inform design |
| FormTemplate.fieldMappings[].profileOwner | field | **No — the array itself doesn't exist** | **High — brief's premise is incorrect** | Requires new model/schema design, not a field addition | Real mapping data lives in `USCISMappingVersion.graph.edges[]`; see §0/§11 |

---

## 16. Risk Register

| ID | Category | File | Finding | Risk Level | Dependent Files | Action Required |
|---|---|---|---|---|---|---|
| R1 | Case creation | `cases/case.controller.js:653` | Generic `POST /cases` creatable by client/employer roles, no role gate, no transaction | CRITICAL | BAIS `Intake.jsx`, any other caller of `casesApi.create` | Add staff-only role gate or remove/deprecate this endpoint for client-facing use before Phase 2 relies on staff-only case creation |
| R2 | Case creation | `clients/client.service.js:193` | Case auto-created as a side effect of client profile completion, no staff gate | CRITICAL | `client.controller.js saveMyProfile`, BAIS profile/intake UI | Redesign flow so profile completion no longer creates a Case; must precede any Phase 2 work assuming case creation is staff-only |
| R3 | Case creation | `family-workflow/family-workflow.controller.js:202` | `client`-role self-service case creation | CRITICAL | BAIS family/K-1 flow (not directly traced in this pass) | Same as R1/R2 |
| R4 | Case creation | `employment-workflow/employment-workflow.controller.js:310` | `employer`/`client`-role self-service case creation | CRITICAL | BAIS employer onboarding flow (not directly traced) | Same as R1/R2 |
| R5 | Case creation | `single-party-filings/single-party-filing.controller.js:40` | No role gate at all; BAIS `FilingTypeSelection.jsx` calls it directly | CRITICAL | BAIS `FilingTypeSelection.jsx` | Same as R1/R2 |
| R6 | Case creation | all of Backend/src/modules | Zero Mongoose transactions used anywhere for Case + related child-record creation | HIGH | Every creation point in §5 | Introduce `session`/`startTransaction` wrapping before the new atomic "principal + child Cases + EmployerProfile + EmployeeProfiles" creation transaction is built in a later phase |
| R7 | Model naming | `models/Lead.js` | `mongoose.model("Lead", ...)` already registered for a narrow anonymous-quiz-prospect entity | CRITICAL | `StrategyCallQueueItem.leadId` (hard ref by model name) | Explicit decision required: rename existing model, namespace new entity differently, or design new Lead as superset + migrate the `StrategyCallQueueItem` reference |
| R8 | FormTemplate/mapping architecture | `models/USCISFormTemplate.js`, `models/USCISMappingVersion.js` | No `fieldMappings` array, no `profileOwner`, no `allowsOccurrenceOverride`, no per-entry `sha256`, no `normalizedPdfPath` exist anywhere; real mapping data lives in a differently-shaped separate model | CRITICAL | `AutoFillService`, `CanonicalSyncService`, `FormMappingService`, all mapping seeds | Phase 2 planning for "add profileOwner to fieldMappings" needs to be rewritten against the actual `USCISMappingVersion.graph.edges[]` shape, not the assumed shape |
| R9 | Form mapping coverage | `form-mapping/seeds/` | Only I-129, I-129F, I-130 have any mapping-graph seed; I-134/I-539/I-539A/I-907 have templates but zero mappings | CRITICAL | AutoFillService for those 4 forms is non-functional today | Must be resourced/scheduled explicitly — this is a pre-existing gap, not something the new architecture creates, but it blocks any "all seven forms autofill" assumption |
| R10 | Visa variant work | `models/Case.js` | `visaVariant`, `oClassification`, `pClassification` — described as completed/frozen — do not exist anywhere in the codebase | CRITICAL | Any Phase 2 work assuming these fields exist | Verify with stakeholders whether this work exists elsewhere, was reverted, or the brief is describing target state; do not build on top of an assumed-present field |
| R11 | Auth | `auth/auth.service.js` | No caseId+password login path exists; would require route/controller/service changes across 3 files | HIGH | `auth.routes.js`, `auth.controller.js`, `auth.service.js` | Scope this as real implementation work in Phase 2, not a trivial addition |
| R12 | Auth | `auth/auth.routes.js`, `routes/index.js` | No `/api/auth/session-context` endpoint exists | HIGH | Frontend `AuthGate` design depends on this | Must be built from scratch |
| R13 | CORS | `app.js`, `realtime.gateway.js` | Two independent CORS config blocks (Express + Socket.IO) must be kept in sync by hand; no portal-aware origin differentiation | MEDIUM | Any future portal-specific CORS policy | Consider unifying into one shared config object if per-portal CORS is ever needed |
| R14 | Frontend routing | BAIS `OAuthCallback.jsx` | Diverges from `postLoginDest.js`'s contract — staff Google-login isn't redirected to INSZoom, new clients aren't sent to intake | HIGH | Google OAuth login UX | Pre-existing bug; will compound if a new `AuthGate` component is added without first reconciling this divergence |
| R15 | Frontend routing | BAIS `postLoginDest.js`, `OAuthCallback.jsx`, `Dashboard.jsx`, `Intake.jsx` | Post-login destination logic replicated in 4 places, no single AuthGate | HIGH | All 4 files | Must be consolidated into the planned AuthGate component, not layered on top of the existing 4 |
| R16 | Frontend routing | BAIS `Intake.jsx` | Entire client-side quiz→package-selection→case-creation flow uses local/localStorage state ahead of any backend authority | HIGH | `Intake.jsx`, `FilingTypeSelection.jsx`, `PlanSelection.jsx` | Must be redesigned/removed once case creation moves server-side/staff-only |
| R17 | Canonical data | `questionnaires/questionnaire.service.js`, `client-intake/client-intake.service.js`, `form-mapping/services/AutoFillService.js` | Three uncoordinated code paths write "canonical" Case/Client data directly (questionnaire direct write + syncCase, client-intake direct write with no sync-service call, AutoFillService.overrideField via CanonicalProfileService) | HIGH | Any future canonical-profile consolidation effort | Should be unified before adding `profileOwner`-based routing on top |
| R18 | Notifications | 8 files listed in §10 | Bypass `NotificationService`, call `emailService.sendTemplateEmail()` directly | MEDIUM | Notification preference/audit coverage for these flows | Call-site-only fix, low complexity, but currently incomplete |
| R19 | Data model duplication | `models/Beneficiary.js`, `models/Client.js` | Near-total field-shape duplication between two models | MEDIUM | Any EmployerProfile/EmployeeProfile/BeneficiaryProfile consolidation | Should inform (not necessarily block) the new profile-model design |
| R20 | Dead code | `middleware/authorizeRoles.js` callers | `attorney`, `paralegal`, `petitioner` referenced in route guards but absent from the actual `User.role` enum | LOW | `immigration-lifecycle/routes/lifecycleRoutes.js` | Currently harmless (unreachable), but confusing; clean up opportunistically |
| R21 | Index gap | `models/Case.js:540` | `assignedAttorney` lacks the `{field:1,status:1}` compound pattern its sibling assignment fields all have | LOW | Query performance only if this field becomes hot | Add compound index if attorney-assignment queries become common |
| R22 | INSZoom | `INSZoom/frontend/src/pages/Leads.jsx` | Lead-to-case "conversion" is only a status-label change; no real convert-to-case API exists | MEDIUM | Any Phase 2 lead-conversion UX | Needs to be built, not assumed to already exist |
| R23 | INSZoom | INSZoom app-wide | No per-case "assign team lead" endpoint/UI exists (only case-manager assignment is wired) | MEDIUM | Case detail UI | Needs to be built if team-lead-per-case assignment is part of the target architecture |
| R24 | Messaging infra discrepancy | `config/firebase-admin.js`, `notifications/push.service.js` | Brief states "messaging uses GCP web push stubs" post-Firebase-removal; actual code still uses the `firebase-admin` SDK/FCM for push notifications | LOW | Push notification delivery | Not necessarily broken (Firebase *Auth* removal is confirmed complete and correctly scoped away from this), but the brief's characterization of messaging is inaccurate — verify intent with stakeholders |
| R25 | Field naming ambiguity | `models/Case.js` | `canonicalProfile` exists as two differently-shaped fields at two different nesting levels (top-level vs. per-participant) | MEDIUM | Any code/migration referencing "canonicalProfile" by name alone | Require explicit top-level-vs-participant disambiguation in all Phase 2 specs |

---

## 17. Unexpected Findings

**Finding A — "Frozen" visa-variant work does not exist in the codebase.** The audit brief lists `oClassification`, `pClassification`, and `Case.visaVariant` as completed, frozen work. A full read of `Case.js` plus a whole-repo grep found zero matches for all three names. This is unexpected because it directly contradicts the brief's premise; it must be resolved with stakeholders before any Phase 2 work assumes these fields exist (see R10).

**Finding B — "Frozen" FormTemplate field-mapping architecture does not match the brief's description.** The brief describes `FormTemplate.fieldMappings` entries gaining a `profileOwner` field, implying such an array with such entries already exists. No `fieldMappings` array exists on `USCISFormTemplate` at all; the actual mapping data lives in a separate `USCISMappingVersion` model with a completely different entry shape, and only 3 of the 7 required forms have any mapping data seeded. This is unexpected and materially changes the scope of the planned `profileOwner` work (see R8/R9).

**Finding C — a second, undocumented Lead model already exists.** The brief describes "New Lead model and lead-generation flows" as upcoming work, implying no Lead model exists yet. `Lead.js` is fully built and in active use (public quiz funnel), and is referenced by name from `StrategyCallQueueItem`. This is unexpected because it means "add a new Lead model" is actually "reconcile with an existing, differently-scoped Lead model" (see R7).

**Finding D — 5 of 6 real Case-creation code paths are reachable by non-staff roles today**, with the weakest (`single-party-filings`) having no role gate whatsoever beyond a generic permission every `client` already holds. This is unexpected in scale — the brief anticipated *some* legacy creation paths needing removal, but not that the large majority of the app's case-creation surface area is currently non-staff-reachable, nor that none of it uses a database transaction (see R1–R6).

**Finding E — three uncoordinated "canonical data" write paths already exist**, none of which is the `CanonicalSyncService` its name implies should own this. `CanonicalSyncService` itself doesn't implement either sync direction (canonical→form or form→canonical) — those live in `AutoFillService`. This is unexpected because the brief characterizes the "two-way sync engine" as complete/frozen, but the actual responsibility is split across three uncoordinated services. Not itself a blocker for Phase 2 (the sync engine's 37+ tests may well cover the paths that exist), but worth noting the code organization doesn't match the name (see R17).

**Finding F — `OAuthCallback.jsx` already has a bug relative to the app's own routing contract** (staff Google-login isn't sent to INSZoom; new-client Google-signup isn't sent to intake). This predates and is unrelated to the planned AuthGate work but will be inherited by it if not fixed first (see R14).

**Finding G — Firebase Admin SDK (FCM) is still actively used for push notifications**, contradicting the brief's claim that messaging was migrated to "GCP web push stubs." Firebase *Auth* removal is confirmed correctly done and scoped away from this file. Likely just an inaccuracy in the brief's phrasing rather than a real gap, but should be confirmed (see R24).

**Finding H — `Beneficiary` and `Client` are near-duplicate schemas** with almost identical field shapes (address/employment/education history, flat+nested passport/visa duplication, same sync-hook pattern), evolved independently rather than as one canonical person-profile model. This pre-existing duplication is directly relevant to how `EmployerProfile`/`EmployeeProfile`/`BeneficiaryProfile` should be designed and is worth resolving as part of that work rather than adding a fourth overlapping schema (see R19).

**Finding I — no migration framework exists in this codebase at all.** No files or directories matching "migration" perform an actual schema migration (the two files that matched by name are unrelated domain services). Any Phase 2 work that needs to backfill/transform existing `Case`/`User`/`FormTemplate` documents will need to introduce migration tooling from scratch — not itself a violation, but worth flagging since the brief refers to "migration scripts" as if a mechanism already exists to run them.

**Finding J — the backend test suite has a known, pre-existing baseline of 58 failing tests** (486/544 passing), confirmed via an in-progress, untracked work journal in the repo (`docs/forms/AUTOFILL_FIX_JOURNAL.md`, dated 2026-08-26) unrelated to this audit's scope but useful context: failures are attributed to MongoDB/S3 `EACCES` integration issues and unrelated route/PDF assertions, not to anything found in this audit. Phase 2 should not assume a fully green baseline.

---

## 18. Summary Table

| Category | File Path | Finding | Risk Level | Action Required in Phase 2 | Blocks Implementation |
|---|---|---|---|---|---|
| Case creation | `cases/case.controller.js:653` | Generic case creation open to client/employer roles | CRITICAL | Gate or remove before staff-only assumption is built on top | Yes |
| Case creation | `clients/client.service.js:193` | Case auto-created on client profile completion | CRITICAL | Redesign trigger | Yes |
| Case creation | `family-workflow/family-workflow.controller.js:202` | Case creation open to client role | CRITICAL | Gate or remove | Yes |
| Case creation | `employment-workflow/employment-workflow.controller.js:310` | Case creation open to employer/client roles | CRITICAL | Gate or remove | Yes |
| Case creation | `single-party-filings/single-party-filing.controller.js:40` | Case creation with zero role gate | CRITICAL | Gate or remove | Yes |
| Data integrity | all Case-creation code | No transactions anywhere | HIGH | Introduce transactional creation | Yes (for the atomic creation transaction feature specifically) |
| Model naming | `models/Lead.js` | Existing Lead model collides with planned new Lead model | CRITICAL | Explicit reconciliation decision | Yes |
| Form mapping | `models/USCISFormTemplate.js`, `USCISMappingVersion.js` | Brief's assumed fieldMappings/profileOwner shape doesn't exist | CRITICAL | Redesign against actual schema | Yes |
| Form mapping | `form-mapping/seeds/` | Only 3/7 forms have mapping data | CRITICAL | Resource the remaining 4 forms | Yes (for those 4 forms) |
| Visa variant fields | `models/Case.js` | visaVariant/oClassification/pClassification absent | CRITICAL | Stakeholder verification needed | Yes, if Phase 2 depends on them |
| Auth | `auth/auth.service.js` | No caseId login path | HIGH | Build from scratch (3-file change) | Only for the dual-login feature |
| Auth | `auth/auth.routes.js` | No session-context endpoint | HIGH | Build from scratch | Only for the AuthGate feature |
| CORS | `app.js` / `realtime.gateway.js` | Duplicated config, no portal differentiation | MEDIUM | Optional unification | No |
| Frontend routing | `OAuthCallback.jsx` | Diverges from postLoginDest contract | HIGH | Fix before layering AuthGate on top | Yes, for AuthGate correctness |
| Frontend routing | 4 files (§8 Q2) | Post-login logic replicated 4x | HIGH | Consolidate into AuthGate | Yes |
| Frontend routing | `Intake.jsx` | Local-state-driven quiz/package/case-creation flow | HIGH | Redesign/remove | Yes |
| Canonical data | 3 services (§17 Finding E) | Uncoordinated canonical-write paths | HIGH | Unify before profileOwner routing added | Recommended before Phase 2 mapping work |
| Notifications | 8 files (§10) | Bypass NotificationService | MEDIUM | Route through createNotification | No |
| Data duplication | Beneficiary.js / Client.js | Near-duplicate schemas | MEDIUM | Inform new profile-model design | No |
| Dead code | authorizeRoles callers | Unreachable role strings | LOW | Opportunistic cleanup | No |
| Index gap | `Case.js:540` | assignedAttorney missing compound index | LOW | Add if needed | No |
| INSZoom | `Leads.jsx` | No real lead-to-case conversion | MEDIUM | Build if in scope | Only if lead conversion is in Phase 2 scope |
| INSZoom | app-wide | No per-case team-lead assignment | MEDIUM | Build if in scope | Only if in Phase 2 scope |
| Messaging | firebase-admin.js | Brief's "GCP web push stubs" claim inaccurate | LOW | Confirm with stakeholders | No |
| Naming ambiguity | `Case.js` canonicalProfile | Same name, two shapes/levels | MEDIUM | Disambiguate in all specs | Recommended |
| Tooling gap | repo-wide | No migration framework exists | MEDIUM | Introduce tooling if backfills needed | Only if backfill migrations are needed |
| Test baseline | Backend test suite | 58 known pre-existing failures | LOW | Don't assume green baseline | No |

---

## 19. Phase 2 Readiness Verdict

**BLOCKED — CRITICAL FINDINGS MUST BE RESOLVED:**

1. **Five non-staff-reachable, non-transactional Case-creation code paths** (R1–R6, §5) must be closed or explicitly re-scoped before "case creation locked behind server-side admin/team_lead role guard" and the "atomic case creation transaction" can be built — otherwise the new architecture would be layered on top of five still-open legacy paths that bypass it entirely.
2. **The existing `Lead` model naming collision** (R7) must be explicitly resolved — rename, namespace, or design-as-superset — before any "New Lead model" work begins, to avoid a Mongoose model-registration conflict or silent data-model confusion with the already-live public-quiz-lead feature.
3. **The FormTemplate/fieldMappings/profileOwner premise in the brief does not match the actual schema** (R8, R9) — the planned "add profileOwner to fieldMappings" work needs to be rescoped against the real `USCISMappingVersion.graph.edges[]` structure, and the fact that 4 of 7 forms have zero mapping data needs an explicit resourcing decision before AutoFillService work for those forms can proceed.
4. **The visa-variant fields described as completed/frozen do not exist** (R10) — this must be verified with stakeholders (built elsewhere? reverted? aspirational?) before any Phase 2 task assumes their presence.
5. **Frontend post-login routing is already inconsistent/buggy across 4 components** (R14, R15) — the planned AuthGate component should not be added as a 5th mechanism; the existing 4 must be reconciled or replaced as part of that work, not left in place alongside it.

None of these require architectural rework of what's already planned — they are scoping corrections and pre-existing-bug fixes that the planned Phase 2 work should incorporate rather than build around. Once items 1–5 above have an explicit resolution (even if the resolution is "acknowledged, will be fixed as part of Phase 2 itself" for some of them), the remaining HIGH/MEDIUM/LOW findings in the risk register are normal, well-scoped implementation work and do not block starting.

---

## 20. Files Read During This Audit

**Entry point / structure / config (read directly):**
`Backend/src/app.js`, `Backend/src/server.js`, `Backend/src/routes/index.js`, `Backend/src/config/firebase-admin.js`, `Backend/src/modules/notifications/push.service.js`, `Backend/.env.example` (via research pass), `docs/forms/AUTOFILL_GAPS.md`, `docs/forms/AUTOFILL_FIX_JOURNAL.md`, `docs/forms/PHASE_POC_REPORT.md` (context only, not scored as an audit finding).

**Models (all read in full):** `User.js`, `Case.js`, `CaseAssignmentEvent.js`, `Client.js`, `CaseForm.js`, `USCISFormTemplate.js`, `USCISMappingVersion.js`, `Lead.js`, `Beneficiary.js`, `Company.js`, `CaseHistoryArchive.js`, plus all remaining 50 models listed in §4.

**Case-creation search:** whole-tree grep across `Backend/src` for `new Case(`, `Case.create(`, `Case.insertOne(`, `Case.bulkWrite`, `createCase`, `provisionCase`, plus full reads of `cases/case.controller.js`, `clients/client.service.js`, `family-workflow/family-workflow.controller.js`, `employment-workflow/employment-workflow.controller.js`, `single-party-filings/single-party-filing.controller.js`, `seeds/seedCases.js`.

**Auth/CORS:** `auth/auth.routes.js`, `auth.controller.js`, `auth.service.js`, `token.service.js`, `session.service.js`, `google-oauth.service.js`, `password.service.js`, `employeeInvite.service.js`, `clientInvite.service.js`, `middleware/authenticate.js`, `optionalAuthenticate.js`, `authorizeRoles.js`, `authorizePermissions.js`, `authorization/rbac.service.js`, `roleHierarchy.js`, `config/env.js`, `modules/realtime/realtime.gateway.js`, `scripts/phase2Verify.js`.

**Frontend routers:** `BAIS/Frontend/src/App.jsx`, `postLoginDest.js`, `ProtectedRoute.jsx`, `BlockIfHasCase.jsx`, `context/AuthContext.jsx`, `Pages/Auth/Login.jsx`, `Register.jsx`, `OAuthCallback.jsx`, `Pages/Dashboard/Dashboard.jsx`, `Intake.jsx`, `FilingTypeSelection.jsx`, `PlanSelection.jsx`, `Offers.jsx`, `services/api.js`; `INSZoom/frontend/src/App.jsx`, `components/ProtectedRoute.jsx`, `contexts/AuthContext.jsx`, `pages/Login.jsx`, `pages/Leads.jsx`, `pages/CaseManagers.jsx`, `components/CreateCaseModal.jsx`.

**Notifications/questionnaires:** `notifications/notification.service.js`, `.controller.js`, `.routes.js`, `.constants.js`, `notificationRules.js`, `reminder-generation.service.js`, `push.service.js`, `device-token.service.js`, `email/email.service.js`, `email/providers/{index,nodemailer}.provider.js`, `email/templates/*.js` (14 files), `questionnaires/questionnaire.routes.js`, `.controller.js`, `.service.js`, `intelligent-questionnaire.service.js`, `checklist-rule-engine.service.js`, `client-intake/client-intake.service.js`, `.controller.js`, `eligibility-quiz/quiz.service.js`, `crmSync.service.js`, `leads/lead.service.js`.

**FormTemplate/AutoFill/Sync:** `models/USCISFormTemplate.js`, `USCISMappingVersion.js`, `form-mapping/services/AutoFillService.js`, `SyncStateService.js`, `form-mapping/controllers/AutoFillController.js`, `canonical/services/CanonicalSyncService.js`, `CanonicalBuilderService.js`, `document-intelligence/config/field-mapping.registry.js`, `uscis-form-import/seeds/*.seed.js` (7 files), `form-mapping/seeds/*-mapping.seed.js` (3 files), `form-mapping/config/*-crosswalk.js`.

---

*This report was produced by the agent during Phase 1 — Read-Only Audit. No files were modified during this phase (the only file written is this report itself). This report must be reviewed and approved by a human before Phase 2 begins.*
