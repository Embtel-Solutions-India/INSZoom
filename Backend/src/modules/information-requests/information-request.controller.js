const Case = require("../../models/Case");
const caseService = require("../cases/case.service");
const service = require("./information-request.service");

async function loadCase(req, res) {
  const caseData = await Case.findById(req.params.id);
  if (!caseData || !caseService.canAccessCase(req.user, caseData)) {
    res.status(404).json({ success: false, message: "Case not found" });
    return null;
  }
  return caseData;
}

exports.listRecipients = async (req, res, next) => {
  try {
    const caseData = await loadCase(req, res);
    if (!caseData) return;
    res.json({ success: true, recipients: await service.listRecipients(caseData) });
  } catch (error) {
    next(error);
  }
};

exports.list = async (req, res, next) => {
  try {
    const caseData = await loadCase(req, res);
    if (!caseData) return;
    res.json({ success: true, requests: await service.listRequestsWithAnswers(caseData) });
  } catch (error) {
    next(error);
  }
};

exports.create = async (req, res, next) => {
  try {
    const caseData = await loadCase(req, res);
    if (!caseData) return;
    const result = await service.createRequest(caseData, req.body, req.user, req);
    res.status(201).json({ success: true, request: result.request, recipient: result.recipient, case: caseData });
  } catch (error) {
    next(error);
  }
};
