// Release 0b-1: thin HTTP layer over EvidenceService. Authorization is enforced by the route guard (exact roles) AND again inside the service.
const { getService } = require("./EvidenceService");

const handle = (action) => async (req, res, next) => {
  try {
    res.json({ success: true, data: await action(getService(), req) });
  } catch (error) {
    // service errors carry their own status / code; anything else goes to the shared error handler
    if (error.status && error.status < 500) return res.status(error.status).json({ success: false, message: error.message, code: error.code, details: error.details });
    return next(error);
  }
};

exports.listEditions = handle((service, req) => service.listEditions(req.user));
exports.checkGate = handle((service, req) => service.gateCheck(req.user, req.query.formCode, req.query.edition));
exports.submitEvidence = handle((service, req) => service.submitEvidence(req.user, req.body));
exports.getEvidenceCase = handle((service, req) => service.getCase(req.user, req.params.evidenceCaseId));
exports.recordDecision = handle((service, req) => service.recordDecision(req.user, req.params.evidenceCaseId, req.body));
