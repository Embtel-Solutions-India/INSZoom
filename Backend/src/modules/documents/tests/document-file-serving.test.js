// DB-free: local provider in a temp dir (never S3), Mongo lookup and permission check stubbed. Exercises the real previewDocument /
// downloadDocument handlers over real HTTP: bytes are encrypted at rest, decrypted by the backend, and served with usable headers.
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const express = require("express");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const storageDir = fs.mkdtempSync(path.join(os.tmpdir(), "crm-doc-serving-"));
process.env.STORAGE_PROVIDER = "local";
process.env.LOCAL_STORAGE_PATH = storageDir;
process.env.STORAGE_ENCRYPTION_KEY = "document-file-serving-test-key";

const storageService = require("../../uploads/storage.service");
const Document = require("../../../models/Document");
const documentService = require("../document.service");
const controller = require("../document.controller");
const { contentDisposition, resolveContentType } = require("../../../utils/fileResponse");

const PDF = Buffer.concat([Buffer.from("%PDF-1.7\n"), crypto.randomBytes(2048), Buffer.from("\n%%EOF")]);

let current; // the document the stubbed lookup returns
let allowed = true;
const originals = { findById: Document.findById, populate: documentService.populateDocumentQuery, canAccess: documentService.canAccessDocument };
let server;
let baseUrl;

test.before(async () => {
  Document.findById = () => ({});
  documentService.populateDocumentQuery = async () => current;
  documentService.canAccessDocument = async () => allowed;
  const app = express();
  const route = (action) => (req, res, next) => { req.user = { _id: "u" }; req.params.id = "doc"; return controller[action](req, res, next); };
  app.get("/preview", route("previewDocument"));
  app.get("/download", route("downloadDocument"));
  app.use((error, req, res, next) => res.status(error.statusCode || 500).send(error.message || "error")); // stand-in for middleware/errorHandler
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  Document.findById = originals.findById;
  documentService.populateDocumentQuery = originals.populate;
  documentService.canAccessDocument = originals.canAccess;
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(storageDir, { recursive: true, force: true });
});

async function storeDocument({ name, mimeType, buffer = PDF }) {
  const key = storageService.generateDocumentKey({ caseId: "case1", originalName: name });
  const stored = await storageService.storeBuffer(key, buffer);
  current = { _id: "doc", storageKey: stored.key, originalName: name, mimeType };
  return stored;
}

test("bytes are encrypted at rest - exactly what a direct S3 download would return", async () => {
  const stored = await storeDocument({ name: "passport.pdf", mimeType: "application/pdf" });
  const raw = fs.readFileSync(stored.path);
  assert.equal(raw.subarray(0, 8).toString(), "ICRMENC1");
  assert.equal(raw.includes("%PDF-"), false, "ciphertext must not be a readable PDF");
});

test("preview and download return the decrypted PDF with PDF headers", async () => {
  await storeDocument({ name: "passport.pdf", mimeType: "application/pdf" });
  for (const [route, disposition] of [["/preview", "inline"], ["/download", "attachment"]]) {
    const response = await fetch(baseUrl + route);
    assert.equal(response.status, 200, await response.clone().text());
    assert.equal(response.headers.get("content-type"), "application/pdf");
    assert.match(response.headers.get("content-disposition"), new RegExp(`^${disposition}; filename="passport.pdf"`));
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    const body = Buffer.from(await response.arrayBuffer());
    assert.equal(body.subarray(0, 5).toString(), "%PDF-");
    assert.deepEqual(body, PDF);
  }
});

test("a PDF recorded with a generic or wrong mime type is still served as application/pdf", async () => {
  for (const mimeType of ["application/octet-stream", "application/x-pdf", undefined]) {
    await storeDocument({ name: "scan.pdf", mimeType });
    const response = await fetch(baseUrl + "/preview");
    assert.equal(response.headers.get("content-type"), "application/pdf");
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), PDF);
  }
});

test("file names with non-Latin-1 characters or quotes no longer break the response", async () => {
  for (const name of ["Résumé – passport.pdf", "पासपोर्ट.pdf", 'he said "hi".pdf', "a\r\nX-Injected: 1.pdf"]) {
    await storeDocument({ name, mimeType: "application/pdf" });
    const response = await fetch(baseUrl + "/preview");
    assert.equal(response.status, 200, name);
    assert.equal(response.headers.get("x-injected"), null);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), PDF, name);
  }
  assert.match(contentDisposition("inline", "Résumé – passport.pdf"), /filename\*=UTF-8''R%C3%A9sum%C3%A9%20%E2%80%93%20passport\.pdf$/);
});

test("non-PDF files keep their stored type; generic types fall back to the extension", async () => {
  const png = Buffer.from("89504e470d0a1a0a00", "hex");
  assert.equal(resolveContentType({ buffer: png, mimeType: "image/png", fileName: "x.png" }), "image/png");
  assert.equal(resolveContentType({ buffer: png, mimeType: "application/octet-stream", fileName: "x.PNG" }), "image/png");
  assert.equal(resolveContentType({ buffer: png, mimeType: "", fileName: "noext" }), "application/octet-stream");
  assert.equal(resolveContentType({ buffer: png, mimeType: "image/jpeg; charset=binary", fileName: "x" }), "image/jpeg");
});

test("authorization is still enforced before any bytes are read", async () => {
  await storeDocument({ name: "passport.pdf", mimeType: "application/pdf" });
  allowed = false;
  try {
    const response = await fetch(baseUrl + "/preview");
    assert.notEqual(response.status, 200);
    assert.equal((await response.text()).includes("%PDF-"), false);
  } finally {
    allowed = true;
  }
});

test("a wrong encryption key fails with a clear error and never returns ciphertext", async () => {
  await storeDocument({ name: "passport.pdf", mimeType: "application/pdf" });
  const goodKey = process.env.STORAGE_ENCRYPTION_KEY;
  process.env.STORAGE_ENCRYPTION_KEY = "some-other-environments-key";
  try {
    const response = await fetch(baseUrl + "/preview");
    assert.equal(response.status, 500);
    assert.match(await response.text(), /could not be decrypted/);
  } finally {
    process.env.STORAGE_ENCRYPTION_KEY = goodKey;
  }
});

test("legacy documents without a storageKey are decrypted too", async () => {
  const stored = await storageService.storeBuffer(storageService.generateDocumentKey({ caseId: "legacy", originalName: "old.pdf" }), PDF);
  assert.deepEqual(await documentService.readDocumentBuffer({ filePath: stored.path }), PDF);
});
