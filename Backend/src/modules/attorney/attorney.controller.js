const mongoose = require("mongoose");
const Case = require("../../models/Case");
const User = require("../../models/User");
const Task = require("../../models/Task");
const Feedback = require("../../models/Feedback");
const caseService = require("../cases/case.service");
const attorneyTrends = require("./attorneyTrends.service");
const attorneyTimeline = require("./attorneyTimeline.service");
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
    // attorneyId is a plain id on lean reads and a populated user on documents loaded by the shared case service
    (entry) => entry.status === "active" && String(entry.attorneyId?._id || entry.attorneyId) === String(attorneyId)
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
  await Promise.all([
  Case.updateOne(
    { _id: caseId, attorneyAccess: { $elemMatch: { ...mine, engagedAt: { $exists: false } } } },
    { $set: { "attorneyAccess.$.engagedAt": now, "attorneyAccess.$.lastActivityAt": now } },
    { timestamps: false }
  ),
  Case.updateOne(
    { _id: caseId, attorneyAccess: { $elemMatch: { ...mine, $or: [{ lastActivityAt: { $exists: false } }, { lastActivityAt: { $lt: new Date(now - ACTIVITY_THROTTLE_MS) } }] } } },
    { $set: { "attorneyAccess.$.lastActivityAt": now } },
    { timestamps: false }
  ),
  ]);
}

// Fire-and-forget from other handlers: recording activity must never break the action it follows.
const touchActivityQuietly = (caseId, attorneyId) => touchActivity(caseId, attorneyId).catch(() => {});

exports.recordActivity = async (req, res, next) => {
  try {
    await touchActivity(req.params.caseId, req.user._id);
    if (req.body?.kind === "open") {
      attorneyTimeline.record({ caseId: req.params.caseId, attorneyId: req.user._id, type: "case_opened", title: "You opened the case", dedupeMinutes: 30 });
    }
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
    Case.find(filter).select(LIST_PROJECTION).sort(sort).skip(skip).limit(Math.min(Math.max(Number(limit), 1), 100)).lean(),
    Case.countDocuments(filter),
  ]);

  // Case-manager names and unread counts are independent: fetch them together instead of one after the other.
  const managerIds = [...new Set(cases.map((c) => c.assignedCaseManager).filter(Boolean).map(String))];
  const [unreadByCase, managers] = await Promise.all([
    feedbackService.unreadCountsByCase(cases.map((c) => c._id), attorneyId),
    managerIds.length ? User.find({ _id: { $in: managerIds } }).select("name displayName").lean() : [],
  ]);
  const managerById = new Map(managers.map((m) => [String(m._id), m]));
  for (const c of cases) c.assignedCaseManager = managerById.get(String(c.assignedCaseManager)) || null;
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

// Unread feedback for these cases, in ONE aggregation: the per-case counts (what the list badges add up to) and the
// date of the oldest message still waiting. Same "unread" rule as feedbackService.unreadCountsByCase. Ids are cast
// to ObjectIds because an aggregation bypasses Mongoose's schema casting.
async function unreadSummary(caseIds, attorneyId) {
  if (!caseIds.length) return { byCase: {}, oldestAt: null };
  const rows = await Feedback.aggregate([
    {
      $match: {
        caseId: { $in: caseIds.map((id) => new mongoose.Types.ObjectId(String(id))) },
        deletedAt: { $exists: false },
        "readBy.userId": { $ne: new mongoose.Types.ObjectId(String(attorneyId)) },
      },
    },
    { $group: { _id: "$caseId", count: { $sum: 1 }, oldest: { $min: "$createdAt" } } },
  ]);
  const byCase = Object.fromEntries(rows.map((row) => [String(row._id), row.count]));
  const oldestAt = rows.reduce((min, row) => (row.oldest && (!min || row.oldest < min) ? row.oldest : min), null);
  return { byCase, oldestAt };
}

// The dashboard costs two database round trips, not one per number: (1) this attorney's cases + their tasks in
// parallel, (2) one unread aggregation. Everything else - counts, recent list, charts, week-over-week trends - is
// worked out in memory from those. (Each round trip to the database is ~300 ms away, so the number of sequential
// queries, not their size, is what makes this page fast or slow.)
exports.getDashboard = async (req, res, next) => {
  try {
    const attorneyId = req.user._id;

    const [grantCases, tasks] = await Promise.all([
      // every case this attorney has (or had) a grant on: the active ones drive the page, revoked ones only feed the trends
      Case.find({ attorneyAccess: { $elemMatch: { attorneyId } } }).select(LIST_PROJECTION).lean(),
      Task.find({ assignedTo: attorneyId }).select("status dueDate").lean(),
    ]);
    const cases = grantCases.filter((c) => grantFor(c, attorneyId));
    const unread = await unreadSummary(cases.map((c) => c._id), attorneyId);

    const totalCases = cases.length;
    const activeCases = cases.filter((c) => c.status === "active").length;
    // Unread feedback is counted across every assigned case, not just the 5 shown - the dashboard number must match
    // what the case list badges add up to.
    const pendingFeedback = Object.values(unread.byCase).reduce((sum, count) => sum + count, 0);
    const recentCases = [...cases].sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)).slice(0, 5);

    // Chart data is purely additive: any failure here yields insights: null and the
    // dashboard's existing numbers/recent list are returned exactly as before.
    let insights = null;
    try {
      insights = buildDashboardInsights({ attorneyId, cases, grantCases, tasks, unread });
    } catch {
      insights = null;
    }

    res.json({
      success: true,
      stats: {
        totalCases,
        activeCases,
        pendingFeedback,
        recentCases: recentCases.map((caseDoc) => serializeListCase(caseDoc, attorneyId, unread.byCase)),
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

// "Reviewed" = the attorney pressed "Review complete" on the case (stored on their grant). Pure: no database access.
function buildDashboardInsights({ attorneyId, cases, grantCases, tasks, unread }) {
  const reviewed = cases.filter((c) => reviewFor(c, attorneyId).status === "reviewed").length;
  const workCounts = { assigned: 0, active: 0, reviewed: 0 };
  for (const c of cases) workCounts[workStateFor(c, attorneyId)] += 1;
  // Week-over-week trends are optional extras: if they fail, every other chart still renders.
  let trends = null;
  try {
    trends = attorneyTrends.computeTrends({ cases: grantCases, userId: attorneyId });
  } catch {
    trends = null;
  }

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
    oldestUnreadAt: unread.oldestAt || null,
    casesWithUnread: Object.keys(unread.byCase).filter((id) => unread.byCase[id] > 0).length,
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
// The case record for a case the guard already authorised. An employee slot reached through its parent matter is loaded directly (the shared access rule only knows a
// grant on the case itself); everything else keeps going through the shared loader and its own double check.
async function loadAuthorizedCase(req, { omit } = {}) {
  if (!req.accessViaParent) return caseService.getAccessibleCaseOrThrow(req.params.caseId, req.user, { omit });
  const query = Case.findById(req.params.caseId);
  if (omit && omit.length) query.select(omit.map((field) => `-${field}`).join(" "));
  const caseData = await caseService.populateCaseQuery(query);
  if (!caseData) throw Object.assign(new Error("Case not found"), { statusCode: 404 });
  return caseData;
}

exports.getCase = async (req, res, next) => {
  try {
    // A case document is ~520 KB (canonicalHistory alone ~400 KB) and every byte is paid for over the wire from the database.
    // None of the attorney screens read these five bulky fields (verified: no reference in Attorney/src, and serializing the
    // case without them changes only those keys), so they are left out - the staff case read already omits canonicalHistory
    // for the same reason (case.controller.js, CASE_OMIT_HISTORY; the full list is CASE_OMIT_LOOKUP in case.service.js).
    // questionnaireData (~12 KB) is kept: the Overview shows the visa variant the client chose (e.g. O-1A), exactly as Admin's does.
    // An employee / beneficiary slot has no attorney grant of its own - the attorney is assigned to the MATTER - so its "Assigned Staff" shows the matter's attorneys
    // (read alongside the slot, so no extra wait).
    const [caseData, parentGrants] = await Promise.all([
      loadAuthorizedCase(req, { omit: caseService.CASE_OMIT_LOOKUP.filter((field) => field !== "questionnaireData") }),
      req.accessViaParent
        ? Case.findById(req.accessViaParent).select("attorneyAccess").populate("attorneyAccess.attorneyId", "name displayName email role").lean()
        : null,
    ]);
    const serialized = caseService.serializeCaseForUser(caseData, req.user);
    if (parentGrants) serialized.attorneyAccess = parentGrants.attorneyAccess || [];
    res.json({
      success: true,
      viaParent: Boolean(req.accessViaParent),
      case: serialized,
      review: { ...reviewFor(req.authorizedCase || caseData, req.user._id), workState: workStateFor(req.authorizedCase || caseData, req.user._id) },
    });
  } catch (error) {
    handleError(error, next);
  }
};

// The employee / beneficiary slots of an employer matter (or the beneficiary of a family case): the same rows Admin's Overview lists, read-only. The attorney's
// grant is on the principal case, so these are summaries only - there is no way to open or change a child case from here.
exports.getChildren = async (req, res, next) => {
  try {
    // Fast path: the guard already read the matter (role, structure, owner, data-entry mode), so this makes ONE read of the slots and ONE more for the names / invite state,
    // instead of loading the whole matter with its ~15 lookups first. (Each database round trip costs ~300 ms; the number of sequential ones is what makes this fast or slow.)
    const principal = req.authorizedCase;
    if (principal.caseRole !== "principal") return res.json({ success: true, children: [], structure: principal.caseStructure || "" });
    const rows = await Case.find({ parentCase: principal._id })
      .select("caseNumber clientName clientEmail pendingEmployee employeeIdentity user visaType status caseRole childIndex createdAt petitionSubType employeeDataEntryMode assignedCaseManager")
      .sort({ childIndex: 1, createdAt: 1 })
      .lean();
    const principalUser = String(principal.user?._id || principal.user || "");
    const invitedIds = [...new Set(rows.map((row) => String(row.user?._id || row.user || "")).filter((id) => id && id !== principalUser))];
    const managerIds = [...new Set(rows.map((row) => String(row.assignedCaseManager || "")).filter(Boolean))];
    const [accounts, managers] = await Promise.all([
      invitedIds.length ? User.find({ _id: { $in: invitedIds } }).select("+password").lean() : [],
      managerIds.length ? User.find({ _id: { $in: managerIds } }).select("name displayName").lean() : [],
    ]);
    const accepted = new Set(accounts.filter((account) => account.password).map((account) => String(account._id)));
    const managerById = new Map(managers.map((manager) => [String(manager._id), manager]));
    const children = rows.map((child) => {
      const invited = Boolean(child.user) && String(child.user?._id || child.user) !== principalUser;
      const mode = child.employeeDataEntryMode || (invited ? "invite" : principal.dataEntryMode);
      const manager = managerById.get(String(child.assignedCaseManager || ""));
      return {
        _id: String(child._id),
        caseNumber: child.caseNumber,
        name: child.clientName || child.employeeIdentity?.name || child.pendingEmployee?.name || "",
        email: child.clientEmail || child.employeeIdentity?.email || child.pendingEmployee?.email || "",
        visaType: child.visaType || "",
        petitionSubType: child.petitionSubType || "",
        status: child.status,
        invited,
        inviteStatus: !invited ? "none" : accepted.has(String(child.user?._id || child.user)) ? "accepted" : "pending",
        employeeFills: mode === "invite",
        caseManagerName: manager?.name || manager?.displayName || "",
        createdAt: child.createdAt,
        childIndex: child.childIndex || "",
      };
    });
    res.json({ success: true, children, structure: principal.caseStructure || "" });
  } catch (error) {
    handleError(error, next);
  }
};

// USCIS tracking, exactly what Admin's USCIS Tracking tab shows (status, filing, RFE, notices, case timeline), read-only. Same service and same stored record Admin saves,
// so a change there is what is read here. Notice files are listed by name only - this portal does not open them.
exports.getTracking = async (req, res, next) => {
  try {
    const caseData = await Case.findById(req.params.caseId).select("immigrationLifecycle timeline");
    if (!caseData) return res.status(404).json({ success: false, message: "Case not found" });
    const result = await require("../immigration-lifecycle/services/TrackingService").get(caseData);
    res.json({
      success: true,
      data: {
        tracking: result.tracking,
        timeline: result.timeline,
        governmentDocuments: (result.governmentDocuments || []).map((doc) => ({ _id: doc._id, originalName: doc.originalName, documentType: doc.documentType, reviewStatus: doc.reviewStatus, createdAt: doc.createdAt })),
      },
    });
  } catch (error) {
    handleError(error, next);
  }
};

// The attorney's personal timeline of this case (see attorneyTimeline.service.js): assigned, opened, petition received / read, feedback given, review completed.
exports.getTimeline = async (req, res, next) => {
  try {
    const events = await attorneyTimeline.list({ caseId: req.params.caseId, attorneyId: req.user._id });
    res.json({ success: true, timeline: attorneyTimeline.compose({ grant: grantFor(req.authorizedCase, req.user._id), events }) });
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
      attorneyTimeline.record(reviewed
        ? { caseId: req.params.caseId, attorneyId: req.user._id, type: "review_completed", title: "Review completed", description: "You marked your review of this case complete." }
        : { caseId: req.params.caseId, attorneyId: req.user._id, type: "review_reopened", title: "Review reopened", description: "You reopened your review of this case." });
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
    attorneyTimeline.record({ caseId: req.params.caseId, attorneyId: req.user._id, type: "feedback_sent", title: "You sent feedback to the case manager", description: String(req.body?.message || "").trim().slice(0, 140) || "(attachment)" });
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
    attorneyTimeline.record({ caseId: req.params.caseId, attorneyId: req.user._id, type: "feedback_sent", title: "You sent feedback to the case manager", description: String(req.body?.message || "").trim().slice(0, 140) || "(attachment)" });
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
