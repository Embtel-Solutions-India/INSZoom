const CollaborationService = require("../services/CollaborationService");

function respond(res, status, payload) {
  return res.status(status).json({ success: status < 400, ...payload });
}

function handle(res, error) {
  return respond(res, error.status || error.statusCode || 500, { message: error.message || "Collaboration request failed" });
}

async function loadCase(req) {
  return CollaborationService.getCase(req.params.caseId, req.user);
}

exports.timeline = async (req, res) => {
  try {
    const caseData = await loadCase(req);
    respond(res, 200, { timeline: CollaborationService.timeline(caseData, req.user) });
  } catch (error) {
    handle(res, error);
  }
};

exports.addComment = async (req, res) => {
  try {
    const caseData = await loadCase(req);
    respond(res, 201, { comment: await CollaborationService.addComment(caseData, req.body, req.user, req) });
  } catch (error) {
    handle(res, error);
  }
};

exports.createTask = async (req, res) => {
  try {
    const caseData = await loadCase(req);
    respond(res, 201, { task: await CollaborationService.createTask(caseData, req.body, req.user, req) });
  } catch (error) {
    handle(res, error);
  }
};

exports.createRequest = async (req, res) => {
  try {
    const caseData = await loadCase(req);
    respond(res, 201, { request: await CollaborationService.createRequest(caseData, req.body, req.user, req) });
  } catch (error) {
    handle(res, error);
  }
};

exports.readiness = async (req, res) => {
  try {
    respond(res, 200, { readiness: await CollaborationService.readiness(req.params.caseId, req.user) });
  } catch (error) {
    handle(res, error);
  }
};

exports.assign = async (req, res) => {
  try {
    const caseData = await loadCase(req);
    respond(res, 200, { case: await CollaborationService.assign(caseData, req.body, req.user, req) });
  } catch (error) {
    handle(res, error);
  }
};
