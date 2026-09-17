const PetitionPackage = require("../../models/PetitionPackage");
const PackageDefinition = require("../../models/PackageDefinition");
const Document = require("../../models/Document");
const Case = require("../../models/Case");
const storageService = require("../uploads/storage.service");
const caseService = require("../cases/case.service");
const PetitionAssemblyService = require("./services/PetitionAssemblyService");

function handle(res, error) {
  return res.status(error.status || 500).json({ success: false, message: error.message, code: error.code });
}

// SECURITY FIX: every read endpoint below (listPackages/getPackage/
// getValidation/preview/download) previously fetched by caseId/packageId
// with NO check that req.user may access that case — only the route-level
// forms:read PERMISSION was checked, identical for every case. Any
// authenticated account holding forms:read (effectively every staff role)
// could list, view, or download the assembled PDF/Word petition for any
// OTHER case, not just ones they're assigned to. See
// PetitionAssemblyService.loadAuthorizedPackage for the mutation-side fix
// (same root cause, same shared caseService.canAccessCase check).
async function loadAuthorizedCase(caseId, user) {
  const caseData = await Case.findById(caseId);
  if (!caseData) throw Object.assign(new Error("Case not found"), { status: 404 });
  if (!caseService.canAccessCase(user, caseData)) {
    throw Object.assign(new Error("Not authorized to access petitions for this case"), { status: 403 });
  }
  return caseData;
}

async function loadAuthorizedPackage(packageId, user) {
  const petitionPackage = await PetitionPackage.findById(packageId);
  if (!petitionPackage) throw Object.assign(new Error("Package not found"), { status: 404 });
  await loadAuthorizedCase(petitionPackage.caseId, user);
  return petitionPackage;
}

exports.assemble = async (req, res) => {
  try {
    const data = await PetitionAssemblyService.assemble(req.params.caseId, req.body || {}, req.user, req);
    res.status(201).json({ success: true, data });
  } catch (error) {
    handle(res, error);
  }
};

exports.listPackages = async (req, res) => {
  try {
    await loadAuthorizedCase(req.params.caseId, req.user);
    const packages = await PetitionPackage.find({ caseId: req.params.caseId }).sort({ versionNumber: -1 });
    res.json({ success: true, data: packages });
  } catch (error) {
    handle(res, error);
  }
};

exports.getPackage = async (req, res) => {
  try {
    const petitionPackage = await loadAuthorizedPackage(req.params.id, req.user);
    res.json({ success: true, data: petitionPackage });
  } catch (error) {
    handle(res, error);
  }
};

exports.getValidation = async (req, res) => {
  try {
    const petitionPackage = await loadAuthorizedPackage(req.params.id, req.user);
    // Mirrors form-generation's existing precedent (PDFValidationService:
    // valid = errors.length === 0 — warnings alone don't count as invalid):
    // only "blocked" (has blocking errors) is a failure response.
    const blocked = petitionPackage.validation?.status === "blocked";
    res.status(blocked ? 422 : 200).json({ success: !blocked, data: petitionPackage.validation });
  } catch (error) {
    handle(res, error);
  }
};

async function resolveOutputDocument(petitionPackage, format) {
  const documentId = format === "word" ? petitionPackage.outputs?.presentationWordDocumentId : petitionPackage.outputs?.mailingPdfDocumentId;
  if (!documentId) return null;
  return Document.findById(documentId);
}

exports.preview = async (req, res) => {
  try {
    const petitionPackage = await loadAuthorizedPackage(req.params.id, req.user);
    const document = await resolveOutputDocument(petitionPackage, "pdf");
    if (!document?.storageKey) return res.status(404).json({ success: false, message: "Mailing PDF has not been assembled yet" });
    const buffer = await storageService.readBuffer(document.storageKey);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${document.originalName || "petition.pdf"}"`);
    res.send(buffer);
  } catch (error) {
    handle(res, error);
  }
};

exports.download = async (req, res) => {
  try {
    const petitionPackage = await loadAuthorizedPackage(req.params.id, req.user);
    const format = ["word", "docx"].includes(req.query.format) ? "word" : "pdf";
    const document = await resolveOutputDocument(petitionPackage, format);
    if (!document?.storageKey) return res.status(404).json({ success: false, message: `${format === "word" ? "Presentation draft" : "Mailing PDF"} has not been assembled yet` });
    const buffer = await storageService.readBuffer(document.storageKey);
    res.setHeader("Content-Type", document.mimeType || (format === "word" ? "application/msword" : "application/pdf"));
    res.setHeader("Content-Disposition", `attachment; filename="${document.originalName}"`);
    res.send(buffer);
  } catch (error) {
    handle(res, error);
  }
};

exports.saveLetter = async (req, res) => {
  try {
    const data = await PetitionAssemblyService.saveLetterEdit(req.params.id, req.params.sectionKey, req.body?.html || "", req.user, req);
    res.json({ success: true, data });
  } catch (error) {
    handle(res, error);
  }
};

exports.reorderExhibits = async (req, res) => {
  try {
    const data = await PetitionAssemblyService.reorderExhibits(req.params.id, req.body?.order || [], req.user, req);
    res.json({ success: true, data });
  } catch (error) {
    handle(res, error);
  }
};

exports.finalize = async (req, res) => {
  try {
    const data = await PetitionAssemblyService.finalize(req.params.id, req.user, req, req.body || {});
    res.json({ success: true, data });
  } catch (error) {
    handle(res, error);
  }
};

exports.unlock = async (req, res) => {
  try {
    const data = await PetitionAssemblyService.unlock(req.params.id, req.body || {}, req.user, req);
    res.json({ success: true, data });
  } catch (error) {
    handle(res, error);
  }
};

exports.recordFiling = async (req, res) => {
  try {
    const data = await PetitionAssemblyService.recordFiling(req.params.id, req.body || {}, req.user, req);
    res.json({ success: true, data });
  } catch (error) {
    handle(res, error);
  }
};

exports.recordReceipt = async (req, res) => {
  try {
    const data = await PetitionAssemblyService.recordReceipt(req.params.id, req.body || {}, req.user, req);
    res.json({ success: true, data });
  } catch (error) {
    handle(res, error);
  }
};

exports.listDefinitions = async (req, res) => {
  try {
    const definitions = await PackageDefinition.find().sort({ visaType: 1 });
    res.json({ success: true, data: definitions });
  } catch (error) {
    handle(res, error);
  }
};

exports.getDefinition = async (req, res) => {
  try {
    const definition = await PackageDefinition.findOne({ key: req.params.key });
    if (!definition) return res.status(404).json({ success: false, message: "Package definition not found" });
    res.json({ success: true, data: definition });
  } catch (error) {
    handle(res, error);
  }
};

exports.upsertDefinition = async (req, res) => {
  try {
    const existing = await PackageDefinition.findOne({ key: req.params.key });
    const payload = { ...req.body, key: req.params.key, version: (existing?.version || 0) + 1, updatedBy: req.user?._id };
    const definition = await PackageDefinition.findOneAndUpdate(
      { key: req.params.key },
      { $set: payload, $setOnInsert: { createdBy: req.user?._id } },
      { upsert: true, new: true, setDefaultsOnInsert: true, runValidators: true }
    );
    res.json({ success: true, data: definition });
  } catch (error) {
    handle(res, error);
  }
};
