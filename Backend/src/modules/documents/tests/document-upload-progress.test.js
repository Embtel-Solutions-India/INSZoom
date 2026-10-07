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

function stubCaseAndDocumentModel(t, { existingCount = 0, singleSlotExisting = null } = {}) {
  const caseData = { _id: "case-1", user: "client-1", save: async () => {} };
  t.mock.method(Case, "findById", () => Promise.resolve(caseData));
  stubSecurityAndStorage(t);
  t.mock.method(RequestManagementService, "completeByDocument", () => null);
  t.mock.method(questionnaireService, "syncFileAnswerFromDocument", async () => undefined);
  // the service chains .exec() on its queries, so each stub is a thenable query-like object (still awaitable directly)
  const queryOf = (value) => ({ exec: async () => value, then: (resolve, reject) => Promise.resolve(value).then(resolve, reject) });
  t.mock.method(Document, "findOne", (query) => {
    if (query.checksum) return queryOf(null); // no byte-identical duplicate anywhere in this case
    if (query.documentType) return queryOf(singleSlotExisting);
    return queryOf(null);
  });
  t.mock.method(Document, "countDocuments", () => queryOf(existingCount));
  const created = [];
  t.mock.method(Document, "create", async (doc) => {
    const row = { ...doc, _id: `doc-${created.length + 1}`, auditHistory: [], $locals: {}, save: async function save() { return this; } };
    created.push(row);
    return row;
  });
  return created;
}

test("createDocumentFromFile APPENDS a new Document to a multi-entry checklist row instead of versioning the first", async (t) => {
  const user = { _id: "client-1", role: "client" };
  const created = stubCaseAndDocumentModel(t, { existingCount: 1 });

  const result = await documentService.createDocumentFromFile({
    file: fakeFile("marriage-photo-2.pdf"),
    body: { caseId: "case-1", documentType: "marriage_photos" },
    user,
    req: {},
  });

  assert.equal(created.length, 1, "a second row entry must be its own Document");
  assert.equal(result.originalName, "marriage-photo-2.pdf");
});

test("createDocumentFromFile rejects the 11th file in one checklist row (count checked against stored files)", async (t) => {
  const user = { _id: "client-1", role: "client" };
  const created = stubCaseAndDocumentModel(t, { existingCount: 10 });
  await assert.rejects(
    () => documentService.createDocumentFromFile({ file: fakeFile("one-too-many.pdf"), body: { caseId: "case-1", documentType: "marriage_photos" }, user, req: {} }),
    (error) => error.status === 422 && error.code === "ROW_FILE_LIMIT_EXCEEDED" && /maximum of 10/i.test(error.message)
  );
  assert.equal(created.length, 0);
});

test("createDocumentFromFile rejects a checklist file over 50 MB", async (t) => {
  const user = { _id: "client-1", role: "client" };
  stubCaseAndDocumentModel(t, { existingCount: 0 });
  const big = { ...fakeFile("huge.pdf"), size: 50 * 1024 * 1024 + 1 };
  await assert.rejects(
    () => documentService.createDocumentFromFile({ file: big, body: { caseId: "case-1", documentType: "marriage_photos" }, user, req: {} }),
    (error) => error.status === 413 && error.code === "FILE_TOO_LARGE"
  );
});

test("createDocumentFromFile still versions single-slot document types (petition_manual_upload)", async (t) => {
  const user = { _id: "client-1", role: "client" };
  const existingDocument = {
    _id: "doc-1",
    versions: [{ version: 1, checksum: "prior-checksum" }],
    auditHistory: [],
    save: async function save() { return this; },
  };
  const created = stubCaseAndDocumentModel(t, { singleSlotExisting: existingDocument });

  const result = await documentService.createDocumentFromFile({
    file: fakeFile("petition-v2.pdf"),
    body: { caseId: "case-1", documentType: "petition_manual_upload" },
    user,
    req: {},
  });

  assert.equal(created.length, 0, "must version the existing document, not call Document.create");
  assert.equal(result, existingDocument);
  assert.equal(existingDocument.versions.length, 2);
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
