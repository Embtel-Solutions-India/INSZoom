const assert = require("node:assert/strict");
const test = require("node:test");
const { resolveCaseConversationRouting } = require("../messageRouting");
const { buildConversationFilter, canAccessConversation } = require("../message.service");

// updated: assignedAttorney is no longer a Case field/participant (attorney
// collaboration descoped) — resolveCaseConversationRouting never reads it, so
// these routing tests no longer include an attorney in the expected participants.
test("case messages route to the assigned case manager", () => {
  const routing = resolveCaseConversationRouting({
    user: "client-1",
    assignedCaseManager: "manager-1",
  }, { _id: "client-1", role: "client" });

  assert.equal(routing.clientId, "client-1");
  assert.equal(routing.assignedTo, "manager-1");
  assert.deepEqual(routing.desiredParticipantIds, ["client-1", "manager-1"]);
  assert.equal(routing.includeCurrentUser, true);
});

test("admin opening a case conversation does not become a client-message recipient", () => {
  const routing = resolveCaseConversationRouting({
    user: "client-1",
    assignedCaseManager: "manager-1",
  }, { _id: "admin-1", role: "super_admin" });

  assert.deepEqual(routing.desiredParticipantIds, ["client-1", "manager-1"]);
  assert.equal(routing.includeCurrentUser, false);
});

test("attorney role user is not an implicit case conversation participant", () => {
  const routing = resolveCaseConversationRouting({
    user: "client-1",
  }, { _id: "attorney-1", role: "attorney" });

  assert.equal(routing.assignedTo, undefined);
  assert.deepEqual(routing.desiredParticipantIds, ["client-1"]);
  assert.equal(routing.includeCurrentUser, false);
});

test("team lead receives client messages when no case manager exists", () => {
  const routing = resolveCaseConversationRouting({
    user: "client-1",
    assignedTeamLead: "lead-1",
  }, { _id: "client-1", role: "client" });

  assert.equal(routing.assignedTo, "lead-1");
  assert.deepEqual(routing.desiredParticipantIds, ["client-1", "lead-1"]);
  assert.equal(routing.includeCurrentUser, true);
});

// "finance" is a staff role (message.service.js's local STAFF_ROLES), so both
// functions below now also scope case-type rows to cases this user currently
// has access to (see canAccessConversation's/buildConversationFilter's
// "stale participant snapshot" comments) - a live-DB check, not a pure
// comparison, so these use real ObjectId-shaped ids (no matching Case exists
// for either, which is exactly what each test wants to prove).
const FINANCE_ID = "60d0fe4f5311236168a10001";
const COMPANY_ID = "60d0fe4f5311236168a10002";
const TEAM_ID = "60d0fe4f5311236168a10003";
const CASE_ID = "60d0fe4f5311236168a10004";
const CLIENT_ID = "60d0fe4f5311236168a10005";
const MANAGER_ID = "60d0fe4f5311236168a10006";

test("non-admin conversation inbox is limited to explicit recipients", async () => {
  const filter = await buildConversationFilter({ _id: FINANCE_ID, role: "finance", companyId: COMPANY_ID, teamId: TEAM_ID });

  assert.deepEqual(filter, {
    deletedAt: { $exists: false },
    $or: [
      { type: { $ne: "case" }, $or: [
        { "participants.user": FINANCE_ID },
        { clientId: FINANCE_ID },
        { caseManagerId: FINANCE_ID },
        { receiverId: FINANCE_ID },
        { assignedTo: FINANCE_ID },
        { assignedOwnerId: FINANCE_ID },
      ] },
      { type: "case", caseId: { $in: [] } },
    ],
  });
});

test("finance cannot access case conversation unless explicitly included", async () => {
  const allowed = await canAccessConversation(
    { _id: FINANCE_ID, role: "finance", companyId: COMPANY_ID },
    {
      type: "case",
      companyId: COMPANY_ID,
      caseId: CASE_ID,
      participants: [{ user: CLIENT_ID }, { user: MANAGER_ID }],
    }
  );

  assert.equal(allowed, false);
});
