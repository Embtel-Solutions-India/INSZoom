// PERM (labor certification) stage gates - the single source of truth for WHEN a USCIS form may
// appear on a PERM case. PERM itself is a Department of Labor process (ETA-9141 / ETA-9089, no USCIS
// template); the USCIS forms come later and only as the matter reaches them:
//
//   PERM created               -> checklists + documents only (no USCIS form)
//   PERM certified             -> I-140
//   proceeding with adjustment -> I-485            (needs certification)
//   + employment authorization -> I-765            (needs the adjustment stage)
//   + advance parole           -> I-131            (needs the adjustment stage)
//
// Stored on Case.permWorkflow (set only through case.controller.js updatePermWorkflow, on the
// principal case and its employee case(s) alike). Consumed by:
//   - VisaFormMapping trigger conditions (whitelisted fields perm*), the registry gate;
//   - uscis-form.service.js's legacy visa-type scan, so that listing PERM in a form template's
//     visaTypes (which the registry needs for TEMPLATE_AVAILABLE) can never auto-create a form early.

const PERM_VISA_TYPE = "PERM";

// formCode -> the flags that must all be true
const PERM_STAGE_FORMS = {
  "I-140": ["permCertified"],
  "I-485": ["permCertified", "permAdjustmentStage"],
  "I-765": ["permCertified", "permAdjustmentStage", "permEmploymentAuthorization"],
  "I-131": ["permCertified", "permAdjustmentStage", "permAdvanceParole"],
};

function permStageFlags(caseData) {
  const workflow = caseData?.permWorkflow || {};
  const certified = Boolean(workflow.certified);
  const adjustment = certified && Boolean(workflow.adjustmentOfStatus);
  return {
    permCertified: certified,
    permAdjustmentStage: adjustment,
    permEmploymentAuthorization: adjustment && Boolean(workflow.employmentAuthorization),
    permAdvanceParole: adjustment && Boolean(workflow.advanceParole),
  };
}

function normalizeFormCode(formCode) {
  const match = /^([a-z]+)-?(\d+)/i.exec(String(formCode || "").trim());
  return match ? `${match[1].toUpperCase()}-${match[2]}` : String(formCode || "").toUpperCase();
}

// true when this form is not stage-gated for this case at all, or its gate is open.
function permStageAllowsForm(caseData, formCode) {
  if (caseData?.visaType !== PERM_VISA_TYPE) return true;
  const required = PERM_STAGE_FORMS[normalizeFormCode(formCode)];
  if (!required) return true;
  const flags = permStageFlags(caseData);
  return required.every((flag) => flags[flag]);
}

// Whitelisted VisaFormMapping trigger fields this module owns.
const PERM_TRIGGER_FIELDS = ["permCertified", "permAdjustmentStage", "permEmploymentAuthorization", "permAdvanceParole"];

// Registry trigger condition for a form's gate (same shape evaluateTrigger reads).
function permTriggerFor(formCode) {
  const required = PERM_STAGE_FORMS[normalizeFormCode(formCode)] || [];
  const nodes = required.map((field) => ({ field, operator: "equals", value: true }));
  return nodes.length === 1 ? nodes[0] : { all: nodes };
}

module.exports = { PERM_VISA_TYPE, PERM_STAGE_FORMS, PERM_TRIGGER_FIELDS, permStageFlags, permStageAllowsForm, permTriggerFor };
