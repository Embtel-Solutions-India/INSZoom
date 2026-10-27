const { portalUrl } = require("../portalUrls");

// Sent ONCE per petition - when the client side gives the first feedback on it - to the case manager(s) and the team lead of the case. Later messages are not e-mailed; they appear in
// the Petition tab of the case (and in the notification bell).
function subject(data = {}) {
  return `Client feedback received on the petition — ${data.caseNumber || "your case"}`;
}

function bodyLines(data = {}) {
  const link = data.caseLink || `${portalUrl("admin")}/dashboard`;
  const preview = String(data.messagePreview || "").replace(/</g, "&lt;").replace(/\n/g, "<br/>");
  const lines = [
    `Hello ${data.recipientName || "there"},`,
    `${data.clientName || "The client"} has given feedback on the petition for case ${data.caseNumber || ""}.`,
    `<strong>Petition:</strong> ${data.petitionName || "—"}`,
  ];
  if (preview) lines.push(`<strong>First comment:</strong><br/>“${preview}”`);
  lines.push(
    "Open the case and select the Petition tab to read the feedback and reply. This is the first message on this petition - further messages are not e-mailed; you will see them in the Petition tab and in your notifications.",
    `<a href="${link}" style="display:inline-block;padding:12px 24px;background:#1e3a5f;color:#fff;border-radius:8px;text-decoration:none;font-weight:700;">Open the Case</a>`,
    "Regards,<br>The Immiglance Team"
  );
  return lines;
}

module.exports = { key: "petition-feedback-received", subject, bodyLines };
