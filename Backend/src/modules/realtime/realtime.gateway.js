let io = null;

// In-memory presence registry: userId -> count of active sockets (a user can
// have more than one tab/device open). This is per-process and resets on
// restart — acceptable for a single-instance deployment; a multi-instance
// setup would need this shared via Redis instead.
const onlineUsers = new Map();

// Bounds concurrent DB lookups during the connection-auth cache-miss path.
// A backend restart disconnects every open socket.io client at once; each
// reconnects on its own first retry attempt (socket.io-client defaults —
// see Admin/Immiglance SocketContext), so without this, a fleet of N
// simultaneously-reconnecting sockets across N distinct users would all
// call User.findById in the same instant, racing normal HTTP API traffic
// for the same MongoDB pool (see docs/MONGODB_STARTUP_LOAD_FINDINGS.md).
// This is on top of, not instead of, the getCachedUser/setCachedUser cache
// below — the cache collapses repeat lookups for the same user (multiple
// tabs, or the retry itself); this gate bounds the remaining distinct-user
// lookups so they queue a few at a time instead of all landing at once.
const AUTH_LOOKUP_CONCURRENCY = Math.max(1, Number(process.env.SOCKET_AUTH_LOOKUP_CONCURRENCY || 8));
let activeAuthLookups = 0;
const authLookupWaiters = [];

function acquireAuthLookupSlot() {
  if (activeAuthLookups < AUTH_LOOKUP_CONCURRENCY) {
    activeAuthLookups += 1;
    return Promise.resolve();
  }
  // sourceType/sourceName per docs/MONGODB_STARTUP_LOAD_FINDINGS.md's
  // instrumentation convention — lets a future mongodb_pool_checkout_wait
  // be cross-referenced against a real reconnect burst instead of guessed at.
  require("../../utils/logger").info("socket_auth_lookup_queued", {
    sourceType: "socket_connection_auth",
    sourceName: "realtimeGateway",
    queueDepth: authLookupWaiters.length + 1,
    activeLookups: activeAuthLookups,
  });
  return new Promise((resolve) => authLookupWaiters.push(resolve));
}

function releaseAuthLookupSlot() {
  const next = authLookupWaiters.shift();
  if (next) next();
  else activeAuthLookups = Math.max(0, activeAuthLookups - 1);
}

function init(httpServer, options = {}) {
  const { Server } = require("socket.io");
  const User = require("../../models/User");
  const Case = require("../../models/Case");
  const Conversation = require("../../models/Conversation");
  const mongoose = require("mongoose");
  const caseService = require("../cases/case.service");
  const { verifyAccessToken } = require("../auth/token.service");
  const { getCachedUser, setCachedUser } = require("../../config/redis");
  io = new Server(httpServer, {
    cors: {
      origin: options.origins || ["http://localhost:5173", "http://localhost:3002"],
      methods: ["GET", "POST"],
      credentials: true,
    },
  });

  io.use(async (socket, next) => {
    try {
      const bearer = socket.handshake.auth?.token || socket.handshake.headers?.authorization;
      const token = String(bearer || "").replace(/^Bearer\s+/i, "");
      if (!token) return next(new Error("Authentication required"));
      const decoded = verifyAccessToken(token);

      // Same cache-aside used by middleware/authenticate.js on the HTTP path
      // — reused here rather than duplicated (see config/redis.js).
      let user;
      const cached = await getCachedUser(decoded.userId);
      if (cached) {
        user = User.hydrate(cached);
      } else {
        await acquireAuthLookupSlot();
        try {
          user = await User.findById(decoded.userId).select("-password");
        } finally {
          releaseAuthLookupSlot();
        }
        if (user) setCachedUser(decoded.userId, user.toObject()).catch(() => {});
      }

      if (!user?.isActive || (user.tokenVersion || 0) !== (decoded.tokenVersion || 0)) return next(new Error("Invalid session"));
      socket.data.user = user;
      return next();
    } catch {
      return next(new Error("Invalid access token"));
    }
  });

  io.on("connection", (socket) => {
    const userId = socket.data.user?._id;
    const role = socket.data.user?.role;
    if (userId) socket.join(userId.toString());
    if (role) socket.join(`role:${role}`);

    if (userId) {
      const key = userId.toString();
      const priorCount = onlineUsers.get(key) || 0;
      onlineUsers.set(key, priorCount + 1);
      // Only the first socket for this user flips them online — a second
      // tab/device shouldn't re-announce or reset anything.
      if (priorCount === 0) io.emit("presence:update", { userId: key, isOnline: true });
    }

    socket.on("join", () => {
      if (userId) socket.join(userId.toString());
    });
    socket.on("notifications:join", () => {
      if (userId) socket.join(userId.toString());
    });
    socket.on("role:join", () => {
      if (role) socket.join(`role:${role}`);
    });
    socket.on("conversation:join", async (conversationId, callback) => {
      try {
        if (!mongoose.Types.ObjectId.isValid(conversationId)) throw new Error("Invalid conversation");
        const conversation = await Conversation.findById(conversationId).select("_id caseId participants type deletedAt").lean();
        if (!conversation || conversation.deletedAt) throw new Error("Conversation not found");
        const currentUser = socket.data.user;
        const isParticipant = (conversation.participants || []).some((participant) => participant.user?.toString() === currentUser._id.toString());
        let allowed = isParticipant;
        if (conversation.caseId) {
          const caseData = await Case.findById(conversation.caseId).lean();
          allowed = Boolean(caseData && caseService.canAccessCase(currentUser, caseData));
        }
        if (!allowed) throw new Error("Conversation access denied");
        socket.join(`conversation:${conversation._id}`);
        if (typeof callback === "function") callback({ ok: true });
      } catch (error) {
        if (typeof callback === "function") callback({ ok: false, code: "CONVERSATION_ACCESS_DENIED" });
      }
    });
    socket.on("conversation:leave", (conversationId) => {
      if (mongoose.Types.ObjectId.isValid(conversationId)) socket.leave(`conversation:${conversationId}`);
    });

    socket.on("disconnect", async () => {
      if (!userId) return;
      const key = userId.toString();
      const remaining = (onlineUsers.get(key) || 1) - 1;
      if (remaining > 0) {
        onlineUsers.set(key, remaining);
        return;
      }
      onlineUsers.delete(key);
      const lastSeenAt = new Date();
      io.emit("presence:update", { userId: key, isOnline: false, lastSeenAt });
      try {
        const User = require("../../models/User");
        await User.findByIdAndUpdate(key, { lastSeenAt });
      } catch {
        // Best-effort — a missed lastSeenAt write just means a slightly
        // stale "last seen" the next time someone looks, not a hard failure.
      }
    });
  });

  return io;
}

function isUserOnline(userId) {
  return onlineUsers.has(String(userId));
}

function getOnlineUserIds() {
  return Array.from(onlineUsers.keys());
}

function emitToUser(userId, event, payload) {
  if (!io || !userId) return false;
  io.to(userId.toString()).emit(event, payload);
  return true;
}

function emitToRole(role, event, payload) {
  if (!io || !role) return false;
  io.to(`role:${role}`).emit(event, payload);
  return true;
}

function emitToConversation(conversationId, event, payload) {
  if (!io || !conversationId) return false;
  io.to(`conversation:${conversationId}`).emit(event, payload);
  return true;
}

function getIO() {
  return io;
}

// Case reassignment side-effect: force a user's already-connected sockets out
// of a conversation room (and the replacement in) without waiting on the
// client to send conversation:leave/join itself — the old case manager must
// stop receiving new messages the instant the case moves, not whenever their
// tab happens to reconcile.
function evictUserFromConversation(userId, conversationId) {
  if (!io || !userId || !conversationId) return false;
  io.in(userId.toString()).socketsLeave(`conversation:${conversationId}`);
  return true;
}

function joinUserToConversation(userId, conversationId) {
  if (!io || !userId || !conversationId) return false;
  io.in(userId.toString()).socketsJoin(`conversation:${conversationId}`);
  return true;
}

module.exports = {
  emitToConversation,
  emitToRole,
  emitToUser,
  evictUserFromConversation,
  getIO,
  getOnlineUserIds,
  init,
  isUserOnline,
  joinUserToConversation,
};
