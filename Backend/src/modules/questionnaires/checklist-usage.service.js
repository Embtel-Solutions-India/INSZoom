// "Where is this checklist used" - the data behind the USCIS Mapping card of the Questionnaire page, and the actions on it.
//
//   visa types   Questionnaire.visaTypes: new cases of these visas get the checklist (add / remove: questionnaire.service addVisaMapping / removeVisaMapping)
//   forms        VisaFormMapping rows whose checklistMappings name this checklist: the form is filled in from the checklist's answers through the form's
//                field mapping. Adding one here is the same edit the Form Governance page makes (checklist-mapping.service.setChecklistMappings)
//   cases        cases that hold the checklist right now (Case.questionnaireReferences). Assigning to ONE case touches that case only - never its case type
//
// Nothing here changes how a case gets its checklists; it reads the existing links and uses the existing assignment / mapping services.

const Case = require("../../models/Case");
const Questionnaire = require("../../models/Questionnaire");
const VisaFormMapping = require("../../models/VisaFormMapping");
const { baseKey, checklistId: gateChecklistId } = require("./checklist-gate");

const CLOSED_STATUSES = ["completed", "cancelled", "closed", "archived"];
const MAX_LISTED_CASES = 100;

const service = () => require("./questionnaire.service");
const mappingService = () => require("../form-registry/checklist-mapping.service");

const normalizeVisa = (value) => String(value || "").replace(/[^a-z0-9]+/gi, "").toUpperCase();

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

async function loadQuestionnaire(id) {
  const questionnaire = await Questionnaire.findById(id);
  if (!questionnaire) throw httpError(404, "Questionnaire not found");
  return questionnaire;
}

// Every version of this checklist (a case may hold an older version than the one on screen).
async function versionIdsOf(questionnaire) {
  const root = questionnaire.rootQuestionnaire || questionnaire._id;
  const rows = await Questionnaire.find({ $or: [{ rootQuestionnaire: root }, { key: questionnaire.key }] }).select("_id").lean();
  return [...new Set([String(questionnaire._id), ...rows.map((row) => String(row._id))])];
}

async function getUsage(questionnaireId) {
  const questionnaire = await loadQuestionnaire(questionnaireId);
  const key = baseKey(questionnaire.key);
  const versionIds = await versionIdsOf(questionnaire);
  const [visaMappings, formRows, openByVisa, assigned] = await Promise.all([
    service().listVisaMappings(questionnaireId),
    VisaFormMapping.find({ active: true, "checklistMappings.checklistKey": key }).select("visaType formNumber formName formTemplateFormCode provisioningType checklistMappings").lean(),
    // open cases per visa type, counted once for every visa type (cheap: one grouped count)
    Case.aggregate([{ $match: { status: { $nin: CLOSED_STATUSES }, parentCase: null } }, { $group: { _id: "$visaType", count: { $sum: 1 } } }]),
    Case.find({ "questionnaireReferences.questionnaireId": { $in: versionIds }, "questionnaireReferences.active": { $ne: false } })
      .select("caseNumber clientName visaType status questionnaireReferences._id questionnaireReferences.questionnaireId questionnaireReferences.targetRole questionnaireReferences.active questionnaireReferences.status questionnaireReferences.sentAt")
      .sort({ _id: -1 })
      .limit(MAX_LISTED_CASES)
      .lean(),
  ]);

  const openCasesByCode = new Map();
  openByVisa.forEach((row) => openCasesByCode.set(normalizeVisa(row._id), (openCasesByCode.get(normalizeVisa(row._id)) || 0) + row.count));

  const forms = formRows.map((row) => {
    const entry = (row.checklistMappings || []).find((item) => item.checklistKey === key) || {};
    return { mappingId: row._id, visaType: row.visaType, formNumber: row.formNumber, formName: row.formName, assignmentType: entry.assignmentType || "AUTO", role: entry.role || "" };
  });

  const visaTypes = visaMappings.map((mapping) => {
    const code = normalizeVisa(mapping.visaType);
    return {
      visaType: mapping.visaType,
      removable: mapping.removable,
      openCases: openCasesByCode.get(code) || 0,
      forms: forms.filter((form) => normalizeVisa(form.visaType) === code).map((form) => ({ formNumber: form.formNumber, formName: form.formName })),
    };
  });

  const idSet = new Set(versionIds);
  const cases = assigned.map((caseData) => {
    const reference = (caseData.questionnaireReferences || []).find((item) => item.active !== false && idSet.has(String(item.questionnaireId)));
    return {
      caseId: caseData._id, caseNumber: caseData.caseNumber, clientName: caseData.clientName, visaType: caseData.visaType, status: caseData.status,
      targetRole: reference?.targetRole || "", referenceStatus: reference?.status || "", sentAt: reference?.sentAt || null,
      checklistId: gateChecklistId({ key, targetRole: reference?.targetRole || questionnaire.checklistRole || "" }),
    };
  });
  const totalCases = cases.length >= MAX_LISTED_CASES
    ? await Case.countDocuments({ "questionnaireReferences.questionnaireId": { $in: versionIds }, "questionnaireReferences.active": { $ne: false } })
    : cases.length;

  return { key, visaTypes, forms, cases, totalCases, listedCases: cases.length };
}

// Forms the checklist could be attached to: every active standalone registry row (visa type + form), optionally narrowed by a search text.
async function listFormOptions(questionnaireId, { q = "", limit = 40 } = {}) {
  const questionnaire = await loadQuestionnaire(questionnaireId);
  const key = baseKey(questionnaire.key);
  const text = String(q || "").trim();
  const filter = { active: true, componentType: "STANDALONE_FORM", formTemplateFormCode: { $ne: null } };
  if (text) {
    const escaped = text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    filter.$or = [{ formNumber: new RegExp(escaped, "i") }, { formName: new RegExp(escaped, "i") }, { visaType: new RegExp(escaped, "i") }];
  }
  const rows = await VisaFormMapping.find(filter).select("visaType formNumber formName checklistMappings").sort({ formNumber: 1, visaType: 1 }).limit(Math.min(Math.max(Number(limit) || 40, 1), 100)).lean();
  return rows.map((row) => ({
    mappingId: row._id, visaType: row.visaType, formNumber: row.formNumber, formName: row.formName,
    alreadyMapped: (row.checklistMappings || []).some((entry) => entry.checklistKey === key),
  }));
}

// Attach this checklist to a form for one visa type (the registry row). The visa type is mapped to the checklist too, so new cases of it get the
// checklist and the form reads its answers; the Form Governance page shows and edits the same link.
async function addFormMapping(questionnaireId, { mappingId, assignmentType = "AUTO" } = {}, user, req) {
  const questionnaire = await loadQuestionnaire(questionnaireId);
  const key = baseKey(questionnaire.key);
  const row = await VisaFormMapping.findById(mappingId).lean();
  if (!row || row.active === false) throw httpError(404, "That form is not in the registry");
  if (!["AUTO", "CONDITIONAL", "EXPLICIT_CM"].includes(assignmentType) || assignmentType === "CONDITIONAL") {
    throw httpError(400, "Choose Compulsory or Case manager adds it (a condition is set on the Form Governance page)");
  }
  const existing = row.checklistMappings || [];
  if (existing.some((entry) => entry.checklistKey === key)) return getUsage(questionnaireId);
  await mappingService().setChecklistMappings(row._id, {
    checklistMappings: [...existing.map((entry) => ({ checklistKey: entry.checklistKey, assignmentType: entry.assignmentType, role: entry.role || "", condition: entry.condition || null, notes: entry.notes || "" })),
      { checklistKey: key, assignmentType, role: questionnaire.checklistRole || "", condition: null, notes: "" }],
  }, user, req);
  const alreadyVisa = (await service().listVisaMappings(questionnaireId)).some((mapping) => normalizeVisa(mapping.visaType) === normalizeVisa(row.visaType));
  if (!alreadyVisa) await service().addVisaMapping(questionnaireId, row.visaType, user, req);
  return getUsage(questionnaireId);
}

async function removeFormMapping(questionnaireId, mappingId, user, req) {
  const questionnaire = await loadQuestionnaire(questionnaireId);
  const key = baseKey(questionnaire.key);
  const row = await VisaFormMapping.findById(mappingId).lean();
  if (!row) throw httpError(404, "That form mapping was not found");
  await mappingService().setChecklistMappings(row._id, {
    checklistMappings: (row.checklistMappings || []).filter((entry) => entry.checklistKey !== key)
      .map((entry) => ({ checklistKey: entry.checklistKey, assignmentType: entry.assignmentType, role: entry.role || "", condition: entry.condition || null, notes: entry.notes || "" })),
  }, user, req);
  return getUsage(questionnaireId);
}

// Assign to ONE case. A case that already holds this checklist (any version, same role) is left as it is, and a checklist a case manager earlier
// rejected for this case is released again - assigning it by hand is a deliberate decision. Everything else is the existing assignment (gating,
// notifications, case-manager approval for gated cases), unchanged.
async function assignToCase(questionnaireId, { caseId, targetRole, ...rest } = {}, user, req) {
  const questionnaire = await loadQuestionnaire(questionnaireId);
  if (!caseId) throw httpError(400, "Choose a case");
  const caseData = await Case.findById(caseId).select("questionnaireReferences checklistApproval.removed");
  if (!caseData) throw httpError(404, "Case not found");
  const role = targetRole || questionnaire.checklistRole || "";
  const key = baseKey(questionnaire.key);
  const versionIds = new Set(await versionIdsOf(questionnaire));
  const alreadyHolds = (caseData.questionnaireReferences || []).some((reference) => reference.active !== false && reference.status !== "returned"
    && (versionIds.has(String(reference.questionnaireId)) || versionIds.has(String(reference.questionnaireTemplateId || "")))
    && String(reference.targetRole || "") === String(role));
  if (alreadyHolds) return { alreadyAssigned: true };
  const checklistId = gateChecklistId({ key, targetRole: role });
  if ((caseData.checklistApproval?.removed || []).some((item) => item.checklistId === checklistId)) {
    await Case.updateOne({ _id: caseId }, { $pull: { "checklistApproval.removed": { checklistId } } });
  }
  const result = await service().assignQuestionnaire(questionnaire, { ...rest, caseId, targetRole: role }, user, req);
  return { alreadyAssigned: false, responseId: result.responseId };
}

module.exports = { getUsage, listFormOptions, addFormMapping, removeFormMapping, assignToCase };
