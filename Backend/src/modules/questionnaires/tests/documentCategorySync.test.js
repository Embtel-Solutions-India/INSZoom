const assert = require("node:assert/strict");
const { test, mock, afterEach } = require("node:test");
const Document = require("../../../models/Document");
const service = require("../questionnaire.service");

// Every file a client uploads to a checklist question must get a Document record (what the Admin case page lists under "Uploaded Documents").
// It used to be skipped silently when the question's category name (o1b_criteria, supporting_document, us_business ...) was not one of the
// Document model's allowed categories. DB-free: Document is mocked.
afterEach(() => mock.restoreAll());
const ALLOWED = new Set(Document.schema.path("category").enumValues);

test("every category name used by a file question in the code definitions maps to an allowed Document category", () => {
  const seen = new Set();
  for (const definition of service.VISA_TEMPLATE_DEFINITIONS) {
    for (const question of definition.questions) {
      if (question.type !== "file") continue;
      const { category } = service.documentCategoryFor(question);
      seen.add(`${question.metadata?.category || question.evidenceCategory || "(none)"} -> ${category}`);
      assert.ok(ALLOWED.has(category), `${definition.key}/${question.key}: "${category}" is not an allowed Document category`);
    }
  }
  assert.ok(seen.size > 3, "the definitions were scanned");
});

test("the categories that were failing validation in production now map sensibly; allowed ones are kept", () => {
  const map = (value) => service.documentCategoryFor({ metadata: { category: value } }).category;
  assert.equal(map("supporting_document"), "supporting");
  assert.equal(map("o1b_criteria"), "evidence");
  assert.equal(map("o1a_criteria"), "evidence");
  assert.equal(map("us_business"), "business");
  assert.equal(map("foreign_business"), "business");
  assert.equal(map("statement"), "letters");
  assert.equal(map("Education"), "education");
  assert.equal(map("identity"), "identity", "an allowed category is kept as it is");
  assert.equal(map(""), "other");
  assert.equal(map("something_new_nobody_mapped"), "other", "an unknown name still yields a valid category, never a failed save");
  assert.equal(service.documentCategoryFor({ evidenceCategory: "Publication" }).category, "evidence");
});

test("an upload to a question with an unallowed category creates a VALID Document record, keeping the original name in its tags", async () => {
  let created;
  mock.method(Document, "findOne", async () => null);
  mock.method(Document, "create", async (payload) => {
    const doc = new Document(payload);
    await doc.validate(); // exactly what the real create would do: this threw for "supporting_document"
    created = payload;
    return doc;
  });
  const question = { key: "o1b_employee_doc_passport", type: "file", metadata: { category: "supporting_document" } };
  const files = [{ storageKey: "cases/c1/2026/10/a.pdf", originalName: "passport.pdf", mimeType: "application/pdf", size: 10, url: "/storage/cases/c1/2026/10/a.pdf" }];
  const synced = await service.syncDocumentRecordsFromFileAnswer(question, files, "64f0c0ffee0123456789abcd", { _id: "64f0c0ffee0123456789abce" });
  assert.equal(synced.length, 1, "a Document record exists");
  assert.equal(created.category, "supporting");
  assert.deepEqual(created.tags, ["supporting_document"]);
  assert.equal(created.storageKey, files[0].storageKey);
  assert.equal(created.status, "uploaded");
});

test("syncing the same file twice does not create a second record", async () => {
  const existing = { _id: "d1" };
  const create = mock.method(Document, "create", async () => { throw new Error("must not create"); });
  mock.method(Document, "findOne", async () => existing);
  const synced = await service.syncDocumentRecordsFromFileAnswer({ key: "q", type: "file" }, [{ storageKey: "k", originalName: "a.pdf" }], "64f0c0ffee0123456789abcd", {});
  assert.deepEqual(synced, [existing]);
  assert.equal(create.mock.callCount(), 0);
});
