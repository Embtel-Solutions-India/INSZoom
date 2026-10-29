const env = require("../../config/env");
const logger = require("../../utils/logger");
const driveClient = require("./drive.client");
const connectionService = require("./connection.service");
const syncService = require("./sync.service");

function fail(res, error, fallbackMessage) {
  if (error instanceof driveClient.DriveError) {
    const status = error.status && error.status >= 400 && error.status < 600 ? error.status : 502;
    return res.status(status === 401 ? 502 : status).json({ success: false, code: error.code, message: error.message });
  }
  if (error?.statusCode) return res.status(error.statusCode).json({ success: false, ...(error.code ? { code: error.code } : {}), message: error.message });
  logger.error("google_drive_request_failed", { error });
  return res.status(500).json({ success: false, message: fallbackMessage || "Google Drive request failed." });
}

// Everything except /status answers 404 while the feature is off, exactly as if the routes did not exist.
function requireEnabled(req, res, next) {
  if (!env.googleDrive.enabled) return res.status(404).json({ success: false, message: "Not found" });
  return next();
}

function requireConfigured(req, res, next) {
  if (!driveClient.isConfigured()) return res.status(503).json({ success: false, message: "Google Drive is not fully configured on the server." });
  return next();
}

async function status(req, res) {
  try {
    if (!env.googleDrive.enabled) return res.json({ success: true, enabled: false });
    res.json({ success: true, ...(await connectionService.getStatus(req.user)) });
  } catch (error) {
    fail(res, error, "Could not read Google Drive status.");
  }
}

async function connectStart(req, res) {
  try {
    res.json({ success: true, ...(await connectionService.startConnect(req.user, req.body?.returnPath)) });
  } catch (error) {
    fail(res, error, "Could not start the Google connection.");
  }
}

// Public by necessity (a browser redirect from Google carries no Bearer token); authorized by the single-use state row.
async function callback(req, res) {
  try {
    if (!env.googleDrive.enabled || !driveClient.isConfigured()) return res.status(404).json({ success: false, message: "Not found" });
    res.set("Cache-Control", "no-store");
    return res.redirect(await connectionService.handleCallback(req.query));
  } catch (error) {
    logger.error("google_drive_callback_unhandled", { error });
    return res.redirect(new URL("/?gdrive=error&reason=connect_failed", env.googleDrive.adminPortalUrl).toString());
  }
}

// Switch which of the user's own connected Google accounts the dialog uses.
async function activateAccount(req, res) {
  try {
    const account = await connectionService.activate(req.user, req.params.id);
    if (!account) return res.status(404).json({ success: false, message: "That Google account is not connected." });
    res.json({ success: true, ...(await connectionService.getStatus(req.user)) });
  } catch (error) {
    fail(res, error, "Could not switch Google account.");
  }
}

// Remove one of the user's own connected accounts (revokes access at Google; files already in that Drive are untouched).
async function removeAccount(req, res) {
  try {
    const result = await connectionService.removeAccount(req.user, req.params.id);
    if (!result) return res.status(404).json({ success: false, message: "That Google account is not connected." });
    res.json({ success: true, ...(await connectionService.getStatus(req.user)) });
  } catch (error) {
    fail(res, error, "Could not remove the Google account.");
  }
}

// Short-lived access token for Google Picker only (never the refresh token). Not cached anywhere.
async function pickerToken(req, res) {
  try {
    const active = await connectionService.requireActive(req.user);
    const accessToken = await driveClient.getAccessToken(active._id);
    res.set("Cache-Control", "no-store");
    res.json({ success: true, accessToken, expiresIn: 1800 });
  } catch (error) {
    fail(res, error, "Could not prepare Google Drive.");
  }
}

async function validateFolder(req, res) {
  try {
    const folderId = String(req.body?.folderId || "").trim();
    if (!folderId) return res.status(400).json({ success: false, message: "folderId is required." });
    res.json({ success: true, folder: await driveClient.getFolder((await connectionService.requireActive(req.user))._id, folderId) });
  } catch (error) {
    if (error?.code === "NOT_FOUND") return res.status(404).json({ success: false, code: "NOT_FOUND", message: "That folder was not found, or the connected Google account cannot access it." });
    fail(res, error, "Could not check that folder.");
  }
}

async function createFolder(req, res) {
  try {
    const connectionId = (await connectionService.requireActive(req.user))._id;
    const name = String(req.body?.name || "").replace(/[\u0000-\u001f]/g, "").trim();
    if (!name || name.length > 200) return res.status(400).json({ success: false, message: "Enter a folder name (up to 200 characters)." });
    const parentId = req.body?.parentId ? String(req.body.parentId) : undefined;
    if (parentId) await driveClient.getFolder(connectionId, parentId); // must exist and be writable
    const folder = await driveClient.createFolder(connectionId, name, parentId);
    await connectionService.audit(req.user._id, "google_drive.folder_created", { folderId: folder.id });
    res.status(201).json({ success: true, folder: { id: folder.id, name: folder.name, webViewLink: folder.webViewLink } });
  } catch (error) {
    fail(res, error, "Could not create the folder.");
  }
}

async function listFolders(req, res) {
  try {
    const [folders, recent] = await Promise.all([driveClient.listAppFolders((await connectionService.requireActive(req.user))._id, req.query.parentId ? String(req.query.parentId) : "root"), syncService.recentFolders(req.user)]);
    res.json({ success: true, folders, recent });
  } catch (error) {
    fail(res, error, "Could not list folders.");
  }
}

async function startSync(req, res) {
  try {
    const { documentIds, folderId, caseId, force } = req.body || {};
    const job = await syncService.createJob(req.user, { documentIds, folderId, caseId, force });
    res.status(202).json({ success: true, jobId: job._id });
  } catch (error) {
    fail(res, error, "Could not start adding files to Drive.");
  }
}

async function getJob(req, res) {
  try {
    const job = await syncService.getJob(req.user, req.params.id);
    if (!job) return res.status(404).json({ success: false, message: "Job not found." });
    res.json({ success: true, job });
  } catch (error) {
    fail(res, error, "Could not read job progress.");
  }
}

async function retryJob(req, res) {
  try {
    const job = await syncService.retryJob(req.user, req.params.id);
    if (!job) return res.status(404).json({ success: false, message: "Job not found." });
    res.status(202).json({ success: true, job });
  } catch (error) {
    fail(res, error, "Could not retry.");
  }
}

async function lookupLinks(req, res) {
  try {
    res.json({ success: true, links: await syncService.lookupLinks(req.user, req.body?.documentIds) });
  } catch (error) {
    fail(res, error, "Could not read Drive status for these documents.");
  }
}

module.exports = { activateAccount, callback, connectStart, createFolder, removeAccount, getJob, listFolders, lookupLinks, pickerToken, requireConfigured, requireEnabled, retryJob, startSync, status, validateFolder };
