const assert = require("node:assert/strict");
const { test } = require("node:test");
const mongoose = require("mongoose");
const Case = require("../../../models/Case");
const controller = require("../case.controller");
const caseService = require("../case.service");

test("case search falls back to regex filtering when Mongo text index is missing", async (t) => {
  const user = { _id: new mongoose.Types.ObjectId(), role: "admin" };
  t.mock.method(Case, "exists", async () => {
    const error = new Error("text index required for $text query");
    error.codeName = "IndexNotFound";
    throw error;
  });

  const filter = await caseService.resolveCaseSearchFilter({ search: "smith", status: "active" }, user);

  assert.equal(filter.status, "active");
  assert.equal(filter.$text, undefined);
  assert.ok(filter.$and.some((condition) => condition.$or), "fallback should preserve the existing regex search behavior");
});

test("GET /cases returns server-side pagination metadata without changing legacy response fields", async (t) => {
  const user = { _id: new mongoose.Types.ObjectId(), role: "admin" };
  const rows = Array.from({ length: 5 }, (_, index) => ({
    _id: new mongoose.Types.ObjectId(),
    caseNumber: `INS-000${index + 1}`,
    clientName: `Client ${index + 1}`,
    visaType: "H-1B",
    status: "active",
    stage: "intake",
    createdAt: new Date(Date.UTC(2026, 0, index + 1)),
    updatedAt: new Date(Date.UTC(2026, 0, index + 1)),
  }));
  let pipeline;
  let aggregateOptions;

  t.mock.method(caseService, "resolveCaseSearchFilter", async () => ({ status: "active" }));
  t.mock.method(caseService, "populateCaseListDocs", async (docs) => docs);
  t.mock.method(Case, "countDocuments", async (filter) => {
    assert.deepEqual(filter, { status: "active" });
    return 12;
  });
  t.mock.method(Case.collection, "aggregate", (nextPipeline, options) => {
    pipeline = nextPipeline;
    aggregateOptions = options;
    return {
      toArray() { return Promise.resolve(rows); },
    };
  });

  const req = {
    requestId: "test-request",
    query: { page: "2", limit: "5", status: "active" },
    user,
  };
  const res = {
    statusCode: 200,
    payload: null,
    json(payload) {
      this.payload = payload;
      return this;
    },
  };
  let nextError;

  await controller.getCases(req, res, (error) => { nextError = error; });

  assert.equal(nextError, undefined);
  assert.deepEqual(pipeline, [
    { $match: { status: "active" } },
    { $sort: { _id: -1 } },
    { $skip: 5 },
    { $limit: 5 },
  ]);
  assert.deepEqual(aggregateOptions, { allowDiskUse: true });
  assert.equal(res.payload.success, true);
  assert.equal(res.payload.cases.length, 5);
  assert.equal(res.payload.data.length, 5);
  assert.equal(res.payload.pages, 3);
  assert.deepEqual(res.payload.pagination, {
    page: 2,
    limit: 5,
    total: 12,
    totalPages: 3,
    hasNextPage: true,
    hasPreviousPage: true,
  });
});
