const assert = require("node:assert/strict");
const { test, mock } = require("node:test");
const mongoose = require("mongoose");

const Answer = require("../../../models/Answer");
const AuditLog = require("../../../models/AuditLog");
const Case = require("../../../models/Case");
const Document = require("../../../models/Document");
const Question = require("../../../models/Question");
const Questionnaire = require("../../../models/Questionnaire");
const caseService = require("../../cases/case.service");
const canonicalSyncService = require("../../canonical/services/CanonicalSyncService");
const uscisFormService = require("../../uscis-forms/uscis-form.service");
const storageService = require("../../uploads/storage.service");
const questionnaireService = require("../questionnaire.service");
const upload = require("../../uploads/upload.middleware");
const limits = require("../../uploads/upload-limits");

function queryResult(value) {
  const promise = Promise.resolve(value);
  return {
    sort: () => promise,
    populate: () => queryResult(value),
    then: promise.then.bind(promise),
    catch: promise.catch.bind(promise),
    finally: promise.finally.bind(promise),
  };
}

function fakeFile(name, size = 100, mimetype = "image/png") {
  return { originalname: name, buffer: Buffer.alloc(Math.min(size, 64), 1), size, mimetype };
}

// In-memory Answer store behind the same Mongoose statics saveAnswers uses, so
// "append across separate requests" really exercises the stored-count check.
function harness(t) {
  const caseId = new mongoose.Types.ObjectId();
  const questionnaireId = new mongoose.Types.ObjectId();
  const userId = new mongoose.Types.ObjectId();
  const responseId = "resp-1";
  const question = {
    _id: new mongoose.Types.ObjectId(),
    key: "marriage_photos",
    label: "Photos of marriage",
    type: "file",
    required: true,
    validationRules: [],
    metadata: { documentType: "marriage_photos" },
  };
  const questionnaire = {
    _id: questionnaireId, key: "k", version: 1, settings: { defaultLocale: "en" },
    analytics: { averageCompletionPercent: 0, startedCount: 0 }, documentRules: [], save: async () => questionnaire,
  };
  const caseData = {
    _id: caseId, user: userId, questionnaireData: { masterData: {} }, journeyProgress: { metrics: {} },
    questionnaireReferences: [{ questionnaireId, responseId, active: true, status: "not_started" }], timeline: [], auditHistory: [],
  };
  const store = new Map();
  const stored = [];
  const deleted = [];
  const documents = [];

  t.after(() => mock.restoreAll());
  mock.method(Questionnaire, "findById", async () => questionnaire);
  mock.method(Case, "findById", async () => caseData);
  mock.method(Case, "updateOne", async () => ({ matchedCount: 1, modifiedCount: 1 }));
  mock.method(Question, "find", () => queryResult([question]));
  mock.method(Answer, "find", () => queryResult([...store.values()]));
  mock.method(Answer, "findOneAndUpdate", async (filter, update) => {
    const record = { responseId, questionKey: filter.questionKey, question, ...update.$set };
    store.set(filter.questionKey, record);
    return record;
  });
  mock.method(Answer, "updateMany", async () => ({ modifiedCount: 1 }));
  mock.method(AuditLog, "create", async () => ({}));
  mock.method(caseService, "canAccessCase", () => true);
  mock.method(caseService, "writeAuditLog", async () => {});
  mock.method(canonicalSyncService, "syncCase", async () => ({}));
  mock.method(uscisFormService, "markCaseFormsStale", async () => ({}));
  mock.method(storageService, "generateDocumentKey", ({ originalName }) => `documents/${originalName}-${stored.length}`);
  mock.method(storageService, "storeBuffer", async (key) => { stored.push(key); return { key, url: `/files/${key}` }; });
  mock.method(storageService, "deleteObject", async (key) => { deleted.push(key); return true; });
  mock.method(Document, "findOne", async () => null);
  mock.method(Document, "create", async (doc) => { documents.push(doc); return doc; });

  const payload = { questionnaireId, caseId, responseId, questionKey: question.key };
  const user = { _id: userId, role: "client" };
  return { store, stored, deleted, documents, payload, user, question };
}

const upload1 = (h, files) => questionnaireService.saveFileAnswer(h.payload, files, h.user, { headers: {}, ip: "127.0.0.1" });

test("a second upload to the same row APPENDS instead of replacing the first file", async (t) => {
  const h = harness(t);
  await upload1(h, [fakeFile("photo-1.png")]);
  await upload1(h, [fakeFile("photo-2.png")]);
  const answer = h.store.get("marriage_photos");
  assert.deepEqual(answer.files.map((file) => file.originalName), ["photo-1.png", "photo-2.png"]);
  assert.deepEqual(answer.value, ["photo-1.png", "photo-2.png"]);
  // every entry also gets its own Documents record
  assert.deepEqual(h.documents.map((doc) => doc.originalName), ["photo-1.png", "photo-2.png"]);
});

test("the 11th file is rejected, counted against files already stored from earlier requests", async (t) => {
  const h = harness(t);
  for (let index = 1; index <= 10; index += 1) await upload1(h, [fakeFile(`p${index}.png`)]);
  assert.equal(h.store.get("marriage_photos").files.length, 10);
  await assert.rejects(
    () => upload1(h, [fakeFile("p11.png")]),
    (error) => error.status === 422 && error.code === "ROW_FILE_LIMIT_EXCEEDED" && /maximum of 10/i.test(error.message)
  );
  assert.equal(h.store.get("marriage_photos").files.length, 10, "stored list untouched by the rejected upload");
  assert.ok(h.deleted.some((key) => key.includes("p11.png")), "blob stored for the rejected file is cleaned up");
});

test("a single request that would cross the cap is rejected as a whole", async (t) => {
  const h = harness(t);
  await upload1(h, Array.from({ length: 8 }, (_, index) => fakeFile(`a${index}.png`)));
  await assert.rejects(
    () => upload1(h, [fakeFile("b1.png"), fakeFile("b2.png"), fakeFile("b3.png")]),
    (error) => error.code === "ROW_FILE_LIMIT_EXCEEDED"
  );
  assert.equal(h.store.get("marriage_photos").files.length, 8);
});

test("a file over 50 MB is rejected before anything is stored", async (t) => {
  const h = harness(t);
  await assert.rejects(
    () => upload1(h, [fakeFile("big.png", 50 * 1024 * 1024 + 1)]),
    (error) => error.status === 413 && error.code === "FILE_TOO_LARGE" && /50 MB/.test(error.message)
  );
  assert.equal(h.stored.length, 0);
  await upload1(h, [fakeFile("exactly-50mb.png", 50 * 1024 * 1024)]);
  assert.equal(h.store.get("marriage_photos").files.length, 1);
});

test("executables are rejected; photos/text/office types are accepted", async (t) => {
  const h = harness(t);
  await assert.rejects(() => upload1(h, [fakeFile("setup.exe", 10, "application/octet-stream")]), (error) => error.status === 415);
  await assert.rejects(() => upload1(h, [fakeFile("run.ps1", 10, "text/plain")]), (error) => error.status === 415);
  for (const name of ["a.webp", "b.heic", "c.txt", "d.docx", "e.jpeg"]) await upload1(h, [fakeFile(name, 10, "application/octet-stream")]);
  assert.equal(h.store.get("marriage_photos").files.length, 5);
});

test("removeAnswerFile drops one entry, keeps the rest, and refuses approved rows for clients", async (t) => {
  const h = harness(t);
  await upload1(h, [fakeFile("one.png"), fakeFile("two.png")]);
  const answer = h.store.get("marriage_photos");
  const entries = answer.files;
  const saved = {
    ...answer, user: h.user._id, caseId: h.payload.caseId, status: "auto_saved", auditHistory: [],
    files: [...entries], save: async function save() { return this; },
  };
  mock.method(Answer, "findOne", async () => saved);
  mock.method(Document, "updateMany", async () => ({}));
  const result = await questionnaireService.removeAnswerFile({ responseId: "resp-1", questionKey: "marriage_photos", storageKey: entries[0].storageKey }, h.user, {});
  assert.equal(result.remaining, 1);
  assert.deepEqual(saved.files.map((file) => file.originalName), ["two.png"]);

  saved.status = "approved";
  await assert.rejects(
    () => questionnaireService.removeAnswerFile({ responseId: "resp-1", questionKey: "marriage_photos", storageKey: saved.files[0].storageKey }, h.user, {}),
    (error) => error.status === 409
  );
});

test("upload middleware default limit is 50 MB and limit errors map to 4xx", () => {
  assert.equal(limits.MAX_FILE_BYTES, 50 * 1024 * 1024);
  assert.equal(limits.MAX_FILES_PER_ROW, 10);
  const files = [];
  const filter = upload._fileFilter || null;
  assert.ok(typeof upload.array === "function");
  void files; void filter;
  assert.throws(() => limits.assertFileNameAllowed("evil.exe"), (error) => error.status === 415);
  assert.doesNotThrow(() => limits.assertFileNameAllowed("photo.HEIC"));
});

test("file security accepts any common type but rejects executables by name and by content", async () => {
  const fileSecurity = require("../../uploads/file-security.service");
  const ok = await fileSecurity.inspect({ originalname: "IMG_0001.HEIC", mimetype: "", buffer: Buffer.from("not-sniffable-bytes") });
  assert.equal(ok.malware.status, "clean");
  await fileSecurity.inspect({ originalname: "notes.odt", mimetype: "application/vnd.oasis.opendocument.text", buffer: Buffer.from("hello") });
  await assert.rejects(() => fileSecurity.inspect({ originalname: "run.exe", mimetype: "application/octet-stream", buffer: Buffer.from("MZ") }), (error) => error.code === "BLOCKED_FILE_TYPE");
  const elf = Buffer.concat([Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x01, 0x00]), Buffer.alloc(64)]);
  await assert.rejects(() => fileSecurity.inspect({ originalname: "photo.png", mimetype: "image/png", buffer: elf }), (error) => error.status === 415 || error.statusCode === 415);
});
