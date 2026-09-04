const assert = require("node:assert/strict");
const test = require("node:test");
const mongoose = require("mongoose");

if (!process.env.MONGODB_TEST_URI) process.env.MONGODB_TEST_URI = "mongodb://localhost:27017/immigrationcrm_test";

const { connectTestDB, disconnectTestDB } = require("../../../test-utils/db");
const Document = require("../../../models/Document");
const ctrl = require("../document.controller");

// Perf fix: GET /documents/me/count backs the Dashboard's doc-count tile
// without pulling every document's full body (ocr.rawText/aiExtractedData)
// just to read array length, as documentsApi.list() did before.
test("getMyDocumentsCount returns only the count, scoped to the requesting user, excluding soft-deleted docs", async (t) => {
  t.after(disconnectTestDB);
  await connectTestDB();

  const userId = new mongoose.Types.ObjectId();
  const otherUserId = new mongoose.Types.ObjectId();
  const created = await Document.create([
    { user: userId, originalName: "a.pdf", documentType: "passport", category: "identity" },
    { user: userId, originalName: "b.pdf", documentType: "visa", category: "identity" },
    { user: userId, originalName: "c.pdf", documentType: "visa", category: "identity", deletedAt: new Date() },
    { user: otherUserId, originalName: "d.pdf", documentType: "visa", category: "identity" },
  ]);

  try {
    let jsonBody;
    const req = { user: { _id: userId, role: "client" }, query: {} };
    const res = { json: (body) => { jsonBody = body; } };

    await ctrl.getMyDocumentsCount(req, res, (err) => { throw err; });

    assert.equal(jsonBody.success, true);
    assert.equal(jsonBody.count, 2, "must count only this user's non-deleted documents");
  } finally {
    await Document.deleteMany({ _id: { $in: created.map((d) => d._id) } });
  }
});
