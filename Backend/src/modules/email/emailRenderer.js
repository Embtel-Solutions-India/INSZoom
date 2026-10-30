// The ONE place an email's final HTML is produced. email.service.js's
// built-in templates (wrapHtml) and admin-customized templates both go
// through layoutHtml(), and the Email Template Customization page's live
// preview/test-send call renderCustom() - the same function the real send
// path uses - so what an admin previews is exactly what recipients get.
const { substitute, escapeHtml } = require("./emailVariables.registry");
const { portalUrl } = require("./portalUrls");
const layout = require("./emailLayoutV2");

// Every email that goes to internal staff (case manager, team lead, admin, super admin) ends with a button to the Admin
// login page. Skipped when the email already links to that page (e.g. the staff-credentials email).
function adminLoginUrl() {
  return `${portalUrl("admin")}/login`;
}

function adminLoginBlock(existingHtml = "") {
  const url = adminLoginUrl();
  if (String(existingHtml).includes(url)) return "";
  return `<div style="margin:8px 0 16px;"><a href="${url}" style="display:inline-block;padding:12px 24px;background:#1e3a5f;color:#ffffff;border-radius:8px;text-decoration:none;font-weight:700;">Log in to Admin</a></div>`;
}

function adminLoginText(existingText = "") {
  const url = adminLoginUrl();
  return String(existingText).includes(url) ? "" : `Log in to Admin: ${url}`;
}

// Every call-to-action button (any anchor styled display:inline-block, in built-in or admin-written bodies) gets the one button look:
// the logo blue, squared-off corners and an arrow. A deliberately different colour (e.g. the red RFE button) is kept.
const BUTTON_ANCHOR = /<a\b([^>]*?)style="([^"]*display:inline-block[^"]*)"([^>]*)>([\s\S]*?)<\/a>/gi;
const OLD_BUTTON_BLUES = new Set(["#1e3a5f", "#1e40af", "#0f2a5c"]);
function restyleButtons(html) {
  return String(html || "").replace(BUTTON_ANCHOR, (_m, before, style, after, label) => {
    const bg = (/background:\s*(#[0-9a-f]{3,8})/i.exec(style) || [])[1];
    const color = !bg || OLD_BUTTON_BLUES.has(bg.toLowerCase()) ? layout.BRAND : bg;
    const arrow = /&rarr;|→/.test(label) ? "" : " &rarr;";
    return `<a${before}style="display:inline-block;padding:14px 26px;background:${color};color:#ffffff;border-radius:6px;text-decoration:none;font-weight:600;font-size:15px;font-family:${layout.FONT};"${after}>${label}${arrow}</a>`;
  });
}

// One button per email: the first call-to-action stays and any further button (e.g. the extra "Log in to Admin" button on a staff email
// whose own button already opens the login page) is deleted, together with the paragraph/div that only held it.
const ANCHOR = String.raw`<a\b[^>]*display:inline-block[^>]*>[\s\S]*?<\/a>`;
const BUTTON_OR_WRAPPED = new RegExp(String.raw`(?:<p\b[^>]*>|<div style="margin:8px 0 16px;">)\s*(${ANCHOR})\s*(?:<\/p>|<\/div>)|(${ANCHOR})`, "gi");
function keepOneButton(html, text) {
  let seen = 0;
  let removedAdmin = false;
  const nextHtml = String(html || "").replace(BUTTON_OR_WRAPPED, (match, wrapped, bare) => {
    seen += 1;
    if (seen === 1) return match;
    if (/Log in to Admin/i.test(wrapped || bare)) removedAdmin = true;
    return "";
  });
  const nextText = removedAdmin && typeof text === "string" ? text.replace(/\n*Log in to Admin: \S+/i, "") : text;
  return { html: nextHtml, text: nextText };
}

// Boxes written inside template bodies - the green case-details box (label / value paragraphs) and the task details box (label / value
// table rows) - are re-drawn as the grey details strip: same words, one row of columns. A box that does not parse is left untouched.
const textOf = (html) => String(html || "").replace(/<[^>]+>/g, "").trim();
function stripFromPairs(pairs) {
  const items = pairs.filter(([label, value]) => textOf(label) && textOf(value)).map(([label, value]) => ({ label: textOf(label), value: value.trim(), full: textOf(label) === "Details" }));
  return items.length ? layout.detailsStrip(items) : null;
}
// A paragraph made only of bold "Label: value" lines (Case / Case Type / Client, Reason, Details ...) is shown in the same grey panel.
// Short facts sit side by side; long text (reasons, messages, notes, lists) takes a full row.
const LABEL_LINE = /<strong>([^<]{1,60}?):<\/strong>\s*(?:<br\s*\/?>)?\s*/gi;
const LONG_LABEL = /^(details|message|reason|note|first comment|required documents|portal)/i;
function labelParagraphToStrip(content) {
  const marks = [...content.matchAll(LABEL_LINE)];
  if (!marks.length || marks[0].index !== 0) return null;
  const items = marks.map((mark, k) => {
    const end = k + 1 < marks.length ? marks[k + 1].index : content.length;
    const value = content.slice(mark.index + mark[0].length, end).replace(/(<br\s*\/?>\s*)+$/i, "").trim();
    return { label: mark[1].trim(), value, full: LONG_LABEL.test(mark[1].trim()) || textOf(value).length > 50 };
  }).filter((item) => textOf(item.value));
  return items.length === marks.length ? layout.detailsStrip(items) : null;
}

function squareBoxes(html) {
  return html
    .replace(/<p\b[^>]*>([\s\S]*?)<\/p>/gi, (paragraph, content) => labelParagraphToStrip(content.trim()) || paragraph)
    .replace(/<table\b[^>]*background:#f0fdf4[^>]*>[\s\S]*?<\/table>/gi, (box) => {
      const paragraphs = [...box.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)].map((m) => m[1]);
      const pairs = [];
      for (let k = 0; k + 1 < paragraphs.length; k += 2) pairs.push([paragraphs[k], paragraphs[k + 1]]);
      return stripFromPairs(pairs) || box;
    })
    .replace(/<table\b[^>]*background:#f8fafc[^>]*>[\s\S]*?<\/table>/gi, (box) => {
      const pairs = [...box.matchAll(/<tr>\s*<td\b[^>]*>([\s\S]*?)<\/td>\s*<td\b[^>]*>([\s\S]*?)<\/td>\s*<\/tr>/gi)].map((m) => [m[1], m[2]]);
      return stripFromPairs(pairs) || box;
    })
    .replace(/border-radius:10px/g, "border-radius:6px");
}

function layoutHtml({ title, heading, innerHtml, adminLogin = false }) {
  if (adminLogin) innerHtml = `${innerHtml}${adminLoginBlock(innerHtml)}`;
  return layout.cardLayout({ title, heading, innerHtml: `<div style="font-family:${layout.FONT};">${squareBoxes(restyleButtons(innerHtml)).replace(/color:#374151/g, `color:${layout.BODY}`)}</div>` });
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
function renderCustom(template, ctx = {}, { mode = "live", highlightUnknown = false, adminLogin = false } = {}) {
  const subject = substitute(template.subject, ctx, { mode, escape: false });
  const heading = template.heading ? substitute(template.heading, ctx, { mode, escape: true, highlightUnknown }) : "";
  const bodyHtml = substitute(sanitizeEmailHtml(template.body), ctx, { mode, escape: true, highlightUnknown });
  const innerHtml = wrapBody(bodyHtml);
  const html = layoutHtml({ title: escapeHtml(subject), heading, innerHtml, adminLogin });
  const bodyText = htmlToText(bodyHtml);
  const text = [heading && htmlToText(heading), bodyText, adminLogin && adminLoginText(bodyText)].filter(Boolean).join("\n\n");
  return { subject, heading, html, text };
}

module.exports = { keepOneButton, previewShells, layoutHtml, sanitizeEmailHtml, htmlToText, renderCustom, adminLoginUrl, adminLoginText };
