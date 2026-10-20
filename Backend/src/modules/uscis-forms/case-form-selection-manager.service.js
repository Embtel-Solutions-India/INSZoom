// What the Case Manager's form selection screen needs: read a case's selections, change them (atomically, with dependency / removal / concurrency rules)
// and refresh autofill for the forms on the case. All decisions are enforced here - the frontend is never the source of truth.
// Design and rules: docs/CASE_MANAGER_CONTROLLED_USCIS_FORMS_AND_AUTOFILL.md.

const Case = require("../../models/Case");
const CaseForm = require("../../models/CaseForm");
const CaseFormSelection = require("../../models/CaseFormSelection");
const caseService = require("../cases/case.service");
const selection = require("./case-form-selection.service");
const catalog = require("./case-form-catalog.service");

const MANAGE_ROLES = new Set(["super_admin", "admin", "team_lead", "case_manager"]);
const UNLOCK_ROLES = new Set(["super_admin", "admin", "team_lead"]);
const roleOf = (user) => String(user?.role || "").toLowerCase().replace(/[\s-]+/g, "_");
const REVIEWED_STATUSES = new Set(["approved", "ready_for_pdf", "generated", "finalized"]);
const LOCKED_STATUSES = new Set(["locked", "filed"]);
const { httpError } = selection;

const identityKey = (formCode, componentCode) => selection.keyOf(formCode, componentCode);

// ── loading ─────────────────────────────────────────────────────────────────
async function loadCaseForManagement(caseId, user, { write = false } = {}) {
  const caseData = await Case.findById(caseId).select("caseNumber clientName visaType childCases caseRole formSelectionMode formSelectionRevision user assignedCaseManager additionalCaseManagers assignedTeamLead assignedAttorney attorneyAccess primaryOwner");
  if (!caseData) throw httpError(404, "Case not found");
  if (!caseService.canAccessCase(user, caseData)) throw httpError(403, "Not authorized to manage this case's forms");
  if (write && !MANAGE_ROLES.has(roleOf(user))) throw httpError(403, "Only a Case Manager, Team Lead or Admin can change a case's forms");
  return caseData;
}

// The case(s) whose CaseForms we manage: a container's children (that is where its forms live), otherwise the case itself.
async function resolveTarget(caseData, targetCaseId) {
  const childIds = (caseData.childCases || []).map(String);
  const targets = childIds.length ? await Case.find({ _id: { $in: childIds } }).select("caseNumber clientName formSelectionMode formSelectionRevision caseRole") : [caseData];
  const summary = targets.map((item) => ({ caseId: item._id, caseNumber: item.caseNumber, clientName: item.clientName || "" }));
  let target = null;
  if (targetCaseId) {
    target = targets.find((item) => String(item._id) === String(targetCaseId));
    if (!target) throw httpError(400, "That case is not part of this case's filing");
  } else if (targets.length === 1) {
    target = targets[0];
  }
  return { targets: summary, target };
}

async function requiredByPackage(caseData) {
  try {
    const PetitionAssemblyService = require("../petition/services/PetitionAssemblyService");
    const definition = await PetitionAssemblyService.resolveDefinition({ caseData });
    return new Set((definition?.requiredForms || []).filter((entry) => entry.required).map((entry) => selection.normalizeCode(entry.formCode)));
  } catch (error) {
    return new Set(); // no package definition for this case: nothing is "required" by it
  }
}

const hasEnteredData = (form) => Boolean(form) && (Number(form.completion?.percent || 0) > 0 || !["pending", "archived"].includes(form.status));

// ── the form's checklist link ───────────────────────────────────────────────
// A form is filled from the case's checklist answers through the canonical profile: each checklist question carries a canonical path, the form's field mapping
// reads canonical paths. So "mapping the form to the case's checklist" means: (a) which of THIS case's checklists already feed this form, and (b) which checklist
// the registry designed for this form that the case does not hold yet (offered, and assigned to this case only if the Case Manager asks).
async function caseChecklistKeys(targetCaseId) {
  const resolved = await require("../questionnaires/questionnaire.service").resolveCaseQuestionnaires(targetCaseId);
  return resolved.filter((entry) => !entry.staffRequest).map((entry) => ({ key: selection.baseKeyOf(entry.questionnaire.key), title: entry.title || entry.questionnaire.title, role: entry.targetRole || entry.questionnaire.checklistRole || "" }));
}

async function suggestedChecklistsFor(target, formCode, held) {
  const VisaFormMapping = require("../../models/VisaFormMapping");
  const rows = await VisaFormMapping.find({ formTemplateFormCode: String(formCode).toLowerCase(), active: true }).select("visaType checklistMappings").lean();
  const expectedRole = require("../cases/immigration-knowledge-engine.service").expectedChecklistRoleForCase(target);
  const heldKeys = new Set(held.map((item) => item.key));
  const seen = new Map();
  rows.forEach((row) => (row.checklistMappings || []).forEach((entry) => {
    if (expectedRole && entry.role && entry.role !== expectedRole) return;
    if (entry.assignmentType === "CONDITIONAL" || heldKeys.has(entry.checklistKey) || seen.has(entry.checklistKey)) return;
    seen.set(entry.checklistKey, { key: entry.checklistKey, role: entry.role || "", viaVisaType: row.visaType });
  }));
  const Questionnaire = require("../../models/Questionnaire");
  const found = seen.size ? await Questionnaire.find({ key: { $in: [...seen.keys()] }, latestVersion: true, status: { $ne: "archived" } }).select("key title checklistRole").lean() : [];
  return found.map((row) => ({ ...seen.get(row.key), title: row.title, role: seen.get(row.key).role || row.checklistRole || "" }));
}

// How much of this form the case's checklists can fill. Heavy (reads each checklist and the form's mapping), so it has its own endpoint.
async function getFormChecklistCoverage(caseId, { targetCaseId, formCode, componentCode, checklistKeys } = {}, user) {
  const caseData = await loadCaseForManagement(caseId, user);
  const { target } = await resolveTarget(caseData, targetCaseId);
  if (!target) throw httpError(400, "Choose which case's forms to inspect", "TARGET_CASE_REQUIRED");
  const entry = await catalog.findEntry(formCode, componentCode);
  if (!entry) throw httpError(404, "That form is not in the catalogue");
  const targetFull = await Case.findById(target._id).select("caseRole caseStructure visaType").lean();
  const held = await caseChecklistKeys(target._id);
  // checklists the Case Manager is considering (any checklist can feed any form: what matters is whether its questions carry the canonical paths the form reads)
  const candidateKeys = (Array.isArray(checklistKeys) ? checklistKeys : String(checklistKeys || "").split(",")).map((key) => selection.baseKeyOf(String(key).trim())).filter(Boolean);
  const heldKeys = new Set(held.map((item) => item.key));
  const candidates = [];
  if (candidateKeys.length) {
    const Questionnaire = require("../../models/Questionnaire");
    const rows = await Questionnaire.find({ key: { $in: candidateKeys }, latestVersion: true, status: { $ne: "archived" } }).select("key title checklistRole").lean();
    rows.filter((row) => !heldKeys.has(row.key)).forEach((row) => candidates.push({ key: row.key, title: row.title, role: row.checklistRole || "", heldByCase: false }));
  }
  const toMeasure = [...held.map((item) => ({ ...item, heldByCase: true })), ...candidates];
  const Trace = require("../form-mapping/services/ChecklistFieldTraceabilityService");
  const perChecklist = entry.templateId
    ? await Promise.all(toMeasure.map(async (item) => {
      try {
        const trace = await Trace.traceQuestionsToFields(item.key, entry.templateId);
        const fields = new Set();
        trace.results.forEach((question) => (question.fields || []).forEach((field) => fields.add(field.targetFieldId)));
        return { ...item, questionsFeedingForm: trace.results.length, fieldsFed: fields.size };
      } catch (error) {
        return { ...item, questionsFeedingForm: 0, fieldsFed: 0, error: error.message };
      }
    }))
    : toMeasure.map((item) => ({ ...item, questionsFeedingForm: 0, fieldsFed: 0 }));
  const suggested = await suggestedChecklistsFor(targetFull || target, entry.formCode, held);
  const totalFed = perChecklist.reduce((sum, item) => sum + item.fieldsFed, 0);
  return {
    formCode: entry.formCode,
    componentCode: entry.componentCode || null,
    availability: entry.availability,
    checklists: perChecklist,
    suggestedChecklists: suggested,
    summary: !entry.templateId
      ? "No official template is imported yet, so nothing can be filled."
      : totalFed
        ? `This case's checklists can fill about ${totalFed} field(s) of ${entry.formCode}. Fields no checklist asks about stay empty and are listed in the auto-fill report.`
        : suggested.length
          ? `None of this case's checklists feed ${entry.formCode}. ${suggested.map((item) => item.title).join(", ")} is designed for it.`
          : `None of this case's checklists feed ${entry.formCode} yet; its fields will need staff input.`,
  };
}

// ── read ────────────────────────────────────────────────────────────────────
async function getSelection(caseId, { targetCaseId } = {}, user) {
  const caseData = await loadCaseForManagement(caseId, user);
  const { targets, target } = await resolveTarget(caseData, targetCaseId);
  if (!target) return { caseId: caseData._id, targets, target: null, needsTarget: true, items: [], removed: [] };

  const [control, rows, forms, required] = await Promise.all([
    Case.findById(target._id).select("formSelectionMode formSelectionRevision").lean(),
    CaseFormSelection.find({ caseId: target._id }).lean(),
    CaseForm.find({ caseId: target._id }).select("formCode componentCode parentFormCode status completion isLocked updatedAt formEditionDate formVersion autoFillReport.summary").lean(),
    requiredByPackage(caseData),
  ]);
  const formByKey = new Map(forms.map((form) => [identityKey(form.formCode, form.componentCode), form]));
  const rowByKey = new Map(rows.map((row) => [identityKey(row.formCode, row.componentCode), row]));
  const entries = await catalog.loadEntries();
  const entryOf = (formCode, componentCode) => entries.find((entry) => (componentCode ? entry.componentCode === componentCode && entry.kind === "component" : entry.key === selection.normalizeCode(formCode) && entry.kind === "form")) || null;

  const shape = (formCode, componentCode, parentFormCode, row, form) => {
    const entry = entryOf(formCode, componentCode);
    return {
      key: identityKey(formCode, componentCode),
      formCode: selection.normalizeCode(formCode),
      componentCode: componentCode || null,
      parentFormCode: parentFormCode || null,
      title: entry?.title || row?.formTitle || selection.normalizeCode(formCode),
      origin: row ? "selection" : "automatic",
      decision: row?.decision || (form && form.status !== "archived" ? "include" : null),
      selectionStatus: row?.selectionStatus || (form ? "provisioned" : null),
      caseFormId: form?._id || row?.caseFormId || null,
      caseFormStatus: form?.status || null,
      locked: Boolean(form && (form.isLocked || LOCKED_STATUSES.has(form.status))),
      completionPercent: form?.completion?.percent ?? null,
      availability: entry?.availability || "no_template",
      availabilityNote: entry?.availabilityNote || "",
      editionDate: form?.formEditionDate || entry?.editionDate || null,
      requiredByPackage: required.has(selection.normalizeCode(formCode)),
      waivedRequirement: Boolean(row?.waivedRequirement),
      reason: row?.reason || "",
      decidedAt: row?.decidedAt || null,
      decidedBy: row?.decidedBy || null,
      history: (row?.history || []).slice(-5),
    };
  };

  const items = [];
  const removed = [];
  rows.forEach((row) => {
    const form = formByKey.get(identityKey(row.formCode, row.componentCode));
    const item = shape(row.formCode, row.componentCode, row.parentFormCode, row, form);
    (row.decision === "exclude" ? removed : items).push(item);
  });
  // forms the automatic rules created (no selection row): shown as automatic until the Case Manager decides; archived ones are "removed"
  forms.forEach((form) => {
    if (rowByKey.has(identityKey(form.formCode, form.componentCode))) return;
    const item = shape(form.formCode, form.componentCode, form.parentFormCode, null, form);
    (form.status === "archived" ? removed : items).push(item);
  });
  items.sort((a, b) => a.key.localeCompare(b.key, undefined, { numeric: true }));
  return {
    caseId: caseData._id,
    targets,
    target: { caseId: target._id, caseNumber: target.caseNumber, clientName: target.clientName || "" },
    needsTarget: false,
    mode: control?.formSelectionMode || "legacy",
    revision: control?.formSelectionRevision || 0,
    items,
    removed,
    requiredByPackage: [...required],
  };
}

// ── write ───────────────────────────────────────────────────────────────────
async function appendHistory(caseId, identity, entry) {
  await CaseFormSelection.updateOne({ caseId, formCode: selection.normalizeCode(identity.formCode), componentCode: identity.componentCode || null }, { $push: { history: { ...entry, at: new Date() } } });
}

async function upsertRow(caseId, identity, set, historyEntry) {
  const filter = { caseId, formCode: selection.normalizeCode(identity.formCode), componentCode: identity.componentCode || null };
  const run = () => CaseFormSelection.findOneAndUpdate(filter, { $set: { ...set, parentFormCode: identity.parentFormCode || null }, $push: { history: { ...historyEntry, at: new Date() } } }, { upsert: true, new: true });
  try {
    return await run();
  } catch (error) {
    if (error?.code === 11000) return run(); // a concurrent request created the row first
    throw error;
  }
}

function archiveEntry(user, reason, previousStatus) {
  return { action: "FORM_REMOVED_FROM_CASE", changes: { reason, previousStatus }, performedBy: user?._id, performedAt: new Date() };
}

// PURE. May this user remove this form, and what must they confirm? Returns { ok, status, code, message }.
function removalRule({ form, role, input }) {
  if (!form || form.status === "archived") return { ok: true };
  if (LOCKED_STATUSES.has(form.status) || form.isLocked) {
    if (!UNLOCK_ROLES.has(role)) return { ok: false, status: 403, code: "LOCKED_FORM_REMOVAL_FORBIDDEN", message: "Only a Team Lead or Admin can remove a locked or filed form." };
    if (!input.reason || !input.confirm) return { ok: false, status: 409, code: "CONFIRMATION_REQUIRED", message: "A locked or filed form needs a reason and explicit confirmation to be removed." };
    return { ok: true };
  }
  if (REVIEWED_STATUSES.has(form.status)) {
    if (!input.reason || !input.confirm) return { ok: false, status: 409, code: "CONFIRMATION_REQUIRED", message: "A reviewed or approved form needs a reason and confirmation to be removed." };
    return { ok: true };
  }
  if (hasEnteredData(form) && !input.confirm) return { ok: false, status: 409, code: "CONFIRMATION_REQUIRED", message: "This form already holds information. Confirm to remove it; its data and history are kept." };
  return { ok: true };
}

async function removeOne(target, input, ctx) {
  const { user, role, requiredCodes } = ctx;
  const code = selection.normalizeCode(input.formCode);
  const componentCode = input.componentCode || null;
  const form = await CaseForm.findOne({ caseId: target._id, formCode: componentCode ? input.formCode : code, ...(componentCode ? { componentCode } : { componentCode: null }) });
  const verdict = removalRule({ form, role, input });
  if (!verdict.ok) throw httpError(verdict.status, verdict.message, verdict.code, { formCode: code, componentCode });

  // a parent form takes its components with it only when the Case Manager says so
  if (!componentCode) {
    const dependents = await CaseForm.find({ caseId: target._id, parentFormCode: code, status: { $ne: "archived" } }).select("formCode componentCode status completion isLocked").lean();
    const selectedComponents = await CaseFormSelection.find({ caseId: target._id, parentFormCode: code, decision: "include" }).lean();
    const dependentKeys = new Map();
    dependents.forEach((item) => dependentKeys.set(identityKey(item.formCode, item.componentCode), item));
    selectedComponents.forEach((item) => { if (!dependentKeys.has(identityKey(item.formCode, item.componentCode))) dependentKeys.set(identityKey(item.formCode, item.componentCode), item); });
    if (dependentKeys.size && !input.cascadeComponents) {
      throw httpError(409, `${code} has ${dependentKeys.size} selected component form(s). Remove them too, or keep ${code}.`, "DEPENDENT_COMPONENTS", { formCode: code, components: [...dependentKeys.values()].map((item) => ({ formCode: item.formCode, componentCode: item.componentCode })) });
    }
    for (const dependent of dependentKeys.values()) {
      await removeOne(target, { formCode: dependent.formCode, componentCode: dependent.componentCode, reason: input.reason, confirm: input.confirm, acknowledgeWaiver: input.acknowledgeWaiver }, ctx);
    }
  }

  const required = !componentCode && requiredCodes.has(code);
  if (required && !input.acknowledgeWaiver) {
    throw httpError(409, `${code} is normally required by this case's filing package. Acknowledge that it is not part of this filing to remove it.`, "PACKAGE_REQUIRES_FORM", { formCode: code });
  }
  const previousStatus = form?.status || null;
  const row = await upsertRow(
    target._id,
    { formCode: code, componentCode, parentFormCode: form?.parentFormCode },
    { decision: "exclude", selectionStatus: "removed", reason: input.reason || "Removed by a Case Manager", waivedRequirement: Boolean(required), decidedBy: user?._id, decidedAt: new Date(), caseFormId: form?._id || null, revision: ctx.revision },
    { action: "exclude", decision: "exclude", reason: input.reason, by: user?._id, caseRevision: ctx.revision, meta: { previousStatus } }
  );
  if (form && form.status !== "archived") {
    // never deleted: the record, its answers, history, provenance and generated PDFs stay; it only stops counting as part of the case
    form.status = "archived";
    form.auditHistory.push(archiveEntry(user, input.reason, previousStatus));
    await form.save();
  }
  return { formCode: code, componentCode, action: "removed", status: "ok", caseFormId: form?._id || null, waivedRequirement: row.waivedRequirement };
}

async function addOne(target, input, ctx, addedKeys) {
  const { user, req } = ctx;
  const code = selection.normalizeCode(input.formCode);
  const componentCode = input.componentCode || null;
  const entry = await catalog.findEntry(code, componentCode);
  if (!entry || !entry.selectable) {
    throw httpError(422, `${code}${componentCode ? ` (${componentCode})` : ""} is not an available USCIS form${entry?.availabilityNote ? `: ${entry.availabilityNote}` : ""}`, "FORM_NOT_SELECTABLE", { formCode: code, componentCode });
  }
  const parentFormCode = entry.parentFormCode || null;
  if (componentCode) {
    const parentActive = await CaseForm.exists({ caseId: target._id, formCode: parentFormCode, componentCode: null, status: { $ne: "archived" } });
    const parentSelected = await CaseFormSelection.exists({ caseId: target._id, formCode: parentFormCode, componentCode: null, decision: "include" });
    if (!parentActive && !parentSelected && !addedKeys.has(identityKey(parentFormCode, null))) {
      throw httpError(422, `${componentCode} is part of ${parentFormCode}. Select ${parentFormCode} first.`, "DEPENDENCY_MISSING_PARENT", { formCode: code, componentCode, parentFormCode });
    }
  }
  const existing = await CaseForm.findOne({ caseId: target._id, formCode: componentCode ? entry.formCode : code, ...(componentCode ? { componentCode } : { componentCode: null }) });
  const priorRow = await CaseFormSelection.findOne({ caseId: target._id, formCode: code, componentCode }).lean();
  const restoring = priorRow?.decision === "exclude" || existing?.status === "archived";

  let caseFormId = existing?._id || null;
  let selectionStatus = "selected";
  let note = "";
  // 1. record the selection first - the creation gate reads it
  await upsertRow(
    target._id,
    { formCode: code, componentCode, parentFormCode },
    { decision: "include", selectionStatus, waivedRequirement: false, reason: input.reason || "Selected by a Case Manager", decidedBy: user?._id, decidedAt: new Date(), formTitle: entry.title, templateId: entry.templateId, editionDate: entry.editionDate, revision: ctx.revision },
    { action: restoring ? "restore" : "include", decision: "include", reason: input.reason, by: user?._id, caseRevision: ctx.revision }
  );
  // 2. the CaseForm
  if (existing && existing.status === "archived") {
    const previous = (priorRow?.history || []).filter((item) => item.action === "exclude").pop()?.meta?.previousStatus;
    existing.status = previous && previous !== "archived" ? previous : "pending";
    existing.auditHistory.push({ action: "FORM_RESTORED_TO_CASE", changes: { status: existing.status }, performedBy: user?._id, performedAt: new Date() });
    await existing.save();
    selectionStatus = "provisioned";
    note = "Restored with its earlier data.";
  } else if (existing) {
    selectionStatus = "provisioned";
  } else if (entry.availability === "no_template") {
    selectionStatus = "pending_acquisition";
    note = "Recorded. The official template still has to be imported before this form can be created.";
  } else if (!entry.provisionable) {
    selectionStatus = "pending_acquisition";
    note = "Recorded. The official template is awaiting review or activation; the form is created as soon as it is active (or when forms are next generated).";
  } else {
    const registry = require("../form-registry/visaFormMapping.service");
    const template = await registry.buildTemplateForMapping(
      componentCode
        ? { componentCode, parentForm: parentFormCode, componentType: "FORM_COMPONENT", formNumber: code, visaType: target.visaType, provisioningType: "MANUAL_SELECTION" }
        : { formTemplateFormCode: code.toLowerCase(), formNumber: code, visaType: target.visaType, provisioningType: "MANUAL_SELECTION" },
      target,
      "selected by a Case Manager"
    );
    if (!template) {
      selectionStatus = "failed";
      note = "The template could not be loaded for this form.";
    } else {
      // form creation updates the case (timeline, form references): it needs the full case document, not the partial one used for reading
      const targetDoc = await Case.findById(target._id);
      const created = await require("./uscis-form.service").ensureAssignedForms(targetDoc, user, req, { templates: [template] });
      const made = created?.[0] || await CaseForm.findOne({ caseId: target._id, formCode: template.formCode });
      if (made) { caseFormId = made._id; selectionStatus = "provisioned"; } else { selectionStatus = "failed"; note = "The form could not be created."; }
    }
  }
  await CaseFormSelection.updateOne(
    { caseId: target._id, formCode: code, componentCode },
    { $set: { selectionStatus, caseFormId }, $push: { history: { action: selectionStatus === "failed" ? "provisioning_failed" : "provisioned", decision: "include", by: user?._id, at: new Date(), caseRevision: ctx.revision } } }
  );
  addedKeys.add(identityKey(code, componentCode));
  return { formCode: code, componentCode, action: restoring ? "restored" : "added", status: selectionStatus === "failed" ? "failed" : "ok", selectionStatus, caseFormId, message: note, availability: entry.availability };
}

// Creates the forms a Case Manager selected earlier whose template was not active at the time (or whose creation failed). Called when forms are generated for a
// case; harmless to repeat. Never touches a form that already exists and never creates one the Case Manager did not include.
async function provisionPendingSelections(targetCase, user, req) {
  const control = await Case.findById(targetCase._id || targetCase).select("formSelectionMode visaType").lean();
  if (!control) return [];
  const pending = await CaseFormSelection.find({ caseId: targetCase._id || targetCase, decision: "include", selectionStatus: { $in: ["pending_acquisition", "failed"] } }).lean();
  const done = [];
  for (const row of pending) {
    try {
      const entry = await catalog.findEntry(row.formCode, row.componentCode);
      if (!entry || !entry.provisionable) continue;
      const exists = await CaseForm.exists({ caseId: row.caseId, formCode: row.componentCode ? entry.formCode : row.formCode, componentCode: row.componentCode || null, status: { $ne: "archived" } });
      if (exists) continue;
      const registry = require("../form-registry/visaFormMapping.service");
      const template = await registry.buildTemplateForMapping(
        row.componentCode
          ? { componentCode: row.componentCode, parentForm: row.parentFormCode, componentType: "FORM_COMPONENT", formNumber: row.formCode, visaType: control.visaType, provisioningType: "MANUAL_SELECTION" }
          : { formTemplateFormCode: row.formCode.toLowerCase(), formNumber: row.formCode, visaType: control.visaType, provisioningType: "MANUAL_SELECTION" },
        control,
        "selected by a Case Manager (created when the template became active)"
      );
      if (!template) continue;
      const targetDoc = await Case.findById(row.caseId);
      const made = (await require("./uscis-form.service").ensureAssignedForms(targetDoc, user, req, { templates: [template] }))?.[0];
      if (!made) continue;
      await CaseFormSelection.updateOne({ _id: row._id }, { $set: { selectionStatus: "provisioned", caseFormId: made._id }, $push: { history: { action: "provisioned", decision: "include", by: user?._id, at: new Date() } } });
      done.push({ formCode: row.formCode, componentCode: row.componentCode || null, caseFormId: made._id });
    } catch (error) {
      require("../../utils/logger").error("pending_form_selection_provisioning_failed", { caseId: String(row.caseId), formCode: row.formCode, error: error.message });
    }
  }
  return done;
}

// input: { targetCaseId, expectedRevision, add: [{formCode, componentCode?, reason?}], remove: [{formCode, componentCode?, reason?, confirm?, cascadeComponents?, acknowledgeWaiver?}], autofill?: true }
async function updateSelection(caseId, input = {}, user, req) {
  // where the time goes (the database is remote: every round trip counts) - logged once per request
  const started = Date.now();
  const stages = [];
  const mark = (name) => stages.push([name, Date.now() - started]);
  const caseData = await loadCaseForManagement(caseId, user, { write: true });
  const { target } = await resolveTarget(caseData, input.targetCaseId);
  if (!target) throw httpError(400, "Choose which case's forms to change", "TARGET_CASE_REQUIRED");
  if (!Number.isInteger(input.expectedRevision)) throw httpError(400, "expectedRevision is required (read the selection first)", "REVISION_REQUIRED");
  const adds = Array.isArray(input.add) ? input.add : [];
  const removes = Array.isArray(input.remove) ? input.remove : [];
  if (!adds.length && !removes.length) throw httpError(400, "Nothing to change");

  const before = await Case.findById(target._id).select("formSelectionRevision formSelectionMode visaType").lean();
  if ((before?.formSelectionRevision || 0) !== input.expectedRevision) {
    throw httpError(409, "The form selection was changed by someone else. Reload it and try again.", "STALE_SELECTION_REVISION", { currentRevision: before?.formSelectionRevision || 0 });
  }
  // baseline first (a legacy case keeps every form it already has), then claim the revision atomically
  await selection.ensureManualBaseline(target, user);
  const current = await Case.findById(target._id).select("formSelectionRevision").lean();
  const claimed = await Case.findOneAndUpdate({ _id: target._id, formSelectionRevision: current.formSelectionRevision }, { $inc: { formSelectionRevision: 1 }, $set: { formSelectionMode: "manual" } }, { new: true }).select("formSelectionRevision visaType").lean();
  if (!claimed) throw httpError(409, "The form selection was changed by someone else. Reload it and try again.", "STALE_SELECTION_REVISION", { currentRevision: current.formSelectionRevision });

  // which forms the filing package requires only matters to a REMOVAL (it asks for a waiver); an add-only change skips that (slow) package lookup
  mark("claimed");
  const ctx = { user, req, role: roleOf(user), revision: claimed.formSelectionRevision, requiredCodes: removes.length ? await requiredByPackage(caseData) : new Set() };
  target.visaType = target.visaType || claimed.visaType;
  const results = [];
  const addedKeys = new Set();
  // removes first, then adds, so "swap one form for another" works in one request; each item reports its own outcome
  for (const item of removes) {
    try { results.push(await removeOne(target, item, ctx)); } catch (error) {
      results.push({ formCode: item.formCode, componentCode: item.componentCode || null, action: "remove", status: "failed", code: error.code, message: error.message, details: error.details });
    }
  }
  for (const item of adds) {
    try {
      // a typed name ("I-765", "employment authorization") is resolved to ONE catalogue form here; an ambiguous name is refused with the candidates
      let resolved = item;
      if (!item.formCode && item.name) {
        const { match, candidates } = await catalog.resolveTypedForm(item.name);
        if (!match) throw httpError(409, candidates.length ? `"${item.name}" matches more than one form. Choose one.` : `No USCIS form matches "${item.name}".`, candidates.length ? "AMBIGUOUS_FORM_NAME" : "FORM_NOT_FOUND", { candidates: candidates.map((entry) => ({ formCode: entry.formCode, componentCode: entry.componentCode, title: entry.title })) });
        resolved = { ...item, formCode: match.kind === "component" ? match.parentFormCode : match.formCode, componentCode: match.kind === "component" ? match.componentCode : null };
        if (match.kind === "component") resolved.formCode = match.formCode;
      }
      results.push(await addOne(target, resolved, ctx, addedKeys));
    } catch (error) {
      results.push({ formCode: item.formCode || item.name, componentCode: item.componentCode || null, action: "add", status: "failed", code: error.code, message: error.message, details: error.details });
    }
  }
  mark("forms_changed");
  // send the forms' own checklists to THIS case (opt-in; the case's normal checklist approval flow applies) so the client can provide what the form needs
  const assignedChecklists = [];
  const explicitKeys = (Array.isArray(input.assignChecklistKeys) ? input.assignChecklistKeys : []).map((key) => selection.baseKeyOf(String(key).trim())).filter(Boolean);
  if (input.assignChecklists || explicitKeys.length) {
    const held = await caseChecklistKeys(target._id).catch(() => []);
    const wanted = new Map(explicitKeys.map((key) => [key, { key, title: key }]));
    if (input.assignChecklists) {
      for (const result of results.filter((item) => item.action !== "removed" && item.status === "ok")) {
        for (const suggestion of await suggestedChecklistsFor(target, result.formCode, held).catch(() => [])) wanted.set(suggestion.key, suggestion);
      }
    }
    {
      for (const suggestion of wanted.values()) {
        try {
          const Questionnaire = require("../../models/Questionnaire");
          const questionnaire = await Questionnaire.findOne({ key: suggestion.key, latestVersion: true, status: { $ne: "archived" } });
          if (!questionnaire) continue;
          const outcome = await require("../questionnaires/checklist-usage.service").assignToCase(questionnaire._id, { caseId: target._id }, user, req);
          assignedChecklists.push({ key: suggestion.key, title: suggestion.title, alreadyAssigned: Boolean(outcome.alreadyAssigned) });
          held.push({ key: suggestion.key });
        } catch (error) {
          assignedChecklists.push({ key: suggestion.key, title: suggestion.title, error: error.message });
        }
      }
    }
  }
  mark("checklists");
  // fill the newly created forms from what the case already holds (never for a case with unresolved data conflicts - the same rule "Generate USCIS Forms" applies)
  const autofill = [];
  if (input.autofill !== false) {
    const control = await Case.findById(target._id).select("canonicalProfile.conflicts").lean();
    const blocked = (control?.canonicalProfile?.conflicts || []).some((conflict) => conflict?.status === "pending_review");
    const fresh = results.filter((item) => item.action === "added" && item.status === "ok" && item.caseFormId);
    if (fresh.length && blocked) {
      fresh.forEach((item) => autofill.push({ formCode: item.formCode, componentCode: item.componentCode, status: "skipped", message: "Resolve the case's data conflicts first; the form was created but not filled." }));
    } else if (fresh.length) {
      const filled = await autofillSelected(caseId, { targetCaseId: target._id, forms: fresh.map((item) => ({ formCode: item.formCode, componentCode: item.componentCode })) }, user, req);
      autofill.push(...filled.results);
    }
  }
  mark("autofill");
  const refreshed = await getSelection(caseId, { targetCaseId: target._id }, user);
  mark("selection_reloaded");
  require("../../utils/logger").info("case_form_selection_update_timing", { caseId: String(caseId), adds: adds.length, removes: removes.length, autofill: input.autofill !== false, totalMs: Date.now() - started, stagesMs: stages });
  return { results, assignedChecklists, autofill, partial: results.some((result) => result.status === "failed"), revision: ctx.revision, selection: refreshed };
}

// Re-fills forms on the target case from the canonical data (the existing autofill; reviewed and manually edited values are never overwritten).
async function autofillSelected(caseId, { targetCaseId, forms } = {}, user, req) {
  const caseData = await loadCaseForManagement(caseId, user, { write: true });
  const { target } = await resolveTarget(caseData, targetCaseId);
  if (!target) throw httpError(400, "Choose which case's forms to fill", "TARGET_CASE_REQUIRED");
  const AutoFillService = require("../form-mapping/services/AutoFillService");
  const wanted = Array.isArray(forms) && forms.length ? new Set(forms.map((form) => identityKey(form.formCode, form.componentCode))) : null;
  const caseForms = await CaseForm.find({ caseId: target._id, ...selection.ACTIVE_FORM_FILTER }).select("formCode componentCode versionNumber status").lean();
  const results = [];
  for (const form of caseForms) {
    if (wanted && !wanted.has(identityKey(form.formCode, form.componentCode))) continue;
    try {
      const generated = await AutoFillService.generate(target._id, form.formCode, user, req, { regenerate: (form.versionNumber || 0) > 0 });
      results.push({ formCode: form.formCode, componentCode: form.componentCode || null, status: "filled", completion: generated?.caseForm?.completion || null, report: generated?.caseForm?.autoFillReport || null });
    } catch (error) {
      results.push({ formCode: form.formCode, componentCode: form.componentCode || null, status: "failed", code: error.code, message: error.message });
    }
  }
  return { results, partial: results.some((result) => result.status === "failed") };
}

module.exports = { provisionPendingSelections, getFormChecklistCoverage, MANAGE_ROLES, removalRule, hasEnteredData, getSelection, updateSelection, autofillSelected, loadCaseForManagement, resolveTarget };
