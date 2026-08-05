const DisclaimerAcceptance = require("../../models/DisclaimerAcceptance");
const entityConfigService = require("../entity-config/entityConfig.service");
const auditService = require("../audit/audit.service");

async function getActiveDisclaimer() {
  return entityConfigService.resolveDisclaimer();
}

async function recordAcceptance({ userId, sessionId, context, version, req }) {
  const active = await getActiveDisclaimer();
  const acceptance = await DisclaimerAcceptance.create({
    userId: userId || null,
    sessionId: sessionId || "",
    disclaimerVersion: version || active.version,
    context,
    ipAddress: req?.ip,
    userAgent: req?.get?.("user-agent"),
  });

  await auditService.recordAuditEvent({
    req,
    action: "disclaimer.accept",
    entityType: "DisclaimerAcceptance",
    entityId: String(acceptance._id),
    details: `Disclaimer v${acceptance.disclaimerVersion} accepted (${context})`,
    severity: "low",
    source: "api",
    metadata: { context, sessionId: sessionId || undefined },
  });

  return acceptance;
}

module.exports = { getActiveDisclaimer, recordAcceptance };
