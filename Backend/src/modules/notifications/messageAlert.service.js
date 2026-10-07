// One place that turns "a message was sent" into what the recipient actually experiences, for EVERY conversation in the
// system (client <-> case team, case team <-> attorney):
//   1. a browser push notification, immediately, WhatsApp-style: the SENDER'S NAME on top, then the message text;
//   2. the in-app notification (bell + live socket) that goes with it;
//   3. if the recipient is NOT online (no live portal session), an email "you have a new message on case X" - only to
//      attorneys, clients (any client-side account), case managers and team leads. Never to admins or super admins.
// Callers (message.service.js, feedback.service.js) only say who wrote what to whom; nothing else decides this.
const User = require("../../models/User");
const notificationService = require("./notification.service");
const realtimeGateway = require("../realtime/realtime.gateway");
const logger = require("../../utils/logger");

const EMAIL_ROLES = new Set(["attorney", "case_manager", "team_lead", "client", "employer", "employee", "beneficiary", "petitioner", "user"]);
const PREVIEW_LENGTH = 140;

function displayName(user) {
  return user?.displayName || user?.name || user?.email || "Someone";
}

function previewOf(text, attachmentCount = 0) {
  const clean = String(text || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  if (clean) return clean.length > PREVIEW_LENGTH ? `${clean.slice(0, PREVIEW_LENGTH - 1)}…` : clean;
  return attachmentCount ? `Sent ${attachmentCount} attachment${attachmentCount > 1 ? "s" : ""}` : "New message";
}

function shouldEmail(recipient, online) {
  return !online && Boolean(recipient?.email) && EMAIL_ROLES.has(String(recipient.role || "").toLowerCase());
}

// recipientIds: who should hear about it (the sender is always excluded). Never throws - a failed alert must never
// fail the message that was just sent.
async function notifyNewMessage({ recipientIds = [], sender, caseId, caseNumber, text, attachmentCount = 0, link, kind = "message", conversationId, messageId, req }) {
  const senderId = String(sender?._id || "");
  const senderName = displayName(sender);
  const preview = previewOf(text, attachmentCount);
  const ids = [...new Set((recipientIds || []).filter(Boolean).map(String))].filter((id) => id !== senderId);
  const results = [];

  await Promise.all(ids.map(async (userId) => {
    try {
      const recipient = await User.findById(userId).select("name displayName email role isActive").lean();
      if (!recipient || recipient.isActive === false) return;
      const online = realtimeGateway.isUserOnline(userId);
      const notification = await notificationService.createNotification({
        userId,
        type: kind === "feedback" ? "attorney_feedback" : "message_received",
        category: "message",
        title: senderName, // push + bell show the sender on top...
        message: preview, // ...then the message itself
        caseId,
        link,
        priority: "high",
        channels: ["in_app", "socket", "push"],
        // one notification per conversation thread on the device, replaced by the next message (like WhatsApp)
        data: { tag: `msg-${conversationId || caseId || userId}` },
        metadata: { conversationId, messageId, senderId, senderName, kind },
        source: "shared",
      }, sender, req);
      const entry = { userId, online, emailed: false };
      if (shouldEmail(recipient, online)) {
        const emailService = require("../email/email.service");
        const sent = await emailService.sendTemplateEmail("new-message-received", {
          to: recipient.email,
          recipientRole: recipient.role,
          caseId,
          userId,
          triggeredBy: sender?._id,
          source: "shared",
          data: { recipientName: displayName(recipient), clientName: displayName(recipient), senderName, caseNumber, messagePreview: preview },
        }).catch((error) => ({ sent: false, error: error.message }));
        entry.emailed = Boolean(sent?.sent);
        entry.emailResult = sent?.reason || sent?.error;
      }
      entry.notificationId = notification?._id;
      results.push(entry);
    } catch (error) {
      logger.error("message_alert_failed", { userId, error: error.message });
    }
  }));
  return results;
}

module.exports = { notifyNewMessage, previewOf, shouldEmail, EMAIL_ROLES };
