let io = null;

// In-memory presence registry: userId -> count of active sockets (a user can
// have more than one tab/device open). This is per-process and resets on
// restart — acceptable for a single-instance deployment; a multi-instance
// setup would need this shared via Redis instead.
const onlineUsers = new Map();

function init(httpServer, options = {}) {
  const { Server } = require("socket.io");
  const User = require("../../models/User");
  const { verifyAccessToken } = require("../auth/token.service");
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
      const user = await User.findById(decoded.userId).select("_id role isActive tokenVersion");
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
    socket.on("conversation:join", (conversationId) => {
      if (conversationId) socket.join(`conversation:${conversationId}`);
    });
    socket.on("conversation:leave", (conversationId) => {
      if (conversationId) socket.leave(`conversation:${conversationId}`);
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
