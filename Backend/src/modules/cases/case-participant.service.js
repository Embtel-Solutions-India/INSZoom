const mongoose = require("mongoose");
const { normalizeRole } = require("../authorization/roleHierarchy");

const STAFF_ROLES = new Set(["super_admin", "admin", "team_lead", "case_manager", "paralegal", "reviewer"]);

function idOf(value) {
  return value?._id?.toString?.() || value?.toString?.();
}

function sameId(left, right) {
  const leftId = idOf(left);
  const rightId = idOf(right);
  return Boolean(leftId && rightId && leftId === rightId);
}

function normalizeParticipantRole(role = "") {
  const value = String(role || "").toLowerCase().trim();
  if (value === "business_plan" || value === "business") return "employer";
  if (value === "hr") return "employer";
  return value;
}

function activeParticipants(caseData, role) {
  const normalizedRole = normalizeParticipantRole(role);
  return (caseData?.participants || []).filter((participant) => (
    participant?.status !== "deleted" &&
    participant?.status !== "replaced" &&
    (!normalizedRole || normalizeParticipantRole(participant.role) === normalizedRole)
  ));
}

function findParticipant(caseData, criteria = {}) {
  const role = normalizeParticipantRole(criteria.role || criteria.targetRole);
  const participantId = idOf(criteria.participantId || criteria._id);
  const userId = idOf(criteria.userId || criteria.user);
  const email = criteria.email ? String(criteria.email).toLowerCase() : "";
  return activeParticipants(caseData, role).find((participant) => {
    if (participantId && sameId(participant._id, participantId)) return true;
    if (userId && sameId(participant.userId, userId)) return true;
    if (email && participant.email === email) return true;
    return false;
  }) || null;
}

function participantForUser(caseData, user, role) {
  if (!user) return null;
  return findParticipant(caseData, { role, userId: user._id, email: user.email });
}

function participantAssignee(caseData, role, participantId) {
  const participant = findParticipant(caseData, { role, participantId }) || activeParticipants(caseData, role)[0];
  if (participant?.userId) return participant.userId;
  const normalizedRole = normalizeParticipantRole(role);
  if (normalizedRole === "employer") return caseData?.employerUser || caseData?.user || caseData?.clientProfile;
  if (normalizedRole === "employee") return caseData?.employeeUser || caseData?.user || caseData?.clientProfile;
  if (normalizedRole === "beneficiary") return caseData?.beneficiaryUser || caseData?.user || caseData?.clientProfile;
  if (normalizedRole === "petitioner") return caseData?.petitionerUser || caseData?.user || caseData?.clientProfile;
  return caseData?.user || caseData?.clientProfile;
}

function canAccessParticipant(user, caseData, participant) {
  if (!user || !caseData || !participant) return false;
  const role = normalizeRole(user.role);
  if (STAFF_ROLES.has(role)) return true;
  if (sameId(participant.userId, user._id)) return true;
  if (participant.email && user.email && participant.email === String(user.email).toLowerCase()) return true;
  if (normalizeParticipantRole(participant.role) === "employer") {
    return sameId(caseData.employerUser, user._id) ||
      sameId(participant.companyId, user.companyId) ||
      sameId(caseData.companyId, user.companyId) ||
      sameId(caseData.employer, user.companyId) ||
      sameId(caseData.organization, user.companyId);
  }
  return false;
}

function canAccessAnyParticipant(user, caseData) {
  return activeParticipants(caseData).some((participant) => canAccessParticipant(user, caseData, participant));
}

function participantResponseId(questionnaireId, caseId, participantId, userId) {
  const owner = idOf(participantId) || idOf(userId) || "unassigned";
  return `${idOf(questionnaireId)}:${idOf(caseId)}:${owner}`;
}

function ensureParticipant(caseData, input = {}, actor) {
  if (!caseData) return null;
  if (!Array.isArray(caseData.participants)) caseData.participants = [];
  const role = normalizeParticipantRole(input.role || input.targetRole || "employee");
  let participant = findParticipant(caseData, {
    role,
    participantId: input.participantId,
    userId: input.userId,
    email: input.email,
  });
  if (!participant) {
    const created = {
      _id: input.participantId && mongoose.isValidObjectId(input.participantId) ? input.participantId : new mongoose.Types.ObjectId(),
      role,
      status: input.status || "active",
      createdBy: actor?._id,
      progress: { status: input.progressStatus || "not_started", percent: 0 },
    };
    caseData.participants.push(created);
    participant = caseData.participants[caseData.participants.length - 1];
  }
  const fields = ["label", "status", "userId", "companyId", "beneficiaryId", "petitionerId", "petitionerModel", "email", "name", "phone", "questionnaireId", "responseId", "canonicalProfileId", "canonicalProfile", "reviewStatus", "submissionStatus", "metadata"];
  fields.forEach((field) => {
    if (input[field] !== undefined) participant[field] = input[field];
  });
  if (input.invite) participant.invite = { ...(participant.invite?.toObject?.() || participant.invite || {}), ...input.invite };
  if (input.progress) participant.progress = { ...(participant.progress?.toObject?.() || participant.progress || {}), ...input.progress };
  participant.updatedBy = actor?._id;
  return participant;
}

function participantSnapshot(participant) {
  if (!participant) return null;
  const object = participant.toObject ? participant.toObject() : participant;
  return {
    participantId: idOf(object._id),
    role: object.role,
    status: object.status,
    userId: idOf(object.userId),
    email: object.email,
    name: object.name,
    questionnaireId: idOf(object.questionnaireId),
    responseId: object.responseId,
    canonicalProfileId: idOf(object.canonicalProfileId),
    progress: object.progress || {},
    reviewStatus: object.reviewStatus,
    submissionStatus: object.submissionStatus,
    invite: object.invite,
  };
}

module.exports = {
  activeParticipants,
  canAccessAnyParticipant,
  canAccessParticipant,
  ensureParticipant,
  findParticipant,
  idOf,
  normalizeParticipantRole,
  participantAssignee,
  participantForUser,
  participantResponseId,
  participantSnapshot,
  sameId,
};
