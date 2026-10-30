// Redesigned email shell (proposal, not wired into live sends yet): white top bar with the Immiglance logo + name, a small label on the
// right, a squared card with only slightly rounded corners, and building blocks for the two body styles - a details strip and a timeline.
// The logo is the app's logo.png as served by the Admin site (same mark as the favicon). It is loaded from that address rather than attached,
// so it shows in every mail app and in a browser view (an attached cid: image does not show everywhere).
const { portalUrl } = require("./portalUrls");

const logoUrl = () => `${portalUrl("admin")}/logo.png`;

// Colours follow the website (Client index.css): primary blue for brand, headings and buttons; softer slate for text; its muted grey for labels.
const BRAND = "#1a4589"; // website primary = the logo blue: button, current step
const NAVY = "#12284f"; // headings and the name (dark navy)
const BODY = "#374151"; // paragraph text
const VALUE = "#111827"; // values and step titles
const MUTED = "#6b7280"; // labels
const FAINT = "#9ca3af"; // footer
const LINE = "#e5e7eb"; // dividers and borders
const FONT = "'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

function button(label, url, { color = BRAND } = {}) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 24px;"><tr><td style="background:${color};border-radius:6px;"><a href="${url}" style="display:inline-block;padding:14px 26px;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;font-family:${FONT};">${label} &rarr;</a></td></tr></table>`;
}

const paragraph = (html) => `<p style="margin:0 0 16px;color:${BODY};font-size:15px;line-height:1.7;font-family:${FONT};">${html}</p>`;

// Light grey-blue panel of "label / value" columns in one row (Case ID, Case type, Status ...). More than `perRow` items wrap onto further
// rows; an item with `full: true` (long text such as a description) takes a whole row. A value may be raw HTML.
function detailsStrip(items, { perRow = 3 } = {}) {
  const rows = [];
  let current = [];
  for (const item of items) {
    if (item.full) { if (current.length) rows.push(current); rows.push([item]); current = []; continue; }
    current.push(item);
    if (current.length === perRow) { rows.push(current); current = []; }
  }
  if (current.length) rows.push(current);
  const html = rows.map((row, r) => `<tr>${row.map((item, index) => `<td valign="top" width="${Math.floor(100 / row.length)}%" style="padding:14px 16px;${index ? "border-left:1px solid #dbe4f0;" : ""}${r ? "border-top:1px solid #dbe4f0;" : ""}">
      <div style="font-size:12px;color:${MUTED};margin:0 0 4px;font-family:${FONT};">${item.label}</div>
      <div style="font-size:15px;font-weight:600;color:${VALUE};line-height:1.5;font-family:${FONT};">${item.value}</div></td>`).join("")}</tr>`).join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef3fa;border:1px solid #dbe4f0;border-radius:6px;margin:0 0 24px;">${html}</table>`;
}

// Status tag: a coloured dot followed by the text (no filled background). dot: green "#16a34a", amber "#f59e0b", red "#dc2626" ...
const pill = (text, { dot = "#16a34a" } = {}) => `<span style="font-size:14px;font-weight:600;color:${VALUE};font-family:${FONT};white-space:nowrap;"><span style="display:inline-block;width:9px;height:9px;border-radius:5px;background:${dot};margin-right:7px;"></span>${text}</span>`;

// Vertical timeline. state: "done" (green), "current" (navy), "pending" (light blue).
const DOT = { done: { bg: "#0f9d8a", mark: "&#10003;" }, current: { bg: BRAND, mark: "&#9679;" }, pending: { bg: "#b9cbe6", mark: "&#9675;" } };
function timeline(steps) {
  const rows = steps.map((step, index) => {
    const dot = DOT[step.state] || DOT.pending;
    const last = index === steps.length - 1;
    return `<tr>
      <td width="44" valign="top" align="center" style="padding:0;">
        <table role="presentation" cellpadding="0" cellspacing="0"><tr><td width="32" height="32" align="center" valign="middle" style="width:32px;height:32px;border-radius:16px;background:${dot.bg};color:#ffffff;font-size:15px;font-weight:700;line-height:32px;font-family:Arial,sans-serif;">${dot.mark}</td></tr></table>
        ${last ? "" : `<table role="presentation" cellpadding="0" cellspacing="0"><tr><td width="2" height="52" style="width:2px;height:52px;background:#d5deec;font-size:0;line-height:0;">&nbsp;</td></tr></table>`}
      </td>
      <td valign="top" style="padding:0 0 ${last ? 0 : 14}px 8px;">
        <div style="font-size:16px;font-weight:600;color:${VALUE};margin:0 0 3px;font-family:${FONT};">${step.title}</div>
        <div style="font-size:14px;color:${BODY};line-height:1.5;margin:0 0 3px;font-family:${FONT};">${step.text}</div>
        ${step.meta ? `<div style="font-size:13px;color:${MUTED};font-family:${FONT};">${step.meta}</div>` : ""}
      </td></tr>`;
  }).join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;">${rows}</table>`;
}

// headerAlign: "left" (logo + name on the left, label on the right) or "center" (logo + name in the middle).
// headingCss: optional replacement for the heading text style (used to try out looks without touching the live emails).
function cardLayout({ title, label = "", heading = "", innerHtml, headerAlign = "left", headingCss = "" }) {
  const centered = headerAlign === "center";
  const year = new Date().getFullYear();
  return `<!doctype html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head>
<body style="margin:0;padding:0;background:#f3f6fb;font-family:${FONT};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f6fb;padding:32px 12px;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border:1px solid #e3e9f2;border-radius:6px;">
        <tr>
          <td style="padding:24px 36px 20px;background:#ffffff;border-radius:6px 6px 0 0;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
              <td valign="middle" ${centered ? 'align="center"' : ""}><table role="presentation" cellpadding="0" cellspacing="0"><tr>
                <td valign="middle" style="padding-right:10px;"><img src="${logoUrl()}" width="32" height="32" alt="" style="display:block;border:0;"></td>
                <td valign="middle" style="font-size:22px;font-weight:700;color:${NAVY};font-family:${FONT};">Immiglance</td>
              </tr></table></td>
              ${centered ? "" : `<td valign="middle" align="right" style="font-size:12px;color:${NAVY};font-family:${FONT};">${label}</td>`}
            </tr></table>
          </td>
        </tr>
        <tr><td style="padding:0 36px;"><div style="height:1px;background:${LINE};"></div></td></tr>
        <tr>
          <td style="padding:28px 36px 8px;">
            ${heading ? `<h1 style="margin:0 0 20px;${headingCss || `font-size:26px;font-weight:700;color:${NAVY};line-height:1.3;font-family:${FONT};`}">${heading}</h1>` : ""}
            ${innerHtml}
          </td>
        </tr>
        <tr><td style="padding:0 36px;"><div style="height:1px;background:${LINE};"></div></td></tr>
        <tr>
          <td style="padding:18px 36px 26px;">
            <p style="margin:0;color:${FAINT};font-size:12px;line-height:1.6;font-family:${FONT};">This is an automated message from Immiglance. Please do not reply to this email.<br>&copy; ${year} Immiglance. All rights reserved.</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

module.exports = { BRAND, NAVY, BODY, FONT, cardLayout, button, paragraph, detailsStrip, pill, timeline, logoUrl };
