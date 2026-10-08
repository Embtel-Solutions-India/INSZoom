const User = require("../../models/User");
const mongoose = require("mongoose");
const Case = require("../../models/Case");
const GHLCaseLink = require("../../models/GHLCaseLink");
const env = require("../../config/env");
const logger = require("../../utils/logger");
const CaseNumberService = require("../../services/CaseNumberService");
const caseService = require("../../modules/cases/case.service");
const workflowService = require("../../modules/cases/case.workflow.service");
const notificationService = require("../../modules/notifications/notification.service");
const realtimeGateway = require("../../modules/realtime/realtime.gateway");
const workflowSlaService = require("../../modules/settings/workflowSla.service");
const { normalizeRole } = require("../../modules/authorization/roleHierarchy");
const { generateOpaqueToken, hashToken } = require("../../modules/auth/password.service");
const { generateUniqueReferralCode } = require("../../utils/referralCode");

const CLIENT_SETUP_TOKEN_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;
const ORIGIN_LABEL = {
  initial_sync: "Initial Sync",
  webhook: "OpportunityCreate webhook",
  reconciliation: "Reconciliation",
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// opportunity -> case, through the GHLCaseLink identity collection (the cases
// collection has no free index slots; see GHLCaseLink.js).
async function findCaseByOpportunity(locationId, opportunityId) {
  const link = await GHLCaseLink.findOne({ locationId, opportunityId }).lean();
  return link ? Case.findById(link.caseId) : null;
}

// A concurrent creator claimed the link first; wait briefly for its case to exist.
async function awaitLinkedCase(locationId, opportunityId, attempts = 10) {
  for (let i = 0; i < attempts; i += 1) {
    const found = await findCaseByOpportunity(locationId, opportunityId);
    if (found) return found;
    await sleep(200);
  }
  return null;
}

// Decides how (and whether) to attach a client login. Conservative on purpose:
// createCase refuses a client who already has a case, so a second GHL
// opportunity for the same email becomes its own case with NO login link and a
// needs-attention flag, rather than disturbing the existing client's account.
async function planClientUser(email) {
  if (!email) return { action: "none", reason: "GHL contact has no email" };
  const existing = await User.findOne({ email }).select("+password +inviteTokenHash");
  if (!existing) return { action: "create" };
  if (normalizeRole(existing.role) !== "client") return { action: "none", reason: "Email belongs to a non-client account" };
  if (existing.primaryCaseId || (existing.caseIds || []).length) return { action: "none", reason: "Client already has a case" };
  return { action: "link", user: existing };
}

/**
 * Creates a CRM case from a GHL opportunity. Idempotent on locationId +
 * opportunityId: an existing case is returned untouched (`created: false`).
 *
 * Deliberately does NOT call createCase or lifecycleOrchestrator.initializeCase:
 * the visa is unknown, so nothing visa-driven (checklists, forms,
 * questionnaires) is provisioned until the team lead selects one
 * (see ghlVisaSelection.service.js). Only the pieces that do not depend on a
 * visa run here.
 */
async function createCaseFromOpportunity({ opportunity, contact, category, mapping, origin = "webhook", sendNotifications = false, locationId = env.ghl.locationId }) {
  const existing = await findCaseByOpportunity(locationId, opportunity.id);
  if (existing) return { case: existing, created: false };

  // Claim the external identity FIRST. The unique (locationId, opportunityId)
  // index makes exactly one concurrent creator win; everyone else gets the
  // winner's case. If creating the case later fails, the claim is released.
  const caseObjectId = new mongoose.Types.ObjectId();
  try {
    await GHLCaseLink.create({ locationId, opportunityId: opportunity.id, caseId: caseObjectId, contactId: opportunity.contactId });
  } catch (error) {
    if (error?.code !== 11000) throw error;
    const winner = await awaitLinkedCase(locationId, opportunity.id);
    if (winner) return { case: winner, created: false };
    throw new Error(`GHL opportunity ${opportunity.id} is being created by another worker; retry`);
  }

  try {
    return await buildAndSaveCase({ caseObjectId, opportunity, contact, category, mapping, origin, sendNotifications, locationId });
  } catch (error) {
    await GHLCaseLink.deleteOne({ locationId, opportunityId: opportunity.id, caseId: caseObjectId }).catch(() => {});
    await Case.deleteOne({ _id: caseObjectId }).catch(() => {});
    throw error;
  }
}

async function buildAndSaveCase({ caseObjectId, opportunity, contact, category, mapping, origin, sendNotifications, locationId }) {
  const email = contact.email || "";
  const clientName = contact.name || opportunity.name || "GHL Client";
  const clientPlan = await planClientUser(email);
  const needsAttentionReasons = [];
  if (clientPlan.action === "none") needsAttentionReasons.push(clientPlan.reason);

  const teamLead = await caseService.resolveTeamLeadForCase({});
  const slaDueDates = await workflowSlaService.computeInitialSlaDueDates().catch(() => undefined);
  const caseNumber = await CaseNumberService.nextPrincipalCaseNumber();
  const now = new Date();

  const [newCase] = await Case.create([
      {
        _id: caseObjectId,
        isDemoData: false,
        caseId: caseNumber,
        caseNumber,
        clientPortalId: caseNumber,
        clientName,
        clientEmail: email,
        caseType: "immigration",
        // No visa yet. visaType stays unset; the model allows that only while pending.
        visaSelectionStatus: "pending",
        caseStructure: "single",
        caseRole: "single",
        childCaseCount: 0,
        creationSource: "ghl",
        status: "pending_assignment",
        assignedTeamLead: teamLead?._id,
        teamId: teamLead?.teamId,
        assignedAgent: "Team Lead Queue",
        slaDueDates,
        checklistItems: [],
        documentChecklist: [],
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
            origin,
            flags: { deletedInGhl: false, needsAttention: needsAttentionReasons.length > 0 },
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

  // Client login (mirrors createCase: inactive user, one-time setup token).
  let setupToken = null;
  let clientUser = null;
  try {
    if (clientPlan.action === "create") {
      setupToken = generateOpaqueToken();
      clientUser = (
        await User.create([
          {
            email,
            name: clientName,
            displayName: clientName,
            phone: contact.phone || undefined,
            role: "client",
            referralCode: await generateUniqueReferralCode(User),
            isActive: false,
            isEmailVerified: false,
            mustSetPassword: true,
            inviteTokenHash: hashToken(setupToken),
            inviteTokenExpiresAt: new Date(Date.now() + CLIENT_SETUP_TOKEN_EXPIRY_MS),
            primaryCaseId: newCase._id,
            caseIds: [newCase._id],
            caseRole: "single",
            principalCaseId: null,
          },
        ])
      )[0];
    } else if (clientPlan.action === "link") {
      clientUser = clientPlan.user;
      if (!clientUser.password && !clientUser.inviteTokenHash) {
        setupToken = generateOpaqueToken();
        clientUser.inviteTokenHash = hashToken(setupToken);
        clientUser.inviteTokenExpiresAt = new Date(Date.now() + CLIENT_SETUP_TOKEN_EXPIRY_MS);
        clientUser.mustSetPassword = true;
        clientUser.isActive = false;
        clientUser.isEmailVerified = false;
      }
      clientUser.primaryCaseId = newCase._id;
      clientUser.caseIds = [newCase._id];
      clientUser.caseRole = "single";
      clientUser.principalCaseId = null;
      await clientUser.save();
    }
    if (clientUser) newCase.user = clientUser._id;
  } catch (error) {
    logger.error("ghl_case_client_user_failed", { caseId: newCase._id, error: error.message });
    needsAttentionReasons.push("Client login could not be created");
    newCase.integrations.ghl.flags.needsAttention = true;
  }

  // Same bookkeeping every created case gets, minus anything visa-driven.
  caseService.setStage(newCase, "intake", null, "Case created from GHL");
  await workflowService.caseCreated(newCase, null).catch((error) => logger.error("ghl_case_workflow_failed", { caseId: newCase._id, error: error.message }));
  const originLabel = `Created from GHL — ${ORIGIN_LABEL[origin] || origin}`;
  caseService.addTimelineEvent(newCase, "case", originLabel, `GHL opportunity ${opportunity.id}`, null, {
    origin,
    ghlOpportunityId: opportunity.id,
    ghlPipelineId: opportunity.pipelineId,
    needsAttention: needsAttentionReasons,
  });
  caseService.addAuditEntry(newCase, "create", originLabel, null, { origin, ghlOpportunityId: opportunity.id, caseNumber });
  await newCase.save();

  if (sendNotifications) {
    await notifyGhlCaseCreated(newCase, { clientUser, setupToken }).catch((error) =>
      logger.error("ghl_case_notifications_failed", { caseId: newCase._id, error: error.message })
    );
  }
  return { case: newCase, created: true, needsAttention: needsAttentionReasons };
}

// Same client + team-lead messages a normally created case sends, worded for a
// case whose visa is not chosen yet (so the text never says "null").
async function notifyGhlCaseCreated(caseData, { clientUser, setupToken }) {
  const caseNumber = caseData.caseNumber;
  if (clientUser && caseData.clientEmail) {
    await notificationService
      .createNotification(
        {
          userId: clientUser._id,
          type: "case_created",
          category: "case",
          title: setupToken ? "Your Immigration Case Is Ready" : "Your Immigration Case Has Been Created",
          message: caseNumber,
          caseId: caseData._id,
          link: setupToken ? "/accept-invite" : "/dashboard",
          priority: "medium",
          source: "shared",
          ...(setupToken
            ? {
                emailTemplate: "client-portal-invitation",
                emailTo: caseData.clientEmail,
                emailData: { clientName: caseData.clientName, caseNumber, token: setupToken },
              }
            : {
                emailTemplate: "case-created-client",
                emailTo: caseData.clientEmail,
                emailData: { clientName: caseData.clientName, caseNumber, loginLink: `${env.clientUrl}/login` },
              }),
        },
        null,
        null
      )
      .catch(() => null);
  }

  if (caseData.assignedTeamLead) {
    const teamLead = await User.findById(caseData.assignedTeamLead).select("name displayName email").catch(() => null);
    await notificationService
      .createNotification(
        {
          userId: caseData.assignedTeamLead,
          type: "team_case_created",
          category: "case",
          title: "New Case Awaiting Assignment",
          message: `${caseNumber} · ${caseData.clientName || "Client"} · Visa selection required`,
          caseId: caseData._id,
          link: `/crm-cases/${caseData._id}?assign=case_manager`,
          priority: "high",
          source: "shared",
          emailTemplate: "case-created-team-lead",
          emailTo: teamLead?.email,
          emailData: { teamLeadName: teamLead?.name || teamLead?.displayName, caseNumber, clientName: caseData.clientName },
        },
        null,
        null
      )
      .catch(() => null);
    realtimeGateway.emitToUser(caseData.assignedTeamLead, "case:created", {
      _id: caseData._id,
      caseNumber,
      clientName: caseData.clientName,
      clientEmail: caseData.clientEmail,
      status: caseData.status,
      createdAt: caseData.createdAt,
    });
  }
}

module.exports = { createCaseFromOpportunity, findCaseByOpportunity, notifyGhlCaseCreated, planClientUser };
