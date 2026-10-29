const Case = require("../../models/Case");
const Task = require("../../models/Task");
const Feedback = require("../../models/Feedback");
const caseService = require("../cases/case.service");
const attorneyTrends = require("./attorneyTrends.service");
const feedbackService = require("../feedback/feedback.service");
const attorneyAccessService = require("./attorneyAccess.service");

function handleError(error, next) {
  return next(error);
}

// Fields the portal's list/dashboard views actually render — deliberately a
// narrow projection rather than the full case document (a Case averages
// ~160KB; see the collStats in docs/MONGODB_STARTUP_LOAD_FINDINGS.md).
const LIST_PROJECTION = "caseId caseNumber clientName clientEmail visaType visaCategory status stage priority attorneyAccess createdAt updatedAt caseStructure childCaseCount assignedCaseManager employeeContact";

function grantFor(caseDoc, attorneyId) {
  return (caseDoc.attorneyAccess || []).find(
    (entry) => entry.status === "active" && String(entry.attorneyId) === String(attorneyId)
  );
}

function assignedAtFor(caseDoc, attorneyId) {
  return grantFor(caseDoc, attorneyId)?.assignedAt || null;
}

// Grants created before the flag existed have no reviewStatus: they are "in_review".
function reviewFor(caseDoc, attorneyId) {
  const grant = grantFor(caseDoc, attorneyId);
  const reviewed = grant?.reviewStatus === "reviewed";
  return { status: reviewed ? "reviewed" : "in_review", reviewedAt: reviewed ? grant.reviewedAt || null : null };
}

// The attorney's own working state on a case (never the staff-owned case status):
//   assigned = no movement yet, active = they have done something on it, reviewed = they pressed "Review complete".
function workStateFor(caseDoc, attorneyId) {
  const grant = grantFor(caseDoc, attorneyId);
  if (grant?.reviewStatus === "reviewed") return "reviewed";
  return grant?.engagedAt ? "active" : "assigned";
}

const ACTIVITY_THROTTLE_MS = 60 * 1000;

// Marks "the attorney did something on this case". The first movement sets engagedAt (-> active);
// lastActivityAt is refreshed at most once a minute so a burst of clicks is one small write. Targeted
// updates with timestamps off: no other field is rewritten and the case's updatedAt (staff lists sort
// by it) is not bumped.
async function touchActivity(caseId, attorneyId) {
  const now = new Date();
  const mine = { attorneyId, status: "active" };
  await Case.updateOne(
    { _id: caseId, attorneyAccess: { $elemMatch: { ...mine, engagedAt: { $exists: false } } } },
    { $set: { "attorneyAccess.$.engagedAt": now, "attorneyAccess.$.lastActivityAt": now } },
    { timestamps: false }
  );
  await Case.updateOne(
    { _id: caseId, attorneyAccess: { $elemMatch: { ...mine, $or: [{ lastActivityAt: { $exists: false } }, { lastActivityAt: { $lt: new Date(now - ACTIVITY_THROTTLE_MS) } }] } } },
    { $set: { "attorneyAccess.$.lastActivityAt": now } },
    { timestamps: false }
  );
}

// Fire-and-forget from other handlers: recording activity must never break the action it follows.
const touchActivityQuietly = (caseId, attorneyId) => touchActivity(caseId, attorneyId).catch(() => {});

exports.recordActivity = async (req, res, next) => {
  try {
    await touchActivity(req.params.caseId, req.user._id);
    // Any movement makes an untouched case active; a case already marked reviewed stays reviewed.
    res.json({ success: true, workState: workStateFor(req.authorizedCase, req.user._id) === "reviewed" ? "reviewed" : "active" });
  } catch (error) {
    handleError(error, next);
  }
};

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
    reviewStatus: reviewFor(caseDoc, attorneyId).status,
    workState: workStateFor(caseDoc, attorneyId),
    clientEmail: caseDoc.clientEmail || caseDoc.employeeContact?.email || "",
    caseStructure: caseDoc.caseStructure,
    employeeCount: caseDoc.caseStructure === "employer_employee" ? caseDoc.childCaseCount || 0 : 0,
    caseManagerName: caseDoc.assignedCaseManager?.name || caseDoc.assignedCaseManager?.displayName || "",
    createdAt: caseDoc.createdAt,
    unreadFeedback: unreadByCase[String(caseDoc._id)] || 0,
    updatedAt: caseDoc.updatedAt,
  };
}

const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Single query for the page of cases + one aggregation for unread counts
// across exactly that page — no per-case follow-up queries.
// Optional extras for the cases page (all additive - a call without them behaves exactly as before):
//   search     case number / client / email / visa type
//   group      "corporations" (employer cases) or "clients" (everything else)
//   sortOrder  "asc" | "desc" by creation date; omitted keeps the original most-recently-updated order
async function loadAttorneyCases(attorneyId, { page = 1, limit = 25, status, search, group, sortOrder } = {}) {
  const filter = { attorneyAccess: { $elemMatch: { attorneyId, status: "active" } } };
  if (status) filter.status = status;
  const and = [];
  const term = String(search || "").trim().slice(0, 100);
  if (term) {
    const rx = new RegExp(escapeRegex(term), "i");
    and.push({ $or: [{ caseNumber: rx }, { caseId: rx }, { clientName: rx }, { clientEmail: rx }, { visaType: rx }] });
  }
  if (group === "corporations") and.push({ caseStructure: "employer_employee" });
  else if (group === "clients") and.push({ caseStructure: { $ne: "employer_employee" } });
  if (and.length) filter.$and = and;
  const sort = sortOrder === "asc" ? { createdAt: 1 } : sortOrder === "desc" ? { createdAt: -1 } : { updatedAt: -1 };

  const skip = (Math.max(Number(page), 1) - 1) * Math.min(Math.max(Number(limit), 1), 100);
  const [cases, total] = await Promise.all([
    Case.find(filter).select(LIST_PROJECTION).populate("assignedCaseManager", "name displayName").sort(sort).skip(skip).limit(Math.min(Math.max(Number(limit), 1), 100)).lean(),
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

    // Chart data is purely additive: any failure here yields insights: null and the
    // dashboard's existing numbers/recent list are returned exactly as before.
    const insights = await buildDashboardInsights(attorneyId, baseFilter, unreadByCase).catch(() => null);

    res.json({
      success: true,
      stats: {
        totalCases,
        activeCases,
        pendingFeedback,
        recentCases: recentCaseDocs.map((caseDoc) => serializeListCase(caseDoc, attorneyId, unreadByCase)),
      },
      insights,
    });
  } catch (error) {
    handleError(error, next);
  }
};

const MONTHS_SHOWN = 6;

function tally(items, keyOf) {
  const counts = new Map();
  for (const item of items) {
    const key = keyOf(item) || "unknown";
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
}

// "Reviewed" = the attorney pressed "Review complete" on the case (stored on their grant).
async function buildDashboardInsights(attorneyId, baseFilter, unreadByCase) {
  const [cases, tasks] = await Promise.all([
    Case.find(baseFilter).select("status visaType priority attorneyAccess createdAt").lean(),
    Task.find({ assignedTo: attorneyId }).select("status dueDate").lean(),
  ]);
  // The oldest message still waiting for this attorney (same "unread" rule as the badge counts).
  const oldestUnread = cases.length
    ? await Feedback.findOne({ caseId: { $in: cases.map((c) => c._id) }, deletedAt: { $exists: false }, "readBy.userId": { $ne: attorneyId } })
        .sort({ createdAt: 1 })
        .select("createdAt")
        .lean()
    : null;
  const reviewed = cases.filter((c) => reviewFor(c, attorneyId).status === "reviewed").length;
  const workCounts = { assigned: 0, active: 0, reviewed: 0 };
  for (const c of cases) workCounts[workStateFor(c, attorneyId)] += 1;
  // Week-over-week trends are optional extras: if they fail, every other chart still renders.
  const trends = await attorneyTrends.loadTrends(attorneyId).catch(() => null);

  const now = new Date();
  const months = [];
  for (let i = MONTHS_SHOWN - 1; i >= 0; i -= 1) {
    const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({ key: `${start.getFullYear()}-${start.getMonth()}`, label: start.toLocaleString("en-US", { month: "short" }), value: 0 });
  }
  for (const c of cases) {
    const d = new Date(assignedAtFor(c, attorneyId) || c.createdAt);
    const slot = months.find((m) => m.key === `${d.getFullYear()}-${d.getMonth()}`);
    if (slot) slot.value += 1;
  }

  const openTasks = tasks.filter((t) => !["completed", "cancelled"].includes(t.status));
  return {
    trends,
    reviewed: { reviewed, notReviewed: cases.length - reviewed },
    workCounts,
    byStatus: tally(cases, (c) => workStateFor(c, attorneyId)),
    byVisaType: tally(cases, (c) => c.visaType).slice(0, 8),
    byPriority: tally(cases, (c) => c.priority),
    assignedByMonth: months.map(({ label, value }) => ({ label, value })),
    oldestUnreadAt: oldestUnread?.createdAt || null,
    casesWithUnread: Object.keys(unreadByCase).filter((id) => unreadByCase[id] > 0).length,
    tasks: {
      open: openTasks.length,
      completed: tasks.filter((t) => t.status === "completed").length,
      overdue: openTasks.filter((t) => t.dueDate && new Date(t.dueDate) < now).length,
      byStatus: tally(tasks, (t) => t.status),
    },
  };
}

// req.authorizedCase is set by requireAttorneyAccess — but it's a lean-ish
// projection, so the full serialized case still goes through the same
// service the staff portals use (getAccessibleCaseOrThrow re-checks access
// via canAccessCase, which is attorney-aware; the double check is
// intentional defense in depth, not redundancy to remove).
exports.getCase = async (req, res, next) => {
  try {
    const caseData = await caseService.getAccessibleCaseOrThrow(req.params.caseId, req.user);
    res.json({
      success: true,
      case: caseService.serializeCaseForUser(caseData, req.user),
      review: { ...reviewFor(req.authorizedCase || caseData, req.user._id), workState: workStateFor(req.authorizedCase || caseData, req.user._id) },
    });
  } catch (error) {
    handleError(error, next);
  }
};

// The attorney marks their own review of a case complete (or reopens it). Only this attorney's
// grant is touched, via a targeted update with timestamps off so the case's updatedAt (which the
// staff case lists sort by) is not bumped and no other field is rewritten.
function setReview(reviewed) {
  return async (req, res, next) => {
    try {
      const reviewedAt = reviewed ? new Date() : null;
      const result = await Case.updateOne(
        { _id: req.params.caseId, attorneyAccess: { $elemMatch: { attorneyId: req.user._id, status: "active" } } },
        { $set: { "attorneyAccess.$.reviewStatus": reviewed ? "reviewed" : "in_review", "attorneyAccess.$.reviewedAt": reviewedAt } },
        { timestamps: false }
      );
      if (!result.matchedCount) return res.status(403).json({ success: false, message: "Access denied to this case" });
      if (reviewed) touchActivityQuietly(req.params.caseId, req.user._id);
      res.json({ success: true, review: { status: reviewed ? "reviewed" : "in_review", reviewedAt } });
    } catch (error) {
      handleError(error, next);
    }
  };
}
exports.completeReview = setReview(true);
exports.reopenReview = setReview(false);

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
      clientMessageId: req.body.clientMessageId,
      uploadIds: req.body.uploadIds,
      files: req.files || [],
    });
    touchActivityQuietly(req.params.caseId, req.user._id);
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
      clientMessageId: req.body.clientMessageId,
      uploadIds: req.body.uploadIds,
      parentFeedbackId: req.params.feedbackId,
      files: req.files || [],
    });
    touchActivityQuietly(req.params.caseId, req.user._id);
    res.status(201).json({ success: true, feedback });
  } catch (error) {
    handleError(error, next);
  }
};

exports.editFeedback = async (req, res, next) => {
  try {
    const feedback = await feedbackService.editFeedback({ caseId: req.params.caseId, feedbackId: req.params.feedbackId, author: req.user, message: req.body.message });
    res.json({ success: true, feedback });
  } catch (error) {
    handleError(error, next);
  }
};

exports.deleteFeedbackForEveryone = async (req, res, next) => {
  try {
    const feedback = await feedbackService.deleteFeedbackForEveryone({ caseId: req.params.caseId, feedbackId: req.params.feedbackId, author: req.user });
    res.json({ success: true, feedback });
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
