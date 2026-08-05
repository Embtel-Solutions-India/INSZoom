const Message = require("../../../models/Message");
const TimelineService = require("./TimelineService");
const NotificationOrchestrator = require("./NotificationOrchestrator");

class CommentService {
  static async addComment(caseData, payload, user, req) {
    const isInternal = payload.visibility === "internal" || payload.isInternal === true;
    const message = await Message.create({
      caseId: caseData._id,
      clientPortalId: caseData.clientPortalId,
      senderId: user._id,
      senderRole: user.role,
      sender: ["client", "employer", "finance"].includes(user.role) ? user.role : "case_manager",
      senderName: user.name || user.displayName || user.email,
      senderEmail: user.email,
      message: payload.comment || payload.message || payload.text,
      messageBody: payload.comment || payload.message || payload.text,
      isInternal,
      isInternalNote: isInternal,
      noteType: payload.noteType || (isInternal ? "internal" : "client"),
      category: payload.targetType || "case",
      labels: ["case-collaboration", payload.targetType, payload.targetId].filter(Boolean),
      priority: payload.priority || "medium",
      legacySource: "shared",
    });
    TimelineService.add(caseData, "comment", isInternal ? "Internal Comment Added" : "Comment Added", message.messageBody, user, {
      messageId: message._id,
      targetType: payload.targetType || "case",
      targetId: payload.targetId,
      internalOnly: isInternal,
    });
    TimelineService.addAudit(caseData, "comment_added", user, { messageId: message._id, targetType: payload.targetType }, req);
    await caseData.save();
    await TimelineService.writeAudit("COMMENT_ADDED", "Case", caseData._id, user, { messageId: message._id }, req);
    await NotificationOrchestrator.commentAdded(caseData, { _id: message._id, targetType: payload.targetType || "case", isInternal }, user, req);
    return message;
  }
}

module.exports = CommentService;
