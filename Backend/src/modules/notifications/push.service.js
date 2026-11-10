// Firebase Cloud Messaging delivery. This is the ONLY place that talks to a
// push delivery provider — other business modules (cases, documents,
// payments, ...) must never import this directly; they go through
// notification.service.js's createNotification(), which calls sendToUser()
// for the "push" channel (see dispatchPushChannel there — the one call site
// into this module).
const firebaseAdmin = require("../../config/firebase-admin");
const logger = require("../../utils/logger");
const env = require("../../config/env");
const deviceTokenService = require("./device-token.service");
const pushRouting = require("./pushRouting");
const User = require("../../models/User");

const PUSH_SUPPRESSED = "Notifications are paused (NOTIFICATIONS_SUPPRESS_ALL)";
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
  const chatTag = payload.tag || payload.data?.tag; // one conversation = one tag (kept in `data` so the app can group a conversation's notifications)
  // Each notification ALSO gets its own tag ("<conversation>:<id>"). A notification that merely replaces an earlier one with the same tag is added to the
  // Notification Center without popping up on Safari (Mac, iPhone, iPad), which does not support the re-alert flag; a notification with its own tag always pops
  // up. The app then closes the conversation's older ones, so only the newest stays on screen.
  const tag = chatTag && payload.data?.notificationId ? `${chatTag}:${payload.data.notificationId}` : chatTag;
  const link = payload.link;
  return {
    // DATA ONLY: no ready-made "notification" part. With one, Firebase's own code showed a copy of the notification AND the app's service worker showed another
    // (and on iPhone / Mac Safari the worker could not even tell the first was there), which is why a notification arrived twice. Without it the service worker is
    // the only thing that displays it, so every push is shown exactly once, in the same way on Android, Windows, macOS and iPhone.
    // `link` goes into `data` (not just webpush.fcmOptions below) because the foreground handler (onMessage) and the
    // service worker's onBackgroundMessage both read payload.data.link to route the click. title/body are repeated in
    // `data` so a service worker can always render the notification itself.
    // `url` = the absolute address on the recipient's own portal (opened when no tab of that portal is open); `link` stays the in-app path.
    data: stringifyDataValues({ ...payload.data, link, url: payload.url, title: payload.title, body: payload.body, tag: chatTag }),
    webpush: {
      // High urgency + a day of retention: delivered immediately to a sleeping browser, like a chat app.
      headers: { Urgency: "high", TTL: "86400" },
      // FCM only accepts an https link here; the service worker reads data.url / data.link either way.
      ...(/^https:\/\//i.test(payload.url || "") ? { fcmOptions: { link: payload.url } } : {}),
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
  if (env.notificationsSuppressAll) return { sent: false, skipped: PUSH_SUPPRESSED };
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
  if (env.notificationsSuppressAll) return { successCount: 0, failureCount: 0, responses: [], skipped: PUSH_SUPPRESSED };
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

// Delivers to the user's devices on THEIR OWN portal only (see pushRouting.js). If routing cannot be worked out for any reason the
// previous behaviour (every device, link as given) is used, so a routing problem can never stop a notification.
async function sendToUser(userId, payload = {}) {
  if (!userId) return { successCount: 0, failureCount: 0, skipped: "No userId" };
  if (!firebaseAdmin.isConfigured()) {
    logger.warn("push_not_configured", { hint: "Set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY on the server" });
    return { successCount: 0, failureCount: 0, skipped: PUSH_NOT_CONFIGURED };
  }
  const tokens = await deviceTokenService.tokensForUser(userId);
  if (!tokens.length) logger.info("push_no_devices", { userId: String(userId) });

  let plan = null;
  try {
    const user = await User.findById(userId).select("role").lean();
    plan = pushRouting.planDeliveries({ role: user?.role, tokens, link: payload.link });
  } catch (error) {
    logger.warn("push_routing_failed", { error: error.message });
  }
  if (!plan) return sendMulticast(tokens.map((entry) => entry.token), payload);
  if (!plan.groups.length) {
    return tokens.length
      ? { successCount: 0, failureCount: 0, skipped: `No device registered on the ${plan.portal} portal` }
      : { successCount: 0, failureCount: 0, responses: [] };
  }

  const results = [];
  for (const group of plan.groups) results.push(await sendMulticast(group.tokens, { ...payload, link: plan.link, url: group.url }));
  const successCount = results.reduce((sum, r) => sum + (r.successCount || 0), 0);
  const failureCount = results.reduce((sum, r) => sum + (r.failureCount || 0), 0);
  const combined = { successCount, failureCount, responses: results.flatMap((r) => r.responses || []) };
  if (!successCount) {
    const skipped = results.find((r) => r.skipped)?.skipped;
    const error = results.find((r) => r.error)?.error;
    if (skipped && !error) combined.skipped = skipped;
    if (error) combined.error = error;
  }
  return combined;
}

async function sendToUsers(userIds, payload = {}) {
  const uniqueIds = [...new Set((userIds || []).filter(Boolean).map(String))];
  if (!uniqueIds.length) return { successCount: 0, failureCount: 0, skipped: "No userIds" };
  if (!firebaseAdmin.isConfigured()) return { successCount: 0, failureCount: 0, skipped: PUSH_NOT_CONFIGURED };
  const tokenDocs = await deviceTokenService.tokensForUsers(uniqueIds);
  return sendMulticast(tokenDocs.map((entry) => entry.token), payload);
}

module.exports = { buildMessage, sendToToken, sendMulticast, sendToUser, sendToUsers };
