const AutoFillService = require("../services/AutoFillService");

const respond = (res, status, payload) => res.status(status).json({ success: status < 400, ...payload });

const handleError = (res, error) => respond(res, error.status || 500, { message: error.message || "Auto-fill request failed" });

exports.autofill = async (req, res) => {
  try {
    const result = await AutoFillService.generate(req.params.caseId, req.params.formType, req.user, req);
    respond(res, 200, { data: result });
  } catch (error) {
    handleError(res, error);
  }
};

exports.preview = async (req, res) => {
  try {
    const data = await AutoFillService.preview(req.params.caseId, req.params.formType, req.query.version);
    respond(res, 200, { data });
  } catch (error) {
    handleError(res, error);
  }
};

exports.validation = async (req, res) => {
  try {
    const data = await AutoFillService.validation(req.params.caseId, req.params.formType);
    respond(res, 200, { data });
  } catch (error) {
    handleError(res, error);
  }
};

exports.regenerate = async (req, res) => {
  try {
    const result = await AutoFillService.generate(req.params.caseId, req.params.formType, req.user, req, { regenerate: true, version: req.body?.version });
    respond(res, 200, { data: result });
  } catch (error) {
    handleError(res, error);
  }
};

exports.refresh = async (req, res) => {
  try {
    const result = await AutoFillService.generate(req.params.caseId, req.params.formType, req.user, req, { regenerate: true, version: req.body?.version });
    respond(res, 200, { data: result });
  } catch (error) {
    handleError(res, error);
  }
};

exports.repopulateFields = async (req, res) => {
  try {
    const data = await AutoFillService.repopulateFields(req.params.caseId, req.params.formType, req.body?.fieldIds || [], req.user, req);
    respond(res, 200, { data });
  } catch (error) {
    handleError(res, error);
  }
};

exports.resetAutoFilledFields = async (req, res) => {
  try {
    const data = await AutoFillService.resetAutoFilledFields(req.params.caseId, req.params.formType, req.user, req);
    respond(res, 200, { data });
  } catch (error) {
    handleError(res, error);
  }
};

exports.overrideField = async (req, res) => {
  try {
    const data = await AutoFillService.overrideField(req.params.caseId, req.params.formType, req.params.fieldId, req.body?.value, req.user, req, req.body?.reason);
    respond(res, 200, { data });
  } catch (error) {
    handleError(res, error);
  }
};

exports.reviewField = async (req, res) => {
  try {
    const data = await AutoFillService.reviewField(req.params.caseId, req.params.formType, req.params.fieldId, req.body?.status, req.body?.comment, req.user, req);
    respond(res, 200, { data });
  } catch (error) {
    handleError(res, error);
  }
};

exports.rollback = async (req, res) => {
  try {
    const data = await AutoFillService.rollback(req.params.caseId, req.params.formType, req.params.versionNumber, req.user, req);
    respond(res, 200, { data });
  } catch (error) {
    handleError(res, error);
  }
};
