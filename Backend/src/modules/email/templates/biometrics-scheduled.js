function subject(data = {}) { return `IMPORTANT: biometrics appointment scheduled — Case ${data.caseNumber || ""}`; }
function bodyLines(data = {}) {
  return [
    `Hi ${data.clientName || "there"},`,
    `A biometrics appointment has been scheduled for your immigration case. Biometrics (fingerprints, photograph, and signature) are required by USCIS as part of your application.`,
    `<table role="presentation" cellpadding="0" cellspacing="0" style="background:#fefce8;border:1px solid #fde68a;border-radius:10px;padding:16px 20px;margin:0 0 16px;width:100%;">
      <tr><td>
        ${data.appointmentDate ? `<p style="margin:0 0 4px;color:#6b7280;font-size:13px;">Date &amp; Time</p><p style="margin:0 0 8px;font-weight:700;font-size:16px;color:#92400e;">${data.appointmentDate}</p>` : ""}
        ${data.appointmentLocation ? `<p style="margin:0 0 4px;color:#6b7280;font-size:13px;">Location (ASC)</p><p style="margin:0;font-weight:700;color:#92400e;">${data.appointmentLocation}</p>` : ""}
      </td></tr>
    </table>`,
    `Please bring your appointment notice and a valid photo ID to the ASC. Contact your case manager if you need to reschedule.`,
    `<a href="${data.portalLink || "#"}" style="display:inline-block;padding:12px 24px;background:#0f766e;color:#fff;border-radius:8px;text-decoration:none;font-weight:700;">View Details</a>`,
  ];
}
module.exports = { key: "biometrics-scheduled", subject, bodyLines };
