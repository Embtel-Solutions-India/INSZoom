// node src/scripts/verifyI824EndToEnd.js
// Drives the REAL services end to end for a throw-away I-824 case: create (family workflow) -> two checklists assigned -> Form I-824 provisioned -> answers saved
// for petitioner / principal immigrant / beneficiary -> autofill -> filled PDF rendered. Prints PASS/FAIL per step, then PERMANENTLY DELETES everything it
// created (case, users, beneficiary, answers, documents, forms, notifications) - the shared DB is left exactly as found. Exit code 1 on any failure.
require("dotenv").config();
const mongoose = require("mongoose");
const env = require("../config/env");

const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok: Boolean(ok), detail }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " - " + detail : ""}`); };
const tag = `e2e-i824-${Date.now()}`;

async function main() {
  await mongoose.connect(env.mongoUri);
  const Case = require("../models/Case");
  const User = require("../models/User");
  const Beneficiary = require("../models/Beneficiary");
  const CaseForm = require("../models/CaseForm");
  const Questionnaire = require("../models/Questionnaire");
  const Answer = require("../models/Answer");
  const Document = require("../models/Document");
  const controller = require("../modules/family-workflow/family-workflow.controller");
  const questionnaireService = require("../modules/questionnaires/questionnaire.service");
  const created = { caseId: null, emails: [`petitioner+${tag}@example.invalid`, `beneficiary+${tag}@example.invalid`] };
  const admin = await User.findOne({ role: { $in: ["super_admin", "admin"] } }).sort({ createdAt: 1 });
  const req = { ip: "e2e", headers: {}, user: admin, body: {} };

  try {
    req.body = {
      visaType: "I-824", petitionerName: "E2E Petitioner", petitionerEmail: created.emails[0], beneficiaryName: "E2E Beneficiary", beneficiaryEmail: created.emails[1],
      familyCompletionMode: "petitioner_completes", underlyingPetition: { formNumber: "I-130", receiptNumber: "MSC0000000000", approvalDate: "2025-01-01", requestedAction: "Replace approval notice" },
    };
    let body; let status = 200;
    await controller.createFamilyCase(req, { status(code) { status = code; return this; }, json(payload) { body = payload; return this; } }, (error) => { throw error; });
    check("case created with the exact type", status === 201 && body?.case?.visaType === "I-824", `${status} ${body?.case?.visaType}`);
    created.caseId = body.case._id;
    let caseData = await Case.findById(created.caseId);
    check("underlying approval recorded, no review flags for a complete I-130 approval", caseData.postApprovalAction?.formNumber === "I-130" && !caseData.postApprovalAction.reviewFlags.length);

    const refs = (caseData.questionnaireReferences || []).filter((ref) => ref.active !== false);
    const keys = (await Questionnaire.find({ _id: { $in: refs.map((ref) => ref.questionnaireId) } }).select("key").lean()).map((q) => q.key).sort();
    check("exactly the two I-824 checklists assigned", JSON.stringify(keys) === JSON.stringify(["i824_beneficiary_checklist", "i824_petitioner_checklist"]), keys.join(","));

    // idempotency: running the assignment again must not duplicate anything
    const uscisFormService = require("../modules/uscis-forms/uscis-form.service");
    await require("../modules/cases/case-lifecycle-orchestrator.service").provisionRequiredForms(caseData, admin, req);
    await require("../modules/cases/case-lifecycle-orchestrator.service").provisionRequiredForms(caseData, admin, req);
    const forms = await CaseForm.find({ caseId: created.caseId }).lean();
    const formTypes = forms.map((form) => form.formType || form.formCode || form.formNumber);
    check("Form I-824 provisioned once (idempotent) and no I-130 / I-485 / I-864 / DOS form", formTypes.filter((t) => /824/.test(t)).length === 1 && !formTypes.some((t) => /130|485|864|DS-?\d/.test(t)), formTypes.join(","));

    // answers: petitioner, principal immigrant, beneficiary
    const byKey = async (key) => Questionnaire.findOne({ key, latestVersion: true });
    const save = async (key, answers, targetRole) => questionnaireService.saveAnswers({ questionnaireId: (await byKey(key))._id, caseId: created.caseId, targetRole, answers }, admin, req);
    await save("i824_petitioner_checklist", [
      { questionKey: "i824_petitioner_lastName", value: "Petitionerlast" }, { questionKey: "i824_petitioner_firstName", value: "Petfirst" },
      { questionKey: "i824_petitioner_ssn", value: "123-45-6789" },
      { questionKey: "i824_principal_lastName", value: "Principallast" }, { questionKey: "i824_principal_firstName", value: "Princfirst" },
      { questionKey: "i824_principal_mailingAddress", value: { line1: "5 Main St", city: "Austin", state: "TX", postalCode: "78701", country: "United States" } },
    ], "petitioner");
    await save("i824_beneficiary_checklist", [
      { questionKey: "i824_beneficiary_lastName", value: "Benlast" }, { questionKey: "i824_beneficiary_firstName", value: "Benfirst" },
      { questionKey: "i824_beneficiary_foreignAddress", value: { line1: "9 Rue X", city: "Paris", state: "IDF", postalCode: "75001", country: "France" } },
    ], "beneficiary");
    const answers = await Answer.find({ caseId: created.caseId }).lean();
    check("answers persisted for both checklists", answers.length >= 8, `${answers.length} answers`);

    // principal / petitioner / beneficiary kept separate in the canonical profile
    const CanonicalProfileService = require("../modules/canonical/services/CanonicalProfileService");
    const profile = (await CanonicalProfileService.getProfile?.(created.caseId, admin, req).catch(() => null))?.profile
      || (await require("../modules/canonical/services/CanonicalBuilderService").build?.(created.caseId, admin, req).catch(() => null))?.profile;
    if (profile) {
      check("three people stay in their own namespaces", profile.petitioner?.lastName === "Petitionerlast" && profile.principalImmigrant?.lastName === "Principallast" && profile.beneficiary?.lastName === "Benlast",
        JSON.stringify([profile.petitioner?.lastName, profile.principalImmigrant?.lastName, profile.beneficiary?.lastName]));
    } else check("canonical profile built", false, "could not build the profile through the service API");

    // autofill + render
    const AutoFillService = require("../modules/form-mapping/services/AutoFillService");
    await AutoFillService.generate(created.caseId, "I-824", admin, req).catch((error) => check("autofill ran", false, error.message));
    const form = await CaseForm.findOne({ caseId: created.caseId, $or: [{ formType: "I-824" }, { formCode: "I-824" }] }).lean();
    const values = JSON.stringify(form?.fieldValues || form?.filledData || {});
    check("autofill wrote the three people into their own PDF blocks", /Petitionerlast/.test(values) && /Principallast/.test(values) && /Benlast/.test(values));
    check("sensitive SSN is not echoed into the audit trail", !(JSON.stringify(form?.history || form?.auditTrail || []).includes("123-45-6789")));
    const USCISFormTemplate = require("../models/USCISFormTemplate");
    const template = await USCISFormTemplate.findOne({ formCode: "I-824", status: "active" });
    const PDFRenderer = require("../modules/form-generation/services/PDFRenderer");
    const rendered = await PDFRenderer.render({ caseForm: form, template });
    const { PDFDocument } = PDFRenderer.loadPdfLib();
    const pdf = await PDFDocument.load(rendered.buffer, { ignoreEncryption: true });
    const filled = pdf.getForm().getFields().filter((field) => { try { return Boolean(field.getText?.()); } catch (_) { return false; } });
    check("filled PDF renders, is not blank, and contains the saved names", filled.length > 3 && filled.some((field) => /Petitionerlast/.test(field.getText())) && filled.some((field) => /Benlast/.test(field.getText())), `${filled.length} filled fields`);
  } catch (error) {
    check("end-to-end run", false, error.stack || error.message);
  } finally {
    // permanent cleanup of everything this run created (dry-run principle: only records carrying this run's tag / case id)
    const ids = created.caseId ? [created.caseId] : [];
    const users = await User.find({ email: { $in: created.emails } }).select("_id").lean();
    const del = async (name, model, filter) => { const r = await model.deleteMany(filter); console.log(`cleanup ${name}: ${r.deletedCount}`); };
    if (ids.length) {
      await del("answers", Answer, { caseId: { $in: ids } });
      await del("documents", Document, { caseId: { $in: ids } });
      await del("case forms", CaseForm, { caseId: { $in: ids } });
      for (const name of ["Notification", "Timeline", "AuditLog", "Conversation", "Message", "CanonicalProfile", "FieldMapping"]) {
        let model; try { model = require(`../models/${name}`); } catch (_) { continue; } // model not present
        // only ever filter on a field the schema really has - an unknown field must never widen the delete
        const field = ["caseId", "case"].find((candidate) => model.schema.path(candidate));
        if (field) await del(name.toLowerCase(), model, { [field]: { $in: ids } });
      }
      await del("cases", Case, { _id: { $in: ids } });
    }
    await del("beneficiaries", Beneficiary, { email: { $in: created.emails } });
    await del("users", User, { _id: { $in: users.map((user) => user._id) } });
    await mongoose.disconnect();
  }
  const failed = results.filter((result) => !result.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((error) => { console.error("Failed:", error.stack || error.message); process.exit(1); });
