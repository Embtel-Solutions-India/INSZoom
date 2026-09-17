const Case = require("../../../models/Case");
const caseService = require("../../cases/case.service");
const EligibilityEngineService = require("../services/EligibilityEngineService");

function caseIdFrom(req) {
  return req.params.caseId || req.body?.caseId || req.query?.caseId;
}

function respond(res, status, payload) {
  return res.status(status).json({ success: status < 400, ...payload });
}

function handle(res, error) {
  return respond(res, error.status || 500, { message: error.message || "Eligibility request failed" });
}

// SECURITY FIX: every one of these routes was gated only by the generic
// `cases:read`/`cases:update` PERMISSION (route-level, checked once, same
// for every case) — nothing here ever checked whether THIS user may see
// THIS specific case. Any authenticated account holding cases:read (most
// roles) could read any other case's eligibility results/gaps/
// recommendations, or (holding cases:update) recalculate/override them,
// just by knowing/guessing the caseId. Fixed by requiring the same
// canAccessCase() check every other case-scoped route already uses
// (see modules/form-registry/form-registry.controller.js's
// loadAuthorizedCase for the identical pattern).
async function loadAuthorizedCase(req) {
  const caseId = caseIdFrom(req);
  if (!caseId) throw Object.assign(new Error("caseId is required"), { status: 400 });
  const caseData = await Case.findById(caseId);
  if (!caseData) throw Object.assign(new Error("Case not found"), { status: 404 });
  if (!caseService.canAccessCase(req.user, caseData)) {
    throw Object.assign(new Error("Not authorized to access eligibility data for this case"), { status: 403 });
  }
  return caseData;
}

exports.evaluate = async (req, res) => {
  try {
    const caseData = await loadAuthorizedCase(req);
    const data = await EligibilityEngineService.evaluate(caseData._id, req.user, req, req.body || {});
    respond(res, 200, { data });
  } catch (error) {
    handle(res, error);
  }
};

exports.results = async (req, res) => {
  try {
    const caseData = await loadAuthorizedCase(req);
    respond(res, 200, { data: await EligibilityEngineService.latest(caseData._id) });
  } catch (error) {
    handle(res, error);
  }
};

exports.gaps = async (req, res) => {
  try {
    const caseData = await loadAuthorizedCase(req);
    respond(res, 200, { data: await EligibilityEngineService.gaps(caseData._id) });
  } catch (error) {
    handle(res, error);
  }
};

exports.recommendations = async (req, res) => {
  try {
    const caseData = await loadAuthorizedCase(req);
    respond(res, 200, { data: await EligibilityEngineService.recommendations(caseData._id) });
  } catch (error) {
    handle(res, error);
  }
};

exports.recalculate = async (req, res) => {
  try {
    const caseData = await loadAuthorizedCase(req);
    const data = await EligibilityEngineService.evaluate(caseData._id, req.user, req, req.body || {});
    respond(res, 200, { data });
  } catch (error) {
    handle(res, error);
  }
};

exports.override = async (req, res) => {
  try {
    const caseData = await loadAuthorizedCase(req);
    const data = await EligibilityEngineService.override(caseData._id, req.body || {}, req.user, req);
    respond(res, 200, { data });
  } catch (error) {
    handle(res, error);
  }
};
