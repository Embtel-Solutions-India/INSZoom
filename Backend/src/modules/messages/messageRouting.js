function idOf(value) {
  return value?._id?.toString?.() || value?.toString?.();
}

function sameId(left, right) {
  const leftId = idOf(left);
  const rightId = idOf(right);
  return Boolean(leftId && rightId && leftId === rightId);
}

function resolveCaseConversationRouting(caseData = {}, currentUser = {}) {
  const clientId = caseData.user || caseData.clientProfile;
  const assignedTo = caseData.assignedCaseManager || caseData.primaryOwner || caseData.assignedTeamLead;
  // Employer-sponsored cases (H-1B, L-1A, etc.) have two case-side parties —
  // the employer and the invited employee — who must share one conversation
  // with the same case manager, not just whichever one `caseData.user` points
  // at. Both are included here whenever present so neither is ever excluded.
  const participantUserIds = (caseData.participants || [])
    .filter((participant) => participant.status !== "deleted" && participant.status !== "replaced")
    .map((participant) => participant.userId);
  const caseParticipantIds = [clientId, caseData.employerUser, caseData.employeeUser, ...participantUserIds];
  const desiredParticipantIds = [...caseParticipantIds, caseData.assignedCaseManager || caseData.primaryOwner, caseData.assignedTeamLead]
    .map(idOf)
    .filter(Boolean);

  const currentUserIsAssignedParticipant = [
    ...caseParticipantIds,
    caseData.assignedCaseManager,
    caseData.primaryOwner,
    caseData.assignedTeamLead,
  ].some((participantId) => sameId(currentUser?._id, participantId));

  return {
    clientId,
    assignedTo,
    desiredParticipantIds: [...new Set(desiredParticipantIds)],
    includeCurrentUser: currentUserIsAssignedParticipant,
  };
}

module.exports = {
  idOf,
  resolveCaseConversationRouting,
  sameId,
};
