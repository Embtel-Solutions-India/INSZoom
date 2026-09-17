const Case = require("../../models/Case");
const User = require("../../models/User");
const emailService = require("../email/email.service");
const auditService = require("../audit/audit.service");
const logger = require("../../utils/logger");

// Grant/revoke Attorney Portal access to a case. Called from the Case
// Manager / Admin side (Admin), never by an attorney.

function attorneyPortalUrl() {
  return process.env.ATTORNEY_PORTAL_URL || process.env.ATTORNEY_PORTAL_DEV_URL || "http://localhost:5174";
}

async function listAccess(caseId) {
  const caseDoc = await Case.findById(caseId)
    .select("attorneyAccess")
    .populate("attorneyAccess.attorneyId", "name displayName email role")
    .populate("attorneyAccess.assignedBy", "name displayName email")
    .lean();
  if (!caseDoc) {
    const error = new Error("Case not found");
    error.status = 404;
    throw error;
  }
  return caseDoc.attorneyAccess || [];
}

async function sendAssignmentEmail({ caseDoc, attorney, actor }) {
  return emailService
    .sendTemplateEmail("attorney-assignment", {
      to: attorney.email,
      data: {
        attorneyName: attorney.displayName || attorney.name,
        caseNumber: caseDoc.caseNumber || caseDoc.caseId || String(caseDoc._id),
        visaType: caseDoc.visaType || "—",
        clientName: caseDoc.clientName || "—",
        attorneyPortalUrl: attorneyPortalUrl(),
        assignedByName: actor?.displayName || actor?.name || "a case manager",
      },
      caseId: caseDoc._id,
      userId: attorney._id,
      triggeredBy: actor?._id,
      source: "shared",
    })
    // A mail-provider failure must never roll back a completed access
    // grant — the attorney already has access; they just didn't get the
    // heads-up email. Logged (and visible in EmailLog) instead.
    .catch((error) => {
      logger.error("attorney_assignment_email_failed", { error, caseId: String(caseDoc._id), attorneyId: String(attorney._id) });
      return { sent: false };
    });
}

async function setAccess({ caseId, attorneyId, action, actor, req }) {
  const caseDoc = await Case.findById(caseId).select("_id caseId caseNumber visaType clientName attorneyAccess");
  if (!caseDoc) {
    const error = new Error("Case not found");
    error.status = 404;
    throw error;
  }

  const attorney = await User.findById(attorneyId).select("_id name displayName email role isActive");
  if (!attorney || attorney.role !== "attorney") {
    const error = new Error("User is not an attorney");
    error.status = 400;
    throw error;
  }

  const existing = (caseDoc.attorneyAccess || []).find((grant) => String(grant.attorneyId) === String(attorneyId));

  if (action === "grant") {
    if (existing?.status === "active") {
      const error = new Error("Attorney already has active access to this case");
      error.status = 409;
      throw error;
    }
    if (existing) {
      // Re-granting a previously revoked attorney reuses the same entry
      // rather than stacking a second one for the same person.
      existing.status = "active";
      existing.assignedBy = actor._id;
      existing.assignedAt = new Date();
      existing.revokedAt = undefined;
    } else {
      caseDoc.attorneyAccess.push({ attorneyId: attorney._id, assignedBy: actor._id, status: "active" });
    }
  } else if (action === "revoke") {
    if (!existing || existing.status !== "active") {
      const error = new Error("Attorney does not have active access to this case");
      error.status = 409;
      throw error;
    }
    existing.status = "revoked";
    existing.revokedAt = new Date();
  } else {
    const error = new Error("action must be 'grant' or 'revoke'");
    error.status = 400;
    throw error;
  }

  await caseDoc.save();

  await auditService
    .recordAuditEvent({
      req,
      action: action === "grant" ? "attorney_access_granted" : "attorney_access_revoked",
      entityType: "case",
      entityId: caseDoc._id,
      details: `Attorney ${attorney.email} access ${action === "grant" ? "granted" : "revoked"}`,
      severity: "medium",
      metadata: { attorneyId: String(attorney._id), caseId: String(caseDoc._id) },
    })
    .catch((error) => logger.error("attorney_access_audit_failed", { error }));

  if (action === "grant") {
    await sendAssignmentEmail({ caseDoc, attorney, actor });
  }

  return listAccess(caseDoc._id);
}

module.exports = { listAccess, setAccess };
