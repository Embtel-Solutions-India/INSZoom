// Employer-side checklist for each visa an employer files for (an employer_employee matter).
//
// An employee carries its OWN visa, but the employer-role questions for that visa belong to the employer matter (the
// employer answers once; the answers feed every employee's forms through the canonical layer). The matter resolves its
// own visa's employer checklist as a default, so only a DIFFERENT visa needs adding: it is attached to the matter as an
// explicit reference. On a gated case that is a DRAFT - nothing is shown or sent to the employer until a case manager
// reviews, edits and approves it in the Checklist Approval card (case-checklist.service.js), exactly like every other
// auto-assigned checklist.
//
// Generic for every visa: it takes whatever visa/sub-type the employee has, finds that visa's default employer-role
// template, and adds it if there is one (a visa with no employer-role template adds nothing - not an error). Independent
// of GHL: Add Employee, invitations and the GHL intake all call it.
//
// Additive and idempotent: it never edits or re-assigns an existing checklist, and never re-adds one the case manager
// removed or waived for this employer (checklistApproval.removed is the durable record).

const Case = require("../../models/Case");
const Questionnaire = require("../../models/Questionnaire");
const logger = require("../../utils/logger");
const { baseKey, checklistId } = require("./checklist-gate");

const EMPLOYER_ROLE = "employer";
const normalizeVisa = (value) => String(value || "").replace(/[-\s]/g, "").toUpperCase();

const service = () => require("./questionnaire.service");

async function findEmployerTemplate(visaType) {
  const visa = normalizeVisa(visaType);
  if (!visa) return null;
  const match = new RegExp(`^${visa.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i");
  const find = () => Questionnaire.findOne({
    status: { $ne: "archived" },
    isActive: { $ne: false },
    latestVersion: true,
    isDefault: true,
    checklistRole: EMPLOYER_ROLE,
    $or: [{ visaType: match }, { visaTypes: match }],
  }).sort({ version: -1 });
  let template = await find();
  if (!template) {
    // a built-in template that has not been created in the database yet (first use of this visa)
    await service().ensureTemplatesForVisa(visaType, undefined, undefined, { wait: true });
    template = await find();
  }
  return template;
}

/**
 * Make sure the employer matter has the employer-role checklist for `visaType`.
 * @returns {Promise<{status: string, checklistId?: string}>}
 *   status: "added" | "present" | "container" | "no_template" | "removed" | "not_employer" | "error"
 */
async function ensureEmployerChecklistForVisa(principalId, { visaType, petitionSubType } = {}, user, req) {
  try {
    const principal = await Case.findById(principalId);
    if (!principal || principal.caseStructure !== "employer_employee" || principal.caseRole !== "principal") return { status: "not_employer" };
    if (!normalizeVisa(visaType)) return { status: "no_template" };
    // the matter's own visa already resolves its employer checklist as a default
    if (normalizeVisa(visaType) === normalizeVisa(principal.visaType)) return { status: "container" };

    const template = await findEmployerTemplate(visaType);
    if (!template) return { status: "no_template" };

    const id = checklistId({ key: template.key, targetRole: EMPLOYER_ROLE });
    // a checklist the case manager removed or waived for this employer is never put back automatically
    if ((principal.checklistApproval?.removed || []).some((item) => item.checklistId === id)) return { status: "removed", checklistId: id };

    const assigned = await service().assignQuestionnaireIfNotActive(
      template,
      { caseData: principal, caseId: principal._id, targetRole: EMPLOYER_ROLE, message: `Complete the required ${template.title}.` },
      user || { _id: undefined, role: "super_admin" },
      req
    );
    return assigned ? { status: "added", checklistId: id } : { status: "present", checklistId: id };
  } catch (error) {
    // never lets an employer-checklist problem break the request that triggered it
    logger.error("employer_visa_checklist_failed", { principalId: String(principalId), visaType, petitionSubType, error: error.message });
    return { status: "error", error: error.message };
  }
}

/** Same, starting from an employee case (the usual trigger). */
async function ensureForEmployeeCase(childCaseId, user, req) {
  const child = await Case.findById(childCaseId).select("caseRole parentCase visaType petitionSubType").lean();
  if (!child || child.caseRole !== "employee" || !child.parentCase) return { status: "not_employer" };
  return ensureEmployerChecklistForVisa(child.parentCase, { visaType: child.visaType, petitionSubType: child.petitionSubType }, user, req);
}

/**
 * Clears the mixed-visa attention flag (set by the GHL intake) once EVERY visa on the employer is covered: its employer
 * checklist is approved, or was waived with a recorded reason, or the visa has no employer-role checklist at all.
 * A checklist that is still a draft, or was removed WITHOUT a reason, keeps the flag.
 */
async function reconcileMixedVisaFlag(principalId) {
  const principal = await Case.findById(principalId).select("caseRole visaType checklistApproval integrations.ghl.flags").lean();
  if (!principal || principal.caseRole !== "principal" || !principal.integrations?.ghl?.flags?.mixedVisa) return { cleared: false };
  const kids = await Case.find({ parentCase: principalId, caseRole: "employee", status: { $ne: "removed" } }).select("visaType").lean();
  const visas = [...new Set(kids.map((kid) => normalizeVisa(kid.visaType)).filter((visa) => visa && visa !== normalizeVisa(principal.visaType)))];
  const approvals = principal.checklistApproval?.approvals || [];
  const removed = principal.checklistApproval?.removed || [];
  for (const visa of visas) {
    const template = await findEmployerTemplate(visa);
    if (!template) continue; // no employer-role checklist for this visa: nothing to cover
    const id = checklistId({ key: template.key, targetRole: EMPLOYER_ROLE });
    // a removal overrides an earlier approval: removed with a reason = waived (covered); removed without one = not covered
    const removal = removed.find((item) => item.checklistId === id);
    const covered = removal ? Boolean(removal.reason) : approvals.some((item) => item.checklistId === id);
    if (!covered) return { cleared: false, pending: id };
  }
  await Case.updateOne({ _id: principalId }, { $set: { "integrations.ghl.flags.mixedVisa": false, "integrations.ghl.flags.needsAttention": false } });
  return { cleared: true };
}

// Whether a reference's template is the employer-role checklist for this visa (used by the visa-aware lookup).
async function referenceMatchesVisa(reference, visaType) {
  if (!reference?.questionnaireId) return false;
  const template = await Questionnaire.findById(reference.questionnaireTemplateId || reference.questionnaireId).select("visaType visaTypes").lean();
  // a template that names no visa (or a reference whose template is gone) is not visa-specific: keep today's behaviour for it
  const templateVisas = [template?.visaType, ...(template?.visaTypes || [])].map(normalizeVisa).filter(Boolean);
  if (!templateVisas.length) return true;
  return templateVisas.includes(normalizeVisa(visaType));
}

module.exports = { ensureEmployerChecklistForVisa, ensureForEmployeeCase, reconcileMixedVisaFlag, referenceMatchesVisa, findEmployerTemplate, baseKey };
