// Case-level checklist management for case managers:
//   - approveChecklists: release draft checklists to the client (then, and only then, the client is notified and the
//     questionnaire triggers run);
//   - editChecklist: change one checklist's questions (edit / add / remove) FOR THIS CASE ONLY.
//
// Editing never touches the shared template. The first edit forks the template into a private copy
// (Questionnaire key "<template>__case_<caseId>", not a template, not a default, matching no visa type) and repoints
// this case's reference at it, keeping the reference's responseId so every answer already given stays attached. The
// reference's questionnaireTemplateId keeps the original id, which is what stops the original template resolving a
// second time as a default (questionnaire.service.js resolveCaseQuestionnaires) or being re-assigned by orchestration.
// Same idea as the per-case "Additional Requested Information" checklists (information-requests).

const Case = require("../../models/Case");
const Question = require("../../models/Question");
const Questionnaire = require("../../models/Questionnaire");
const caseService = require("../cases/case.service");
const { baseKey, isCaseCopyKey, caseCopyKey, isGated, isApproved, checklistId: gateChecklistId } = require("./checklist-gate");

const EDITABLE_TYPES = new Set(["text", "textarea", "number", "date", "radio", "select", "file", "email", "phone"]);

function httpError(status, message, code) {
  const error = new Error(message);
  error.status = status;
  if (code) error.code = code;
  return error;
}

const service = () => require("./questionnaire.service");

// Tells every open session on this case (employer, delegate, assigned case manager, the editing staff member's other
// tabs) that its checklists changed, so the answer panels re-read the approved / customised checklist immediately
// instead of waiting for a manual refresh. Never throws - a missed live update must not fail the change itself.
function broadcastChecklistsChanged(caseDocs, reason, actor) {
  try {
    const realtimeGateway = require("../realtime/realtime.gateway");
    for (const caseDoc of [].concat(caseDocs).filter(Boolean)) {
      const recipients = new Set([caseDoc.user, caseDoc.delegateEmployerUser, caseDoc.assignedCaseManager, actor?._id].filter(Boolean).map(String));
      const payload = { caseId: String(caseDoc._id), reason, at: new Date().toISOString() };
      recipients.forEach((userId) => realtimeGateway.emitToUser(userId, "case:checklists_changed", payload));
      realtimeGateway.emitToRole?.("admin", "case:checklists_changed", payload);
      realtimeGateway.emitToRole?.("super_admin", "case:checklists_changed", payload);
    }
  } catch (error) {
    require("../../utils/logger").error("checklist_broadcast_failed", { error: error.message });
  }
}
const gateEntry = (entry) => ({ key: entry.questionnaire.key, targetRole: entry.targetRole || entry.questionnaire.checklistRole, staffRequest: entry.staffRequest });

async function loadCase(caseId, user) {
  const caseData = await Case.findById(caseId);
  if (!caseData) throw httpError(404, "Case not found");
  if (!caseService.canAccessCase(user, caseData)) throw httpError(403, "Not authorized to manage this case's checklists");
  return caseData;
}

async function findEntry(caseId, wantedId) {
  const entries = await service().resolveCaseQuestionnaires(caseId);
  const entry = entries.find((item) => !item.staffRequest && gateChecklistId(gateEntry(item)) === wantedId);
  if (!entry) throw httpError(404, "Checklist not found on this case");
  return entry;
}

// ── approval ────────────────────────────────────────────────────────────
// ids: specific checklist ids on THIS case, or all: every draft checklist on this case and its child cases.
async function approveChecklists(caseId, { checklistIds = [], all = false } = {}, user, req) {
  const principal = await loadCase(caseId, user);
  const targets = [principal];
  // Approving an EMPLOYEE checklist on the principal case approves it on every child case too (and sends it to each client),
  // so the case manager never has to open each child case. "all" covers every checklist role.
  const employeeIdsRequested = checklistIds.filter((id) => String(id).endsWith("|employee"));
  const cascadeToChildren = all || employeeIdsRequested.length > 0;
  const isChildTarget = (target) => String(target._id) !== String(principal._id);
  if (cascadeToChildren && !principal.parentCase) targets.push(...(await Case.find({ parentCase: principal._id })));

  const approved = [];
  for (const target of targets) {
    if (!isGated(target)) continue;
    const entries = (await service().resolveCaseQuestionnaires(target._id)).filter((entry) => !entry.staffRequest);
    const pending = entries.filter((entry) => {
      if (isApproved(target, gateEntry(entry))) return false;
      if (all) return true;
      const id = gateChecklistId(gateEntry(entry));
      // on a child case only the employee checklists cascade from the principal's approval
      return isChildTarget(target) ? employeeIdsRequested.includes(id) : checklistIds.includes(id);
    });
    if (!pending.length) continue;

    const fresh = await Case.findById(target._id);
    const now = new Date();
    for (const entry of pending) {
      const gate = gateEntry(entry);
      fresh.checklistApproval.approvals.push({ checklistId: gateChecklistId(gate), questionnaireId: entry.questionnaire._id, targetRole: gate.targetRole, approvedAt: now, approvedBy: user._id });
      // the checklist is "sent" to the client now, not when it was drafted
      const reference = entry.referenceId ? fresh.questionnaireReferences.id(entry.referenceId) : null;
      if (reference) reference.sentAt = now;
      caseService.addTimelineEvent(fresh, "questionnaire", "Checklist Approved", `${entry.title || entry.questionnaire.title} approved and sent to the client.`, user, { checklistId: gateChecklistId(gate) });
      caseService.addAuditEntry(fresh, "approve_checklist", "Checklist approved for the client", user, { checklistId: gateChecklistId(gate) }, req);
    }
    await fresh.save();
    broadcastChecklistsChanged(fresh, "approved", user);

    for (const entry of pending) {
      try {
        await service().notifyChecklistAssigned(
          entry.questionnaire,
          fresh,
          { assignedTo: entry.assignedTo || fresh.user, responseId: entry.responseId },
          user,
          req
        );
      } catch (error) {
        require("../../utils/logger").error("checklist_approval_notification_failed", { caseId: String(fresh._id), error: error.message });
      }
      approved.push({ caseId: String(fresh._id), checklistId: gateChecklistId(gateEntry(entry)), title: entry.title || entry.questionnaire.title });
    }
  }
  return { approved };
}

// ── reject / delete a checklist for this case ──────────────────────────
// The checklist is taken off THIS case completely: staff no longer see it, the client is never sent it (or loses it, if it
// was already sent), and automatic assignment cannot bring it back. The shared template and other cases are untouched,
// and answers already given stay on record. Removing an EMPLOYEE checklist from the principal removes it from every
// employee case under it too, mirroring how approving it cascades.
async function removeChecklist(caseId, { checklistId: wantedId } = {}, user, req) {
  const principal = await loadCase(caseId, user);
  await findEntry(caseId, wantedId); // 404 when it is not a checklist of this case
  const targets = [principal];
  if (String(wantedId).endsWith("|employee") && !principal.parentCase) targets.push(...(await Case.find({ parentCase: principal._id })));

  const removedFrom = [];
  for (const target of targets) {
    const fresh = await Case.findById(target._id);
    if (!fresh.checklistApproval) fresh.checklistApproval = {};
    if ((fresh.checklistApproval.removed || []).some((item) => item.checklistId === wantedId)) continue;
    fresh.checklistApproval.removed = [...(fresh.checklistApproval.removed || []), { checklistId: wantedId, removedAt: new Date(), removedBy: user._id }];
    // no reference is touched: the resolver skips every checklist listed in checklistApproval.removed, so it is hidden
    // everywhere (staff, client, progress, forms) and nothing re-assigns it.
    caseService.addTimelineEvent(fresh, "questionnaire", "Checklist Removed", "A checklist was removed from this case and will not be sent to the client.", user, { checklistId: wantedId });
    caseService.addAuditEntry(fresh, "remove_checklist", "Checklist removed for this case", user, { checklistId: wantedId }, req);
    await fresh.save();
    removedFrom.push(String(fresh._id));
    broadcastChecklistsChanged(fresh, "removed", user);
  }
  return { removed: removedFrom, checklistId: wantedId };
}

// ── per-case copy ───────────────────────────────────────────────────────
async function forkChecklist(caseId, wantedId, user, req) {
  const caseData = await loadCase(caseId, user);
  const entry = await findEntry(caseId, wantedId);
  // already THIS case's own copy: edit it in place. (An employee case that is only being served its principal's copy gets a copy
  // of its own on first edit, so editing one employee never changes the others.)
  if (isCaseCopyKey(entry.questionnaire.key) && String(entry.questionnaire.key).endsWith(`__case_${caseData._id}`)) return { questionnaire: entry.questionnaire, entry, forked: false };

  const original = entry.questionnaire;
  const originalTemplateId = isCaseCopyKey(original.key)
    ? ((await Questionnaire.findOne({ key: baseKey(original.key), latestVersion: true }).select("_id").lean())?._id || original._id)
    : original._id;
  const copyKey = caseCopyKey(original.key, caseData._id);
  let copy = await Questionnaire.findOne({ key: copyKey, latestVersion: true });
  if (!copy) {
    const source = original.toObject();
    ["_id", "__v", "createdAt", "updatedAt"].forEach((field) => delete source[field]);
    copy = await Questionnaire.create({
      ...source,
      key: copyKey,
      isTemplate: false,
      isDefault: false,
      visaType: `CASE_${caseData._id}`,
      visaTypes: [`CASE_${caseData._id}`],
      adminVisaTypes: [],
      templateCategory: `CASE_${caseData._id}`,
      createdBy: user._id,
      updatedBy: user._id,
    });
    copy.rootQuestionnaire = copy._id;
    await copy.save();
    const questions = await Question.find({ questionnaire: original._id }).lean();
    if (questions.length) {
      await Question.insertMany(questions.map(({ _id, __v, createdAt, updatedAt, ...rest }) => ({
        ...rest, questionnaire: copy._id, questionnaireKey: copy.key, questionnaireVersion: copy.version,
      })));
    }
  }

  const fresh = await Case.findById(caseId);
  const reference = entry.referenceId ? fresh.questionnaireReferences.id(entry.referenceId) : null;
  if (reference) {
    reference.questionnaireTemplateId = reference.questionnaireTemplateId || originalTemplateId;
    reference.questionnaireId = copy._id;
  } else {
    fresh.questionnaireReferences.push({
      questionnaireId: copy._id,
      questionnaireTemplateId: originalTemplateId,
      responseId: entry.responseId, // keeps every answer already given attached to this checklist
      title: original.title,
      targetRole: entry.targetRole || original.checklistRole,
      participantId: entry.participantId || undefined,
      participantRole: entry.participantRole || undefined,
      status: "not_started",
      sentAt: new Date(),
      assignedTo: entry.assignedTo || undefined,
      sentBy: user._id,
    });
  }
  const approval = (fresh.checklistApproval?.approvals || []).find((item) => item.checklistId === wantedId);
  if (approval) approval.questionnaireId = copy._id;
  caseService.addTimelineEvent(fresh, "questionnaire", "Checklist Customised For This Case", `${original.title} now has its own copy for this case. Other cases are not affected.`, user, { checklistId: wantedId });
  caseService.addAuditEntry(fresh, "customize_checklist", "Checklist forked for this case only", user, { checklistId: wantedId, from: String(original._id), to: String(copy._id) }, req);
  await fresh.save();
  broadcastChecklistsChanged(fresh, "customised", user);
  return { questionnaire: copy, entry, forked: true };
}

// ── question editing (this case only) ───────────────────────────────────
function cleanOptions(options) {
  return (Array.isArray(options) ? options : [])
    .map((option) => (typeof option === "object" && option ? { label: String(option.label ?? option.value ?? "").trim(), value: option.value ?? option.label } : { label: String(option).trim(), value: String(option).trim() }))
    .filter((option) => option.label);
}

async function editChecklist(caseId, { op, checklistId: wantedId, questionKey, patch = {} } = {}, user, req) {
  if (!["update", "add", "remove"].includes(op)) throw httpError(400, "op must be update, add or remove");
  const { questionnaire: copy } = await forkChecklist(caseId, wantedId, user, req);

  if (op === "add") {
    const label = String(patch.label || "").trim();
    if (!label) throw httpError(400, "A question needs text");
    const type = EDITABLE_TYPES.has(patch.type) ? patch.type : "text";
    const siblings = await Question.find({ questionnaire: copy._id }).sort({ order: -1 }).lean();
    const base = siblings.find((item) => item.sectionKey === patch.sectionKey && item.active !== false) || siblings.find((item) => item.active !== false) || siblings[0];
    if (!base) throw httpError(409, "This checklist has no section to add a question to");
    const { _id, __v, createdAt, updatedAt, mapping, uscisMappings, ...rest } = base;
    const key = `custom_${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
    const created = await Question.create({
      ...rest,
      key,
      label,
      description: String(patch.description || ""),
      helpText: String(patch.description || ""),
      type,
      required: Boolean(patch.required),
      options: type === "radio" || type === "select" ? cleanOptions(patch.options?.length ? patch.options : type === "radio" ? ["Yes", "No"] : []) : [],
      order: (siblings[0]?.order || 0) + 1,
      uscisMappings: [],
      validationRules: [],
      conditionalLogic: { mode: "all", rules: [], groups: [] },
      showIf: undefined,
      repeatable: false,
      metadata: { customForCase: true },
      active: true,
      isActive: true,
      questionnaire: copy._id,
      questionnaireKey: copy.key,
      questionnaireVersion: copy.version,
    });
    await broadcastEdited(caseId, user);
    return { questionnaireId: copy._id, question: created };
  }

  const question = await Question.findOne({ questionnaire: copy._id, key: questionKey });
  if (!question) throw httpError(404, "Question not found on this checklist");
  if (op === "remove") {
    // retired, never deleted: an answer already given stays on record
    question.active = false;
    question.isActive = false;
    await question.save();
    await broadcastEdited(caseId, user);
    return { questionnaireId: copy._id, question };
  }
  if (patch.label !== undefined) {
    const label = String(patch.label).trim();
    if (!label) throw httpError(400, "A question needs text");
    question.label = label;
  }
  if (patch.description !== undefined) {
    question.description = String(patch.description);
    question.helpText = String(patch.description);
  }
  if (patch.required !== undefined) question.required = Boolean(patch.required);
  if (patch.options !== undefined && ["radio", "select"].includes(question.type)) question.options = cleanOptions(patch.options);
  await question.save();
  await broadcastEdited(caseId, user);
  return { questionnaireId: copy._id, question };
}

async function broadcastEdited(caseId, user) {
  const principal = await Case.findById(caseId).select("user delegateEmployerUser assignedCaseManager").lean();
  // the employee cases under a principal are served its customised checklists too, so their sessions refresh as well
  const children = await Case.find({ parentCase: caseId }).select("user delegateEmployerUser assignedCaseManager").lean();
  broadcastChecklistsChanged([principal, ...children], "edited", user);
}

module.exports = { approveChecklists, removeChecklist, forkChecklist, editChecklist, baseKey };
