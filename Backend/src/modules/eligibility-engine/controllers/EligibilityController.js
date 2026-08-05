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

exports.evaluate = async (req, res) => {
  try {
    const caseId = caseIdFrom(req);
    if (!caseId) return respond(res, 400, { message: "caseId is required" });
    const data = await EligibilityEngineService.evaluate(caseId, req.user, req, req.body || {});
    respond(res, 200, { data });
  } catch (error) {
    handle(res, error);
  }
};

exports.results = async (req, res) => {
  try {
    respond(res, 200, { data: await EligibilityEngineService.latest(caseIdFrom(req)) });
  } catch (error) {
    handle(res, error);
  }
};

exports.gaps = async (req, res) => {
  try {
    respond(res, 200, { data: await EligibilityEngineService.gaps(caseIdFrom(req)) });
  } catch (error) {
    handle(res, error);
  }
};

exports.recommendations = async (req, res) => {
  try {
    respond(res, 200, { data: await EligibilityEngineService.recommendations(caseIdFrom(req)) });
  } catch (error) {
    handle(res, error);
  }
};

exports.recalculate = async (req, res) => {
  try {
    const data = await EligibilityEngineService.evaluate(caseIdFrom(req), req.user, req, req.body || {});
    respond(res, 200, { data });
  } catch (error) {
    handle(res, error);
  }
};

exports.override = async (req, res) => {
  try {
    const data = await EligibilityEngineService.override(caseIdFrom(req), req.body || {}, req.user, req);
    respond(res, 200, { data });
  } catch (error) {
    handle(res, error);
  }
};
