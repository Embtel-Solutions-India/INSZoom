// The ONE place an email's final HTML is produced. email.service.js's
// built-in templates (wrapHtml) and admin-customized templates both go
// through layoutHtml(), and the Email Template Customization page's live
// preview/test-send call renderCustom() - the same function the real send
// path uses - so what an admin previews is exactly what recipients get.
const { substitute, escapeHtml } = require("./emailVariables.registry");

function layoutHtml({ title, heading, innerHtml }) {
  const year = new Date().getFullYear();
  const headingHtml = heading
    ? `<h1 style="margin:0 0 24px;font-size:22px;font-weight:700;color:#111827;line-height:1.3;">${heading}</h1>
            `
    : "";
  return `<!doctype html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:40px 16px;">
    <tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.06);">
        <tr>
          <td style="background:#1e3a5f;padding:28px 36px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td>
                  <span style="color:#ffffff;font-size:20px;font-weight:700;letter-spacing:-0.5px;">Immiglance</span>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding:36px 36px 28px;">
            ${headingHtml}${innerHtml}
          </td>
        </tr>
        <tr><td style="padding:0 36px;"><div style="height:1px;background:#e5e7eb;"></div></td></tr>
        <tr>
          <td style="padding:20px 36px 28px;">
            <p style="margin:0;color:#9ca3af;font-size:12px;line-height:1.6;">
              This is an automated message from <strong>Immiglance</strong>. Please do not reply to this email.<br>
              &copy; ${year} Immiglance. All rights reserved.
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

const wrapBody = (bodyHtml) => `<div style="margin:0 0 16px;color:#374151;font-size:15px;line-height:1.7;">${bodyHtml}</div>`;

// The same layout, with placeholders, so the admin page can render its live
// preview instantly in the browser without a server round trip while still
// using THIS file's markup (it never keeps its own copy of the layout).
const SHELL_TOKENS = { title: "{{@TITLE}}", heading: "{{@HEADING}}", body: "{{@BODY}}" };
function previewShells() {
  const build = (heading) => layoutHtml({ title: SHELL_TOKENS.title, heading, innerHtml: wrapBody(SHELL_TOKENS.body) });
  return { tokens: SHELL_TOKENS, withHeading: build(SHELL_TOKENS.heading), withoutHeading: build("") };
}

// Bodies are authored by admins in a rich-text editor, but they end up in
// recipients' inboxes - strip anything executable regardless of who wrote it.
function sanitizeEmailHtml(html) {
  return String(html || "")
    .replace(/<\s*(script|style|iframe|object|embed|link|meta|form)\b[\s\S]*?<\s*\/\s*\1\s*>/gi, "")
    .replace(/<\s*(script|style|iframe|object|embed|link|meta|form)\b[^>]*\/?>/gi, "")
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/(href|src)\s*=\s*("|')\s*javascript:[^"']*\2/gi, '$1="#"');
}

function htmlToText(html) {
  return String(html || "")
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, "\n")
    .replace(/<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, "$2 ($1)")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * @param {{subject:string, heading?:string, body:string}} template
 * @param {{data?:object, caseContext?:object}} ctx   live context (ignored in sample mode)
 * @param {{mode?:"live"|"sample"}} options
 * @returns {{subject:string, heading:string, html:string, text:string}}
 */
function renderCustom(template, ctx = {}, { mode = "live", highlightUnknown = false } = {}) {
  const subject = substitute(template.subject, ctx, { mode, escape: false });
  const heading = template.heading ? substitute(template.heading, ctx, { mode, escape: true, highlightUnknown }) : "";
  const bodyHtml = substitute(sanitizeEmailHtml(template.body), ctx, { mode, escape: true, highlightUnknown });
  const innerHtml = wrapBody(bodyHtml);
  const html = layoutHtml({ title: escapeHtml(subject), heading, innerHtml });
  const text = [heading && htmlToText(heading), htmlToText(bodyHtml)].filter(Boolean).join("\n\n");
  return { subject, heading, html, text };
}

module.exports = { previewShells, layoutHtml, sanitizeEmailHtml, htmlToText, renderCustom };
