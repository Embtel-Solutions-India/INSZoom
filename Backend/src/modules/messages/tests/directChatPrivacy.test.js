// Who may see which direct chat. DB-free.
//   - a direct chat between TWO TEAM MEMBERS is private to those two (not even an administrator reads it);
//   - a direct chat that involves a client is visible to the oversight roles: super admin, admin, team lead and case manager;
//   - case conversations and shared inboxes keep their oversight as before.
const assert = require("node:assert/strict");
const { test, mock } = require("node:test");
const Conversation = require("../../../models/Conversation");
const { buildConversationFilter, canAccessConversation, canAccessMessage, CLIENT_DIRECT_FILTER } = require("../message.service");

const ADMIN = { _id: "60d0fe4f5311236168a10101", role: "admin" };
const SUPER = { _id: "60d0fe4f5311236168a10102", role: "super_admin" };
const TEAM_LEAD = { _id: "60d0fe4f5311236168a10103", role: "team_lead" };
const CASE_MANAGER = { _id: "60d0fe4f5311236168a10104", role: "case_manager" };
const FINANCE = { _id: "60d0fe4f5311236168a10105", role: "finance" };
const AKASH = { _id: "60d0fe4f5311236168a10201", role: "team_lead" };
const VASU = { _id: "60d0fe4f5311236168a10202", role: "case_manager" };
const CLIENT = { _id: "60d0fe4f5311236168a10203", role: "client" };
const CASE_ID = "60d0fe4f5311236168a10301";
const OVERSIGHT = [ADMIN, SUPER, TEAM_LEAD, CASE_MANAGER];

// Akash wrote to Vasu (two team members); Vasu wrote to a client
const teamChat = { type: "direct", participants: [{ user: AKASH._id, role: "team_lead" }, { user: VASU._id, role: "case_manager" }], receiverId: VASU._id };
const clientChat = { type: "direct", participants: [{ user: VASU._id, role: "case_manager" }, { user: CLIENT._id, role: "client" }], receiverId: CLIENT._id };

test("nobody but the two people can open a chat between two team members - not an administrator, not a super admin, not a team lead", async () => {
  for (const viewer of [ADMIN, SUPER, TEAM_LEAD, CASE_MANAGER, FINANCE]) assert.equal(await canAccessConversation(viewer, teamChat), false, viewer.role);
});

test("the two team members in a private chat can open it", async () => {
  assert.equal(await canAccessConversation(AKASH, teamChat), true);
  assert.equal(await canAccessConversation(VASU, teamChat), true);
});

test("an administrator who IS one of the two people can open it, like anyone else", async () => {
  const adminToVasu = { type: "direct", participants: [{ user: ADMIN._id, role: "admin" }, { user: VASU._id, role: "case_manager" }] };
  assert.equal(await canAccessConversation(ADMIN, adminToVasu), true);
});

test("a client's direct chat is visible to super admin, admin, team lead and case manager, whoever the team member is", async () => {
  for (const viewer of OVERSIGHT) assert.equal(await canAccessConversation(viewer, clientChat), true, viewer.role);
});

test("other staff roles keep the participant-only rule for direct chats (finance does not read a client's direct chat)", async () => {
  assert.equal(await canAccessConversation(FINANCE, clientChat), false);
});

test("the client themselves and the team member in the chat can open it", async () => {
  assert.equal(await canAccessConversation(CLIENT, clientChat), true);
  assert.equal(await canAccessConversation(VASU, clientChat), true);
});

test("a client cannot open a chat between two team members", async () => {
  assert.equal(await canAccessConversation(CLIENT, teamChat), false);
});

test("an attorney (external, not on the internal team) counts as outside the team: that direct chat is visible to the oversight roles", async () => {
  const attorneyChat = { type: "direct", participants: [{ user: VASU._id, role: "case_manager" }, { user: "60d0fe4f5311236168a10204", role: "attorney" }] };
  for (const viewer of OVERSIGHT) assert.equal(await canAccessConversation(viewer, attorneyChat), true, viewer.role);
});

test("administrators keep their oversight of every other kind of conversation", async () => {
  for (const type of ["case", "internal", "support", "shared_inbox", "email"]) {
    assert.equal(await canAccessConversation(ADMIN, { type, caseId: type === "case" ? CASE_ID : undefined, participants: [{ user: AKASH._id, role: "team_lead" }] }), true, type);
  }
});

test("the conversation list of an administrator: everything except private team-to-team chats", async () => {
  const filter = await buildConversationFilter(ADMIN);
  assert.deepEqual(filter.deletedAt, { $exists: false });
  const [everythingButDirect, ownDirect, clientDirect] = filter.$or;
  assert.deepEqual(everythingButDirect, { type: { $ne: "direct" } });
  assert.equal(ownDirect.type, "direct");
  assert.ok(ownDirect.$or.every((clause) => Object.values(clause).every((value) => String(value) === ADMIN._id)), "an own direct chat is included only through the administrator's own participation");
  assert.deepEqual(clientDirect, CLIENT_DIRECT_FILTER);
});

test("the client-direct filter means 'a direct chat with at least one participant who is not on the internal team'", () => {
  assert.equal(CLIENT_DIRECT_FILTER.type, "direct");
  const clause = CLIENT_DIRECT_FILTER.participants.$elemMatch.role;
  assert.equal(clause.$exists, true);
  for (const role of ["super_admin", "admin", "team_lead", "case_manager", "paralegal", "finance", "hr", "reviewer", ""]) assert.ok(clause.$nin.includes(role), role);
  assert.equal(clause.$nin.includes("client"), false);
  assert.equal(clause.$nin.includes("attorney"), false);
});

test("a team lead / case manager list also carries the client-direct clause; finance does not", async () => {
  for (const viewer of [TEAM_LEAD, CASE_MANAGER]) {
    const filter = await buildConversationFilter(viewer);
    assert.ok(filter.$or.some((clause) => clause === CLIENT_DIRECT_FILTER), viewer.role);
  }
  const finance = await buildConversationFilter(FINANCE);
  assert.ok(!finance.$or.some((clause) => clause === CLIENT_DIRECT_FILTER));
});

test("messages: a private team-to-team message is unreadable by an administrator; a client's direct message is readable by the oversight roles", async (t) => {
  t.after(() => mock.restoreAll());
  const docs = {
    "60d0fe4f5311236168a10401": teamChat,
    "60d0fe4f5311236168a10402": clientChat,
  };
  mock.method(Conversation, "findById", (id) => {
    const doc = { _id: id, ...docs[id] };
    return { select: () => ({ lean: async () => doc }), then: (resolve) => resolve(doc) };
  });
  const teamMessage = { conversationId: "60d0fe4f5311236168a10401", senderId: AKASH._id, receiverId: VASU._id };
  const clientMessage = { conversationId: "60d0fe4f5311236168a10402", senderId: VASU._id, receiverId: CLIENT._id };
  for (const viewer of [ADMIN, SUPER, TEAM_LEAD, CASE_MANAGER]) assert.equal(await canAccessMessage(viewer, teamMessage), false, `${viewer.role} / team message`);
  assert.equal(await canAccessMessage(AKASH, teamMessage), true);
  assert.equal(await canAccessMessage(VASU, teamMessage), true);
  for (const viewer of OVERSIGHT) assert.equal(await canAccessMessage(viewer, clientMessage), true, `${viewer.role} / client message`);
  assert.equal(await canAccessMessage(FINANCE, clientMessage), false);
});

test("an old direct message that has no conversation is private to its two people", async () => {
  const legacy = { senderId: AKASH._id, receiverId: VASU._id };
  assert.equal(await canAccessMessage(ADMIN, legacy), false);
  assert.equal(await canAccessMessage(VASU, legacy), true);
});

test("a case message stays visible to an administrator (oversight of the case team's work)", async () => {
  assert.equal(await canAccessMessage(ADMIN, { caseId: CASE_ID, conversationId: "60d0fe4f5311236168a10403", senderId: AKASH._id }), true);
});

test("an administrator keeps access to the messages of a shared inbox / support conversation", async (t) => {
  t.after(() => mock.restoreAll());
  mock.method(Conversation, "findById", () => {
    const doc = { type: "shared_inbox", participants: [] };
    return { select: () => ({ lean: async () => doc }), then: (resolve) => resolve(doc) };
  });
  assert.equal(await canAccessMessage(ADMIN, { conversationId: "60d0fe4f5311236168a10404", senderId: AKASH._id }), true);
});
