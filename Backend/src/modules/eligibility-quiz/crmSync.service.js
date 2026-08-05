const Settings = require("../../models/Settings");
const auditService = require("../audit/audit.service");

const MAX_ATTEMPTS = 3;
const BACKOFF_BASE_MS = 500;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildPayload(lead) {
  return {
    leadId: String(lead._id),
    fullName: lead.fullName,
    email: lead.email,
    phone: lead.phone,
    visaPathway: lead.visaPathway,
    source: lead.source,
    utm: lead.utm,
    profileAnswers: lead.profileAnswers,
    criteriaAnswers: lead.criteriaAnswers,
    scoreResult: lead.scoreResult,
    createdAt: lead.createdAt,
  };
}

async function postOnce(url, apiKey, payload) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`CRM webhook responded ${response.status}`);
    return response;
  } finally {
    clearTimeout(timeout);
  }
}

// Fire-and-forget from the caller's perspective (never awaited inline with
// the lead-creation response — the PRD requires submit() to stay fast).
// Skips cleanly (never fails the lead) when no webhook is configured; the
// webhook URL/key are founder-provided (Phase 1 Section 12) until then.
async function syncLead(lead, req) {
  const settings = await Settings.findOne({ key: "global" }).select("crmWebhookUrl +crmApiKey");
  const webhookUrl = settings?.crmWebhookUrl;
  if (!webhookUrl) {
    lead.crmSyncStatus = "skipped";
    await lead.save();
    return { status: "skipped" };
  }

  const payload = buildPayload(lead);
  let lastError;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    lead.crmSyncAttempts = attempt;
    try {
      await postOnce(webhookUrl, settings.crmApiKey, payload);
      lead.crmSyncStatus = "synced";
      lead.crmSyncedAt = new Date();
      lead.crmSyncError = "";
      await lead.save();
      await auditService.recordAuditEvent({
        req,
        action: "crm_sync.success",
        entityType: "Lead",
        entityId: String(lead._id),
        severity: "low",
        source: "system",
        metadata: { attempt },
      });
      return { status: "synced", attempt };
    } catch (error) {
      lastError = error;
      if (attempt < MAX_ATTEMPTS) await wait(BACKOFF_BASE_MS * 2 ** (attempt - 1));
    }
  }

  lead.crmSyncStatus = "failed";
  lead.crmSyncError = lastError?.message || "Unknown CRM sync error";
  await lead.save();
  await auditService.recordAuditEvent({
    req,
    action: "crm_sync.failed",
    entityType: "Lead",
    entityId: String(lead._id),
    severity: "medium",
    status: "failure",
    source: "system",
    details: lastError?.message,
    metadata: { attempts: MAX_ATTEMPTS },
  });
  return { status: "failed", error: lastError?.message };
}

module.exports = { syncLead, buildPayload };
