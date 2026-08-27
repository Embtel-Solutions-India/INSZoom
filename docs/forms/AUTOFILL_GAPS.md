# Autofill Gaps

| LCA field | Extracted value example | Missing question key | Planned fix |
| --- | --- | --- | --- |
| tradeNameDba | INNOTECH | No scalar H-1B company DBA question key found | Add a reviewed questionnaire field if attorneys want DBA collected from LCA. |
| placeOfEmploymentStreet | 500 Tech Park Drive, Suite 200 | No scalar worksite street question key; H-1B catalog exposes repeatable `employer.workLocations` only | Add reviewed scalar worksite questions or a repeatable autofill review flow. |
| placeOfEmploymentCity | San Jose | No scalar worksite city question key; H-1B catalog exposes repeatable `employer.workLocations` only | Add reviewed scalar worksite questions or a repeatable autofill review flow. |
| placeOfEmploymentState | CA | No scalar worksite state question key; H-1B catalog exposes repeatable `employer.workLocations` only | Add reviewed scalar worksite questions or a repeatable autofill review flow. |
| placeOfEmploymentZip | 95110 | No scalar worksite zip question key; H-1B catalog exposes repeatable `employer.workLocations` only | Add reviewed scalar worksite questions or a repeatable autofill review flow. |
| prevailingWage | $98,123 / Year | No scalar prevailing wage amount question key found | Add reviewed prevailing wage amount question if this must autofill. |
| prevailingWagePer | Year | No scalar prevailing wage period question key found | Add reviewed prevailing wage period question if this must autofill. |
| wageUnit | Year | No scalar offered wage period question key found | Add reviewed wage period question if this must autofill. |
| employmentEndDate | Not shown in prompt sample | No scalar employment end date question key found | Add reviewed employment end date question if this must autofill. |
| signatoryName | JOHN M. ANDERSON | No single signing person full-name key; catalog has separate first/last keys | Add parsing or reviewed full-name handling before mapping. |

## Extraction Schema Limitation

`generic-extractor.service.js` currently handles LCA extraction and requests only the existing LCA schema fields. Several confirmed LCA fields now have deterministic mappings, but will not autofill unless the OCR extractor returns those field keys. Updating the extractor schema is outside this task's approved G6 file list.
