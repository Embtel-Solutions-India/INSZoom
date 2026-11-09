// A person's own activity log (the Case Managers details page, "Activity Log"): what THEY did, newest first, with the time of each action:
// logged in / logged out, cases they created or opened, questionnaires sent, work on forms, petitions (including sending them to the attorney / client for review),
// invoices added, messages and notes, cases assigned to them, and the other actions they took on a case. Every case entry carries the case number, the person's
// name and e-mail. Sources: the audit log (userId = the person), cases they created, messages they sent, case assignments, the staff "cases opened" record,
// petition releases and invoices they added. System noise (imports, validations, background jobs) is left out. Read-only, light queries, capped.
const AuditLog = require("../../models/AuditLog");
const Case = require("../../models/Case");
const Message = require("../../models/Message");
const CaseAssignmentEvent = require("../../models/CaseAssignmentEvent");
const CaseForm = require("../../models/CaseForm");
const StaffActivity = require("../../models/StaffActivity");
const PetitionReview = require("../../models/PetitionReview");
const CaseInvoice = require("../../models/CaseInvoice");

const DAY_MS = 24 * 60 * 60 * 1000;
const GROUP_WINDOW_MS = 15 * 60 * 1000; // repeated edits of one form within 15 minutes read as one line
const PER_SOURCE_LIMIT = 400;
const OBJECT_ID = /^[a-f0-9]{24}$/i;

const title = (value) => String(value || "").replace(/[_.]+/g, " ").replace(/\s+/g, " ").trim().replace(/^\w/, (c) => c.toUpperCase());

// Plain-words wording for the actions staff take on a case.
const CASE_VERBS = {
  send_questionnaire: { kind: "questionnaire", text: "Sent a questionnaire to the client" },
  submit_questionnaire: { kind: "questionnaire", text: "Submitted a questionnaire" },
  generate_questionnaire_document_requests: { kind: "questionnaire", text: "Requested documents from the client" },
  add_note: { kind: "message", text: "Added a note" },
  edit_note: { kind: "message", text: "Edited a note" },
  delete_note: { kind: "message", text: "Deleted a note" },
  upload: { kind: "document", text: "Uploaded a document" },
  upload_checklist_file: { kind: "document", text: "Uploaded a checklist document" },
  bulk_upload: { kind: "document", text: "Uploaded documents" },
  request: { kind: "document", text: "Requested a document" },
  request_documents: { kind: "document", text: "Requested documents from the client" },
  form_opened: { kind: "form", text: "Opened a form" },
  form_created: { kind: "form", text: "Added a form" },
  update_stage: { kind: "case", text: "Moved the case to another stage" },
  update_plan: { kind: "case", text: "Changed the plan" },
  archive: { kind: "case", text: "Archived the case" },
  reopen: { kind: "case", text: "Reopened the case" },
  ownership_changed: { kind: "case", text: "Changed the case owner" },
  remove_case_manager: { kind: "case", text: "Removed a case manager" },
  employer_info_updated: { kind: "case", text: "Updated the employer details" },
  resend_employee_invite: { kind: "case", text: "Re-sent an employee invite" },
  employee_setup_link_created: { kind: "case", text: "Created an employee setup link" },
};
// Background / automatic actions: not the person's own work.
const SYSTEM_ACTIONS = new Set(["create", "lifecycle_sync", "immigration_knowledge_orchestrated", "sync_from_client", "reconcile", "seed_default", "trigger", "transition", "evidence_linked", "evidence_classified", "link_checklist_document", "generate_checklist", "information_request_created", "read", "read_many", "read_all", "checkout_confirmation_degraded"]);

// What an audit action means in plain words. kind: auth | form | petition | case | lead | document | questionnaire | message. A null result = not a personal activity (skipped).
const FORM_EDIT = new Set(["FIELD_EDITED", "FIELDS_UPDATED", "FIELD_OVERRIDDEN", "FORM_SAVED", "DRAFT_SAVED", "SECTION_SAVED", "SECTION_REVIEWED"]);
function describeAudit(row) {
  const action = String(row.action || "");
  if (action === "auth.login") return { kind: "auth", text: "Logged in" };
  if (action === "auth.google_oauth_callback") return { kind: "auth", text: "Logged in with Google" };
  if (action === "auth.logout" || action === "auth.logout_all") return { kind: "auth", text: "Logged out" };
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
  if (action === "update_payment_figures") return { kind: "invoice", text: "Edited the payment figures" };
  if (action === "case_restored_from_recycle_bin") return { kind: "case", text: "Restored the case" };
  if (action === "case_purged_from_recycle_bin") return { kind: "case", text: "Deleted the case for good" };
  if (action.startsWith("lead.")) return { kind: "lead", text: `Lead: ${title(action.slice(5))}` };
  if (CASE_VERBS[action]) return CASE_VERBS[action];
  if (SYSTEM_ACTIONS.has(action)) return null;
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
  const from = since || new Date(Date.now() - 180 * DAY_MS);
  const when = { $gte: from };
  const [auditRows, created, messages, assigned, opened, petitionRows, invoices] = await Promise.all([
    AuditLog.find({ userId: personId, status: { $ne: "failure" }, createdAt: when }).sort({ createdAt: -1 }).limit(PER_SOURCE_LIMIT * 2).select("action entityType entityId createdAt description details ipAddress").lean(),
    Case.find({ createdBy: personId, createdAt: when }).sort({ createdAt: -1 }).limit(PER_SOURCE_LIMIT).select("caseNumber clientName clientEmail visaType createdAt").lean(),
    Message.find({ senderId: personId, createdAt: when }).sort({ createdAt: -1 }).limit(PER_SOURCE_LIMIT).select("caseId isInternal isInternalNote createdAt").lean(),
    CaseAssignmentEvent.find({ toManagerId: personId, createdAt: when }).sort({ createdAt: -1 }).limit(PER_SOURCE_LIMIT).select("caseId role createdAt").lean(),
    // the cases they opened (the first open of each case per work day) and the ones they moved to Submitted
    StaffActivity.find({ staff: personId, kind: { $in: ["case", "closed"] }, at: when }).sort({ at: -1 }).limit(PER_SOURCE_LIMIT).select("kind ref at").lean(),
    // petitions they sent for attorney / client review
    PetitionReview.find({ $or: [{ "attorneyReview.sentBy": personId, "attorneyReview.sentAt": when }, { "clientReview.sentBy": personId, "clientReview.sentAt": when }] }).limit(PER_SOURCE_LIMIT).select("caseId attorneyReview.sentAt attorneyReview.sentBy clientReview.sentAt clientReview.sentBy").lean(),
    CaseInvoice.find({ uploadedBy: personId, createdAt: when }).sort({ createdAt: -1 }).limit(PER_SOURCE_LIMIT).select("caseId fileName createdAt").lean(),
  ]);

  // the case behind every entry (an audit row's entityId is a case id, or a form id for form work)
  const meaningful = auditRows.map((row) => ({ row, info: describeAudit(row) })).filter((item) => item.info);
  const formIds = meaningful.filter((item) => item.row.entityType !== "case" && item.row.entityId).map((item) => item.row.entityId).filter((id) => OBJECT_ID.test(id));
  const forms = formIds.length ? await CaseForm.find({ _id: { $in: [...new Set(formIds)] } }).select("caseId formCode").lean() : [];
  const formById = new Map(forms.map((form) => [String(form._id), form]));
  const caseIds = new Set();
  meaningful.forEach(({ row }) => {
    if (row.entityType === "case" && OBJECT_ID.test(row.entityId || "")) caseIds.add(row.entityId);
    const form = formById.get(row.entityId);
    if (form?.caseId) caseIds.add(String(form.caseId));
  });
  messages.forEach((m) => m.caseId && caseIds.add(String(m.caseId)));
  assigned.forEach((a) => a.caseId && caseIds.add(String(a.caseId)));
  opened.forEach((o) => OBJECT_ID.test(o.ref || "") && caseIds.add(String(o.ref)));
  petitionRows.forEach((p) => p.caseId && caseIds.add(String(p.caseId)));
  invoices.forEach((i) => i.caseId && caseIds.add(String(i.caseId)));
  const caseRows = caseIds.size ? await Case.find({ _id: { $in: [...caseIds] } }).select("caseNumber clientName clientEmail caseRole pendingEmployee employeeIdentity").lean() : [];
  const caseById = new Map(caseRows.map((c) => [String(c._id), c]));
  // the person on the case: name and e-mail (an employee's own, even before they are invited)
  const caseLabel = (id) => {
    const c = caseById.get(String(id));
    if (!c) return null;
    const employee = c.caseRole === "employee" ? { ...(c.employeeIdentity || {}), ...(c.pendingEmployee || {}) } : {};
    const clientName = employee.name || c.clientName || "";
    const clientEmail = employee.email || c.clientEmail || "";
    return { caseNumber: c.caseNumber, clientName, clientEmail, text: [c.caseNumber, clientName, clientEmail].filter(Boolean).join(" · ") };
  };
  const fields = (ref) => (ref ? { description: ref.text, caseNumber: ref.caseNumber, clientName: ref.clientName, clientEmail: ref.clientEmail } : { description: "" });

  const items = [];
  for (const { row, info } of meaningful) {
    const form = formById.get(row.entityId);
    const ref = row.entityType === "case" ? caseLabel(row.entityId) : form?.caseId ? caseLabel(form.caseId) : null;
    items.push({ _id: `a-${row._id}`, kind: info.kind, group: info.group && form ? `${info.group}:${form._id}` : null, action: info.text + (form?.formCode ? ` (${form.formCode})` : ""), ...fields(ref), createdAt: row.createdAt });
  }
  created.forEach((c) => {
    const ref = { caseNumber: c.caseNumber, clientName: c.clientName || "", clientEmail: c.clientEmail || "" };
    ref.text = [c.caseNumber, ref.clientName, ref.clientEmail, c.visaType].filter(Boolean).join(" · ");
    items.push({ _id: `c-${c._id}`, kind: "case", action: "Created a case", ...fields(ref), createdAt: c.createdAt });
  });
  messages.forEach((m) => items.push({ _id: `m-${m._id}`, kind: "message", action: m.isInternal || m.isInternalNote ? "Added an internal note" : "Messaged a client", ...fields(m.caseId ? caseLabel(m.caseId) : null), createdAt: m.createdAt }));
  assigned.forEach((a) => items.push({ _id: `s-${a._id}`, kind: "case", action: a.role === "team_lead" ? "Became the team lead of a case" : "A case was assigned to them", ...fields(caseLabel(a.caseId)), createdAt: a.createdAt }));
  opened.forEach((o) => {
    const ref = caseLabel(o.ref);
    if (ref) items.push({ _id: `o-${o._id}`, kind: "case", action: o.kind === "closed" ? "Moved a case to Submitted" : "Opened a case", ...fields(ref), createdAt: o.at });
  });
  petitionRows.forEach((p) => ["attorneyReview", "clientReview"].forEach((part) => {
    const sent = p[part];
    if (!sent?.sentAt || String(sent.sentBy) !== String(personId) || new Date(sent.sentAt) < from) return;
    items.push({ _id: `p-${p._id}-${part}`, kind: "petition", action: part === "attorneyReview" ? "Sent a petition to the attorney for review" : "Sent a petition to the client for review", ...fields(caseLabel(p.caseId)), createdAt: sent.sentAt });
  }));
  invoices.forEach((i) => items.push({ _id: `i-${i._id}`, kind: "invoice", action: "Added an invoice", ...fields(caseLabel(i.caseId)), createdAt: i.createdAt }));

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
