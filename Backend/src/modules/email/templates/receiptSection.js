// The USCIS receipt block of the "case submitted online" e-mail. Shown only when a valid receipt number is on file (data.receiptNumber); otherwise the section is simply left out.
const RECEIPT_NUMBER = /^[A-Z]{3}\d{10}$/;
const clean = (value) => String(value ?? "").replace(/[\s-]+/g, "").toUpperCase();
const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));

/** The receipt number when it is a valid one (three letters + ten digits), else "". */
const validReceipt = (data = {}) => (RECEIPT_NUMBER.test(clean(data.receiptNumber)) ? clean(data.receiptNumber) : "");

/** The lines of the receipt block, or [] when there is no valid receipt number (the section is then hidden). */
function receiptLines(data = {}) {
  const number = validReceipt(data);
  if (!number) return [];
  return [
    "USCIS has issued a receipt number for your filing. Your USCIS receipt number is:",
    `<span style="display:block;margin:4px 0;padding:14px 18px;background:#f3f4f6;border:1px solid #e5e7eb;border-radius:8px;font-size:20px;font-weight:bold;letter-spacing:1px;color:#1f2937;">${escapeHtml(number)}</span>`,
    "Keep this number safe: you can use it to check your case status on the USCIS website.",
  ];
}

module.exports = { receiptLines, validReceipt };
