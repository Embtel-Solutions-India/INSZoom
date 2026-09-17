const Case = require("../../models/Case");
const caseService = require("../cases/case.service");
const feedbackService = require("./feedback.service");

// Staff (Case Manager / Team Lead / Admin) side of the attorney feedback
// thread. The attorney side lives in modules/attorney/attorney.controller.js
// and gets its per-case authorization from requireAttorneyAccess; staff get
// theirs from canAccessCase, the same function every other staff case route
// already uses — so "which cases can this case manager see" has exactly one
// definition, not a feedback-specific copy of it.
async function assertStaffCaseAccess(req) {
  const caseDoc = await Case.findById(req.params.caseId).select(
    "_id caseId caseNumber assignedCaseManager assignedTeamLead primaryOwner secondaryOwner teamId user clientProfile attorneyAccess"
  );
  if (!caseDoc) {
    const error = new Error("Case not found");
    error.statusCode = 404;
    throw error;
  }
  if (!caseService.canAccessCase(req.user, caseDoc)) {
    const error = new Error("Not authorized to access this case");
    error.statusCode = 403;
    throw error;
  }
  return caseDoc;
}

exports.listFeedback = async (req, res, next) => {
  try {
    await assertStaffCaseAccess(req);
    const items = await feedbackService.listFeedback(req.params.caseId);
    res.json({ success: true, feedback: items });
  } catch (error) {
    next(error);
  }
};

exports.createFeedback = async (req, res, next) => {
  try {
    await assertStaffCaseAccess(req);
    const feedback = await feedbackService.createFeedback({
      caseId: req.params.caseId,
      author: req.user,
      message: req.body.message,
      files: req.files || [],
    });
    res.status(201).json({ success: true, feedback });
  } catch (error) {
    next(error);
  }
};

exports.replyToFeedback = async (req, res, next) => {
  try {
    await assertStaffCaseAccess(req);
    const feedback = await feedbackService.createFeedback({
      caseId: req.params.caseId,
      author: req.user,
      message: req.body.message,
      parentFeedbackId: req.params.feedbackId,
      files: req.files || [],
    });
    res.status(201).json({ success: true, feedback });
  } catch (error) {
    next(error);
  }
};

exports.markFeedbackRead = async (req, res, next) => {
  try {
    await assertStaffCaseAccess(req);
    const result = await feedbackService.markCaseFeedbackRead(req.params.caseId, req.user._id);
    res.json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
};

exports.getFeedbackAttachment = async (req, res, next) => {
  try {
    await assertStaffCaseAccess(req);
    const { buffer, attachment } = await feedbackService.getFeedbackAttachment(req.params.caseId, req.params.feedbackId, req.params.attachmentId);
    res.set("Content-Type", attachment.mimeType || "application/octet-stream");
    res.set("Content-Length", buffer.length);
    res.set("Content-Disposition", `inline; filename="${encodeURIComponent(attachment.originalName || "attachment")}"`);
    res.send(buffer);
  } catch (error) {
    next(error);
  }
};
