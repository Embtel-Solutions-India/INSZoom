const Case = require("../../models/Case");
const caseService = require("../cases/case.service");
const feedbackService = require("../feedback/feedback.service");
const attorneyAccessService = require("./attorneyAccess.service");

function handleError(error, next) {
  return next(error);
}

// Fields the portal's list/dashboard views actually render — deliberately a
// narrow projection rather than the full case document (a Case averages
// ~160KB; see the collStats in docs/MONGODB_STARTUP_LOAD_FINDINGS.md).
const LIST_PROJECTION = "caseId caseNumber clientName clientEmail visaType visaCategory status stage priority attorneyAccess createdAt updatedAt";

function assignedAtFor(caseDoc, attorneyId) {
  const grant = (caseDoc.attorneyAccess || []).find(
    (entry) => entry.status === "active" && String(entry.attorneyId) === String(attorneyId)
  );
  return grant?.assignedAt || null;
}

function serializeListCase(caseDoc, attorneyId, unreadByCase) {
  return {
    _id: caseDoc._id,
    caseId: caseDoc.caseId,
    caseNumber: caseDoc.caseNumber,
    clientName: caseDoc.clientName,
    visaType: caseDoc.visaType,
    visaCategory: caseDoc.visaCategory,
    status: caseDoc.status,
    stage: caseDoc.stage,
    priority: caseDoc.priority,
    assignedAt: assignedAtFor(caseDoc, attorneyId),
    unreadFeedback: unreadByCase[String(caseDoc._id)] || 0,
    updatedAt: caseDoc.updatedAt,
  };
}

// Single query for the page of cases + one aggregation for unread counts
// across exactly that page — no per-case follow-up queries.
async function loadAttorneyCases(attorneyId, { page = 1, limit = 25, status } = {}) {
  const filter = { attorneyAccess: { $elemMatch: { attorneyId, status: "active" } } };
  if (status) filter.status = status;

  const skip = (Math.max(Number(page), 1) - 1) * Math.min(Math.max(Number(limit), 1), 100);
  const [cases, total] = await Promise.all([
    Case.find(filter).select(LIST_PROJECTION).sort({ updatedAt: -1 }).skip(skip).limit(Math.min(Math.max(Number(limit), 1), 100)).lean(),
    Case.countDocuments(filter),
  ]);

  const unreadByCase = await feedbackService.unreadCountsByCase(cases.map((c) => c._id), attorneyId);
  return { cases, total, unreadByCase };
}

exports.listCases = async (req, res, next) => {
  try {
    const { cases, total, unreadByCase } = await loadAttorneyCases(req.user._id, req.query);
    res.json({
      success: true,
      cases: cases.map((caseDoc) => serializeListCase(caseDoc, req.user._id, unreadByCase)),
      total,
    });
  } catch (error) {
    handleError(error, next);
  }
};

exports.getDashboard = async (req, res, next) => {
  try {
    const attorneyId = req.user._id;
    const baseFilter = { attorneyAccess: { $elemMatch: { attorneyId, status: "active" } } };

    const [totalCases, activeCases, recentCaseDocs] = await Promise.all([
      Case.countDocuments(baseFilter),
      Case.countDocuments({ ...baseFilter, status: "active" }),
      Case.find(baseFilter).select(LIST_PROJECTION).sort({ updatedAt: -1 }).limit(5).lean(),
    ]);

    // Unread feedback is counted across every assigned case, not just the 5
    // shown — the dashboard number must match what the case list badges add
    // up to.
    const allCaseIds = await Case.find(baseFilter).select("_id").lean();
    const unreadByCase = await feedbackService.unreadCountsByCase(allCaseIds.map((c) => c._id), attorneyId);
    const pendingFeedback = Object.values(unreadByCase).reduce((sum, count) => sum + count, 0);

    res.json({
      success: true,
      stats: {
        totalCases,
        activeCases,
        pendingFeedback,
        recentCases: recentCaseDocs.map((caseDoc) => serializeListCase(caseDoc, attorneyId, unreadByCase)),
      },
    });
  } catch (error) {
    handleError(error, next);
  }
};

// req.authorizedCase is set by requireAttorneyAccess — but it's a lean-ish
// projection, so the full serialized case still goes through the same
// service the staff portals use (getAccessibleCaseOrThrow re-checks access
// via canAccessCase, which is attorney-aware; the double check is
// intentional defense in depth, not redundancy to remove).
exports.getCase = async (req, res, next) => {
  try {
    const caseData = await caseService.getAccessibleCaseOrThrow(req.params.caseId, req.user);
    res.json({ success: true, case: caseService.serializeCaseForUser(caseData, req.user) });
  } catch (error) {
    handleError(error, next);
  }
};

exports.listFeedback = async (req, res, next) => {
  try {
    const items = await feedbackService.listFeedback(req.params.caseId);
    res.json({ success: true, feedback: items });
  } catch (error) {
    handleError(error, next);
  }
};

exports.createFeedback = async (req, res, next) => {
  try {
    const feedback = await feedbackService.createFeedback({
      caseId: req.params.caseId,
      author: req.user,
      message: req.body.message,
      files: req.files || [],
    });
    res.status(201).json({ success: true, feedback });
  } catch (error) {
    handleError(error, next);
  }
};

exports.replyToFeedback = async (req, res, next) => {
  try {
    const feedback = await feedbackService.createFeedback({
      caseId: req.params.caseId,
      author: req.user,
      message: req.body.message,
      parentFeedbackId: req.params.feedbackId,
      files: req.files || [],
    });
    res.status(201).json({ success: true, feedback });
  } catch (error) {
    handleError(error, next);
  }
};

exports.markFeedbackRead = async (req, res, next) => {
  try {
    const result = await feedbackService.markCaseFeedbackRead(req.params.caseId, req.user._id);
    res.json({ success: true, ...result });
  } catch (error) {
    handleError(error, next);
  }
};

exports.getFeedbackAttachment = async (req, res, next) => {
  try {
    const { buffer, attachment } = await feedbackService.getFeedbackAttachment(req.params.caseId, req.params.feedbackId, req.params.attachmentId);
    res.set("Content-Type", attachment.mimeType || "application/octet-stream");
    res.set("Content-Length", buffer.length);
    res.set("Content-Disposition", `inline; filename="${encodeURIComponent(attachment.originalName || "attachment")}"`);
    res.send(buffer);
  } catch (error) {
    handleError(error, next);
  }
};

// ── Case Manager / Admin side (mounted under /api/cases) ──────────────────

exports.getCaseAttorneyAccess = async (req, res, next) => {
  try {
    const access = await attorneyAccessService.listAccess(req.params.caseId);
    res.json({ success: true, attorneyAccess: access });
  } catch (error) {
    handleError(error, next);
  }
};

exports.setCaseAttorneyAccess = async (req, res, next) => {
  try {
    const access = await attorneyAccessService.setAccess({
      caseId: req.params.caseId,
      attorneyId: req.body.attorneyId,
      action: req.body.action,
      actor: req.user,
      req,
    });
    res.json({ success: true, attorneyAccess: access });
  } catch (error) {
    handleError(error, next);
  }
};
