function subject(data = {}) { return `IMPORTANT: interview scheduled — Case ${data.caseNumber || ""}`; }
function bodyLines(data = {}) {
  return [
    `Hi ${data.clientName || "there"},`,
    `An interview has been scheduled for your immigration case.`,
    `<table role="presentation" cellpadding="0" cellspacing="0" style="background:#fefce8;border:1px solid #fde68a;border-radius:10px;padding:16px 20px;margin:0 0 16px;width:100%;">
      <tr><td>
        ${data.interviewDate ? `<p style="margin:0 0 4px;color:#6b7280;font-size:13px;">Date &amp; Time</p><p style="margin:0 0 8px;font-weight:700;font-size:16px;color:#92400e;">${data.interviewDate}</p>` : ""}
        ${data.interviewLocation ? `<p style="margin:0 0 4px;color:#6b7280;font-size:13px;">Location</p><p style="margin:0;font-weight:700;color:#92400e;">${data.interviewLocation}</p>` : ""}
      </td></tr>
    </table>`,
    `Your case manager will contact you to help you prepare. Please log in to the portal for full details and any additional instructions.`,
    `<a href="${data.portalLink || "#"}" style="display:inline-block;padding:12px 24px;background:#0f766e;color:#fff;border-radius:8px;text-decoration:none;font-weight:700;">View Details</a>`,
  ];
}
module.exports = { key: "interview-scheduled", subject, bodyLines };
