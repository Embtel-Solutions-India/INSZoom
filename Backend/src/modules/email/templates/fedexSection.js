// The FedEx block shared by the "case submitted" e-mail (shown only when a tracking number is already on file) and the separate "FedEx tracking number" e-mail
// (sent when the team adds the number after the submitted e-mail went out). One wording, one place.
const cleanNumber = (value) => String(value ?? "").replace(/[\s-]+/g, "");
const groupedNumber = (value) => {
  const clean = cleanNumber(value);
  return /^\d{12,22}$/.test(clean) ? clean.replace(/(\d{4})(?=\d)/g, "$1 ") : clean;
};
const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));

const trackingUrl = (value) => {
  const clean = cleanNumber(value);
  return /^[A-Za-z0-9]{8,34}$/.test(clean) ? `https://www.fedex.com/fedextrack/?trknbr=${encodeURIComponent(clean)}` : "";
};

/** The tracking number in a grey box (HTML), or "" when there is no valid number. Used inside a timeline step. */
function fedexNumberBox(data = {}) {
  if (!trackingUrl(data.trackingNumber)) return "";
  return `<span style="display:block;margin:8px 0 0;padding:12px 16px;background:#f3f4f6;border:1px solid #e5e7eb;border-radius:8px;font-size:19px;font-weight:bold;letter-spacing:1px;color:#1f2937;">${escapeHtml(groupedNumber(data.trackingNumber))}</span>`;
}

/**
 * The lines of the FedEx block, or [] when there is no valid number (the section is then simply left out).
 * The number sits in a grey box; the blue button opens the client portal (data.portalLink, which the mail service turns into the sign-in page), where the FedEx
 * tracking area on the dashboard shows the shipment.
 */
function fedexLines(data = {}) {
  if (!trackingUrl(data.trackingNumber)) return [];
  return [
    "Your petition has been shipped by FedEx. Your FedEx tracking number is:",
    `<span style="display:block;margin:4px 0;padding:14px 18px;background:#f3f4f6;border:1px solid #e5e7eb;border-radius:8px;font-size:20px;font-weight:bold;letter-spacing:1px;color:#1f2937;">${escapeHtml(groupedNumber(data.trackingNumber))}</span>`,
    `<a href="${data.portalLink || "#"}" style="display:inline-block;padding:12px 24px;background:#1A4589;color:#ffffff;border-radius:8px;text-decoration:none;font-weight:bold;">Track My FedEx Shipment</a>`,
    "Sign in to your client portal: on your dashboard there is a FedEx tracking area where you can check the status of your shipment at any time.",
  ];
}

module.exports = { fedexLines, fedexNumberBox, trackingUrl, groupedNumber };
