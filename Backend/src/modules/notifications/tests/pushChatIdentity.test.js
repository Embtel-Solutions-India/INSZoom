// The browser push of a message carries WHICH chat it belongs to (conversation, case, sender, kind), so the app can keep the chat the person is reading quiet and
// notify for every other chat. DB-free.
const assert = require("node:assert/strict");
const { test, mock } = require("node:test");
const pushService = require("../push.service");
const { dispatchPushChannel } = require("../notification.service");

const notification = () => ({ userId: "u-1", _id: "n-1", type: "message_received", title: "Sarah Johnson", message: "Hello", link: "/messages/c1", caseId: "case-1", delivery: [{ channel: "push", status: "queued" }] });

test("a message push carries the conversation, the case, the sender and the kind", async (t) => {
  t.after(() => mock.restoreAll());
  let sent;
  mock.method(pushService, "sendToUser", async (userId, payload) => { sent = { userId, payload }; return { successCount: 1, failureCount: 0 }; });
  const n = notification();
  await dispatchPushChannel(n, { data: { tag: "msg-c1" }, metadata: { conversationId: "c1", senderId: "u-sarah", kind: "message" } }, null);
  assert.equal(sent.userId, "u-1");
  assert.equal(sent.payload.title, "Sarah Johnson");
  assert.equal(sent.payload.tag, "msg-c1");
  assert.deepEqual(sent.payload.data, { notificationId: "n-1", type: "message_received", caseId: "case-1", conversationId: "c1", senderId: "u-sarah", kind: "message" });
  assert.equal(n.delivery[0].status, "sent");
});

test("a notification without chat details (any other kind) is pushed exactly as before", async (t) => {
  t.after(() => mock.restoreAll());
  let sent;
  mock.method(pushService, "sendToUser", async (userId, payload) => { sent = payload; return { successCount: 1, failureCount: 0 }; });
  await dispatchPushChannel({ ...notification(), type: "case_stage_changed" }, {}, null);
  assert.equal(sent.data.type, "case_stage_changed");
  assert.equal(sent.data.conversationId, undefined);
  assert.equal(sent.data.senderId, undefined);
  assert.equal(sent.data.kind, undefined);
});

test("the push to each recipient is a single send (one push per message per person)", async (t) => {
  t.after(() => mock.restoreAll());
  const calls = [];
  mock.method(pushService, "sendToUser", async (userId) => { calls.push(userId); return { successCount: 1, failureCount: 0 }; });
  await dispatchPushChannel(notification(), { metadata: { conversationId: "c1" } }, null);
  assert.deepEqual(calls, ["u-1"]);
});
