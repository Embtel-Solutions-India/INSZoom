function subject(data = {}) { return `Important update on your case — Case ${data.caseNumber || ""}`; }
function bodyLines(data = {}) {
  return [
    `Hi ${data.clientName || "there"},`,
    `We regret to inform you that your immigration case has received an unfavorable decision from USCIS.`,
    `Your case manager will contact you as soon as possible to discuss the decision, your options, and the recommended next steps.`,
    `<a href="${data.portalLink || "#"}" style="display:inline-block;padding:12px 24px;background:#0f766e;color:#fff;border-radius:8px;text-decoration:none;font-weight:700;">View Details</a>`,
    `Please do not take any independent action until you have spoken with your case manager.`,
  ];
}
module.exports = { key: "case-denied", subject, bodyLines };
