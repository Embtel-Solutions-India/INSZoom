// Glue between the admin-authored EmailTemplate rows and the existing
// email send path:
//
//   TRIGGER (existing sendTemplateEmail key)
//     -> findActive()            is there an active customization for it?
//     -> buildContext()          resolve variables from call-site data + the live case
//     -> resolveRecipients()     resolve To/CC/BCC roles from the live case
//     -> emailRenderer.renderCustom()   (same renderer the preview uses)
//
// email.service.js calls these inside try/catch and falls back to the
// built-in template on ANY failure, so this layer can never stop an email.
const EmailTemplate = require("../../models/EmailTemplate");
const Case = require("../../models/Case");
const User = require("../../models/User");
const Company = require("../../models/Company");
const registry = require("./emailVariables.registry");
const triggers = require("./emailTriggers.registry");

// ── active-template lookup ───────────────────────────────────────────────
// Read straight from the database on every send (one indexed query - emails
// are infrequent), deliberately NOT cached: the moment an admin saves or
// activates a change, the very next email, from any server instance, uses it.
async function findActive(triggerKey) {
  return EmailTemplate.findOne({ managed: true, status: "active", triggerKey }).sort({ updatedAt: -1 }).lean();
}
// Kept so existing callers keep working; there is nothing to invalidate.
function invalidateCache() {}

// ── live context ─────────────────────────────────────────────────────────
const nameOf = (user) => user?.name || user?.displayName || user?.email || "";

async function buildContext({ data = {}, caseId } = {}) {
  const ctx = { data, caseContext: {} };
  if (!caseId) return ctx;
  const caseDoc = await Case.findById(caseId)
    .select("caseNumber caseId visaType petitionType status stage clientName clientEmail clientPortalId user assignedCaseManager assignedTeamLead attorneyAccess companyId employerUser")
    .lean();
  if (!caseDoc) return ctx;

  const attorneyId = (caseDoc.attorneyAccess || []).find((grant) => grant.status === "active")?.attorneyId;
  const ids = [caseDoc.user, caseDoc.assignedCaseManager, caseDoc.assignedTeamLead, attorneyId].filter(Boolean);
  const [users, company] = await Promise.all([
    User.find({ _id: { $in: ids } }).select("name displayName email").lean(),
    caseDoc.companyId ? Company.findById(caseDoc.companyId).select("name contact hrContact").lean() : null,
  ]);
  const byId = new Map(users.map((user) => [String(user._id), user]));
  const pick = (id) => (id ? byId.get(String(id)) : null);
  const clientUser = pick(caseDoc.user);
  const caseManager = pick(caseDoc.assignedCaseManager);
  const teamLead = pick(caseDoc.assignedTeamLead);
  const attorney = pick(attorneyId);

  ctx.caseContext = {
    client: { name: caseDoc.clientName || nameOf(clientUser), id: caseDoc.clientPortalId || String(caseDoc.user || ""), email: caseDoc.clientEmail || clientUser?.email, phone: clientUser?.phone },
    case: { id: caseDoc.caseNumber || caseDoc.caseId, type: caseDoc.petitionType, visaType: caseDoc.visaType, status: caseDoc.status, stage: caseDoc.stage },
    caseManager: caseManager && { name: nameOf(caseManager), id: String(caseManager._id), email: caseManager.email },
    teamLead: teamLead && { name: nameOf(teamLead), email: teamLead.email },
    attorney: attorney && { name: nameOf(attorney), id: String(attorney._id), email: attorney.email },
    company: company && { name: company.name, id: String(company._id), email: company.hrContact?.email || company.contact?.email },
  };
  return ctx;
}

// ── recipients ───────────────────────────────────────────────────────────
const EMAIL_RE = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;

// Returns de-duplicated, lower-cased addresses for a list of {type,value}
// rules. A rule that can't be resolved (no attorney on this case, ...) is
// simply skipped.
async function resolveRuleList(rules = [], ctx = {}) {
  const found = [];
  const cc = ctx.caseContext || {};
  for (const rule of rules) {
    if (!rule?.type) continue;
    if (rule.type === "custom") {
      // A literal address, or a single email variable such as [client.email].
      const variableKey = registry.emailVariableKey(rule.value);
      found.push(variableKey ? registry.resolveValue(registry.getVariable(variableKey), { ...ctx, caseContext: cc }) : rule.value);
    }
    else if (rule.type === "client") found.push(cc.client?.email || ctx.data?.email || ctx.data?.clientEmail);
    else if (rule.type === "case_manager") found.push(cc.caseManager?.email);
    else if (rule.type === "team_lead") found.push(cc.teamLead?.email);
    else if (rule.type === "attorney") found.push(cc.attorney?.email);
    else if (rule.type === "company_contact") found.push(cc.company?.email);
    else if (rule.type === "admin" || rule.type === "super_admin") {
      const staff = await User.find({ role: rule.type, isActive: { $ne: false } }).select("email").lean();
      staff.forEach((user) => found.push(user.email));
    }
  }
  return [...new Set(found.filter((address) => typeof address === "string" && EMAIL_RE.test(address.trim())).map((address) => address.trim().toLowerCase()))];
}

// Applies a template's recipient rules on top of the call site's own `to`.
// - To rules resolving to >=1 address replace the call site's recipient;
//   when they resolve to nothing the call site's recipient is kept, so a
//   mis-configured rule can never leave an email with nobody to send to.
// - CC/BCC are additive and never repeat an address already in To.
async function applyRecipientRules(template, baseTo, ctx) {
  const rules = template.recipients || {};
  const resolvedTo = await resolveRuleList(rules.to, ctx);
  const to = resolvedTo.length ? resolvedTo : [String(baseTo).toLowerCase()];
  const taken = new Set(to);
  const cc = (await resolveRuleList(rules.cc, ctx)).filter((address) => !taken.has(address));
  cc.forEach((address) => taken.add(address));
  const bcc = (await resolveRuleList(rules.bcc, ctx)).filter((address) => !taken.has(address));
  return { to, cc, bcc };
}

// ── prefilled editor content for a built-in template ────────────────────
// Runs the built-in template's own subject()/bodyLines() with a data object
// whose every field returns the matching [variable] token, so opening a
// built-in email in the editor shows ITS real wording with the variables
// already inserted. Falls back to sample values if the template can't be
// introspected this way.
function tokenProxy() {
  return new Proxy({}, {
    get(_, prop) {
      if (typeof prop !== "string") return undefined;
      const variable = registry.variableForDataKey(prop);
      return variable ? `[${variable.key}]` : "";
    },
  });
}

function defaultContentFor(triggerKey, templates) {
  const template = templates[triggerKey];
  if (!template) return null;
  try {
    const subject = template.subject(tokenProxy());
    const lines = template.bodyLines(tokenProxy());
    const body = lines.map((line) => (/^\s*<(table|a|div|p|ul|ol)\b/i.test(line) ? line : `<p>${line}</p>`)).join("\n");
    return { subject, heading: subject, body, converted: true };
  } catch {
    const sample = {};
    registry.VARIABLES.forEach((variable) => variable.dataKeys.forEach((key) => { if (!(key in sample)) sample[key] = variable.sample; }));
    const subject = template.subject(sample);
    const body = template.bodyLines(sample).map((line) => (/^\s*</.test(line) ? line : `<p>${line}</p>`)).join("\n");
    return { subject, heading: subject, body, converted: false };
  }
}

// ── validation ───────────────────────────────────────────────────────────
function validateContent({ subject, heading, body, triggerKey }) {
  const trigger = triggerKey ? triggers.getTrigger(triggerKey) : null;
  const result = registry.validateTokens([subject, heading, body], trigger?.groups || null);
  const errors = [];
  if (result.unknown.length) errors.push(`Unknown variable${result.unknown.length > 1 ? "s" : ""}: ${result.unknown.map((key) => `[${key}]`).join(", ")}`);
  if (result.unavailable.length) errors.push(`Not available for this trigger: ${result.unavailable.map((key) => `[${key}]`).join(", ")}`);
  return { ...result, errors };
}

function validateRecipients(recipients = {}) {
  const errors = [];
  const known = new Set(triggers.RECIPIENT_TYPES.map((entry) => entry.type));
  for (const list of ["to", "cc", "bcc"]) {
    for (const rule of recipients[list] || []) {
      if (!known.has(rule?.type)) errors.push(`Unknown recipient type in ${list.toUpperCase()}: ${rule?.type}`);
      else if (rule.type === "custom" && !EMAIL_RE.test(String(rule.value || "").trim()) && !registry.emailVariableKey(rule.value)) errors.push(`Invalid custom email in ${list.toUpperCase()}: ${rule.value || "(empty)"}`);
    }
  }
  return errors;
}

module.exports = {
  findActive, invalidateCache, buildContext, applyRecipientRules, resolveRuleList,
  defaultContentFor, validateContent, validateRecipients,
};
