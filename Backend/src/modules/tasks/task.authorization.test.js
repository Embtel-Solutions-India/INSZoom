const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { taskScope, canAccessTask } = require("./task.controller");

const id = () => new mongoose.Types.ObjectId();

test("task visibility is role-scoped without exposing tasks created for other employees", () => {
  const employeeId = id();
  const otherEmployeeId = id();
  const task = {
    assignedTo: otherEmployeeId,
    assignedBy: employeeId,
    clientId: id(),
  };
  const request = { user: { _id: employeeId, role: "case_manager" } };

  assert.deepEqual(taskScope(request.user), { assignedTo: employeeId });
  assert.equal(canAccessTask(task, request), false);
  assert.equal(canAccessTask({ ...task, assignedTo: employeeId }, request), true);
});

test("team leads can access their team tasks but not another team's tasks", () => {
  const teamLeadId = id();
  const teamId = id();
  const otherTeamId = id();
  const request = { user: { _id: teamLeadId, role: "team_lead", teamId } };

  assert.equal(canAccessTask({ assignedTo: id(), teamId }, request), true);
  assert.equal(canAccessTask({ assignedTo: id(), assignedTeam: teamId }, request), true);
  assert.equal(canAccessTask({ assignedTo: id(), teamId: otherTeamId }, request), false);
});

test("administrators can access all employee tasks", () => {
  const request = { user: { _id: id(), role: "admin" } };
  assert.deepEqual(taskScope(request.user), {});
  assert.equal(canAccessTask({ assignedTo: id(), teamId: id() }, request), true);
});
