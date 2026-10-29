const crypto = require("crypto");
const env = require("../../config/env");
const logger = require("../../utils/logger");
const secretBox = require("../../utils/secretBox");
const GoogleDriveConnection = require("../../models/GoogleDriveConnection");
const GoogleDriveOAuthState = require("../../models/GoogleDriveOAuthState");
const GoogleDriveFileLink = require("../../models/GoogleDriveFileLink");
const GoogleDriveJob = require("../../models/GoogleDriveJob");
const driveClient = require("./drive.client");

// Each team member connects THEIR OWN Google account(s): they can connect several and switch between them (one is "active").
// Connections, folders, copies (links) and job history are all private to the user; nothing is shared between users.

// mongoose autoIndex is off in this deployment, so the (small, new) collections create their own indexes once, on first use. Indexes
// left behind by earlier builds of this feature (one-connection-per-user / per-organisation keys) are removed first: they would reject
// a second account or a new link.
const LEGACY_INDEX = (index) => (index.name === "userId_1" && index.unique) || Object.keys(index.key || {}).includes("orgId") || (index.unique && Object.keys(index.key || {}).join() === "userId,documentId,driveFolderId") || (index.unique && Object.keys(index.key || {}).join() === "userId,driveFileId");
async function dropLegacyIndexes(model) {
  try {
    const indexes = await model.collection.indexes();
    for (const index of indexes.filter(LEGACY_INDEX)) await model.collection.dropIndex(index.name);
  } catch (error) {
    if (error?.codeName !== "NamespaceNotFound" && error?.code !== 26) throw error; // a collection that does not exist yet has nothing to clean
  }
}

let indexesReady = null;
function ensureIndexes() {
  if (!indexesReady) {
    indexesReady = Promise.all([dropLegacyIndexes(GoogleDriveConnection), dropLegacyIndexes(GoogleDriveFileLink), dropLegacyIndexes(GoogleDriveJob)])
      .then(() => Promise.all([GoogleDriveConnection.createIndexes(), GoogleDriveOAuthState.createIndexes(), GoogleDriveFileLink.createIndexes(), GoogleDriveJob.createIndexes()]))
      .catch((error) => {
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

const notConnected = (message, code) => Object.assign(new Error(message), { statusCode: 409, code });

const UPGRADE_MESSAGE = "Immiglance now needs access to your whole Google Drive so you can pick existing folders and subfolders. Please reconnect this account once.";
const needsUpgrade = (account) => account.status === "connected" && !driveClient.hasRequiredScope(account.scopes);
const effectiveStatus = (account) => (needsUpgrade(account) ? "reconnect_required" : account.status);

// The user's accounts, newest first. Connections that were removed are not listed.
const listConnections = (userId) => GoogleDriveConnection.find({ userId, status: { $ne: "disconnected" } }).sort({ connectedAt: -1 }).lean();

// The account the dialog is using. If none is marked active (older data, or the active one was removed) the most recent usable account is
// promoted, so a user who has any connected account is never asked to connect again.
async function getActive(userId) {
  const accounts = await listConnections(userId);
  if (!accounts.length) return null;
  const active = accounts.find((account) => account.active);
  if (active) return active;
  const fallback = accounts.find((account) => account.status === "connected") || accounts[0];
  await GoogleDriveConnection.updateOne({ _id: fallback._id }, { $set: { active: true } });
  return { ...fallback, active: true };
}

// For every endpoint that talks to Drive: the active account, or a clear "connect / reconnect" error.
async function requireActive(user) {
  const active = await getActive(user._id);
  if (!active) throw notConnected("Connect your Google Drive first.", "NOT_CONNECTED");
  if (needsUpgrade(active)) throw notConnected(UPGRADE_MESSAGE, "RECONNECT_REQUIRED");
  if (active.status !== "connected") throw notConnected("This Google account needs to be reconnected. Reconnect it or switch to another account.", "RECONNECT_REQUIRED");
  return active;
}

const presentAccount = (account) => ({ id: String(account._id), email: account.googleEmail || null, status: effectiveStatus(account), active: Boolean(account.active), connectedAt: account.connectedAt || null });

async function getStatus(user) {
  const accounts = await listConnections(user._id);
  const active = accounts.length ? await getActive(user._id) : null;
  const connected = Boolean(active) && effectiveStatus(active) === "connected";
  return {
    enabled: true,
    configured: driveClient.isConfigured(),
    // top level = the active account (what the dialog uses)
    status: active ? effectiveStatus(active) : "disconnected",
    connected,
    email: active?.googleEmail || null,
    connectedAt: active?.connectedAt || null,
    lastSuccessfulSyncAt: active?.lastSuccessfulSyncAt || null,
    lastError: active && needsUpgrade(active) ? UPGRADE_MESSAGE : active?.status === "reconnect_required" ? active.lastError?.message || null : null,
    accounts: accounts.map((account) => presentAccount({ ...account, active: Boolean(active) && String(account._id) === String(active._id) })),
  };
}

// Starts connecting a Google account (the first one, an extra one, or a reconnect). `select_account` makes Google ask which account, so
// adding a second Drive really lets the user pick a different one instead of silently reusing the signed-in account.
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
    prompt: "select_account consent", // pick the account; consent forces a refresh token even if this account authorized the app before
    scope: driveClient.SCOPES,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    include_granted_scopes: false, // never merge with the login grant
  });
  return { authUrl };
}

// Google redirects the browser here. There is no session on this request (auth is a Bearer header), so the single-use state row,
// created by an authenticated request and bound to that user, is what authorizes it: whoever started the flow is the user the account
// is saved for. Always answers with a redirect back to Admin.
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
    if (!driveClient.hasRequiredScope(granted)) return returnUrl(returnPath, { gdrive: "error", reason: "scope_missing" });
    if (!tokens.refresh_token) return returnUrl(returnPath, { gdrive: "error", reason: "no_refresh_token" });

    let identity = {};
    if (tokens.id_token) {
      const ticket = await client.verifyIdToken({ idToken: tokens.id_token, audience: env.google.oauthClientId });
      identity = ticket.getPayload() || {};
    }
    if (!identity.sub) return returnUrl(returnPath, { gdrive: "error", reason: "no_identity" });
    const userId = stateRow.userId;

    // The same Google account again (a reconnect) refreshes that connection; a different account is added next to the others.
    const saved = await GoogleDriveConnection.findOneAndUpdate(
      { userId, googleAccountId: identity.sub },
      {
        $set: {
          status: "connected",
          googleEmail: identity.email,
          scopes: granted,
          refreshTokenEnc: secretBox.encrypt(tokens.refresh_token, env.googleDrive.tokenEncryptionKey),
          connectedAt: new Date(),
          active: true, // the account just connected becomes the active one
        },
        $unset: { lastError: "" },
      },
      { upsert: true, new: true }
    );
    await GoogleDriveConnection.updateMany({ userId, _id: { $ne: saved._id } }, { $set: { active: false } });
    driveClient.dropToken(saved._id);
    await audit(userId, "google_drive.connected", { connectionId: String(saved._id) });
    return returnUrl(returnPath, { gdrive: "connected" });
  } catch (error) {
    // Never echo Google's response; the message may contain codes or tokens.
    logger.error("google_drive_callback_failed", { code: error?.code, status: error?.status || error?.response?.status });
    return returnUrl(returnPath, { gdrive: "error", reason: "connect_failed" });
  }
}

// Makes one of the user's own accounts the active one.
async function activate(user, connectionId) {
  const target = await GoogleDriveConnection.findOne({ _id: connectionId, userId: user._id, status: { $ne: "disconnected" } }).lean();
  if (!target) return null;
  await GoogleDriveConnection.updateMany({ userId: user._id, _id: { $ne: target._id } }, { $set: { active: false } });
  await GoogleDriveConnection.updateOne({ _id: target._id }, { $set: { active: true } });
  await audit(user._id, "google_drive.account_switched", { connectionId: String(target._id) });
  return target;
}

// Removes one of the user's own accounts: access is revoked at Google, the saved token and the copy records are deleted. Files already
// in that Drive are not touched. If it was the active account, another connected one becomes active.
async function removeAccount(user, connectionId) {
  const connection = await GoogleDriveConnection.findOne({ _id: connectionId, userId: user._id }).select("+refreshTokenEnc");
  if (!connection) return null;
  if (connection.refreshTokenEnc) {
    try {
      await driveClient.revokeRefreshToken(secretBox.decrypt(connection.refreshTokenEnc, env.googleDrive.tokenEncryptionKey));
    } catch {
      /* revocation is best effort; the local token is removed regardless */
    }
  }
  await GoogleDriveFileLink.deleteMany({ connectionId: connection._id });
  await GoogleDriveConnection.deleteOne({ _id: connection._id });
  driveClient.dropToken(connection._id);
  await audit(user._id, "google_drive.account_removed", { connectionId: String(connection._id) });
  await getActive(user._id); // promotes another account if the removed one was active
  return { removed: true };
}

async function audit(userId, action, metadata) {
  try {
    await require("../../models/AuditLog").create({ userId, action, entityType: "google_drive", entityId: String(userId), details: action, metadata, source: "api" });
  } catch {
    /* an audit failure must never affect the action */
  }
}

module.exports = { activate, audit, ensureIndexes, getActive, getStatus, handleCallback, listConnections, removeAccount, requireActive, safeReturnPath, startConnect };
