# Form I-907 Premium Processing — checklist update

## 1. Existing implementation inspected

- **Case type** `Premium Processing` (single-party, form `i-907`) and the optional add-on path: a case manager's "Upgrade to Premium Processing" assigns the same checklist to any other case as an explicit staff request (`case.controller.js`, `checklistMappings.seed.js`). Both paths use ONE questionnaire.
- **Checklist** `i907_premium_processing_profile` (`premiumProcessingChecklist.js`): 32 questions in two parts, already close to the specification, no document item. Stored as a draft questionnaire with **no answers, no cases, no per-case copies** (so an in-place update loses nothing).
- **PDF mapping** `i907-crosswalk.js` + the active I-907 mapping graph read each answer by question key (`raw.questionnaireAnswers.<key>.value`), and a test asserts every crosswalk key exists in the checklist.
- **Client**: the standalone case renders the checklist on the generic checklist page; an upgraded case renders it in `PremiumProcessingChecklist.jsx` — both generic over the stored definition.
- **Registry**: I-907 is registered once per visa type; `Premium Processing → I-907` AUTO_CREATE. Nothing here was touched: no second I-907 questionnaire, document checklist, form mapping, template or case type exists or was added.

## 2. Old checklist retired, new one identified

Same identifier **`i907_premium_processing_profile`** (version 1, `latestVersion`), reconciled **in place** by the existing template reconciler: questions whose keys are no longer listed are retired (`active:false`, never deleted — 33 earlier retired questions were already there), new ones are created, and labels / sections / rules are patched. There is therefore exactly one current I-907 questionnaire and no second version to assign; historical answers and documents (none exist today) would stay attached to their questions. The end-to-end test asserts one current questionnaire, and that the active questions equal the new definition.

## 3. Question → canonical mapping

Question keys are unchanged (the PDF mapping depends on them). Section layout: Part 1 (filer, company) · **Mailing Address** · **Physical Address** · Part 2 · Required Document. The mailing and physical blocks are separate sections so the specified identical labels ("Street Number and Name", "City or Town" …) are never ambiguous.

| Spec item | Exact label (spec) | Type | Req. | Canonical path used |
|---|---|---|---|---|
| 1 | Alien Registration Number (A-Number) (if any) | text | optional | `requestFiler.alienNumber` ¹ |
| 2 | USCIS Online Account Number (if any) | text | optional | `requestFiler.uscisOnlineAccountNumber` ¹ |
| 3a/3b | Family Name / Given Name | text | required | `requestFiler.lastName` / `.firstName` |
| 4 | Company or Organization Named in the Related Case (If filed on behalf …) | text | optional | `premiumProcessing.companyOrOrganizationName` |
| 5a–5h | Street / Apt/Ste/Flr / City / State / ZIP / Province / Postal / Country | text, select | 5a,5c,5d,5e,5h required; 5b,5f,5g optional | `requestFiler.mailingAddress.{streetAddress,addressLine2,city,state,zipCode,province,postalCode,country}` |
| 6 | Is your current mailing address the same as your physical address? | radio Yes/No | required | `requestFiler.physicalAddress.sameAsMailingAddress` |
| 7a–7h | same fields | | shown only when 6 = No | `requestFiler.physicalAddress.*` |
| P2-1 | Form Number of Related Petition or Application | select | required | `premiumProcessing.relatedCase.formNumber` |
| P2-2 / P2-3 | Receipt Number of Related Petition or Application | text | required / optional | `premiumProcessing.relatedCase.receiptNumbers[0]` / `[1]` |
| P2-4a/b | Petitioner or Applicant — Family / Given Name | text | required | `premiumProcessing.relatedCase.petitionerOrApplicant.{lastName,firstName}` |
| P2-5a/b | Beneficiary — Family / Given Name | text | required **when the related case has one** | `premiumProcessing.relatedCase.beneficiary.{lastName,firstName}` |
| P2-6a/b/c | Point of Contact … Family / Given / Position Title | text | required when a company is named | `premiumProcessing.companyPointOfContact.*` |
| P2-7 | Company or Organization IRS Employer Identification Number (EIN) (if any) | text | optional | `premiumProcessing.companyOrOrganization.ein` |
| Doc | Copy of related case’s Receipt Notice | file | required | `premiumProcessing.documents.relatedCaseReceiptNotice` |

¹ **Deviation from the proposed `person.aNumber` / `person.uscisOnlineAccountNumber`.** The existing registry path for the same concept is `person.alienNumber`, but `person.*` is the *case's own person*. On a Premium Processing upgrade that is the petition's beneficiary; the I-907 filer is someone else, so writing the filer's A-Number there would overwrite the beneficiary's. `requestFiler.*` keeps the filer separate (the I-907 graph already has a regression test for the same boundary). All 34 paths are registered (`canonical/config/i907CanonicalPaths.js`); none is form- or PDF-specific.

## 4. Conditional behaviour and validation

- **State / ZIP** only for a United States address; **Province / Postal Code** (optional) only for another country — for both mailing and physical.
- **Physical address** shown only when the answer to 6 is No. Answers are never deleted when the gate flips, so entered data returns when switching No → Yes → No. When 6 = Yes the PDF mapping prints no separate physical address (existing behaviour, re-verified) and nothing is duplicated in storage.
- **Beneficiary** questions appear only for related forms that have a beneficiary (**I-129, I-140**); never for I-539 / I-765 / I-131 (self-filed) and not before a form is chosen.
- **Company block** (point of contact, EIN): appears when the company/organization question is answered — the existing filing-context control, so no new workflow was added.
- **Related form dropdown**: I-129, I-140, I-539, I-765, I-131. The earlier list also had "I-290B" and "Other", which are not forms of the registry; both were removed. A test asserts each remaining form is a registry form that sits beside I-907 on the same visa types.
- Formats: receipt number (3 letters + 10 digits, both receipt fields), A-Number, 12-digit account number, EIN, ZIP; choice answers must be one of the listed options (enforced server-side).
- **Optional really is optional (platform change, opt-in).** By default this platform needs *every visible question* answered to submit, so an "optional" A-Number or apartment number would still have blocked Submit. Questions flagged `metadata.optional` are now excluded from the submit checks — server (`calculateCompletion`, `calculateDetailedProgress`, `assertSubmittable`) and client (`useQuestionnaireAnswers`, `Documents.jsx`, `PremiumProcessingChecklist.jsx`). Only the 11 optional I-907 questions carry the flag; every other checklist behaves exactly as before.

## 5. Document checklist

The old checklist had no document items of its own. Now: one required file question, **Copy of related case’s Receipt Notice** (`i907_doc_relatedCaseReceiptNotice`, category `immigration`). It uses the platform's existing upload path (secure storage, file types / limits, multiple files, uploader, timestamps, review status): an upload becomes a `Document` of the case and syncs back to the question. It is tied to the request by the case, the I-907 checklist reference and the receipt-number answers of the same response. It is unconditional, so it also appears as the case's standing required document. A real file upload was not exercised in the tests (storage was not touched).

## 6. Files changed

`Backend`: `premiumProcessingChecklist.js` (rewritten in place), `canonical/config/i907CanonicalPaths.js` (new), `CanonicalFieldRegistryService.js` (registers them), `questionnaire.service.js` (opt-in optional flag). `Immiglance/Client`: `useQuestionnaireAnswers.js`, `Documents.jsx`, `PremiumProcessingChecklist.jsx` (opt-in optional flag). Tests: `premiumProcessingChecklist.test.js` (updated), `i907Spec.test.js`, `i907-e2e.test.js` (new). **Unchanged:** `i907-crosswalk.js`, the mapping graph, registry seeds, case types, templates. Database effect: the stored questionnaire reconciled to the new definition (done lazily by the existing mechanism; the end-to-end test triggered it).

## 7. Tests

- `premiumProcessingChecklist.test.js` + `i907Spec.test.js`: 19/19 (exact labels / types, canonical paths and registration, optional flags, beneficiary logic, form list vs registry, validation, the single document, crosswalk contract).
- `i907-e2e.test.js` (real database, self-cleaning): provisioning twice → one reference and only Form I-907; one current questionnaire, active questions = new definition, old ones retired; approval gate; Submit passes over blank optional questions and names only the receipt notice as missing; a differing physical address becomes owed; canonical values including `receiptNumbers[0]`, provenance, filer never written to `person.*`; a staff edit survives a later client save; the I-907 PDF still fills from the unchanged mapping — pass.
- All `questionnaires/tests` + I-90 crosswalk + I-907 graph test: 370 of 372 pass. The two failures: the **I-907 graph test** "Classification … never contact.address.line2" (it also failed in the earlier regression run, before this work, and concerns the stored graph, not this checklist) and the **I-90 end-to-end test**, which failed once under parallel database load with a `VersionError` on the case document and **passes when run alone**. Immiglance Client builds.

## 8. Unresolved

- **Prefill** from existing case data (petitioner/applicant, beneficiary, company, contact) is not implemented: the checklist is bound to its own canonical namespace and no existing source populates it, so values are entered by the client; staff can edit them (kept on later saves). A prefill would need a source-to-path map per related form.
- Autofill of the I-907 still reads answers by key rather than through the new canonical paths (unchanged, working); moving it to canonical sources is a separate change.
- Stable per-row ids, multi-file receipt upload, and PDF output for the optional second receipt number (the form has one receipt box) are not applicable / not exercised.
- Existing parallel-run flakiness of the database end-to-end tests (concurrent canonical sync on one case) is pre-existing.
