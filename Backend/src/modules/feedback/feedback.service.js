const mongoose = require("mongoose");
const Feedback = require("../../models/Feedback");
const Case = require("../../models/Case");
const notificationService = require("../notifications/notification.service");
const storageService = require("../uploads/storage.service");
const chunkedUploads = require("../chunked-uploads/chunkedUpload.service");
const realtimeGateway = require("../realtime/realtime.gateway");
const logger = require("../../utils/logger");
const { allCaseManagerIds } = require("../cases/caseManagerAccess");

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
// Attorney writes  -> every case manager on the case.
// Case Manager (or any staff) writes -> the case's active attorney(s).
async function resolveRecipients(caseDoc, author, parentFeedback) {
  // A reply always goes back to whoever wrote the message being replied to,
  // regardless of role — that's the person actually waiting on an answer.
  if (parentFeedback && String(parentFeedback.authorId) !== String(author._id)) {
    return [parentFeedback.authorId];
  }

  if (isAttorneyRole(author.role)) {
    return allCaseManagerIds(caseDoc);
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

  // Live thread append (mirrors message.service.js's own "message:new"
  // pattern) — separate from the notification below, which only ever
  // carries a text preview. This carries the real, fully-populated Feedback
  // document so an open thread on the recipient's side can append it
  // directly, with no reload/re-fetch needed to see a new message land.
  recipients.forEach((userId) => realtimeGateway.emitToUser(userId, "feedback:new", feedback));

  // Push (author's name on top, then the message), the in-app alert, and an email if the recipient is offline.
  await require("../notifications/messageAlert.service").notifyNewMessage({
    recipientIds: recipients,
    sender: author,
    caseId: caseDoc._id,
    caseNumber: caseLabel,
    text: feedback.message,
    attachmentCount: feedback.attachments?.length || 0,
    // Deep link into the RECIPIENT's app (opposite side of whoever wrote it).
    link: isAttorneyRole(author.role) ? `/crm-cases/${caseDoc._id}` : `/messages/${caseDoc._id}`,
    kind: "feedback",
    conversationId: caseDoc._id,
    messageId: feedback._id,
  });
}

async function listFeedback(caseId) {
  return Feedback.find({ caseId, deletedAt: { $exists: false } })
    .sort({ createdAt: 1 })
    .populate("authorId", "name displayName email role")
    .lean();
}

async function findByClientMessageId(authorId, clientMessageId) {
  return Feedback.findOne({ authorId, clientMessageId }).populate("authorId", "name displayName email role").lean();
}

async function createFeedback({ caseId, author, message, parentFeedbackId = null, files: multipartFiles = [], clientMessageId = null, uploadIds = null }) {
  let files = multipartFiles;
  const stagedIds = chunkedUploads.normalizeUploadIds(uploadIds);
  clientMessageId = typeof clientMessageId === "string" && clientMessageId.trim() ? clientMessageId.trim().slice(0, 64) : null;
  // A retry of a send that already landed: hand back the stored message, don't post it twice.
  if (clientMessageId) {
    const existing = await findByClientMessageId(author._id, clientMessageId);
    if (existing) return existing;
  }

  const caseDoc = await Case.findById(caseId).select("_id caseId caseNumber assignedCaseManager additionalCaseManagers attorneyAccess");
  if (!caseDoc) {
    const error = new Error("Case not found");
    error.status = 404;
    throw error;
  }

  if (!message?.trim() && !files.length && !stagedIds.length) {
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

  // Big files arrive ahead of the message through the chunked-upload API and are referenced here by id.
  if (stagedIds.length) files = [...multipartFiles, ...(await chunkedUploads.loadStaged(author._id, stagedIds))];
  const attachments = await storeAttachments(files, { caseId: caseDoc._id, userId: author._id });

  let feedback;
  try {
    feedback = await Feedback.create({
      caseId: caseDoc._id,
      authorId: author._id,
      authorRole: author.role,
      message: message?.trim() || "",
      parentFeedbackId: parentFeedback?._id || null,
      attachments,
      ...(clientMessageId ? { clientMessageId } : {}),
      // The author has by definition read their own message — this keeps
      // unread counts from counting a user's own messages against them.
      readBy: [{ userId: author._id, readAt: new Date() }],
    });
  } catch (error) {
    // Two copies of the same send raced each other; the other one won.
    if (error?.code === 11000 && clientMessageId) {
      const existing = await findByClientMessageId(author._id, clientMessageId);
      if (existing) return existing;
    }
    throw error;
  }

  if (stagedIds.length) chunkedUploads.discard(stagedIds); // the bytes now live in permanent storage
  const recipients = await resolveRecipients(caseDoc, author, parentFeedback);
  // Populated for the live socket append (see notifyRecipients) - `feedback`
  // itself only has a bare authorId ObjectId (Feedback.create()'s own
  // return value is never populated), which would render as "Unknown" on a
  // recipient's screen until their next reload. Built from `author` (the
  // full req.user already in scope) rather than a second DB round-trip.
  const populatedFeedback = {
    ...feedback.toObject(),
    authorId: { _id: author._id, name: author.name, displayName: author.displayName, email: author.email, role: author.role },
  };
  // Fire-and-forget: the send must succeed for the author even if every
  // recipient's notification fails.
  notifyRecipients({ recipients, caseDoc, author, feedback: populatedFeedback, isReply: Boolean(parentFeedback) }).catch((error) =>
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

// Everyone who can see this case's thread: its case managers, the attorneys with active access, and the author (their other open sessions).
async function threadParticipantIds(caseId, author) {
  const caseDoc = await Case.findById(caseId).select("_id caseId caseNumber assignedCaseManager additionalCaseManagers attorneyAccess");
  const ids = new Set([String(author._id)]);
  if (caseDoc) {
    (allCaseManagerIds(caseDoc) || []).forEach((id) => id && ids.add(String(id)));
    (caseDoc.attorneyAccess || []).filter((grant) => grant.status === "active" && grant.attorneyId).forEach((grant) => ids.add(String(grant.attorneyId)));
  }
  return [...ids];
}

async function loadOwnFeedback(caseId, feedbackId, author) {
  if (!mongoose.Types.ObjectId.isValid(feedbackId)) {
    const error = new Error("Invalid message id");
    error.status = 400;
    throw error;
  }
  const feedback = await Feedback.findOne({ _id: feedbackId, caseId, deletedAt: { $exists: false } });
  if (!feedback) {
    const error = new Error("Message not found");
    error.status = 404;
    throw error;
  }
  if (String(feedback.authorId) !== String(author._id)) {
    const error = new Error("Only the author can change this message");
    error.status = 403;
    throw error;
  }
  return feedback;
}

async function broadcastChange(caseId, author, feedbackId, event) {
  const populated = await Feedback.findById(feedbackId).populate("authorId", "name displayName email role").lean();
  const participants = await threadParticipantIds(caseId, author).catch(() => [String(author._id)]);
  participants.forEach((userId) => realtimeGateway.emitToUser(userId, event, populated));
  return populated;
}

// Edit in place (the author only): the text changes, the message keeps its place in the thread and is marked edited.
async function editFeedback({ caseId, feedbackId, author, message }) {
  const feedback = await loadOwnFeedback(caseId, feedbackId, author);
  if (feedback.deletedForEveryoneAt) {
    const error = new Error("A deleted message cannot be edited");
    error.status = 400;
    throw error;
  }
  const text = typeof message === "string" ? message.trim() : "";
  if (!text && !(feedback.attachments || []).length) {
    const error = new Error("A message cannot be empty");
    error.status = 400;
    throw error;
  }
  feedback.message = text;
  feedback.editedAt = new Date();
  await feedback.save();
  return broadcastChange(caseId, author, feedback._id, "feedback:update");
}

// "Delete for everyone" (the author only): the message stays in the thread as a deleted line; its text and files are wiped (the stored file bytes are not touched).
async function deleteFeedbackForEveryone({ caseId, feedbackId, author }) {
  const feedback = await loadOwnFeedback(caseId, feedbackId, author);
  if (!feedback.deletedForEveryoneAt) {
    feedback.message = "";
    feedback.attachments = [];
    feedback.deletedForEveryoneAt = new Date();
    feedback.deletedForEveryoneBy = author._id;
    await feedback.save();
  }
  return broadcastChange(caseId, author, feedback._id, "feedback:delete");
}

module.exports = {
  editFeedback,
  deleteFeedbackForEveryone,
  createFeedback,
  listFeedback,
  markCaseFeedbackRead,
  unreadCountsByCase,
  getFeedbackAttachment,
};
