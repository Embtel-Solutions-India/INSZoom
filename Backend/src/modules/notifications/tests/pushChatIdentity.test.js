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

test("a push is DATA ONLY: no ready-made notification part, so the service worker is the only thing that shows it (once)", () => {
  const { buildMessage } = require("../push.service");
  const message = buildMessage({ title: "Sarah", body: "one", tag: "msg-c1", link: "/messages/c1", url: "https://admin.example.com/messages/c1", data: { notificationId: "n1", type: "message_received", conversationId: "c1" } });
  assert.equal(message.notification, undefined, "no top-level notification: Firebase must not show its own copy");
  assert.equal(message.webpush.notification, undefined, "no web-push notification part either");
  // everything the service worker needs to show it is in the data
  assert.equal(message.data.title, "Sarah");
  assert.equal(message.data.body, "one");
  assert.equal(message.data.tag, "msg-c1");
  assert.equal(message.data.link, "/messages/c1");
  assert.equal(message.data.url, "https://admin.example.com/messages/c1");
  assert.equal(message.data.notificationId, "n1");
  assert.equal(message.data.conversationId, "c1");
  // delivered immediately, like a chat app
  assert.equal(message.webpush.headers.Urgency, "high");
  assert.equal(message.webpush.headers.TTL, "86400");
  assert.equal(message.webpush.fcmOptions.link, "https://admin.example.com/messages/c1");
});

test("every data value is a string (FCM requires it)", () => {
  const { buildMessage } = require("../push.service");
  const message = buildMessage({ title: "T", body: "B", tag: "msg-c1", link: "/x", data: { notificationId: 7, flag: true, missing: undefined } });
  for (const value of Object.values(message.data)) assert.equal(typeof value, "string");
  assert.equal("missing" in message.data, false);
});

test("a push with no conversation tag keeps working exactly as before", () => {
  const { buildMessage } = require("../push.service");
  const message = buildMessage({ title: "Case update", body: "Moved to Submitted", link: "/crm-cases/1", data: { notificationId: "n9", type: "case_stage_changed" } });
  assert.equal(message.data.title, "Case update");
  assert.equal(message.data.tag, undefined);
});
