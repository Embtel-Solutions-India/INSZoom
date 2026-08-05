const { getFirebaseAdmin } = require("../auth/firebase.service");
const deviceTokenService = require("./device-token.service");

// Error codes Firebase Admin returns for a token that will never succeed
// again (uninstalled app, revoked permission, stale registration) — these
// are the ones we auto-clean, per "remove invalid tokens automatically".
// Anything else (rate limits, transient network errors) is left alone so a
// temporary blip doesn't wipe out a still-good token.
const DEAD_TOKEN_CODES = new Set([
  "messaging/registration-token-not-registered",
  "messaging/invalid-registration-token",
  "messaging/invalid-argument",
]);

function buildMessage(payload = {}) {
  const { title, body, link, data = {} } = payload;
  return {
    notification: { title, body },
    data: Object.fromEntries(Object.entries({ ...data, link }).filter(([, v]) => v != null).map(([k, v]) => [k, String(v)])),
    webpush: link ? { fcmOptions: { link } } : undefined,
  };
}

// This module is the ONLY place that talks to admin.messaging() — other
// business modules (cases, documents, payments, ...) must never import it
// directly; they go through notification.service.js's createNotification(),
// which calls sendToUser() for the "push" channel.

async function sendToToken(token, payload) {
  if (!token) return { sent: false, error: "No token provided" };
  try {
    const admin = getFirebaseAdmin();
    const messageId = await admin.messaging().send({ token, ...buildMessage(payload) });
    return { sent: true, messageId };
  } catch (error) {
    if (DEAD_TOKEN_CODES.has(error.code)) {
      await deviceTokenService.deactivateToken(token).catch(() => {});
    }
    return { sent: false, error: error.message, code: error.code };
  }
}

async function sendMulticast(tokens, payload) {
  const validTokens = [...new Set((tokens || []).filter(Boolean))];
  if (!validTokens.length) return { successCount: 0, failureCount: 0, responses: [] };
  try {
    const admin = getFirebaseAdmin();
    const result = await admin.messaging().sendEachForMulticast({ tokens: validTokens, ...buildMessage(payload) });
    await Promise.all(
      result.responses.map((response, index) => {
        if (!response.success && DEAD_TOKEN_CODES.has(response.error?.code)) {
          return deviceTokenService.deactivateToken(validTokens[index]).catch(() => {});
        }
        return null;
      })
    );
    return result;
  } catch (error) {
    return { successCount: 0, failureCount: validTokens.length, error: error.message };
  }
}

async function sendToUser(userId, payload) {
  if (!userId) return { successCount: 0, failureCount: 0, skipped: "No userId" };
  const tokens = (await deviceTokenService.tokensForUser(userId)).map((doc) => doc.token);
  if (!tokens.length) return { successCount: 0, failureCount: 0, skipped: "No registered devices" };
  return sendMulticast(tokens, payload);
}

async function sendToUsers(userIds, payload) {
  const uniqueIds = [...new Set((userIds || []).filter(Boolean).map(String))];
  if (!uniqueIds.length) return { successCount: 0, failureCount: 0, skipped: "No userIds" };
  const tokens = (await deviceTokenService.tokensForUsers(uniqueIds)).map((doc) => doc.token);
  if (!tokens.length) return { successCount: 0, failureCount: 0, skipped: "No registered devices" };
  return sendMulticast(tokens, payload);
}

module.exports = { sendToToken, sendMulticast, sendToUser, sendToUsers };
