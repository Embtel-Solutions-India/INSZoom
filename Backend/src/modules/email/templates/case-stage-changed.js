const STAGE_DESCRIPTIONS = {
  intake: "Intake — your case manager is gathering initial information.",
  strategy: "Strategy — your case manager is building the case strategy.",
  evidence: "Evidence Collection — please upload any requested documents as soon as possible.",
  expert_letters: "Expert Letters — your case is being supported with expert opinion letters.",
  case_manager_review: "Case Manager Review — your case manager is performing a final review.",
  filing: "Ready for Filing — your petition is being prepared for submission.",
  uscis_pending: "USCIS Pending — your petition has been filed and is awaiting a USCIS decision.",
  approved: "Approved — congratulations!",
  denied: "Denied — your case manager will contact you shortly.",
  closed: "Closed.",
};

function subject(data = {}) { return `Your case has moved to a new stage — Case ${data.caseNumber || ""}`; }
function bodyLines(data = {}) {
  return [
    `Hi ${data.clientName || "there"},`,
    `Your immigration case ${data.caseNumber || ""} has moved to a new stage: <strong>${data.stageName || data.stage || ""}</strong>`,
    STAGE_DESCRIPTIONS[data.stage] || `Please log in to the portal for more details.`,
    `<a href="${data.portalLink || "#"}" style="display:inline-block;padding:12px 24px;background:#0f766e;color:#fff;border-radius:8px;text-decoration:none;font-weight:700;">View My Case</a>`,
  ].filter(Boolean);
}
module.exports = { key: "case-stage-changed", subject, bodyLines };
