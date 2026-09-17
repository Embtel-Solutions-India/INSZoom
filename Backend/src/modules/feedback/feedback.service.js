const mongoose = require("mongoose");
const Feedback = require("../../models/Feedback");
const Case = require("../../models/Case");
const notificationService = require("../notifications/notification.service");
const storageService = require("../uploads/storage.service");
const logger = require("../../utils/logger");

// Attorney <-> Case Manager dialogue on a case. The counterpart resolution
// below is the whole point of this module: whoever did NOT write the
// message is the one who needs to hear about it.
//
// Notification + push are deliberately NOT awaited by the caller's request
// path (see createFeedback's .catch) — a push provider being down must
// never fail the attorney's "send" action. notificationService
// .createNotification() is the single entry point for BOTH in-app and
// push (it owns dispatchPushChannel); this module never calls
// push.service.js directly, per that module's own "one call site" contract.

function isAttorneyRole(role) {
  return role === "attorney";
}

// Who should be notified about a message authored by `author` on this case.
// Attorney writes  -> the case's assigned case manager.
// Case Manager (or any staff) writes -> the case's active attorney(s).
async function resolveRecipients(caseDoc, author, parentFeedback) {
  // A reply always goes back to whoever wrote the message being replied to,
  // regardless of role — that's the person actually waiting on an answer.
  if (parentFeedback && String(parentFeedback.authorId) !== String(author._id)) {
    return [parentFeedback.authorId];
  }

  if (isAttorneyRole(author.role)) {
    return [caseDoc.assignedCaseManager].filter(Boolean);
  }

  return (caseDoc.attorneyAccess || [])
    .filter((grant) => grant.status === "active")
    .map((grant) => grant.attorneyId)
    .filter(Boolean);
}

function previewOf(message, attachmentCount = 0) {
  const trimmed = String(message || "").trim();
  if (!trimmed) return attachmentCount ? `Sent ${attachmentCount} attachment${attachmentCount > 1 ? "s" : ""}` : "";
  return trimmed.length > 100 ? `${trimmed.slice(0, 100)}…` : trimmed;
}

// Same field shape message.service.js's storeAttachments() produces — kept
// as this module's own copy since that helper isn't exported for reuse
// (see this module's header comment). Both wrap the same underlying
// storage.service.js, so there is exactly one place file bytes actually
// touch S3/disk.
async function storeAttachments(files = [], { caseId, userId }) {
  const attachments = [];
  for (const file of files) {
    const key = storageService.generateDocumentKey({ caseId, userId, originalName: file.originalname }).replace("documents", "feedback");
    const stored = await storageService.storeBuffer(key, file.buffer);
    attachments.push({
      originalName: file.originalname,
      fileUrl: stored.url,
      fileSize: file.size,
      mimeType: file.mimetype,
      storageProvider: stored.provider,
      storageKey: stored.key,
      checksum: stored.checksum,
    });
  }
  return attachments;
}

async function notifyRecipients({ recipients, caseDoc, author, feedback, isReply }) {
  const caseLabel = caseDoc.caseNumber || caseDoc.caseId || String(caseDoc._id);
  const authorLabel = author.displayName || author.name || (isAttorneyRole(author.role) ? "The attorney" : "The case manager");

  await Promise.all(
    recipients.map((userId) =>
      notificationService
        .createNotification(
          {
            userId,
            type: "attorney_feedback",
            category: "general",
            title: isReply ? `New reply on ${caseLabel}` : `New feedback on ${caseLabel}`,
            message: `${authorLabel}: ${previewOf(feedback.message, feedback.attachments?.length)}`,
            caseId: caseDoc._id,
            // Deep link target, resolved per-origin (relative) — the
            // RECIPIENT's app, which is always the opposite side from
            // whoever authored this message (attorney writes -> the case
            // manager reads it in Admin; staff writes -> the attorney
            // reads it in the Attorney Portal). Admin has no dedicated
            // route for this — it surfaces via the "Attorney Messages"
            // panel already on the case detail page, so the link is that
            // page itself (/crm-cases/:id); the attorney portal's own
            // /messages/:caseId is a real dedicated route.
            link: isAttorneyRole(author.role) ? `/crm-cases/${caseDoc._id}` : `/messages/${caseDoc._id}`,
            channels: ["in_app", "socket", "push"],
            metadata: { feedbackId: feedback._id, caseId: caseDoc._id },
            source: "shared",
          },
          author
        )
        .catch((error) => logger.error("attorney_feedback_notification_failed", { error, userId: String(userId) }))
    )
  );
}

async function listFeedback(caseId) {
  return Feedback.find({ caseId, deletedAt: { $exists: false } })
    .sort({ createdAt: 1 })
    .populate("authorId", "name displayName email role")
    .lean();
}

async function createFeedback({ caseId, author, message, parentFeedbackId = null, files = [] }) {
  const caseDoc = await Case.findById(caseId).select("_id caseId caseNumber assignedCaseManager attorneyAccess");
  if (!caseDoc) {
    const error = new Error("Case not found");
    error.status = 404;
    throw error;
  }

  if (!message?.trim() && !files.length) {
    const error = new Error("Message text or an attachment is required");
    error.status = 400;
    throw error;
  }

  let parentFeedback = null;
  if (parentFeedbackId) {
    if (!mongoose.Types.ObjectId.isValid(parentFeedbackId)) {
      const error = new Error("Invalid parent feedback id");
      error.status = 400;
      throw error;
    }
    parentFeedback = await Feedback.findOne({ _id: parentFeedbackId, caseId, deletedAt: { $exists: false } });
    if (!parentFeedback) {
      const error = new Error("Parent feedback not found on this case");
      error.status = 404;
      throw error;
    }
  }

  const attachments = await storeAttachments(files, { caseId: caseDoc._id, userId: author._id });

  const feedback = await Feedback.create({
    caseId: caseDoc._id,
    authorId: author._id,
    authorRole: author.role,
    message: message?.trim() || "",
    parentFeedbackId: parentFeedback?._id || null,
    attachments,
    // The author has by definition read their own message — this keeps
    // unread counts from counting a user's own messages against them.
    readBy: [{ userId: author._id, readAt: new Date() }],
  });

  const recipients = await resolveRecipients(caseDoc, author, parentFeedback);
  // Fire-and-forget: the send must succeed for the author even if every
  // recipient's notification fails.
  notifyRecipients({ recipients, caseDoc, author, feedback, isReply: Boolean(parentFeedback) }).catch((error) =>
    logger.error("attorney_feedback_notify_failed", { error, feedbackId: String(feedback._id) })
  );

  return Feedback.findById(feedback._id).populate("authorId", "name displayName email role").lean();
}

// Marks every message on the case that this user hasn't already read.
async function markCaseFeedbackRead(caseId, userId) {
  const result = await Feedback.updateMany(
    { caseId, deletedAt: { $exists: false }, "readBy.userId": { $ne: userId } },
    { $push: { readBy: { userId, readAt: new Date() } } }
  );
  return { marked: result.modifiedCount };
}

// Unread count for one user across an explicit set of cases — one query,
// no per-case N+1 (used by both the attorney dashboard and the case list's
// unread badge).
async function unreadCountsByCase(caseIds, userId) {
  if (!caseIds.length) return {};
  // Aggregation bypasses Mongoose's schema casting — ids must already be
  // ObjectIds here or every $match silently returns nothing.
  const ids = caseIds.map((id) => new mongoose.Types.ObjectId(String(id)));
  const readerId = new mongoose.Types.ObjectId(String(userId));
  const rows = await Feedback.aggregate([
    { $match: { caseId: { $in: ids }, deletedAt: { $exists: false }, "readBy.userId": { $ne: readerId } } },
    { $group: { _id: "$caseId", count: { $sum: 1 } } },
  ]);
  return Object.fromEntries(rows.map((row) => [String(row._id), row.count]));
}

// Caller (attorney.controller.js / feedback.controller.js) has already run
// its own case-access check before calling this — this just resolves the
// stored bytes, it isn't a second authorization gate.
async function getFeedbackAttachment(caseId, feedbackId, attachmentId) {
  const feedback = await Feedback.findOne({ _id: feedbackId, caseId, deletedAt: { $exists: false } }).lean();
  if (!feedback) {
    const error = new Error("Message not found");
    error.status = 404;
    throw error;
  }
  const attachment = (feedback.attachments || []).find((item) => String(item._id) === String(attachmentId));
  if (!attachment) {
    const error = new Error("Attachment not found");
    error.status = 404;
    throw error;
  }
  const buffer = await storageService.readBuffer(attachment.storageKey);
  return { buffer, attachment };
}

module.exports = {
  createFeedback,
  listFeedback,
  markCaseFeedbackRead,
  unreadCountsByCase,
  getFeedbackAttachment,
};
