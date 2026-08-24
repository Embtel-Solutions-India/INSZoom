# Phase 1 Reconciliation Report — Authoritative formFields vs Crosswalk Mappings

Read-only cross-reference of each seeded template's real, persisted `USCISFormTemplate.formFields`
(the authoritative AcroForm dictionary - see `docs/forms/PHASE1_BASELINE.md`) against its
crosswalk's hand-reviewed `MAPPED_EDGES`. Report-only: nothing here is auto-fixed. Actionable
findings are carried into `docs/forms/PHASE1_RUN_JOURNAL.md`'s ledger entries. Corrections belong
to Phase 2 (mapping/semantic fixes) or later, per the Phase 1 scope guard.

## I-129 (H-1B / L-1A / L-1B, shared crosswalk)

- Real AcroForm fields on the current template: **980**
- Crosswalk-mapped edges: **101**
- unmapped-required-field: **0**
- dangling-mapping: **0**
- semantic-type-mismatch: **5**

### unmapped-required-field
A real, `required=true` AcroForm field with no crosswalk mapping at all - always renders blank on the generated PDF.

_None._

### dangling-mapping
A crosswalk edge whose target field does not exist on the CURRENT template - the template PDF drifted since this crosswalk was authored, or the edge has a typo.

_None._

### semantic-type-mismatch (candidates for Phase 2)
A mapped edge whose transform disagrees with the field's own scanner-inferred `semanticType`/`pdfFieldType`. Flagged as a candidate, not asserted wrong.

> **Root-cause note, not 5 independent findings:** every `date-field-without-date-transform` row below traces back to ONE pre-existing bug in `PDFFieldScannerService.inferTextSemanticType()` (`Backend/src/modules/uscis-form-import/services/PDFFieldScannerService.js:80-93`): its regex `/date|dob|birth|expiry|expires|issued|from|to/` (a) matches the bare substrings "to"/"from" with no word boundary (e.g. "Line_Ci**tyTo**wn" and "Passportor**Tra**vDoc" both contain "to"), and (b) matches "birth" for ANY birth-related field, not only date-of-birth ("CountryOfBirth"/"CityTownOfBirth"/"ProvinceOrStateOfBirth" are place-name text fields, not dates. Characterized-only here (fixing the scanner's regex is extraction code, out of Phase 1 scope) - see the ledger entry in `docs/forms/PHASE1_RUN_JOURNAL.md`. **Practical impact: `semanticType==="date"` cannot be trusted at face value for birth-place-shaped field names until this is fixed** - Phase 2's semantic enforcement should special-case or re-derive this rather than reusing the scanner's raw semanticType unconditionally for country/city-of-birth fields.

| fieldName | source | subclass | note |
| --- | --- | --- | --- |
| form1[0].#subform[0].Line_CityTown[0] | raw.questionnaireAnswers.employer_company_address_city.value | date-field-without-date-transform | Scanner inferred semanticType="date" for this field (from its PDF name) but the crosswalk edge has no {transform:{type:"date"}} - candidate for Phase 2 review, NOT asserted wrong (the source may already resolve to a pre-formatted date string). |
| form1[0].#subform[2].Part3Line4_CountryOfBirth[0] | person.countryOfBirth | date-field-without-date-transform | Scanner inferred semanticType="date" for this field (from its PDF name) but the crosswalk edge has no {transform:{type:"date"}} - candidate for Phase 2 review, NOT asserted wrong (the source may already resolve to a pre-formatted date string). |
| form1[0].#subform[2].Part3Line5_PassportorTravDoc[0] | person.passport.number | date-field-without-date-transform | Scanner inferred semanticType="date" for this field (from its PDF name) but the crosswalk edge has no {transform:{type:"date"}} - candidate for Phase 2 review, NOT asserted wrong (the source may already resolve to a pre-formatted date string). |
| form1[0].#subform[2].Line8d_CityTown[0] | contact.address.city | date-field-without-date-transform | Scanner inferred semanticType="date" for this field (from its PDF name) but the crosswalk edge has no {transform:{type:"date"}} - candidate for Phase 2 review, NOT asserted wrong (the source may already resolve to a pre-formatted date string). |
| form1[0].#subform[15].ClassHLine5b_PassportorTravDoc[0] | raw.questionnaireAnswers.employee_capRegistration_passportNumber.value | date-field-without-date-transform | Scanner inferred semanticType="date" for this field (from its PDF name) but the crosswalk edge has no {transform:{type:"date"}} - candidate for Phase 2 review, NOT asserted wrong (the source may already resolve to a pre-formatted date string). |


## I-129F (K-1)

- Real AcroForm fields on the current template: **445**
- Crosswalk-mapped edges: **34**
- unmapped-required-field: **0**
- dangling-mapping: **0**
- semantic-type-mismatch: **4**

### unmapped-required-field
A real, `required=true` AcroForm field with no crosswalk mapping at all - always renders blank on the generated PDF.

_None._

### dangling-mapping
A crosswalk edge whose target field does not exist on the CURRENT template - the template PDF drifted since this crosswalk was authored, or the edge has a typo.

_None._

### semantic-type-mismatch (candidates for Phase 2)
A mapped edge whose transform disagrees with the field's own scanner-inferred `semanticType`/`pdfFieldType`. Flagged as a candidate, not asserted wrong.

> **Root-cause note, not 4 independent findings:** every `date-field-without-date-transform` row below traces back to ONE pre-existing bug in `PDFFieldScannerService.inferTextSemanticType()` (`Backend/src/modules/uscis-form-import/services/PDFFieldScannerService.js:80-93`): its regex `/date|dob|birth|expiry|expires|issued|from|to/` (a) matches the bare substrings "to"/"from" with no word boundary (e.g. "Line_Ci**tyTo**wn" and "Passportor**Tra**vDoc" both contain "to"), and (b) matches "birth" for ANY birth-related field, not only date-of-birth ("CountryOfBirth"/"CityTownOfBirth"/"ProvinceOrStateOfBirth" are place-name text fields, not dates. Characterized-only here (fixing the scanner's regex is extraction code, out of Phase 1 scope) - see the ledger entry in `docs/forms/PHASE1_RUN_JOURNAL.md`. **Practical impact: `semanticType==="date"` cannot be trusted at face value for birth-place-shaped field names until this is fixed** - Phase 2's semantic enforcement should special-case or re-derive this rather than reusing the scanner's raw semanticType unconditionally for country/city-of-birth fields.

| fieldName | source | subclass | note |
| --- | --- | --- | --- |
| form1[0].#subform[2].Pt1Line24_CityTownOfBirth[0] | raw.questionnaireAnswers.petitioner_info_cityTownOfBirth.value | date-field-without-date-transform | Scanner inferred semanticType="date" for this field (from its PDF name) but the crosswalk edge has no {transform:{type:"date"}} - candidate for Phase 2 review, NOT asserted wrong (the source may already resolve to a pre-formatted date string). |
| form1[0].#subform[2].Pt1Line25_ProvinceOrStateOfBirth[0] | raw.questionnaireAnswers.petitioner_info_stateProvinceOfBirth.value | date-field-without-date-transform | Scanner inferred semanticType="date" for this field (from its PDF name) but the crosswalk edge has no {transform:{type:"date"}} - candidate for Phase 2 review, NOT asserted wrong (the source may already resolve to a pre-formatted date string). |
| form1[0].#subform[3].Pt2Line7_CityTownOfBirth[0] | raw.questionnaireAnswers.beneficiary_info_cityTownOfBirth.value | date-field-without-date-transform | Scanner inferred semanticType="date" for this field (from its PDF name) but the crosswalk edge has no {transform:{type:"date"}} - candidate for Phase 2 review, NOT asserted wrong (the source may already resolve to a pre-formatted date string). |
| form1[0].#subform[3].Pt2Line8_CountryOfBirth[0] | raw.questionnaireAnswers.beneficiary_info_countryOfBirth.value | date-field-without-date-transform | Scanner inferred semanticType="date" for this field (from its PDF name) but the crosswalk edge has no {transform:{type:"date"}} - candidate for Phase 2 review, NOT asserted wrong (the source may already resolve to a pre-formatted date string). |


## I-130 (K-3)

- Real AcroForm fields on the current template: **450**
- Crosswalk-mapped edges: **33**
- unmapped-required-field: **0**
- dangling-mapping: **0**
- semantic-type-mismatch: **4**

### unmapped-required-field
A real, `required=true` AcroForm field with no crosswalk mapping at all - always renders blank on the generated PDF.

_None._

### dangling-mapping
A crosswalk edge whose target field does not exist on the CURRENT template - the template PDF drifted since this crosswalk was authored, or the edge has a typo.

_None._

### semantic-type-mismatch (candidates for Phase 2)
A mapped edge whose transform disagrees with the field's own scanner-inferred `semanticType`/`pdfFieldType`. Flagged as a candidate, not asserted wrong.

> **Root-cause note, not 4 independent findings:** every `date-field-without-date-transform` row below traces back to ONE pre-existing bug in `PDFFieldScannerService.inferTextSemanticType()` (`Backend/src/modules/uscis-form-import/services/PDFFieldScannerService.js:80-93`): its regex `/date|dob|birth|expiry|expires|issued|from|to/` (a) matches the bare substrings "to"/"from" with no word boundary (e.g. "Line_Ci**tyTo**wn" and "Passportor**Tra**vDoc" both contain "to"), and (b) matches "birth" for ANY birth-related field, not only date-of-birth ("CountryOfBirth"/"CityTownOfBirth"/"ProvinceOrStateOfBirth" are place-name text fields, not dates. Characterized-only here (fixing the scanner's regex is extraction code, out of Phase 1 scope) - see the ledger entry in `docs/forms/PHASE1_RUN_JOURNAL.md`. **Practical impact: `semanticType==="date"` cannot be trusted at face value for birth-place-shaped field names until this is fixed** - Phase 2's semantic enforcement should special-case or re-derive this rather than reusing the scanner's raw semanticType unconditionally for country/city-of-birth fields.

| fieldName | source | subclass | note |
| --- | --- | --- | --- |
| form1[0].#subform[1].Pt2Line6_CityTownOfBirth[0] | raw.questionnaireAnswers.petitioner_info_cityTownOfBirth.value | date-field-without-date-transform | Scanner inferred semanticType="date" for this field (from its PDF name) but the crosswalk edge has no {transform:{type:"date"}} - candidate for Phase 2 review, NOT asserted wrong (the source may already resolve to a pre-formatted date string). |
| form1[0].#subform[1].Pt2Line7_CountryofBirth[0] | raw.questionnaireAnswers.petitioner_info_countryOfBirth.value | date-field-without-date-transform | Scanner inferred semanticType="date" for this field (from its PDF name) but the crosswalk edge has no {transform:{type:"date"}} - candidate for Phase 2 review, NOT asserted wrong (the source may already resolve to a pre-formatted date string). |
| form1[0].#subform[4].Pt4Line7_CityTownOfBirth[0] | raw.questionnaireAnswers.beneficiary_info_cityTownOfBirth.value | date-field-without-date-transform | Scanner inferred semanticType="date" for this field (from its PDF name) but the crosswalk edge has no {transform:{type:"date"}} - candidate for Phase 2 review, NOT asserted wrong (the source may already resolve to a pre-formatted date string). |
| form1[0].#subform[4].Pt4Line8_CountryOfBirth[0] | raw.questionnaireAnswers.beneficiary_info_countryOfBirth.value | date-field-without-date-transform | Scanner inferred semanticType="date" for this field (from its PDF name) but the crosswalk edge has no {transform:{type:"date"}} - candidate for Phase 2 review, NOT asserted wrong (the source may already resolve to a pre-formatted date string). |

