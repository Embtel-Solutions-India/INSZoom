const USCISFormTemplate = require("../../../models/USCISFormTemplate");
const FormComparisonService = require("../services/FormComparisonService");
const FormImportService = require("../services/FormImportService");
const USCISScannerService = require("../services/USCISScannerService");
const VersionManagementService = require("../services/VersionManagementService");

function respond(res, status, payload) {
  return res.status(status).json({ success: status < 400, ...payload });
}

function handle(res, error) {
  return respond(res, error.status || 500, { message: error.message });
}

exports.listForms = async (req, res) => {
  try {
    respond(res, 200, { data: await VersionManagementService.listForms(req.query) });
  } catch (error) {
    handle(res, error);
  }
};

exports.getVersions = async (req, res) => {
  try {
    respond(res, 200, { data: await VersionManagementService.versions(req.params.formType) });
  } catch (error) {
    handle(res, error);
  }
};

exports.compareVersion = async (req, res) => {
  try {
    const current = await USCISFormTemplate.findById(req.params.version);
    if (!current) return respond(res, 404, { message: "Form version not found" });
    const previous = current.parentVersion ? await USCISFormTemplate.findById(current.parentVersion) : await USCISFormTemplate.findOne({ formCode: current.formCode, status: "active", _id: { $ne: current._id } }).sort({ editionDate: -1, updatedAt: -1 });
    if (!previous) return respond(res, 200, { data: current.lifecycle?.comparisonReport || null });
    const report = FormComparisonService.compare(previous.toObject(), current.toObject());
    current.lifecycle = { ...(current.lifecycle || {}), comparisonReport: report, migrationSuggestions: report.migrationSuggestions };
    await current.save();
    await VersionManagementService.audit("VERSION_COMPARED", current, req.user, req, report);
    respond(res, 200, { data: report });
  } catch (error) {
    handle(res, error);
  }
};

exports.importForm = async (req, res) => {
  try {
    const template = await FormImportService.importOfficialForm(req.body || {}, req.user, req);
    await VersionManagementService.audit("FORM_IMPORTED", template, req.user, req);
    await VersionManagementService.notify(["super_admin", "admin"], { title: "USCIS form imported", message: `${template.formCode} ${template.version} was imported as a draft.`, metadata: { versionId: template._id } }, req.user, req);
    respond(res, 201, { data: template });
  } catch (error) {
    handle(res, error);
  }
};

exports.approve = async (req, res) => {
  try {
    respond(res, 200, { data: await VersionManagementService.approve(req.params.version, req.user, req) });
  } catch (error) {
    handle(res, error);
  }
};

exports.activate = async (req, res) => {
  try {
    respond(res, 200, { data: await VersionManagementService.activate(req.params.version, req.user, req) });
  } catch (error) {
    handle(res, error);
  }
};

exports.retire = async (req, res) => {
  try {
    respond(res, 200, { data: await VersionManagementService.retire(req.params.version, req.user, req) });
  } catch (error) {
    handle(res, error);
  }
};

exports.scan = async (req, res) => {
  try {
    respond(res, 200, { data: await USCISScannerService.scanAll(req.body || {}, req.user, req) });
  } catch (error) {
    handle(res, error);
  }
};
