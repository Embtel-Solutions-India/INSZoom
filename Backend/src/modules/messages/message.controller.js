const Conversation = require("../../models/Conversation");
const Message = require("../../models/Message");
const MessageTemplate = require("../../models/MessageTemplate");
const messageService = require("./message.service");

async function getAccessibleConversation(id, user) {
  const conversation = await messageService.populateConversation(Conversation.findById(id));
  if (!conversation || conversation.deletedAt) {
    const error = new Error("Conversation not found");
    error.status = 404;
    throw error;
  }
  if (!(await messageService.canAccessConversation(user, conversation))) {
    const error = new Error("Access denied");
    error.status = 403;
    throw error;
  }
  return conversation;
}

exports.getThreads = async (req, res, next) => {
  try {
    const conversationFilter = await messageService.buildConversationFilter(req.user);
    if (req.query.status) conversationFilter.status = req.query.status;
    if (req.query.inbox) conversationFilter.inbox = req.query.inbox;
    if (req.query.assignedTo) conversationFilter.assignedTo = req.query.assignedTo;
    if (req.query.label) conversationFilter.labels = req.query.label;
    if (req.query.priority) conversationFilter.priority = req.query.priority;
    if (req.query.category) conversationFilter.category = req.query.category;
    const conversations = await messageService.populateConversation(
      Conversation.find(conversationFilter).sort({ lastMessageAt: -1 })
    );
    const messageFilter = await messageService.buildMessageFilter(req.query, req.user);
    const messages = await messageService.populateMessage(
      Message.find(messageFilter).sort({ createdAt: -1 }).limit(100)
    );
    res.json({ success: true, threads: conversations, conversations, count: conversations.length, messages });
  } catch (error) {
    next(error);
  }
};

exports.searchMessages = async (req, res, next) => {
  try {
    const filter = await messageService.buildMessageFilter(req.query, req.user);
    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
    const [messages, total] = await Promise.all([
      messageService.populateMessage(Message.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit)),
      Message.countDocuments(filter),
    ]);
    res.json({ success: true, count: messages.length, total, page, pages: Math.ceil(total / limit), messages });
  } catch (error) {
    next(error);
  }
};

exports.getOrCreateThread = async (req, res, next) => {
  try {
    const conversation = await messageService.createOrGetCaseConversation(req.params.caseId, req.user, req);
    res.json({ success: true, thread: conversation, conversation });
  } catch (error) {
    next(error);
  }
};

exports.getMessages = async (req, res, next) => {
  try {
    const id = req.params.threadId || req.params.id;
    const conversation = await Conversation.findById(id);
    if (conversation) {
      if (!(await messageService.canAccessConversation(req.user, conversation))) {
        return res.status(403).json({ success: false, message: "Access denied" });
      }
      const baseFilter = { conversationId: conversation._id, deletedAt: { $exists: false } };
      if (!messageService.isStaff(req.user)) baseFilter.isInternal = false;

      // Cursor pagination: without `before`, returns the most recent `limit`
      // messages (chronological order); with `before`, returns the `limit`
      // messages immediately preceding that timestamp — for loading older
      // history on scroll-up. Omitting `limit` entirely still defaults to a
      // capped page rather than the whole conversation.
      const limit = Math.min(Math.max(Number(req.query.limit) || 30, 1), 100);
      const pageFilter = { ...baseFilter };
      if (req.query.before) {
        const before = new Date(req.query.before);
        if (!Number.isNaN(before.getTime())) pageFilter.createdAt = { $lt: before };
      }

      const page = await messageService.populateMessage(
        Message.find(pageFilter).sort({ createdAt: -1 }).limit(limit + 1)
      );
      const hasMore = page.length > limit;
      const pageMessages = (hasMore ? page.slice(0, limit) : page).reverse();

      await Message.updateMany(
        { ...baseFilter, "readBy.userId": { $ne: req.user._id } },
        { $addToSet: { readBy: { userId: req.user._id, readAt: new Date() }, readByUsers: req.user._id }, isRead: true }
      );
      await messageService.markConversationRead(conversation, req.user);
      return res.json({
        success: true,
        messages: pageMessages,
        hasMore,
        oldestCursor: pageMessages[0]?.createdAt || null
      });
    }

    const message = await messageService.populateMessage(Message.findById(id));
    if (!message || message.deletedAt) return res.status(404).json({ success: false, message: "Message not found" });
    if (!(await messageService.canAccessMessage(req.user, message))) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }
    return res.json({ success: true, message });
  } catch (error) {
    next(error);
  }
};

exports.updateConversation = async (req, res, next) => {
  try {
    const conversation = await getAccessibleConversation(req.params.id, req.user);
    const updated = await messageService.updateConversation(conversation, req.body, req.user, req);
    res.json({ success: true, conversation: updated });
  } catch (error) {
    next(error);
  }
};

exports.typing = async (req, res, next) => {
  try {
    const conversation = await getAccessibleConversation(req.params.id, req.user);
    const result = await messageService.emitTyping(conversation, req.user, req.body.isTyping !== false);
    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
};

exports.createMessage = async (req, res, next) => {
  try {
    let conversation;
    if (req.body.caseId) conversation = await messageService.createOrGetCaseConversation(req.body.caseId, req.user, req);
    else if (req.body.receiverId) conversation = await messageService.createOrGetDirectConversation(req.body.receiverId, req.user, req);
    else return res.status(400).json({ success: false, message: "Either caseId or receiverId is required" });

    const message = await messageService.sendMessage({
      conversation,
      body: { ...req.body, legacySource: req.body.legacySource || "INSZoom" },
      files: req.files || [],
      user: req.user,
      req,
    });
    res.status(201).json({ success: true, message });
  } catch (error) {
    next(error);
  }
};

exports.sendThreadMessage = async (req, res, next) => {
  try {
    const conversation = await getAccessibleConversation(req.params.threadId, req.user);
    const message = await messageService.sendMessage({
      conversation,
      body: { ...req.body, legacySource: req.body.legacySource || "BAIS" },
      files: req.files || [],
      user: req.user,
      req,
    });
    res.status(201).json({ success: true, message });
  } catch (error) {
    next(error);
  }
};

exports.getAttachment = async (req, res, next) => {
  try {
    const { buffer, attachment } = await messageService.getAttachmentFile(req.params.messageId, req.params.attachmentId, req.user);
    res.set("Content-Type", attachment.mimeType || "application/octet-stream");
    res.set("Content-Length", buffer.length);
    res.set("Content-Disposition", `inline; filename="${encodeURIComponent(attachment.originalName || attachment.fileName || "attachment")}"`);
    res.send(buffer);
  } catch (error) {
    next(error);
  }
};

exports.markMessageAsRead = async (req, res, next) => {
  try {
    const message = await Message.findById(req.params.id);
    if (!message || message.deletedAt) return res.status(404).json({ success: false, message: "Message not found" });
    if (!(await messageService.canAccessMessage(req.user, message))) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }
    const updated = await messageService.markMessageRead(message, req.user, req);
    res.json({ success: true, message: updated });
  } catch (error) {
    next(error);
  }
};

exports.editMessage = async (req, res, next) => {
  try {
    const message = await Message.findById(req.params.id);
    if (!message || message.deletedAt) return res.status(404).json({ success: false, message: "Message not found" });
    if (!(await messageService.canAccessMessage(req.user, message))) return res.status(403).json({ success: false, message: "Access denied" });
    const updated = await messageService.editMessage(message, req.body, req.user, req);
    res.json({ success: true, message: updated });
  } catch (error) {
    next(error);
  }
};

exports.reactToMessage = async (req, res, next) => {
  try {
    const message = await Message.findById(req.params.id);
    if (!message || message.deletedAt) return res.status(404).json({ success: false, message: "Message not found" });
    if (!(await messageService.canAccessMessage(req.user, message))) return res.status(403).json({ success: false, message: "Access denied" });
    const updated = await messageService.addReaction(message, req.body.emoji || "👍", req.user, req);
    res.json({ success: true, message: updated });
  } catch (error) {
    next(error);
  }
};

exports.translateMessage = async (req, res, next) => {
  try {
    const message = await Message.findById(req.params.id);
    if (!message || message.deletedAt) return res.status(404).json({ success: false, message: "Message not found" });
    if (!(await messageService.canAccessMessage(req.user, message))) return res.status(403).json({ success: false, message: "Access denied" });
    message.translation = messageService.translateMessage(message, req.body.targetLanguage || req.query.targetLanguage || "en");
    messageService.addAuditEntry(message, "translate", req.user, message.translation, req);
    await message.save();
    res.json({ success: true, translation: message.translation, message });
  } catch (error) {
    next(error);
  }
};

exports.getUnreadCount = async (req, res, next) => {
  try {
    const filter = await messageService.buildConversationFilter(req.user);
    const conversations = await Conversation.find(filter);
    const userId = req.user._id.toString();
    const total = conversations.reduce((sum, conversation) => {
      const participant = (conversation.participants || []).find((item) => item.user?.toString() === userId);
      if (participant) return sum + (participant.unreadCount || 0);
      return sum + (req.user.role === "client" ? conversation.unreadClient || 0 : conversation.unreadManager || 0);
    }, 0);
    res.json({ success: true, unreadCount: total, count: total });
  } catch (error) {
    next(error);
  }
};

exports.getAnalytics = async (req, res, next) => {
  try {
    const filter = await messageService.buildConversationFilter(req.user);
    const [statusCounts, inboxCounts, messageCounts] = await Promise.all([
      Conversation.aggregate([{ $match: filter }, { $group: { _id: "$status", count: { $sum: 1 } } }]),
      Conversation.aggregate([{ $match: filter }, { $group: { _id: "$inbox", count: { $sum: 1 } } }]),
      Message.aggregate([{ $match: { deletedAt: { $exists: false } } }, { $group: { _id: "$channel", count: { $sum: 1 } } }]),
    ]);
    res.json({ success: true, data: { statusCounts, inboxCounts, messageCounts } });
  } catch (error) {
    next(error);
  }
};

exports.getSmartReplies = async (req, res, next) => {
  try {
    const conversation = await getAccessibleConversation(req.params.id, req.user);
    const recentMessages = await Message.find({ conversationId: conversation._id, deletedAt: { $exists: false } }).sort({ createdAt: -1 }).limit(5);
    const suggestions = messageService.suggestReplies(conversation, recentMessages.reverse());
    res.json({ success: true, data: suggestions });
  } catch (error) {
    next(error);
  }
};

exports.getTemplates = async (req, res, next) => {
  try {
    const filter = { archivedAt: { $exists: false } };
    if (req.query.category) filter.category = req.query.category;
    if (req.query.channel) filter.channel = req.query.channel;
    const templates = await MessageTemplate.find(filter).sort({ category: 1, name: 1 });
    res.json({ success: true, count: templates.length, templates });
  } catch (error) {
    next(error);
  }
};

exports.createTemplate = async (req, res, next) => {
  try {
    const template = await messageService.createTemplate(req.body, req.user);
    res.status(201).json({ success: true, template });
  } catch (error) {
    next(error);
  }
};

exports.renderTemplate = async (req, res, next) => {
  try {
    const template = await MessageTemplate.findById(req.params.id);
    if (!template || template.archivedAt) return res.status(404).json({ success: false, message: "Message template not found" });
    const rendered = await messageService.renderTemplate(template, req.body.variables || {}, req.user);
    res.json({ success: true, data: rendered });
  } catch (error) {
    next(error);
  }
};

exports.deleteMessage = async (req, res, next) => {
  try {
    const message = await Message.findById(req.params.id);
    if (!message || message.deletedAt) return res.status(404).json({ success: false, message: "Message not found" });
    message.deletedAt = new Date();
    message.deletedBy = req.user._id;
    messageService.addAuditEntry(message, "delete", req.user, {}, req);
    await message.save();
    await messageService.writeAuditLog("delete", "message", message, req.user, {}, req);
    res.json({ success: true, message: "Message deleted successfully" });
  } catch (error) {
    next(error);
  }
};
