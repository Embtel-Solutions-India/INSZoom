const logger = require("../../utils/logger");
const { getCaseStructure } = require("../../config/visaCategories");

// A GHL case is created with no visa, so none of the visa-driven provisioning
// ran. When a team lead selects the visa, this flips the case to "selected" and
// runs the same provisioning steps initializeCase runs for any other case —
// except notifyCaseCreated, which already fired when the case arrived and must
// not email the client/team lead a second time.
//
// A no-op for every case that is not a GHL case still waiting on a visa.

const isPendingGhlCase = (caseData) => caseData?.visaSelectionStatus === "pending" && caseData?.creationSource === "ghl";

// Call BEFORE saving, with the incoming visaType. Returns true when the case
// just moved pending -> selected.
function markVisaSelected(caseData, incomingVisaType) {
  if (!isPendingGhlCase(caseData)) return false;
  if (!String(incomingVisaType || "").trim()) return false;
  const visa = String(incomingVisaType).trim();
  // A GHL case is created as a single-party case. Visas that need an employer/
  // employee or petitioner/beneficiary structure (child cases, profiles) can't be
  // bolted on afterwards, so refuse them cleanly BEFORE anything is saved.
  const structure = getCaseStructure(visa);
  if (!structure) throw Object.assign(new Error(`Unknown visa type: ${visa}`), { status: 400, code: "UNKNOWN_VISA_TYPE" });
  if (structure !== "single") {
    throw Object.assign(
      new Error(`${visa} needs an ${structure.replace("_", "/")} case structure, which isn't supported for cases created from GoHighLevel yet. Choose a single-party visa type.`),
      { status: 422, code: "GHL_VISA_STRUCTURE_UNSUPPORTED" }
    );
  }
  caseData.visaSelectionStatus = "selected";
  // createCase sets all three from the one value; do the same when the UI only sent visaType.
  if (!caseData.visaCategory) caseData.visaCategory = visa;
  if (!caseData.petitionType) caseData.petitionType = visa;
  return true;
}

// The team lead chose a visa for a pending GHL card. Single-party visas are applied in place (markVisaSelected). Employer and
// family visas reshape the card into the same structure the GHL intake gives them (see ghlStructureConversion.js), so the case
// is connected to the registry, checklists, forms and case logic exactly like any other case of that visa.
// Returns null when this is not a pending GHL card, else { structure, afterSave }: call afterSave() once the case is saved.
async function selectVisa(caseData, incomingVisaType) {
  if (!isPendingGhlCase(caseData) || !String(incomingVisaType || "").trim()) return null;
  const visa = String(incomingVisaType).trim();
  const structure = getCaseStructure(visa);
  if (!structure) throw Object.assign(new Error(`Unknown visa type: ${visa}`), { status: 400, code: "UNKNOWN_VISA_TYPE" });
  if (structure === "single") {
    markVisaSelected(caseData, visa);
    return { structure, afterSave: null };
  }
  const conversion = await require("./ghlStructureConversion").convertPendingCase(caseData, visa, structure);
  caseData.visaSelectionStatus = "selected";
  if (structure === "employer_employee") caseData.visaCategory = visa;
  if (!caseData.petitionType) caseData.petitionType = visa;
  return conversion;
}

// Runs the provisioning after the HTTP response, like createCase's own
// post-create orchestration, so selecting a visa never makes the request slow.
function provisionInBackground(caseData, user, req) {
  setImmediate(() => {
    provisionAfterVisaSelection(caseData, user, req).catch((error) =>
      logger.error("ghl_visa_selection_background_failed", { caseId: String(caseData._id), error: error.message })
    );
  });
}

// Call AFTER the case is saved and orchestrate()/recalculate() ran. Each step
// is isolated and never throws, matching initializeCase's own best-effort steps.
async function provisionAfterVisaSelection(caseData, user, req) {
  const lifecycle = require("../../modules/cases/case-lifecycle-orchestrator.service");
  const steps = [
    ["ensureBeneficiary", () => lifecycle.ensureBeneficiary(caseData, user, req)],
    ["provisionRequiredForms", () => lifecycle.provisionRequiredForms(caseData, user, req)],
    ["provisionPetitionDraft", () => lifecycle.provisionPetitionDraft(caseData, user, req)],
    ["provisionChecklistAssignments", () => lifecycle.provisionChecklistAssignments(caseData, user, req)],
  ];
  for (const [name, run] of steps) {
    try {
      await run();
    } catch (error) {
      logger.error("ghl_visa_selection_provision_failed", { caseId: String(caseData._id), step: name, error: error.message });
    }
  }
}

module.exports = { isPendingGhlCase, markVisaSelected, selectVisa, provisionAfterVisaSelection, provisionInBackground };
