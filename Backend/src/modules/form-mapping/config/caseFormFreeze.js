// The ONE definition of a "frozen" case form (plan Rule G): a form that is, or may already be, a legal record and must never be moved to another edition or
// rewritten by an automatic path (edition migration, replace-edition, party-mapping re-apply, ...). Frozen forms stay on their edition and are reported.
//
// It is the union of the three lists that used to be hard-coded in CaseFormEditionMigrationService, scripts/applyPartyMappingsToExistingCases.js and
// scripts/replaceFormEdition.js. Every value exists in CaseForm.status except `receipt_received`, which is kept defensively (flagged for cleanup).
//   approved / generated / ready_for_pdf / locked: a review approval or a generated PDF exists; migrating would invalidate those artifacts
//   finalized / filed / receipt_received: filed or filing-ready records      archived: the form was removed from the case
// Migratable (in progress): pending, draft, ai_filled, in_review, under_review, needs_revision, rejected.

const FROZEN_CASE_FORM_STATUSES = Object.freeze([
  "finalized", "filed", "approved", "generated", "ready_for_pdf", "locked", "receipt_received", "archived",
]);

const FROZEN_SET = new Set(FROZEN_CASE_FORM_STATUSES);

/** A case form (or just its status string) is frozen when its status is on the list or it is explicitly locked. */
function isFrozen(caseForm) {
  if (typeof caseForm === "string") return FROZEN_SET.has(caseForm);
  return Boolean(caseForm) && (caseForm.isLocked === true || FROZEN_SET.has(caseForm.status));
}

module.exports = { FROZEN_CASE_FORM_STATUSES, isFrozen };
