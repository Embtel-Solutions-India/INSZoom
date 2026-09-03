function subject(data = {}) {
  return `Your immigration case has been created${data.caseNumber ? ` — ${data.caseNumber}` : ""}`;
}

function bodyLines(data = {}) {
  return [
    `Hi ${data.clientName || "there"},`,
    `We're writing to confirm that your immigration case has been successfully created with our team.`,
    `<table role="presentation" cellpadding="0" cellspacing="0" style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:16px 20px;margin:0 0 16px;width:100%;">
      <tr><td>
        <p style="margin:0 0 6px;font-size:13px;color:#6b7280;font-weight:500;text-transform:uppercase;letter-spacing:0.5px;">Your Case ID</p>
        <p style="margin:0;font-size:22px;font-weight:800;color:#065f46;letter-spacing:1px;">${data.caseNumber || ""}</p>
      </td></tr>
    </table>`,
    `Please keep your Case ID safe — you will use it to log in to the BAIS portal and to reference your case in any communication with our team.`,
    `<strong>What happens next?</strong> You will receive a separate email shortly with a link to activate your portal account. Once activated, you can track your case progress, upload documents, and message your case manager directly.`,
    `If you have any questions, reply to your case manager directly or contact us at support@baisimmigration.com.`,
  ];
}

module.exports = { key: "case-created-client", subject, bodyLines };
