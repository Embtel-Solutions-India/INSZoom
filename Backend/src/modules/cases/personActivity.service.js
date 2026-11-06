// A person's own activity log (the Case Managers details page, "Activity Log"): what THEY did, newest first, with the time of each action:
// logged in / logged out, cases they created, work on forms, petitions, messages they sent, cases assigned to them, and the other actions they took on a case.
// Sources: the audit log (userId = the person), cases they created, messages they sent, and case assignments. System noise (imports, validations, background
// jobs) is left out. Read-only, light queries, capped.
const AuditLog = require("../../models/AuditLog");
const Case = require("../../models/Case");
const Message = require("../../models/Message");
const CaseAssignmentEvent = require("../../models/CaseAssignmentEvent");
const CaseForm = require("../../models/CaseForm");

const DAY_MS = 24 * 60 * 60 * 1000;
const GROUP_WINDOW_MS = 15 * 60 * 1000; // repeated edits of one form within 15 minutes read as one line
const PER_SOURCE_LIMIT = 400;

const title = (value) => String(value || "").replace(/[_.]+/g, " ").replace(/\s+/g, " ").trim().replace(/^\w/, (c) => c.toUpperCase());

// What an audit action means in plain words. kind: auth | form | petition | case | lead | document. A null result = not a personal activity (skipped).
const FORM_EDIT = new Set(["FIELD_EDITED", "FIELDS_UPDATED", "FIELD_OVERRIDDEN", "FORM_SAVED", "DRAFT_SAVED", "SECTION_SAVED", "SECTION_REVIEWED"]);
function describeAudit(row) {
  const action = String(row.action || "");
  if (action === "auth.login") return { kind: "auth", text: "Logged in" };
  if (action === "auth.google_oauth_callback") return { kind: "auth", text: "Logged in with Google" };
  if (action === "auth.logout") return { kind: "auth", text: "Logged out" };
  if (FORM_EDIT.has(action)) return { kind: "form", text: "Worked on a form", group: "form-edit" };
  if (action === "AUTO_FILL_COMPLETED") return { kind: "form", text: "Auto-filled a form" };
  if (action === "FORM_REGENERATED" || action === "FORM_GENERATED") return { kind: "form", text: "Generated a form" };
  if (action === "PDF_OFFICIAL_DOWNLOADED" || action === "FORM_DOWNLOADED") return { kind: "form", text: "Downloaded a form" };
  if (action === "PETITION_LETTER_EDITED") return { kind: "petition", text: "Edited a petition letter" };
  if (action === "PETITION_ASSEMBLED" || action === "PETITION_MAILING_PDF_ASSEMBLED") return { kind: "petition", text: "Assembled a petition" };
  if (action === "PETITION_FINALIZED") return { kind: "petition", text: "Finalized a petition" };
  if (action === "PETITION_UNLOCKED") return { kind: "petition", text: "Unlocked a petition" };
  if (action === "uscis_forms_assigned") return { kind: "case", text: "Assigned USCIS forms to the case" };
  if (action === "attorney_access_granted") return { kind: "case", text: "Gave an attorney access to the case" };
  if (action === "attorney_access_revoked") return { kind: "case", text: "Took an attorney's access away" };
  if (action === "update_payment_figures") return { kind: "case", text: "Edited the payment figures" };
  if (action === "case_restored_from_recycle_bin") return { kind: "case", text: "Restored the case" };
  if (action === "case_purged_from_recycle_bin") return { kind: "case", text: "Deleted the case for good" };
  if (action.startsWith("lead.")) return { kind: "lead", text: `Lead: ${title(action.slice(5))}` };
  // any other action recorded on a case itself is the person's own work on it
  if (row.entityType === "case" && /^[a-z_]+$/.test(action)) return { kind: "case", text: title(action) };
  return null;
}

function sinceFor(range) {
  const now = Date.now();
  if (range === "today") { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }
  if (range === "7days") return new Date(now - 7 * DAY_MS);
  if (range === "30days") return new Date(now - 30 * DAY_MS);
  return null;
}

async function buildActivities(personId, { dateRange = "", page = 1, limit = 20 } = {}) {
  const since = sinceFor(dateRange);
  const when = since ? { $gte: since } : { $gte: new Date(Date.now() - 180 * DAY_MS) };
  const [auditRows, created, messages, assigned] = await Promise.all([
    AuditLog.find({ userId: personId, status: { $ne: "failure" }, createdAt: when }).sort({ createdAt: -1 }).limit(PER_SOURCE_LIMIT * 2).select("action entityType entityId createdAt description details ipAddress").lean(),
    Case.find({ createdBy: personId, createdAt: when }).sort({ createdAt: -1 }).limit(PER_SOURCE_LIMIT).select("caseNumber clientName visaType createdAt").lean(),
    Message.find({ senderId: personId, createdAt: when }).sort({ createdAt: -1 }).limit(PER_SOURCE_LIMIT).select("caseId isInternal isInternalNote createdAt").lean(),
    CaseAssignmentEvent.find({ toManagerId: personId, createdAt: when }).sort({ createdAt: -1 }).limit(PER_SOURCE_LIMIT).select("caseId role createdAt").lean(),
  ]);

  // the case behind every entry (an audit row's entityId is a case id, or a form id for form work)
  const meaningful = auditRows.map((row) => ({ row, info: describeAudit(row) })).filter((item) => item.info);
  const formIds = meaningful.filter((item) => item.row.entityType !== "case" && item.row.entityId).map((item) => item.row.entityId).filter((id) => /^[a-f0-9]{24}$/i.test(id));
  const forms = formIds.length ? await CaseForm.find({ _id: { $in: [...new Set(formIds)] } }).select("caseId formCode").lean() : [];
  const formById = new Map(forms.map((form) => [String(form._id), form]));
  const caseIds = new Set();
  meaningful.forEach(({ row }) => {
    if (row.entityType === "case" && /^[a-f0-9]{24}$/i.test(row.entityId || "")) caseIds.add(row.entityId);
    const form = formById.get(row.entityId);
    if (form?.caseId) caseIds.add(String(form.caseId));
  });
  messages.forEach((m) => m.caseId && caseIds.add(String(m.caseId)));
  assigned.forEach((a) => a.caseId && caseIds.add(String(a.caseId)));
  const caseRows = caseIds.size ? await Case.find({ _id: { $in: [...caseIds] } }).select("caseNumber clientName").lean() : [];
  const caseById = new Map(caseRows.map((c) => [String(c._id), c]));
  const caseLabel = (id) => { const c = caseById.get(String(id)); return c ? { caseNumber: c.caseNumber, text: `${c.caseNumber}${c.clientName ? ` · ${c.clientName}` : ""}` } : null; };

  const items = [];
  for (const { row, info } of meaningful) {
    const form = formById.get(row.entityId);
    const ref = row.entityType === "case" ? caseLabel(row.entityId) : form?.caseId ? caseLabel(form.caseId) : null;
    items.push({ _id: `a-${row._id}`, kind: info.kind, group: info.group && form ? `${info.group}:${form._id}` : null, action: info.text + (form?.formCode ? ` (${form.formCode})` : ""), description: ref?.text || "", caseNumber: ref?.caseNumber || null, createdAt: row.createdAt });
  }
  created.forEach((c) => items.push({ _id: `c-${c._id}`, kind: "case", action: "Created a case", description: `${c.caseNumber}${c.clientName ? ` · ${c.clientName}` : ""}${c.visaType ? ` · ${c.visaType}` : ""}`, caseNumber: c.caseNumber, createdAt: c.createdAt }));
  messages.forEach((m) => { const ref = m.caseId ? caseLabel(m.caseId) : null; items.push({ _id: `m-${m._id}`, kind: "message", action: m.isInternal || m.isInternalNote ? "Added an internal note" : "Sent a message", description: ref?.text || "", caseNumber: ref?.caseNumber || null, createdAt: m.createdAt }); });
  assigned.forEach((a) => { const ref = caseLabel(a.caseId); items.push({ _id: `s-${a._id}`, kind: "case", action: a.role === "team_lead" ? "Became the team lead of a case" : "A case was assigned to them", description: ref?.text || "", caseNumber: ref?.caseNumber || null, createdAt: a.createdAt }); });

  items.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  // repeated edits of one form close together become one line ("Worked on form I-129 (12 edits)")
  const merged = [];
  for (const item of items) {
    const last = merged[merged.length - 1];
    if (item.group && last && last.group === item.group && new Date(last.createdAt).getTime() - new Date(item.createdAt).getTime() <= GROUP_WINDOW_MS) {
      last.count = (last.count || 1) + 1;
      last.startedAt = item.createdAt;
      continue;
    }
    merged.push({ ...item });
  }
  merged.forEach((item) => { if (item.count > 1) item.action = `${item.action} - ${item.count} edits`; });

  const size = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
  const current = Math.max(parseInt(page, 10) || 1, 1);
  const slice = merged.slice((current - 1) * size, current * size);
  return {
    activities: slice.map(({ group, startedAt, count, ...rest }) => rest),
    pagination: { page: current, limit: size, total: merged.length, totalPages: Math.max(Math.ceil(merged.length / size), 1) },
  };
}

module.exports = { buildActivities, describeAudit };
