function subject(data = {}) { return `Action required: payment could not be processed — Case ${data.caseNumber || ""}`; }
function bodyLines(data = {}) {
  return [
    `Hi ${data.clientName || "there"},`,
    `We were unable to process your payment${data.amount ? ` of ${data.amount}` : ""}. Please update your payment information to avoid delays to your case.`,
    `<a href="${data.paymentLink || data.portalLink || "#"}" style="display:inline-block;padding:12px 24px;background:#dc2626;color:#fff;border-radius:8px;text-decoration:none;font-weight:700;">Update Payment Method</a>`,
  ];
}
module.exports = { key: "payment-failed", subject, bodyLines };
