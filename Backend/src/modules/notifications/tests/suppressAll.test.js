const assert = require("node:assert/strict");
const test = require("node:test");
const env = require("../../../config/env");
const pushService = require("../push.service");
const notificationService = require("../notification.service");

// Master switch (NOTIFICATIONS_SUPPRESS_ALL): no in-app notification is created and no browser push is sent. DB-free: both calls return before touching the database or Firebase.
test("with the switch on, no notification is created and no push goes out", async () => {
  const previous = env.notificationsSuppressAll;
  env.notificationsSuppressAll = true;
  try {
    const created = await notificationService.createNotification({ userId: "60d0fe4f5311236168a10001", type: "general", title: "t", message: "m" }, undefined, {});
    assert.equal(created, null);
    const multicast = await pushService.sendMulticast(["token-a"], { title: "t", body: "b" });
    assert.equal(multicast.successCount, 0);
    assert.match(multicast.skipped, /paused/i);
    const single = await pushService.sendToToken("token-a", { title: "t", body: "b" });
    assert.equal(single.sent, false);
    assert.match(single.skipped, /paused/i);
  } finally {
    env.notificationsSuppressAll = previous;
  }
});
