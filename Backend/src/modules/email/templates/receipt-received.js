function subject(data = {}) { return `USCIS receipt notice received — Case ${data.caseNumber || ""}`; }
function bodyLines(data = {}) {
  return [
    `Hi ${data.clientName || "there"},`,
    `USCIS has sent a receipt notice for your case. This confirms that USCIS has received your petition and is processing it.`,
    `<table role="presentation" cellpadding="0" cellspacing="0" style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:16px 20px;margin:0 0 16px;width:100%;">
      <tr><td>
        ${data.receiptNumber ? `<p style="margin:0 0 4px;color:#6b7280;font-size:13px;">USCIS Receipt Number</p><p style="margin:0 0 8px;font-size:18px;font-weight:800;color:#065f46;letter-spacing:1px;">${data.receiptNumber}</p>` : ""}
        ${data.receiptDate ? `<p style="margin:0 0 4px;color:#6b7280;font-size:13px;">Receipt Date</p><p style="margin:0;font-weight:700;color:#065f46;">${data.receiptDate}</p>` : ""}
      </td></tr>
    </table>`,
    `You can use your USCIS receipt number to check your case status at <a href="https://egov.uscis.gov/casestatus/landing.do" style="color:#0f766e;">egov.uscis.gov</a>.`,
  ];
}
module.exports = { key: "receipt-received", subject, bodyLines };
