const path = require("path");
const Case = require("../../models/Case");
const storageService = require("../uploads/storage.service");

const DRIVE_API = "https://www.googleapis.com/drive/v3/files";
const DRIVE_UPLOAD_API = "https://www.googleapis.com/upload/drive/v3/files";
const CASE_FOLDERS = [
  "Passport",
  "Education",
  "Employment",
  "Immigration",
  "Evidence",
  "Generated Documents",
  "Petitions",
  "USCIS Forms",
  "Letters",
];

function accessToken() {
  return process.env.GOOGLE_DRIVE_ACCESS_TOKEN || process.env.GOOGLE_API_ACCESS_TOKEN;
}

function rootFolderId() {
  return process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID;
}

function isConfigured() {
  return Boolean(accessToken() && rootFolderId());
}

function maxAttempts() {
  return Math.max(1, Number(process.env.GOOGLE_DRIVE_MAX_ATTEMPTS || 3));
}

function retryDelay(attempt) {
  return Math.min(1000 * (2 ** Math.max(0, attempt - 1)), Number(process.env.GOOGLE_DRIVE_MAX_RETRY_DELAY_MS || 10000));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function headers(extra = {}) {
  return { Authorization: `Bearer ${accessToken()}`, ...extra };
}

function escapeQuery(value = "") {
  return String(value).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

async function driveFetch(url, options = {}) {
  if (!isConfigured()) {
    const error = new Error("Google Drive synchronization is not configured");
    error.code = "GOOGLE_DRIVE_NOT_CONFIGURED";
    throw error;
  }
  const response = await fetch(url, { ...options, headers: { ...headers(), ...(options.headers || {}) } });
  const bodyText = await response.text();
  const body = bodyText ? JSON.parse(bodyText) : {};
  if (!response.ok) {
    const error = new Error(body.error?.message || `Google Drive request failed with ${response.status}`);
    error.code = body.error?.status || "GOOGLE_DRIVE_REQUEST_FAILED";
    error.details = body;
    throw error;
  }
  return body;
}

async function findFolder(name, parentId) {
  const params = new URLSearchParams({
    q: `mimeType='application/vnd.google-apps.folder' and name='${escapeQuery(name)}' and '${escapeQuery(parentId)}' in parents and trashed=false`,
    fields: "files(id,name,webViewLink)",
    pageSize: "1",
    supportsAllDrives: "true",
  });
  const result = await driveFetch(`${DRIVE_API}?${params}`);
  return result.files?.[0] || null;
}

async function createFolder(name, parentId) {
  const existing = await findFolder(name, parentId);
  if (existing) return existing;
  return driveFetch(`${DRIVE_API}?fields=id,name,webViewLink&supportsAllDrives=true`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name,
      mimeType: "application/vnd.google-apps.folder",
      parents: [parentId],
    }),
  });
}

function caseFolderName(caseData) {
  const number = caseData.caseNumber || caseData.caseId || caseData._id;
  const client = caseData.clientName || caseData.clientEmail || "Client";
  return `${number} - ${client}`.replace(/[\\/:*?"<>|]/g, "-").slice(0, 180);
}

async function ensureCaseFolders(caseId) {
  const caseData = await Case.findById(caseId);
  if (!caseData) return null;
  if (!isConfigured()) {
    caseData.googleDrive = { ...(caseData.googleDrive || {}), syncStatus: "not_configured", lastAttemptAt: new Date(), lastError: "Google Drive synchronization is not configured" };
    await caseData.save();
    return { configured: false, caseData };
  }

  caseData.googleDrive = { ...(caseData.googleDrive || {}), syncStatus: "syncing", attempts: Number(caseData.googleDrive?.attempts || 0) + 1, lastAttemptAt: new Date(), rootFolderId: rootFolderId() };
  await caseData.save();
  const root = await createFolder(caseFolderName(caseData), rootFolderId());
  const folders = {};
  for (const name of CASE_FOLDERS) {
    folders[name] = await createFolder(name, root.id);
  }
  caseData.googleDrive = {
    ...(caseData.googleDrive || {}),
    syncStatus: "synced",
    folderId: root.id,
    folderPath: root.name,
    webViewLink: root.webViewLink,
    folders,
    lastSyncedAt: new Date(),
    lastError: undefined,
  };
  await caseData.save();
  return { configured: true, caseData, caseFolder: root, folders };
}

function targetFolderName(document) {
  const type = String(document.documentType || "").toLowerCase();
  const category = String(document.category || "").toLowerCase();
  if (type === "passport" || category === "identity") return "Passport";
  if (["visa", "i94", "current_visa", "uscis_notice", "approval_notice"].includes(type) || category === "immigration") return "Immigration";
  if (["degree", "transcript"].includes(type) || category === "education") return "Education";
  if (["resume", "cv", "employment_letter", "experience_letter", "employment_verification_letter", "offer_letter", "paystub", "w2"].includes(type) || category === "employment") return "Employment";
  if (["recommendation_letter", "recommendation"].includes(type) || category === "letters") return "Letters";
  if (String(document.uploadedBy || "") === "system" || type === "case_data_workbook") return "Generated Documents";
  return "Evidence";
}

async function uploadBuffer({ buffer, name, mimeType, parentId, existingFileId }) {
  const metadata = { name, parents: existingFileId ? undefined : [parentId] };
  const boundary = `icrm_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Type: ${mimeType || "application/octet-stream"}\r\n\r\n`),
    buffer,
    Buffer.from(`\r\n--${boundary}--`),
  ]);
  const method = existingFileId ? "PATCH" : "POST";
  const url = existingFileId
    ? `${DRIVE_UPLOAD_API}/${existingFileId}?uploadType=multipart&fields=id,name,webViewLink,parents&supportsAllDrives=true`
    : `${DRIVE_UPLOAD_API}?uploadType=multipart&fields=id,name,webViewLink,parents&supportsAllDrives=true`;
  return driveFetch(url, {
    method,
    headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
    body,
  });
}

async function syncDocument(document) {
  if (!document?.caseId) return { configured: false, skipped: true };
  document.googleDrive = { ...(document.googleDrive || {}), syncStatus: "syncing", attempts: Number(document.googleDrive?.attempts || 0) + 1, lastAttemptAt: new Date() };
  await document.save();
  const folderResult = await ensureCaseFolders(document.caseId);
  if (!folderResult?.configured) {
    document.googleDrive.syncStatus = "not_configured";
    document.googleDrive.lastError = "Google Drive synchronization is not configured";
    await document.save();
    return { configured: false };
  }
  const folderName = targetFolderName(document);
  const folder = folderResult.folders?.[folderName] || folderResult.folders?.Evidence || folderResult.caseFolder;
  const buffer = await storageService.readBuffer(document.storageKey);
  let uploaded;
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts(); attempt += 1) {
    try {
      uploaded = await uploadBuffer({
        buffer,
        name: document.originalName || document.originalFileName || document.fileName || `${document._id}${path.extname(document.storageKey || "")}`,
        mimeType: document.mimeType,
        parentId: folder.id,
        existingFileId: document.googleDrive?.fileId,
      });
      break;
    } catch (error) {
      lastError = error;
      document.googleDrive = { ...(document.googleDrive || {}), syncStatus: "failed", attempts: Number(document.googleDrive?.attempts || 0) + 1, lastAttemptAt: new Date(), lastError: error.message };
      await document.save();
      if (attempt < maxAttempts()) await sleep(retryDelay(attempt));
    }
  }
  if (!uploaded) throw lastError;
  document.googleDrive = {
    ...(document.googleDrive || {}),
    syncStatus: "synced",
    fileId: uploaded.id,
    folderId: folder.id,
    folderPath: `${folderResult.caseFolder.name}/${folderName}`,
    webViewLink: uploaded.webViewLink,
    lastSyncedAt: new Date(),
    lastError: undefined,
  };
  await document.save();
  return { configured: true, file: uploaded, folder, caseFolder: folderResult.caseFolder };
}

module.exports = {
  CASE_FOLDERS,
  ensureCaseFolders,
  isConfigured,
  syncDocument,
  uploadBuffer,
};
