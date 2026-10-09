# F-1 Reinstatement - canonical field mapping

Chain: **checklist question key -> canonical path -> I-539 PDF field** (Form I-539, edition 08/28/24, active template; active mapping version 10).

- Canonical paths are the **existing** ones (`profileCanonicalMap.js`): `person.*`, `contact.*`, `immigration.*`. No parallel `person.aNumber` / `person.mailingAddress.*` style paths were created.
- PDF field names and labels were read from the imported I-539 template (`formFields`), and the page text of `dev-assets/uscis/i-539_2024-08-28.pdf`; no field name was guessed.
- "raw" = the answer is read straight from the saved questionnaire answer (`raw.questionnaireAnswers.<key>.value`) because no canonical path exists for it.
- "Not on I-539" = the form has no matching field; the answer stays a questionnaire answer (and a document/letter input).

## Questions that fill the I-539

| Checklist question | Key | Canonical source | I-539 field |
|---|---|---|---|
| Family Name (Last Name) | `client_familyName` | `person.lastName` | `P1Line1a_FamilyName[0]`, `P1Line1a_FamilyName[1]` |
| Given Name (First Name) | `client_givenName` | `person.firstName` | `P1_Line1b_GivenName[0]`, `P1_Line1b_GivenName[1]` |
| Middle Name | `client_middleName` | `person.middleName` | `P1_Line1c_MiddleName[0]`, `P1_Line1c_MiddleName[1]` |
| Alien Registration Number (A-Number) if any | `client_aNumber` | `person.alienNumber` | `Pt1Line2_AlienNumber[0]`, `Pt1Line2_AlienNumber[1]` |
| USCIS Online Account Number (if any) | `client_uscisOnlineAccountNumber` | raw | `Pt1Line2_USCISOnlineAcctNumber[0]` |
| US Mailing Address | `client_usMailingAddress` | `contact.address.line1` | `Part2_Item11_StreetName[0]`, `Part1_Item6_StreetName[0]` |
| Country of Birth | `client_countryOfBirth` | `person.countryOfBirth` | `P1_Line6_CountryOfBirth[0]` |
| Country of Citizenship | `client_countryOfCitizenship` | `person.citizenship` | `P1_Line7_CountryOfCitizenship[0]` |
| Date of Birth | `client_dateOfBirth` | `person.dob` | `P1_Line8_DateOfBirth[0]` |
| U.S. Social Security Number (if any) | `client_ssn` | raw | `P1_Line9_SSN[0]` |
| Applicant's Daytime Telephone Number | `client_daytimeTelephoneNumber` | `contact.phone` | `P5_Line3_DaytimePhoneNumber[0]` |
| Applicant's Email Address | `client_emailAddress` | `contact.email` | `P5_Line5_EmailAddress[0]` |
| Date of Last Arrival Into the United States (mm/dd/yyyy) | `client_dateOfLastArrival` | raw | `SupA_Line1i_DateOfArrival[0]` |
| I-94 Arrival-Departure Record Number | `client_i94Number` | `immigration.i94.number` | `SupA_Line1j_ArrivalDeparture[0]` |
| Passport Number | `client_passportNumber` | `person.passport.number` | `SupA_Line1k_Passport[0]` |
| Country of Passport Issuance | `client_countryOfPassportIssuance` | `person.passport.country` | `SupA_Line1m_CountryOfIssuance[0]` |
| Passport Expiration Date | `client_passportExpirationDate` | `person.passport.expirationDate` | `SupA_Line1n_ExpDate[0]` |
| Current Nonimmigrant Status (e.g. F-1 student, H-4 dependent, etc.) | `client_currentNonimmigrantStatus` | `immigration.currentStatus` | `Pt1Line15a_NewStatus[0]` |
| Expiration Date of Current Status (mm/dd/yyyy) | `client_expirationOfCurrentStatus` | `immigration.i94.expirationDate` | `SupA_Line1p_DateExpires[0]` |
| Street Number and Name | `client_foreignStreetNumberName` | raw | `P2_Line10_StreetName[0]` |
| City or Town | `client_foreignCityTown` | raw | `P2_Line10_City[0]` |
| Postal Code | `client_foreignPostalCode` | raw | `P2_Line10_PostalCode[0]` |
| Province | `client_foreignProvince` | raw | `P2_Line10_Province[0]` |
| Country | `client_foreignCountry` | raw | `P2_Line10_Country[0]` |
| I am applying for (select only one) | `client_applicationType` | raw | `P2_checkbox[0]`, `P2_checkbox[1]`, `P2_checkbox[2]` |

## Questions with no I-539 field (stored as answers; verified: the form does not ask for them)

| Checklist question | Key | Reserved canonical home (not yet consumed) |
|---|---|---|
| US Physical Address (If different from Mailing Address) | `client_usPhysicalAddress` | - |
| State | `client_foreignState` | - |
| New status | `client_changeOfStatusNewStatus` | - |
| Effective date of change (mm/dd/yyyy) | `client_changeOfStatusEffectiveDate` | - |
| The change of status I am requesting is | `client_changeOfStatusRequested` | - |
| Provide information about the person who will be financially supporting your stay in the U | `client_sponsorIntro` | - |
| Family Name (Last Name) | `client_sponsorFamilyName` | `sponsor.lastName` |
| Given Name (First Name) | `client_sponsorGivenName` | `sponsor.firstName` |
| Alien Registration Number (A-Number) if any | `client_sponsorANumber` | `sponsor.alienNumber` |
| US Mailing Address | `client_sponsorUsMailingAddress` | `sponsor.mailingAddress` |
| US Physical Address (If different from Mailing Address) | `client_sponsorUsPhysicalAddress` | `sponsor.physicalAddress` |
| Country of Birth | `client_sponsorCountryOfBirth` | `sponsor.countryOfBirth` |
| Country of Citizenship | `client_sponsorCountryOfCitizenship` | `sponsor.citizenship` |
| Date of Birth | `client_sponsorDateOfBirth` | `sponsor.dob` |
| Daytime Telephone Number | `client_sponsorDaytimeTelephoneNumber` | `sponsor.phone` |
| Email Address | `client_sponsorEmailAddress` | `sponsor.email` |
| Present Employer Name | `client_sponsorEmployerName` | `sponsor.employment.employerName` |
| Present Employer Full Address | `client_sponsorEmployerAddress` | `sponsor.employment.employerAddress` |
| Current Annual Income (in USD) | `client_sponsorAnnualIncome` | `sponsor.finances.annualIncome` |
| Bank Balance (in USD) | `client_sponsorBankBalance` | `sponsor.finances.bankBalance` |
| Other Assets Value (in USD) | `client_sponsorOtherAssetsValue` | `sponsor.finances.otherAssetsValue` |
| Copy of last 3 months paystubs (if any) | `f1reinst_doc_paystubs` | - |
| Copy of SEVIS fee payment receipt (Previous one) | `f1reinst_doc_sevisFeeReceiptPrevious` | - |
| Copy of Old I-20 | `f1reinst_doc_oldI20` | - |
| Copy of New I-20 | `f1reinst_doc_newI20` | - |
| Copy of previous Acceptance letter | `f1reinst_doc_previousAcceptanceLetter` | - |
| Copy of the academic evaluation report (if applicable) | `f1reinst_doc_academicEvaluationReport` | - |
| Copy of academic degree and transcripts | `f1reinst_doc_degreeAndTranscripts` | - |
| Copy of Resume | `f1reinst_doc_resume` | - |
| Copy of tax returns for the most recent year | `f1reinst_doc_sponsorTaxReturns` | - |
| Copy of W2 for the year 2023 | `f1reinst_doc_sponsorW2` | - |
| Copy of paystubs for last 3 months | `f1reinst_doc_sponsorPaystubs` | - |
| Copy of bank statements for last 3 months | `f1reinst_doc_sponsorBankStatements` | - |
| If the sponsor is in the USA then provide proof of US Status (for e.g. green card, Citizen | `f1reinst_doc_sponsorUsStatusProof` | - |
| We need to prepare a reinstatement letter. Please share the following so we can prepare yo | `client_reinstatementIntro` | - |
| Reason your SEVIS was terminated. | `client_reinstatementSevisTerminationReason` | `reinstatement.sevisTerminationReason` |
| When the issue started. | `client_reinstatementIssueStartDate` | `reinstatement.issueStartDate` |
| Anything to add about when the issue started (optional). | `client_reinstatementIssueStartNotes` | - |
| Why it was unintentional. | `client_reinstatementWhyUnintentional` | `reinstatement.unintentionalViolationExplanation` |
| What steps you took after finding out. | `client_reinstatementStepsTaken` | `reinstatement.correctiveActionsTaken` |

## Notes and gaps

- **Application type** (Part 2 Item 1): the three checkboxes are ticked only from the client's own answer; the case type stays "F-1 Reinstatement" whatever is answered. The same edges now also tick the box for H-4 / COS cases that answer `client_applicationType`.
- **Physical address abroad** is Part 4 Item 2 (page 3). Verified from the PDF text, not just the field name.
- **Current status** (Part 1 Item 12) is a dropdown named `Pt1Line15a_NewStatus`; the free-text answer fills it only if it matches an option.
- **Status expiry** now uses `immigration.i94.expirationDate` (the path the existing I-539 edge reads); the older `immigration.currentStatusExpirationDate` was never consumed by an I-539 edge.
- **US mailing / physical address** are single multiline answers, so the whole text lands in the street field; splitting them into street/city/state/zip questions is the remaining improvement. The existing physical-address block still repeats the mailing address.
- **New status / effective date** (Part 2 Items 3-4) stay manual (legal determination, same decision as the existing H-4 crosswalk).
- **Sponsor, employment, finances, reinstatement letter, documents**: not asked by the I-539. Their reserved homes (`sponsor.*`, `reinstatement.*`) are recorded in each question's `metadata.proposedCanonicalPath`; no new canonical root was added because no consumer reads one yet (the letter workflow reads the saved answers).
- Not yet run: an end-to-end autofill of a real F-1 Reinstatement case and a visual check of the generated PDF.
- **Fixed existing mis-mapping:** the I-539 crosswalk wrote the passport number into `SupA_Line1k_Passport[1]` and `[2]`, which the template labels "name of the school" and "SEVIS ID number". Those two edges were removed (mapping version re-seeded), so a student's school name and SEVIS ID are no longer overwritten by the passport number.
- **Review flag:** the new edges read `raw.questionnaireAnswers.client_*`, so by the crosswalk's own rule they carry `sourceVerified: false` (confidence 60, "review required") until an F-1 Reinstatement case has been autofilled and checked; the PDF target fields themselves are verified.
- **Pre-existing, untouched:** `i539-beneficiary-name-mapping.test.js` still fails because Part 3 Items 6-7 (beneficiary first/last name) are mapped to `company.name`; the h3-pdf-render tests also fail without these changes (qpdf).
