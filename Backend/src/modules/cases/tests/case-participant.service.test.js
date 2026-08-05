const assert = require("node:assert/strict");
const { test } = require("node:test");
const mongoose = require("mongoose");
const participantService = require("../case-participant.service");

test("case participants support multiple isolated employees", () => {
  const employerId = new mongoose.Types.ObjectId();
  const employeeA = new mongoose.Types.ObjectId();
  const employeeB = new mongoose.Types.ObjectId();
  const caseData = { participants: [], employerUser: employerId };

  const a = participantService.ensureParticipant(caseData, { role: "employee", userId: employeeA, email: "a@example.com", name: "Employee A" });
  const b = participantService.ensureParticipant(caseData, { role: "employee", userId: employeeB, email: "b@example.com", name: "Employee B" });

  assert.notEqual(String(a._id), String(b._id));
  assert.equal(participantService.activeParticipants(caseData, "employee").length, 2);
  assert.equal(participantService.findParticipant(caseData, { role: "employee", email: "a@example.com" }).name, "Employee A");
  assert.equal(participantService.findParticipant(caseData, { role: "employee", userId: employeeB }).name, "Employee B");
});

test("participant access isolates employees from each other while allowing staff", () => {
  const employeeA = new mongoose.Types.ObjectId();
  const employeeB = new mongoose.Types.ObjectId();
  const participantA = { _id: new mongoose.Types.ObjectId(), role: "employee", userId: employeeA, email: "a@example.com", status: "active" };
  const participantB = { _id: new mongoose.Types.ObjectId(), role: "employee", userId: employeeB, email: "b@example.com", status: "active" };
  const caseData = { participants: [participantA, participantB] };

  assert.equal(participantService.canAccessParticipant({ _id: employeeA, role: "employee", email: "a@example.com" }, caseData, participantA), true);
  assert.equal(participantService.canAccessParticipant({ _id: employeeA, role: "employee", email: "a@example.com" }, caseData, participantB), false);
  assert.equal(participantService.canAccessParticipant({ _id: new mongoose.Types.ObjectId(), role: "case_manager" }, caseData, participantB), true);
});

test("participant response ids are repeatable per employee participant", () => {
  const questionnaireId = new mongoose.Types.ObjectId();
  const caseId = new mongoose.Types.ObjectId();
  const participantA = new mongoose.Types.ObjectId();
  const participantB = new mongoose.Types.ObjectId();

  const responseA1 = participantService.participantResponseId(questionnaireId, caseId, participantA);
  const responseA2 = participantService.participantResponseId(questionnaireId, caseId, participantA);
  const responseB = participantService.participantResponseId(questionnaireId, caseId, participantB);

  assert.equal(responseA1, responseA2);
  assert.notEqual(responseA1, responseB);
});
