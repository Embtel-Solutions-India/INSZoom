// Case Manager control over which USCIS forms a case has (docs/CASE_MANAGER_CONTROLLED_USCIS_FORMS_AND_AUTOFILL.md).
//
// ONE authority check - isFormAllowed / filterAllowedTemplates - that every path able to create a CaseForm goes through
// (ensureAssignedForms, createCaseForm, AutoFillService.generate, OnDemandFormAcquisitionService). The rules:
//
//   * an explicit EXCLUDE selection always wins, in every mode, over every automatic rule (template scan, registry, hard-coded conditionals,
//     checklists, GHL, scripts). A component whose parent form is excluded is excluded too unless it was explicitly included.
//   * "legacy" mode (the default, every existing case): everything else behaves exactly as before.
//   * "manual" mode: only forms (and components) with an explicit INCLUDE are created. Case creation still succeeds with an empty selection.
//   * a missing selection is never read as an exclusion.
//
// Nothing here creates, edits or deletes a CaseForm; it only decides whether one may be created.

const Case = require("../../models/Case");
const CaseForm = require("../../models/CaseForm");
const CaseFormSelection = require("../../models/CaseFormSelection");

// The one definition of "a form that is active on the case": not archived. A form the Case Manager removed is archived (never deleted), so everything that
// counts a case's forms - progress, packages, petition assembly, filing - uses this and is not blocked by a form that is no longer part of the case.
const ACTIVE_FORM_FILTER = Object.freeze({ status: { $ne: "archived" } });

// a per-case copy of a checklist ("<key>__case_<id>") is the same checklist as its template
const baseKeyOf = (key) => String(key || "").split("__case_")[0];

const normalizeCode = (value) => String(value || "").trim().toUpperCase();
const normalizeComponent = (value) => (value ? String(value).trim() : null);
const keyOf = (formCode, componentCode) => `${normalizeCode(formCode)}|${normalizeComponent(componentCode) || ""}`;

function httpError(status, message, code, details) {
  const error = new Error(message);
  error.status = status;
  error.statusCode = status;
  if (code) error.code = code;
  if (details) error.details = details;
  return error;
}

// The form a template / CaseForm stands for: its own code, plus component and parent when it is an embedded component.
function identityOfTemplate(template = {}) {
  const info = template._componentInfo || {};
  return {
    formCode: normalizeCode(template.formCode || template.formNumber),
    componentCode: normalizeComponent(info.componentCode || template.componentCode),
    parentFormCode: normalizeCode(info.parentFormCode || template.parentFormCode) || null,
  };
}

// PURE. selections: array of CaseFormSelection (or lean) rows of ONE case. Returns { allowed, reason } where reason is
// "excluded" (explicit exclusion, own or parent) | "not_selected" (manual mode, no include) | null.
function decide(caseLike = {}, selections = [], identity = {}) {
  const byKey = new Map(selections.map((row) => [keyOf(row.formCode, row.componentCode), row]));
  const own = byKey.get(keyOf(identity.formCode, identity.componentCode));
  if (own?.decision === "exclude") return { allowed: false, reason: "excluded" };
  if (own?.decision === "include") return { allowed: true, reason: null };
  if (identity.componentCode && identity.parentFormCode) {
    const parent = byKey.get(keyOf(identity.parentFormCode, null));
    if (parent?.decision === "exclude") return { allowed: false, reason: "excluded" };
  }
  if (caseLike.formSelectionMode === "manual") return { allowed: false, reason: "not_selected" };
  return { allowed: true, reason: null };
}

// True when this case could have any selection at all. A case no Case Manager ever touched (revision 0, legacy) skips the query entirely, so existing
// cases pay nothing. A partially loaded case document (fields not selected) is treated as "unknown" and checked.
function mayHaveSelections(caseLike = {}) {
  if (caseLike.formSelectionMode === "manual") return true;
  if (caseLike.formSelectionRevision === undefined || caseLike.formSelectionRevision === null) return true;
  return Number(caseLike.formSelectionRevision) > 0;
}

async function loadSelections(caseId) {
  return CaseFormSelection.find({ caseId }).lean();
}

async function loadCaseControl(caseLike) {
  if (caseLike && caseLike.formSelectionMode !== undefined && caseLike.formSelectionRevision !== undefined) return caseLike;
  const fresh = await Case.findById(caseLike._id || caseLike).select("formSelectionMode formSelectionRevision").lean();
  return fresh || {};
}

async function isFormAllowed(caseLike, identity) {
  const control = await loadCaseControl(caseLike);
  if (!mayHaveSelections(control)) return { allowed: true, reason: null };
  return decide(control, await loadSelections(control._id || caseLike._id || caseLike), identity);
}

// For ensureAssignedForms: the templates this case may be given. Anything the Case Manager excluded (or, in manual mode, did not include) is left out
// and reported, never silently created.
async function filterAllowedTemplates(caseLike, templates = []) {
  if (!templates.length) return { allowed: templates, blocked: [] };
  const control = await loadCaseControl(caseLike);
  if (!mayHaveSelections(control)) return { allowed: templates, blocked: [] };
  const selections = await loadSelections(caseLike._id);
  const allowed = [];
  const blocked = [];
  for (const template of templates) {
    const identity = identityOfTemplate(template);
    const verdict = decide(control, selections, identity);
    if (verdict.allowed) allowed.push(template);
    else blocked.push({ ...identity, reason: verdict.reason });
  }
  return { allowed, blocked };
}

// Guard for the single-form creators that take no template list (createCaseForm, AutoFillService.generate): throws a 409 when not allowed.
async function assertFormAllowed(caseLike, identity) {
  const verdict = await isFormAllowed(caseLike, identity);
  if (verdict.allowed) return;
  throw httpError(
    409,
    verdict.reason === "excluded"
      ? `${identity.formCode} was removed from this case by a Case Manager. Add it back from the case's form selection first.`
      : `${identity.formCode} is not selected for this case. Select it in the case's form selection first.`,
    verdict.reason === "excluded" ? "FORM_EXCLUDED_FOR_CASE" : "FORM_NOT_SELECTED_FOR_CASE",
    { formCode: identity.formCode, componentCode: identity.componentCode || null }
  );
}

async function bumpRevision(caseId, { manual = false } = {}) {
  const update = { $inc: { formSelectionRevision: 1 } };
  if (manual) update.$set = { formSelectionMode: "manual" };
  const updated = await Case.findByIdAndUpdate(caseId, update, { new: true }).select("formSelectionMode formSelectionRevision").lean();
  return updated?.formSelectionRevision || 0;
}

// An explicit Case Manager action that puts a form on a case (single-form Add, Add decision, on-demand acquire, createCaseForm) records the selection, so
// the authority and the case agree. A case no one ever put under selection control, with no exclusion on this form, is left untouched (no behavior change).
async function recordExplicitInclude(caseLike, identity, user, reason = "Added by a Case Manager") {
  const control = await loadCaseControl(caseLike);
  const caseId = control._id || caseLike._id;
  const existing = mayHaveSelections(control) ? await CaseFormSelection.findOne({ caseId, formCode: normalizeCode(identity.formCode), componentCode: normalizeComponent(identity.componentCode) }).lean() : null;
  if (control.formSelectionMode !== "manual" && !existing) return null;
  const revision = await bumpRevision(caseId);
  const filter = { caseId, formCode: normalizeCode(identity.formCode), componentCode: normalizeComponent(identity.componentCode) };
  const apply = () => CaseFormSelection.findOneAndUpdate(
    filter,
    {
      $set: { decision: "include", selectionStatus: identity.caseFormId ? "provisioned" : "selected", waivedRequirement: false, reason, decidedBy: user?._id, decidedAt: new Date(), revision, parentFormCode: identity.parentFormCode || null, ...(identity.caseFormId ? { caseFormId: identity.caseFormId } : {}) },
      $push: { history: { action: existing?.decision === "exclude" ? "restore" : "include", decision: "include", reason, by: user?._id, at: new Date(), caseRevision: revision } },
    },
    { upsert: true, new: true }
  );
  try {
    return await apply();
  } catch (error) {
    if (error?.code === 11000) return apply(); // a concurrent writer inserted the same row first: update it instead
    throw error;
  }
}

// Switches a case to manual control. The baseline is a snapshot: an include selection for every CaseForm the case already has (archived ones are not
// included - they were already out). Idempotent; nothing is deleted or changed on any CaseForm.
async function ensureManualBaseline(caseLike, user) {
  const control = await loadCaseControl(caseLike);
  const caseId = control._id || caseLike._id;
  if (control.formSelectionMode === "manual") return { switched: false, revision: control.formSelectionRevision };
  const forms = await CaseForm.find({ caseId, status: { $ne: "archived" } }).select("formCode componentCode parentFormCode formTemplateId formEditionDate status").lean();
  for (const form of forms) {
    try {
      await CaseFormSelection.updateOne(
        { caseId, formCode: normalizeCode(form.formCode), componentCode: normalizeComponent(form.componentCode) },
        { $setOnInsert: { decision: "include", selectionStatus: "provisioned", caseFormId: form._id, templateId: form.formTemplateId, editionDate: form.formEditionDate, parentFormCode: normalizeCode(form.parentFormCode) || null, reason: "Existing form kept when the case moved to Case Manager control", decidedBy: user?._id, decidedAt: new Date(), history: [{ action: "baseline", decision: "include", by: user?._id, at: new Date() }] } },
        { upsert: true }
      );
    } catch (error) {
      if (error?.code !== 11000) throw error; // another request wrote the same baseline row: fine
    }
  }
  const revision = await bumpRevision(caseId, { manual: true });
  return { switched: true, revision, baselineForms: forms.length };
}

// Form codes the Case Manager removed on purpose although the filing package requires them (acknowledged): petition validation reports them as
// "waived", not "missing". Covers the case and its child cases (a container's forms live on its children).
async function waivedFormCodesForCase(caseId) {
  const parent = await Case.findById(caseId).select("childCases").lean();
  const ids = [caseId, ...((parent && parent.childCases) || [])];
  return CaseFormSelection.distinct("formCode", { caseId: { $in: ids }, decision: "exclude", waivedRequirement: true });
}

module.exports = {
  ACTIVE_FORM_FILTER,
  baseKeyOf,
  waivedFormCodesForCase,
  normalizeCode,
  keyOf,
  identityOfTemplate,
  decide,
  mayHaveSelections,
  isFormAllowed,
  filterAllowedTemplates,
  assertFormAllowed,
  recordExplicitInclude,
  ensureManualBaseline,
  bumpRevision,
  loadSelections,
  httpError,
};
