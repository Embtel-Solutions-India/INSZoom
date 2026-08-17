// Firebase Cloud Messaging delivery. This is the ONLY place that talks to a
// push delivery provider — other business modules (cases, documents,
// payments, ...) must never import this directly; they go through
// notification.service.js's createNotification(), which calls sendToUser()
// for the "push" channel (see dispatchPushChannel there — the one call site
// into this module).
const firebaseAdmin = require("../../config/firebase-admin");
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
  return {
    notification: { title: payload.title, body: payload.body },
    // `link` goes into `data` (not just webpush.fcmOptions below) because
    // the foreground handler (onMessage, consumed by NotificationBell.jsx's
    // onForegroundMessage) and the service worker's onBackgroundMessage both
    // read payload.data.link to reconstruct/route the notification —
    // fcmOptions.link is only the browser's native default-click target for
    // when no notificationclick handler runs.
    data: stringifyDataValues({ ...payload.data, link: payload.link }),
    ...(payload.link ? { webpush: { fcmOptions: { link: payload.link } } } : {}),
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
    return { successCount: response.successCount, failureCount: response.failureCount, responses: response.responses };
  } catch (error) {
    return { successCount: 0, failureCount: validTokens.length, error: error.message };
  }
}

async function sendToUser(userId, payload = {}) {
  if (!userId) return { successCount: 0, failureCount: 0, skipped: "No userId" };
  if (!firebaseAdmin.isConfigured()) return { successCount: 0, failureCount: 0, skipped: PUSH_NOT_CONFIGURED };
  const tokens = await deviceTokenService.tokensForUser(userId);
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
