const assert = require("node:assert/strict");
const test = require("node:test");
const mongoose = require("mongoose");

// DB-free: multiple case managers on one case (primary assignedCaseManager + additionalCaseManagers[]).
const caseService = require("../case.service");
const access = require("../caseManagerAccess");
const svc = require("../case-managers.service");
const { resolveCaseConversationRouting } = require("../../messages/messageRouting");
const Case = require("../../../models/Case");

const id = () => new mongoose.Types.ObjectId();
const [primary, extra, stranger, client] = [id(), id(), id(), id()];
const caseManager = (_id) => ({ _id, role: "case_manager" });

const baseCase = () => ({
  _id: id(),
  caseNumber: "C-1",
  user: client,
  assignedCaseManager: primary,
  additionalCaseManagers: [extra],
  assignmentHistory: [],
  timeline: [],
  auditHistory: [],
});

test("allCaseManagerIds returns primary first, de-duplicated, for ids and populated docs alike", () => {
  const caseData = { assignedCaseManager: { _id: primary, name: "P" }, additionalCaseManagers: [extra, extra, { _id: primary }] };
  assert.deepEqual(access.allCaseManagerIds(caseData), [String(primary), String(extra)]);
  assert.deepEqual(access.allCaseManagerIds({}), []);
  assert.deepEqual(access.allCaseManagerIds({ assignedCaseManager: primary }), [String(primary)]);
});

test("a case without additionalCaseManagers (every existing case) behaves exactly as before", () => {
  const legacy = { user: client, assignedCaseManager: primary };
  assert.ok(caseService.canAccessCase(caseManager(primary), legacy));
  assert.ok(!caseService.canAccessCase(caseManager(stranger), legacy));
});

test("an additional case manager can access the case; an unrelated case manager still cannot", () => {
  const caseData = baseCase();
  assert.ok(caseService.canAccessCase(caseManager(primary), caseData));
  assert.ok(caseService.canAccessCase(caseManager(extra), caseData));
  assert.ok(!caseService.canAccessCase(caseManager(stranger), caseData));
});

test("the case list filter for a case manager matches primary OR additional", () => {
  const filter = caseService.buildCaseFilter({}, caseManager(extra));
  const clause = JSON.stringify(filter.$and);
  assert.ok(clause.includes("additionalCaseManagers"));
  assert.ok(clause.includes("assignedCaseManager"));
});

test("filtering the case list by a case manager includes their additional cases", () => {
  const filter = caseService.buildCaseFilter({ assignedCaseManager: String(extra) }, { _id: id(), role: "admin" });
  assert.ok(JSON.stringify(filter.$and).includes("additionalCaseManagers"));
});

test("the client never receives additionalCaseManagers (they only see the primary)", () => {
  const caseData = { ...baseCase(), toObject: undefined };
  const asClient = caseService.serializeCaseForUser(caseData, { _id: client, role: "client" });
  assert.equal(asClient.additionalCaseManagers, undefined);
  assert.ok(asClient.assignedCaseManager, "the primary stays visible to the client");
  const asStaff = caseService.serializeCaseForUser(caseData, caseManager(primary));
  assert.equal(asStaff.additionalCaseManagers.length, 1);
});

test("the case conversation includes every case manager and lets each of them in", () => {
  const caseData = baseCase();
  const routing = resolveCaseConversationRouting(caseData, caseManager(extra));
  assert.ok(routing.desiredParticipantIds.includes(String(primary)));
  assert.ok(routing.desiredParticipantIds.includes(String(extra)));
  assert.equal(routing.includeCurrentUser, true);
  assert.equal(String(routing.assignedTo), String(primary), "the primary stays the conversation owner");
});

test("adding an additional case manager records history, timeline and audit; duplicates are rejected", () => {
  const caseData = baseCase();
  caseData.additionalCaseManagers = [];
  const added = svc.addAdditionalCaseManager(caseData, extra, { _id: id() });
  assert.equal(added.changed, true);
  assert.equal(caseData.additionalCaseManagers.length, 1);
  assert.equal(caseData.assignmentHistory[0].changeType, "assigned");
  assert.equal(caseData.timeline.length, 1);
  assert.equal(caseData.auditHistory.length, 1);
  assert.ok(svc.addAdditionalCaseManager(caseData, extra, { _id: id() }).error, "already additional");
  assert.ok(svc.addAdditionalCaseManager(caseData, primary, { _id: id() }).error, "already the primary");
});

test("removing an additional case manager works; the primary and strangers cannot be removed here", () => {
  const caseData = baseCase();
  assert.ok(svc.removeAdditionalCaseManager(caseData, primary, { _id: id() }).error);
  assert.ok(svc.removeAdditionalCaseManager(caseData, stranger, { _id: id() }).error);
  assert.equal(svc.removeAdditionalCaseManager(caseData, extra, { _id: id() }).changed, true);
  assert.equal(caseData.additionalCaseManagers.length, 0);
  assert.equal(caseData.assignmentHistory[0].changeType, "removed");
  assert.ok(!caseService.canAccessCase(caseManager(extra), caseData), "removed case manager loses access");
});

test("a case manager promoted to primary is dropped from the additional list", () => {
  const caseData = baseCase();
  svc.dropFromAdditional(caseData, extra);
  assert.equal(caseData.additionalCaseManagers.length, 0);
});

test("the Case model carries additionalCaseManagers, empty by default", () => {
  const doc = new Case({});
  assert.deepEqual([...doc.additionalCaseManagers], []);
});

test("the default team lead (DEFAULT_TEAM_LEAD_EMAIL) gets cases that name nobody; there is no round robin fallback", async () => {
  const User = require("../../../models/User");
  const env = require("../../../config/env");
  const realFindOne = User.findOne;
  const seen = [];
  const akash = { _id: id() };
  const robin = { _id: id() };
  const results = (query) => (query.email === "akash@example.test" ? akash : robin);
  User.findOne = (query) => {
    seen.push(query);
    const value = results(query);
    return { sort: () => ({ select: async () => value }), select: async () => (query.email ? (query.email === "akash@example.test" ? value : null) : value) };
  };
  const previous = env.defaultTeamLeadEmail;
  try {
    env.defaultTeamLeadEmail = "akash@example.test";
    assert.equal(await caseService.resolveTeamLeadForCase({}), akash, "the configured default is used");
    assert.equal(await caseService.resolveTeamLeadForCase({ assignedTeamLead: robin._id }), robin._id, "an explicit team lead still wins");
    env.defaultTeamLeadEmail = "missing@example.test";
    assert.equal(await caseService.resolveTeamLeadForCase({}), null, "an unknown / inactive default: the case has no team lead (never an arbitrary one)");
    env.defaultTeamLeadEmail = "";
    assert.equal(await caseService.resolveTeamLeadForCase({}), null, "no default configured: no team lead (never an arbitrary one)");
  } finally {
    User.findOne = realFindOne;
    env.defaultTeamLeadEmail = previous;
  }
});

test("the team lead who creates a case is its team lead; admin-created cases go to the default team lead", async () => {
  const User = require("../../../models/User");
  const env = require("../../../config/env");
  const realFindOne = User.findOne;
  const akash = { _id: id() };
  User.findOne = () => ({ sort: () => ({ select: async () => akash }), select: async () => akash });
  const previous = env.defaultTeamLeadEmail;
  try {
    env.defaultTeamLeadEmail = "akash@example.test";
    const madaan = { _id: id(), role: "team_lead", teamId: id() };
    const byMadaan = await caseService.resolveTeamLeadForCase({}, madaan);
    assert.equal(String(byMadaan._id), String(madaan._id), "Madaan creates -> Madaan");
    assert.equal(String(byMadaan.teamId), String(madaan.teamId));
    assert.equal(await caseService.resolveTeamLeadForCase({}, { _id: id(), role: "admin" }), akash, "admin creates -> default (Akash)");
    assert.equal(await caseService.resolveTeamLeadForCase({}, { _id: id(), role: "super_admin" }), akash, "super admin creates -> default");
    assert.equal(await caseService.resolveTeamLeadForCase({}), akash, "no creator (GHL / automatic) -> default");
    assert.equal(await caseService.resolveTeamLeadForCase({}, { _id: id(), role: "team_lead", isActive: false }), akash, "an inactive team lead is never assigned");
    const named = id();
    assert.equal(await caseService.resolveTeamLeadForCase({ assignedTeamLead: named }, madaan), named, "an explicitly named team lead wins");
  } finally {
    User.findOne = realFindOne;
    env.defaultTeamLeadEmail = previous;
  }
});

test("cases created by admin@immiglance.com go to teamlead@immiglance.com; other admins still get the default", async () => {
  const User = require("../../../models/User");
  const env = require("../../../config/env");
  const realFindOne = User.findOne;
  const akash = { _id: id() };
  const dedicated = { _id: id() };
  User.findOne = (query) => {
    const value = query.email === "teamlead@immiglance.com" ? dedicated : akash;
    return { sort: () => ({ select: async () => value }), select: async () => value };
  };
  const [prevDefault, prevMap] = [env.defaultTeamLeadEmail, env.teamLeadByCreatorEmail];
  try {
    env.defaultTeamLeadEmail = "akash@example.test";
    env.teamLeadByCreatorEmail = { "admin@immiglance.com": "teamlead@immiglance.com" };
    assert.equal(await caseService.resolveTeamLeadForCase({}, { _id: id(), role: "admin", email: "Admin@Immiglance.com" }), dedicated);
    assert.equal(await caseService.resolveTeamLeadForCase({}, { _id: id(), role: "admin", email: "other@admin.test" }), akash);
    const lead = { _id: id(), role: "team_lead", email: "admin@immiglance.com" };
    assert.equal(String((await caseService.resolveTeamLeadForCase({}, lead))._id), String(lead._id), "a team lead creator still wins over the mapping");
  } finally {
    User.findOne = realFindOne;
    env.defaultTeamLeadEmail = prevDefault;
    env.teamLeadByCreatorEmail = prevMap;
  }
});
