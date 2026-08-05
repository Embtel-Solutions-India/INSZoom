const assert = require("node:assert/strict");
const test = require("node:test");
const Document = require("../../../models/Document");
const Case = require("../../../models/Case");
const documentService = require("../document.service");
const storageService = require("../../uploads/storage.service");
const fileSecurityService = require("../../uploads/file-security.service");
const RequestManagementService = require("../../case-collaboration/services/RequestManagementService");
const questionnaireService = require("../../questionnaires/questionnaire.service");
const clientIntakeService = require("../../client-intake/client-intake.service");

// Follows this repo's established no-DB test convention (see
// data-rights/tests/dataRights.service.test.js): node:test's built-in
// t.mock.method stubs Mongoose model statics and collaborator services so
// createDocumentFromFile's actual branching logic (auth gate, versioning vs.
// create) can be exercised without a live database connection. Each test's
// mocks auto-restore when the test ends.

function fakeFile(name = "passport.pdf") {
  return { buffer: Buffer.from("test-bytes"), originalname: name, mimetype: "application/pdf", size: 10 };
}

function stubSecurityAndStorage(t) {
  t.mock.method(fileSecurityService, "inspect", async () => ({
    validation: { detectedMime: "application/pdf" },
    malware: { provider: "test", status: "clean", scannedAt: new Date(), limited: true },
  }));
  t.mock.method(storageService, "checksum", () => "fixed-checksum");
  t.mock.method(storageService, "generateDocumentKey", ({ caseId, originalName }) => `documents/${caseId}/${originalName}`);
  t.mock.method(storageService, "storeBuffer", async (key) => ({ provider: "local", key, path: `/tmp/${key}`, url: undefined, checksum: "fixed-checksum" }));
}

test("createDocumentFromFile rejects when caseId is supplied but does not resolve to a real case", async (t) => {
  t.mock.method(Case, "findById", () => Promise.resolve(null));
  const user = { _id: "client-1", role: "client" };
  await assert.rejects(
    () => documentService.createDocumentFromFile({ file: fakeFile(), body: { caseId: "does-not-exist" }, user, req: {} }),
    (error) => error.statusCode === 404
  );
});

test("createDocumentFromFile rejects a client uploading against a case they do not own", async (t) => {
  t.mock.method(Case, "findById", () => Promise.resolve({ _id: "case-1", user: "someone-else" }));
  const user = { _id: "client-1", role: "client" };
  await assert.rejects(
    () => documentService.createDocumentFromFile({ file: fakeFile(), body: { caseId: "case-1" }, user, req: {} }),
    (error) => error.statusCode === 403
  );
});

test("createDocumentFromFile versions the existing Document instead of creating a new row when the same case+documentType is re-uploaded", async (t) => {
  const user = { _id: "client-1", role: "client" };
  const caseData = { _id: "case-1", user: "client-1", save: async () => {} };
  t.mock.method(Case, "findById", () => Promise.resolve(caseData));
  stubSecurityAndStorage(t);
  t.mock.method(RequestManagementService, "completeByDocument", () => null);
  t.mock.method(questionnaireService, "syncFileAnswerFromDocument", async () => undefined);

  let createCallCount = 0;
  t.mock.method(Document, "create", async () => { createCallCount += 1; throw new Error("Document.create must not be called on a re-upload into an existing slot"); });

  const existingDocument = {
    _id: "doc-1",
    versions: [{ version: 1, checksum: "prior-checksum" }],
    auditHistory: [],
    save: async function save() { return this; },
  };
  t.mock.method(Document, "findOne", async (query) => {
    if (query.checksum) return null; // no byte-identical duplicate anywhere in this case
    if (query.documentType) return existingDocument; // this case+documentType slot is already occupied
    return null;
  });

  const result = await documentService.createDocumentFromFile({
    file: fakeFile("passport-v2.pdf"),
    body: { caseId: "case-1", documentType: "passport" },
    user,
    req: {},
  });

  assert.equal(createCallCount, 0, "must version the existing document, not call Document.create");
  assert.equal(result, existingDocument);
  assert.equal(existingDocument.versions.length, 2, "addDocumentVersion should have appended a new version");
  assert.equal(existingDocument.versions[1].checksum, "fixed-checksum");
});

test("calculateProgress matches an uploaded document's documentType against the case's required checklist", async (t) => {
  t.mock.method(Document, "find", () => ({ distinct: async () => ["passport"] }));
  const client = {};
  const caseData = {
    _id: "case-1",
    documentChecklist: [{ documentType: "passport", required: true }],
  };
  const progress = await clientIntakeService.calculateProgress(client, caseData);
  assert.equal(progress.sections.documents, 100, "the one required document type was reported as uploaded, so this section should be 100%");
});

test("calculateProgress reports an incomplete documents section when the required documentType has no matching upload", async (t) => {
  t.mock.method(Document, "find", () => ({ distinct: async () => [] }));
  const client = {};
  const caseData = {
    _id: "case-1",
    documentChecklist: [{ documentType: "passport", required: true }],
  };
  const progress = await clientIntakeService.calculateProgress(client, caseData);
  assert.equal(progress.sections.documents, 0);
  assert.ok(progress.missingSections.includes("documents"));
});
