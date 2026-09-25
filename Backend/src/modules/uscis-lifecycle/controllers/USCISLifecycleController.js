const USCISFormTemplate = require("../../../models/USCISFormTemplate");
const USCISFormSyncRun = require("../../../models/USCISFormSyncRun");
const FormComparisonService = require("../services/FormComparisonService");
const FormImportService = require("../services/FormImportService");
const USCISScannerService = require("../services/USCISScannerService");
const VersionManagementService = require("../services/VersionManagementService");
const logger = require("../../../utils/logger");

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
    const options = req.body || {};
    if (options.forms?.length) {
      // Small, explicitly-scoped test/tooling path (a handful of named
      // forms) - fast enough to stay synchronous, unchanged.
      respond(res, 200, { data: await USCISScannerService.scanAll(options, req.user, req) });
      return;
    }
    // The full directory-crawl-and-import scan is genuinely slow (measured
    // against the live uscis.gov site: a single form's import alone took
    // 135s, dominated by PDF field-scanning of the real hybrid XFA+AcroForm
    // template - not a network/User-Agent block, which was checked directly
    // and ruled out). A synchronous HTTP request can't wait that out, so the
    // lock-check + USCISFormSyncRun row creation happens now (fast) and the
    // response returns immediately; the slow work continues after the
    // response via executeScanRun(), updating that same row.
    const prepared = await USCISScannerService.beginScanRun(options, req.user, req);
    if (prepared.inProgress) {
      respond(res, 200, { data: prepared });
      return;
    }
    respond(res, 202, {
      data: {
        syncRunId: prepared.syncRun._id,
        status: "running",
        message: "USCIS form synchronization started",
        statusUrl: `/api/uscis/forms/scan/status/${prepared.syncRun._id}`,
      },
    });
    USCISScannerService.executeScanRun(prepared, options, req.user, req).catch((error) => {
      logger.error("uscis_background_scan_failed", { syncRunId: prepared.syncRun._id, error: error.message });
    });
  } catch (error) {
    handle(res, error);
  }
};

exports.getScanStatus = async (req, res) => {
  try {
    const syncRun = await USCISFormSyncRun.findById(req.params.syncRunId).lean();
    if (!syncRun) return respond(res, 404, { message: "Sync run not found" });
    respond(res, 200, { data: syncRun });
  } catch (error) {
    handle(res, error);
  }
};
