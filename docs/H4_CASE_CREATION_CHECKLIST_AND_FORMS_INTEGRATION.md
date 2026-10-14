# H-4 Case Creation, Checklist and USCIS Forms Integration

Case type name everywhere: **Change of Status to H-4**.

## 1. Case-creation changes
| Item | Change |
|---|---|
| Filing type | `COS_H4` in `Backend/src/config/filingTypes.js` (toStatus `H-4`, fromStatus wildcard `null` so it is reachable from any current status, visaType `COSH4`, questionnaireKey `cos_h4_questionnaire`). |
| Visa category | `COSH4` in `config/visaCategories.js` (single party, forms `i-539`, label "Change of Status to H-4"); child of "H-4" in `config/visaHierarchy.js`. |
| Admin dropdowns | `Admin/frontend/src/utils/visaOptions.js` (`cosh4`) and `CreateCaseModal.jsx` (`cosh4 -> COS_H4`). The Create Case list is also served from `GET /cases/visa-types`, which reads `VISA_CATEGORIES`, so the option appears wherever that list is used. |
| Form registry | `VisaFormMapping` rows for `COSH4` (see section 5). |
| Optional H-1B link | Backend accepts `principalCaseRef`. There is no Admin UI field for it yet (limitation). |

## 2. Checklist
- Key `cos_h4_questionnaire`, file `Backend/src/modules/questionnaires/cosH4Checklist.js`, client role, 36 questions (28 fields, 8 documents), **every question `required: false`**.
- Sections: Information about You; Other Information; Most Recent Entry in USA; physical address outside USA; Application type; Document Checklist; "If applying for H4, then provide the following documents as well:".
- Application type radio has exactly: "Reinstatement to student status", "An extension of stay in my current status", "Change of status". Selecting reinstatement shows a non-blocking warning and is flagged `case_manager_review`. Selecting "Change of status" reveals "New status and effective date of change (mm/dd/yyyy):" and "The change of status I am requesting is:".
- Canonical paths: `person.*`, `contact.*`, `immigration.*`, `beneficiary.usMailingAddress`, `beneficiary.usPhysicalAddress`, `beneficiary.foreignAddress.*`, `application.*`, `beneficiary.documents.*`, `principalH1B.documents.*` (registered in `canonical/config/h4CanonicalPaths.js`).
- The H-1B principal's documents are tagged `documentOwner: h1b_principal`. When uploaded, the Document gets `participantRole: h1b_principal` and `metadata.principalCaseId`, so they are never treated as the beneficiary's own documents.

## 3. Assignment and approval
Case creation auto-assigns exactly one checklist (verified) through the existing `assignQuestionnaire` path. It stays a draft until the Case Manager approves it (`approveChecklists`); the client cannot open it before that (verified).

## 4. Root-cause fix found during verification
`singlePartyChecklists.js` generates a placeholder scaffold for every filing type not listed in `REAL_CONTENT_KEYS`. It re-created a 3-question scaffold under the same key and deactivated the real checklist on each case creation. `COS_H4` is now in that list. Without this the checklist would have collapsed to 3 placeholder questions in production.

## 5. Registry rules (`COSH4`)
| Form | Provisioning |
|---|---|
| I-539 | AUTO_CREATE (primary, in-country change of status) |
| G-28 | CONDITIONAL (attorney on record) |
| I-907 | CONDITIONAL with trigger `premiumProcessing = true` (it was otherwise attached by default; fixed) |
| I-765 | CONDITIONAL |
| DS-160, I-129 | none |

Checklist mappings: I-539 -> `cos_h4_questionnaire` (AUTO), I-765 (CONDITIONAL).

## 6. I-539 PDF mapping
Applied through the generic party-rule engine (`partyFieldRules.js`, I-539 mapping version 12, active). Verified in a downloaded PDF:
name, A-number, USCIS online account, date of birth, mailing address (Item 4) and physical address (Item 6) from their own structured answers, countries of birth/citizenship, SSN, arrival date, I-94, passport number/country/expiry, current status and expiry, requested new status and effective date, and the address outside the U.S. (province, postal code, country).
- Application-type boxes: extension and change of status are ticked from the answer. **Reinstatement is deliberately never mapped** (its edge was removed), so choosing it ticks no box and cannot be misfiled.
- Engine additions: `checkboxEquals`, `remove`, explicit `fallback`; `PartyAliasService` now covers single-party filings and derives `application.requestedStatus` / `requestedStatusEffectiveDate`.
- Unmapped (evidence, not form fields): all uploaded documents, including the H-1B principal's. Principal data is never written into beneficiary fields.

## 7. Persistence, Admin sync, uploads
Answers save and reload intact (address objects, the requested-status record, selects, conditional fields); canonical sync produces the beneficiary profile from the answers. Documents use the existing chunked upload path.

## 8. Tests
- `questionnaires/tests/cosH4Checklists.test.js`: 7/7 pass (transition resolution, exact labels/types/paths, application-type options and flag, document labels and tagging, optionality, registry rows, requested-status derivation).
- Manual end-to-end against the real DB on a single temporary H-4 case (created from F-1, then deleted; no other case was created). Result: 21 of 23 checks pass. The two non-passing checks are test-harness issues, not product defects: (a) the live principal-document upload check (needs real object storage; covered by code path + unit test); (b) the application-type checkbox read-back, whose script lookup collided with same-named fields on other pages. The active I-539 mapping graph was inspected directly instead: `P2_checkbox[0]` (page 2) = "An extension of stay in my current status", `P2_checkbox[1]` = "Change of status", `P2_checkbox[2]` (reinstatement) has no edge.
- Admin production build passes.
- Existing single-party filing tests updated for the new filing type (`COS_H4` added to the expected key set, transition list and real-content exclusion list); all pass except one pre-existing, unrelated route-count guardrail. Wider regression run: 726 pass / 17 fail, the remaining failures being the pre-existing L-1B, I-130/K-3, H-1B, I-539 beneficiary-name, I-907 graph and scaffold/gap tests.

## 9. Performance
Case creation, checklist assignment and form provisioning follow the existing paths; no new queries on hot paths. Mapping v12 adds about 20 edges to I-539.

## 10. Limitations
- No Admin UI field yet to link the H-1B principal case (`principalCaseRef`).
- Principal-document tagging is covered by the code path and unit test; the live upload check needs real storage and was not completed in the manual run.
- Deploy: `syncChecklistDefinitions.js` only knows employment checklists; the H-4 template is created/reconciled by `ensureTemplate("cos_h4_questionnaire")` on first case creation (a stale 3-question scaffold in an existing DB is superseded by the real definition). Production needs deployment and a restart (not done by me).
- Pre-existing unrelated failing tests remain (governanceDefects L-1B, I-130/K-3 and H-1B golden tests).
