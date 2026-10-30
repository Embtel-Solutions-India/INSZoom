const crypto = require("crypto");
const { OAuth2Client } = require("google-auth-library");
const env = require("../../config/env");
const secretBox = require("../../utils/secretBox");
const GoogleDriveConnection = require("../../models/GoogleDriveConnection");

const DRIVE_API = "https://www.googleapis.com/drive/v3";
const DRIVE_UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";
const FOLDER_MIME = "application/vnd.google-apps.folder";
// The Drive permission comes from GOOGLE_DRIVE_SCOPES (config/env.js). With the full "drive" scope the app can open any existing folder and
// create subfolders inside it; with "drive.file" it only sees what it created or what the user picked in Google Picker. openid/email only
// label the account.
const DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const DRIVE_FULL_SCOPE = "https://www.googleapis.com/auth/drive";
const REQUIRED_SCOPE = env.googleDrive.driveScope;
const SCOPES = [REQUIRED_SCOPE, "openid", "email"];

// Does a connection's granted scopes cover what the app now asks for? A connection made before the scope was widened does not, and has to
// be reconnected (Google ties a saved token to the scopes it was granted). Old records with no scope list are fine under drive.file.
function hasRequiredScope(granted) {
  const scopes = Array.isArray(granted) ? granted : [];
  if (!scopes.length) return REQUIRED_SCOPE === DRIVE_FILE_SCOPE;
  return REQUIRED_SCOPE === DRIVE_FULL_SCOPE ? scopes.includes(DRIVE_FULL_SCOPE) : scopes.includes(DRIVE_FILE_SCOPE) || scopes.includes(DRIVE_FULL_SCOPE);
}
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

// ---- access tokens: refreshed from the stored (encrypted) refresh token, cached in memory only, one refresh in flight per connected account ----
const tokenCache = new Map(); // connectionId -> { token, expiresAt }
const refreshing = new Map(); // connectionId -> Promise

function dropToken(connectionId) {
  tokenCache.delete(String(connectionId));
}

async function markReconnectRequired(connectionId, message) {
  dropToken(connectionId);
  await GoogleDriveConnection.updateOne({ _id: connectionId }, { $set: { status: "reconnect_required", lastError: { code: "invalid_grant", message, at: new Date() } } }).catch(() => {});
}

async function refreshAccessToken(connectionId) {
  const connection = await GoogleDriveConnection.findOne({ _id: connectionId }).select("+refreshTokenEnc");
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
    throw new DriveError("Your saved Google connection could not be read on this server. Press Reconnect to connect again.", { status: 409, code: "RECONNECT_REQUIRED" });
  }
  const client = newOAuthClient();
  client.setCredentials({ refresh_token: refreshToken });
  try {
    const { credentials } = await client.refreshAccessToken();
    const entry = { token: credentials.access_token, expiresAt: credentials.expiry_date || Date.now() + 50 * 60 * 1000 };
    tokenCache.set(connectionId, entry);
    return entry;
  } catch (error) {
    const text = `${error?.message || ""} ${error?.response?.data?.error || ""}`;
    if (/invalid_client|unauthorized_client/i.test(text)) {
      throw new DriveError("Google Drive is not configured correctly on the server. Please contact an administrator.", { status: 503, code: "SERVER_CONFIG" });
    }
    if (/invalid_grant/i.test(text)) {
      await markReconnectRequired(connectionId, "Google rejected the saved authorization");
      throw new DriveError("Google Drive access was revoked or expired. An admin needs to reconnect it.", { status: 409, code: "RECONNECT_REQUIRED" });
    }
    throw new DriveError("Could not refresh Google access. Try again shortly.", { status: 502, code: "TOKEN_REFRESH_FAILED", retryable: true });
  }
}

async function getAccessToken(connectionId) {
  connectionId = String(connectionId)
  const cached = tokenCache.get(connectionId);
  if (cached && cached.expiresAt - Date.now() > 60 * 1000) return cached.token;
  if (!refreshing.has(connectionId)) {
    refreshing.set(connectionId, refreshAccessToken(connectionId).finally(() => refreshing.delete(connectionId)));
  }
  return (await refreshing.get(connectionId)).token;
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

async function driveRequest(connectionId, url, options = {}) {
  let lastError;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const token = await getAccessToken(connectionId);
      const response = await fetch(url, { ...options, headers: { ...(options.headers || {}), Authorization: `Bearer ${token}` } });
      if (response.status === 401 && attempt < MAX_ATTEMPTS) {
        dropToken(connectionId);
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

// ---- folder-list memory: the same list asked for again within a few seconds (going Back, a double click, two tabs) is answered from memory, and
// identical requests that arrive together share ONE Google call. Per connected account, in this process only, never persisted; errors are never
// kept; creating a folder clears that account's lists so a new folder shows at once. DRIVE_LIST_CACHE_MS=0 switches it off (default 30 s). ----
const LIST_CACHE_MS = process.env.DRIVE_LIST_CACHE_MS !== undefined && process.env.DRIVE_LIST_CACHE_MS !== "" ? Number(process.env.DRIVE_LIST_CACHE_MS) || 0 : 30000;
const LIST_CACHE_MAX = 300;
const listCache = new Map(); // `${connectionId}|${request}` -> { at, value }
const listInFlight = new Map(); // same key -> Promise

async function cachedList(connectionId, requestKey, load) {
  const key = `${connectionId}|${requestKey}`;
  const hit = listCache.get(key);
  if (hit && Date.now() - hit.at < LIST_CACHE_MS) return hit.value;
  if (listInFlight.has(key)) return listInFlight.get(key);
  const pending = load().then((value) => {
    if (LIST_CACHE_MS > 0) {
      listCache.set(key, { at: Date.now(), value });
      while (listCache.size > LIST_CACHE_MAX) listCache.delete(listCache.keys().next().value);
    }
    return value;
  }).finally(() => listInFlight.delete(key));
  listInFlight.set(key, pending);
  return pending;
}

function invalidateFolderLists(connectionId) {
  const prefix = `${connectionId}|`;
  for (const key of [...listCache.keys()]) if (key.startsWith(prefix)) listCache.delete(key);
}

// ---- folders ----
const FOLDER_FIELDS = "id,name,mimeType,trashed,webViewLink,parents,driveId,capabilities(canAddChildren)";

// Checks that the folder exists, is a real (non-trashed) folder and the connected account may add files to it, and keeps the original
// Drive identifiers (folder ID, name, parent ID, shared-drive ID) so they can be stored with the job. Used before any upload.
async function getFolder(connectionId, folderId) {
  const { body } = await driveRequest(connectionId, `${DRIVE_API}/files/${encodeURIComponent(folderId)}?fields=${encodeURIComponent(FOLDER_FIELDS)}&supportsAllDrives=true`);
  if (body.mimeType !== FOLDER_MIME) throw new DriveError("That item is not a folder", { status: 400, code: "NOT_A_FOLDER" });
  if (body.trashed) throw new DriveError("That folder is in the Drive trash", { status: 400, code: "FOLDER_TRASHED" });
  if (body.capabilities && body.capabilities.canAddChildren === false) throw new DriveError("The connected Google account cannot add files to that folder", { status: 403, code: "FOLDER_READ_ONLY" });
  return { id: body.id, name: body.name, webViewLink: body.webViewLink, parentId: body.parents?.[0] || null, driveId: body.driveId || null };
}

async function createFolder(connectionId, name, parentId) {
  const metadata = { name, mimeType: FOLDER_MIME, appProperties: { immiglance: "1" } };
  if (parentId) metadata.parents = [parentId];
  const { body } = await driveRequest(connectionId, `${DRIVE_API}/files?fields=id,name,webViewLink&supportsAllDrives=true`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(metadata),
  });
  invalidateFolderLists(connectionId);
  return body;
}

// Folders directly inside `parentId` ("root" = My Drive). Under the full drive scope that is every folder; under drive.file only those the app
// created or that were picked. Kept as the simple, first-page-only form for existing callers; the browser uses listFolders (paging, views, search).
async function listAppFolders(connectionId, parentId = "root") {
  const q = `mimeType='${FOLDER_MIME}' and '${String(parentId).replace(/\\/g, "\\\\").replace(/'/g, "\\'")}' in parents and trashed=false`;
  const params = new URLSearchParams({ q, fields: "files(id,name,webViewLink)", pageSize: "100", orderBy: "name", supportsAllDrives: "true", includeItemsFromAllDrives: "true" });
  const { body } = await driveRequest(connectionId, `${DRIVE_API}/files?${params}`);
  return body.files || [];
}

const escapeQuery = (value) => String(value).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
const LIST_FIELDS = "nextPageToken,files(id,name,webViewLink,parents,driveId,shared,ownedByMe,modifiedTime,owners(displayName),capabilities(canAddChildren))";
const presentFolder = (file) => ({
  id: file.id,
  name: file.name,
  webViewLink: file.webViewLink,
  modifiedTime: file.modifiedTime || null,
  parentId: file.parents?.[0] || null,
  driveId: file.driveId || null,
  shared: Boolean(file.shared) || file.ownedByMe === false,
  owner: file.ownedByMe === false ? file.owners?.[0]?.displayName || null : null,
  // false only when Google says so; an absent value is treated as writable and re-checked by getFolder before any upload
  canAddChildren: file.capabilities?.canAddChildren !== false,
});

// Shared drives the connected account is a member of (paged). Needs the full Drive scope; under drive.file Google refuses and the caller
// gets a DriveError it can explain.
async function listSharedDrives(connectionId, { pageToken } = {}) {
  const params = new URLSearchParams({ pageSize: "100", fields: "nextPageToken,drives(id,name,capabilities(canAddChildren))" });
  if (pageToken) params.set("pageToken", pageToken);
  return cachedList(connectionId, `drives?${params}`, () => loadSharedDrives(connectionId, params));
}
async function loadSharedDrives(connectionId, params) {
  const { body } = await driveRequest(connectionId, `${DRIVE_API}/drives?${params}`);
  return {
    folders: (body.drives || []).map((drive) => ({ id: drive.id, name: drive.name, webViewLink: `https://drive.google.com/drive/folders/${drive.id}`, parentId: null, driveId: drive.id, shared: true, owner: null, isSharedDrive: true, canAddChildren: drive.capabilities?.canAddChildren !== false })),
    nextPageToken: body.nextPageToken || null,
  };
}

/**
 * Folder discovery for the in-app browser. Exactly one of:
 *   query       - folders anywhere the account can reach (My Drive, Shared with me, shared drives) whose name contains it
 *   view=shared - folders other people shared with the account ("Shared with me")
 *   view=drives - the shared drives the account belongs to
 *   parentId    - the folders inside one folder ("root" = My Drive; a shared drive's ID lists its top level)
 * Newest-modified first. Always paged (pass the returned nextPageToken back in), never returns trashed folders, and only ever returns what Google lets this
 * account see - the access check is Google's, not ours.
 */
async function listFolders(connectionId, { parentId = "root", view, query, pageToken } = {}) {
  if (view === "drives" && !query) return listSharedDrives(connectionId, { pageToken });
  const base = `mimeType='${FOLDER_MIME}' and trashed=false`;
  // most recently changed folders first, so the ones people are working in sit at the top (ties fall back to Google's own order)
  const params = new URLSearchParams({ fields: LIST_FIELDS, pageSize: "100", orderBy: "modifiedTime desc", supportsAllDrives: "true", includeItemsFromAllDrives: "true" });
  if (query) {
    params.set("q", `${base} and name contains '${escapeQuery(query)}'`);
    params.set("corpora", "allDrives");
  } else if (view === "shared") {
    params.set("q", `${base} and sharedWithMe=true`);
  } else {
    params.set("q", `${base} and '${escapeQuery(parentId)}' in parents`);
    if (parentId !== "root") params.set("corpora", "allDrives"); // inside a shared drive's folder the plain "user" corpus can miss items
  }
  if (pageToken) params.set("pageToken", pageToken);
  return cachedList(connectionId, `files?${params}`, async () => {
    const { body } = await driveRequest(connectionId, `${DRIVE_API}/files?${params}`);
    return { folders: (body.files || []).map(presentFolder), nextPageToken: body.nextPageToken || null };
  });
}

// ---- files ----
async function generateFileId(connectionId) {
  const { body } = await driveRequest(connectionId, `${DRIVE_API}/files/generateIds?count=1&space=drive`);
  const id = body.ids?.[0];
  if (!id) throw new DriveError("Google did not return a file ID", { code: "GENERATE_IDS_FAILED", retryable: true });
  return id;
}

async function getFileMeta(connectionId, fileId) {
  const { body } = await driveRequest(connectionId, `${DRIVE_API}/files/${encodeURIComponent(fileId)}?fields=id,name,trashed,parents,md5Checksum,webViewLink&supportsAllDrives=true`);
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
async function uploadFile(connectionId, { fileId, existing, name, mimeType, buffer, parentId, appProperties }) {
  const mime = mimeType || "application/octet-stream";
  const metadata = existing ? {} : { id: fileId, name, parents: [parentId], appProperties };
  if (buffer.length <= MULTIPART_LIMIT) {
    const { body, contentType } = multipartBody(metadata, mime, buffer);
    const url = existing
      ? `${DRIVE_UPLOAD_API}/files/${encodeURIComponent(fileId)}?uploadType=multipart&fields=${UPLOAD_FIELDS}&supportsAllDrives=true`
      : `${DRIVE_UPLOAD_API}/files?uploadType=multipart&fields=${UPLOAD_FIELDS}&supportsAllDrives=true`;
    return (await driveRequest(connectionId, url, { method: existing ? "PATCH" : "POST", headers: { "Content-Type": contentType }, body })).body;
  }
  // Larger files: open a resumable session, then send the whole content in one PUT.
  const initUrl = existing
    ? `${DRIVE_UPLOAD_API}/files/${encodeURIComponent(fileId)}?uploadType=resumable&fields=${UPLOAD_FIELDS}&supportsAllDrives=true`
    : `${DRIVE_UPLOAD_API}/files?uploadType=resumable&fields=${UPLOAD_FIELDS}&supportsAllDrives=true`;
  const init = await driveRequest(connectionId, initUrl, {
    method: existing ? "PATCH" : "POST",
    headers: { "Content-Type": "application/json; charset=UTF-8", "X-Upload-Content-Type": mime, "X-Upload-Content-Length": String(buffer.length) },
    body: JSON.stringify(metadata),
  });
  const sessionUrl = init.headers.get("location");
  if (!sessionUrl) throw new DriveError("Google did not start an upload session", { code: "UPLOAD_SESSION_FAILED", retryable: true });
  const token = await getAccessToken(connectionId);
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
  DRIVE_FULL_SCOPE,
  REQUIRED_SCOPE,
  hasRequiredScope,
  DriveError,
  FOLDER_MIME,
  SCOPES,
  createFolder,
  dropToken,
  invalidateFolderLists,
  generateFileId,
  getAccessToken,
  getFileMeta,
  getFolder,
  isConfigured,
  listAppFolders,
  listFolders,
  listSharedDrives,
  md5,
  newOAuthClient,
  revokeRefreshToken,
  uploadFile,
};
