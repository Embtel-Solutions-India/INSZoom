function subject(data = {}) { return `Your case has been filed with USCIS — Case ${data.caseNumber || ""}`; }
function bodyLines(data = {}) {
  return [
    `Hi ${data.clientName || "there"},`,
    `Great news — your immigration case has been officially submitted to USCIS.`,
    `<table role="presentation" cellpadding="0" cellspacing="0" style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:16px 20px;margin:0 0 16px;width:100%;">
      <tr><td>
        <p style="margin:0 0 4px;color:#6b7280;font-size:13px;">Case ID</p><p style="margin:0 0 8px;font-weight:700;color:#065f46;">${data.caseNumber || ""}</p>
        <p style="margin:0 0 4px;color:#6b7280;font-size:13px;">Filing Date</p><p style="margin:0 0 8px;font-weight:700;color:#065f46;">${data.filingDate || ""}</p>
        ${data.filingType ? `<p style="margin:0 0 4px;color:#6b7280;font-size:13px;">Filing Type</p><p style="margin:0;font-weight:700;color:#065f46;">${data.filingType}</p>` : ""}
      </td></tr>
    </table>`,
    `USCIS will send a receipt notice (Form I-797) to your address of record. Processing times vary — your case manager will notify you as soon as any updates arrive.`,
    `You can track your case status at any time in the portal.`,
    `<a href="${data.portalLink || "#"}" style="display:inline-block;padding:12px 24px;background:#0f766e;color:#fff;border-radius:8px;text-decoration:none;font-weight:700;">Track My Case</a>`,
  ];
}
module.exports = { key: "filing-submitted", subject, bodyLines };
