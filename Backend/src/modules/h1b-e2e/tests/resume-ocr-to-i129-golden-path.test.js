// The proof-of-work for the resume-OCR -> I-129 autofill pipeline: a real
// seeded H-1B case, a REAL synthetic resume PDF, run through the REAL
// extractor-router -> resume-extractor -> DTO -> validator ->
// deriveEducationScalarFields -> semantic-field-matcher (LLM path forced to
// fail/empty) -> heuristic fallback -> real answer-write/masterDataPrefill
// routing -> AutoFillService -> PDFGenerationService, then re-opened with
// pdf-lib to assert the H-1B Data Collection Supplement's Master's-degree
// checkbox and text fields are actually filled, with OCR provenance traced
// back to the source Answer. Follows h1b-golden-path.test.js's real-database
// pattern (test-utils/db.js) - a dedicated local test DB, not the app's own
// connection.
//
// The ONLY stub in this file is providerRegistry.generateStructuredJson -
// the one real network call this suite can't reproduce deterministically in
// CI. It is prompt-aware (see fakeProviderResponse below): it returns a
// fixed, plausible resume/passport extraction for the extractor prompts, and
// returns nothing usable for the semantic-matcher's own matching prompt -
// deliberately, so this suite exercises the real LLM-failure fallback path
// (Task 3's heuristicFallbackMatch) instead of a mocked "matcher already
// solved it" shortcut. Extraction, DTO normalization, validation, education
// derivation, matching, answer-writing, masterDataPrefill routing, autofill,
// and PDF generation are all real code, real DB writes.
const assert = require("node:assert/strict");
const test = require("node:test");
const { PDFDocument, StandardFonts } = require("pdf-lib");
const { connectTestDB, disconnectTestDB } = require("../../../test-utils/db");
const { BASE, employerAnswers, employeeAnswers } = require("../../../test-utils/fixtures/h1b-golden");

const Case = require("../../../models/Case");
const CaseForm = require("../../../models/CaseForm");
const Document = require("../../../models/Document");
const DocumentExtraction = require("../../../models/DocumentExtraction");
const USCISFormTemplate = require("../../../models/USCISFormTemplate");
const Questionnaire = require("../../../models/Questionnaire");
const Answer = require("../../../models/Answer");
const User = require("../../../models/User");
const Beneficiary = require("../../../models/Beneficiary");
const Company = require("../../../models/Company");

const questionnaireService = require("../../questionnaires/questionnaire.service");
const uscisFormService = require("../../uscis-forms/uscis-form.service");
const AutoFillService = require("../../form-mapping/services/AutoFillService");
const MappingResolver = require("../../form-mapping/services/MappingResolver");
const InteractiveFormReviewService = require("../../uscis-forms/interactive-form-review.service");
const PDFGenerationService = require("../../form-generation/services/PDFGenerationService");
const storageService = require("../../uploads/storage.service");

const seedI129H1bMapping = require("../../form-mapping/seeds/i129-h1b-mapping.seed");
const providerRegistry = require("../../document-intelligence/providers/document-intelligence-provider.registry");
const extractorRouter = require("../../document-intelligence/extractors/extractor-router.service");
const { toFieldExtractions } = require("../../document-intelligence/validators/extraction.validator");
const extractionMappingService = require("../../document-intelligence/services/extraction-mapping.service");
const semanticFieldMatcher = require("../../document-intelligence/services/semantic-field-matcher.service");
const documentIntelligenceService = require("../../document-intelligence/services/document-intelligence.service");
const repository = require("../../document-intelligence/repositories/document-intelligence.repository");

// --- Deterministic stand-in for the provider call ------------------------
// This is a stand-in for the LLM response ONLY - it does not skip
// extraction/DTO/validation/matching logic, all of which run for real
// against whatever this function returns. Routed by prompt content, not by
// call order, so it works regardless of which extractor/matcher calls it
// first.
const RESUME_TEXT = [
  "Apratim De",
  "Master of Business Administration, XYZ University, 2019",
  "Software Engineer, Initech Solutions, 2019-06-01 to Present",
].join("\n");

function fakeProviderResponse(prompt = "") {
  if (prompt.includes("extracting structured career history from a resume")) {
    return {
      fields: {
        education: {
          value: [{ institution: "XYZ University", degreeType: "masters", major: "Business Administration", awardDate: "2019-01-01", confidence: 91 }],
          confidence: 91,
        },
        employment: {
          value: [{ employer: "Initech Solutions", title: "Software Engineer", startDate: "2019-06-01", current: true, duties: "Backend services", confidence: 88 }],
          confidence: 88,
        },
        skills: { value: ["Node.js", "SQL"], confidence: 80 },
      },
      rawText: RESUME_TEXT,
      overallConfidence: 88,
    };
  }
  if (prompt.includes("extracting data from a passport")) {
    return {
      fields: {
        dateOfBirth: { value: BASE.beneficiary.dateOfBirth, confidence: 95 },
        passportNumber: { value: BASE.beneficiary.passportNumber, confidence: 97 },
      },
      rawText: "MOCK PASSPORT MRZ",
      overallConfidence: 95,
    };
  }
  // The semantic-field-matcher's own matching prompt (and anything else) -
  // deliberately returns nothing usable, so matchFields() must fall through
  // to the heuristic fallback (Task 3) being proven here.
  return {};
}

async function buildResumePdfBuffer() {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([612, 792]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  RESUME_TEXT.split("\n").forEach((line, index) => {
    page.drawText(line, { x: 50, y: 700 - index * 24, size: 14, font });
  });
  return Buffer.from(await pdf.save());
}

async function createRealDocument({ caseId, userId, documentType, buffer, name }) {
  const key = storageService.generateDocumentKey({ caseId, userId, originalName: name });
  const stored = await storageService.storeBuffer(key, buffer);
  return Document.create({
    user: userId, caseId, category: "evidence", documentType, reviewStatus: "pending",
    description: name, originalName: name, originalFileName: name,
    storedName: key.split("/").pop(), fileName: key.split("/").pop(), mimeType: "application/pdf", fileType: "application/pdf",
    size: buffer.length, fileSize: buffer.length, filePath: stored.path, documentUrl: stored.url,
    storageProvider: stored.provider, storageKey: stored.key, checksum: stored.checksum, uploadedBy: "system", uploadedByUser: userId,
    legacySource: "shared",
  });
}

// Mirrors document-intelligence.service.js's own processDocument extraction
// stage exactly (classification is skipped - out of scope per the task,
// which names extractor-router -> resume-extractor -> DTO -> validator
// specifically), so the resulting DocumentExtraction record is
// structurally real, not a hand-rolled shape.
async function runRealExtraction({ document, buffer, documentType }) {
  const extracted = await extractorRouter.extract({ document, buffer, documentType });
  const fields = toFieldExtractions(extracted.fields, document._id, extracted.evidenceCategories?.[0]);
  const extraction = await repository.upsertForDocument(document, {
    status: "validating",
    documentType,
    rawText: extracted.rawText,
    rawExtraction: extracted.raw,
    structuredEntities: extracted.entities,
    extractedData: fields,
    evidenceCategories: extracted.evidenceCategories,
    confidence: extracted.overallConfidence,
  });
  return { extraction, fields };
}

let caseId, userId, beneficiaryId, companyId;
const documentIds = [];
const req = { ip: "127.0.0.1", headers: {} };
const actingUser = () => ({ _id: userId, role: "client" });
const teamLead = () => ({ _id: userId, role: "team_lead" });
const caseManager = () => ({ _id: userId, role: "case_manager" });

const originalGenerateStructuredJson = providerRegistry.generateStructuredJson;

test.before(async () => {
  await connectTestDB();
  providerRegistry.generateStructuredJson = async ({ prompt } = {}) => fakeProviderResponse(prompt);
  // The mapping graph is a versioned, checksummed snapshot of
  // i129-h1b-crosswalk.js (see USCISMappingVersion) - re-seeding is
  // idempotent (a no-op if the checksum already matches) but required at
  // least once per crosswalk change against whichever DB is under test, so
  // Task 2's new checkboxes are actually present in the graph this suite's
  // AutoFillService.generate() reads from, rather than a stale pre-Task-2
  // version.
  await seedI129H1bMapping({});
});

test.after(async () => {
  providerRegistry.generateStructuredJson = originalGenerateStructuredJson;
  if (caseId) {
    await CaseForm.deleteMany({ caseId });
    await Document.deleteMany({ caseId });
    await DocumentExtraction.deleteMany({ caseId });
    await Answer.deleteMany({ caseId });
    await Case.deleteOne({ _id: caseId });
  }
  if (beneficiaryId) await Beneficiary.deleteOne({ _id: beneficiaryId });
  if (companyId) await Company.deleteOne({ _id: companyId });
  if (userId) await User.deleteOne({ _id: userId });
  await disconnectTestDB();
});

test("resume OCR -> I-129 golden path: extraction, derivation, fallback matching, review acceptance, autofill, PDF", async () => {
  // --- Case setup: same golden fixture h1b-golden-path.test.js uses, minus
  // the fields this suite must prove come from OCR instead (education
  // entirely; dateOfBirth/passportNumber for the shorter passport block). ---
  const user = await User.create({ email: `resume-ocr-e2e-${Date.now()}@example.com`, password: "not-a-real-hash-1234", name: `${BASE.beneficiary.firstName} ${BASE.beneficiary.lastName}`, role: "client" });
  userId = user._id;
  const beneficiary = await Beneficiary.create({ user: user._id, firstName: BASE.beneficiary.firstName, lastName: BASE.beneficiary.lastName, alienRegistrationNumber: "" });
  beneficiaryId = beneficiary._id;
  const company = await Company.create({ name: BASE.petitioner.legalName, ein: BASE.petitioner.fein });
  companyId = company._id;
  const caseDoc = await Case.create({ caseNumber: `RESUME-OCR-E2E-${Date.now()}`, visaType: BASE.visaType, user: user._id, beneficiary: beneficiary._id, companyId: company._id, status: "active" });
  caseId = caseDoc._id;

  await questionnaireService.ensureDefaultVisaTemplates(null, null, { force: true });
  const employerQ = await Questionnaire.findOne({ key: "h1b_employer_checklist", latestVersion: true });
  const employeeQ = await Questionnaire.findOne({ key: "h1b_employee_checklist", latestVersion: true });
  await questionnaireService.saveAnswers({
    questionnaireId: employerQ._id,
    caseId,
    answers: Object.entries(employerAnswers()).map(([questionKey, value]) => ({ questionKey, value })),
  }, actingUser(), req, "submitted");

  // Strip education AND the two passport-identity fields this test proves
  // come from OCR - "do NOT seed employee education answers directly" per
  // the task, extended to dateOfBirth/passportNumber so the passport block
  // (below) has something real to prove too, not a coincidental match
  // against data that was already there.
  const fullEmployeeAnswers = employeeAnswers();
  const {
    employee_education_highestLevel, employee_education_majorFieldOfStudy, employee_education_hasUsMastersOrHigher,
    employee_education_usInstitutionName, employee_education_degreeAwardDate, employee_education_degreeType,
    employee_personal_dateOfBirth, employee_personal_passportNumber,
    ...employeeAnswersWithoutOcrFields
  } = fullEmployeeAnswers;
  await questionnaireService.saveAnswers({
    questionnaireId: employeeQ._id,
    caseId,
    answers: Object.entries(employeeAnswersWithoutOcrFields).map(([questionKey, value]) => ({ questionKey, value })),
  }, actingUser(), req, "submitted");

  // --- Step 1-2: real resume PDF, through the REAL extractor pipeline ---
  const resumeBuffer = await buildResumePdfBuffer();
  const resumeDocument = await createRealDocument({ caseId, userId, documentType: "resume", buffer: resumeBuffer, name: "resume.pdf" });
  documentIds.push(resumeDocument._id);
  const { extraction: resumeExtraction, fields: resumeFields } = await runRealExtraction({ document: resumeDocument, buffer: resumeBuffer, documentType: "resume" });

  assert.equal(resumeFields.find((f) => f.key === "education").value[0].institution, "XYZ University", "real extraction must have run (DTO output present)");
  assert.equal(resumeFields.find((f) => f.key === "education").value[0].degreeType, "masters");

  // deriveEducationScalarFields (Task 1b), run exactly as
  // applyQuestionnairePrefill runs it for a resume/cv document type.
  const derivedFields = extractionMappingService.deriveEducationScalarFields(resumeFields);
  assert.ok(derivedFields.some((f) => f.key === "educationHighestLevel" && f.value === "masters"), "the primary (highest-ranked) entry must be projected to educationHighestLevel");
  const allResumeFields = [...resumeFields, ...derivedFields];

  // --- Step 3: semantic-field-matcher for real. The stubbed provider
  // returns {} for the matching prompt (no `matches`), so matchFields()
  // must fall through to Task 3's heuristic fallback internally. ---
  const resumeMatches = await semanticFieldMatcher.matchFields({ documentType: "resume", fields: allResumeFields, caseId });
  const educationLevelMatch = resumeMatches.find((m) => m.fieldKey === "educationHighestLevel");
  assert.ok(educationLevelMatch, "the heuristic fallback must have caught educationHighestLevel - the LLM path returned nothing usable");
  assert.equal(educationLevelMatch.matchMethod, "heuristic_fallback");
  assert.equal(educationLevelMatch.targetSystem, "answer", "ties between the duplicated answer/masterData catalog entries resolve to answer - see heuristicFallbackMatch's own comment");
  assert.equal(educationLevelMatch.targetPath, "employee_education_highestLevel");
  assert.ok(educationLevelMatch.combinedConfidence <= 65 && educationLevelMatch.combinedConfidence >= semanticFieldMatcher.MATCH_MIN_COMBINED_CONFIDENCE);

  const catalog = await semanticFieldMatcher.buildTargetCatalog(caseId);
  const labelByTarget = new Map(catalog.map((entry) => [`${entry.targetSystem}:${entry.targetPath}`, entry.label]));
  const fieldByKey = new Map(allResumeFields.map((field) => [field.key, field]));
  const enrichedResumeMatches = resumeMatches.map((match) => ({
    ...match,
    value: fieldByKey.get(match.fieldKey)?.value,
    label: labelByTarget.get(`${match.targetSystem}:${match.targetPath}`),
    sourceDocumentType: "resume",
    sourceDocumentId: resumeDocument._id,
  }));
  const answerMatches = enrichedResumeMatches.filter((m) => m.targetSystem === "answer");
  const masterDataMatchesFromFallback = enrichedResumeMatches.filter((m) => m.targetSystem === "masterData");
  assert.ok(answerMatches.length >= 1, "at least the education-level match must be answer-targeted");

  // --- Step 4a: the answer-targeted matches auto-save with OCR provenance
  // (document-intelligence.service.js's applyAnswerMatches, called via the
  // real applyQuestionnairePrefill - this is the SAME already-established
  // mechanism h2-autofill.test.js's AC3 proves for the passport path). ---
  const prefillExtraction = await repository.upsertForDocument(resumeDocument, {});
  const updatedExtraction = await documentIntelligenceService.applyQuestionnairePrefill(prefillExtraction, caseId, actingUser(), req);
  assert.ok(updatedExtraction.questionnairePrefill.some((item) => item.key === "employee_education_highestLevel" && item.applied), "the education-level answer must have been auto-saved");

  const highestLevelAnswer = await Answer.findOne({ caseId, questionKey: "employee_education_highestLevel" });
  assert.ok(highestLevelAnswer, "an Answer must exist for employee_education_highestLevel");
  assert.equal(highestLevelAnswer.value, "masters");
  assert.equal(highestLevelAnswer.mappingOutput?.sourceType, "ocr", "provenance must be traceable to OCR, not manual entry");

  const majorAnswer = await Answer.findOne({ caseId, questionKey: "employee_education_majorFieldOfStudy" });
  assert.ok(majorAnswer, "an Answer must exist for employee_education_majorFieldOfStudy");
  assert.equal(majorAnswer.value, "Business Administration");
  assert.equal(majorAnswer.mappingOutput?.sourceType, "ocr");

  const institutionAnswer = await Answer.findOne({ caseId, questionKey: "employee_education_usInstitutionName" });
  assert.equal(institutionAnswer?.value, "XYZ University");
  const awardDateAnswer = await Answer.findOne({ caseId, questionKey: "employee_education_degreeAwardDate" });
  assert.equal(awardDateAnswer?.value, "2019-01-01");

  // --- Step 4b: supplementary, explicit proof that reviewMasterDataField's
  // real acceptance mechanics work end-to-end (not a direct DB write).
  // Tracing the actual routing above showed education-scalar matches
  // resolve to the ANSWER system for this catalog (ties favor answer - see
  // heuristicFallbackMatch's own comment in semantic-field-matcher.service.js),
  // which is what really drives the PDF fields below via
  // raw.questionnaireAnswers.* - so this block deliberately exercises one of
  // the SAME case's genuine masterData catalog entries (not a fabricated
  // path) to prove the masterDataPrefill review queue itself, end-to-end,
  // using the real service functions. ---
  const masterDataMajorEntry = catalog.find((entry) => entry.targetSystem === "masterData" && entry.targetPath === "employee.education.majorFieldOfStudy");
  assert.ok(masterDataMajorEntry, "the case's real masterData catalog must contain employee.education.majorFieldOfStudy");
  const manualMasterDataMatch = {
    fieldKey: "educationMajorFieldOfStudy",
    targetSystem: "masterData",
    targetPath: masterDataMajorEntry.targetPath,
    matchConfidence: 65,
    combinedConfidence: 65,
    value: fieldByKey.get("educationMajorFieldOfStudy")?.value,
    label: masterDataMajorEntry.label,
    sourceDocumentType: "resume",
    sourceDocumentId: resumeDocument._id,
  };
  await extractionMappingService.applyExtractionMappings(updatedExtraction, actingUser(), req, { caseId, matches: [manualMasterDataMatch] });
  const caseWithPrefill = await Case.findById(caseId);
  const prefillEntry = caseWithPrefill.questionnaireData.masterDataPrefill.find((entry) => entry.path === "employee.education.majorFieldOfStudy");
  assert.ok(prefillEntry, "applyExtractionMappings must have queued a masterDataPrefill entry");
  assert.equal(prefillEntry.status, "pending");
  await documentIntelligenceService.reviewMasterDataField(caseId, prefillEntry._id, "accept", {}, actingUser(), req);
  const caseAfterAccept = await Case.findById(caseId);
  assert.equal(caseAfterAccept.questionnaireData.masterData?.employee?.education?.majorFieldOfStudy, "Business Administration", "reviewMasterDataField must write the accepted value into masterData, the same way a reviewer's click would");
  assert.equal(caseAfterAccept.questionnaireData.masterDataPrefill.find((e) => String(e._id) === String(prefillEntry._id)).status, "accepted");

  // --- Step 7 (shorter passport block): reuse passport-extractor as-is,
  // prove its output reaches the beneficiary identity fields. ---
  const passportBuffer = await buildResumePdfBuffer(); // content is irrelevant - extraction is stubbed at the provider layer, same as the resume block
  const passportDocument = await createRealDocument({ caseId, userId, documentType: "passport", buffer: passportBuffer, name: "passport.pdf" });
  documentIds.push(passportDocument._id);
  const { extraction: passportExtraction, fields: passportFields } = await runRealExtraction({ document: passportDocument, buffer: passportBuffer, documentType: "passport" });
  assert.equal(passportFields.find((f) => f.key === "passportNumber").value, BASE.beneficiary.passportNumber);
  const passportPrefillExtraction = await repository.upsertForDocument(passportDocument, {});
  await documentIntelligenceService.applyQuestionnairePrefill(passportPrefillExtraction, caseId, actingUser(), req);
  const dobAnswer = await Answer.findOne({ caseId, questionKey: "employee_personal_dateOfBirth" });
  const passportNumberAnswer = await Answer.findOne({ caseId, questionKey: "employee_personal_passportNumber" });
  assert.equal(dobAnswer?.value, BASE.beneficiary.dateOfBirth);
  assert.equal(dobAnswer?.mappingOutput?.sourceType, "ocr");
  assert.equal(passportNumberAnswer?.value, BASE.beneficiary.passportNumber);
  assert.equal(passportNumberAnswer?.mappingOutput?.sourceType, "ocr");

  // --- Step 5: form assignment + AutoFillService.generate (real) ---
  await uscisFormService.ensureAssignedForms(caseDoc, teamLead(), req);
  const { caseForm: aiFilled } = await AutoFillService.generate(caseId, "I-129", actingUser(), req);
  const template = await USCISFormTemplate.findById(aiFilled.formTemplateId).lean();
  const fieldNameToId = new Map(template.formFields.map((f) => [f.fieldName, f.fieldId]));
  const get = (fieldName) => MappingResolver.resolvePath(aiFilled.filledData, fieldNameToId.get(fieldName));
  // sourceAttribution is a FLAT map keyed by the literal fieldId string
  // (AutoFillService.mergeMappedFields does `sourceAttribution[fieldId] =
  // {...}`, a bracket assignment) - unlike filledData, which
  // MappingResolver.setPath builds as a genuinely NESTED object from the
  // same dotted fieldId. Using resolvePath here (nested traversal) would
  // silently return undefined; a direct bracket lookup is correct.
  const getAttribution = (fieldName) => aiFilled.sourceAttribution?.[fieldNameToId.get(fieldName)];

  // --- The concrete proof: Task 2's new checkbox edge is filled correctly ---
  assert.equal(get("form1[0].#subform[22].g_MasterDegree[0]"), true, "the Master's degree checkbox must be checked");
  assert.notEqual(get("form1[0].#subform[22].a_no_diploma[0]"), true, "only the matching checkbox may be checked");
  assert.notEqual(get("form1[0].#subform[22].f_BachelorDegree[0]"), true);
  assert.equal(get("form1[0].#subform[22].PartA_q3_Field_of_Study[0]"), "Business Administration");
  assert.equal(get("form1[0].#subform[24].H1bSec3Line3a_Name[0]"), "XYZ University");
  assert.equal(get("form1[0].#subform[24].H1bSec3Line3b_DateDegreeAwarded[0]"), "01/01/2019");

  // sourceAttribution proves the checkbox's value came from
  // raw.questionnaireAnswers.employee_education_highestLevel.value, which
  // (per the Answer-level assertion above) is itself marked
  // mappingOutput.sourceType === "ocr" - together, that is the chain of
  // evidence that OCR drove this value, not a coincidence of default data.
  const checkboxAttribution = getAttribution("form1[0].#subform[22].g_MasterDegree[0]");
  assert.equal(checkboxAttribution?.mappingUsed?.sourceField, "raw.questionnaireAnswers.employee_education_highestLevel.value");
  const fieldOfStudyAttribution = getAttribution("form1[0].#subform[22].PartA_q3_Field_of_Study[0]");
  assert.equal(fieldOfStudyAttribution?.mappingUsed?.sourceField, "raw.questionnaireAnswers.employee_education_majorFieldOfStudy.value");

  // Passport-derived beneficiary identity fields on the same generated form.
  assert.equal(get("form1[0].#subform[2].Line6_DateOfBirth[0]"), "07/28/1987");
  assert.equal(get("form1[0].#subform[2].Part3Line5_PassportorTravDoc[0]"), BASE.beneficiary.passportNumber);
  const dobAttribution = getAttribution("form1[0].#subform[2].Line6_DateOfBirth[0]");
  assert.equal(dobAttribution?.mappingUsed?.sourceField, "person.dob");

  // --- Step 6/8: approve (or stamp, same fallback h1b-golden-path.test.js
  // uses) then generate the real PDF and re-open it with pdf-lib ---
  let approved;
  try {
    approved = await InteractiveFormReviewService.formDecision(caseId, aiFilled._id, { action: "approve" }, teamLead(), req);
  } catch (error) {
    if (error.status !== 422) throw error;
    const caseFormDoc = await CaseForm.findById(aiFilled._id);
    caseFormDoc.status = "ready_for_pdf";
    caseFormDoc.approvedBy = userId;
    caseFormDoc.approvalDate = new Date();
    await caseFormDoc.save();
    approved = caseFormDoc;
  }
  assert.ok(["approved", "ready_for_pdf"].includes(approved.status));

  const generated = await PDFGenerationService.generate(aiFilled._id, caseManager(), req, {});
  const pdfBuffer = await storageService.readBuffer(generated.document.storageKey);
  const generatedPdf = await PDFDocument.load(pdfBuffer, { ignoreEncryption: true, updateMetadata: false });
  const form = generatedPdf.getForm();

  const masterCheckbox = form.getCheckBox("form1[0].#subform[22].g_MasterDegree[0]");
  assert.ok(masterCheckbox.isChecked(), "the rendered PDF's Master's degree checkbox must actually be checked");
  assert.equal(masterCheckbox.acroField.getWidgets()[0].getOnValue()?.toString(), "/1", "the checked onValue must match the confirmed /1 export value");
  assert.equal(form.getTextField("form1[0].#subform[22].PartA_q3_Field_of_Study[0]").getText(), "Business Administration");
  assert.equal(form.getTextField("form1[0].#subform[24].H1bSec3Line3a_Name[0]").getText(), "XYZ University");
  assert.equal(form.getTextField("form1[0].#subform[24].H1bSec3Line3b_DateDegreeAwarded[0]").getText(), "01/01/2019");
  assert.equal(form.getTextField("form1[0].#subform[2].Part3Line5_PassportorTravDoc[0]").getText(), BASE.beneficiary.passportNumber);
});
