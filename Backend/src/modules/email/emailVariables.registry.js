// Single source of truth for the [group.name] merge variables available to
// customizable email templates. The editor's Insert Variable menu, the
// save-time validator, the live preview and the real send path all read from
// here - never hardcode a variable list anywhere else.
//
// Each variable declares:
//   key       "client.name"                    what the admin inserts as [client.name]
//   group     Client | Case | ...              menu grouping (also gates per-trigger availability)
//   dataKeys  call-site `data` fields it reads (the existing sendTemplateEmail callers
//             already pass these - nothing at a call site needs to change)
//   path      optional resolver over the case context loaded from caseId
//   sample    preview/test-email value
//   fallback  what to print when no live value can be resolved (never blank/broken)

const GROUPS = ["Client", "Case", "Case Manager", "Team Lead", "Attorney", "Company", "Document", "System"];

// email:true marks variables that resolve to an email address, so they can
// also be typed into the To/CC/BCC recipient fields (e.g. [client.email]).
const v = (key, group, label, sample, { dataKeys = [], path, fallback = "", advanced = false, email = false } = {}) =>
  ({ key, group, label, sample, dataKeys, path, fallback, advanced, email });

const VARIABLES = [
  v("client.name", "Client", "Client name", "John Smith", { dataKeys: ["clientName", "fullName", "employeeName", "beneficiaryName"], path: "client.name", fallback: "there" }),
  v("client.id", "Client", "Client ID", "CLT-20458", { path: "client.id", fallback: "N/A" }),
  v("client.email", "Client", "Client email", "john.smith@example.com", { dataKeys: ["email", "clientEmail"], path: "client.email", fallback: "", email: true }),
  v("client.phone", "Client", "Client phone", "(555) 010-2299", { dataKeys: ["phone"], path: "client.phone", fallback: "N/A" }),

  v("case.id", "Case", "Case ID", "CASE-10234", { dataKeys: ["caseNumber"], path: "case.id", fallback: "your case" }),
  v("case.type", "Case", "Case type", "Employment-Based", { dataKeys: ["filingType"], path: "case.type", fallback: "N/A" }),
  v("case.visa_type", "Case", "Visa type", "H-1B", { dataKeys: ["visaType", "visaPathway"], path: "case.visaType", fallback: "N/A" }),
  v("case.status", "Case", "Case status / decision", "In Progress", { dataKeys: ["decision"], path: "case.status", fallback: "N/A" }),
  v("case.stage", "Case", "Case stage", "Form Preparation", { dataKeys: ["stageName", "stage"], path: "case.stage", fallback: "N/A" }),
  v("case.receipt_number", "Case", "Receipt number", "WAC2512345678", { dataKeys: ["receiptNumber"], fallback: "N/A" }),
  v("case.receipt_date", "Case", "Receipt date", "Oct 3, 2026", { dataKeys: ["receiptDate"], fallback: "N/A" }),
  v("case.filing_date", "Case", "Filing date", "Oct 1, 2026", { dataKeys: ["filingDate"], fallback: "N/A" }),
  v("case.rfe_deadline", "Case", "RFE response deadline", "Dec 15, 2026", { dataKeys: ["rfeDeadline", "deadline"], fallback: "N/A" }),
  v("case.due_date", "Case", "Due date", "Oct 20, 2026", { dataKeys: ["dueDate"], fallback: "N/A" }),
  v("case.hold_reason", "Case", "On-hold reason", "Awaiting client response", { dataKeys: ["holdReason"], fallback: "N/A" }),
  v("case.closure_reason", "Case", "Closure reason", "Case completed", { dataKeys: ["closureReason"], fallback: "N/A" }),
  v("case.details", "Case", "Additional details", "Please see your portal for details.", { dataKeys: ["details", "reason", "nextStep"], fallback: "" }),
  v("case.payment_amount", "Case", "Payment amount", "$1,500.00", { dataKeys: ["amount"], fallback: "N/A" }),

  v("casemanager.name", "Case Manager", "Case manager name", "Sarah Johnson", { dataKeys: ["caseManagerName", "newCaseManagerName"], path: "caseManager.name", fallback: "your case manager" }),
  v("casemanager.id", "Case Manager", "Case manager ID", "CM-0042", { path: "caseManager.id", fallback: "N/A" }),
  v("casemanager.email", "Case Manager", "Case manager email", "sarah.johnson@immiglance.com", { path: "caseManager.email", fallback: "", email: true }),
  v("casemanager.previous_name", "Case Manager", "Previous case manager name", "Michael Brown", { dataKeys: ["previousCaseManagerName"], fallback: "N/A" }),

  v("teamlead.name", "Team Lead", "Team lead name", "Priya Patel", { dataKeys: ["teamLeadName"], path: "teamLead.name", fallback: "your team lead" }),
  v("teamlead.email", "Team Lead", "Team lead email", "priya.patel@immiglance.com", { path: "teamLead.email", fallback: "", email: true }),

  v("attorney.name", "Attorney", "Attorney name", "David Miller, Esq.", { dataKeys: ["attorneyName"], path: "attorney.name", fallback: "your attorney" }),
  v("attorney.id", "Attorney", "Attorney ID", "ATT-0017", { path: "attorney.id", fallback: "N/A" }),
  v("attorney.email", "Attorney", "Attorney email", "david.miller@lawfirm.com", { path: "attorney.email", fallback: "", email: true }),

  v("company.name", "Company", "Company name", "Acme Technologies Inc.", { dataKeys: ["employerName"], path: "company.name", fallback: "your company" }),
  v("company.id", "Company", "Company ID", "CMP-3311", { path: "company.id", fallback: "N/A" }),
  v("company.email", "Company", "Company contact email", "hr@acme-tech.com", { path: "company.email", fallback: "", email: true }),
  v("petitioner.name", "Company", "Petitioner name", "Jane Roberts", { dataKeys: ["petitionerName"], fallback: "the petitioner" }),

  v("document.name", "Document", "Document name", "Passport copy", { dataKeys: ["documentName", "itemName", "questionnaireName"], fallback: "the requested document" }),
  v("document.list", "Document", "Document list", "Passport copy, Birth certificate", { dataKeys: ["documentList"], fallback: "N/A" }),
  v("document.count", "Document", "Document count", "3", { dataKeys: ["documentCount"], fallback: "0" }),
  v("document.rejection_reason", "Document", "Rejection reason", "Image is too blurry to read.", { dataKeys: ["rejectionReason"], fallback: "N/A" }),

  v("recipient.name", "System", "Email recipient name", "John Smith", { dataKeys: ["recipientName", "name"], fallback: "there" }),
  v("system.firm_name", "System", "Firm name", "Immiglance", { fallback: "Immiglance" }),
  v("system.portal_link", "System", "Portal link", "https://portal.immiglance.com", { dataKeys: ["portalLink", "manageUrl", "attorneyPortalUrl", "paymentLink", "meetingUrl"], fallback: "" }),
  v("system.date", "System", "Today's date", new Date(2026, 9, 5).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }), { fallback: "" }),
  v("system.invite_token", "System", "Secure invite token (for invite/activation links)", "preview-token", { dataKeys: ["token"], fallback: "", advanced: true }),
];

const BY_KEY = new Map(VARIABLES.map((variable) => [variable.key, variable]));

// Reverse index of call-site data field -> variable, used to turn a code
// template's `data.clientName` into the editable `[client.name]` token.
const BY_DATA_KEY = new Map();
VARIABLES.forEach((variable) => variable.dataKeys.forEach((dataKey) => { if (!BY_DATA_KEY.has(dataKey)) BY_DATA_KEY.set(dataKey, variable); }));

const TOKEN_RE = /\[([a-z][a-z_]*\.[a-z][a-z_]*)\]/g;

function getVariable(key) { return BY_KEY.get(key) || null; }
function variableForDataKey(dataKey) { return BY_DATA_KEY.get(dataKey) || null; }
// A recipient value is either a literal address or exactly one email variable.
const EMAIL_ONLY_RE = /^\[([a-z][a-z_]*\.[a-z][a-z_]*)\]$/;
function emailVariableKey(value) {
  const match = EMAIL_ONLY_RE.exec(String(value || "").trim());
  return match && BY_KEY.get(match[1])?.email ? match[1] : null;
}
function listVariables() { return VARIABLES.map(({ path, ...rest }) => rest); }

// Every [x.y] token in a string, de-duplicated, in order of first appearance.
function extractTokens(text) {
  const found = [];
  String(text || "").replace(TOKEN_RE, (_, key) => { if (!found.includes(key)) found.push(key); return ""; });
  return found;
}

// Splits tokens into unknown ones (typos) and ones the given trigger's
// context can't supply. `allowedGroups` null/undefined = no per-trigger gate.
function validateTokens(texts, allowedGroups) {
  const unknown = [];
  const unavailable = [];
  extractTokens((Array.isArray(texts) ? texts : [texts]).join("\n")).forEach((key) => {
    const variable = BY_KEY.get(key);
    if (!variable) unknown.push(key);
    else if (allowedGroups && variable.group !== "System" && !allowedGroups.includes(variable.group)) unavailable.push(key);
  });
  return { unknown, unavailable, valid: !unknown.length && !unavailable.length };
}

const escapeHtml = (value) => String(value ?? "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const getPath = (object, dotted) => dotted.split(".").reduce((acc, part) => (acc == null ? undefined : acc[part]), object);

// Live value for one variable: call-site data first (it is the most specific
// - e.g. the *new* case manager on a reassignment), then the case context
// loaded from caseId, then the safe fallback. Never throws.
function resolveValue(variable, ctx = {}) {
  const data = ctx.data || {};
  for (const dataKey of variable.dataKeys) {
    const value = data[dataKey];
    if (value !== undefined && value !== null && String(value).trim() !== "") return Array.isArray(value) ? value.join(", ") : String(value);
  }
  if (variable.key === "system.date") return new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  if (variable.key === "system.firm_name") return "Immiglance";
  if (variable.path) {
    const value = getPath(ctx.caseContext || {}, variable.path);
    if (value !== undefined && value !== null && String(value).trim() !== "") return String(value);
  }
  return variable.fallback;
}

// Replaces every recognised [token]. Unknown tokens are left untouched in
// live mode (visible to whoever reviews the log) and the renderer's
// save-time validation prevents them being stored in the first place.
// `escape` is true for HTML bodies, false for plain-text (subject).
function substitute(text, ctx, { mode = "live", escape = true, highlightUnknown = false } = {}) {
  return String(text || "").replace(TOKEN_RE, (match, key) => {
    const variable = BY_KEY.get(key);
    if (!variable) return highlightUnknown && escape ? `<mark style="background:#fee2e2;color:#b91c1c;padding:0 2px;border-radius:3px;">${match}</mark>` : match;
    const value = mode === "sample" ? variable.sample : resolveValue(variable, ctx);
    return escape ? escapeHtml(value) : String(value);
  });
}

module.exports = {
  GROUPS, VARIABLES, TOKEN_RE,
  getVariable, variableForDataKey, listVariables, emailVariableKey,
  extractTokens, validateTokens, resolveValue, substitute, escapeHtml,
};
