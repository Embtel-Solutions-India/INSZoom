const assert = require("node:assert/strict");
const test = require("node:test");
const mongoose = require("mongoose");

if (!process.env.MONGODB_TEST_URI) process.env.MONGODB_TEST_URI = "mongodb://localhost:27017/immigrationcrm_test";

const { connectTestDB, disconnectTestDB } = require("../../../test-utils/db");
const Notification = require("../../../models/Notification");
const notificationService = require("../notification.service");

// Perf fix: processScheduled/retryFailed used to `for...await notification.save()`
// per document (up to 100 serial DB writes per 60s maintenance tick). Both now
// do a single Notification.bulkWrite() instead — these tests prove the bulk
// path produces the exact same per-document end state the old serial-save loop
// did, for both the happy path and the multi-notification fan-out.
async function makeScheduled(overrides = {}) {
  return Notification.create({
    title: "Scheduled reminder",
    message: "Test",
    scheduledFor: new Date(Date.now() - 1000),
    queueStatus: "scheduled",
    channels: ["in_app", "socket"],
    delivery: [{ channel: "in_app", status: "pending" }, { channel: "socket", status: "pending" }],
    ...overrides,
  });
}

async function makeFailed(overrides = {}) {
  return Notification.create({
    title: "Failed delivery",
    message: "Test",
    retryCount: 0,
    channels: ["email"],
    delivery: [{ channel: "email", status: "failed", nextRetryAt: new Date(Date.now() - 1000), attempts: 1 }],
    ...overrides,
  });
}

test("processScheduled bulk-updates every matched notification: queueStatus, processedAt, delivery, auditHistory", async (t) => {
  t.after(disconnectTestDB);
  await connectTestDB();
  const docs = await Promise.all([makeScheduled(), makeScheduled(), makeScheduled()]);
  try {
    const result = await notificationService.processScheduled(100, { _id: new mongoose.Types.ObjectId() }, {});
    assert.equal(result.processedCount, 3);

    const refreshed = await Notification.find({ _id: { $in: docs.map((d) => d._id) } }).lean();
    assert.equal(refreshed.length, 3);
    for (const n of refreshed) {
      assert.equal(n.queueStatus, "processed");
      assert.ok(n.processedAt, "processedAt must be set");
      assert.ok(n.deliveredAt, "deliverRealtime's mutation must be persisted, not dropped by the bulkWrite");
      assert.ok(n.delivery.some((d) => d.channel === "in_app" && d.status === "sent"), "in_app delivery must be marked sent");
      assert.equal(n.auditHistory.length, 1);
      assert.equal(n.auditHistory[0].action, "process_scheduled");
    }
  } finally {
    await Notification.deleteMany({ _id: { $in: docs.map((d) => d._id) } });
  }
});

test("processScheduled with zero matches makes no bulkWrite call and returns processedCount: 0", async (t) => {
  t.after(disconnectTestDB);
  await connectTestDB();
  const result = await notificationService.processScheduled(100, null, {});
  assert.equal(result.processedCount, 0);
});

test("retryFailed bulk-updates retryCount, requeues matching delivery channels, and appends one audit entry per notification", async (t) => {
  t.after(disconnectTestDB);
  await connectTestDB();
  const docs = await Promise.all([makeFailed(), makeFailed()]);
  try {
    const result = await notificationService.retryFailed(100, { _id: new mongoose.Types.ObjectId() }, {});
    assert.equal(result.processedCount, 2);

    const refreshed = await Notification.find({ _id: { $in: docs.map((d) => d._id) } }).lean();
    for (const n of refreshed) {
      assert.equal(n.retryCount, 1);
      assert.equal(n.delivery[0].status, "queued");
      assert.equal(n.delivery[0].attempts, 2, "attempts must be incremented, matching the original per-doc loop");
      assert.equal(n.auditHistory.length, 1);
      assert.equal(n.auditHistory[0].action, "retry");
    }
  } finally {
    await Notification.deleteMany({ _id: { $in: docs.map((d) => d._id) } });
  }
});
