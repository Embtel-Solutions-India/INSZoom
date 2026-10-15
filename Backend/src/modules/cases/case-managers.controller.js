const Case = require("../../models/Case");
const CaseAssignmentEvent = require("../../models/CaseAssignmentEvent");
const Conversation = require("../../models/Conversation");
const caseCtrl = require("./case.controller");
const caseService = require("./case.service");
const svc = require("./case-managers.service");
const { allCaseManagerIds } = require("./caseManagerAccess");
const notificationService = require("../notifications/notification.service");
const realtimeGateway = require("../realtime/realtime.gateway");

// Add / remove ADDITIONAL case managers on a case (the primary is changed through assign-case-manager). Admin, super admin
// and team lead only - enforced at the route. Everything after the save (emails, messaging, realtime) runs after the
// response and never fails an assignment that already committed, same as assignCaseManager.

const { canAssignCase, syncCaseMessagingAssignment, notifyAssignee, runAfterResponse } = caseCtrl.teamHelpers;

// Tells every case manager already on the case (plus the team lead) that the team changed, so open pages refresh without a reload.
function emitTeamUpdated(caseData, extraUserIds = []) {
  const recipients = new Set([...allCaseManagerIds(caseData), caseData.assignedTeamLead && String(caseData.assignedTeamLead), ...extraUserIds.map(String)].filter(Boolean));
  recipients.forEach((userId) => realtimeGateway.emitToUser(userId, "case:team_updated", { _id: caseData._id, caseNumber: caseData.caseNumber }));
}

async function respondWithCase(req, res, caseId, extra = {}) {
  const fresh = await caseService.populateCaseQuery(Case.findById(caseId));
  res.json({ success: true, case: caseService.serializeCaseForUser(fresh, req.user), ...extra });
}

exports.addCaseManager = async (req, res, next) => {
  try {
    const caseData = await Case.findById(req.params.id);
    if (!caseData) return res.status(404).json({ success: false, message: "Case not found" });
    if (!canAssignCase(req.user, caseData)) return res.status(403).json({ success: false, message: "Not authorized to assign this case" });

    const { user: assignee, error: userError } = await svc.findAssignableCaseManager(req.body.caseManagerId);
    if (userError) return res.status(400).json({ success: false, message: userError });
    const added = svc.addAdditionalCaseManager(caseData, assignee._id, req.user, req.body.notes);
    if (added.error) return res.status(400).json({ success: false, message: added.error });

    caseData.lastModifiedBy = req.user._id;
    await caseData.save();

    runAfterResponse("addCaseManager", [
      () => CaseAssignmentEvent.create({ caseId: caseData._id, role: "case_manager", fromManagerId: null, toManagerId: assignee._id, reassignedById: req.user._id, reason: "Added as additional case manager", caseStatusAtReassignment: caseData.status }),
      () => syncCaseMessagingAssignment(caseData),
      () => caseService.writeAuditLog("add_case_manager", caseData, req.user, { caseManagerId: assignee._id }, req),
      // The in-app notification, "case:assigned" realtime push and the "you have been assigned" email all come from notifyAssignee.
      () => notifyAssignee(assignee._id, caseData, "case_manager", req.user, req),
      () => emitTeamUpdated(caseData),
    ]);
    const childrenCascaded = await svc.cascadeToChildren(caseData, assignee._id, "add").catch((error) => {
      console.error("[addCaseManager] Cascade to children failed (non-fatal):", error.message);
      return 0;
    });
    await respondWithCase(req, res, caseData._id, { childrenCascaded });
  } catch (error) {
    next(error);
  }
};

exports.removeCaseManager = async (req, res, next) => {
  try {
    const caseData = await Case.findById(req.params.id);
    if (!caseData) return res.status(404).json({ success: false, message: "Case not found" });
    if (!canAssignCase(req.user, caseData)) return res.status(403).json({ success: false, message: "Not authorized to assign this case" });

    const removedId = req.params.userId;
    const removed = svc.removeAdditionalCaseManager(caseData, removedId, req.user);
    if (removed.error) return res.status(400).json({ success: false, message: removed.error });

    caseData.lastModifiedBy = req.user._id;
    await caseData.save();

    runAfterResponse("removeCaseManager", [
      () => syncCaseMessagingAssignment(caseData),
      async () => {
        const conversation = await Conversation.findOne({ caseId: caseData._id, type: "case", deletedAt: { $exists: false } });
        if (conversation) realtimeGateway.evictUserFromConversation(removedId, conversation._id);
      },
      () => caseService.writeAuditLog("remove_case_manager", caseData, req.user, { caseManagerId: removedId }, req),
      async () => {
        await notificationService.dismissCaseNotificationsForUser(caseData._id, removedId).catch(() => {});
        await notificationService.createNotification({
          userId: removedId,
          type: "case_reassigned",
          title: "Removed From Case",
          message: `You have been removed as a case manager on case ${caseData.caseNumber || caseData.caseId}. You no longer have access to it.`,
          caseId: caseData._id,
          priority: "low",
          metadata: { assignmentRole: "case_manager", additional: true },
        }, req.user, req).catch(() => {});
        realtimeGateway.emitToUser(removedId, "case:unassigned", { _id: caseData._id, caseNumber: caseData.caseNumber, assignmentRole: "case_manager" });
      },
      () => emitTeamUpdated(caseData),
    ]);
    const childrenCascaded = await svc.cascadeToChildren(caseData, removedId, "remove").catch((error) => {
      console.error("[removeCaseManager] Cascade to children failed (non-fatal):", error.message);
      return 0;
    });
    await respondWithCase(req, res, caseData._id, { childrenCascaded });
  } catch (error) {
    next(error);
  }
};
