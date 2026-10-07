// Firebase Cloud Messaging delivery. This is the ONLY place that talks to a
// push delivery provider — other business modules (cases, documents,
// payments, ...) must never import this directly; they go through
// notification.service.js's createNotification(), which calls sendToUser()
// for the "push" channel (see dispatchPushChannel there — the one call site
// into this module).
const firebaseAdmin = require("../../config/firebase-admin");
const logger = require("../../utils/logger");
const deviceTokenService = require("./device-token.service");

const PUSH_NOT_CONFIGURED = "Push notifications are temporarily unavailable (delivery provider not configured)";

const DEAD_TOKEN_CODES = new Set([
  "messaging/registration-token-not-registered",
  "messaging/invalid-registration-token",
  "messaging/invalid-argument",
]);

function stringifyDataValues(data = {}) {
  // FCM's `data` payload requires every value to be a string.
  const entries = Object.entries(data).filter(([, value]) => value !== undefined && value !== null);
  return Object.fromEntries(entries.map(([key, value]) => [key, String(value)]));
}

function buildMessage(payload = {}) {
  const tag = payload.tag || payload.data?.tag;
  const link = payload.link;
  return {
    notification: { title: payload.title, body: payload.body },
    // `link` goes into `data` (not just webpush.fcmOptions below) because the foreground handler (onMessage) and the
    // service worker's onBackgroundMessage both read payload.data.link to route the click. title/body are repeated in
    // `data` so a service worker can always render the notification itself.
    data: stringifyDataValues({ ...payload.data, link, title: payload.title, body: payload.body, tag }),
    webpush: {
      // High urgency + a day of retention: delivered immediately to a sleeping browser, like a chat app.
      headers: { Urgency: "high", TTL: "86400" },
      notification: {
        title: payload.title,
        body: payload.body,
        icon: "/favicon.svg",
        // Same tag = the thread's notification is replaced (and re-alerts) instead of piling up.
        ...(tag ? { tag, renotify: true } : {}),
      },
      ...(link ? { fcmOptions: { link } } : {}),
    },
  };
}

async function deactivateDeadTokens(tokens, errorCodes) {
  await Promise.all(
    tokens
      .filter((_, index) => DEAD_TOKEN_CODES.has(errorCodes[index]))
      .map((token) => deviceTokenService.deactivateToken(token).catch(() => null))
  );
}

async function sendToToken(token, payload = {}) {
  if (!token) return { sent: false, error: "No token provided" };
  if (!firebaseAdmin.isConfigured()) return { sent: false, skipped: PUSH_NOT_CONFIGURED };
  try {
    const messaging = firebaseAdmin.getMessaging();
    await messaging.send({ token, ...buildMessage(payload) });
    return { sent: true };
  } catch (error) {
    if (DEAD_TOKEN_CODES.has(error.code)) await deviceTokenService.deactivateToken(token).catch(() => null);
    return { sent: false, error: error.message, code: error.code };
  }
}

async function sendMulticast(tokens, payload = {}) {
  const validTokens = [...new Set((tokens || []).filter(Boolean))];
  if (!validTokens.length) return { successCount: 0, failureCount: 0, responses: [] };
  if (!firebaseAdmin.isConfigured()) return { successCount: 0, failureCount: validTokens.length, skipped: PUSH_NOT_CONFIGURED };
  try {
    const messaging = firebaseAdmin.getMessaging();
    const response = await messaging.sendEachForMulticast({ tokens: validTokens, ...buildMessage(payload) });
    await deactivateDeadTokens(
      validTokens,
      response.responses.map((entry) => (entry.success ? null : entry.error?.code))
    );
    if (response.failureCount) {
      const codes = {};
      response.responses.forEach((entry) => { if (!entry.success) codes[entry.error?.code || "unknown"] = (codes[entry.error?.code || "unknown"] || 0) + 1; });
      logger.warn("push_delivery_failures", { sent: response.successCount, failed: response.failureCount, codes });
    }
    return { successCount: response.successCount, failureCount: response.failureCount, responses: response.responses };
  } catch (error) {
    logger.error("push_send_error", { error: error.message, code: error.code });
    return { successCount: 0, failureCount: validTokens.length, error: error.message };
  }
}

async function sendToUser(userId, payload = {}) {
  if (!userId) return { successCount: 0, failureCount: 0, skipped: "No userId" };
  if (!firebaseAdmin.isConfigured()) {
    logger.warn("push_not_configured", { hint: "Set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY on the server" });
    return { successCount: 0, failureCount: 0, skipped: PUSH_NOT_CONFIGURED };
  }
  const tokens = await deviceTokenService.tokensForUser(userId);
  if (!tokens.length) logger.info("push_no_devices", { userId: String(userId) });
  return sendMulticast(tokens.map((entry) => entry.token), payload);
}

async function sendToUsers(userIds, payload = {}) {
  const uniqueIds = [...new Set((userIds || []).filter(Boolean).map(String))];
  if (!uniqueIds.length) return { successCount: 0, failureCount: 0, skipped: "No userIds" };
  if (!firebaseAdmin.isConfigured()) return { successCount: 0, failureCount: 0, skipped: PUSH_NOT_CONFIGURED };
  const tokenDocs = await deviceTokenService.tokensForUsers(uniqueIds);
  return sendMulticast(tokenDocs.map((entry) => entry.token), payload);
}

module.exports = { sendToToken, sendMulticast, sendToUser, sendToUsers };
