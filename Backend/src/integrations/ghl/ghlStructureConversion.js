const env = require("../../config/env");
const logger = require("../../utils/logger");
const Case = require("../../models/Case");
const User = require("../../models/User");
const EmployeeProfile = require("../../models/EmployeeProfile");
const GHLEmployerLink = require("../../models/GHLEmployerLink");
const CaseNumberService = require("../../services/CaseNumberService");
const caseService = require("../../modules/cases/case.service");
const { resolveDocumentRequirements } = require("../../modules/document-requirements/document-requirement.resolver");
const { findEmployerMatch } = require("./ghlEmployerMatching");

// A GHL case that arrived with no visa is an individual card. When a team lead then picks an EMPLOYER or FAMILY visa for it,
// the card has to take the same shape the GHL intake gives those visas, so every downstream module (registry forms,
// checklist mapping, petition draft, employer/petitioner flows) treats it exactly like a case created any other way:
//
//   family            ONE family case; the GHL contact becomes the petitioner (mirrors ghlFamilyService.intakeFamilyOpportunity)
//   employer_employee the card becomes an EMPLOYEE card under a shared employer matter (mirrors ghlEmployerService)
//
// The same card keeps its GHL opportunity, board position, timeline and audit trail; only its structure changes.
// Nothing here is saved by this file: the caller saves the case, then runs `afterSave`.

const httpError = (status, code, message) => Object.assign(new Error(message), { status, code });

// ---- family ---------------------------------------------------------------

function convertToFamily(caseData, visaType) {
  if (!caseData.user) {
    throw httpError(422, "GHL_FAMILY_NEEDS_PETITIONER", `${visaType} is a family visa, so the GHL contact becomes the petitioner. This card has no client account yet (the GHL contact has no email).`);
  }
  // The family model: clientName / clientEmail / user belong to the BENEFICIARY, who is not identified yet. The GHL contact is the petitioner.
  caseData.petitionerName = caseData.clientName || "Petitioner";
  caseData.petitionerUser = caseData.user;
  caseData.visaCategory = "Family";
  caseData.clientName = "";
  caseData.clientEmail = "";
  caseData.user = undefined;
  caseData.caseStructure = null; // family cases leave these null, exactly like intakeFamilyOpportunity / createFamilyCase
  caseData.caseRole = null;
  caseData.beneficiaryInvite = { email: "", name: "", phone: "", status: "" };
  caseData.familyCompletionMode = ""; // the petitioner picks "I'll fill it" or "invite" from their dashboard
  caseData.familyWorkflow = { petitionerStatus: "in_progress", beneficiaryStatus: "not_invited", caseManagerStatus: "waiting_for_petitioner" };
  if (caseData.integrations?.ghl) caseData.set("integrations.ghl.role", "family");
  caseService.addTimelineEvent(caseData, "case", "Converted to family case", `Visa ${visaType} selected: the GHL contact is now the petitioner; the beneficiary is not identified yet`, null, { visaType });
  return {
    structure: "family",
    afterSave: async () => require("./ghlVisaService").scheduleFamilyProvisioning(caseData._id), // background, throttled
  };
}

// ---- employer -------------------------------------------------------------

// Which employer matter does this card belong to? Same matching the GHL intake uses, except that the card's OWN
// client account must not count as "a client who already has a non-employer case".
async function matchEmployer(caseData, { locationId, contactId }) {
  if (contactId) {
    const link = await GHLEmployerLink.findOne({ locationId, contactId }).lean();
    const principal = link ? await Case.findById(link.principalCaseId) : null;
    if (principal && principal.caseStructure === "employer_employee" && principal.caseRole === "principal") return { status: "linked", principal };
  }
  const user = caseData.user ? await User.findById(caseData.user).select("email role primaryCaseId caseIds") : null;
  const others = user
    ? [...(user.caseIds || []), user.primaryCaseId].filter(Boolean).map(String).filter((id) => id !== String(caseData._id))
    : [];
  if (user && !others.length) return { status: "none", existingUser: user };
  return findEmployerMatch({ locationId, contactId, email: caseData.clientEmail, names: [caseData.clientName] });
}

async function convertToEmployee(caseData, visaType, visaRecord = {}) {
  const ghl = caseData.integrations?.ghl || {};
  const locationId = ghl.locationId || env.ghl.locationId;
  const contactId = ghl.contactId || "";
  if (!caseData.clientEmail) {
    throw httpError(422, "GHL_EMPLOYER_NEEDS_EMAIL", `${visaType} is an employer visa, so the GHL contact becomes the employer. This card has no email, so the employer account cannot be set up.`);
  }
  const match = await matchEmployer(caseData, { locationId, contactId });
  if (match.status === "ambiguous") {
    throw httpError(409, "GHL_EMPLOYER_AMBIGUOUS", `The employer could not be matched safely (${match.reason}). A team lead must set this case up manually.`);
  }

  const employerService = require("./ghlEmployerService");
  const visa = { visaType, petitionSubType: visaRecord.petitionSubType };
  const contact = { id: contactId, email: caseData.clientEmail, name: caseData.clientName };
  let principal = match.principal || null;
  let newPrincipal = false;
  if (!principal) {
    const created = await employerService.createEmployerMatter({
      opportunity: { contactId, name: caseData.clientName },
      contact,
      locationId,
      visa,
      existingUser: match.existingUser,
      origin: "visa_selection",
    });
    principal = created.principal;
    newPrincipal = Boolean(created.created);
  } else if (match.status === "email_match" && contactId) {
    await GHLEmployerLink.create({ locationId, contactId, principalCaseId: principal._id }).catch(() => {});
  }

  const nextIndex = await employerService.reserveChildIndex(principal._id);
  const childNumber = CaseNumberService.childCaseNumber(principal.caseNumber, nextIndex);
  const checklist = employerService.checklistForRole(await resolveDocumentRequirements(visaType), "employee");
  const mixedVisa = Boolean(principal.visaType && principal.visaType !== visaType);
  const assigned = Boolean(principal.assignedCaseManager);

  const [profile] = await EmployeeProfile.create([{ caseId: caseData._id, principalCaseId: principal._id, profileType: "employee", updatedAt: new Date() }]);
  Object.assign(caseData, {
    caseId: childNumber,
    caseNumber: childNumber,
    clientPortalId: childNumber,
    clientEmail: "", // not identified yet: the employer names the employee (or invites them) in the portal
    clientName: "",
    checklistItems: checklist,
    documentChecklist: checklist,
    status: assigned ? "assigned" : "pending_assignment",
    assignedTeamLead: principal.assignedTeamLead,
    teamId: principal.teamId,
    assignedCaseManager: principal.assignedCaseManager,
    primaryOwner: principal.primaryOwner,
    assignedAgent: principal.assignedAgent,
    agentEmail: principal.agentEmail,
    assignedAgentUser: principal.assignedAgentUser,
    user: principal.user,
    delegateEmployerUser: principal.delegateEmployerUser || null,
    parentCase: principal._id,
    caseStructure: "employer_employee",
    caseRole: "employee",
    childIndex: CaseNumberService.indexToSuffix(nextIndex),
    childCaseCount: 0,
    employerProfileId: principal.employerProfileId || null,
    personProfileId: profile._id,
    dataEntryMode: principal.dataEntryMode,
    assignmentOverridden: false,
  });
  if (caseData.integrations?.ghl) {
    caseData.set("integrations.ghl.role", "employee");
    caseData.set("integrations.ghl.flags.mixedVisa", mixedVisa);
    if (mixedVisa) caseData.set("integrations.ghl.flags.needsAttention", true);
  }
  caseService.addTimelineEvent(caseData, "case", "Converted to employee case", `Visa ${visaType} selected: now an employee card under employer matter ${principal.caseNumber}`, null, {
    employerCaseNumber: principal.caseNumber,
    previousClientEmail: contact.email,
  });

  return {
    structure: "employer_employee",
    afterSave: async () => {
      // Attach to the employer (what addEmployeeSlot does).
      await Case.updateOne({ _id: principal._id }, { $addToSet: { childCases: caseData._id }, $max: { childCaseCount: nextIndex + 1 } });
      if (principal.delegateEmployerUser) await User.updateOne({ _id: principal.delegateEmployerUser }, { $addToSet: { caseIds: caseData._id } }).catch(() => {});
      require("./ghlVisaService").scheduleEmployerProvisioning({ principalId: principal._id, childId: caseData._id, newPrincipal }); // background, throttled
    },
  };
}

/**
 * Reshapes a pending single-party GHL card for an employer/family visa. Returns { structure, afterSave }.
 * Throws a 4xx error (nothing saved) when the card cannot be converted safely.
 */
async function convertPendingCase(caseData, visaType, structure, visaRecord) {
  logger.info("ghl_pending_case_conversion", { caseId: String(caseData._id), visaType, structure });
  if (structure === "family") return convertToFamily(caseData, visaType);
  if (structure === "employer_employee") return convertToEmployee(caseData, visaType, visaRecord);
  throw httpError(422, "GHL_VISA_STRUCTURE_UNSUPPORTED", `${visaType} has an unsupported case structure (${structure}).`);
}

module.exports = { convertPendingCase, convertToFamily };
