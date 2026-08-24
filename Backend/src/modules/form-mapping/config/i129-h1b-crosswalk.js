// Phase H1 — Canonical -> I-129 field crosswalk, covering both H-1B and (as
// of the L-1A crosswalk addition) L-1A/L-1B. This is the human-reviewable
// source of truth an attorney signs off on (see the Phase H1 coverage/gaps
// report delivered alongside this change); the authoring seed
// (../seeds/i129-h1b-mapping.seed.js) converts this file into a SINGLE
// USCISMappingVersion graph for the ONE active I-129 template - nothing
// else does. Deliberately kept as one file/one seed rather than a separate
// per-visa-type crosswalk+seed pair: USCISFormTemplate only supports one
// active mapping version per template (template.activeMappingVersionId),
// so two independently-run seeds targeting the same I-129 template would
// fight over that single slot - whichever ran last would silently replace
// the other's mappings. Every visa type sharing this form gets its edges
// added here instead, in one always-combined graph.
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
// `value` is normally a single scalar (operator "equals"). Passing an ARRAY
// switches to operator "in" (MappingResolver.js already implements "in" as
// `right.includes(left)` - not a new operator, just a different existing
// branch of the same, already-supported comparator) so one checkbox can
// accept multiple acceptable raw strings for the same option - needed below
// for the education-level checkboxes, where the source answer might be
// either deriveEducationScalarFields' own enum token (e.g. "masters") or a
// human-typed free-text label (e.g. "Master's degree") depending on whether
// the value came from OCR or manual questionnaire entry.
function checkboxMatch(source, value) {
  return { condition: { field: source, operator: Array.isArray(value) ? "in" : "equals", value }, transform: { type: "boolean" } };
}

// ---------------------------------------------------------------------------
// Pages that belong to a different classification/supplement entirely and
// are out of scope for this crosswalk (never shown to an H-1B or L-1A/L-1B
// case, never worth spending review time on):
//   9-10   E-1/E-2 Classification Supplement
//   11-12  Trade Agreement Supplement (TN/H-1B1 free trade)
//   15-20  H Classification Supplement Sections 2/3 (H-2A/H-2B/H-3) - not H-1B
//   28-30  O and P Classifications Supplement
//   31     Q-1 Classification Supplement
//   32-36  R-1 Classification Supplement
//   37-38  Attachment-1 (multi-beneficiary listing) - this platform models
//          one beneficiary per case; not applicable.
// 24-27 (L Classification Supplement) is IN scope as of the L-1A crosswalk
// addition below - moved out of this set. Page numbers verified empirically
// against the real seeded I-129 template (pdf-lib widget->page mapping, not
// assumed from the printed form's own numbering), same standard as every
// other page reference in this file.
const OUT_OF_SCOPE_PAGES = new Set([9, 10, 11, 12, 15, 16, 17, 18, 19, 20, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38]);
// Sub-range of the (now in-scope) L Classification Supplement that models
// BLANKET petitions (multiple affiliated companies) - this platform's
// l1a.js questionnaire only models a single individual L-1A/L-1B petition
// (one US company, one foreign company), so these stay out of scope even
// though their pages are no longer globally excluded.
const L_BLANKET_OUT_OF_SCOPE_FIELDS = new Set([
  "form1[0].#subform[25].a_individual[0]", "form1[0].#subform[25].b_blanket[0]", // individual-vs-blanket petition selector - see MANUAL_ENTRY_FIELDS note
  "form1[0].#subform[29].Table4[0].Row1[0].Line1[0]", "form1[0].#subform[29].Table4[0].Row1[0].FEIN_Line1[0]",
  "form1[0].#subform[29].Table4[0].Row2[0].Line2[0]", "form1[0].#subform[29].Table4[0].Row2[0].FEIN_Line2[0]",
  "form1[0].#subform[29].Table4[0].Row3[0].Line3[0]", "form1[0].#subform[29].Table4[0].Row3[0].FEIN_Line3[0]",
  "form1[0].#subform[29].Table4[0].Row4[0].Line4[0]", "form1[0].#subform[29].Table4[0].Row4[0].FEIN_Line4[0]",
  "form1[0].#subform[29].Table4[0].Row4[1].Line5[0]", "form1[0].#subform[29].Table4[0].Row4[1].FEIN_Line5[0]",
  "form1[0].#subform[29].LSec1Line11_Yes[0]", "form1[0].#subform[29].LSec1Line11_No[0]",
  "form1[0].#subform[29].LSec1Line12_Yes[0]", "form1[0].#subform[29].LSec1Line12_No[0]", "form1[0].#subform[29].LSec1Line12[0]", "form1[0].#subform[29].LSec1Line12[1]",
  "form1[0].#subform[31].Table5[0].Row1[0].Cell1[0]", "form1[0].#subform[31].Table5[0].Row1[0].Cell2[0]",
  "form1[0].#subform[31].Table5[0].Row2[0].Cell1[0]", "form1[0].#subform[31].Table5[0].Row2[0].Cell2[0]",
  "form1[0].#subform[31].Table5[0].Row3[0].Cell1[0]", "form1[0].#subform[31].Table5[0].Row3[0].Cell2[0]",
  "form1[0].#subform[31].Table5[0].Row4[0].Cell1[0]", "form1[0].#subform[31].Table5[0].Row4[0].Cell2[0]",
  "form1[0].#subform[31].Table5[0].Row4[1].Cell1[0]", "form1[0].#subform[31].Table5[0].Row4[1].Cell2[0]",
  "form1[0].#subform[31].Table5[0].Row4[2].Cell1[0]", "form1[0].#subform[31].Table5[0].Row4[2].Cell2[0]",
  "form1[0].#subform[31].Table5[0].Row4[3].Cell1[0]", "form1[0].#subform[31].Table5[0].Row4[3].Cell2[0]",
  "form1[0].#subform[31].Table5[0].Row4[4].Cell1[0]", "form1[0].#subform[31].Table5[0].Row4[4].Cell2[0]",
]);

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
  // KNOWN GAP (found while adding the L-1A crosswalk section below): every
  // raw.questionnaireAnswers.employer_* edge in this Part 1 block is keyed
  // to h1b.js's own fieldCatalog sub-path ("employer.company.*" ->
  // "employer_company_*"). l1a.js's US-company identity/address fields live
  // under a differently-named sub-path ("employer.usCompany.*" ->
  // "employer_usCompany_*" - see l1a.js's fieldCatalog()), so these Part 1
  // petitioner-address edges do NOT resolve for an L-1A case even though
  // company.name (this file's very next edge) does (it's canonical, not
  // raw.questionnaireAnswers-keyed). Not fixed here: MappingResolver only
  // resolves a single source path per edge (no fallback list), and
  // MappingResolver/FormMappingService are out of scope to modify per this
  // file's own established constraint (see the checkboxMatch() comment
  // above) - renaming l1a.js's paths to match h1b.js's "company" convention
  // would also be a breaking change to any already-answered L-1A
  // questionnaire data. Flagging for a follow-up rather than guessing at
  // either fix. l1a-golden-path.test.js accordingly does NOT assert
  // Part 1 petitioner-address autofill for its L-1A case.
  { fieldName: "form1[0].#subform[0].Line3_CompanyorOrgName[0]", source: "company.name", note: "Item 2, Company/Organization Name. Individual-petitioner Item 1 (Family/Given/Middle Name) is out_of_scope below - every case on this platform files as a company petitioner." },
  { fieldName: "form1[0].#subform[0].Line7b_StreetNumberName[0]", source: "raw.questionnaireAnswers.employer_company_address_street.value", note: "Item 3, mailing address street." },
  { fieldName: "form1[0].#subform[0].Line_CityTown[0]", source: "raw.questionnaireAnswers.employer_company_address_city.value", note: "Item 3, mailing address city." },
  { fieldName: "form1[0].#subform[0].P1_Line3_State[0]", source: "raw.questionnaireAnswers.employer_company_address_state.value", note: "Item 3, mailing address state." },
  { fieldName: "form1[0].#subform[0].P1_Line3_ZipCode[0]", source: "raw.questionnaireAnswers.employer_company_address_zipCode.value", note: "Item 3, mailing address ZIP." },
  { fieldName: "form1[0].#subform[0].P1_Line3_Country[0]", source: "raw.questionnaireAnswers.employer_company_address_country.value", note: "Item 3, mailing address country." },
  { fieldName: "form1[0].#subform[0].Line2_DaytimePhoneNumber1_Part8[0]", source: "raw.questionnaireAnswers.employer_company_daytimePhone.value", transform: { type: "phone" }, note: "Item 4, daytime phone. Phase 4 (§I.3): (xxx) xxx-xxxx - confirmed to fit this widget's real validationRules (maxLength 15, regex allows digits/()/-/space) before wiring." },

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
  // Item 2, "Beneficiary's Highest Level of Education" - 9 independent
  // checkbox widgets (select only one), NOT a single dropdown/text field -
  // confirmed by opening the real seeded I-129 PDF with pdf-lib (normalized
  // via normalizePdf, same as every other pdf-lib-verified note in this
  // file) and reading each widget's own tooltip (/TU) text plus its
  // AcroForm appearance-dictionary keys (the real onValue). Unlike the
  // WageLevelBox edges above, every one of these 9 onValues was individually
  // read from the PDF, not assumed:
  //   a_no_diploma[0]         -> onValue "/1"  (Check A. No Diploma)
  //   b_HSDiploma[0]          -> onValue "/1"  (Check B. High School Graduate Diploma or the equivalent)
  //   c_some_college[0]       -> onValue "/1"  (Check C. Some college credit, but less than 1 year)
  //   d_collegeplus[0]        -> onValue "/1"  (Check D. One or more years of college, no degree)
  //   e_AssociateDegree[0]    -> onValue "/1"  (Check E. Associate's degree)
  //   f_BachelorDegree[0]     -> onValue "/1"  (Check F. Bachelor's degree)
  //   g_MasterDegree[0]       -> onValue "/1"  (Check G. Master's degree)
  //   h_ProfessionalDegree[0] -> onValue "/1"  (Check H. Professional degree)
  //   i_DoctorateDegree[0]    -> onValue "/1"  (Check I. Doctorate degree)
  // All 9 share the literal onValue "/1" (each is its own independent
  // checkbox field, not one radio-button group with distinct per-choice
  // export values) - MappingResolver's {type:"boolean"} transform only
  // needs true/false per the condition match below; pdf-lib's own render
  // step checks/unchecks using each widget's real onValue automatically.
  //
  // Source: raw.questionnaireAnswers.employee_education_highestLevel.value -
  // traced via field-mapping.registry.js's FIELD_MAPPINGS.resume.educationHighestLevel
  // candidate keys -> deterministicAnswerMatches/semantic-field-matcher's
  // answer catalog (built from the real employee_education_highestLevel
  // Question the h1b_employee_checklist generates from this same visa
  // definition's fieldCatalog) -> questionnaireService.saveAnswers, which
  // lands the value as a real Answer with questionKey
  // "employee_education_highestLevel" - the same raw.questionnaireAnswers.*
  // convention every other employee_education_* edge above already uses.
  // Each condition accepts BOTH deriveEducationScalarFields' own enum token
  // (extraction-mapping.service.js, e.g. "masters") and the plain-English
  // label a human might type directly into this still-free-text checklist
  // field (e.g. "Master's degree") - see checkboxMatch()'s array-value note.
  { fieldName: "form1[0].#subform[22].a_no_diploma[0]", source: "raw.questionnaireAnswers.employee_education_highestLevel.value", ...checkboxMatch("raw.questionnaireAnswers.employee_education_highestLevel.value", ["no_diploma", "No Diploma"]), note: "Item 2, Highest Level of Education - Check A. No Diploma." },
  { fieldName: "form1[0].#subform[22].b_HSDiploma[0]", source: "raw.questionnaireAnswers.employee_education_highestLevel.value", ...checkboxMatch("raw.questionnaireAnswers.employee_education_highestLevel.value", ["high_school", "High School Diploma", "High School Graduate Diploma", "High School Graduate Diploma or the equivalent", "GED"]), note: "Item 2, Highest Level of Education - Check B. High School Graduate Diploma or the equivalent." },
  { fieldName: "form1[0].#subform[22].c_some_college[0]", source: "raw.questionnaireAnswers.employee_education_highestLevel.value", ...checkboxMatch("raw.questionnaireAnswers.employee_education_highestLevel.value", ["some_college", "Some College", "Some college credit, but less than 1 year"]), note: "Item 2, Highest Level of Education - Check C. Some college credit, but less than 1 year." },
  { fieldName: "form1[0].#subform[22].d_collegeplus[0]", source: "raw.questionnaireAnswers.employee_education_highestLevel.value", ...checkboxMatch("raw.questionnaireAnswers.employee_education_highestLevel.value", ["college_no_degree", "One or more years of college, no degree", "College, No Degree"]), note: "Item 2, Highest Level of Education - Check D. One or more years of college, no degree." },
  { fieldName: "form1[0].#subform[22].e_AssociateDegree[0]", source: "raw.questionnaireAnswers.employee_education_highestLevel.value", ...checkboxMatch("raw.questionnaireAnswers.employee_education_highestLevel.value", ["associates", "Associate's degree", "Associate's Degree"]), note: "Item 2, Highest Level of Education - Check E. Associate's degree." },
  { fieldName: "form1[0].#subform[22].f_BachelorDegree[0]", source: "raw.questionnaireAnswers.employee_education_highestLevel.value", ...checkboxMatch("raw.questionnaireAnswers.employee_education_highestLevel.value", ["bachelors", "Bachelor's degree", "Bachelor's Degree"]), note: "Item 2, Highest Level of Education - Check F. Bachelor's degree." },
  { fieldName: "form1[0].#subform[22].g_MasterDegree[0]", source: "raw.questionnaireAnswers.employee_education_highestLevel.value", ...checkboxMatch("raw.questionnaireAnswers.employee_education_highestLevel.value", ["masters", "Master's degree", "Master's Degree"]), note: "Item 2, Highest Level of Education - Check G. Master's degree." },
  { fieldName: "form1[0].#subform[22].h_ProfessionalDegree[0]", source: "raw.questionnaireAnswers.employee_education_highestLevel.value", ...checkboxMatch("raw.questionnaireAnswers.employee_education_highestLevel.value", ["professional", "Professional degree", "Professional Degree"]), note: "Item 2, Highest Level of Education - Check H. Professional degree." },
  { fieldName: "form1[0].#subform[22].i_DoctorateDegree[0]", source: "raw.questionnaireAnswers.employee_education_highestLevel.value", ...checkboxMatch("raw.questionnaireAnswers.employee_education_highestLevel.value", ["doctorate", "Doctorate degree", "Doctorate Degree", "Doctorate"]), note: "Item 2, Highest Level of Education - Check I. Doctorate degree." },
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

  // --- L Classification Supplement (pages 24-27) — added for L-1A/L-1B. Page
  // numbers and field names verified empirically against the real seeded
  // I-129 template (same standard as every other section in this file):
  // pdf-lib widget->page mapping, normalized via the same qpdf pipeline
  // USCISFormImporterService uses, not assumed from the printed form's own
  // page numbers or from l1a.js's own field ordering. Sourced from
  // employment-workflow/questionnaires/l1a.js's fieldCatalog() (employer.*
  // paths, no canonicalPath, resolved via raw.questionnaireAnswers.* the
  // same way h1b.js's employer.* fields are - see this file's header note).
  { fieldName: "form1[0].#subform[25].a_L1A[0]", source: "case.visaType", ...checkboxMatch("case.visaType", "L-1A"), note: "L Classification Supplement Item 3, L-1A Managerial or Executive Capacity - the classification this platform's l1a.js questionnaire targets. Sourced from case.visaType, same pattern as the H-1B Item 4a edge above." },
  { fieldName: "form1[0].#subform[25].b_L1B[0]", source: "case.visaType", ...checkboxMatch("case.visaType", "L-1B"), note: "Item 3, L-1B Specialized Knowledge widget. Mapped for template completeness (I-129's visaTypes includes L-1B) even though l1a.js's own questionnaire content targets L-1A specifically - resolves to false for an L-1A case, as intended." },
  { fieldName: "form1[0].#subform[25].HSupLine2_FamilyName[0]", source: "person.lastName", note: "Beneficiary family name header repeated on this supplement page. Field name inherited an 'HSup' prefix from template authoring (this widget is NOT on an H supplement page - verified via pdf-lib page mapping, it's page 24, inside the L Classification Supplement) - a template-authoring artifact, not a mapping error." },
  { fieldName: "form1[0].#subform[25].Line1_FamilyName[4]", source: "person.lastName", note: "Same beneficiary family name header, a second repeated widget instance on this page (index [4] = 5th occurrence of this field name across the whole form)." },
  { fieldName: "form1[0].#subform[25].LSuppLine3_NameofEmployerAbroad[0]", source: "raw.questionnaireAnswers.employer_foreignCompany_name.value", note: "Item, name of employer abroad." },
  { fieldName: "form1[0].#subform[25].Part3Line2_StreetName[0]", source: "raw.questionnaireAnswers.employer_foreignCompany_address_street.value", note: "Address of employer abroad - street." },
  { fieldName: "form1[0].#subform[25].Part3Line2_City[0]", source: "raw.questionnaireAnswers.employer_foreignCompany_address_city.value", note: "Address of employer abroad - city." },
  { fieldName: "form1[0].#subform[25].Part3Line2_Country[0]", source: "raw.questionnaireAnswers.employer_foreignCompany_address_country.value", note: "Address of employer abroad - country." },
  // l1a.js stores one combined stateProvince/zipPostalCode pair (no separate
  // US-format vs international-format split) - mapped to the
  // Province/PostalCode widgets since the foreign company is, by
  // definition, outside the US. The parallel State/ZipCode widgets on this
  // same line are left manual_entry rather than double-mapped to the same
  // source (which field the real form intends for which format is not
  // derivable from the field name alone).
  { fieldName: "form1[0].#subform[25].Part3Line2_Province[0]", source: "raw.questionnaireAnswers.employer_foreignCompany_address_stateProvince.value", note: "Address of employer abroad - state/province." },
  { fieldName: "form1[0].#subform[25].Part3Line2_PostalCode[0]", source: "raw.questionnaireAnswers.employer_foreignCompany_address_zipPostalCode.value", note: "Address of employer abroad - zip/postal code." },
  // Table 2 (3-year employment-abroad history): only Row 1's date range has a
  // confident single-value source (the one qualifying foreign employment
  // period l1a.js collects); the position/title column and additional rows
  // have no corresponding l1a.js field and are manual_entry below.
  { fieldName: "form1[0].#subform[25].Table2[0].Row1[0].DateFrom_line1[0]", source: "raw.questionnaireAnswers.employer_foreignCompany_employmentStartDate.value", transform: { type: "date", format: "mm/dd/yyyy" }, note: "Row 1, qualifying foreign employment start date." },
  { fieldName: "form1[0].#subform[25].Table2[0].Row1[0].DateTo_line1[0]", source: "raw.questionnaireAnswers.employer_foreignCompany_employmentEndDate.value", transform: { type: "date", format: "mm/dd/yyyy" }, note: "Row 1, qualifying foreign employment end date." },
  // Relationship-type checkboxes (page 25) - direct match to l1a.js's own
  // RELATIONSHIP_TYPES enum (Parent/Branch/Subsidiary/Affiliate/Joint
  // Venture), a high-confidence mapping.
  { fieldName: "form1[0].#subform[27].a_Parent[0]", source: "raw.questionnaireAnswers.employer_foreignCompany_relationshipType.value", ...checkboxMatch("raw.questionnaireAnswers.employer_foreignCompany_relationshipType.value", "Parent"), note: "US/foreign company relationship - Parent widget." },
  { fieldName: "form1[0].#subform[27].b_Branch[0]", source: "raw.questionnaireAnswers.employer_foreignCompany_relationshipType.value", ...checkboxMatch("raw.questionnaireAnswers.employer_foreignCompany_relationshipType.value", "Branch"), note: "US/foreign company relationship - Branch widget." },
  { fieldName: "form1[0].#subform[27].c_Subsidiary[0]", source: "raw.questionnaireAnswers.employer_foreignCompany_relationshipType.value", ...checkboxMatch("raw.questionnaireAnswers.employer_foreignCompany_relationshipType.value", "Subsidiary"), note: "US/foreign company relationship - Subsidiary widget." },
  { fieldName: "form1[0].#subform[27].d_Affiliate[0]", source: "raw.questionnaireAnswers.employer_foreignCompany_relationshipType.value", ...checkboxMatch("raw.questionnaireAnswers.employer_foreignCompany_relationshipType.value", "Affiliate"), note: "US/foreign company relationship - Affiliate widget." },
  { fieldName: "form1[0].#subform[27].e_JointVenture[0]", source: "raw.questionnaireAnswers.employer_foreignCompany_relationshipType.value", ...checkboxMatch("raw.questionnaireAnswers.employer_foreignCompany_relationshipType.value", "Joint Venture"), note: "US/foreign company relationship - Joint Venture widget." },
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
    // --- L Classification Supplement additions ---
    "form1[0].#subform[25].LSuppLine4a[0]", "form1[0].#subform[25].LSuppLine4a[1]", "form1[0].#subform[25].LSuppLine4b_Yes[0]", "form1[0].#subform[25].LSuppLine4b_No[0]", // "new office" petition question - l1a.js has no corresponding boolean field despite the business plan checklist being conditioned on requiresNewOfficePetition
    "form1[0].#subform[25].Line2_AptSteFlrNumber[0]", "form1[0].#subform[25].LClassLine4_Unit[0]", "form1[0].#subform[25].LClassLine4_Unit[1]", "form1[0].#subform[25].LClassLine4_Unit[2]", // employer-abroad address apt/ste/flr - not collected by l1a.js
    // Table 2 (3-year employment-abroad history): position/title column and
    // rows 2-4 - l1a.js only collects a single qualifying employment period
    // (mapped to Row 1's dates above), not a title or additional positions.
    "form1[0].#subform[25].Table2[0].Row1[0].Sect1_Name_Line1[0]",
    "form1[0].#subform[25].Table2[0].Row2[0].Sect1_Name_Line2[0]", "form1[0].#subform[25].Table2[0].Row2[0].DateFrom_line2[0]", "form1[0].#subform[25].Table2[0].Row2[0].DateTo_line2[0]",
    "form1[0].#subform[25].Table2[0].Row3[0].Sect1_Name_Line3[0]", "form1[0].#subform[25].Table2[0].Row3[0].DateFrom_line3[0]", "form1[0].#subform[25].Table2[0].Row3[0].DateTo_line3[0]",
    "form1[0].#subform[25].Table2[0].Row4[0].Sect1_Name_Line3[0]", "form1[0].#subform[25].Table2[0].Row4[0].DateFrom_line3[0]", "form1[0].#subform[25].Table2[0].Row4[0].DateTo_line3[0]",
    "form1[0].#subform[25].Table2[0].Row4[1].Sect1_Name_Line3[0]", "form1[0].#subform[25].Table2[0].Row4[1].DateFrom_line3[0]", "form1[0].#subform[25].Table2[0].Row4[1].DateTo_line3[0]",
    "form1[0].#subform[25].Table2[0].Row4[2].Sect1_Name_Line3[0]", "form1[0].#subform[25].Table2[0].Row4[2].DateFrom_line3[0]", "form1[0].#subform[25].Table2[0].Row4[2].DateTo_line3[0]",
    "form1[0].#subform[25].Table2[0].Row4[3].Sect1_Name_Line3[0]", "form1[0].#subform[25].Table2[0].Row4[3].DateFrom_line3[0]", "form1[0].#subform[25].Table2[0].Row4[3].DateTo_line3[0]",
    // Job-description free-text field(s) spanning pages 24-26 - exact prompt
    // not verified from field name alone (unlike the rest of this file's
    // mapped edges, no golden-case run confirmed what this field asks for);
    // left manual rather than guessing which l1a.js narrative field fits.
    "form1[0].#subform[27].Line3_JobDescription[1]", "form1[0].#subform[27].Line3_JobDescription[2]", "form1[0].#subform[27].Line3_JobDescription[3]",
    "form1[0].#subform[29].Line3_JobDescription[4]", "form1[0].#subform[29].Line3_JobDescription[5]",
    // Table 3 (page 25) - purpose not derivable from field names alone
    // (DateFrom/DateTo/Explanation per row); no confident l1a.js source.
    "form1[0].#subform[27].Table3[0].Row1[0].q5_DateFrom_Line1[0]", "form1[0].#subform[27].Table3[0].Row1[0].q5_DateTo_Line1[0]", "form1[0].#subform[27].Table3[0].Row1[0].q5_Explanation_Line1[0]",
    "form1[0].#subform[27].Table3[0].Row2[0].q5_DateFrom_Line2[0]", "form1[0].#subform[27].Table3[0].Row2[0].q5_DateTo_Line2[0]", "form1[0].#subform[27].Table3[0].Row2[0].q5_Explanation_Line2[0]",
    "form1[0].#subform[27].Table3[0].Row3[0].q5_DateFrom_Line3[0]", "form1[0].#subform[27].Table3[0].Row3[0].q5_DateTo_Line3[0]", "form1[0].#subform[27].Table3[0].Row3[0].q5_Explanation_Line3[0]",
    "form1[0].#subform[27].Table3[0].Row4[0].q5_DateFrom_Line4[0]", "form1[0].#subform[27].Table3[0].Row4[0].q5_DateTo_Line4[0]", "form1[0].#subform[27].Table3[0].Row4[0].q5_Explanation_Line4[0]",
    "form1[0].#subform[27].Table3[0].Row4[1].q5_DateFrom_Line5[0]", "form1[0].#subform[27].Table3[0].Row4[1].q5_DateTo_Line5[0]", "form1[0].#subform[27].Table3[0].Row4[1].q5_Explanation_Line5[0]",
    "form1[0].#subform[27].Table3[0].Row4[2].q5_DateFrom_Line6[0]", "form1[0].#subform[27].Table3[0].Row4[2].q5_DateTo_Line6[0]", "form1[0].#subform[27].Table3[0].Row4[2].q5_Explanation_Line6[0]",
  ],
  // Ambiguous field-name collisions where guessing wrong risks
  // cross-contamination or a wrong legal determination - explicitly deferred
  // to visual verification (see the Phase H1 report's attorney-review list)
  // rather than mapped.
  "ambiguous_requires_visual_verification": [
    "form1[0].#subform[1].previouschange[0]", // could also represent "H1B Extension" - see the `continuation` edge's note
    "form1[0].#subform[2].Line11e_ExpDate[0]", "form1[0].#subform[2].Line11e_ExpDate[1]", // two identically-named widgets near the passport block; Line11h already unambiguously covers status-expiry, so these are very likely both passport issue/expiry, but which is which is not derivable from the field name alone
    "form1[0].#subform[2].P3Line1_Checkbox[0]", "form1[0].#subform[2].P3Line1_Checkbox[1]", // "Named"/"Unnamed" - onValues (/N, /Y) don't unambiguously confirm which widget is which
    "form1[0].#subform[25].Part3Line2_State[0]", "form1[0].#subform[25].Part3Line2_ZipCode[0]", // parallel US-format address widgets alongside the mapped Province/PostalCode fields on the same line - see that edge's note
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
  if (L_BLANKET_OUT_OF_SCOPE_FIELDS.has(fieldName)) {
    return { status: "out_of_scope", note: "L Classification Supplement blanket-petition field - this platform models individual L-1A/L-1B petitions only (one US company, one foreign company)." };
  }
  if (MANUAL_ENTRY_SET.has(fieldName)) return { status: "manual_entry", note: "See crosswalk MANUAL_ENTRY_FIELDS for the specific reason." };
  if (!isInScopePage(field.pageNumber)) {
    return { status: "out_of_scope", note: "Belongs to a different classification/supplement (E-1/E-2, Trade Agreement, H-2A/H-2B/H-3, O/P, Q-1, R-1, or the multi-beneficiary Attachment-1) - not applicable to an H-1B or L-1A/L-1B petition." };
  }
  return { status: "manual_entry", note: "In-scope H-1B/L-1A field without an individually authored source. Defaulted to manual_entry rather than left ambiguous - case manager completes at review; flag for a future crosswalk revision if a canonical source should be added." };
}

module.exports = {
  OUT_OF_SCOPE_PAGES,
  L_BLANKET_OUT_OF_SCOPE_FIELDS,
  USCIS_USE_ONLY_PATTERNS,
  MAPPED_EDGES,
  MANUAL_ENTRY_FIELDS,
  classifyField,
};
