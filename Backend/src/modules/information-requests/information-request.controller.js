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
    // Requests the client already satisfied on their own checklist flip to Received before listing, so the panel is right the moment it opens.
    const { changed } = await service.reconcileFulfilment({ caseId: caseData._id, user: req.user, req }).catch(() => ({ changed: 0 }));
    const current = changed ? (await Case.findById(caseData._id)) || caseData : caseData;
    res.json({ success: true, requests: await service.listRequestsWithAnswers(current) });
  } catch (error) {
    next(error);
  }
};

// "Request" next to an existing question/document of the client's checklist: it becomes required for this case only.
exports.createItem = async (req, res, next) => {
  try {
    const caseData = await loadCase(req, res);
    if (!caseData) return;
    const result = await service.createItemRequest(caseData, req.body, req.user, req);
    res.status(result.resent ? 200 : 201).json({ success: true, resent: result.resent, request: result.request, recipient: result.recipient, question: result.question });
  } catch (error) {
    if (error.code === "RECIPIENT_REQUIRED") return res.status(error.status || 409).json({ success: false, code: error.code, message: error.message, recipients: error.details?.recipients || [] });
    next(error);
  }
};

// Withdraw such a request (the item stops being required). The request may live on the principal case (shared roles).
exports.cancelItem = async (req, res, next) => {
  try {
    const caseData = await loadCase(req, res);
    if (!caseData) return;
    let holder = caseData;
    const has = (doc) => (doc.informationRequests || []).some((item) => String(item._id) === String(req.params.requestId));
    if (!has(holder) && caseData.parentCase) {
      const parent = await Case.findById(caseData.parentCase);
      if (parent && caseService.canAccessCase(req.user, parent) && has(parent)) holder = parent;
    }
    const request = await service.cancelItemRequest(holder, req.params.requestId, req.user, req);
    res.json({ success: true, request });
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
