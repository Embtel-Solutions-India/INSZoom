// Phase H1 — Canonical -> I-129 (H-1B) field crosswalk. This is the
// human-reviewable source of truth an attorney signs off on (see the Phase H1
// coverage/gaps report delivered alongside this change); the authoring seed
// (../seeds/i129-h1b-mapping.seed.js) converts this file into a
// USCISMappingVersion graph, nothing else does.
//
// Every field on the provisioned I-129 template (~980 AcroForm entries) is
// classified into exactly one of four buckets - see classifyField() at the
// bottom. "mapped" edges are individually authored and reviewed below (not
// auto-suggested); everything else is either explicitly listed as
// MANUAL_ENTRY_FIELDS with a reason, or falls to a page-range default.
//
// Source paths were derived empirically against a real seeded H-1B case
// (see form-mapping/tests/i129-h1b-golden-case.js), not assumed from
// CanonicalFieldRegistryService's idealized `person.*`/`company.*` list.
// Two real, distinct canonical surfaces exist simultaneously on the object
// AutoFillService actually passes to FormMappingService.mapTemplate
// (CanonicalDataService.build()'s merged output):
//   - `person.*`, `contact.*`, `case.*`, `immigration.*` - normalized,
//     merged, source-prioritized (CanonicalBuilderService + MergeService).
//     Used for beneficiary identity: reliable, handles OCR/conflict
//     resolution, is the correct single source of truth.
//   - `company.*` - a RAW Company Mongoose dump, NOT the normalized
//     DATABASE_FIELD_MAP paths (CanonicalBuilderService overwrites
//     `profile.company` with the raw record after merging - the normalized
//     `company.address.*`/`company.contact.*` paths never survive). Only
//     `company.name`/`company.ein` are dependably present here.
//   - `raw.questionnaireAnswers.<questionKey>.value` - EVERY answered
//     question on the case, keyed by its own key, regardless of whether it
//     carries a `mapping.canonicalPath`. This is what most employer-side
//     h1b.js fieldCatalog() fields resolve through (employer.* fields are
//     deliberately NOT given a canonicalPath - see employmentChecklists.js's
//     own comment - so `person.*`/`company.*` do NOT contain them; the
//     sectionMap-based masterData fallback path (inferMasterDataPath) also
//     does not produce a clean `employer.*` path for these questions, so
//     `raw.questionnaireAnswers.*` is the one reliable, always-present
//     source for them).

// Checkbox/radio widgets are expressed as {condition, transform:{type:"boolean"}}
// rather than {transform:{type:"checkbox", value}}. This is NOT a stylistic
// choice: FormMappingService.applyMappingGraph hardcodes `source: "canonical"`
// on every mapping it builds from a graph edge (the string tag, not a path),
// and MappingResolver.resolveDerivedValue's own "checkbox"/"radio"/"dropdown"
// branch resolves its comparison value from `config.source || config.path` -
// since `config.source` is always the truthy string "canonical", it ALWAYS
// wins over `config.path`, so the branch ends up comparing against
// `resolvePath(canonicalData, "canonical")` (undefined) instead of the real
// source path, and returns `false` unconditionally. Confirmed empirically
// (isolated repro run before this refactor) - every {type:"checkbox", value}
// edge silently resolved to false. Reusing `mapping.condition` (checked first, unaffected by this
// bug, uses the real path via `getSourcePath`/`resolveConditionalRule`) to
// gate the edge, then `{type:"boolean"}` (Boolean(value), also unaffected -
// "boolean" isn't in resolveDerivedValue's checkbox/radio/dropdown list) to
// convert the already-condition-matched value to `true`, correctly reaches
// pdf-lib's real onValue only when the underlying answer equals the target
// option - without touching MappingResolver/FormMappingService, which are
// out of scope to modify per §3f/§8.
function checkboxMatch(source, value) {
  return { condition: { field: source, operator: "equals", value }, transform: { type: "boolean" } };
}

// ---------------------------------------------------------------------------
// Pages that belong to a different classification/supplement entirely and
// are out of scope for the H-1B crosswalk (never shown to an H-1B case,
// never worth spending review time on):
//   9-10   E-1/E-2 Classification Supplement
//   11-12  Trade Agreement Supplement (TN/H-1B1 free trade)
//   15-20  H Classification Supplement Sections 2/3 (H-2A/H-2B/H-3) - not H-1B
//   24-27  L Classification Supplement
//   28-30  O and P Classifications Supplement
//   31     Q-1 Classification Supplement
//   32-36  R-1 Classification Supplement
//   37-38  Attachment-1 (multi-beneficiary listing) - this platform models
//          one beneficiary per case; not applicable.
const OUT_OF_SCOPE_PAGES = new Set([9, 10, 11, 12, 15, 16, 17, 18, 19, 20, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38]);

// Barcode fields appear on every page purely for USCIS scanning/processing;
// never a candidate for any data source.
const USCIS_USE_ONLY_PATTERNS = [/PDF417BarCode/];

// ---------------------------------------------------------------------------
// Reviewed, individually-authored edges. Each entry:
//   fieldName: exact AcroForm field name (the template's formFields[].fieldId)
//   source: dot-path resolved against CanonicalDataService.build()'s output,
//           OR { static: <value> } for a fixed value, never conditional on
//           canonical data (e.g. classification symbol, beneficiary count).
//   transform: optional MappingResolver-compatible transform/condition.
//   note: why this mapping is correct, or what residual risk remains.
const MAPPED_EDGES = [
  // --- Part 1: Petitioner Information (page 1) ---
  { fieldName: "form1[0].#subform[0].Line3_CompanyorOrgName[0]", source: "company.name", note: "Item 2, Company/Organization Name. Individual-petitioner Item 1 (Family/Given/Middle Name) is out_of_scope below - every case on this platform files as a company petitioner." },
  { fieldName: "form1[0].#subform[0].Line7b_StreetNumberName[0]", source: "raw.questionnaireAnswers.employer_company_address_street.value", note: "Item 3, mailing address street." },
  { fieldName: "form1[0].#subform[0].Line_CityTown[0]", source: "raw.questionnaireAnswers.employer_company_address_city.value", note: "Item 3, mailing address city." },
  { fieldName: "form1[0].#subform[0].P1_Line3_State[0]", source: "raw.questionnaireAnswers.employer_company_address_state.value", note: "Item 3, mailing address state." },
  { fieldName: "form1[0].#subform[0].P1_Line3_ZipCode[0]", source: "raw.questionnaireAnswers.employer_company_address_zipCode.value", note: "Item 3, mailing address ZIP." },
  { fieldName: "form1[0].#subform[0].P1_Line3_Country[0]", source: "raw.questionnaireAnswers.employer_company_address_country.value", note: "Item 3, mailing address country." },
  { fieldName: "form1[0].#subform[0].Line2_DaytimePhoneNumber1_Part8[0]", source: "raw.questionnaireAnswers.employer_company_daytimePhone.value", note: "Item 4, daytime phone." },

  // --- Part 2: Information About This Petition (page 2) ---
  { fieldName: "form1[0].#subform[1].Part2_ClassificationSymbol[0]", source: "case.visaType", note: "Item 1, requested classification symbol. case.visaType is always the literal string 'H-1B' for a case this template is assigned to (visaTypes:['H-1B']) - used directly rather than inventing a separate static-value mechanism (FormMappingService.applyMappingGraph does not forward a custom staticValue field from a graph edge, and that file is out of scope to modify per §3f/§8)." },
  { fieldName: "form1[0].#subform[1].new[0]", source: "raw.questionnaireAnswers.employee_filingType.value", ...checkboxMatch("raw.questionnaireAnswers.employee_filingType.value", "New H1B"), note: "Item 2a, New employment." },
  { fieldName: "form1[0].#subform[1].concurrent[0]", source: "raw.questionnaireAnswers.employee_filingType.value", ...checkboxMatch("raw.questionnaireAnswers.employee_filingType.value", "H1B Concurrent"), note: "Item 2d, New concurrent employment." },
  { fieldName: "form1[0].#subform[1].change[0]", source: "raw.questionnaireAnswers.employee_filingType.value", ...checkboxMatch("raw.questionnaireAnswers.employee_filingType.value", "H1B Transfer"), note: "Item 2e, Change of employer." },
  { fieldName: "form1[0].#subform[1].amended[0]", source: "raw.questionnaireAnswers.employee_filingType.value", ...checkboxMatch("raw.questionnaireAnswers.employee_filingType.value", "H1B Amendment"), note: "Item 2f, Amended petition." },
  { fieldName: "form1[0].#subform[1].continuation[0]", source: "raw.questionnaireAnswers.employee_filingType.value", ...checkboxMatch("raw.questionnaireAnswers.employee_filingType.value", "H1B Extension"), note: "Item 2b, Continuation of previously approved employment without change. FLAGGED: 'H1B Extension' could also mean Item 2c (Change in previously approved employment, 'previouschange' field) depending on whether anything changed - attorney should confirm this default and, ideally, a future phase should split filingType into a more precise selector." },
  { fieldName: "form1[0].#subform[1].Part3_Line2_FamilyName[0]", source: "person.lastName", note: "Part 3 Item 3, beneficiary family name (spills onto page 2)." },
  { fieldName: "form1[0].#subform[1].Part3_Line2_GivenName[0]", source: "person.firstName", note: "Part 3 Item 3, beneficiary given name." },
  { fieldName: "form1[0].#subform[1].Part3_Line2_MiddleName[0]", source: "person.middleName", note: "Part 3 Item 3, beneficiary middle name." },
  { fieldName: "form1[0].#subform[1].Line1_ReceiptNumber[0]", source: "raw.questionnaireAnswers.employee_personal_latestPriorPetitionNumber.value", note: "Item 3, most recent prior petition/application receipt number." },

  // --- Part 3: Beneficiary Information (pages 2-3) ---
  { fieldName: "form1[0].#subform[2].Line1_Gender_P3[0]", source: "person.gender", ...checkboxMatch("person.gender", "male"), note: "Item 5, Sex - Male widget. person.gender is normalized lowercase by CanonicalTransformationService (verified empirically)." },
  { fieldName: "form1[0].#subform[2].Line1_Gender_P3[1]", source: "person.gender", ...checkboxMatch("person.gender", "female"), note: "Item 5, Sex - Female widget." },
  { fieldName: "form1[0].#subform[2].Line6_DateOfBirth[0]", source: "person.dob", transform: { type: "date", format: "mm/dd/yyyy" }, note: "Item 5, date of birth." },
  { fieldName: "form1[0].#subform[2].Line5_SSN[0]", source: "raw.questionnaireAnswers.employee_personal_socialSecurityNumber.value", note: "Item 5, beneficiary SSN (if any)." },
  { fieldName: "form1[0].#subform[2].Part3Line4_CountryOfBirth[0]", source: "person.countryOfBirth", note: "Item 5, country of birth." },
  { fieldName: "form1[0].#subform[2].Part3Line4_CountryOfCitizenship[0]", source: "person.citizenship", note: "Item 5, country of citizenship/nationality." },
  { fieldName: "form1[0].#subform[2].Part3Line5_ArrivalDeparture[0]", source: "immigration.i94.number", note: "Item 6, I-94 Arrival-Departure Record Number." },
  { fieldName: "form1[0].#subform[2].Line5_SEVIS[0]", source: "raw.questionnaireAnswers.employee_personal_sevisNumber.value", note: "Item 6, SEVIS Number." },
  { fieldName: "form1[0].#subform[2].Part3Line5_PassportorTravDoc[0]", source: "person.passport.number", note: "Item 6, passport/travel document number." },
  { fieldName: "form1[0].#subform[2].Part3Line5_DateofArrival[0]", source: "raw.questionnaireAnswers.employee_immigrationStatus_dateOfLastArrival.value", transform: { type: "date", format: "mm/dd/yyyy" }, note: "Item 6, date of last arrival." },
  { fieldName: "form1[0].#subform[2].Line11g_CurrentNon[0]", source: "immigration.currentStatus", note: "Item 6, current nonimmigrant status." },
  { fieldName: "form1[0].#subform[2].Line11h_DateStatusExpires[0]", source: "raw.questionnaireAnswers.employee_immigrationStatus_currentStatusExpirationDate.value", transform: { type: "date", format: "mm/dd/yyyy" }, note: "Item 6, date current status expires. Distinct field from passport expiry (Line11e_ExpDate) - do not confuse; see AC3 cross-contamination test." },
  { fieldName: "form1[0].#subform[2].Line8a_StreetNumberName[0]", source: "contact.address.line1", note: "Item 7, current residential U.S. address street." },
  { fieldName: "form1[0].#subform[2].Line8d_CityTown[0]", source: "contact.address.city", note: "Item 7, current residential U.S. address city." },
  { fieldName: "form1[0].#subform[2].Line8e_State[0]", source: "contact.address.state", note: "Item 7, current residential U.S. address state." },
  { fieldName: "form1[0].#subform[2].Line8f_ZipCode[0]", source: "contact.address.zip", note: "Item 7, current residential U.S. address ZIP." },

  // --- Part 4: Processing Information (pages 3-4) ---
  { fieldName: "form1[0].#subform[3].P4Line2_Checkbox[0]", source: "raw.questionnaireAnswers.employee_immigrationHistory_hasValidPassport.value", ...checkboxMatch("raw.questionnaireAnswers.employee_immigrationHistory_hasValidPassport.value", "yes"), note: "Item 2, does each person have a valid passport - Yes widget." },
  { fieldName: "form1[0].#subform[3].P4Line6_Yes[0]", source: "raw.questionnaireAnswers.employee_immigrationHistory_inRemovalProceedings.value", ...checkboxMatch("raw.questionnaireAnswers.employee_immigrationHistory_inRemovalProceedings.value", "yes"), note: "Item 6, in removal proceedings - Yes widget." },
  { fieldName: "form1[0].#subform[3].P4Line6_No[0]", source: "raw.questionnaireAnswers.employee_immigrationHistory_inRemovalProceedings.value", ...checkboxMatch("raw.questionnaireAnswers.employee_immigrationHistory_inRemovalProceedings.value", "no"), note: "Item 6, in removal proceedings - No widget." },
  { fieldName: "form1[0].#subform[3].P4Line7[0]", source: "raw.questionnaireAnswers.employee_immigrationHistory_employerFiledGreenCard.value", ...checkboxMatch("raw.questionnaireAnswers.employee_immigrationHistory_employerFiledGreenCard.value", "yes"), note: "Item 7, ever filed an immigrant petition for this beneficiary - Yes widget." },
  { fieldName: "form1[0].#subform[3].P4Line7[1]", source: "raw.questionnaireAnswers.employee_immigrationHistory_employerFiledGreenCard.value", ...checkboxMatch("raw.questionnaireAnswers.employee_immigrationHistory_employerFiledGreenCard.value", "no"), note: "Item 7 - No widget." },
  { fieldName: "form1[0].#subform[3].P4Line8a_Yes[0]", source: "raw.questionnaireAnswers.employee_immigrationHistory_heldH1bLastSevenYears.value", ...checkboxMatch("raw.questionnaireAnswers.employee_immigrationHistory_heldH1bLastSevenYears.value", "yes"), note: "Item 8a, held this classification within 7 years - Yes widget." },
  { fieldName: "form1[0].#subform[3].P4Line8a_No[0]", source: "raw.questionnaireAnswers.employee_immigrationHistory_heldH1bLastSevenYears.value", ...checkboxMatch("raw.questionnaireAnswers.employee_immigrationHistory_heldH1bLastSevenYears.value", "no"), note: "Item 8a - No widget." },
  { fieldName: "form1[0].#subform[3].P4Line8b_Yes[0]", source: "raw.questionnaireAnswers.employee_immigrationHistory_deniedH1bLastSevenYears.value", ...checkboxMatch("raw.questionnaireAnswers.employee_immigrationHistory_deniedH1bLastSevenYears.value", "yes"), note: "Item 8b, denied this classification within 7 years - Yes widget." },
  { fieldName: "form1[0].#subform[3].P4Line8b_No[0]", source: "raw.questionnaireAnswers.employee_immigrationHistory_deniedH1bLastSevenYears.value", ...checkboxMatch("raw.questionnaireAnswers.employee_immigrationHistory_deniedH1bLastSevenYears.value", "no"), note: "Item 8b - No widget." },

  // --- Part 5: Basic Information About the Proposed Employment (pages 5-6) ---
  { fieldName: "form1[0].#subform[4].Part5_Q1_JobTitle[0]", source: "raw.questionnaireAnswers.employer_position_jobTitle.value", note: "Item 1, job title." },
  { fieldName: "form1[0].#subform[4].Line8_Wages[0]", source: "raw.questionnaireAnswers.employer_position_offeredSalary.value", note: "Item 9, wages offered." },
  { fieldName: "form1[0].#subform[4].Part5_Q10_DateFrom[0]", source: "raw.questionnaireAnswers.employer_position_employmentStartDate.value", transform: { type: "date", format: "mm/dd/yyyy" }, note: "Item 11, intended employment start date." },
  { fieldName: "form1[0].#subform[5].Part5Line12_TypeofBusiness[0]", source: "raw.questionnaireAnswers.employer_company_businessType.value", note: "Item 12, type of business." },
  { fieldName: "form1[0].#subform[5].P5Line13_YearEstablished[0]", source: "raw.questionnaireAnswers.employer_company_yearEstablished.value", note: "Item 13, year established." },
  { fieldName: "form1[0].#subform[5].P5Line14_NumberofEmployees[0]", source: "raw.questionnaireAnswers.employer_workforce_totalUsEmployees.value", note: "Item 14, current number of US employees." },
  { fieldName: "form1[0].#subform[5].Line15_GrossAnnualIncome[0]", source: "raw.questionnaireAnswers.employer_company_grossAnnualIncome.value", note: "Item 16, gross annual income." },
  { fieldName: "form1[0].#subform[5].Line16_NetAnnualIncome[0]", source: "raw.questionnaireAnswers.employer_company_netIncome.value", note: "Item 17, net annual income." },
  { fieldName: "form1[0].#subform[5].Line1a_PetitionerLastName[0]", source: "raw.questionnaireAnswers.employer_signingPerson_lastName.value", note: "Part 7 Item 1, name of authorized signatory (last name)." },
  { fieldName: "form1[0].#subform[5].Line1b_PetitionerFirstName[0]", source: "raw.questionnaireAnswers.employer_signingPerson_firstName.value", note: "Part 7 Item 1, name of authorized signatory (first name)." },

  // --- H Classification Supplement, Section applicable to all classifications (page 13) ---
  { fieldName: "form1[0].#subform[13].Line1_PetitionerName[0]", source: "company.name", note: "Item 1, name of the petitioner." },
  { fieldName: "form1[0].#subform[13].Line2_BeneficiaryName[0]", source: "person.fullName", note: "Item 2a, name of the beneficiary (single-beneficiary path; Item 2b 'total number of beneficiaries' is the mutually exclusive multi-beneficiary alternative and is out_of_scope)." },
  { fieldName: "form1[0].#subform[13].SubHLine4_class[0]", source: "case.visaType", ...checkboxMatch("case.visaType", "H-1B"), note: "Item 4a, H-1B Specialty Occupation - the only classification this crosswalk targets. Sourced from case.visaType (always 'H-1B' for this template's scope) rather than a static-value mechanism - see the Part2_ClassificationSymbol edge's note. Verified via pdf-lib: this widget's onValue is /A, matching choice 'a' in the form's own lettering." },

  // --- H Classification Supplement, Section 1 (H-1B only) (page 14) ---
  { fieldName: "form1[0].#subform[15].Line1_Duties[0]", source: "raw.questionnaireAnswers.employer_jobDescription_duties.value", note: "Section 1 Item 1, describe the proposed duties." },
  // Phase H6: previously proxied off the beneficiary's CURRENT passport
  // (person.passport.*) since no registration-specific field existed -
  // flagged as an approximation that could be wrong if the passport was
  // renewed between registration and filing. h1b.js now collects the
  // actual document used at registration (employee.capRegistration.*,
  // Phase H6) - mapped here directly instead of the current-passport proxy.
  { fieldName: "form1[0].#subform[15].ClassHLine5b_PassportorTravDoc[0]", source: "raw.questionnaireAnswers.employee_capRegistration_passportNumber.value", note: "Item 5b, passport number used at H-1B registration." },
  { fieldName: "form1[0].#subform[15].ClassHLine5b_ExpDate[0]", source: "raw.questionnaireAnswers.employee_capRegistration_passportExpirationDate.value", transform: { type: "date", format: "mm/dd/yyyy" }, note: "Item 5b, passport expiration at registration." },
  { fieldName: "form1[0].#subform[15].ClassHLine5b_CountryOfIssuance[0]", source: "raw.questionnaireAnswers.employee_capRegistration_passportCountry.value", note: "Item 5b, passport country of issuance used at registration. Phase H6: previously a canonical gap (no h1b.js field existed) - now collected directly." },
  { fieldName: "form1[0].#subform[13].SubHLine5_ConfirmationNum[0]", source: "raw.questionnaireAnswers.employee_capRegistration_beneficiaryConfirmationNumber.value", note: "Item 5, H-1B registration Beneficiary Confirmation Number. Phase H6: previously a canonical gap (no h1b.js field existed) - now collected directly." },

  // --- H-1B and H-1B1 Data Collection and Filing Fee Exemption Supplement (pages 21-23) ---
  { fieldName: "form1[0].#subform[22].PartA_q3_Field_of_Study[0]", source: "raw.questionnaireAnswers.employee_education_majorFieldOfStudy.value", note: "Section 1 Item 3, beneficiary's major/primary field of study." },
  { fieldName: "form1[0].#subform[22].Line2f[0].Line6_NAICSCode[0]", source: "raw.questionnaireAnswers.employer_company_naicsCode.value", note: "Section 1 Item 6, employer NAICS code." },
  { fieldName: "form1[0].#subform[22].Line4_RateofPayPerYear[0]", source: "raw.questionnaireAnswers.employer_position_offeredSalary.value", note: "Section 1 Item 4, rate of pay per year." },
  { fieldName: "form1[0].#subform[22].H1BSecALine1a_Yes[0]", source: "raw.questionnaireAnswers.employer_workforce_isH1bDependentOrWillfulViolator.value", ...checkboxMatch("raw.questionnaireAnswers.employer_workforce_isH1bDependentOrWillfulViolator.value", "Yes"), note: "Section A Item a, H-1B-dependent employer - Yes widget. NOTE: the real form separates 'H-1B dependent' (1a) from 'willful violator' (1b) as two questions; the Phase 2 questionnaire field combined them into one. Mapped to 1a only; 1b is manual_entry - see the Phase H1 gaps report." },
  { fieldName: "form1[0].#subform[22].H1BSecALine1a_No[0]", source: "raw.questionnaireAnswers.employer_workforce_isH1bDependentOrWillfulViolator.value", ...checkboxMatch("raw.questionnaireAnswers.employer_workforce_isH1bDependentOrWillfulViolator.value", "No"), note: "Section A Item a - No widget." },
  { fieldName: "form1[0].#subform[23].WageLevelBox[0]", source: "raw.questionnaireAnswers.employer_position_wageLevel.value", ...checkboxMatch("raw.questionnaireAnswers.employer_position_wageLevel.value", "Level I"), note: "Section 3 Item 2, wage level. FLAGGED: pdf-lib confirms 4 distinct widgets (onValues A/B/C/D) but NOT which visual level each corresponds to - the printed form lists levels in IV/III/II/I order. Mapped assuming A=Level I (common LiveCycle authoring convention: definition order, not visual order) - requires visual verification per the human review step before relying on this for a real filing." },
  { fieldName: "form1[0].#subform[23].WageLevelBox[1]", source: "raw.questionnaireAnswers.employer_position_wageLevel.value", ...checkboxMatch("raw.questionnaireAnswers.employer_position_wageLevel.value", "Level II"), note: "Assumed B=Level II - see WageLevelBox[0]'s note." },
  { fieldName: "form1[0].#subform[23].WageLevelBox[2]", source: "raw.questionnaireAnswers.employer_position_wageLevel.value", ...checkboxMatch("raw.questionnaireAnswers.employer_position_wageLevel.value", "Level III"), note: "Assumed C=Level III - see WageLevelBox[0]'s note." },
  { fieldName: "form1[0].#subform[23].WageLevelBox[3]", source: "raw.questionnaireAnswers.employer_position_wageLevel.value", ...checkboxMatch("raw.questionnaireAnswers.employer_position_wageLevel.value", "Level IV"), note: "Assumed D=Level IV - see WageLevelBox[0]'s note." },
  { fieldName: "form1[0].#subform[23].Cap[0]", source: "raw.questionnaireAnswers.employee_filingCapType.value", ...checkboxMatch("raw.questionnaireAnswers.employee_filingCapType.value", "Regular CAP"), note: "Section 3 Item 1a, Cap H-1B Bachelor's Degree." },
  { fieldName: "form1[0].#subform[23].Cap[1]", source: "raw.questionnaireAnswers.employee_filingCapType.value", ...checkboxMatch("raw.questionnaireAnswers.employee_filingCapType.value", "Master's CAP"), note: "Section 3 Item 1b, Cap H-1B U.S. Master's Degree or Higher. (Items 1c Chile/Singapore and 1d Cap Exempt have no corresponding source value and are left unmapped.)" },
  { fieldName: "form1[0].#subform[24].H1bSec3Line3a_Name[0]", source: "raw.questionnaireAnswers.employee_education_usInstitutionName.value", note: "Section 3 Item 3a, US institution name (master's cap exemption)." },
  { fieldName: "form1[0].#subform[24].H1bSec3Line3b_DateDegreeAwarded[0]", source: "raw.questionnaireAnswers.employee_education_degreeAwardDate.value", transform: { type: "date", format: "mm/dd/yyyy" }, note: "Section 3 Item 3b, date degree awarded." },
  { fieldName: "form1[0].#subform[24].H1bSec3Line3c_TypeofDegree[0]", source: "raw.questionnaireAnswers.employee_education_degreeType.value", note: "Section 3 Item 3c, type of US degree." },
  { fieldName: "form1[0].#subform[24].H1bSec3Line3d_StreetName[0]", source: "raw.questionnaireAnswers.employee_education_institutionAddress.value", note: "Section 3 Item 3d, US institution address. h1b.js collects this as one free-text field (not split street/city/state/zip); mapped to the street line only. City/state/zip sub-fields (Part7LineB_BEmp1City/State/ZipCode) are manual_entry." },
];

// ---------------------------------------------------------------------------
// Fields with NO reliable canonical/questionnaire source, or requiring
// human judgment (signatures, legal determinations, ambiguous collisions).
// Grouped by reason for the Phase H1 coverage/gaps report; every entry here
// that represents a genuine missing canonical field (as opposed to
// "inherently a manual/legal act", e.g. a signature) is called out there too.
const MANUAL_ENTRY_FIELDS = {
  // Individual-petitioner fields - out of scope for a company petitioner,
  // but not truly "out_of_scope" in the sense of another classification, so
  // tracked here for clarity.
  "individual_petitioner_not_modeled": [
    "form1[0].#subform[0].Line1_FamilyName[0]", "form1[0].#subform[0].Line1_GivenName[0]", "form1[0].#subform[0].Line1_MiddleName[0]",
    "form1[0].#subform[1].Line3_TaxNumber[0]", "form1[0].#subform[1].Line4_SSN[0]",
  ],
  // A canonical value exists, but its STORED FORMAT doesn't fit the PDF
  // widget without a transform this codebase doesn't have (prefix-strip /
  // string-split) - confirmed via a real ValidationService run against the
  // golden case, not assumed. Adding a new transform type
  // to MappingResolver is out of scope (§3f/§8), so left manual rather than
  // writing a value that overflows/mismatches the widget.
  "format_mismatch_confirmed_by_validation": [
    "form1[0].#subform[2].Line1_AlienNumber[0]", // person.alienNumber includes a leading "A" (e.g. "A987654321") but this widget has its own pre-printed "A-" and a 9-character max length - writing the canonical value as-is overflows to 10 characters and duplicates the "A"
    "form1[0].#subform[7].#area[0].Line10_AlienNumber[0]", // same A-prefix/length mismatch, Part 9 continuation sheet header
    "form1[0].#subform[22].Line5_SOCCode1[0]", // this box is limited to 2 characters (confirmed by ValidationService: "must be no more than 2 characters") - the real widget expects the SOC code split ##-#### across Line5_SOCCode1 (2 chars) / Line5_SOCCode2 (4 chars); employer_position_socCode is stored as one un-split string (e.g. "15-1252")
  ],
  // No corresponding h1b.js field exists at all - genuine canonical gaps
  // (see the Phase H1 gaps report for the full list and recommended follow-up).
  "no_canonical_source": [
    "form1[0].#subform[2].Line_CountryOfIssuance[0]", // passport country of issuance - EMPLOYEE_CANONICAL_PATHS (employmentChecklists.js) references "personal.passportCountryOfIssuance" -> person.passport.country, but no such field actually exists in h1b.js's fieldCatalog() (only passportNumber/passportIssueDate/passportExpirationDate do) - confirmed empirically (person.passport.country never resolves). The canonical mapping entry is presently dead code; recommend either adding the missing fieldCatalog() question or removing the stale canonical-path entry.
    "form1[0].#subform[0].Line9_EmailAddress[0]", // company email - not collected
    "form1[0].#subform[0].Line3_MobilePhoneNumber1_Part8[0]", // company mobile phone - not collected
    "form1[0].#subform[0].P1Line6_No[0]", "form1[0].#subform[0].P1Line6_Yes[0]", // nonprofit/gov research org - overlaps but isn't identical to isAcwiaFeeExempt
    "form1[0].#subform[1].TtlNumbersofWorker[0]", // total workers in petition - platform always models exactly one beneficiary, but no canonical field exists to confirm this from; trivial for a case manager to enter "1"
    "form1[0].#subform[1].P2Checkbox4[0]", "form1[0].#subform[1].P2Checkbox4[1]", "form1[0].#subform[1].P2Checkbox4[2]",
    "form1[0].#subform[1].P2Checkbox4[3]", "form1[0].#subform[1].P2Checkbox4[4]", "form1[0].#subform[1].P2Checkbox4[5]", // Requested Action - not collected
    "form1[0].#subform[2].Line5_EAD[0]", // EAD number - not collected
    "form1[0].#subform[3].P4Line3_Yes[0]", "form1[0].#subform[3].P4Line3_No[0]", "form1[0].#subform[3].P4Line3_HowMany[0]", // other petitions filed with this one
    "form1[0].#subform[3].P4Line4_Yes[0]", "form1[0].#subform[3].P4Line4_No[0]", "form1[0].#subform[3].P4Line4_HowMany[0]", // replacement I-94 application
    "form1[0].#subform[4].Part5_Q2_LCAorETA[0]", // LCA/ETA case number - important, not collected
    "form1[0].#subform[4].P5Line7_No[0]", "form1[0].#subform[4].P5Line7_Yes[0]", "form1[0].#subform[4].P5Line9_Hours[0]", // full-time position / hours per week
    "form1[0].#subform[4].Line8_Per[0]", // wage unit (per hour/week/month/year)
    "form1[0].#subform[4].Line10_Explanation[0]", // other compensation
    "form1[0].#subform[4].Part5_Q10_DateTo[0]", // intended employment end date
    "form1[0].#subform[5].P5Line15_Yes[0]", "form1[0].#subform[5].P5Line15_No[0]", // 25-or-fewer-FTE (related to but not identical to isAcwiaFeeExempt)
    "form1[0].#subform[22].Line5_SOCCode2[0]", // second half of split SOC code
    "form1[0].#subform[22].Line7_Education[0]", "form1[0].#subform[22].Line8_FieldofStudy[0]",
    "form1[0].#subform[22].Line9_YearsofExperience[0]", "form1[0].#subform[22].Line10_SpecialSkills[0]",
    "form1[0].#subform[22].Line4_BeneficiarySupervisePositionTitles[0]", // job REQUIREMENTS (LCA-derived), distinct from beneficiary's own education
    "form1[0].#subform[23].PartC_4aCheckbox[0]", "form1[0].#subform[23].PartC_4bCheckbox[0]", "form1[0].#subform[23].PartC_4cCheckbox[0]",
    "form1[0].#subform[23].PartC_4dCheckbox[0]", "form1[0].#subform[23].PartC_4eCheckbox[0]", "form1[0].#subform[23].PartC_4fCheckbox[0]",
    "form1[0].#subform[23].PartC_4gCheckbox[0]", "form1[0].#subform[23].PartC_4hCheckbox[0]", // ACWIA fee exemption category (a-h)
    "form1[0].#subform[15].Line2_SummaryofWorkExperience[0]", // narrative work-experience summary
    "form1[0].#subform[24].Part7LineB_BEmp1City[0]", "form1[0].#subform[24].Part7LineB_BEmp1State[0]", "form1[0].#subform[24].Part7LineB_BEmp1ZipCode[0]",
  ],
  // Ambiguous field-name collisions where guessing wrong risks
  // cross-contamination or a wrong legal determination - explicitly deferred
  // to visual verification (see the Phase H1 report's attorney-review list)
  // rather than mapped.
  "ambiguous_requires_visual_verification": [
    "form1[0].#subform[1].previouschange[0]", // could also represent "H1B Extension" - see the `continuation` edge's note
    "form1[0].#subform[2].Line11e_ExpDate[0]", "form1[0].#subform[2].Line11e_ExpDate[1]", // two identically-named widgets near the passport block; Line11h already unambiguously covers status-expiry, so these are very likely both passport issue/expiry, but which is which is not derivable from the field name alone
    "form1[0].#subform[2].P3Line1_Checkbox[0]", "form1[0].#subform[2].P3Line1_Checkbox[1]", // "Named"/"Unnamed" - onValues (/N, /Y) don't unambiguously confirm which widget is which
  ],
  // Legal determinations / signatures / preparer info - inherently a human
  // act at filing time, never sourced from canonical case data.
  "signature_or_legal_determination": [
    "form1[0].#subform[5].NoDeemed[0]", "form1[0].#subform[5].Deemed[0]", // export control license determination
    "form1[0].#subform[15].Line8a_Check[0]", "form1[0].#subform[15].Line8a_Check[1]", "form1[0].#subform[15].Line8b_Explain[0]",
    "form1[0].#subform[15].SupHLine5_Yes[0]", "form1[0].#subform[15].SupHLine5_No[0]", "form1[0].#subform[15].SupHLine5_Yes[1]", "form1[0].#subform[15].SupHLine5_No[1]",
    "form1[0].#subform[15].Sect1_DateSignedByPetitioner[0]", "form1[0].#subform[15].Sect1_PetitionerPrintedName[0]", "form1[0].#subform[15].P5_Line6a_SignatureofApplicant[2]",
    "form1[0].#subform[23].H1BSec4Line1a_Yes[0]", "form1[0].#subform[23].H1BSec4Line1a_No[0]",
    "form1[0].#subform[23].H1BSec4Line1b_Yes[0]", "form1[0].#subform[23].H1BSec4Line1b_No[0]",
    "form1[0].#subform[23].H1BSec4Line1c_Yes[0]", "form1[0].#subform[23].H1BSec4Line1c_No[0]",
  ],
};

function flattenManualEntry() {
  const set = new Set();
  Object.values(MANUAL_ENTRY_FIELDS).forEach((list) => list.forEach((name) => set.add(name)));
  return set;
}

const MANUAL_ENTRY_SET = flattenManualEntry();
const MAPPED_BY_FIELD_NAME = new Map(MAPPED_EDGES.map((edge) => [edge.fieldName, edge]));

// In-scope pages (I-129 base Parts 1-9, H Classification Supplement's H-1B
// section, H-1B Data Collection Supplement) that are NOT individually
// listed above default to manual_entry rather than being silently
// unclassified - see §3c "No field may be left ambiguous."
function isInScopePage(pageNumber) {
  return !OUT_OF_SCOPE_PAGES.has(pageNumber);
}

// IMPORTANT: this crosswalk is keyed by the RAW AcroForm field name (e.g.
// "form1[0].#subform[1].Part2_ClassificationSymbol[0]") - the same name
// pdf-lib and this file's review notes use - NOT USCISFormTemplate's own
// `formFields[].fieldId` (a separately normalized/slugified identifier,
// e.g. "part2.form10subform1part2classificationsymbol0", confirmed
// empirically to differ from fieldName). Callers must pass the raw name
// (targetPdfField from MappingGraphService.getTemplateFields, or a scanned
// field's own `.fieldName`), not `.fieldId`.
function classifyField(field) {
  const fieldName = field.fieldName || field.pdfFieldName || field.fieldId;
  if (USCIS_USE_ONLY_PATTERNS.some((pattern) => pattern.test(fieldName))) {
    return { status: "uscis_use_only", note: "USCIS-internal barcode/processing field." };
  }
  const mappedEdge = MAPPED_BY_FIELD_NAME.get(fieldName);
  if (mappedEdge) return { status: "mapped", edge: mappedEdge };
  if (MANUAL_ENTRY_SET.has(fieldName)) return { status: "manual_entry", note: "See crosswalk MANUAL_ENTRY_FIELDS for the specific reason." };
  if (!isInScopePage(field.pageNumber)) {
    return { status: "out_of_scope", note: "Belongs to a different classification/supplement (E-1/E-2, Trade Agreement, H-2A/H-2B/H-3, L, O/P, Q-1, R-1, or the multi-beneficiary Attachment-1) - not applicable to an H-1B specialty-occupation petition." };
  }
  return { status: "manual_entry", note: "In-scope H-1B field without an individually authored source. Defaulted to manual_entry rather than left ambiguous - case manager completes at review; flag for a future crosswalk revision if a canonical source should be added." };
}

module.exports = {
  OUT_OF_SCOPE_PAGES,
  USCIS_USE_ONLY_PATTERNS,
  MAPPED_EDGES,
  MANUAL_ENTRY_FIELDS,
  classifyField,
};
