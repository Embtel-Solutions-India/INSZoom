# Form mapping suggestions and duplicate editions

_Generated 2026-10-27 - read-only analysis; nothing was applied to the database._

Convention (docs/GENERIC_PARTY_CANONICAL_MODEL.md): `petitioner.*` = the sponsor (employer, or the person filing in a family case); `beneficiary.*` = the person the filing is for (employee / applicant). Every suggested path below was checked against the live path registry (known = a checklist or profile already fills it).

## 1. Duplicates - decide what to do with each (10)

These forms already have a LIVE edition; the row is the extra, non-live copy.

| Form | Non-live copy (status, mapping) | Live edition | Recommendation |
|---|---|---|---|
| G-28 | 2026-02-01 (review, mapping needs_review) | 2018-09-17 | NEWER edition than the live one - run the pipeline upgrade so open cases migrate to it. |
| G-845 | 2025-08-12-rev-6eab9c43f2e2 (review, mapping needs_review) | 2025-08-12 | Same edition date, different file (re-fetch) - compare, keep one, archive the other. |
| I-129 | 2025-01-20 (review, mapping unmapped) | 2026-09-09 | Older edition than the live one - archive it (nothing to do). |
| I-129F | 2025-01-20-rev-bd0fbda0a0de (review, mapping needs_review) | 2025-01-20 | Same edition date, different file (re-fetch) - compare, keep one, archive the other. |
| I-130 | 2026-02-01 (review, mapping needs_review) | 2024-04-01 | NEWER edition than the live one - run the pipeline upgrade so open cases migrate to it. |
| I-140 | 2026-09-18 (review, mapping needs_review) | 2024-07-06 | NEWER edition than the live one - run the pipeline upgrade so open cases migrate to it. |
| I-360 | 2026-02-01 (review, mapping needs_review) | 2026-09-22 | Older edition than the live one - archive it (nothing to do). |
| I-485 | 2026-09-18-rev-b028a43ca191 (review, mapping biographic_active) | 2026-09-18 | Same edition date, different file (re-fetch) - compare, keep one, archive the other. |
| I-485 | 2026-09-18-rev-0386cecd10fb (review, mapping needs_review) | 2026-09-18 | Same edition date, different file (re-fetch) - compare, keep one, archive the other. |
| I-864 | 2026-08-24 (review, mapping needs_review) | 2026-09-22 | Older edition than the live one - archive it (nothing to do). |

## 2. Ready mapping, only waiting for release (8)

Mapping is already active; each needs only approval + activation (the pipeline does it when certification passes).

- **G-1041** 2024-04-01 (review)
- **G-1041A** 2024-04-01 (review)
- **G-1256** 2015-08-10 (review)
- **G-1566** 2024-04-01 (review)
- **G-28I** 2018-05-23 (review)
- **G-325R** 2026-10-15 (review)
- **G-325R** 2026-09-04 (review)
- **G-639** 2024-12-12 (review)

## 3. Suggested mapping for forms with no usable mapping (62)

"Auto" = what the pipeline's own inference already applies the next time the form runs through it. "Suggested" = extra rules I propose, ready to add to `partyFieldRules.js`.

### AR-11 2022-11-02 (review, mapping biographic_active) - 31 boxes
Registry: not linked to any visa type

| Path | Box name(s) | Page(s) | Source | Registry |
|---|---|---|---|---|
| `beneficiary.middleName` | S1_MiddleName | - | auto (identity block) | known |
| `beneficiary.firstName` | S1_GivenName | - | auto (identity block) | known |
| `beneficiary.lastName` | S1_FamilyName | - | auto (identity block) | known |
| `beneficiary.dateOfBirth` | S1_DateOfBirth | - | auto (identity block) | known |
| `beneficiary.alienRegistrationNumber` | AlienNumber | - | auto (identity block) | known |

### AR-11 2026-02-01 (review, mapping needs_review) - 25 boxes
Registry: not linked to any visa type

_No identity boxes recognisable by name - needs a person to read the form (18 text boxes)._

### EOIR-29 2026-02-01 (review, mapping needs_review) - 25 boxes
Registry: not linked to any visa type

_No identity boxes recognisable by name - needs a person to read the form (18 text boxes)._

### G-1055 2026-10-07 (draft, mapping biographic_active) - 66 boxes
Registry: not linked to any visa type

_No identity boxes recognisable by name - needs a person to read the form (60 text boxes)._

### G-1055 2026-09-09 (review, mapping needs_review) - 64 boxes
Registry: not linked to any visa type

_No identity boxes recognisable by name - needs a person to read the form (58 text boxes)._

### G-1055 2026-10-16 (review, mapping biographic_active) - 66 boxes
Registry: not linked to any visa type

_No identity boxes recognisable by name - needs a person to read the form (60 text boxes)._

### G-1450 2026-02-06 (review, mapping biographic_active) - 29 boxes
Registry: not linked to any visa type

| Path | Box name(s) | Page(s) | Source | Registry |
|---|---|---|---|---|
| `beneficiary.lastName` | FamilyName | - | auto (identity block) | known |
| `beneficiary.firstName` | GivenName | - | auto (identity block) | known |
| `beneficiary.middleName` | MiddleName | - | auto (identity block) | known |
| `beneficiary.primaryPhone` | DaytimeTelephoneNumber | - | auto (identity block) | known |
| `beneficiary.email` | Email | - | auto (identity block) | known |

### G-1651 2025-06-03 (review, mapping biographic_active) - 3 boxes
Registry: not linked to any visa type

_No identity boxes recognisable by name - needs a person to read the form (2 text boxes)._

### G-845SUPPLEMENT 2025-08-12 (review, mapping needs_review) - 152 boxes
Registry: not linked to any visa type

| Path | Box name(s) | Page(s) | Source | Registry |
|---|---|---|---|---|
| `beneficiary.lastName` | P1_Line5_LastName | - | auto (identity block) | known |
| `beneficiary.middleName` | P1_Line5_MiddleName | - | auto (identity block) | known |
| `beneficiary.firstName` | P1_Line5_FirstName | - | auto (identity block) | known |
| `beneficiary.alienRegistrationNumber` | P1_Line1_AlienRegistrationNumber | - | auto (identity block) | known |
| `beneficiary.dateOfBirth` | P1_Line7_DateOfBirth | - | auto (identity block) | known |
| `beneficiary.ssn` | P1_Line6_SSN | - | auto (identity block) | known |
| `beneficiary.primaryPhone` | P1_Line11a_DaytimeTelephone | - | auto (identity block) | known |

### I-129CW 2025-01-20 (review, mapping needs_review) - 354 boxes
Registry: not linked to any visa type

| Path | Box name(s) | Page(s) | Source | Registry |
|---|---|---|---|---|
| `beneficiary.lastName` | Pt1Line1a_FamilyName | - | auto (identity block) | known |
| `beneficiary.firstName` | Pt1Line1b_GivenName | - | auto (identity block) | known |
| `beneficiary.middleName` | Pt1Line1c_MiddleName | - | auto (identity block) | known |
| `beneficiary.dateOfBirth` | Pt1Line2_DateOfBirth | - | auto (identity block) | known |
| `beneficiary.primaryPhone` | Pt1Line6a_DaytimeTelephone | - | auto (identity block) | known |
| `beneficiary.mobilePhone` | Pt1Line6b_MobilePhoneNumber | - | auto (identity block) | known |
| `beneficiary.email` | Pt1Line6c_Email | - | auto (identity block) | known |
| `beneficiary.ssn` | Pt1Line7c_SSN | - | auto (identity block) | known |

### I-129CWR 2025-01-20 (review, mapping needs_review) - 187 boxes
Registry: not linked to any visa type

| Path | Box name(s) | Page(s) | Source | Registry |
|---|---|---|---|---|
| `beneficiary.lastName` | Pt1Line1a_FamilyName | - | auto (identity block) | known |
| `beneficiary.firstName` | Pt1Line1b_GivenName | - | auto (identity block) | known |
| `beneficiary.middleName` | Pt1Line1c_MiddleName | - | auto (identity block) | known |
| `beneficiary.dateOfBirth` | Pt1Line2_DateOfBirth | - | auto (identity block) | known |
| `beneficiary.email` | Pt1Line8_Email | - | auto (identity block) | known |
| `beneficiary.mobilePhone` | Pt1Line7_MobilePhoneNumber | - | auto (identity block) | known |
| `beneficiary.uscisOnlineAccountNumber` | Pt1Line12_USCISOnlineAcctNumber | - | auto (identity block) | known |
| `beneficiary.ssn` | Pt1Line11_SSN | - | auto (identity block) | known |
| `petitioner.firstName` | Pt6Line4_PetitionerFirstName | 3 | suggested (explicit party word in the box name) | known |
| `petitioner.lastName` | Pt6Line3_PetitionerFamilyName | 3 | suggested (explicit party word in the box name) | known |

### I-130A 2026-09-23 (review, mapping biographic_active) - 194 boxes
Registry: 13 visa type(s), structure family

| Path | Box name(s) | Page(s) | Source | Registry |
|---|---|---|---|---|
| `beneficiary.alienRegistrationNumber` | Pt1Line1_AlienNumber | - | auto (identity block) | known |
| `beneficiary.lastName` | Pt1Line3a_FamilyName | - | auto (identity block) | known |
| `beneficiary.firstName` | Pt1Line3b_GivenName | - | auto (identity block) | known |
| `beneficiary.middleName` | Pt1Line3c_MiddleName | - | auto (identity block) | known |
| `beneficiary.countryOfBirth` | Pt1Line13_CountryofBirth | - | auto (identity block) | known |
| `beneficiary.dateOfBirth` | Pt1Line11_DateofBirth | - | auto (identity block) | known |

### I-193 2024-03-01 (review, mapping biographic_active) - 34 boxes
Registry: not linked to any visa type

_No identity boxes recognisable by name - needs a person to read the form (26 text boxes)._

### I-212 2025-01-20 (draft, mapping biographic_active) - 298 boxes
Registry: not linked to any visa type

_No identity boxes recognisable by name - needs a person to read the form (215 text boxes)._

### I-290B 2024-05-31 (review, mapping needs_review) - 85 boxes
Registry: not linked to any visa type

| Path | Box name(s) | Page(s) | Source | Registry |
|---|---|---|---|---|
| `beneficiary.lastName` | Pt1_Line1a_FamilyName | - | auto (identity block) | known |
| `beneficiary.firstName` | Pt1_Line1b_GivenName | - | auto (identity block) | known |
| `beneficiary.middleName` | Pt1_Line1c_MiddleName | - | auto (identity block) | known |
| `beneficiary.alienRegistrationNumber` | Pt1_Line6_AlienNumber | - | auto (identity block) | known |
| `beneficiary.dateOfBirth` | P1_Line2_DateofBirth | - | auto (identity block) | known |

### I-356 2026-09-18 (review, mapping needs_review) - 225 boxes
Registry: not linked to any visa type

| Path | Box name(s) | Page(s) | Source | Registry |
|---|---|---|---|---|
| `beneficiary.ssn` | Pt1Line3_SSN | - | auto (identity block) | known |
| `beneficiary.dateOfBirth` | Pt1Line22_DateofBirth | - | auto (identity block) | known |
| `beneficiary.lastName` | Pt1Line1_FamilyName | - | auto (identity block) | known |
| `beneficiary.firstName` | Pt1Line1_GivenName | - | auto (identity block) | known |
| `beneficiary.middleName` | Pt1Line1_MiddleName | - | auto (identity block) | known |

### I-361 2025-01-20 (review, mapping needs_review) - 267 boxes
Registry: not linked to any visa type

| Path | Box name(s) | Page(s) | Source | Registry |
|---|---|---|---|---|
| `beneficiary.lastName` | P1_Line1a_FamilyName | - | auto (identity block) | known |
| `beneficiary.firstName` | P1_Line1b_GivenName | - | auto (identity block) | known |
| `beneficiary.middleName` | P1_Line1c_MiddleName | - | auto (identity block) | known |
| `beneficiary.dateOfBirth` | P1_Line2_DateofBirth | - | auto (identity block) | known |
| `beneficiary.ssn` | P1_Line5_SSN | - | auto (identity block) | known |
| `beneficiary.alienRegistrationNumber` | P1_Line4_AlienNumber | - | auto (identity block) | known |
| `beneficiary.countryOfBirth` | P1_Line3b_CountryofBirth | - | auto (identity block) | known |

### I-363 2024-04-01 (review, mapping needs_review) - 198 boxes
Registry: not linked to any visa type

| Path | Box name(s) | Page(s) | Source | Registry |
|---|---|---|---|---|
| `beneficiary.ssn` | P1_Line5_SSN | - | auto (identity block) | known |
| `beneficiary.lastName` | P1_Line1a_FamilyName | - | auto (identity block) | known |
| `beneficiary.firstName` | P1_Line1b_GivenName | - | auto (identity block) | known |
| `beneficiary.middleName` | P1_Line1c_MiddleName | - | auto (identity block) | known |
| `beneficiary.alienRegistrationNumber` | P1_Line4_AlienNumber | - | auto (identity block) | known |
| `beneficiary.dateOfBirth` | P1_Line2_DateofBirth | - | auto (identity block) | known |

### I-407 2024-09-25 (review, mapping needs_review) - 67 boxes
Registry: not linked to any visa type

| Path | Box name(s) | Page(s) | Source | Registry |
|---|---|---|---|---|
| `beneficiary.alienRegistrationNumber` | P1_Line1_AlienNumber | - | auto (identity block) | known |
| `beneficiary.uscisOnlineAccountNumber` | P1_Line2_USCISOnlineAccountNumber | - | auto (identity block) | known |
| `beneficiary.lastName` | P1_Line4_FamilyName | - | auto (identity block) | known |
| `beneficiary.firstName` | P1_Line4_GivenName | - | auto (identity block) | known |
| `beneficiary.middleName` | P1_Line4_MiddleName | - | auto (identity block) | known |
| `beneficiary.dateOfBirth` | P1_Line5_DateOfBirth | - | auto (identity block) | known |
| `beneficiary.countryOfBirth` | P1_Line6_CountryofBirth | - | auto (identity block) | known |
| `beneficiary.countryOfCitizenship` | P1_Line7_CountryofCitizenship | - | auto (identity block) | known |
| `beneficiary.email` | Part1_Line10_Email | - | auto (identity block) | known |

### I-485 SUPPLEMENT A 2026-09-18 (review, mapping needs_review) - 64 boxes
Registry: not linked to any visa type

| Path | Box name(s) | Page(s) | Source | Registry |
|---|---|---|---|---|
| `beneficiary.lastName` | Part1_Line1_FamilyName | - | auto (identity block) | known |
| `beneficiary.firstName` | Part1_Line1_GivenName | - | auto (identity block) | known |
| `beneficiary.middleName` | Part1_Line1_MiddleName | - | auto (identity block) | known |
| `beneficiary.dateOfBirth` | Part1_Line5_DateOfBirth | - | auto (identity block) | known |
| `beneficiary.countryOfBirth` | Part1_Line6_CountryofBirth | - | auto (identity block) | known |
| `beneficiary.countryOfCitizenship` | Part1_Line7_CountryofCitizenship | - | auto (identity block) | known |
| `beneficiary.alienRegistrationNumber` | Part1_Line3_AlienNumber | - | auto (identity block) | known |

### I-485 SUPPLEMENT J 2026-09-18 (review, mapping needs_review) - 139 boxes
Registry: not linked to any visa type

| Path | Box name(s) | Page(s) | Source | Registry |
|---|---|---|---|---|
| `beneficiary.lastName` | Pt2Line1_FamilyName | - | auto (identity block) | known |
| `beneficiary.firstName` | Pt2Line1_GivenName | - | auto (identity block) | known |
| `beneficiary.middleName` | Pt2Line1_MiddleName | - | auto (identity block) | known |
| `beneficiary.alienRegistrationNumber` | Part2_Line3_AlienNumber | - | auto (identity block) | known |
| `beneficiary.dateOfBirth` | Part2_Line5_DateOfBirth | - | auto (identity block) | known |
| `beneficiary.countryOfBirth` | Part2_Line6_CountryofBirth | - | auto (identity block) | known |

### I-485A 2026-10-07 (review, mapping biographic_active) - 730 boxes
Registry: 27 visa type(s), structure single/employer_employee/family

| Path | Box name(s) | Page(s) | Source | Registry |
|---|---|---|---|---|
| `beneficiary.alienRegistrationNumber` | Pt1Line4_AlienNumber | - | auto (identity block) | known |
| `beneficiary.lastName` | Pt1Line1_FamilyName | - | auto (identity block) | known |
| `beneficiary.firstName` | Pt1Line1_GivenName | - | auto (identity block) | known |
| `beneficiary.middleName` | Pt1Line1_MiddleName | - | auto (identity block) | known |
| `beneficiary.dateOfBirth` | Pt1Line2_DOB | - | auto (identity block) | known |
| `beneficiary.countryOfBirth` | Pt1Line7_CountryOfBirth | - | auto (identity block) | known |
| `beneficiary.ssn` | Pt1Line19_SSN | - | auto (identity block) | known |

### I-508 2026-09-18 (review, mapping needs_review) - 139 boxes
Registry: not linked to any visa type

| Path | Box name(s) | Page(s) | Source | Registry |
|---|---|---|---|---|
| `beneficiary.lastName` | Pt2Line1_FamilyName | - | auto (identity block) | known |
| `beneficiary.firstName` | Pt2Line1_GivenName | - | auto (identity block) | known |
| `beneficiary.middleName` | Pt2Line1_MiddleName | - | auto (identity block) | known |
| `beneficiary.alienRegistrationNumber` | Part2_Line3_AlienNumber | - | auto (identity block) | known |
| `beneficiary.dateOfBirth` | Part2_Line5_DateOfBirth | - | auto (identity block) | known |
| `beneficiary.countryOfBirth` | Part2_Line6_CountryofBirth | - | auto (identity block) | known |

### I-508 2024-04-16 (review, mapping needs_review) - 91 boxes
Registry: not linked to any visa type

| Path | Box name(s) | Page(s) | Source | Registry |
|---|---|---|---|---|
| `beneficiary.dateOfBirth` | P1_Line4_DateOfBirth | - | auto (identity block) | known |
| `beneficiary.lastName` | P1_Line1_FamilyName | - | auto (identity block) | known |
| `beneficiary.firstName` | P1_Line1_GivenName | - | auto (identity block) | known |
| `beneficiary.middleName` | P1_Line1_MiddleName | - | auto (identity block) | known |
| `beneficiary.ssn` | P1_Line3_SSN | - | auto (identity block) | known |
| `beneficiary.alienRegistrationNumber` | P1_Line1_AlienNumber | - | auto (identity block) | known |

### I-566 2025-01-20 (review, mapping needs_review) - 204 boxes
Registry: not linked to any visa type

| Path | Box name(s) | Page(s) | Source | Registry |
|---|---|---|---|---|
| `beneficiary.alienRegistrationNumber` | Pt1Line10_AlienNumber | - | auto (identity block) | known |
| `beneficiary.ssn` | Pt1Line10_SSN | - | auto (identity block) | known |
| `beneficiary.dateOfBirth` | Pt1Line4_DateOfBirth | - | auto (identity block) | known |
| `beneficiary.countryOfBirth` | Pt1Line5_CountryOfBirth | - | auto (identity block) | known |
| `beneficiary.firstName` | Pt1Line1b_GivenName | - | auto (identity block) | known |
| `beneficiary.lastName` | Pt1Line1a_FamilyName | - | auto (identity block) | known |
| `beneficiary.middleName` | Pt1Line1c_MiddleName | - | auto (identity block) | known |

### I-600 2025-01-20 (review, mapping needs_review) - 436 boxes
Registry: not linked to any visa type

| Path | Box name(s) | Page(s) | Source | Registry |
|---|---|---|---|---|
| `beneficiary.lastName` | Pt1Line1_FamilyName | - | auto (identity block) | known |
| `beneficiary.middleName` | Pt1Line1_MiddleName | - | auto (identity block) | known |
| `beneficiary.firstName` | Pt1Line1_GivenName | - | auto (identity block) | known |
| `beneficiary.dateOfBirth` | Pt1Line31Row1_DateofBirth, Pt1Line31Row2_DateofBirth, Pt1Line31Row3_DateofBirth, Pt1Line31Row4_DateofBirth, Pt1Line31Row5_DateofBirth | - | auto (identity block) | known |
| `beneficiary.countryOfBirth` | Pt1Line31Row1_CountryofBirth, Pt1Line31Row2_CountryofBirth, Pt1Line31Row3_CountryofBirth, Pt1Line31Row4_CountryofBirth, Pt1Line31Row5_CountryofBirth | - | auto (identity block) | known |
| `beneficiary.alienRegistrationNumber` | Pt1Line31Row1_ANumber, Pt1Line31Row2_ANumber, Pt1Line31Row3_ANumber, Pt1Line31Row4_ANumber, Pt1Line31Row5_ANumber | - | auto (identity block) | known |

### I-600A 2025-01-20 (review, mapping needs_review) - 308 boxes
Registry: not linked to any visa type

| Path | Box name(s) | Page(s) | Source | Registry |
|---|---|---|---|---|
| `beneficiary.lastName` | Pt1Line1_FamilyName | - | auto (identity block) | known |
| `beneficiary.firstName` | Pt1Line1_GivenName | - | auto (identity block) | known |
| `beneficiary.middleName` | Pt1Line1_MiddleName | - | auto (identity block) | known |
| `beneficiary.countryOfBirth` | Pt1Line14_CountryOfBirth | - | auto (identity block) | known |
| `beneficiary.dateOfBirth` | Pt1Line11_DateOfBirth | - | auto (identity block) | known |
| `beneficiary.alienRegistrationNumber` | Pt1Line15A_AlienNumber | - | auto (identity block) | known |

### I-601 2025-01-20 (review, mapping needs_review) - 280 boxes
Registry: not linked to any visa type

_No identity boxes recognisable by name - needs a person to read the form (165 text boxes)._

### I-601A 2025-01-20 (review, mapping needs_review) - 257 boxes
Registry: not linked to any visa type

| Path | Box name(s) | Page(s) | Source | Registry |
|---|---|---|---|---|
| `beneficiary.ssn` | Pt1Line2_SSN | - | auto (identity block) | known |
| `beneficiary.alienRegistrationNumber` | Pt1Line1_AlienNumber | - | auto (identity block) | known |
| `beneficiary.lastName` | Pt1Line4a_FamilyName | - | auto (identity block) | known |
| `beneficiary.firstName` | Pt1Line4b_GivenName | - | auto (identity block) | known |
| `beneficiary.middleName` | Pt1Line4c_MiddleName | - | auto (identity block) | known |
| `beneficiary.dateOfBirth` | Pt1Line11_DateOfBirth | - | auto (identity block) | known |
| `beneficiary.countryOfBirth` | Pt1Line13_CountryOfBirth | - | auto (identity block) | known |
| `beneficiary.countryOfCitizenship` | Pt1Line14_CountryOfCitizenship | - | auto (identity block) | known |

### I-602 2025-01-20 (review, mapping needs_review) - 206 boxes
Registry: not linked to any visa type

| Path | Box name(s) | Page(s) | Source | Registry |
|---|---|---|---|---|
| `beneficiary.middleName` | Pt1Line1_MiddleName | - | auto (identity block) | known |
| `beneficiary.firstName` | Pt1Line1_GivenName | - | auto (identity block) | known |
| `beneficiary.lastName` | Pt1Line1_FamilyName | - | auto (identity block) | known |
| `beneficiary.countryOfBirth` | Pt1Line2_CountryOfBirth | - | auto (identity block) | known |
| `beneficiary.alienRegistrationNumber` | Pt1Line6_AlienNumber | - | auto (identity block) | known |
| `beneficiary.uscisOnlineAccountNumber` | Pt1Line2_USCISOnlineAcctNumber | - | auto (identity block) | known |

### I-690 2024-04-01 (review, mapping needs_review) - 189 boxes
Registry: not linked to any visa type

| Path | Box name(s) | Page(s) | Source | Registry |
|---|---|---|---|---|
| `beneficiary.middleName` | Pt1Line1_MiddleName | - | auto (identity block) | known |
| `beneficiary.firstName` | Pt1Line1_GivenName | - | auto (identity block) | known |
| `beneficiary.lastName` | Pt1Line1_FamilyName | - | auto (identity block) | known |
| `beneficiary.ssn` | Pt1Line10_SSN | - | auto (identity block) | known |
| `beneficiary.dateOfBirth` | Pt1Line6B_DateOfBirth | - | auto (identity block) | known |
| `beneficiary.alienRegistrationNumber` | Pt1Line8_AlienNumber | - | auto (identity block) | known |
| `beneficiary.countryOfBirth` | Pt1Line6_CountryOfBirth | - | auto (identity block) | known |
| `beneficiary.uscisOnlineAccountNumber` | Pt1Line9_USCISOnlineAcctNumber | - | auto (identity block) | known |
| `beneficiary.primaryPhone` | Pt3Line1_ApplicantDaytimeTelephoneNumber3 | 4 | suggested (explicit party word in the box name) | known |
| `beneficiary.mobilePhone` | Pt3Line2_ApplicantMobileTelephoneNumber3 | 4 | suggested (explicit party word in the box name) | known |

### I-694 2024-04-01 (review, mapping needs_review) - 119 boxes
Registry: not linked to any visa type

| Path | Box name(s) | Page(s) | Source | Registry |
|---|---|---|---|---|
| `beneficiary.middleName` | P1_L1_MiddleName | - | auto (identity block) | known |
| `beneficiary.firstName` | P1_L1_GivenName | - | auto (identity block) | known |
| `beneficiary.lastName` | P1_1_FamilyName | - | auto (identity block) | known |

### I-698 2025-01-20 (review, mapping needs_review) - 248 boxes
Registry: not linked to any visa type

| Path | Box name(s) | Page(s) | Source | Registry |
|---|---|---|---|---|
| `beneficiary.middleName` | Pt1Line1_MiddleName | - | auto (identity block) | known |
| `beneficiary.firstName` | Pt1Line1_GivenName | - | auto (identity block) | known |
| `beneficiary.lastName` | Pt1Line1_FamilyName | - | auto (identity block) | known |
| `beneficiary.ssn` | P1_8_SSN | - | auto (identity block) | known |
| `beneficiary.alienRegistrationNumber` | Pt1Line8_AlienNumber | - | auto (identity block) | known |
| `beneficiary.dateOfBirth` | P1_9_DateOfBirth | - | auto (identity block) | known |
| `beneficiary.countryOfCitizenship` | P1_L13_CountryOfNationality | - | auto (identity block) | known |

### I-765V 2025-01-20 (review, mapping needs_review) - 232 boxes
Registry: not linked to any visa type

| Path | Box name(s) | Page(s) | Source | Registry |
|---|---|---|---|---|
| `beneficiary.lastName` | Part1_Item5a_FamilyName | - | auto (identity block) | known |
| `beneficiary.firstName` | Part1_Item5b_GivenName | - | auto (identity block) | known |
| `beneficiary.middleName` | Part1_Item5c_MiddleName | - | auto (identity block) | known |
| `beneficiary.alienRegistrationNumber` | Part1_Item2_ANumber | - | auto (identity block) | known |
| `beneficiary.ssn` | Part1_Item4_SSN | - | auto (identity block) | known |
| `beneficiary.dateOfBirth` | Part1_Item11_DateOfBirth | - | auto (identity block) | known |

### I-800 2025-01-20 (review, mapping needs_review) - 331 boxes
Registry: not linked to any visa type

_No identity boxes recognisable by name - needs a person to read the form (208 text boxes)._

### I-800A 2025-01-20 (review, mapping needs_review) - 290 boxes
Registry: not linked to any visa type

_No identity boxes recognisable by name - needs a person to read the form (183 text boxes)._

### I-817 2024-04-01 (review, mapping needs_review) - 453 boxes
Registry: not linked to any visa type

| Path | Box name(s) | Page(s) | Source | Registry |
|---|---|---|---|---|
| `beneficiary.alienRegistrationNumber` | Part1_Line1_AlienNumber | - | auto (identity block) | known |
| `beneficiary.lastName` | Part1_Line2a_FamilyName | - | auto (identity block) | known |
| `beneficiary.firstName` | Part1_Line2b_GivenName | - | auto (identity block) | known |
| `beneficiary.middleName` | Part1_Line2c_MiddleName | - | auto (identity block) | known |
| `beneficiary.dateOfBirth` | Part1_Line5_DateofBirth | - | auto (identity block) | known |
| `beneficiary.ssn` | Part1_Line6_SSN | - | auto (identity block) | known |
| `beneficiary.uscisOnlineAccountNumber` | Part1_Line7_USCISOnlineAcctNumber | - | auto (identity block) | known |
| `beneficiary.countryOfBirth` | Part1_Line9_CountryofBirth | - | auto (identity block) | known |
| `beneficiary.countryOfCitizenship` | Part1_Line10_CountryofCitizenship | - | auto (identity block) | known |

### I-821 2025-01-20 (review, mapping needs_review) - 478 boxes
Registry: not linked to any visa type

| Path | Box name(s) | Page(s) | Source | Registry |
|---|---|---|---|---|
| `beneficiary.lastName` | Part2_Item1_FamilyName | - | auto (identity block) | known |
| `beneficiary.firstName` | Part2_Item1_GivenName | - | auto (identity block) | known |
| `beneficiary.middleName` | Part2_Item1_MiddleName | - | auto (identity block) | known |
| `beneficiary.dateOfBirth` | P2_Line7_DateOfBirth | - | auto (identity block) | known |
| `beneficiary.countryOfBirth` | Part2_Item14_CountryofBirth | - | auto (identity block) | known |
| `beneficiary.alienRegistrationNumber` | Part2_Item7_AlienNumber | - | auto (identity block) | known |
| `beneficiary.ssn` | Part2_Item9_SocialSecurityNumber | - | auto (identity block) | known |

### I-821D 2025-01-20 (review, mapping needs_review) - 234 boxes
Registry: not linked to any visa type

_No identity boxes recognisable by name - needs a person to read the form (135 text boxes)._

### I-854 2025-01-20 (review, mapping needs_review) - 237 boxes
Registry: not linked to any visa type

| Path | Box name(s) | Page(s) | Source | Registry |
|---|---|---|---|---|
| `beneficiary.email` | P1_Line4_EmailAddress | - | auto (identity block) | known |
| `beneficiary.primaryPhone` | P1_Line4_DaytimeTelephoneNumber | - | auto (identity block) | known |
| `beneficiary.lastName` | P1_L7a_FamilyName | - | auto (identity block) | known |
| `beneficiary.middleName` | P1_L7a_MiddleName | - | auto (identity block) | known |
| `beneficiary.firstName` | P1_L7a_GivenName | - | auto (identity block) | known |
| `beneficiary.dateOfBirth` | P1_L7d_DateofBirth | - | auto (identity block) | known |
| `beneficiary.countryOfCitizenship` | P1_L7d_CountryOfCitizenship | - | auto (identity block) | known |
| `beneficiary.alienRegistrationNumber` | P1_Line7d_AlienNumber | - | auto (identity block) | known |

### I-864A 2026-09-22 (review, mapping biographic_active) - 162 boxes
Registry: 12 visa type(s), structure family

| Path | Box name(s) | Page(s) | Source | Registry |
|---|---|---|---|---|
| `beneficiary.lastName` | P1_Line1a_FamilyName, Pt1Line1a_FamilyName | - | auto (identity block) | known |
| `beneficiary.firstName` | P1_Line1b_GivenName, Pt1Line1b_GivenName | - | auto (identity block) | known |
| `beneficiary.middleName` | P1_Line1c_MiddleName, Pt1Line1c_MiddleName | - | auto (identity block) | known |
| `beneficiary.dateOfBirth` | P1_Line5_DateOfBirth | - | auto (identity block) | known |
| `beneficiary.countryOfBirth` | P1_Line6_CountryofBirth | - | auto (identity block) | known |
| `beneficiary.ssn` | P1_Line7_SSN | - | auto (identity block) | known |
| `beneficiary.alienRegistrationNumber` | Pt1Line3e_AlienNumber | - | auto (identity block) | known |
| `beneficiary.uscisOnlineAccountNumber` | P1_Line9_USCISOnlineAcctNumber | - | auto (identity block) | known |

### I-865 2020-11-10 (review, mapping needs_review) - 128 boxes
Registry: not linked to any visa type

| Path | Box name(s) | Page(s) | Source | Registry |
|---|---|---|---|---|
| `beneficiary.lastName` | P1_Line1a_FamilyName | - | auto (identity block) | known |
| `beneficiary.firstName` | P1_Line1b_GivenName | - | auto (identity block) | known |
| `beneficiary.middleName` | P1_Line1c_MiddleName | - | auto (identity block) | known |
| `beneficiary.dateOfBirth` | P1_Line2_DateOfBirth | - | auto (identity block) | known |

### I-881 2025-01-20 (review, mapping needs_review) - 494 boxes
Registry: not linked to any visa type

| Path | Box name(s) | Page(s) | Source | Registry |
|---|---|---|---|---|
| `beneficiary.lastName` | Pt1_Line1a_FamilyName | - | auto (identity block) | known |
| `beneficiary.firstName` | Pt1_Line1b_GivenName | - | auto (identity block) | known |
| `beneficiary.middleName` | Pt1_Line1c_MiddleName | - | auto (identity block) | known |
| `beneficiary.dateOfBirth` | P1_Line5_DateofBirth | - | auto (identity block) | known |
| `beneficiary.countryOfBirth` | P1_Line8_CountryofBirth | - | auto (identity block) | known |
| `beneficiary.alienRegistrationNumber` | P1_Line10_AlienNumber | - | auto (identity block) | known |
| `beneficiary.ssn` | P1_Line12_SSN | - | auto (identity block) | known |

### I-905 2024-04-01 (review, mapping needs_review) - 73 boxes
Registry: not linked to any visa type

| Path | Box name(s) | Page(s) | Source | Registry |
|---|---|---|---|---|
| `beneficiary.lastName` | P1_L4a_FamilyName | - | auto (identity block) | known |
| `beneficiary.firstName` | P1_L4b_GivenName | - | auto (identity block) | known |
| `beneficiary.middleName` | P1_L4c_MiddleName | - | auto (identity block) | known |

### I-912 2025-07-22 (review, mapping needs_review) - 221 boxes
Registry: not linked to any visa type

| Path | Box name(s) | Page(s) | Source | Registry |
|---|---|---|---|---|
| `beneficiary.middleName` | P2_L2_MiddleName | - | auto (identity block) | known |
| `beneficiary.firstName` | P2_L2_GivenName | - | auto (identity block) | known |
| `beneficiary.lastName` | P2_L2_FamilyName | - | auto (identity block) | known |
| `beneficiary.alienRegistrationNumber` | P2_Line3_AlienNumber | - | auto (identity block) | known |
| `beneficiary.dateOfBirth` | P2_5_DateOfBirth | - | auto (identity block) | known |
| `beneficiary.ssn` | P2_Line6_SSN | - | auto (identity block) | known |

### I-914 2025-01-20 (review, mapping needs_review) - 334 boxes
Registry: not linked to any visa type

| Path | Box name(s) | Page(s) | Source | Registry |
|---|---|---|---|---|
| `beneficiary.middleName` | Part2_MiddleName | - | auto (identity block) | known |
| `beneficiary.firstName` | Part2_GivenName | - | auto (identity block) | known |
| `beneficiary.lastName` | Part2_FamilyName | - | auto (identity block) | known |
| `beneficiary.alienRegistrationNumber` | Part2_Line5_AlienRegistrationNumber | - | auto (identity block) | known |

### I-914 2026-09-14 (review, mapping needs_review) - 334 boxes
Registry: not linked to any visa type

| Path | Box name(s) | Page(s) | Source | Registry |
|---|---|---|---|---|
| `beneficiary.middleName` | Part2_MiddleName | - | auto (identity block) | known |
| `beneficiary.firstName` | Part2_GivenName | - | auto (identity block) | known |
| `beneficiary.lastName` | Part2_FamilyName | - | auto (identity block) | known |
| `beneficiary.alienRegistrationNumber` | Part2_Line5_AlienRegistrationNumber | - | auto (identity block) | known |

### I-918 2026-09-22 (review, mapping needs_review) - 373 boxes
Registry: 3 visa type(s), structure single/family

| Path | Box name(s) | Page(s) | Source | Registry |
|---|---|---|---|---|
| `beneficiary.firstName` | Pt1Line1b_GivenName | - | auto (identity block) | known |
| `beneficiary.lastName` | Pt1Line1a_FamilyName | - | auto (identity block) | known |
| `beneficiary.middleName` | Pt1Line1c_MiddleName | - | auto (identity block) | known |
| `beneficiary.alienRegistrationNumber` | P1_Line5_AlienNumber | - | auto (identity block) | known |
| `beneficiary.ssn` | P1_Line6_SSN | - | auto (identity block) | known |
| `beneficiary.countryOfCitizenship` | P1_Line12_CountryOfCitizenship | - | auto (identity block) | known |
| `beneficiary.countryOfBirth` | P1_Line11_CountryOfBirth | - | auto (identity block) | known |
| `beneficiary.dateOfBirth` | P1_Line10_DateOfBirth | - | auto (identity block) | known |

### I-918 SUPPLEMENT A 2026-09-30 (review, mapping biographic_active) - 368 boxes
Registry: not linked to any visa type

| Path | Box name(s) | Page(s) | Source | Registry |
|---|---|---|---|---|
| `beneficiary.middleName` | Pt1Line1c_MiddleName | - | auto (identity block) | known |
| `beneficiary.firstName` | Pt1Line1b_GivenName | - | auto (identity block) | known |
| `beneficiary.lastName` | Pt1Line1a_FamilyName | - | auto (identity block) | known |
| `beneficiary.dateOfBirth` | P1_LinePart3_Line18_ExpDateforPassport10_DateOfBirth | - | auto (identity block) | known |

### I-918 SUPPLEMENT B 2026-09-30 (review, mapping biographic_active) - 138 boxes
Registry: not linked to any visa type

| Path | Box name(s) | Page(s) | Source | Registry |
|---|---|---|---|---|
| `beneficiary.alienRegistrationNumber` | Part1_Line1_AlienNumber | - | auto (identity block) | known |
| `beneficiary.middleName` | Pt1Line2a_MiddleName | - | auto (identity block) | known |
| `beneficiary.firstName` | Pt1Line2a_GivenName | - | auto (identity block) | known |
| `beneficiary.lastName` | Pt1Line2a_FamilyName | - | auto (identity block) | known |
| `beneficiary.dateOfBirth` | P1_Line4_DateOfBirth | - | auto (identity block) | known |

### I-918SUPA 2026-09-23 (draft, mapping biographic_active) - 368 boxes
Registry: not linked to any visa type

| Path | Box name(s) | Page(s) | Source | Registry |
|---|---|---|---|---|
| `beneficiary.middleName` | Pt1Line1c_MiddleName | - | auto (identity block) | known |
| `beneficiary.firstName` | Pt1Line1b_GivenName | - | auto (identity block) | known |
| `beneficiary.lastName` | Pt1Line1a_FamilyName | - | auto (identity block) | known |
| `beneficiary.dateOfBirth` | P1_LinePart3_Line18_ExpDateforPassport10_DateOfBirth | - | auto (identity block) | known |

### I-918SUPB 2026-09-23 (draft, mapping biographic_active) - 138 boxes
Registry: not linked to any visa type

| Path | Box name(s) | Page(s) | Source | Registry |
|---|---|---|---|---|
| `beneficiary.alienRegistrationNumber` | Part1_Line1_AlienNumber | - | auto (identity block) | known |
| `beneficiary.middleName` | Pt1Line2a_MiddleName | - | auto (identity block) | known |
| `beneficiary.firstName` | Pt1Line2a_GivenName | - | auto (identity block) | known |
| `beneficiary.lastName` | Pt1Line2a_FamilyName | - | auto (identity block) | known |
| `beneficiary.dateOfBirth` | P1_Line4_DateOfBirth | - | auto (identity block) | known |

### I-941 2025-01-20 (review, mapping needs_review) - 475 boxes
Registry: not linked to any visa type

| Path | Box name(s) | Page(s) | Source | Registry |
|---|---|---|---|---|
| `beneficiary.lastName` | P1_Line1_FamilyName | - | auto (identity block) | known |
| `beneficiary.firstName` | P1_Line1_GivenName | - | auto (identity block) | known |
| `beneficiary.middleName` | P1_Line1_MiddleName | - | auto (identity block) | known |
| `beneficiary.dateOfBirth` | P1_Line8_DateOfBirth | - | auto (identity block) | known |
| `beneficiary.countryOfBirth` | Pt1Line4_CountryOfBirth | - | auto (identity block) | known |
| `beneficiary.countryOfCitizenship` | Pt1Line5_CountryOfCitizenship | - | auto (identity block) | known |

### I-945 2026-09-18 (review, mapping needs_review) - 186 boxes
Registry: not linked to any visa type

| Path | Box name(s) | Page(s) | Source | Registry |
|---|---|---|---|---|
| `beneficiary.lastName` | FamilyName | - | auto (identity block) | known |
| `beneficiary.firstName` | GivenName | - | auto (identity block) | known |
| `beneficiary.middleName` | MiddleName | - | auto (identity block) | known |

### I-956F 2026-09-27 (review, mapping needs_review) - 318 boxes
Registry: 1 visa type(s), structure single

_No identity boxes recognisable by name - needs a person to read the form (221 text boxes)._

### I-956G 2024-04-01 (review, mapping needs_review) - 237 boxes
Registry: not linked to any visa type

_No identity boxes recognisable by name - needs a person to read the form (173 text boxes)._

### N-300 2024-04-01 (review, mapping needs_review) - 152 boxes
Registry: not linked to any visa type

| Path | Box name(s) | Page(s) | Source | Registry |
|---|---|---|---|---|
| `beneficiary.uscisOnlineAccountNumber` | Pt1Line4_USCISOnlineAcctNumber | - | auto (identity block) | known |
| `beneficiary.lastName` | Pt1Line1_FamilyName | - | auto (identity block) | known |
| `beneficiary.firstName` | Pt1Line1_GivenName | - | auto (identity block) | known |
| `beneficiary.middleName` | Pt1Line1_MiddleName | - | auto (identity block) | known |
| `beneficiary.countryOfBirth` | Pt1Line7_CountryOfBirth | - | auto (identity block) | known |
| `beneficiary.ssn` | Pt1Line3_SSN | - | auto (identity block) | known |
| `beneficiary.countryOfCitizenship` | Pt1Line8_CountryOfNationality | - | auto (identity block) | known |

### N-336 2024-04-01 (review, mapping needs_review) - 163 boxes
Registry: not linked to any visa type

| Path | Box name(s) | Page(s) | Source | Registry |
|---|---|---|---|---|
| `beneficiary.middleName` | Pt1Line1_MiddleName | - | auto (identity block) | known |
| `beneficiary.firstName` | Pt1Line1_GivenName | - | auto (identity block) | known |
| `beneficiary.lastName` | Pt1Line1_FamilyName | - | auto (identity block) | known |

### N-426 2026-03-13 (review, mapping needs_review) - 31 boxes
Registry: not linked to any visa type

| Path | Box name(s) | Page(s) | Source | Registry |
|---|---|---|---|---|
| `beneficiary.alienRegistrationNumber` | Pt1Line1_AlienNumber | - | auto (identity block) | known |
| `beneficiary.uscisOnlineAccountNumber` | P1_Line5_USCISOnlineAcctNumber | - | auto (identity block) | known |
| `beneficiary.dateOfBirth` | P1_Line6_DateOfBirth | - | auto (identity block) | known |
| `beneficiary.middleName` | Pt1Line3_MiddleName | - | auto (identity block) | known |
| `beneficiary.firstName` | Pt1Line3_GivenName | - | auto (identity block) | known |
| `beneficiary.lastName` | Pt1Line3_FamilyName | - | auto (identity block) | known |
| `beneficiary.ssn` | P1_Line4_SSN | - | auto (identity block) | known |

### N-470 2024-04-01 (review, mapping needs_review) - 184 boxes
Registry: not linked to any visa type

| Path | Box name(s) | Page(s) | Source | Registry |
|---|---|---|---|---|
| `beneficiary.alienRegistrationNumber` | Pt1Line8_AlienNumber | - | auto (identity block) | known |
| `beneficiary.middleName` | Pt1Line1_MiddleName | - | auto (identity block) | known |
| `beneficiary.firstName` | Pt1Line1_GivenName | - | auto (identity block) | known |
| `beneficiary.lastName` | Pt1Line1_FamilyName | - | auto (identity block) | known |
| `beneficiary.countryOfBirth` | Pt1Line6_CountryOfBirth | - | auto (identity block) | known |
| `beneficiary.countryOfCitizenship` | Pt1Line7_CountryOfCitizenship | - | auto (identity block) | known |
| `beneficiary.ssn` | Pt1Line10_SSN | - | auto (identity block) | known |

### N-600K 2025-01-20 (review, mapping needs_review) - 275 boxes
Registry: not linked to any visa type

| Path | Box name(s) | Page(s) | Source | Registry |
|---|---|---|---|---|
| `beneficiary.lastName` | Part2_Item1_FamilyName | - | auto (identity block) | known |
| `beneficiary.firstName` | Part2_Item1_GivenName | - | auto (identity block) | known |
| `beneficiary.middleName` | Part2_Item1_MiddleName | - | auto (identity block) | known |

### N-648 2024-09-25 (review, mapping needs_review) - 79 boxes
Registry: not linked to any visa type

| Path | Box name(s) | Page(s) | Source | Registry |
|---|---|---|---|---|
| `beneficiary.lastName` | Pt1Line1_FamilyName | - | auto (identity block) | known |
| `beneficiary.firstName` | Pt1Line1_GivenName | - | auto (identity block) | known |
| `beneficiary.middleName` | Pt1Line1_MiddleName | - | auto (identity block) | known |
| `beneficiary.alienRegistrationNumber` | Pt1Line3_AlienNumber | - | auto (identity block) | known |
| `beneficiary.dateOfBirth` | Pt1Line5_DateofBirth | - | auto (identity block) | known |


## Summary table

| Form | Auto rules | Suggested extra | Structure |
|---|---|---|---|
| AR-11 | 5 | 0 | - |
| AR-11 | 0 | 0 | - |
| EOIR-29 | 0 | 0 | - |
| G-1055 | 0 | 0 | - |
| G-1055 | 0 | 0 | - |
| G-1055 | 0 | 0 | - |
| G-1450 | 5 | 0 | - |
| G-1651 | 0 | 0 | - |
| G-845SUPPLEMENT | 7 | 0 | - |
| I-129CW | 8 | 0 | - |
| I-129CWR | 8 | 2 | - |
| I-130A | 6 | 0 | family |
| I-193 | 0 | 0 | - |
| I-212 | 0 | 0 | - |
| I-290B | 5 | 0 | - |
| I-356 | 5 | 0 | - |
| I-361 | 7 | 0 | - |
| I-363 | 6 | 0 | - |
| I-407 | 9 | 0 | - |
| I-485 SUPPLEMENT A | 7 | 0 | - |
| I-485 SUPPLEMENT J | 6 | 0 | - |
| I-485A | 7 | 0 | single/employer_employee/family |
| I-508 | 6 | 0 | - |
| I-508 | 6 | 0 | - |
| I-566 | 7 | 0 | - |
| I-600 | 6 | 0 | - |
| I-600A | 6 | 0 | - |
| I-601 | 0 | 0 | - |
| I-601A | 8 | 0 | - |
| I-602 | 6 | 0 | - |
| I-690 | 8 | 2 | - |
| I-694 | 3 | 0 | - |
| I-698 | 7 | 0 | - |
| I-765V | 6 | 0 | - |
| I-800 | 0 | 0 | - |
| I-800A | 0 | 0 | - |
| I-817 | 9 | 0 | - |
| I-821 | 7 | 0 | - |
| I-821D | 0 | 0 | - |
| I-854 | 8 | 0 | - |
| I-864A | 8 | 0 | family |
| I-865 | 4 | 0 | - |
| I-881 | 7 | 0 | - |
| I-905 | 3 | 0 | - |
| I-912 | 6 | 0 | - |
| I-914 | 4 | 0 | - |
| I-914 | 4 | 0 | - |
| I-918 | 8 | 0 | single/family |
| I-918 SUPPLEMENT A | 4 | 0 | - |
| I-918 SUPPLEMENT B | 5 | 0 | - |
| I-918SUPA | 4 | 0 | - |
| I-918SUPB | 5 | 0 | - |
| I-941 | 6 | 0 | - |
| I-945 | 3 | 0 | - |
| I-956F | 0 | 0 | single |
| I-956G | 0 | 0 | - |
| N-300 | 7 | 0 | - |
| N-336 | 3 | 0 | - |
| N-426 | 7 | 0 | - |
| N-470 | 7 | 0 | - |
| N-600K | 3 | 0 | - |
| N-648 | 5 | 0 | - |
