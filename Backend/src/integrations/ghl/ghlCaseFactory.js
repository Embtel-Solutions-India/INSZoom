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
const visaService = require("./ghlVisaService");
const employerService = require("./ghlEmployerService");
const familyService = require("./ghlFamilyService");
const { findEmployerMatch } = require("./ghlEmployerMatching");
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

// True when an opportunity's identity link has stood for a while but its case no longer exists. Callers check this BEFORE any per-opportunity GHL
// call (contact, visa), so an orphan costs one database read instead of two API calls and a wait on every pass. Call it only after
// findCaseByOpportunity returned nothing (a link WITH a case is a normal, existing card).
async function isOrphanedLink(locationId, opportunityId) {
  const link = await GHLCaseLink.findOne({ locationId, opportunityId }).select("createdAt").lean();
  return Boolean(link && Date.now() - new Date(link.createdAt).getTime() > 2 * 60 * 1000);
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
 * Deliberately does NOT call createCase or lifecycleOrchestrator.initializeCase.
 * If GHL's Service Type resolves to a SINGLE-party visa, the visa is set at
 * creation and the visa-driven setup runs afterwards in the background
 * (throttled, see ghlVisaService.js). Otherwise the visa stays pending and
 * nothing visa-driven runs until a team lead selects one
 * (see ghlVisaSelection.service.js).
 */
// What an imported card's pipeline stage says about the case:
//   - "Case Onboarded" is the first stage: a NEW case. Only these send the client the case-creation email.
//   - any other stage means the case is already under way (an OLD case, imported for the record): no email to the client.
//   - "Submitted (FedEx)" means the petition was already sent in: the case is imported as COMPLETED, not as a case waiting for assignment.
const NEW_CASE_STAGE_KEY = "case_onboarded";
const COMPLETED_STAGE_KEYS = new Set(["submitted_fedex"]);
const isNewCaseStage = (mapping) => mapping?.unifiedStageKey === NEW_CASE_STAGE_KEY;
const isCompletedStage = (mapping) => COMPLETED_STAGE_KEYS.has(mapping?.unifiedStageKey);

async function markImportedCaseCompleted(caseDoc) {
  if (!caseDoc?._id) return;
  await Case.updateOne(
    { _id: caseDoc._id, status: { $ne: "completed" } },
    { $set: { status: "completed" }, $push: { timeline: { type: "status", title: "Marked completed", description: "Imported from GoHighLevel at the Submitted (FedEx) stage: the case was already submitted.", metadata: { previousStatus: caseDoc.status, source: "ghl_import" }, createdAt: new Date() } } }
  ).catch((error) => logger.error("ghl_mark_completed_failed", { caseId: String(caseDoc._id), error: error.message }));
}

// An individual imported case keeps the name of its GHL card. Called for cases that already exist whenever their card is seen again (a rename in
// GHL, or an older import named after the contact). Employee cards (named for the employee, the card holds "Employer, Employee") and family
// cases (the contact is the petitioner) are left alone. Returns true when the name changed. Never throws.
async function syncCardName(existing, opportunity) {
  try {
    const name = String(opportunity?.name || "").trim();
    const ghl = existing?.integrations?.ghl;
    if (!name || !ghl || ghl.role !== "individual" || existing.caseRole === "employee" || existing.clientName === name) return false;
    const result = await Case.updateOne({ _id: existing._id, "integrations.ghl.role": "individual", clientName: { $ne: name } }, { $set: { clientName: name } });
    return Boolean(result?.modifiedCount);
  } catch (error) {
    logger.error("ghl_sync_card_name_failed", { caseId: String(existing?._id), error: error.message });
    return false;
  }
}

async function createCaseFromOpportunity({ opportunity, contact, category, mapping, origin = "webhook", sendNotifications = false, locationId = env.ghl.locationId, visaResolution = null }) {
  const existing = await findCaseByOpportunity(locationId, opportunity.id);
  if (existing) return { case: existing, created: false };
  // the client's case-creation email goes only to NEW cases (stage "Case Onboarded"), whatever the caller asked for
  sendNotifications = Boolean(sendNotifications) && isNewCaseStage(mapping);
  // The case of this opportunity was deleted in the CRM and the opportunity is still being removed from GHL: never bring it back.
  if (await require("./ghlCaseOutbound").isDeletionPending(opportunity.id)) return { case: null, created: false, skipped: "deleted" };
  // An identity link that has stood for a while but whose case no longer exists: the case was deleted without its GHL opportunity being removed
  // (for example a direct database cleanup). It is not a concurrent creator mid-flight, so do not wait for one (that cost ~2s and an error per
  // opportunity on EVERY reconcile pass) and do not bring the deleted case back. Report it as "orphaned"; see scripts/ghl-orphan-cleanup.js.
  if (await isOrphanedLink(locationId, opportunity.id)) return { case: null, created: false, skipped: "orphaned_link" };

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
    const routing = await chooseRoute({ opportunity, contact, visaResolution, locationId });
    let outcome;
    if (routing.route === "family") {
      // Family visa: ONE family case (petitioner = the GHL contact), no child cases (see ghlFamilyService.js).
      outcome = await familyService.intakeFamilyOpportunity({ caseObjectId, opportunity, contact, category, mapping, origin, sendNotifications, locationId, visaResolution, match: routing.match });
    } else if (routing.route === "employer") {
      // Employer visa: one employee card under a shared employer matter (see ghlEmployerService.js).
      outcome = await employerService.intakeEmployerOpportunity({ caseObjectId, opportunity, contact, category, mapping, origin, sendNotifications, locationId, visaResolution, match: routing.match });
    } else {
      outcome = await buildAndSaveCase({ caseObjectId, opportunity, contact, category, mapping, origin, sendNotifications, locationId, visaResolution, extraAttention: routing.attention || [] });
    }
    if (outcome?.created && isCompletedStage(mapping)) await markImportedCaseCompleted(outcome.case);
    return outcome;
  } catch (error) {
    await GHLCaseLink.deleteOne({ locationId, opportunityId: opportunity.id, caseId: caseObjectId }).catch(() => {});
    await Case.deleteOne({ _id: caseObjectId }).catch(() => {});
    throw error;
  }
}

// Individual card, or employer employee card? Only a COMPLETE mapping to an employer visa goes the employer way,
// and only when the employer can be matched without doubt. Anything uncertain falls back to an individual card
// that is flagged for a team lead, so nothing is attached to a guess and nothing is lost.
async function chooseRoute({ opportunity, contact, visaResolution, locationId }) {
  if (visaResolution?.status === "mapped" && visaResolution.structure === "family") {
    const match = await familyService.findPetitionerMatch(contact.email);
    if (match.status === "ambiguous") {
      return { route: "individual", attention: [`Family visa, but the petitioner could not be set up safely (${match.reason}). Nothing was attached.`] };
    }
    return { route: "family", match };
  }
  if (!(visaResolution?.status === "mapped" && visaResolution.structure === "employer_employee")) return { route: "individual" };
  if (!contact.email) {
    return { route: "individual", attention: ["Employer visa, but the GHL contact has no email, so the employer account cannot be set up."] };
  }
  const match = await findEmployerMatch({
    locationId,
    contactId: opportunity.contactId || contact.id,
    email: contact.email,
    names: [opportunity.name || contact.name], // the COMPANY name GHL carries; see ghlEmployerMatching
  });
  if (match.status === "ambiguous") {
    return { route: "individual", attention: [`Employer could not be matched safely (${match.reason}). Nothing was attached.`] };
  }
  return { route: "employer", match };
}

async function buildAndSaveCase({ caseObjectId, opportunity, contact, category, mapping, origin, sendNotifications, locationId, visaResolution, extraAttention = [] }) {
  const visaPlan = visaService.planFromResolution(visaResolution);
  const email = contact.email || "";
  // The case carries the name the GHL card shows (the opportunity's own name), not the linked contact's: on an imported card the contact can be a
  // different person or the company. The contact's name is still used to greet the client in emails.
  const clientName = String(opportunity.name || "").trim() || contact.name || "GHL Client";
  const clientPlan = await planClientUser(email);
  const needsAttentionReasons = [];
  if (clientPlan.action === "none") needsAttentionReasons.push(clientPlan.reason);
  needsAttentionReasons.push(...visaPlan.attention, ...extraAttention);

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
        // Pending unless GHL's Service Type resolved to a single-party visa (then visaPlan.fields overrides this).
        visaSelectionStatus: "pending",
        ...visaPlan.fields,
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
            role: "individual",
            ...(visaPlan.record ? { visaResolution: visaPlan.record } : {}),
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

  // Same bookkeeping every created case gets. Visa-driven setup happens afterwards, and only if GHL gave us a single-party visa.
  caseService.setStage(newCase, "intake", null, "Case created from GHL");
  await workflowService.caseCreated(newCase, null).catch((error) => logger.error("ghl_case_workflow_failed", { caseId: newCase._id, error: error.message }));
  const originLabel = `Created from GHL — ${ORIGIN_LABEL[origin] || origin}`;
  caseService.addTimelineEvent(newCase, "case", originLabel, `GHL opportunity ${opportunity.id}`, null, {
    origin,
    ghlOpportunityId: opportunity.id,
    ghlPipelineId: opportunity.pipelineId,
    needsAttention: needsAttentionReasons,
  });
  if (visaPlan.applied) {
    caseService.addTimelineEvent(newCase, "case", "Visa set from GHL", `Service Type mapped to ${visaPlan.fields.visaType}`, null, {
      source: "ghl",
      field: visaResolution.field,
      value: visaResolution.value,
    });
  }
  caseService.addAuditEntry(newCase, "create", originLabel, null, { origin, ghlOpportunityId: opportunity.id, caseNumber });
  await newCase.save();
  if (visaPlan.applied) visaService.scheduleProvisioning(newCase._id); // background, throttled

  if (sendNotifications) {
    await notifyGhlCaseCreated(newCase, { clientUser, setupToken, name: contact.name || clientName }).catch((error) =>
      logger.error("ghl_case_notifications_failed", { caseId: newCase._id, error: error.message })
    );
  }
  return { case: newCase, created: true, needsAttention: needsAttentionReasons };
}

// Same client + team-lead messages a normally created case sends, worded for a
// case whose visa is not chosen yet (so the text never says "null").
async function notifyGhlCaseCreated(caseData, { clientUser, setupToken, email, name }) {
  const caseNumber = caseData.caseNumber;
  // A family case's clientName / clientEmail are the BENEFICIARY's (empty at first), so the caller names the
  // person to write to. Everyone else falls back to the case's own client.
  const toEmail = email || caseData.clientEmail;
  const toName = name || caseData.clientName;
  if (clientUser && toEmail) {
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
                emailTo: toEmail,
                emailData: { clientName: toName, caseNumber, token: setupToken },
              }
            : {
                emailTemplate: "case-created-client",
                emailTo: toEmail,
                emailData: { clientName: toName, caseNumber, loginLink: `${env.clientUrl}/login` },
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
          message: `${caseNumber} · ${toName || "Client"} · ${caseData.visaType || "Visa selection required"}`,
          caseId: caseData._id,
          link: `/crm-cases/${caseData._id}?assign=case_manager`,
          priority: "high",
          source: "shared",
          emailTemplate: "case-created-team-lead",
          emailTo: teamLead?.email,
          emailData: { teamLeadName: teamLead?.name || teamLead?.displayName, caseNumber, clientName: toName },
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

module.exports = { syncCardName, NEW_CASE_STAGE_KEY, COMPLETED_STAGE_KEYS, isNewCaseStage, isCompletedStage, markImportedCaseCompleted, createCaseFromOpportunity, findCaseByOpportunity, isOrphanedLink, notifyGhlCaseCreated, planClientUser };
