const crypto = require("crypto");
const { OAuth2Client } = require("google-auth-library");
const env = require("../../config/env");
const secretBox = require("../../utils/secretBox");
const GoogleDriveConnection = require("../../models/GoogleDriveConnection");

const DRIVE_API = "https://www.googleapis.com/drive/v3";
const DRIVE_UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";
const FOLDER_MIME = "application/vnd.google-apps.folder";
// drive.file: the app only sees files/folders it created or that a user picked in Google Picker. openid/email only label the account.
const DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const SCOPES = [DRIVE_FILE_SCOPE, "openid", "email"];
const MULTIPART_LIMIT = 5 * 1024 * 1024;
const MAX_ATTEMPTS = 4;

class DriveError extends Error {
  constructor(message, { status, code, retryable = false } = {}) {
    super(message);
    this.name = "DriveError";
    this.status = status;
    this.code = code;
    this.retryable = retryable;
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function newOAuthClient() {
  return new OAuth2Client(env.google.oauthClientId, env.google.oauthClientSecret, env.googleDrive.redirectUri);
}

function isConfigured() {
  const drive = env.googleDrive;
  return Boolean(
    drive.enabled &&
      env.google.oauthClientId &&
      env.google.oauthClientSecret &&
      drive.redirectUri &&
      drive.redirectUriSafe &&
      drive.adminPortalUrl &&
      String(drive.tokenEncryptionKey).length >= 32
  );
}

// ---- access tokens: refreshed from the stored (encrypted) refresh token, cached in memory only, one refresh in flight per user ----
const tokenCache = new Map(); // userId -> { token, expiresAt }
const refreshing = new Map(); // userId -> Promise

function dropToken(userId) {
  tokenCache.delete(String(userId));
}

async function markReconnectRequired(userId, message) {
  dropToken(userId);
  await GoogleDriveConnection.updateOne({ userId }, { $set: { status: "reconnect_required", lastError: { code: "invalid_grant", message, at: new Date() } } }).catch(() => {});
}

async function refreshAccessToken(userId) {
  const connection = await GoogleDriveConnection.findOne({ userId }).select("+refreshTokenEnc");
  if (!connection || connection.status === "disconnected" || !connection.refreshTokenEnc) {
    throw new DriveError("Google Drive is not connected", { status: 409, code: "NOT_CONNECTED" });
  }
  if (connection.status === "reconnect_required") {
    throw new DriveError("Google Drive access was revoked or expired. An admin needs to reconnect it.", { status: 409, code: "RECONNECT_REQUIRED" });
  }
  let refreshToken;
  try {
    refreshToken = secretBox.decrypt(connection.refreshTokenEnc, env.googleDrive.tokenEncryptionKey);
  } catch {
    await markReconnectRequired(userId, "Saved authorization could not be read; reconnect required");
    throw new DriveError("The saved Google authorization could not be read. An admin needs to reconnect Google Drive.", { status: 409, code: "RECONNECT_REQUIRED" });
  }
  const client = newOAuthClient();
  client.setCredentials({ refresh_token: refreshToken });
  try {
    const { credentials } = await client.refreshAccessToken();
    const entry = { token: credentials.access_token, expiresAt: credentials.expiry_date || Date.now() + 50 * 60 * 1000 };
    tokenCache.set(userId, entry);
    return entry;
  } catch (error) {
    const text = `${error?.message || ""} ${error?.response?.data?.error || ""}`;
    if (/invalid_grant|unauthorized_client|invalid_client/i.test(text)) {
      await markReconnectRequired(userId, "Google rejected the saved authorization");
      throw new DriveError("Google Drive access was revoked or expired. An admin needs to reconnect it.", { status: 409, code: "RECONNECT_REQUIRED" });
    }
    throw new DriveError("Could not refresh Google access. Try again shortly.", { status: 502, code: "TOKEN_REFRESH_FAILED", retryable: true });
  }
}

async function getAccessToken(userId) {
  userId = String(userId)
  const cached = tokenCache.get(userId);
  if (cached && cached.expiresAt - Date.now() > 60 * 1000) return cached.token;
  if (!refreshing.has(userId)) {
    refreshing.set(userId, refreshAccessToken(userId).finally(() => refreshing.delete(userId)));
  }
  return (await refreshing.get(userId)).token;
}

// ---- request helper: guarded JSON parsing, retry on 429/5xx/network with backoff ----
function classify(status, body) {
  const reason = body?.error?.errors?.[0]?.reason || body?.error?.status || "";
  const message = body?.error?.message || `Google Drive request failed (${status})`;
  const rateLimited = status === 429 || /rateLimitExceeded|userRateLimitExceeded|RESOURCE_EXHAUSTED/i.test(reason);
  const retryable = rateLimited || status >= 500;
  let code = reason || `HTTP_${status}`;
  if (status === 404) code = "NOT_FOUND";
  else if (/storageQuotaExceeded/i.test(reason)) code = "STORAGE_QUOTA_EXCEEDED";
  else if (status === 403 && !rateLimited) code = "FORBIDDEN";
  else if (status === 409) code = "CONFLICT";
  return new DriveError(message, { status, code, retryable });
}

function parseJson(text) {
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

async function driveRequest(userId, url, options = {}) {
  let lastError;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const token = await getAccessToken(userId);
      const response = await fetch(url, { ...options, headers: { ...(options.headers || {}), Authorization: `Bearer ${token}` } });
      if (response.status === 401 && attempt < MAX_ATTEMPTS) {
        dropToken(userId);
        continue;
      }
      const body = parseJson(await response.text());
      if (!response.ok) {
        const error = classify(response.status, body);
        error.retryAfter = Number(response.headers.get("retry-after"));
        throw error;
      }
      return { body, headers: response.headers };
    } catch (error) {
      lastError = error;
      // Auth/config errors (NOT_CONNECTED, RECONNECT_REQUIRED) and 4xx are final; network failures and 429/5xx retry.
      const retryable = error instanceof DriveError ? error.retryable : true;
      if (!retryable || attempt === MAX_ATTEMPTS) break;
      const wait = Number.isFinite(error.retryAfter) && error.retryAfter > 0 ? Math.min(error.retryAfter * 1000, 30000) : Math.min(500 * 2 ** (attempt - 1), 8000) + Math.floor(Math.random() * 250);
      await sleep(wait);
    }
  }
  if (lastError instanceof DriveError) throw lastError;
  throw new DriveError("Could not reach Google Drive", { code: "NETWORK", retryable: true });
}

// ---- folders ----
const FOLDER_FIELDS = "id,name,mimeType,trashed,webViewLink,capabilities(canAddChildren)";

async function getFolder(userId, folderId) {
  const { body } = await driveRequest(userId, `${DRIVE_API}/files/${encodeURIComponent(folderId)}?fields=${encodeURIComponent(FOLDER_FIELDS)}&supportsAllDrives=true`);
  if (body.mimeType !== FOLDER_MIME) throw new DriveError("That item is not a folder", { status: 400, code: "NOT_A_FOLDER" });
  if (body.trashed) throw new DriveError("That folder is in the Drive trash", { status: 400, code: "FOLDER_TRASHED" });
  if (body.capabilities && body.capabilities.canAddChildren === false) throw new DriveError("The connected Google account cannot add files to that folder", { status: 403, code: "FOLDER_READ_ONLY" });
  return { id: body.id, name: body.name, webViewLink: body.webViewLink };
}

async function createFolder(userId, name, parentId) {
  const metadata = { name, mimeType: FOLDER_MIME, appProperties: { immiglance: "1" } };
  if (parentId) metadata.parents = [parentId];
  const { body } = await driveRequest(userId, `${DRIVE_API}/files?fields=id,name,webViewLink&supportsAllDrives=true`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(metadata),
  });
  return body;
}

// Under drive.file this lists only folders the app created (or that were picked); Google Picker is how a user reaches any other folder.
async function listAppFolders(userId, parentId = "root") {
  const q = `mimeType='${FOLDER_MIME}' and '${String(parentId).replace(/\\/g, "\\\\").replace(/'/g, "\\'")}' in parents and trashed=false`;
  const params = new URLSearchParams({ q, fields: "files(id,name,webViewLink)", pageSize: "100", orderBy: "name", supportsAllDrives: "true", includeItemsFromAllDrives: "true" });
  const { body } = await driveRequest(userId, `${DRIVE_API}/files?${params}`);
  return body.files || [];
}

// ---- files ----
async function generateFileId(userId) {
  const { body } = await driveRequest(userId, `${DRIVE_API}/files/generateIds?count=1&space=drive`);
  const id = body.ids?.[0];
  if (!id) throw new DriveError("Google did not return a file ID", { code: "GENERATE_IDS_FAILED", retryable: true });
  return id;
}

async function getFileMeta(userId, fileId) {
  const { body } = await driveRequest(userId, `${DRIVE_API}/files/${encodeURIComponent(fileId)}?fields=id,name,trashed,parents,md5Checksum,webViewLink&supportsAllDrives=true`);
  return body;
}

function md5(buffer) {
  return crypto.createHash("md5").update(buffer).digest("hex");
}

function multipartBody(metadata, mimeType, buffer) {
  const boundary = `icrm_${crypto.randomBytes(12).toString("hex")}`;
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Type: ${mimeType || "application/octet-stream"}\r\n\r\n`),
    buffer,
    Buffer.from(`\r\n--${boundary}--`),
  ]);
  return { body, contentType: `multipart/related; boundary=${boundary}` };
}

const UPLOAD_FIELDS = "id,name,webViewLink,md5Checksum,size";

// Creates (fileId = pre-generated ID inside parentId) or, with existing = true, updates that Drive file's content in place.
async function uploadFile(userId, { fileId, existing, name, mimeType, buffer, parentId, appProperties }) {
  const mime = mimeType || "application/octet-stream";
  const metadata = existing ? {} : { id: fileId, name, parents: [parentId], appProperties };
  if (buffer.length <= MULTIPART_LIMIT) {
    const { body, contentType } = multipartBody(metadata, mime, buffer);
    const url = existing
      ? `${DRIVE_UPLOAD_API}/files/${encodeURIComponent(fileId)}?uploadType=multipart&fields=${UPLOAD_FIELDS}&supportsAllDrives=true`
      : `${DRIVE_UPLOAD_API}/files?uploadType=multipart&fields=${UPLOAD_FIELDS}&supportsAllDrives=true`;
    return (await driveRequest(userId, url, { method: existing ? "PATCH" : "POST", headers: { "Content-Type": contentType }, body })).body;
  }
  // Larger files: open a resumable session, then send the whole content in one PUT.
  const initUrl = existing
    ? `${DRIVE_UPLOAD_API}/files/${encodeURIComponent(fileId)}?uploadType=resumable&fields=${UPLOAD_FIELDS}&supportsAllDrives=true`
    : `${DRIVE_UPLOAD_API}/files?uploadType=resumable&fields=${UPLOAD_FIELDS}&supportsAllDrives=true`;
  const init = await driveRequest(userId, initUrl, {
    method: existing ? "PATCH" : "POST",
    headers: { "Content-Type": "application/json; charset=UTF-8", "X-Upload-Content-Type": mime, "X-Upload-Content-Length": String(buffer.length) },
    body: JSON.stringify(metadata),
  });
  const sessionUrl = init.headers.get("location");
  if (!sessionUrl) throw new DriveError("Google did not start an upload session", { code: "UPLOAD_SESSION_FAILED", retryable: true });
  const token = await getAccessToken(userId);
  const response = await fetch(sessionUrl, { method: "PUT", headers: { "Content-Type": mime, Authorization: `Bearer ${token}` }, body: buffer });
  const parsed = parseJson(await response.text());
  if (!response.ok) throw classify(response.status, parsed);
  return parsed;
}

async function revokeRefreshToken(refreshToken) {
  try {
    await newOAuthClient().revokeToken(refreshToken);
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  DRIVE_FILE_SCOPE,
  DriveError,
  FOLDER_MIME,
  SCOPES,
  createFolder,
  dropToken,
  generateFileId,
  getAccessToken,
  getFileMeta,
  getFolder,
  isConfigured,
  listAppFolders,
  md5,
  newOAuthClient,
  revokeRefreshToken,
  uploadFile,
};
