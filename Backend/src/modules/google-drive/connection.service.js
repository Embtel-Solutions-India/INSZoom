const crypto = require("crypto");
const env = require("../../config/env");
const logger = require("../../utils/logger");
const secretBox = require("../../utils/secretBox");
const GoogleDriveConnection = require("../../models/GoogleDriveConnection");
const GoogleDriveOAuthState = require("../../models/GoogleDriveOAuthState");
const GoogleDriveFileLink = require("../../models/GoogleDriveFileLink");
const GoogleDriveJob = require("../../models/GoogleDriveJob");
const driveClient = require("./drive.client");

// Each team member connects THEIR OWN Google account: the connection, folders, copies (links) and job history are all keyed by the
// user's id and are private to them. Nothing here is shared between users.

// mongoose autoIndex is off in this deployment, so the (small, new) collections create their own indexes once, on first use.
let indexesReady = null;
function ensureIndexes() {
  if (!indexesReady) {
    indexesReady = Promise.all([
      GoogleDriveConnection.createIndexes(),
      GoogleDriveOAuthState.createIndexes(),
      GoogleDriveFileLink.createIndexes(),
      GoogleDriveJob.createIndexes(),
    ]).catch((error) => {
      indexesReady = null; // try again next time; the feature keeps working without them, only de-duplication guarantees are weaker
      logger.error("google_drive_index_creation_failed", { error });
    });
  }
  return indexesReady;
}

const hashState = (value) => crypto.createHash("sha256").update(String(value)).digest("hex");

// Only a plain path is accepted as the place to send the browser back to (never a full URL), so this cannot become an open redirect.
function safeReturnPath(value) {
  const path = String(value || "");
  return /^\/[A-Za-z0-9\-._~/%]*$/.test(path) && !path.startsWith("//") ? path.slice(0, 300) : "/";
}

function returnUrl(returnPath, params) {
  const url = new URL(safeReturnPath(returnPath), env.googleDrive.adminPortalUrl);
  Object.entries(params).forEach(([key, value]) => value && url.searchParams.set(key, String(value)));
  return url.toString();
}

async function getStatus(user) {
  const connection = await GoogleDriveConnection.findOne({ userId: user._id }).lean();
  const connected = connection?.status === "connected";
  return {
    enabled: true,
    configured: driveClient.isConfigured(),
    status: connection?.status || "disconnected",
    connected,
    email: connected || connection?.status === "reconnect_required" ? connection.googleEmail || null : null,
    connectedAt: connection?.connectedAt || null,
    lastSuccessfulSyncAt: connection?.lastSuccessfulSyncAt || null,
    lastError: connection?.status === "reconnect_required" ? connection.lastError?.message || null : null,
  };
}

async function startConnect(user, returnPath) {
  await ensureIndexes();
  const client = driveClient.newOAuthClient();
  const { codeVerifier, codeChallenge } = await client.generateCodeVerifierAsync();
  const state = crypto.randomBytes(32).toString("base64url");
  await GoogleDriveOAuthState.create({
    stateHash: hashState(state),
    userId: user._id,
    codeVerifierEnc: secretBox.encrypt(codeVerifier, env.googleDrive.tokenEncryptionKey),
    returnPath: safeReturnPath(returnPath),
  });
  const authUrl = client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent", // forces a refresh token even if this account authorized the app before
    scope: driveClient.SCOPES,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    include_granted_scopes: false, // never merge with the login grant
  });
  return { authUrl };
}

// Google redirects the browser here. There is no session on this request (auth is a Bearer header), so the single-use state row,
// created by an authenticated request and bound to that user, is what authorizes it: whoever started the flow is the user whose
// connection is saved. Always answers with a redirect back to Admin.
async function handleCallback(query) {
  const { code, state, error: googleError } = query || {};
  let returnPath = "/";
  try {
    if (!state || typeof state !== "string") return returnUrl(returnPath, { gdrive: "error", reason: "invalid_state" });
    // Atomic single use: only the first request that presents this state gets the row.
    const stateRow = await GoogleDriveOAuthState.findOneAndUpdate({ stateHash: hashState(state), usedAt: { $exists: false } }, { $set: { usedAt: new Date() } }, { new: false });
    if (!stateRow) return returnUrl(returnPath, { gdrive: "error", reason: "invalid_state" });
    returnPath = stateRow.returnPath || "/";
    if (googleError) return returnUrl(returnPath, { gdrive: "error", reason: googleError === "access_denied" ? "cancelled" : "google_error" });
    if (!code || typeof code !== "string") return returnUrl(returnPath, { gdrive: "error", reason: "no_code" });

    const client = driveClient.newOAuthClient();
    const codeVerifier = secretBox.decrypt(stateRow.codeVerifierEnc, env.googleDrive.tokenEncryptionKey);
    const { tokens } = await client.getToken({ code, codeVerifier });
    const granted = String(tokens.scope || "").split(/\s+/);
    if (!granted.includes(driveClient.DRIVE_FILE_SCOPE)) return returnUrl(returnPath, { gdrive: "error", reason: "scope_missing" });
    if (!tokens.refresh_token) return returnUrl(returnPath, { gdrive: "error", reason: "no_refresh_token" });

    let identity = {};
    if (tokens.id_token) {
      const ticket = await client.verifyIdToken({ idToken: tokens.id_token, audience: env.google.oauthClientId });
      identity = ticket.getPayload() || {};
    }
    const userId = stateRow.userId;
    const existing = await GoogleDriveConnection.findOne({ userId }).lean();
    const accountChanged = Boolean(existing?.googleAccountId && identity.sub && existing.googleAccountId !== identity.sub);

    await GoogleDriveConnection.findOneAndUpdate(
      { userId },
      {
        $set: {
          status: "connected",
          googleAccountId: identity.sub,
          googleEmail: identity.email,
          scopes: granted,
          refreshTokenEnc: secretBox.encrypt(tokens.refresh_token, env.googleDrive.tokenEncryptionKey),
          connectedAt: new Date(),
        },
        $unset: { lastError: "" },
      },
      { upsert: true, new: true }
    );
    driveClient.dropToken(userId);
    // Links point at files in the user's previous Google account; they are only a de-duplication cache, so they are dropped
    // (nothing in Drive is touched).
    if (accountChanged) await GoogleDriveFileLink.deleteMany({ userId });
    await audit(userId, "google_drive.connected", { accountChanged });
    return returnUrl(returnPath, { gdrive: "connected" });
  } catch (error) {
    // Never echo Google's response; the message may contain codes or tokens.
    logger.error("google_drive_callback_failed", { code: error?.code, status: error?.status || error?.response?.status });
    return returnUrl(returnPath, { gdrive: "error", reason: "connect_failed" });
  }
}

async function disconnect(user) {
  const userId = user._id;
  const connection = await GoogleDriveConnection.findOne({ userId }).select("+refreshTokenEnc");
  if (!connection) return { disconnected: true };
  if (connection.refreshTokenEnc) {
    try {
      await driveClient.revokeRefreshToken(secretBox.decrypt(connection.refreshTokenEnc, env.googleDrive.tokenEncryptionKey));
    } catch {
      /* revocation is best effort; the local token is removed regardless */
    }
  }
  await GoogleDriveConnection.updateOne({ userId }, { $set: { status: "disconnected" }, $unset: { refreshTokenEnc: "", lastError: "" } });
  driveClient.dropToken(userId);
  await audit(userId, "google_drive.disconnected", {});
  return { disconnected: true };
}

async function audit(userId, action, metadata) {
  try {
    await require("../../models/AuditLog").create({ userId, action, entityType: "google_drive", entityId: String(userId), details: action, metadata, source: "api" });
  } catch {
    /* an audit failure must never affect the action */
  }
}

module.exports = { audit, disconnect, ensureIndexes, getStatus, handleCallback, safeReturnPath, startConnect };
