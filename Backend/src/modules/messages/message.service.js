const mongoose = require("mongoose");
const AuditLog = require("../../models/AuditLog");
const Case = require("../../models/Case");
const Conversation = require("../../models/Conversation");
const Message = require("../../models/Message");
const MessageTemplate = require("../../models/MessageTemplate");
const User = require("../../models/User");
const caseService = require("../cases/case.service");
const notificationService = require("../notifications/notification.service");
const realtimeGateway = require("../realtime/realtime.gateway");
const storageService = require("../uploads/storage.service");
const { normalizeRole } = require("../authorization/roleHierarchy");
const { resolveCaseConversationRouting } = require("./messageRouting");

const STAFF_ROLES = ["super_admin", "admin", "team_lead", "case_manager", "paralegal", "finance", "reviewer"];

function sameId(left, right) {
  return Boolean(left && right && (left?._id?.toString?.() || left?.toString?.()) === (right?._id?.toString?.() || right?.toString?.()));
}

function idOf(value) {
  return value?._id?.toString?.() || value?.toString?.();
}

function roleOf(user) {
  return normalizeRole(user?.role);
}

function isStaff(user) {
  return STAFF_ROLES.includes(roleOf(user));
}

function userDisplayName(user) {
  return user?.name || user?.displayName || user?.email || "User";
}

function addAuditEntry(entity, action, user, changes = {}, req) {
  entity.auditHistory.push({
    action,
    performedBy: user?._id,
    performedAt: new Date(),
    changes,
    ipAddress: req?.ip,
    userAgent: req?.headers?.["user-agent"],
  });
}

async function writeAuditLog(action, entityType, entity, user, changes, req) {
  await AuditLog.create({
    userId: user?._id,
    action,
    entityType,
    entityId: entity?._id?.toString(),
    changes,
    ipAddress: req?.ip,
    userAgent: req?.headers?.["user-agent"],
    description: `${action} on ${entityType}`,
  }).catch(() => {});
}

// Mongoose buffers queries for up to 10s waiting for a connection before
// rejecting - fine for a real request (the connection is already up by the
// time Express is serving traffic) but disastrous for the live-case-recheck
// calls below if anything ever calls them without one (e.g. a DB-free unit
// test): each would hang for 10s instead of failing fast. Checking readyState
// first lets both fail closed immediately instead.
function dbIsConnected() {
  return mongoose.connection.readyState === 1;
}

function participantIds(conversation) {
  return (conversation.participants || []).map((participant) => idOf(participant.user)).filter(Boolean);
}

// A case-tied conversation's participants/caseManagerId/assignedTo fields are
// only a SNAPSHOT, kept in sync proactively at reassignment time
// (syncCaseMessagingAssignment) and reactively whenever someone re-opens the
// conversation via the case-scoped entry point (createOrGetCaseConversation).
// Both of those depend on someone who STILL has access re-touching the
// conversation - a staff member who's just been reassigned away can never do
// that themselves (their own case-scoped request is the thing being denied),
// so if nobody else happens to reopen it first, their stale participant
// entry keeps granting them full access via the "list my conversations" /
// "view this conversation by ID" endpoints forever, even though they no
// longer pass canAccessCase on the underlying case. Re-deriving staff access
// from the live Case on every check closes that loophole regardless of
// whether the snapshot has been resynced yet. Client/employer/employee/
// petitioner/beneficiary access is untouched - they're never "reassigned
// away" the way staff are, so the existing snapshot-based checks still apply
// to them.
async function canAccessConversation(user, conversation) {
  if (!user || !conversation || conversation.deletedAt) return false;
  if (["super_admin", "admin"].includes(roleOf(user))) return true;
  if (conversation.caseId && conversation.type === "case" && isStaff(user)) {
    if (!dbIsConnected()) return false;
    const caseData = await Case.findById(idOf(conversation.caseId)).select(
      "user employeeUser employerUser clientProfile beneficiary primaryOwner secondaryOwner assignedTeamLead assignedCaseManager teamId petitionerUser beneficiaryUser beneficiaryInvite companyId employer organization"
    );
    return Boolean(caseData) && caseService.canAccessCase(user, caseData);
  }
  if (participantIds(conversation).includes(user._id.toString())) return true;
  if (sameId(conversation.clientId, user._id) || sameId(conversation.caseManagerId, user._id) || sameId(conversation.receiverId, user._id)) return true;
  if (sameId(conversation.assignedTo, user._id) || sameId(conversation.assignedOwnerId, user._id)) return true;
  return false;
}

async function canAccessMessage(user, message) {
  if (!message || message.deletedAt) return false;
  if (["super_admin", "admin"].includes(roleOf(user))) return true;
  // A case-tied message must route through canAccessConversation's live
  // case-recheck even when this user is its own sender/receiver - otherwise
  // a staff member reassigned away from a case keeps full access to every
  // message THEY sent on it (read, edit, react, translate, mark-read)
  // forever, the exact same stale-access shape closed for conversation-level
  // access above. Direct (non-case) messages are unaffected: sender/receiver
  // matching still grants access immediately, no conversation lookup needed.
  if (message.conversationId && message.caseId) {
    const conversation = await Conversation.findById(message.conversationId);
    return canAccessConversation(user, conversation);
  }
  if (sameId(message.senderId, user._id) || sameId(message.receiverId, user._id)) return true;
  if (message.conversationId) {
    const conversation = await Conversation.findById(message.conversationId);
    return canAccessConversation(user, conversation);
  }
  return false;
}

async function buildConversationFilter(user) {
  const role = roleOf(user);
  if (["super_admin", "admin"].includes(role)) return { deletedAt: { $exists: false } };
  const accessOr = [
    { "participants.user": user._id },
    { clientId: user._id },
    { caseManagerId: user._id },
    { receiverId: user._id },
    { assignedTo: user._id },
    { assignedOwnerId: user._id },
  ];
  if (isStaff(user)) {
    // Same loophole as canAccessConversation (see its comment above): a case-
    // type conversation's participants/caseManagerId/assignedTo are only a
    // snapshot, so a staff member reassigned away from a case would otherwise
    // keep seeing it in their conversation list forever via that stale
    // snapshot. Case-type rows are additionally scoped to cases this user
    // currently has access to; non-case (direct) conversations keep using
    // the existing participant-based filter untouched.
    const accessibleCaseIds = dbIsConnected() ? await Case.find(caseService.buildCaseFilter({}, user)).distinct("_id") : [];
    return {
      deletedAt: { $exists: false },
      $or: [
        { type: { $ne: "case" }, $or: accessOr },
        { type: "case", caseId: { $in: accessibleCaseIds } },
      ],
    };
  }
  return { deletedAt: { $exists: false }, $or: accessOr };
}

async function buildMessageFilter(query, user) {
  const filter = { deletedAt: { $exists: false } };
  if (query.caseId) filter.caseId = query.caseId;
  if (query.receiverId) filter.receiverId = query.receiverId;
  if (query.conversationId) filter.conversationId = query.conversationId;
  if (query.threadId) filter.threadId = query.threadId;
  if (query.category) filter.category = query.category;
  if (query.priority) filter.priority = query.priority;
  if (query.channel) filter.channel = query.channel;
  if (query.label) filter.labels = query.label;
  if (query.search) filter.$text = { $search: query.search };
  if (query.isInternal !== undefined) filter.isInternal = query.isInternal === "true" || query.isInternal === true;

  if (query.caseId) {
    const conversation = await Conversation.findOne({ caseId: query.caseId, type: "case", deletedAt: { $exists: false } });
    if (!conversation || !(await canAccessConversation(user, conversation))) {
      const error = new Error("You do not have permission to access messages for this case");
      error.status = 403;
      throw error;
    }
    if (!isStaff(user)) filter.isInternal = false;
    return filter;
  }

  if (query.receiverId) {
    filter.$or = [{ senderId: user._id }, { receiverId: user._id }];
    return filter;
  }

  const conversationFilter = await buildConversationFilter(user);
  const conversationIds = await Conversation.find(conversationFilter).distinct("_id");
  // A case-tied message must NEVER surface here just because this user
  // happens to be its sender/receiver - a staff member reassigned away from
  // a case can never lose access to messages THEY sent on it if senderId
  // alone kept qualifying, no matter how thoroughly buildConversationFilter/
  // canAccessConversation scope the conversation list itself (the frontend
  // rebuilds its conversation list from this messages feed too, so a single
  // stale message reintroduces the whole case into view). Case-scoped
  // messages are gated purely by current conversation access; senderId/
  // receiverId matching is reserved for direct (non-case) messages, which
  // aren't part of the reassignment-eviction model at all.
  filter.$or = [
    { caseId: { $exists: false }, senderId: user._id },
    { caseId: { $exists: false }, receiverId: user._id },
    { conversationId: { $in: conversationIds } },
    { threadId: { $in: conversationIds } },
  ];
  if (!isStaff(user)) filter.isInternal = false;
  return filter;
}

function buildParticipant(user) {
  return { user: user._id, role: roleOf(user), joinedAt: new Date(), lastReadAt: new Date(), unreadCount: 0 };
}

async function syncCaseConversationParticipants(conversation, caseData) {
  if (!conversation?.caseId || conversation.type !== "case") return conversation;

  const resolvedCase = caseData || await Case.findById(conversation.caseId)
    .select("_id caseId caseNumber visaType clientPortalId user clientProfile primaryOwner assignedTeamLead assignedCaseManager companyId teamId");
  if (!resolvedCase) return conversation;

  const existingParticipants = Array.isArray(conversation.participants) ? [...conversation.participants] : [];
  const participantIndex = new Map(existingParticipants.map((participant, index) => [idOf(participant.user), index]));
  const routing = resolveCaseConversationRouting(resolvedCase);
  const participantUsers = await User.find({ _id: { $in: [...routing.desiredParticipantIds, conversation.assignedTo].filter(Boolean) } }).select("_id role");
  const userById = new Map(participantUsers.map((participantUser) => [participantUser._id.toString(), participantUser]));

  const desiredParticipants = routing.desiredParticipantIds;
  const desiredParticipantSet = new Set(desiredParticipants);

  // A case manager or team lead who has been reassigned away from this case
  // must lose the conversation entirely (no longer see it in their Messages
  // pane, no longer be able to send on it) - not just stop being the
  // "current" owner while lingering as a participant. Clients/employer/
  // employee are never pruned here (they're always part of
  // desiredParticipantIds already); this only removes staff whose
  // assignment moved on.
  const PRUNABLE_STAFF_ROLES = new Set(["super_admin", "admin", "case_manager", "team_lead"]);
  let changed = false;
  for (let index = existingParticipants.length - 1; index >= 0; index -= 1) {
    const participant = existingParticipants[index];
    const participantId = idOf(participant.user);
    const participantRole = roleOf(participant);
    if (participantId && PRUNABLE_STAFF_ROLES.has(participantRole) && !desiredParticipantSet.has(participantId)) {
      existingParticipants.splice(index, 1);
      participantIndex.delete(participantId);
      changed = true;
    }
  }
  participantIndex.clear();
  existingParticipants.forEach((participant, index) => {
    const participantId = idOf(participant.user);
    if (participantId) participantIndex.set(participantId, index);
  });

  desiredParticipants.forEach((participantId) => {
    const key = participantId.toString();
    const participantUser = userById.get(key);
    if (!participantUser) return;

    if (!participantIndex.has(key)) {
      existingParticipants.push(buildParticipant(participantUser));
      participantIndex.set(key, existingParticipants.length - 1);
      changed = true;
      return;
    }

    const participant = existingParticipants[participantIndex.get(key)];
    const normalizedParticipantRole = roleOf(participant);
    const normalizedUserRole = roleOf(participantUser);
    if (normalizedParticipantRole !== normalizedUserRole) {
      participant.role = normalizedUserRole;
      changed = true;
    }
  });

  const nextClientId = routing.clientId || conversation.clientId;
  const nextAssignedTo = routing.assignedTo || conversation.assignedTo;
  const nextSubject = `Case ${resolvedCase.caseNumber || resolvedCase.caseId} - ${resolvedCase.visaType}`;

  if (!sameId(conversation.clientId, nextClientId)) {
    conversation.clientId = nextClientId;
    changed = true;
  }
  if (!sameId(conversation.caseManagerId, resolvedCase.assignedCaseManager)) {
    conversation.caseManagerId = resolvedCase.assignedCaseManager;
    changed = true;
  }
  if (!sameId(conversation.assignedTo, nextAssignedTo)) {
    conversation.assignedTo = nextAssignedTo;
    changed = true;
  }
  if (!sameId(conversation.assignedOwnerId, nextAssignedTo)) {
    conversation.assignedOwnerId = nextAssignedTo;
    changed = true;
  }
  if (!sameId(conversation.companyId, resolvedCase.companyId)) {
    conversation.companyId = resolvedCase.companyId;
    changed = true;
  }
  if (!sameId(conversation.teamId, resolvedCase.teamId)) {
    conversation.teamId = resolvedCase.teamId;
    changed = true;
  }
  if (resolvedCase.clientPortalId && conversation.clientPortalId !== resolvedCase.clientPortalId) {
    conversation.clientPortalId = resolvedCase.clientPortalId;
    changed = true;
  }
  if (conversation.subject !== nextSubject) {
    conversation.subject = nextSubject;
    changed = true;
  }

  if (changed) {
    conversation.participants = existingParticipants;
    await conversation.save();
  }

  return conversation;
}

async function createOrGetCaseConversation(caseId, user, req) {
  const caseData = await Case.findById(caseId);
  if (!caseData) {
    const error = new Error("Case not found");
    error.status = 404;
    throw error;
  }
  if (!caseService.canAccessCase(user, caseData)) {
    const error = new Error("Access denied");
    error.status = 403;
    throw error;
  }

  let conversation = await Conversation.findOne({ caseId, type: "case", deletedAt: { $exists: false } });
  if (!conversation) {
    const participants = [];
    const participantSet = new Set();
    const addParticipant = async (userId) => {
      if (!userId || participantSet.has(userId.toString())) return;
      const participantUser = await User.findById(userId).select("_id role");
      if (participantUser) {
        participants.push(buildParticipant(participantUser));
        participantSet.add(userId.toString());
      }
    };
    const routing = resolveCaseConversationRouting(caseData, user);
    for (const participantId of routing.desiredParticipantIds) await addParticipant(participantId);
    if (routing.includeCurrentUser) await addParticipant(user._id);

    conversation = await Conversation.create({
      caseId,
      clientPortalId: caseData.clientPortalId,
      clientId: routing.clientId,
      caseManagerId: caseData.assignedCaseManager,
      assignedOwnerId: routing.assignedTo,
      companyId: caseData.companyId,
      teamId: caseData.teamId,
      assignedTo: routing.assignedTo,
      inbox: routing.assignedTo ? "shared" : "support",
      category: "case",
      participants,
      subject: `Case ${caseData.caseNumber || caseData.caseId} - ${caseData.visaType}`,
      type: "case",
      legacySource: "shared",
    });
    addAuditEntry(conversation, "create", user, { caseId }, req);
    await conversation.save();
    await writeAuditLog("create", "conversation", conversation, user, { caseId }, req);
  }
  await syncCaseConversationParticipants(conversation, caseData);
  return populateConversation(conversation);
}

async function createOrGetDirectConversation(receiverId, user, req) {
  if (!receiverId) {
    const error = new Error("receiverId is required");
    error.status = 400;
    throw error;
  }
  const receiver = await User.findById(receiverId).select("_id role name displayName email");
  if (!receiver) {
    const error = new Error("Receiver not found");
    error.status = 404;
    throw error;
  }
  const participants = [user._id.toString(), receiverId.toString()].sort();
  let conversation = await Conversation.findOne({
    type: "direct",
    deletedAt: { $exists: false },
    "participants.user": { $all: participants },
  });
  if (!conversation) {
    conversation = await Conversation.create({
      receiverId,
      clientId: roleOf(user) === "client" ? user._id : receiver._id,
      participants: [buildParticipant(user), buildParticipant(receiver)],
      subject: `Conversation with ${userDisplayName(receiver)}`,
      type: "direct",
      legacySource: "INSZoom",
    });
    addAuditEntry(conversation, "create", user, { receiverId }, req);
    await conversation.save();
    await writeAuditLog("create", "conversation", conversation, user, { receiverId }, req);
  }
  return populateConversation(conversation);
}

async function storeAttachments(files = [], context = {}) {
  const attachments = [];
  for (const file of files) {
    const key = storageService.generateDocumentKey({
      caseId: context.caseId,
      userId: context.userId,
      originalName: file.originalname,
    }).replace("documents", "messages");
    const stored = await storageService.storeBuffer(key, file.buffer);
    attachments.push({
      originalName: file.originalname,
      storedName: key.split("/").pop(),
      fileName: key.split("/").pop(),
      fileUrl: stored.url,
      fileSize: file.size,
      size: file.size,
      mimeType: file.mimetype,
      storageProvider: stored.provider,
      storageKey: stored.key,
      checksum: stored.checksum,
    });
  }
  return attachments;
}

async function getAttachmentFile(messageId, attachmentId, user) {
  const message = await Message.findById(messageId);
  if (!message || message.deletedAt) {
    const error = new Error("Message not found");
    error.status = 404;
    throw error;
  }
  if (!(await canAccessMessage(user, message))) {
    const error = new Error("Access denied");
    error.status = 403;
    throw error;
  }
  const attachment = (message.attachments || []).find((item) => idOf(item._id) === attachmentId);
  if (!attachment) {
    const error = new Error("Attachment not found");
    error.status = 404;
    throw error;
  }
  const buffer = await storageService.readBuffer(attachment.storageKey);
  return { buffer, attachment };
}

async function markConversationRead(conversation, user) {
  const now = new Date();
  conversation.participants = (conversation.participants || []).map((participant) => {
    if (sameId(participant.user, user._id)) {
      participant.lastReadAt = now;
      participant.unreadCount = 0;
    }
    return participant;
  });
  if (roleOf(user) === "client") conversation.unreadClient = 0;
  else conversation.unreadManager = 0;
  await conversation.save();
}

async function markMessageRead(message, user, req) {
  const alreadyRead = (message.readBy || []).some((read) => sameId(read.userId, user._id))
    || (message.readByUsers || []).some((userId) => sameId(userId, user._id));
  if (!alreadyRead) {
    message.readBy.push({ userId: user._id, readAt: new Date() });
    message.readByUsers.addToSet(user._id);
  }
  message.isRead = true;
  message.deliveryStatus = "read";
  addAuditEntry(message, "read", user, {}, req);
  await message.save();
  await writeAuditLog("read", "message", message, user, {}, req);
  return message;
}

async function updateUnreadCounters(conversation, sender) {
  const senderId = sender._id.toString();
  conversation.participants = (conversation.participants || []).map((participant) => {
    if (idOf(participant.user) !== senderId) participant.unreadCount = (participant.unreadCount || 0) + 1;
    return participant;
  });
  if (roleOf(sender) === "client") conversation.unreadManager += 1;
  else conversation.unreadClient += 1;
  conversation.lastMessageAt = new Date();
  await conversation.save();
}

function extractMentions(content = "") {
  const mentions = [];
  const matches = content.match(/@([a-zA-Z0-9_.-]+)/g) || [];
  for (const match of matches) mentions.push({ text: match });
  return mentions;
}

function scoreSpam(content = "", attachments = []) {
  const lowered = content.toLowerCase();
  let score = 0;
  if (/(free money|wire transfer|urgent payment|crypto|gift card)/i.test(lowered)) score += 40;
  if ((lowered.match(/https?:\/\//g) || []).length > 3) score += 25;
  if (attachments.length > 5) score += 10;
  return { score, flagged: score >= 50, reason: score >= 50 ? "Automated spam heuristic matched" : undefined };
}

async function sendMessage({ conversation, body, files, user, req }) {
  if (!(await canAccessConversation(user, conversation))) {
    const error = new Error("Access denied");
    error.status = 403;
    throw error;
  }
  const content = body.messageBody || body.message;
  if (!content?.trim() && !files?.length) {
    const error = new Error("Message body or attachment is required");
    error.status = 400;
    throw error;
  }
  const internal = (body.isInternal === true || body.isInternal === "true" || body.isInternalNote === true || body.isInternalNote === "true") && isStaff(user);
  const attachments = body.attachments?.length ? body.attachments : await storeAttachments(files || [], { caseId: idOf(conversation.caseId), userId: user._id });
  const spam = scoreSpam(content || "", attachments);
  if (conversation.caseId && conversation.type === "case") {
    await syncCaseConversationParticipants(conversation);
  }
  const message = await Message.create({
    conversationId: conversation._id,
    threadId: conversation._id,
    caseId: conversation.caseId,
    clientPortalId: conversation.clientPortalId,
    receiverId: body.receiverId || conversation.receiverId,
    senderId: user._id,
    sender: ["case_manager", "client", "finance", "employer", "employee"].includes(roleOf(user)) ? roleOf(user) : "system",
    senderRole: roleOf(user),
    senderName: userDisplayName(user),
    senderEmail: user.email,
    message: content?.trim() || "",
    messageBody: content?.trim() || "",
    normalizedBody: content?.trim()?.toLowerCase() || "",
    attachments,
    attachmentPreviews: attachments.map((attachment) => ({
      attachmentId: attachment._id,
      previewUrl: attachment.fileUrl,
      thumbnailUrl: attachment.fileUrl,
      textPreview: attachment.originalName,
      generatedAt: new Date(),
    })),
    isInternal: internal,
    isInternalNote: internal,
    noteType: internal ? (body.noteType || "internal") : "none",
    deliveryStatus: "sent",
    deliveredAt: new Date(),
    readBy: [{ userId: user._id, readAt: new Date() }],
    readByUsers: [user._id],
    replyTo: body.replyTo,
    mentions: body.mentions || extractMentions(content),
    labels: body.labels || [],
    category: body.category || conversation.category || "general",
    priority: body.priority || conversation.priority || "medium",
    channel: body.channel || conversation.channel || "in_app",
    direction: internal ? "internal" : (roleOf(user) === "client" ? "inbound" : "outbound"),
    email: body.email || {},
    secureShare: body.secureShare || {},
    spam,
    legacySource: body.legacySource || "shared",
  });
  addAuditEntry(message, "send", user, { conversationId: conversation._id }, req);
  await message.save();
  conversation.lastMessagePreview = message.messageBody.slice(0, 160);
  conversation.analytics = conversation.analytics || {};
  conversation.sharedInbox = conversation.sharedInbox || {};
  conversation.spam = conversation.spam || {};
  conversation.analytics.messageCount += 1;
  conversation.analytics.attachmentCount += attachments.length;
  if (internal) conversation.analytics.internalNoteCount += 1;
  if (message.direction === "inbound") conversation.analytics.lastInboundAt = new Date();
  if (message.direction === "outbound") {
    conversation.analytics.lastOutboundAt = new Date();
    if (conversation.sharedInbox?.firstResponseDueAt && !conversation.sharedInbox.firstRespondedAt) {
      conversation.sharedInbox.firstRespondedAt = new Date();
      conversation.analytics.firstResponseSeconds = Math.round((conversation.sharedInbox.firstRespondedAt - conversation.createdAt) / 1000);
    }
  }
  if (spam.flagged) {
    conversation.spam.flagged = true;
    conversation.spam.score = Math.max(conversation.spam.score || 0, spam.score);
    conversation.spam.reason = spam.reason;
  }
  if (roleOf(user) !== "client" && !conversation.caseManagerId) conversation.caseManagerId = user._id;
  await updateUnreadCounters(conversation, user);
  await notifyRecipients(conversation, message, user, internal, req);
  emitRealtime(conversation, message, user);
  await writeAuditLog("send", "message", message, user, { conversationId: conversation._id }, req);
  return populateMessage(message);
}

async function notifyRecipients(conversation, message, sender, internal, req) {
  if (internal) return;
  const recipients = participantIds(conversation).filter((id) => id !== sender._id.toString());
  if (message.receiverId && !recipients.includes(message.receiverId.toString())) recipients.push(message.receiverId.toString());
  await Promise.all(recipients.map((recipientId) =>
    notificationService.createNotification({
      userId: recipientId,
      type: "message_received",
      title: "New Message",
      message: `New message from ${userDisplayName(sender)}`,
      caseId: conversation.caseId,
      link: `/messages/${conversation._id}`,
      priority: "medium",
      metadata: { conversationId: conversation._id, messageId: message._id },
    }, sender, req)
  ));
}

function emitRealtime(conversation, message, sender) {
  realtimeGateway.emitToConversation(conversation._id, "message:new", message);
  participantIds(conversation)
    .filter((id) => id !== sender._id.toString())
    .forEach((userId) => realtimeGateway.emitToUser(userId, "message:new", message));
}

async function updateConversation(conversation, payload, user, req) {
  const allowed = ["subject", "status", "priority", "category", "labels", "inbox", "assignedTo", "assignedTeam", "snoozedUntil"];
  for (const field of allowed) {
    if (payload[field] !== undefined) conversation[field] = payload[field];
  }
  if (payload.status === "closed" || payload.isClosed === true) {
    conversation.status = "closed";
    conversation.isClosed = true;
    conversation.closedAt = new Date();
    conversation.closedBy = user._id;
    conversation.sharedInbox.resolvedAt = conversation.sharedInbox.resolvedAt || new Date();
    conversation.analytics.resolutionSeconds = Math.round((conversation.sharedInbox.resolvedAt - conversation.createdAt) / 1000);
  }
  if (payload.status === "open" || payload.reopen === true) {
    conversation.status = "open";
    conversation.isClosed = false;
    conversation.closedAt = undefined;
    conversation.closedBy = undefined;
  }
  addAuditEntry(conversation, "update", user, payload, req);
  await conversation.save();
  await writeAuditLog("update", "conversation", conversation, user, payload, req);
  realtimeGateway.emitToConversation(conversation._id, "conversation:update", conversation);
  return populateConversation(conversation);
}

async function addReaction(message, emoji, user, req) {
  const existing = (message.reactions || []).find((reaction) => sameId(reaction.userId, user._id) && reaction.emoji === emoji);
  if (existing) {
    message.reactions = message.reactions.filter((reaction) => !(sameId(reaction.userId, user._id) && reaction.emoji === emoji));
  } else {
    message.reactions.push({ emoji, userId: user._id });
  }
  addAuditEntry(message, existing ? "remove_reaction" : "add_reaction", user, { emoji }, req);
  await message.save();
  realtimeGateway.emitToConversation(message.conversationId, "message:reaction", { messageId: message._id, reactions: message.reactions });
  return populateMessage(message);
}

async function editMessage(message, payload, user, req) {
  if (!sameId(message.senderId, user._id) && !["super_admin", "admin"].includes(roleOf(user))) {
    const error = new Error("Only the sender or admin can edit this message");
    error.status = 403;
    throw error;
  }
  const content = payload.messageBody || payload.message;
  if (content !== undefined) {
    message.messageBody = content;
    message.message = content;
    message.normalizedBody = content.toLowerCase();
  }
  if (payload.labels) message.labels = payload.labels;
  if (payload.priority) message.priority = payload.priority;
  message.editedAt = new Date();
  message.editedBy = user._id;
  addAuditEntry(message, "edit", user, payload, req);
  await message.save();
  await writeAuditLog("edit", "message", message, user, payload, req);
  realtimeGateway.emitToConversation(message.conversationId, "message:update", message);
  return populateMessage(message);
}

async function emitTyping(conversation, user, isTyping = true) {
  const now = new Date();
  conversation.participants = (conversation.participants || []).map((participant) => {
    if (sameId(participant.user, user._id)) participant.typingAt = isTyping ? now : undefined;
    return participant;
  });
  await conversation.save();
  realtimeGateway.emitToConversation(conversation._id, "message:typing", { conversationId: conversation._id, userId: user._id, isTyping, at: now });
  return { conversationId: conversation._id, isTyping };
}

async function createTemplate(payload, user) {
  return MessageTemplate.create({ ...payload, createdBy: user._id, updatedBy: user._id });
}

async function renderTemplate(template, variables = {}, user) {
  template.usageCount += 1;
  template.lastUsedAt = new Date();
  await template.save();
  let body = template.body;
  for (const [key, value] of Object.entries(variables)) {
    body = body.replace(new RegExp(`{{\\s*${key}\\s*}}`, "g"), value ?? "");
  }
  return {
    subject: template.subject,
    messageBody: body,
    renderedBy: user?._id,
  };
}

function suggestReplies(conversation, recentMessages = []) {
  const latest = recentMessages[recentMessages.length - 1]?.messageBody || "";
  const suggestions = [
    "Thank you for the update. We will review and get back to you shortly.",
    "Could you please upload the related document so we can continue?",
    "I’ve noted this on your case and will coordinate with the assigned attorney.",
  ];
  if (/deadline|urgent|rfe/i.test(latest)) suggestions.unshift("We understand this is urgent and will prioritize the next review step.");
  if (/thank/i.test(latest)) suggestions.unshift("You’re welcome. Please let us know if you have any other questions.");
  return {
    conversationId: conversation._id,
    suggestions: suggestions.slice(0, 3),
    provider: "internal-rule-based",
    generatedAt: new Date(),
  };
}

function translateMessage(message, targetLanguage) {
  return {
    sourceLanguage: "auto",
    targetLanguage,
    translatedBody: `[${targetLanguage}] ${message.messageBody}`,
    provider: "placeholder",
    translatedAt: new Date(),
  };
}

function populateConversation(queryOrDoc) {
  return queryOrDoc.populate
    ? queryOrDoc.populate([
      { path: "clientId", select: "name displayName email role" },
      { path: "caseManagerId", select: "name displayName email role" },
      { path: "receiverId", select: "name displayName email role" },
      { path: "assignedTo", select: "name displayName email role" },
      { path: "caseId", select: "caseNumber caseId visaType clientName clientEmail" },
      { path: "participants.user", select: "name displayName email role" },
    ])
    : queryOrDoc;
}

function populateMessage(queryOrDoc) {
  return queryOrDoc.populate
    ? queryOrDoc.populate([
      { path: "senderId", select: "name displayName email role" },
      { path: "receiverId", select: "name displayName email role" },
      { path: "caseId", select: "caseNumber caseId clientName" },
      { path: "replyTo", select: "message messageBody senderName createdAt" },
      { path: "readBy.userId", select: "name displayName" },
    ])
    : queryOrDoc;
}

module.exports = {
  addAuditEntry,
  buildConversationFilter,
  buildMessageFilter,
  canAccessConversation,
  canAccessMessage,
  createOrGetCaseConversation,
  createOrGetDirectConversation,
  createTemplate,
  editMessage,
  emitTyping,
  addReaction,
  getAttachmentFile,
  isStaff,
  markConversationRead,
  markMessageRead,
  populateConversation,
  populateMessage,
  renderTemplate,
  sendMessage,
  syncCaseConversationParticipants,
  suggestReplies,
  translateMessage,
  updateConversation,
  writeAuditLog,
};
