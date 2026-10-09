const mongoose = require("mongoose");
const env = require("../../config/env");
const logger = require("../../utils/logger");
const Case = require("../../models/Case");
const User = require("../../models/User");
const EmployerProfile = require("../../models/EmployerProfile");
const EmployeeProfile = require("../../models/EmployeeProfile");
const GHLEmployerLink = require("../../models/GHLEmployerLink");
const CaseNumberService = require("../../services/CaseNumberService");
const caseService = require("../../modules/cases/case.service");
const workflowService = require("../../modules/cases/case.workflow.service");
const notificationService = require("../../modules/notifications/notification.service");
const realtimeGateway = require("../../modules/realtime/realtime.gateway");
const workflowSlaService = require("../../modules/settings/workflowSla.service");
const { resolveDocumentRequirements } = require("../../modules/document-requirements/document-requirement.resolver");
const { generateOpaqueToken, hashToken } = require("../../modules/auth/password.service");
const { generateUniqueReferralCode } = require("../../utils/referralCode");
const visaService = require("./ghlVisaService");

// GHL opportunity (employer visa) -> the EXISTING employer model:
//   one employer matter (principal case + one shared EmployerProfile)
//     +-- one employee card (child case) per GHL opportunity
//
// This mirrors what createCase does for the matter and what addEmployeeSlot does
// for each employee, WITHOUT calling or editing either. Employer details are
// stored once on the shared profile and reused by every employee's forms.

const CLIENT_SETUP_TOKEN_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Same rule as case.controller's filterChecklistForRole (a 3-line pure function that module does not export).
const checklistForRole = (checklist, role) =>
  (checklist || []).filter((item) => !item.questionnaireOnly).filter((item) => !item.targetRole || item.targetRole === role);

async function waitForEmployerMatter(locationId, contactId, attempts = 10) {
  for (let i = 0; i < attempts; i += 1) {
    const link = await GHLEmployerLink.findOne({ locationId, contactId }).lean();
    const found = link ? await Case.findById(link.principalCaseId) : null;
    if (found) return found;
    await sleep(200);
  }
  return null;
}

// ---------------------------------------------------------------------------
// The employer matter (principal)
// ---------------------------------------------------------------------------

async function createEmployerMatter({ opportunity, contact, locationId, visa, existingUser, origin }) {
  const principalId = new mongoose.Types.ObjectId();
  const contactId = opportunity.contactId || contact.id || "";
  const email = contact.email;
  const companyName = opportunity.name || contact.name || "Employer";

  // Claim "this GHL contact is an employer" first. The unique (location, contact) index lets exactly one
  // concurrent creator win; the others attach to the winner's matter.
  if (contactId) {
    try {
      await GHLEmployerLink.create({ locationId, contactId, principalCaseId: principalId });
    } catch (error) {
      if (error?.code !== 11000) throw error;
      const winner = await waitForEmployerMatter(locationId, contactId);
      if (winner) return { principal: winner, created: false };
      throw new Error("The employer for this GHL contact is being created by another worker; retry");
    }
  }

  const userId = existingUser?._id || new mongoose.Types.ObjectId();
  let createdUser = false;
  let setupToken = null;
  try {
    const teamLead = await caseService.resolveTeamLeadForCase({});
    const slaDueDates = await workflowSlaService.computeInitialSlaDueDates().catch(() => undefined);
    const caseNumber = await CaseNumberService.nextPrincipalCaseNumber();
    const checklist = checklistForRole(await resolveDocumentRequirements(visa.visaType), "employer");
    const now = new Date();

    const [principal] = await Case.create([
      {
        _id: principalId,
        isDemoData: false,
        caseId: caseNumber,
        caseNumber,
        clientPortalId: caseNumber,
        clientName: contact.name || companyName,
        clientEmail: email,
        petitionerName: companyName,
        // The matter's visa is only the first employee's, so today's employer checklist works for a
        // single-visa employer. It says nothing about the employer (see containerVisaProvisional).
        visaType: visa.visaType,
        visaCategory: visa.visaType,
        petitionType: visa.visaType,
        ...(visa.petitionSubType ? { petitionSubType: visa.petitionSubType } : {}),
        visaSelectionStatus: "selected",
        caseType: "immigration",
        caseStructure: "employer_employee",
        caseRole: "principal",
        childCaseCount: 0,
        childIndex: null,
        // Same default createCase uses for employer matters: the employer fills in until an employee is invited.
        dataEntryMode: "fill_self",
        creationSource: "ghl",
        status: "pending_assignment",
        assignedTeamLead: teamLead?._id,
        teamId: teamLead?.teamId,
        assignedAgent: "Team Lead Queue",
        slaDueDates,
        checklistItems: checklist,
        documentChecklist: checklist,
        user: userId,
        employerUser: userId,
        integrations: {
          ghl: {
            locationId,
            contactId: contactId || undefined,
            role: "employer",
            containerVisaProvisional: true,
            origin,
            flags: { deletedInGhl: false, needsAttention: false, mixedVisa: false },
            lastSyncedAt: now,
          },
        },
      },
    ]);

    // Client login for the employer (mirrors createCase): inactive, one-time setup token.
    if (existingUser) {
      const user = await User.findById(existingUser._id).select("+password +inviteTokenHash");
      if (!user.password && !user.inviteTokenHash) {
        setupToken = generateOpaqueToken();
        user.inviteTokenHash = hashToken(setupToken);
        user.inviteTokenExpiresAt = new Date(Date.now() + CLIENT_SETUP_TOKEN_EXPIRY_MS);
        user.mustSetPassword = true;
        user.isActive = false;
        user.isEmailVerified = false;
      }
      user.primaryCaseId = principalId;
      user.caseIds = [principalId];
      user.caseRole = "principal";
      user.principalCaseId = null;
      await user.save();
    } else {
      setupToken = generateOpaqueToken();
      await User.create([
        {
          _id: userId,
          email,
          name: contact.name || companyName,
          displayName: contact.name || companyName,
          phone: contact.phone || undefined,
          role: "client",
          referralCode: await generateUniqueReferralCode(User),
          isActive: false,
          isEmailVerified: false,
          mustSetPassword: true,
          inviteTokenHash: hashToken(setupToken),
          inviteTokenExpiresAt: new Date(Date.now() + CLIENT_SETUP_TOKEN_EXPIRY_MS),
          primaryCaseId: principalId,
          caseIds: [principalId],
          caseRole: "principal",
          principalCaseId: null,
        },
      ]);
      createdUser = true;
    }

    // The ONE shared employer profile. Name and email are seeded with provenance "import" (NOT
    // "case_manager_edit"), so the employer can still correct them: nothing is locked.
    const [profile] = await EmployerProfile.create([
      {
        principalCaseId: principalId,
        canonicalData: {
          legalName: { value: companyName, source: "import", updatedAt: now },
          contact: { email: { value: email, source: "import", updatedAt: now } },
        },
        updatedAt: now,
      },
    ]);
    principal.employerProfileId = profile._id;

    caseService.setStage(principal, "intake", null, "Employer matter created from GHL");
    await workflowService.caseCreated(principal, null).catch((error) => logger.error("ghl_employer_workflow_failed", { caseId: principalId, error: error.message }));
    caseService.addTimelineEvent(principal, "case", "Employer created from GHL", `GHL contact ${contactId || "(none)"}`, null, { origin, ghlContactId: contactId });
    caseService.addAuditEntry(principal, "create", "Employer matter created from GHL", null, { origin, ghlContactId: contactId, caseNumber });
    await principal.save();

    return { principal, created: true, clientUser: createdUser ? await User.findById(userId) : await User.findById(existingUser._id), setupToken };
  } catch (error) {
    // Undo everything this call created, so a retry starts clean (and re-matches by the existing user/email).
    await Promise.allSettled([
      GHLEmployerLink.deleteOne({ principalCaseId: principalId }),
      Case.deleteOne({ _id: principalId }),
      EmployerProfile.deleteOne({ principalCaseId: principalId }),
      createdUser ? User.deleteOne({ _id: userId }) : Promise.resolve(),
    ]);
    throw error;
  }
}

// ---------------------------------------------------------------------------
// The employee card (child)
// ---------------------------------------------------------------------------

// Reserves the next child number ATOMICALLY ($inc), so two opportunities for the same
// employer arriving together can never get the same "-A"/"-B" suffix.
async function reserveChildIndex(principalId) {
  const before = await Case.findOneAndUpdate({ _id: principalId }, { $inc: { childCaseCount: 1 } }, { new: false, projection: "childCaseCount childCases" });
  if (!before) throw new Error("Employer matter not found");
  return Math.max(before.childCaseCount || 0, (before.childCases || []).length);
}

async function createEmployeeChild({ principal, caseObjectId, opportunity, contact, locationId, visa, visaRecord, category, mapping, origin }) {
  const checklist = checklistForRole(await resolveDocumentRequirements(visa.visaType), "employee");
  const now = new Date();
  const assigned = Boolean(principal.assignedCaseManager);
  const needsAttention = [];
  const mixedVisa = principal.visaType && principal.visaType !== visa.visaType;
  if (mixedVisa) needsAttention.push(`Mixed-visa employer: this employee is ${visa.visaType} but the employer matter is ${principal.visaType}. Its employer checklist is added as a draft for the case manager to review and approve (or waive with a reason); this flag clears when every visa is covered.`);
  if (visaRecord?.categoryMismatch) needsAttention.push(`The GHL pipeline and the visa (${visa.visaType}) disagree on Immigrant vs Non-Immigrant.`);

  let child;
  let childNumber;
  let nextIndex;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    nextIndex = await reserveChildIndex(principal._id);
    childNumber = CaseNumberService.childCaseNumber(principal.caseNumber, nextIndex);
    try {
      [child] = await Case.create([
        {
          _id: caseObjectId,
          isDemoData: false,
          caseId: childNumber,
          caseNumber: childNumber,
          clientPortalId: childNumber,
          // Not identified yet: the employer names the employee (or invites them) in the portal.
          clientEmail: "",
          clientName: "",
          visaType: visa.visaType,
          visaCategory: visa.visaType,
          caseType: principal.caseType,
          petitionType: visa.visaType,
          ...(visa.petitionSubType ? { petitionSubType: visa.petitionSubType } : {}),
          visaSelectionStatus: "selected",
          checklistItems: checklist,
          documentChecklist: checklist,
          // Inherit the employer's assignment exactly as addEmployeeSlot does (and mark it assigned if it is).
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
          dataEntryMode: principal.dataEntryMode,
          assignmentOverridden: false,
          creationSource: "ghl",
          integrations: {
            ghl: {
              locationId,
              opportunityId: opportunity.id,
              contactId: opportunity.contactId || contact.id || undefined,
              pipelineId: opportunity.pipelineId,
              pipelineStageId: opportunity.pipelineStageId,
              sourcePipelineId: opportunity.pipelineId,
              sourceStageId: opportunity.pipelineStageId,
              unifiedStageKey: mapping?.unifiedStageKey,
              category,
              opportunityStatus: opportunity.status,
              role: "employee",
              ...(visaRecord ? { visaResolution: visaRecord } : {}),
              origin,
              flags: { deletedInGhl: false, needsAttention: needsAttention.length > 0, mixedVisa: Boolean(mixedVisa) },
              lastSyncedAt: now,
              sync: {
                state: "synced",
                version: 1,
                source: "ghl",
                changedAt: opportunity.lastStageChangeAt ? new Date(opportunity.lastStageChangeAt) : now,
                lastSyncedStageId: opportunity.pipelineStageId,
                attempts: 0,
              },
            },
          },
        },
      ]);
      break;
    } catch (error) {
      // A rare number collision (for example with an employee a person added by hand at the same moment): take the next number.
      if (error?.code === 11000 && /case(Number|Id)/i.test(String(error.message)) && attempt < 4) continue;
      throw error;
    }
  }

  const [profile] = await EmployeeProfile.create([{ caseId: child._id, principalCaseId: principal._id, profileType: "employee", updatedAt: now }]);
  child.personProfileId = profile._id;
  caseService.setStage(child, "intake", null, "Employee case created from GHL");
  caseService.addTimelineEvent(child, "case", `Created from GHL, ${origin === "initial_sync" ? "Initial Sync" : origin === "webhook" ? "OpportunityCreate webhook" : origin}`, `GHL opportunity ${opportunity.id}`, null, {
    origin,
    ghlOpportunityId: opportunity.id,
    ghlPipelineId: opportunity.pipelineId,
    employerCaseNumber: principal.caseNumber,
    needsAttention,
  });
  caseService.addAuditEntry(child, "create", "Employee case created from GHL", null, { origin, ghlOpportunityId: opportunity.id, caseNumber: childNumber });
  await child.save();

  // Attach to the employer (what addEmployeeSlot does), plus the mixed-visa flag if it applies.
  const update = { $push: { childCases: child._id }, $max: { childCaseCount: nextIndex + 1 } };
  if (mixedVisa) update.$set = { "integrations.ghl.flags.mixedVisa": true, "integrations.ghl.flags.needsAttention": true };
  await Case.updateOne({ _id: principal._id }, update);
  if (principal.delegateEmployerUser) await User.updateOne({ _id: principal.delegateEmployerUser }, { $addToSet: { caseIds: child._id } }).catch(() => {});

  return { child, needsAttention };
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

function emitCreated(child) {
  try {
    const ghl = child.integrations?.ghl || {};
    const payload = { caseId: child._id, kind: "created", unifiedStageKey: ghl.unifiedStageKey, pipelineId: ghl.pipelineId, source: "ghl" };
    ["super_admin", "admin", "team_lead"].forEach((role) => realtimeGateway.emitToRole(role, "ghl:pipeline:updated", payload));
    if (child.assignedCaseManager) realtimeGateway.emitToUser(child.assignedCaseManager, "ghl:pipeline:updated", payload);
  } catch (error) {
    logger.warn("ghl_realtime_emit_failed", { error: error.message });
  }
}

async function notifyTeamLeadOfEmployee(principal, child) {
  if (!principal.assignedTeamLead) return;
  await notificationService
    .createNotification(
      {
        userId: principal.assignedTeamLead,
        type: "team_case_created",
        category: "case",
        title: "New Employee Awaiting Assignment",
        message: `${child.caseNumber} · ${principal.petitionerName || principal.clientName || "Employer"} · ${child.visaType}`,
        caseId: principal._id,
        link: `/crm-cases/${principal._id}?assign=case_manager`,
        priority: "high",
        source: "shared",
      },
      null,
      null
    )
    .catch(() => null);
}

/**
 * Creates the employee card for a GHL opportunity under the right employer matter.
 * `match` comes from ghlEmployerMatching (linked / email_match / none).
 */
async function intakeEmployerOpportunity({ caseObjectId, opportunity, contact, category, mapping, origin, sendNotifications, locationId = env.ghl.locationId, visaResolution, match }) {
  const plan = visaService.planFromResolution(visaResolution, { allowEmployer: true });
  const visa = { visaType: plan.fields.visaType, petitionSubType: plan.fields.petitionSubType };

  let principal = match.principal || null;
  let created = null;
  if (!principal) {
    created = await createEmployerMatter({ opportunity, contact, locationId, visa, existingUser: match.existingUser, origin });
    principal = created.principal;
  } else if (match.status === "email_match" && (opportunity.contactId || contact.id)) {
    // Remember this GHL contact for next time, so the match no longer depends on the email alone.
    await GHLEmployerLink.create({ locationId, contactId: opportunity.contactId || contact.id, principalCaseId: principal._id }).catch(() => {});
  }

  const { child, needsAttention } = await createEmployeeChild({
    principal,
    caseObjectId,
    opportunity,
    contact,
    locationId,
    visa,
    visaRecord: plan.record ? { ...plan.record, status: "applied" } : null,
    category,
    mapping,
    origin,
  });

  if (sendNotifications) {
    try {
      if (created?.created) {
        await require("./ghlCaseFactory").notifyGhlCaseCreated(created.principal, { clientUser: created.clientUser, setupToken: created.setupToken });
      } else if (!principal.assignedCaseManager) {
        await notifyTeamLeadOfEmployee(principal, child);
      }
    } catch (error) {
      logger.error("ghl_employer_notifications_failed", { caseId: String(child._id), error: error.message });
    }
  }
  emitCreated(child);
  // Setting up forms/checklists is heavy: background, throttled (see ghlVisaService).
  visaService.scheduleEmployerProvisioning({ principalId: principal._id, childId: child._id, newPrincipal: Boolean(created?.created) });

  return { case: child, created: true, needsAttention, employer: { principalId: principal._id, created: Boolean(created?.created) } };
}

module.exports = { intakeEmployerOpportunity, createEmployerMatter, createEmployeeChild, reserveChildIndex, checklistForRole };
