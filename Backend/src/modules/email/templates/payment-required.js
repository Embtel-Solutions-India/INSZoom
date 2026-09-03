function subject(data = {}) { return `Payment required for your immigration case — Case ${data.caseNumber || ""}`; }
function bodyLines(data = {}) {
  return [
    `Hi ${data.clientName || "there"},`,
    `A payment is required to continue with your immigration case.`,
    data.amount ? `<p style="font-size:28px;font-weight:800;color:#0f766e;margin:0 0 16px;">${data.amount}</p>` : null,
    data.dueDate ? `<strong>Due date: ${data.dueDate}</strong>` : null,
    `<a href="${data.paymentLink || data.portalLink || "#"}" style="display:inline-block;padding:12px 24px;background:#0f766e;color:#fff;border-radius:8px;text-decoration:none;font-weight:700;">Make Payment</a>`,
  ].filter(Boolean);
}
module.exports = { key: "payment-required", subject, bodyLines };
