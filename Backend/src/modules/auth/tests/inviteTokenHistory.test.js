// A newly sent invitation must not kill the links in earlier invitation emails: every unexpired token works until the invite is accepted
// (which clears them all) or revoked. Real configured database; the temp user is deleted afterwards.
const assert = require("node:assert/strict");
const test = require("node:test");

test("earlier invite links stay valid when a newer invitation is sent", { timeout: 120000 }, async (t) => {
  const mongoose = require("mongoose");
  await require("../../../config/database")();
  const User = require("../../../models/User");
  const clientInvite = require("../clientInvite.service");
  const { hashToken, generateOpaqueToken } = require("../password.service");
  const tag = `zz-tmp-invite-${Date.now()}`;
  const user = await User.create({ email: `${tag}@e2e-audit.invalid`, name: "tmp invite", role: "client", mustSetPassword: true });
  t.after(async () => { await User.deleteMany({ email: new RegExp(tag) }); await mongoose.disconnect(); });

  const valid = async (token) => Boolean(await clientInvite.getClientInviteDetails(token));
  const first = await clientInvite.createClientInviteToken(await User.findById(user._id));
  const second = await clientInvite.createClientInviteToken(await User.findById(user._id));
  const third = await clientInvite.createClientInviteToken(await User.findById(user._id));
  assert.ok(await valid(first), "the first email's link still works");
  assert.ok(await valid(second), "the second email's link still works");
  assert.ok(await valid(third), "the newest link works");
  assert.equal(await valid("0".repeat(64)), false, "a made-up token is refused");

  // a token written through a direct update (the way several integrations write it) keeps the earlier ones too
  const viaUpdate = generateOpaqueToken();
  await User.updateOne({ _id: user._id }, { $set: { inviteTokenHash: hashToken(viaUpdate), inviteTokenExpiresAt: new Date(Date.now() + 86400000) } });
  assert.ok(await valid(viaUpdate), "token written by updateOne works");
  assert.ok(await valid(first), "earlier links survive an updateOne rotation");

  // an expired earlier token is not honoured
  const stale = generateOpaqueToken();
  await User.updateOne({ _id: user._id }, { $set: { inviteTokenHash: hashToken(stale), inviteTokenExpiresAt: new Date(Date.now() - 1000) } });
  assert.equal(await valid(stale), false, "an expired token is refused");
  const fresh = await clientInvite.createClientInviteToken(await User.findById(user._id));
  assert.ok(await valid(fresh));
  assert.equal(await valid(stale), false, "an expired token never comes back");

  // accepting with ANY of the links activates the account and retires all of them
  const accepted = await clientInvite.acceptClientInvite(second, "Tmp!Passw0rd123", undefined);
  assert.ok(accepted, "an earlier link can still activate the account");
  for (const token of [first, second, third, viaUpdate, fresh]) assert.equal(await valid(token), false, "every link is retired after activation");

  // revoking a pending invite kills all links
  const other = await User.create({ email: `${tag}-b@e2e-audit.invalid`, name: "tmp invite b", role: "client", mustSetPassword: true });
  const a = await clientInvite.createClientInviteToken(await User.findById(other._id));
  const b = await clientInvite.createClientInviteToken(await User.findById(other._id));
  await User.updateOne({ _id: other._id }, { $set: { inviteTokenHash: null, inviteTokenExpiresAt: null } });
  assert.equal(await valid(a), false);
  assert.equal(await valid(b), false);
});
