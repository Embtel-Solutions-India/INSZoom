const env = require("../../config/env");
const logger = require("../../utils/logger");
const Case = require("../../models/Case");
const User = require("../../models/User");
const CaseNumberService = require("../../services/CaseNumberService");
const caseService = require("../../modules/cases/case.service");
const realtimeGateway = require("../../modules/realtime/realtime.gateway");
const workflowSlaService = require("../../modules/settings/workflowSla.service");
const { normalizeRole } = require("../../modules/authorization/roleHierarchy");
const { generateOpaqueToken, hashToken } = require("../../modules/auth/password.service");
const { generateUniqueReferralCode } = require("../../utils/referralCode");
const visaService = require("./ghlVisaService");

// GHL opportunity (family visa) -> ONE family case:
//   - one Case, one GHL opportunity, one board card, NO child cases
//   - the GHL contact is the PETITIONER; the beneficiary is not known yet
//   - both checklists (petitioner and beneficiary) live on that one case; the
//     petitioner then either fills the beneficiary's part themselves or invites
//     the beneficiary, using the family flow that already exists
//
// This mirrors createFamilyCase (family-workflow.controller.js) without calling or
// editing it. The one deliberate difference: createFamilyCase requires the
// beneficiary's email up front, while here the beneficiary is "not identified yet".
// Everything that follows (the "fill it myself" choice, the invitation, the
// petitioner/beneficiary data ownership in the canonical profile) is the existing
// flow, untouched.

const CLIENT_SETUP_TOKEN_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;
const normalizeEmail = (value) => String(value || "").trim().toLowerCase();

/**
 * Can this email be the petitioner? { status: "none" | "existing" | "ambiguous", user?, reason? }
 * An ordinary client (new, or with cases) is fine: the existing family flow already allows one
 * petitioner to have several family cases. An account that is not a client, or that belongs to an
 * employer matter or an employee, is never silently reused: a team lead decides.
 */
async function findPetitionerMatch(email) {
  const normalized = normalizeEmail(email);
  if (!normalized) return { status: "ambiguous", reason: "the GHL contact has no email" };
  const user = await User.findOne({ email: normalized }).select("email role caseRole primaryCaseId caseIds");
  if (!user) return { status: "none" };
  if (normalizeRole(user.role) !== "client") return { status: "ambiguous", reason: "this email belongs to a non-client account" };
  if (user.caseRole === "principal" || user.caseRole === "employee") return { status: "ambiguous", reason: "this email belongs to an employer or employee account" };
  return { status: "existing", user };
}

async function getOrCreatePetitioner({ email, name, phone, existing }) {
  if (existing) {
    const user = await User.findById(existing._id);
    user.name = user.name || name;
    user.displayName = user.displayName || name;
    if (phone && !user.phone) user.phone = phone;
    await user.save();
    return { user, created: false, setupToken: null };
  }
  const setupToken = generateOpaqueToken();
  try {
    const [user] = await User.create([
      {
        email,
        name,
        displayName: name,
        phone: phone || undefined,
        role: "client",
        referralCode: await generateUniqueReferralCode(User),
        isActive: false,
        isEmailVerified: false,
        mustSetPassword: true,
        inviteTokenHash: hashToken(setupToken),
        inviteTokenExpiresAt: new Date(Date.now() + CLIENT_SETUP_TOKEN_EXPIRY_MS),
      },
    ]);
    return { user, created: true, setupToken };
  } catch (error) {
    // Two opportunities for the same new petitioner arrived together; the other one created the account.
    if (error?.code === 11000) {
      const user = await User.findOne({ email });
      if (user) return { user, created: false, setupToken: null };
    }
    throw error;
  }
}

function emitCreated(caseDoc) {
  try {
    const ghl = caseDoc.integrations?.ghl || {};
    const payload = { caseId: caseDoc._id, kind: "created", unifiedStageKey: ghl.unifiedStageKey, pipelineId: ghl.pipelineId, source: "ghl" };
    ["super_admin", "admin", "team_lead"].forEach((role) => realtimeGateway.emitToRole(role, "ghl:pipeline:updated", payload));
    if (caseDoc.assignedCaseManager) realtimeGateway.emitToUser(caseDoc.assignedCaseManager, "ghl:pipeline:updated", payload);
  } catch (error) {
    logger.warn("ghl_realtime_emit_failed", { error: error.message });
  }
}

async function intakeFamilyOpportunity({ caseObjectId, opportunity, contact, category, mapping, origin, sendNotifications, locationId = env.ghl.locationId, visaResolution, match }) {
  const plan = visaService.planFromResolution(visaResolution, { allowFamily: true });
  const email = normalizeEmail(contact.email);
  const petitionerName = contact.name || opportunity.name || "Petitioner";
  const needsAttention = [...plan.attention];
  if (visaResolution?.categoryMismatch) needsAttention.push(`The GHL pipeline and the visa (${plan.fields.visaType}) disagree on Immigrant vs Non-Immigrant.`);

  const { user, created, setupToken } = await getOrCreatePetitioner({ email, name: petitionerName, phone: contact.phone, existing: match?.user });

  let caseDoc;
  try {
    const teamLead = await caseService.resolveTeamLeadForCase({});
    const slaDueDates = await workflowSlaService.computeInitialSlaDueDates().catch(() => undefined);
    const caseNumber = await CaseNumberService.nextPrincipalCaseNumber();
    const now = new Date();

    [caseDoc] = await Case.create([
      {
        _id: caseObjectId,
        isDemoData: false,
        caseNumber,
        caseId: caseNumber,
        caseType: "immigration",
        visaType: plan.fields.visaType,
        visaCategory: "Family", // what createFamilyCase uses
        petitionType: plan.fields.visaType,
        petitionSubType: plan.fields.petitionSubType || "",
        visaSelectionStatus: "selected",
        // In the family model clientName / clientEmail / user belong to the BENEFICIARY, who is not identified
        // yet, so they stay empty. The petitioner is the GHL contact and is held in petitionerName / petitionerUser.
        clientName: "",
        clientEmail: "",
        petitionerName,
        petitionerUser: user._id,
        beneficiaryInvite: { email: "", name: "", phone: "", status: "" },
        // "": neither chosen yet. The petitioner picks "I'll fill it" or "invite" from their own dashboard.
        familyCompletionMode: "",
        familyWorkflow: { petitionerStatus: "in_progress", beneficiaryStatus: "not_invited", caseManagerStatus: "waiting_for_petitioner" },
        creationSource: "ghl",
        status: "pending_assignment",
        assignedTeamLead: teamLead?._id,
        teamId: teamLead?.teamId,
        assignedAgent: "Team Lead Queue",
        slaDueDates,
        legacySource: "Immiglance",
        integrations: {
          ghl: {
            locationId,
            opportunityId: opportunity.id,
            contactId: opportunity.contactId || contact.id || undefined, // the petitioner
            pipelineId: opportunity.pipelineId,
            pipelineStageId: opportunity.pipelineStageId,
            sourcePipelineId: opportunity.pipelineId,
            sourceStageId: opportunity.pipelineStageId,
            unifiedStageKey: mapping?.unifiedStageKey,
            category,
            opportunityStatus: opportunity.status,
            role: "family",
            visaResolution: { ...plan.record, status: "applied" },
            origin,
            flags: { deletedInGhl: false, needsAttention: needsAttention.length > 0 },
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

    user.primaryCaseId = user.primaryCaseId || caseDoc._id;
    user.caseIds = [...new Set([...(user.caseIds || []), caseDoc._id].map(String))];
    await user.save();

    caseService.addTimelineEvent(caseDoc, "case", `Created from GHL, ${origin === "initial_sync" ? "Initial Sync" : origin === "webhook" ? "OpportunityCreate webhook" : origin}`, `Family case for petitioner ${email}; beneficiary not identified yet`, null, {
      origin,
      ghlOpportunityId: opportunity.id,
      ghlPipelineId: opportunity.pipelineId,
      petitionerEmail: email,
      needsAttention,
    });
    caseService.addAuditEntry(caseDoc, "create", "Family case created from GHL", null, { origin, ghlOpportunityId: opportunity.id, caseNumber });
    await caseDoc.save();
  } catch (error) {
    // Undo the account only if THIS call created it, so a retry starts clean.
    if (created) await User.deleteOne({ _id: user._id }).catch(() => {});
    throw error;
  }

  if (sendNotifications) {
    await require("./ghlCaseFactory")
      .notifyGhlCaseCreated(caseDoc, { clientUser: user, setupToken, email, name: petitionerName })
      .catch((error) => logger.error("ghl_family_notifications_failed", { caseId: String(caseDoc._id), error: error.message }));
  }
  emitCreated(caseDoc);
  visaService.scheduleFamilyProvisioning(caseDoc._id); // background, throttled
  return { case: caseDoc, created: true, needsAttention, family: { petitionerUserId: user._id, petitionerCreated: created } };
}

module.exports = { intakeFamilyOpportunity, findPetitionerMatch, getOrCreatePetitioner };
