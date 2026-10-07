# I-485 Supplement J — Integration Report

## Where it was found
- Official asset: `Backend/dev-assets/uscis/i-485supj_2026-18-09.pdf` (filename date is `yyyy-dd-mm`, i.e. edition **2026-09-18**).
- The registry already knew the form: `i485SupplementJ()` in `form-registry/seeds/visaFormMappings.seed.js` (SUPPLEMENT, CONDITIONAL, `formTemplateFormCode: "i-485j"`, parent I-485, `ADJUSTMENT_OF_STATUS` only). It was **never provisioned** because no template existed under the form code `I-485J`; an earlier on-demand fetch had stored the PDF as `I-485 SUPPLEMENT J` (review, inactive), which no registry row could resolve.

## Registered identity
| | |
|---|---|
| Form code | `I-485J` (matches registry hint `i-485j`; same convention as `i-485a`) |
| Type | Independent USCIS **SUPPLEMENT** with its own PDF/template (same model as I-539A) — not a page-range component |
| Edition / version | 2026-09-18 |
| Template | status `active`, `officialStatus: current`, 139 AcroForm fields, 8 pages, PDF in S3 (`government/uscis/I-485J/2026-09-18/<sha256>/form.pdf`) |
| `visaTypes` | derived from the registry by `deriveVisaTypesFromRegistry` (cannot drift) |
| Autofill graph | `USCISMappingVersion` v4 active, 32 mapped edges, 99 manual-entry, 8 USCIS-use-only (barcodes) |
| Old stray record | `I-485 SUPPLEMENT J` (2026-09-30) retired, not deleted |

## Case types that get it (registry-driven, no hardcoded exceptions)
EB-1B, EB-1C, EB-2 PERM, EB-3 Skilled Worker, EB-3 Professional, EB-3 Other Worker, bare EB-2 and EB-3 (PERM-based by default), and **F4**.
Never universal: CONDITIONAL provisioning, gated on `processingPath = ADJUSTMENT_OF_STATUS`; a consular/petition-only case never receives it.

## Explicitly excluded
EB-1A, EB-2 NIW, EB-4, EB-5, F1, F2A, F2B, F3, IR/CR family categories, all non-AOS paths.

> **Decision note.** The original task brief said *not* to map Supplement J to F4. The requester's later, explicit instruction was to map it to F4 and to give existing cases the form; that instruction was followed. Removing F4 is a one-line change (delete the `i485SupplementJ("F4", …)` line in `visaFormMappings.seed.js`, re-run `loadVisaFormMappings.js` and `seed:i485supj`).

## What changed
- `uscis-form-import/seeds/i485supj.seed.js` (+ `npm run seed:i485supj`) — imports/activates the template through the existing `importLocalForm` pipeline.
- `form-registry/seeds/visaFormMappings.seed.js` — F4 row; clarified Supplement J comment. No other I-485 rows touched.
- `form-mapping/config/i485supj-crosswalk.js` + `seeds/i485supj-mapping.seed.js` (+ `npm run seed:i485supj-mapping`) — canonical-profile → I-485J field graph.
- `scripts/backfillI485SupplementJ.js` (+ `npm run backfill:i485supj`, dry-run by default, `--apply` to write) — gives existing eligible cases the form through the single provisioning path (`ensureAssignedForms`).
- `form-registry/tests/i485SupplementJ.test.js` — 18 tests.

## Autofill and saving
Autofilled from the canonical profile: applicant name/A-number/DOB/country of birth/address/phone/email (Part 2–3), employer name/EIN/address/size/income (Part 6), job title/wage/unit (Part 7), authorized-signatory title/phone/email (Part 8). Never guessed or defaulted (left to the case manager): all Yes/No and basis checkboxes, SOC code, job description, receipt numbers/filing date, signatures, interpreter/preparer blocks.
Verified live on the existing F4 case: workspace opens, autofill wrote 37 values, a case-manager edit saved and persisted (test edit reverted afterwards).

## Validation
- `i485SupplementJ.test.js`: EB-1B, EB-1C, EB-2 PERM, EB-3 Skilled/Professional/Other and F4 → I-485 **+** Supplement J; EB-1A, EB-2 NIW, F1, F2A, F2B, F3, IR-1, CR-1 → I-485 **without** it; consular path → neither; registry rows exact; `ensureAssignedForms` actually creates the `I-485J` CaseForm.
- Live: registry reloaded (484 rows, 0 errors); the existing F4 case (CRM-2026-54429) now holds `I-485J`.
- Regression run (form-registry, form-mapping, uscis-forms, uscis-form-import, cases): **392 tests, 386 pass, 6 fail**. The 6 failures are all integration tests that depend on live-database data (an H-1B golden case, I-130/K-3 and I-129 mapping fixtures, a checklist-release gate): `case-lifecycle-form-provisioning` #6, `h1-i129-mapping` AC1/AC6, two I-130 tests, and the H6 H-1B acceptance suite. None references I-485J, and the database now holds a single F4 case. They were **not** compared against a pre-change baseline (that would need a stash of uncommitted work), so treat them as unrelated-but-unconfirmed.

## Not done / follow-ups
- Edition note: the stored base I-485 template is edition 2026-04-09 while uscis.gov lists 09/18/26; re-import I-485 when ready (see `FormEditionComparisonService`).
- Checklist mappings for I-485J (which client checklist feeds it) were not added; fields come from the canonical profile.
