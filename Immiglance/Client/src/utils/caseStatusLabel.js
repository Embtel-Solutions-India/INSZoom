// Single source of truth for mapping a case's real backend stage/status key
// (Case.status / Case.stage, defined in Backend/src/modules/cases/case.constants.js)
// to the 5 client-facing status labels used across the portal (top bar badge,
// Overview stepper): Submitted, Evaluation In Progress, Attorney Review,
// Documents Requested, Filed, plus terminal Approved/Closed. Never invent a
// second copy of this table elsewhere — import from here.
export const CASE_STATUS_STEPS = [
  "Submitted",
  "Evaluation In Progress",
  "Attorney Review",
  "Documents Requested",
  "Filed",
];

const STATUS_KEY_TO_LABEL = {
  draft: "Submitted",
  pending_assignment: "Submitted",
  intake: "Evaluation In Progress",
  assigned: "Evaluation In Progress",
  waiting_for_client: "Evaluation In Progress",
  questionnaire_complete: "Evaluation In Progress",
  strategy: "Evaluation In Progress",
  evidence: "Evaluation In Progress",
  expert_letters: "Evaluation In Progress",
  document_collection: "Documents Requested",
  documents_pending: "Documents Requested",
  legal_review: "Attorney Review",
  attorney_review: "Attorney Review",
  form_preparation: "Attorney Review",
  petition_preparation: "Attorney Review",
  ready_for_filing: "Attorney Review",
  ready_to_file: "Attorney Review",
  filing: "Attorney Review",
  filed: "Filed",
  processing: "Filed",
  uscis_pending: "Filed",
  in_processing: "Filed",
  rfe: "Filed",
  approved: "Approved",
  completed: "Approved",
  denied: "Closed",
  closed: "Closed",
  archived: "Closed",
};

export function resolveCaseStatusLabel(caseData) {
  const key = String(caseData?.stage || caseData?.status || "").toLowerCase();
  return STATUS_KEY_TO_LABEL[key] || "Evaluation In Progress";
}

// Index into CASE_STATUS_STEPS for the stepper — terminal states (Approved/
// Closed) are rendered as the last step ("Filed") fully complete, since
// they're not literal steps in the 5-item client-facing sequence.
export function resolveCaseStepIndex(caseData) {
  const label = resolveCaseStatusLabel(caseData);
  const index = CASE_STATUS_STEPS.indexOf(label);
  if (index >= 0) return index;
  return CASE_STATUS_STEPS.length - 1;
}
