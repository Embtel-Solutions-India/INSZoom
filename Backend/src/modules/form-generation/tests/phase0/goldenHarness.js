// Phase 0 golden-fixture capture harness. Additive-only: this file does not change any pipeline
// runtime file. It reuses the EXACT seeding pattern already proven by the existing
// h1b/l1a/k3-golden-path.test.js suites (Case.create + questionnaireService.saveAnswers against
// the real services), the EXACT fixture data already in Backend/src/test-utils/fixtures/*.js
// (field names come from real code, per the anti-invention rule in the Phase 0 task spec - never
// invented here), and runs the real, unmodified AutoFillService.generate + PDFGenerationService
// pipeline. Its only job is to CHARACTERIZE current output - correct or not - into a deterministic
// snapshot, not to assert correctness (that's what the *-golden-path.test.js files already do).
//
// Must be required before any module that reads Backend/src/config/env.js (storage.service.js in
// particular) so the harness's local-storage-path workaround (see docs/forms/PHASE0_RUN_JOURNAL.md
// "local environment quirk") takes effect at env.js's module-load time.
if (!process.env.LOCAL_STORAGE_PATH) {
  process.env.LOCAL_STORAGE_PATH = require("path").join(__dirname, "..", "..", "..", "..", "..", "storage");
}

const crypto = require("crypto");
const { PDFDocument } = require("pdf-lib");

const { connectTestDB } = require("../../../../test-utils/db");
const Case = require("../../../../models/Case");
const CaseForm = require("../../../../models/CaseForm");
const Document = require("../../../../models/Document");
const Answer = require("../../../../models/Answer");
const AuditLog = require("../../../../models/AuditLog");
const USCISFormTemplate = require("../../../../models/USCISFormTemplate");
const Questionnaire = require("../../../../models/Questionnaire");
const User = require("../../../../models/User");
const Beneficiary = require("../../../../models/Beneficiary");
const Company = require("../../../../models/Company");

const questionnaireService = require("../../../questionnaires/questionnaire.service");
const uscisFormService = require("../../../uscis-forms/uscis-form.service");
const AutoFillService = require("../../../form-mapping/services/AutoFillService");
const MappingResolver = require("../../../form-mapping/services/MappingResolver");
const PDFGenerationService = require("../../services/PDFGenerationService");
const InteractiveFormReviewService = require("../../../uscis-forms/interactive-form-review.service");
const storageService = require("../../../uploads/storage.service");

const h1b = require("../../../../test-utils/fixtures/h1b-golden");
const l1a = require("../../../../test-utils/fixtures/l1a-golden");
const k3 = require("../../../../test-utils/fixtures/k3-golden");

// Used only to pick a REPRESENTATIVE crosswalk-mapped field for the overrideExample capture
// below (e.g. beneficiary last name) instead of an incidental USCIS-internal field (barcode,
// page-numbering) that happens to have a value in filledData too.
const i129h1bCrosswalk = require("../../../form-mapping/config/i129-h1b-crosswalk");
const i130k3Crosswalk = require("../../../form-mapping/config/i130-k3-crosswalk");
const CROSSWALK_BY_VISA = { h1b: i129h1bCrosswalk, l1a: i129h1bCrosswalk, k3: i130k3Crosswalk };

const req = { ip: "127.0.0.1", headers: {} };

// Distinct email/case-number namespace from the existing golden-path e2e suites, so a Phase 0
// capture run never collides with (or is defeated by stale data left behind by) those suites -
// see the E11000 duplicate-key finding in PHASE0_RUN_JOURNAL.md.
const NS = "phase0-golden";

async function cleanupCase(ids) {
  const { caseId, userIds = [], beneficiaryId, companyId } = ids;
  if (caseId) {
    await CaseForm.deleteMany({ caseId });
    await Document.deleteMany({ caseId });
    await Answer.deleteMany({ caseId });
    await AuditLog.deleteMany({ entityId: caseId.toString() }).catch(() => null);
    await Case.deleteOne({ _id: caseId });
  }
  if (beneficiaryId) await Beneficiary.deleteOne({ _id: beneficiaryId });
  if (companyId) await Company.deleteOne({ _id: companyId });
  for (const userId of userIds) await User.deleteOne({ _id: userId });
}

// `ids` is mutated incrementally AS EACH RECORD IS CREATED (not returned only at the end) so
// that if seeding throws partway through - e.g. the "Not authorized to answer this questionnaire"
// race documented in phase0.golden.manual.js's header comment, which can leave a User created but
// the Case/Answers not yet written - the caller's cleanup still has every id it needs to remove.
// A cleanup that only ran on a fully-returned `ids` object would leak the User record on any
// mid-seed failure, which then collides (duplicate email) with the very next capture attempt.
async function seedH1B(ids) {
  const BASE = h1b.BASE;
  const user = await User.create({ email: `h1b.${NS}@example.com`, password: "not-a-real-hash", name: `${BASE.beneficiary.firstName} ${BASE.beneficiary.lastName}`, role: "client" });
  ids.userIds.push(user._id);
  const beneficiary = await Beneficiary.create({ user: user._id, firstName: BASE.beneficiary.firstName, lastName: BASE.beneficiary.lastName, dateOfBirth: BASE.beneficiary.dateOfBirth, alienRegistrationNumber: "" });
  ids.beneficiaryId = beneficiary._id;
  const company = await Company.create({ name: BASE.petitioner.legalName, ein: BASE.petitioner.fein });
  ids.companyId = company._id;
  const caseDoc = await Case.create({ caseNumber: `${BASE.caseNumber}-${NS}`, visaType: BASE.visaType, user: user._id, beneficiary: beneficiary._id, companyId: company._id, status: "active" });
  ids.caseId = caseDoc._id;
  const caseId = caseDoc._id;

  await questionnaireService.ensureDefaultVisaTemplates(null, null, { force: true });
  const employerQ = await Questionnaire.findOne({ key: "h1b_employer_checklist", latestVersion: true });
  const employeeQ = await Questionnaire.findOne({ key: "h1b_employee_checklist", latestVersion: true });
  await questionnaireService.saveAnswers({ questionnaireId: employerQ._id, caseId, answers: Object.entries(h1b.employerAnswers()).map(([questionKey, value]) => ({ questionKey, value })) }, { _id: user._id, role: "client" }, req, "submitted");
  await questionnaireService.saveAnswers({ questionnaireId: employeeQ._id, caseId, answers: Object.entries(h1b.employeeAnswers()).map(([questionKey, value]) => ({ questionKey, value })) }, { _id: user._id, role: "client" }, req, "submitted");

  await uscisFormService.ensureAssignedForms(caseDoc, { _id: user._id, role: "team_lead" }, req);

  return { caseId, formCode: "I-129", primaryUserId: user._id };
}

async function seedL1A(ids) {
  const BASE = l1a.BASE;
  const user = await User.create({ email: `l1a.${NS}@example.com`, password: "not-a-real-hash", name: `${BASE.beneficiary.firstName} ${BASE.beneficiary.lastName}`, role: "client" });
  ids.userIds.push(user._id);
  const beneficiary = await Beneficiary.create({ user: user._id, firstName: BASE.beneficiary.firstName, lastName: BASE.beneficiary.lastName, dateOfBirth: BASE.beneficiary.dateOfBirth, alienRegistrationNumber: "" });
  ids.beneficiaryId = beneficiary._id;
  const company = await Company.create({ name: BASE.usCompany.name, ein: BASE.usCompany.ein });
  ids.companyId = company._id;
  const caseDoc = await Case.create({ caseNumber: `${BASE.caseNumber}-${NS}`, visaType: BASE.visaType, user: user._id, beneficiary: beneficiary._id, companyId: company._id, status: "active" });
  ids.caseId = caseDoc._id;
  const caseId = caseDoc._id;

  await questionnaireService.ensureDefaultVisaTemplates(null, null, { force: true });
  const employerQ = await Questionnaire.findOne({ key: "l1a_employer_checklist", latestVersion: true });
  const employeeQ = await Questionnaire.findOne({ key: "l1a_employee_checklist", latestVersion: true });
  await questionnaireService.saveAnswers({ questionnaireId: employerQ._id, caseId, answers: Object.entries(l1a.employerAnswers()).map(([questionKey, value]) => ({ questionKey, value })) }, { _id: user._id, role: "client" }, req, "submitted");
  await questionnaireService.saveAnswers({ questionnaireId: employeeQ._id, caseId, answers: Object.entries(l1a.employeeAnswers()).map(([questionKey, value]) => ({ questionKey, value })) }, { _id: user._id, role: "client" }, req, "submitted");

  await uscisFormService.ensureAssignedForms(caseDoc, { _id: user._id, role: "team_lead" }, req);

  return { caseId, formCode: "I-129", primaryUserId: user._id };
}

async function seedK3(ids) {
  const BASE = k3.BASE;
  const petitionerUser = await User.create({ email: `k3-petitioner.${NS}@example.com`, password: "not-a-real-hash", name: `${BASE.petitioner.firstName} ${BASE.petitioner.lastName}`, role: "client" });
  ids.userIds.push(petitionerUser._id);
  const beneficiaryUser = await User.create({ email: `k3-beneficiary.${NS}@example.com`, password: "not-a-real-hash", name: `${BASE.beneficiary.firstName} ${BASE.beneficiary.lastName}`, role: "beneficiary" });
  ids.userIds.push(beneficiaryUser._id);
  const caseDoc = await Case.create({
    caseNumber: `${BASE.caseNumber}-${NS}`, visaType: BASE.visaType, caseType: "family",
    petitionerUser: petitionerUser._id, beneficiaryUser: beneficiaryUser._id, user: petitionerUser._id,
    status: "active",
  });
  ids.caseId = caseDoc._id;
  const caseId = caseDoc._id;

  await questionnaireService.ensureDefaultVisaTemplates(null, null, { force: true });
  const petitionerQ = await Questionnaire.findOne({ key: "k3_petitioner_checklist", latestVersion: true });
  const beneficiaryQ = await Questionnaire.findOne({ key: "k3_beneficiary_checklist", latestVersion: true });
  await questionnaireService.saveAnswers({ questionnaireId: petitionerQ._id, caseId, answers: Object.entries(k3.petitionerAnswers()).map(([questionKey, value]) => ({ questionKey, value })) }, { _id: petitionerUser._id, role: "client" }, req, "submitted");
  await questionnaireService.saveAnswers({ questionnaireId: beneficiaryQ._id, caseId, answers: Object.entries(k3.beneficiaryAnswers()).map(([questionKey, value]) => ({ questionKey, value })) }, { _id: beneficiaryUser._id, role: "beneficiary" }, req, "submitted");

  await uscisFormService.ensureAssignedForms(await Case.findById(caseId), { _id: petitionerUser._id, role: "team_lead" }, req);

  return { caseId, formCode: "I-130", primaryUserId: petitionerUser._id };
}

const SEEDERS = { h1b: seedH1B, l1a: seedL1A, k3: seedK3 };

// --- Determinism: strip wall-clock / volatile fields before anything is hashed or compared. ---
const VOLATILE_KEYS = new Set(["populatedAt", "populationTimestamp", "generatedAt", "createdAt", "updatedAt", "overriddenAt", "activatedAt", "retiredAt"]);

function stripVolatile(value) {
  if (Array.isArray(value)) return value.map(stripVolatile);
  if (value instanceof Date) return "[Date stripped]";
  // Mongoose/BSON ObjectId is a plain object with buffer internals, not a primitive - without
  // this check the generic object branch below would recurse into its raw byte buffer instead of
  // its intended hex-string identity, corrupting anything that carries a stored ObjectId (e.g.
  // manualOverrides[fieldId].overriddenBy).
  if (value && typeof value.toHexString === "function") return value.toHexString();
  if (value && typeof value === "object") {
    const out = {};
    for (const [key, val] of Object.entries(value)) {
      if (VOLATILE_KEYS.has(key)) continue;
      out[key] = stripVolatile(val);
    }
    return out;
  }
  return value;
}

function sortedStringify(value) {
  return JSON.stringify(value, (key, val) => {
    if (val && typeof val === "object" && !Array.isArray(val)) {
      return Object.keys(val).sort().reduce((acc, k) => {
        acc[k] = val[k];
        return acc;
      }, {});
    }
    return val;
  });
}

function sha256(text) {
  return crypto.createHash("sha256").update(text).digest("hex");
}

async function extractPdfFieldSnapshot(pdfBuffer) {
  const pdfDoc = await PDFDocument.load(pdfBuffer, { ignoreEncryption: true, updateMetadata: false });
  const form = pdfDoc.getForm();
  const fields = form.getFields().map((field) => {
    let exported;
    try {
      exported = typeof field.getText === "function" ? field.getText() : typeof field.isChecked === "function" ? field.isChecked() : typeof field.getSelected === "function" ? field.getSelected() : null;
    } catch {
      exported = "[unreadable]";
    }
    return [field.getName(), field.constructor.name, exported];
  });
  fields.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return { pageCount: pdfDoc.getPageCount(), fields };
}

/**
 * Capture a full Phase 0 golden fixture for one visa: seeds a deterministic Case + canonical
 * data via the real services, runs the real AutoFillService + PDFGenerationService pipeline
 * unmodified, and returns a normalized, comparable snapshot. Cleans up everything it created.
 */
async function captureGolden(visaKey) {
  const seeder = SEEDERS[visaKey];
  if (!seeder) throw new Error(`Unknown Phase 0 golden visa key: ${visaKey}`);
  await connectTestDB();

  // Created up front, mutated by the seeder AS records are created (see the seeders' own
  // comment) - cleanup below runs on whatever this holds even if the seeder itself throws
  // partway through, so a mid-seed failure never leaks a User/Case that then collides (duplicate
  // email/caseNumber) with the next capture attempt.
  const ids = { caseId: null, userIds: [], beneficiaryId: null, companyId: null };
  try {
    const { caseId, formCode, primaryUserId } = await seeder(ids);
    const clientUser = { _id: primaryUserId, role: "client" };
    const teamLeadUser = { _id: primaryUserId, role: "team_lead" };
    const caseManagerUser = { _id: primaryUserId, role: "case_manager" };
    const { caseForm: filled } = await AutoFillService.generate(caseId, formCode, clientUser, req);
    const template = await USCISFormTemplate.findById(filled.formTemplateId).lean();
    const fieldNameToId = new Map(template.formFields.map((f) => [f.fieldName, f.fieldId]));

    const pdfFieldValues = {};
    for (const fieldName of fieldNameToId.keys()) {
      const value = MappingResolver.resolvePath(filled.filledData, fieldNameToId.get(fieldName));
      if (value !== undefined) pdfFieldValues[fieldName] = value;
    }
    const filledDataSnapshot = stripVolatile(filled.filledData);

    // Move the CaseForm from "ai_filled" to a PDF-generation-eligible status, exactly the way
    // h1b-golden-path.test.js's proven S7 step does: try the real approval workflow first, and
    // only fall back to stamping the same fields it would have set if it blocks on a data-
    // completeness gate this particular fixture doesn't happen to satisfy (a role/permission
    // failure is NOT caught here - that would be a real defect, not an expected fallback).
    let approvalStatus = "skipped";
    try {
      await InteractiveFormReviewService.formDecision(caseId, filled._id, { action: "approve" }, teamLeadUser, req);
      approvalStatus = "real_workflow";
    } catch (error) {
      if (error.status !== 422) throw error;
      const caseFormDoc = await CaseForm.findById(filled._id);
      caseFormDoc.status = "ready_for_pdf";
      caseFormDoc.approvedBy = primaryUserId;
      caseFormDoc.approvalDate = new Date();
      await caseFormDoc.save();
      approvalStatus = "fallback_stamped_ready_for_pdf";
    }

    const generated = await PDFGenerationService.generate(filled._id, caseManagerUser, req, { flatten: false });
    const pdfBuffer = await storageService.readBuffer(generated.document.storageKey);
    const pdfSnapshot = await extractPdfFieldSnapshot(pdfBuffer);

    // Representative overrideField payload - characterizes the override mechanism's shape, not
    // asserted as "the" value for this field; captured on a real mapped field so the payload is
    // realistic, then included as its own labeled section of the snapshot. Run AFTER the PDF
    // snapshot above so this characterization action never contaminates the auto-fill baseline.
    const crosswalk = CROSSWALK_BY_VISA[visaKey];
    const mappedFieldNames = new Set(crosswalk.MAPPED_EDGES.map((edge) => edge.fieldName));
    const overrideFieldName =
      [...fieldNameToId.keys()].find((name) => mappedFieldNames.has(name) && pdfFieldValues[name] !== undefined) ||
      [...fieldNameToId.keys()].find((name) => pdfFieldValues[name] !== undefined) ||
      [...fieldNameToId.keys()][0];
    const overriddenForm = await AutoFillService.overrideField(caseId, formCode, overrideFieldName, "PHASE0_CHARACTERIZATION_OVERRIDE", caseManagerUser, req, "phase0 golden fixture capture");
    const overrideExample = {
      fieldId: overrideFieldName,
      fieldValues: overriddenForm.fieldValues[overrideFieldName],
      sourceAttribution: stripVolatile(overriddenForm.sourceAttribution[overrideFieldName]),
      // overriddenBy is this capture run's own randomly-seeded actor id, not pipeline output -
      // redacted so the saved golden file is stable across captures (see PHASE0_RUN_JOURNAL.md).
      manualOverrides: { ...stripVolatile(overriddenForm.manualOverrides[overrideFieldName]), overriddenBy: "[actor id - redacted, not stable across captures]" },
    };

    const snapshot = {
      visaKey,
      formCode,
      approvalStatus,
      filledData: filledDataSnapshot,
      pdfFieldValues,
      pdfFieldValuesHash: sha256(sortedStringify(pdfFieldValues)),
      pdfSnapshot,
      pdfSnapshotHash: sha256(sortedStringify(pdfSnapshot)),
      overrideExample,
      counts: {
        mappedPdfFields: Object.keys(pdfFieldValues).length,
        templateFieldCount: template.formFields.length,
        fillWarnings: (generated.renderReport?.failedFieldWrites || []).length + (generated.renderReport?.unmappedPdfFields || []).length,
      },
    };
    return snapshot;
  } finally {
    await cleanupCase(ids);
  }
}

module.exports = { captureGolden, VISA_KEYS: Object.keys(SEEDERS) };
