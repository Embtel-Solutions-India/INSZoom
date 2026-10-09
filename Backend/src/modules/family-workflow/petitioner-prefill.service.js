// Repeat petitioners: a petitioner who already answered their own questions on an earlier family case is not asked the
// same things again on the next one. The new case's petitioner checklist is PRE-FILLED from the earlier case:
//   - only the petitioner's own facts (canonical person.* and contact.*), never beneficiary.* or anything else;
//   - copied as ordinary initial answers on the new case (not shared storage), so the petitioner can edit them there
//     independently and nothing about the earlier case (its answers, forms, submissions) is read-write touched;
//   - never over an answer the new case already has;
//   - recorded on the new case's timeline with the source case, so where the values came from is visible.
// Independent of GHL: manual family-case creation and the GHL intake both call it. Never throws.

const Case = require("../../models/Case");
const logger = require("../../utils/logger");

const ELIGIBLE_PATH = /^(person|contact)\./;
const SYSTEM_ACTOR = { _id: undefined, role: "super_admin" };
const hasValue = (value) => value !== undefined && value !== null && !(typeof value === "string" && !value.trim()) && !(Array.isArray(value) && !value.length);

const pathOf = (question) => question?.mapping?.canonicalPath || "";

async function loadPetitionerChecklist(caseId, actor) {
  const qs = require("../questionnaires/questionnaire.service");
  try {
    return await qs.getQuestionnaireForCase(caseId, actor, "petitioner");
  } catch (error) {
    return null; // no petitioner checklist (yet) on that case
  }
}

/**
 * @returns {Promise<{status: string, copied?: number, fromCase?: string}>}
 */
async function prefillPetitionerFromEarlierCase(newCaseId, actor = SYSTEM_ACTOR) {
  try {
    const target = await Case.findById(newCaseId).select("caseNumber caseStructure petitionerUser createdAt").lean();
    if (!target || target.caseStructure !== "family" || !target.petitionerUser) return { status: "not_family" };

    const earlier = await Case.find({ _id: { $ne: target._id }, caseStructure: "family", petitionerUser: target.petitionerUser, createdAt: { $lt: target.createdAt } })
      .sort({ createdAt: -1 }).select("caseNumber").lean();
    if (!earlier.length) return { status: "no_earlier_case" };

    const fresh = await loadPetitionerChecklist(target._id, actor);
    if (!fresh?.questionnaire) return { status: "no_checklist" };
    const alreadyAnswered = new Set((fresh.answers || []).filter((answer) => hasValue(answer.value)).map((answer) => answer.questionKey));
    const freshByKey = new Map((fresh.questions || []).concat(fresh.hiddenQuestions || [], fresh.completedQuestions || []).map((question) => [question.key, question]));
    const freshByPath = new Map();
    for (const question of freshByKey.values()) {
      const path = pathOf(question);
      if (ELIGIBLE_PATH.test(path) && question.type !== "file" && !freshByPath.has(path)) freshByPath.set(path, question);
    }

    // the most recent earlier case that actually has petitioner answers
    for (const source of earlier) {
      const old = await loadPetitionerChecklist(source._id, actor);
      if (!old?.answers?.length) continue;
      const oldQuestions = new Map((old.questions || []).concat(old.hiddenQuestions || [], old.completedQuestions || []).map((question) => [question.key, question]));
      const picked = new Map();
      for (const answer of old.answers) {
        if (!hasValue(answer.value)) continue;
        const oldQuestion = oldQuestions.get(answer.questionKey);
        const path = pathOf(oldQuestion);
        if (!ELIGIBLE_PATH.test(path) || oldQuestion?.type === "file") continue;
        const targetQuestion = freshByPath.get(path) || (freshByKey.get(answer.questionKey) && ELIGIBLE_PATH.test(pathOf(freshByKey.get(answer.questionKey))) ? freshByKey.get(answer.questionKey) : null);
        if (!targetQuestion || alreadyAnswered.has(targetQuestion.key) || picked.has(targetQuestion.key)) continue;
        picked.set(targetQuestion.key, { questionKey: targetQuestion.key, value: answer.value });
      }
      if (!picked.size) continue;

      const qs = require("../questionnaires/questionnaire.service");
      await qs.saveAnswers({ caseId: target._id, questionnaireId: fresh.questionnaire._id, targetRole: "petitioner", responseId: fresh.responseId, answers: [...picked.values()] }, actor, null);
      const caseService = require("../cases/case.service");
      const caseDoc = await Case.findById(target._id);
      caseService.addTimelineEvent(caseDoc, "questionnaire", "Petitioner details pre-filled", `${picked.size} petitioner answer(s) were pre-filled from the petitioner's earlier case ${source.caseNumber}. They can be edited here independently.`, actor, { sourceCaseId: String(source._id), count: picked.size });
      await caseDoc.save();
      return { status: "prefilled", copied: picked.size, fromCase: String(source._id) };
    }
    return { status: "nothing_to_copy" };
  } catch (error) {
    logger.error("petitioner_prefill_failed", { caseId: String(newCaseId), error: error.message });
    return { status: "error", error: error.message };
  }
}

module.exports = { prefillPetitionerFromEarlierCase };
