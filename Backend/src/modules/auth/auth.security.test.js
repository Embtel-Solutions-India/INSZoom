const test = require("node:test");
const assert = require("node:assert/strict");
const { authPayload } = require("./auth.service");

test("authentication payload never returns a refresh token", () => {
  const payload = authPayload({ toAuthJSON: () => ({ _id: "user-id", role: "client" }) }, "access-token", "refresh-token");
  assert.equal(payload.accessToken, "access-token");
  assert.equal(payload.refreshToken, undefined);
  assert.equal(payload.user.role, "client");
});
