const Answer = require("../../models/Answer");
const Question = require("../../models/Question");
const Questionnaire = require("../../models/Questionnaire");
const questionLibraryService = require("./question-library.service");
const questionnaireService = require("./questionnaire.service");
const caseService = require("../cases/case.service");

function listFilter(query) {
  const filter = {};
  if (query.status) filter.status = query.status;
  if (query.module) filter.module = query.module;
  if (query.category) filter.category = query.category;
  if (query.key) filter.key = query.key;
  if (query.visaType) filter.visaTypes = query.visaType;
  if (query.type) filter.type = query.type;
  if (query.isTemplate !== undefined) filter.isTemplate = query.isTemplate === "true";
  // Without this the list returns every historical version of every
  // checklist, which (sorted by key, capped by `limit`) pushed later
  // checklists off the end of the Questionnaire page.
  if (query.latestVersion !== undefined) filter.latestVersion = query.latestVersion === "true";
  if (query.search) {
    filter.$or = [
      { title: new RegExp(query.search, "i") },
      { key: new RegExp(query.search, "i") },
      { description: new RegExp(query.search, "i") },
      { tags: new RegExp(query.search, "i") },
    ];
  }
  return filter;
}

async function findQuestionnaire(id, res) {
  const questionnaire = await Questionnaire.findById(id);
  if (!questionnaire) {
    res.status(404).json({ success: false, message: "Questionnaire not found" });
    return null;
  }
  return questionnaire;
}

exports.getQuestionnaires = async (req, res, next) => {
  try {
    if (!questionnaireService.canReadQuestionnaires(req.user)) return res.status(403).json({ success: false, message: "Not authorized to read questionnaires" });
    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
    const skip = (page - 1) * limit;
    const filter = listFilter(req.query);
    const [questionnaires, total] = await Promise.all([
      Questionnaire.find(filter).sort({ key: 1, version: -1 }).skip(skip).limit(limit),
      Questionnaire.countDocuments(filter),
    ]);
    res.json({ success: true, count: questionnaires.length, total, page, pages: Math.ceil(total / limit), data: questionnaires });
  } catch (error) {
    next(error);
  }
};

exports.getLibrary = async (req, res, next) => {
  try {
    const questionnaires = await questionnaireService.getLibrary(req.query);
    res.json({ success: true, count: questionnaires.length, data: questionnaires });
  } catch (error) {
    next(error);
  }
};

exports.getQuestionLibrary = async (req, res, next) => {
  try {
    const result = await questionLibraryService.list(req.query, req.user);
    res.json({ success: true, count: result.items.length, ...result, data: result.items });
  } catch (error) {
    next(error);
  }
};

exports.getQuestionLibraryItem = async (req, res, next) => {
  try {
    const item = await questionLibraryService.get(req.params.itemId, req.user);
    res.json({ success: true, item, data: item });
  } catch (error) {
    next(error);
  }
};

exports.synchronizeQuestionLibrary = async (req, res, next) => {
  try {
    const report = await questionLibraryService.synchronize(req.body || {}, req.user, req);
    res.json({ success: true, report, data: report });
  } catch (error) {
    next(error);
  }
};

exports.createCustomLibraryQuestion = async (req, res, next) => {
  try {
    const item = await questionLibraryService.createCustom(req.body || {}, req.user, req);
    res.status(201).json({ success: true, item, data: item });
  } catch (error) {
    next(error);
  }
};

exports.ensureDefaultTemplates = async (req, res, next) => {
  try {
    // POST /defaults/seed is an explicit "reconcile now" admin trigger — skip
    // the reconciliation cache so the change is visible immediately, not
    // after up to ENSURE_TTL_MS. GET /defaults (a lighter "make sure these
    // exist" check) uses the cache like any other caller.
    const templates = await questionnaireService.ensureDefaultVisaTemplates(req.user, req, { force: req.method === "POST" });
    res.json({ success: true, count: templates.length, data: templates });
  } catch (error) {
    next(error);
  }
};

exports.getCaseQuestionnaire = async (req, res, next) => {
  try {
    const result = await questionnaireService.getQuestionnaireForCase(req.params.caseId, req.user, req.query.targetRole, { participantId: req.query.participantId, referenceId: req.query.referenceId });
    res.json({ success: true, data: result });
  } catch (error) {
    // A role-scoped probe (targetRole given) asking "does this case have a
    // questionnaire for this role" is an expected, legitimate "no" for most
    // role/visa combinations (e.g. Admin's Business Plan/E-2 Supporting
    // Documents panels querying every case regardless of visa type to see if
    // they apply) — not a real error. Answering it with a 404 makes the
    // browser itself log a scary "GET ... 404 (Not Found)" to the console on
    // every single case that simply doesn't use that role, even though the
    // UI already handles a null questionnaire perfectly (the panel just
    // doesn't render). A caller with no targetRole is asking "what IS the
    // questionnaire for this case" — there a missing template is still a
    // real 404.
    if (req.query.targetRole && error.status === 404) {
      return res.json({ success: true, data: { questionnaire: null, questions: [], documentQuestions: [], fieldQuestions: [], answers: [] } });
    }
    next(error);
  }
};

exports.listCaseChecklists = async (req, res, next) => {
  try {
    const result = await questionnaireService.listCaseChecklists(req.params.caseId, req.user);
    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
};

exports.getQuestionnaire = async (req, res, next) => {
  try {
    const questionnaire = await findQuestionnaire(req.params.id, res);
    if (!questionnaire) return;
    const questions = await Question.find({ questionnaire: questionnaire._id }).sort({ pageKey: 1, sectionKey: 1, order: 1 });
    res.json({ success: true, data: { questionnaire, questions } });
  } catch (error) {
    next(error);
  }
};

exports.createQuestionnaire = async (req, res, next) => {
  try {
    const questionnaire = await questionnaireService.createQuestionnaire(req.body, req.user, req);
    res.status(201).json({ success: true, data: questionnaire });
  } catch (error) {
    next(error);
  }
};

exports.importQuestionnaire = async (req, res, next) => {
  try {
    const questionnaire = await questionnaireService.importQuestionnaire(req.body, req.user, req);
    res.status(201).json({ success: true, data: questionnaire });
  } catch (error) {
    next(error);
  }
};

exports.generateQuestionnaire = async (req, res, next) => {
  try {
    const questionnaire = await questionnaireService.generateQuestionnaireFromPrompt(req.body, req.user, req);
    res.status(201).json({ success: true, data: questionnaire });
  } catch (error) {
    next(error);
  }
};

exports.updateQuestionnaire = async (req, res, next) => {
  try {
    const questionnaire = await findQuestionnaire(req.params.id, res);
    if (!questionnaire) return;
    const updated = await questionnaireService.updateQuestionnaire(questionnaire, req.body, req.user, req);
    res.json({ success: true, data: updated });
  } catch (error) {
    next(error);
  }
};

exports.deleteQuestionnaire = async (req, res, next) => {
  try {
    const questionnaire = await findQuestionnaire(req.params.id, res);
    if (!questionnaire) return;
    const updated = await questionnaireService.updateQuestionnaire(questionnaire, { status: "archived", isActive: false }, req.user, req);
    res.json({ success: true, message: "Questionnaire template archived", data: updated });
  } catch (error) {
    next(error);
  }
};

exports.requestApproval = async (req, res, next) => {
  try {
    const questionnaire = await findQuestionnaire(req.params.id, res);
    if (!questionnaire) return;
    const updated = await questionnaireService.requestApproval(questionnaire, req.body, req.user, req);
    res.json({ success: true, data: updated });
  } catch (error) {
    next(error);
  }
};

exports.approveDefinition = async (req, res, next) => {
  try {
    const questionnaire = await findQuestionnaire(req.params.id, res);
    if (!questionnaire) return;
    const updated = await questionnaireService.approveQuestionnaireDefinition(questionnaire, req.body, req.user, req);
    res.json({ success: true, data: updated });
  } catch (error) {
    next(error);
  }
};

exports.publishQuestionnaire = async (req, res, next) => {
  try {
    const questionnaire = await findQuestionnaire(req.params.id, res);
    if (!questionnaire) return;
    const updated = await questionnaireService.publishQuestionnaire(questionnaire, req.user, req);
    res.json({ success: true, data: updated });
  } catch (error) {
    next(error);
  }
};

exports.createVersion = async (req, res, next) => {
  try {
    const questionnaire = await findQuestionnaire(req.params.id, res);
    if (!questionnaire) return;
    const nextVersion = await questionnaireService.createNewVersion(questionnaire, req.user, req);
    res.status(201).json({ success: true, data: nextVersion });
  } catch (error) {
    next(error);
  }
};

exports.cloneQuestionnaire = async (req, res, next) => {
  try {
    const questionnaire = await findQuestionnaire(req.params.id, res);
    if (!questionnaire) return;
    const clone = await questionnaireService.cloneQuestionnaire(questionnaire, req.body, req.user, req);
    res.status(201).json({ success: true, data: clone });
  } catch (error) {
    next(error);
  }
};

exports.exportQuestionnaire = async (req, res, next) => {
  try {
    const questionnaire = await findQuestionnaire(req.params.id, res);
    if (!questionnaire) return;
    const exported = await questionnaireService.exportQuestionnaire(questionnaire, req.user, req);
    res.json({ success: true, data: exported });
  } catch (error) {
    next(error);
  }
};

exports.createQuestion = async (req, res, next) => {
  try {
    const questionnaire = await findQuestionnaire(req.params.id, res);
    if (!questionnaire) return;
    const question = await questionnaireService.createQuestion(questionnaire, req.body, req.user, req);
    res.status(201).json({ success: true, data: question });
  } catch (error) {
    next(error);
  }
};

exports.bulkCreateQuestions = async (req, res, next) => {
  try {
    const questionnaire = await findQuestionnaire(req.params.id, res);
    if (!questionnaire) return;
    const questions = await questionnaireService.bulkCreateQuestions(questionnaire, req.body, req.user, req);
    res.status(201).json({ success: true, count: questions.length, data: questions });
  } catch (error) {
    next(error);
  }
};

exports.updateQuestion = async (req, res, next) => {
  try {
    const question = await Question.findById(req.params.questionId);
    if (!question) return res.status(404).json({ success: false, message: "Question not found" });
    const updated = await questionnaireService.updateQuestion(question, req.body, req.user, req);
    res.json({ success: true, data: updated });
  } catch (error) {
    next(error);
  }
};

exports.deleteQuestion = async (req, res, next) => {
  try {
    const question = await Question.findById(req.params.questionId);
    if (!question) return res.status(404).json({ success: false, message: "Question not found" });
    await questionnaireService.updateQuestion(question, { active: false }, req.user, req);
    res.json({ success: true, message: "Question deactivated" });
  } catch (error) {
    next(error);
  }
};

exports.reorderQuestionnaire = async (req, res, next) => {
  try {
    const questionnaire = await findQuestionnaire(req.params.id, res);
    if (!questionnaire) return;
    const updated = await questionnaireService.reorderQuestionnaire(questionnaire, req.body, req.user, req);
    res.json({ success: true, data: updated });
  } catch (error) {
    next(error);
  }
};

exports.lockQuestionnaire = async (req, res, next) => {
  try {
    const questionnaire = await findQuestionnaire(req.params.id, res);
    if (!questionnaire) return;
    const updated = await questionnaireService.lockQuestionnaire(questionnaire, req.body, req.user, req);
    res.json({ success: true, data: updated });
  } catch (error) {
    next(error);
  }
};

exports.unlockQuestionnaire = async (req, res, next) => {
  try {
    const questionnaire = await findQuestionnaire(req.params.id, res);
    if (!questionnaire) return;
    const updated = await questionnaireService.unlockQuestionnaire(questionnaire, req.user, req);
    res.json({ success: true, data: updated });
  } catch (error) {
    next(error);
  }
};

exports.addComment = async (req, res, next) => {
  try {
    const questionnaire = await findQuestionnaire(req.params.id, res);
    if (!questionnaire) return;
    const comment = await questionnaireService.addComment(questionnaire, req.body, req.user, req);
    res.status(201).json({ success: true, data: comment });
  } catch (error) {
    next(error);
  }
};

exports.assignQuestionnaire = async (req, res, next) => {
  try {
    const questionnaire = await findQuestionnaire(req.params.id, res);
    if (!questionnaire) return;
    const result = await questionnaireService.assignQuestionnaire(questionnaire, req.body, req.user, req);
    res.status(201).json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
};

exports.getVisibleQuestions = async (req, res, next) => {
  try {
    const result = await questionnaireService.getVisibleQuestions(req.params.id, req.query.responseId, req.user);
    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
};

exports.autoSaveAnswers = async (req, res, next) => {
  try {
    const result = await questionnaireService.saveAnswers({ ...req.body, questionnaireId: req.params.id }, req.user, req, "auto_saved");
    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
};

// A multipart (file-answer) request always arrives with string form fields
// (multer never coerces types), while a plain JSON POST body is parsed to a
// real boolean by express.json() - accept either so both callers work.
function isPreserveStatusRequested(body) {
  return body?.preserveStatus === true || body?.preserveStatus === "true";
}

exports.saveAnswer = async (req, res, next) => {
  try {
    // Case managers/admins correcting a client's already-submitted or
    // already-approved answer must never silently reset it to "auto_saved" —
    // only a staff caller explicitly requesting it (preserveStatus) gets the
    // status-preserving path; the client's own save/autosave calls (no such
    // flag) are entirely unaffected.
    const staffPreserve = caseService.isStaff(req.user) && isPreserveStatusRequested(req.body);
    const status = staffPreserve ? questionnaireService.PRESERVE_ANSWER_STATUS : "auto_saved";
    const result = await questionnaireService.saveAnswers({ ...req.body, questionnaireId: req.params.id }, req.user, req, status);
    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
};

exports.saveFileAnswer = async (req, res, next) => {
  try {
    const staffPreserve = caseService.isStaff(req.user) && isPreserveStatusRequested(req.body);
    const result = await questionnaireService.saveFileAnswer({ ...req.body, questionnaireId: req.params.id }, req.files || [], req.user, req, { preserveStatus: staffPreserve });
    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
};

exports.getAnswers = async (req, res, next) => {
  try {
    const result = await questionnaireService.getAnswers({ ...req.query, questionnaireId: req.params.id }, req.user);
    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
};

exports.getProgress = async (req, res, next) => {
  try {
    const result = await questionnaireService.getProgress({ ...req.query, questionnaireId: req.params.id }, req.user);
    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
};

exports.validateAnswers = async (req, res, next) => {
  try {
    const result = await questionnaireService.validateAnswers({ ...req.query, ...req.body, questionnaireId: req.params.id }, req.user);
    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
};

exports.generateDocumentRequests = async (req, res, next) => {
  try {
    const result = await questionnaireService.generateDocumentRequestsForResponse({ ...req.body, questionnaireId: req.params.id }, req.user, req);
    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
};

exports.getUscisMappings = async (req, res, next) => {
  try {
    const mappings = await questionnaireService.getUscisMappings(req.params.id);
    res.json({ success: true, count: mappings.length, data: mappings });
  } catch (error) {
    next(error);
  }
};

exports.getVisaOptions = async (req, res, next) => {
  try {
    res.json({ success: true, data: questionnaireService.listVisaOptions() });
  } catch (error) {
    next(error);
  }
};

exports.getVisaMappings = async (req, res, next) => {
  try {
    res.json({ success: true, data: await questionnaireService.listVisaMappings(req.params.id) });
  } catch (error) {
    next(error);
  }
};

exports.addVisaMapping = async (req, res, next) => {
  try {
    res.status(201).json({ success: true, data: await questionnaireService.addVisaMapping(req.params.id, req.body?.visaType, req.user, req) });
  } catch (error) {
    next(error);
  }
};

exports.removeVisaMapping = async (req, res, next) => {
  try {
    res.json({ success: true, data: await questionnaireService.removeVisaMapping(req.params.id, req.params.visaType, req.user, req) });
  } catch (error) {
    next(error);
  }
};

exports.submitAnswers = async (req, res, next) => {
  try {
    const result = await questionnaireService.submitResponse({ ...req.body, questionnaireId: req.params.id }, req.user, req);
    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
};

exports.getResponse = async (req, res, next) => {
  try {
    if (!(await questionnaireService.canAccessResponse(req.user, req.params.responseId))) {
      return res.status(403).json({ success: false, message: "Not authorized to access this questionnaire response" });
    }
    const answers = await Answer.find({ responseId: req.params.responseId }).populate("question questionnaire").sort({ updatedAt: -1 });
    if (!answers.length) return res.status(404).json({ success: false, message: "Questionnaire response not found" });
    res.json({ success: true, data: { responseId: req.params.responseId, answers } });
  } catch (error) {
    next(error);
  }
};

exports.approveResponse = async (req, res, next) => {
  try {
    if (!(await questionnaireService.canAccessResponse(req.user, req.params.responseId))) {
      return res.status(403).json({ success: false, message: "Not authorized to review this questionnaire response" });
    }
    const answers = await questionnaireService.approveResponse(req.params.responseId, req.body, req.user, req);
    res.json({ success: true, data: { responseId: req.params.responseId, answers } });
  } catch (error) {
    next(error);
  }
};

exports.getAnalytics = async (req, res, next) => {
  try {
    const questionnaire = await findQuestionnaire(req.params.id, res);
    if (!questionnaire) return;
    const statusCounts = await Answer.aggregate([
      { $match: { questionnaire: questionnaire._id } },
      { $group: { _id: { responseId: "$responseId", status: "$status" } } },
      { $group: { _id: "$_id.status", count: { $sum: 1 } } },
    ]);
    const averageCompletion = await Answer.aggregate([
      { $match: { questionnaire: questionnaire._id } },
      { $group: { _id: "$responseId", percent: { $max: "$completion.percent" } } },
      { $group: { _id: null, average: { $avg: "$percent" }, responses: { $sum: 1 } } },
    ]);
    res.json({ success: true, data: { questionnaire: questionnaire.analytics, statusCounts, averageCompletion: averageCompletion[0] || { average: 0, responses: 0 } } });
  } catch (error) {
    next(error);
  }
};
