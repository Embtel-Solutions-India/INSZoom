const assert = require("node:assert/strict");
const test = require("node:test");

const Document = require("../../../models/Document");
const DocumentProcessingJob = require("../../../models/DocumentProcessingJob");
const DocumentUploadSession = require("../../../models/DocumentUploadSession");
const router = require("../document.routes");
const fileSecurity = require("../../uploads/file-security.service");
const storageService = require("../../uploads/storage.service");
const documentService = require("../document.service");
const providerRegistry = require("../../document-intelligence/providers/document-intelligence-provider.registry");

function registeredRoutes() {
  return router.stack
    .filter((layer) => layer.route)
    .map((layer) => ({
      path: layer.route.path,
      methods: Object.keys(layer.route.methods).filter((method) => layer.route.methods[method]),
    }));
}

test("document schema supports recoverable processing, evidence, versions, and review", () => {
  const paths = Document.schema.paths;
  for (const path of [
    "processing.stage",
    "processing.status",
    "processing.events",
    "malwareScan.status",
    "evidenceAssociations",
    "reviewComments",
    "versions",
    "ocr.rawText",
  ]) {
    assert.ok(paths[path], `${path} is required`);
  }
});

test("document evidence and version recovery endpoints are registered", () => {
  const routes = registeredRoutes();
  const expected = [
    ["post", "/:id/versions/:version/restore"],
    ["post", "/:id/evidence"],
    ["post", "/:id/comments"],
  ];
  for (const [method, path] of expected) {
    assert.ok(routes.some((route) => route.path === path && route.methods.includes(method)), `${method.toUpperCase()} ${path} is missing`);
  }
});

test("resumable uploads and durable OCR jobs retain recoverable state", () => {
  [
    "uploadId",
    "expectedSize",
    "chunkSize",
    "totalChunks",
    "receivedChunks",
    "receivedBytes",
    "status",
    "expiresAt",
    "finalDocument",
  ].forEach((field) => assert.ok(DocumentUploadSession.schema.path(field), `missing upload session field ${field}`));
  ["jobId", "documentId", "status", "attempts", "maxAttempts", "availableAt", "lastError"].forEach((field) => {
    assert.ok(DocumentProcessingJob.schema.path(field), `missing processing job field ${field}`);
  });
  const routes = registeredRoutes();
  [
    ["post", "/uploads/sessions"],
    ["get", "/uploads/sessions/:uploadId"],
    ["put", "/uploads/sessions/:uploadId/chunks/:chunkIndex"],
    ["post", "/uploads/sessions/:uploadId/complete"],
    ["delete", "/uploads/sessions/:uploadId"],
  ].forEach(([method, path]) => {
    assert.ok(routes.some((route) => route.path === path && route.methods.includes(method)), `missing route ${method.toUpperCase()} ${path}`);
  });
});

test("file security validates content and rejects malware signatures", async () => {
  const validPdf = await fileSecurity.inspect({
    originalname: "passport.pdf",
    mimetype: "application/pdf",
    buffer: Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\n"),
  });
  assert.equal(validPdf.validation.detectedMime, "application/pdf");
  assert.equal(validPdf.malware.status, "clean");

  await assert.rejects(
    fileSecurity.inspect({
      originalname: "evidence.txt",
      mimetype: "text/plain",
      buffer: Buffer.from("X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*"),
    }),
    (error) => error.code === "MALWARE_DETECTED"
  );
});

test("document intelligence providers are replaceable through the registry", async () => {
  providerRegistry.register("test-provider", {
    async generateStructuredJson() {
      return { documentType: "passport", confidence: 99 };
    },
  });
  const result = await providerRegistry.generateStructuredJson({ provider: "test-provider" });
  assert.equal(result.documentType, "passport");
  assert.equal(result.__provider, "test-provider");
});

test("internal case uploads are limited to assigned case managers and team leads", () => {
  const caseData = {
    user: "client-1",
    assignedCaseManager: "manager-1",
    assignedAttorney: "attorney-1",
    assignedTeamLead: "lead-1",
    teamId: "team-1",
  };
  assert.equal(documentService.canUploadForCase({ _id: "manager-1", role: "case_manager" }, caseData), true);
  assert.equal(documentService.canUploadForCase({ _id: "lead-1", role: "team_lead" }, caseData), true);
  assert.equal(documentService.canUploadForCase({ _id: "client-1", role: "client" }, caseData), true);
  assert.equal(documentService.canUploadForCase({ _id: "attorney-1", role: "attorney" }, caseData), false);
  assert.equal(documentService.canUploadForCase({ _id: "admin-1", role: "admin" }, caseData), false);
  assert.equal(documentService.canUploadForCase({ _id: "manager-2", role: "case_manager" }, caseData), false);
});

test("storage encryption is transparent and authenticated when configured", () => {
  const previousKey = process.env.STORAGE_ENCRYPTION_KEY;
  process.env.STORAGE_ENCRYPTION_KEY = "document-platform-test-key";
  try {
    const source = Buffer.from("confidential immigration evidence");
    const encrypted = storageService.encrypt(source);
    assert.notDeepEqual(encrypted, source);
    assert.deepEqual(storageService.decrypt(encrypted), source);
  } finally {
    if (previousKey === undefined) delete process.env.STORAGE_ENCRYPTION_KEY;
    else process.env.STORAGE_ENCRYPTION_KEY = previousKey;
  }
});
