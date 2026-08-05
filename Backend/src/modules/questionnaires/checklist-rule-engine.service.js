// Dynamic Checklist Assignment Engine: assigns or removes other Questionnaires
// (checklists) when a submitted questionnaire's answers satisfy a configured
// `checklistTriggers` rule (see Backend/src/models/Questionnaire.js). Wired
// into questionnaire.service.js's submitResponse() - evaluation happens on
// submit, not on every autosave.
//
// Reuses the existing recursive AND/OR condition evaluator (condition-evaluator.js,
// the same one question-level visibility uses) and the existing
// assignQuestionnaire() service function (questionnaire.service.js) for
// actually creating an assignment - no duplicate assignment logic here.

const Questionnaire = require("../../models/Questionnaire");
const Case = require("../../models/Case");
const Answer = require("../../models/Answer");
const { evaluateConditionGroup } = require("./condition-evaluator");
const participantService = require("../cases/case-participant.service");

// Bounds a chain of triggers (A assigns B, B's own answers already satisfy a
// trigger that assigns/removes C, ...) so a misconfigured cycle can't loop forever.
const MAX_ITERATIONS = 20;

async function resolveTargetQuestionnaire(targetQuestionnaireKey) {
  return Questionnaire.findOne({ key: targetQuestionnaireKey, isActive: { $ne: false }, latestVersion: true }).sort({ version: -1 });
}

function findActiveReference(caseData, questionnaireId) {
  return (caseData.questionnaireReferences || []).find(
    (reference) => reference.questionnaireId?.toString() === questionnaireId?.toString() && reference.active !== false
  );
}

// Mirrors ImmigrationKnowledgeEngineService.assigneeForRole - routes the
// assignment to whichever case participant the target checklist role
// actually belongs to, instead of a single flat fallback.
function assigneeForRole(caseData, role) {
  return participantService.participantAssignee(caseData, role);
}

async function applyAssign(caseData, trigger, target, user, req) {
  if (findActiveReference(caseData, target._id)) return { changed: false };
  const targetRole = trigger.targetRole || target.checklistRole || "";
  // Lazy require - questionnaire.service.js requires this file back (to call
  // evaluateChecklistTriggers from submitResponse), so a top-level require
  // here would be circular.
  const questionnaireService = require("./questionnaire.service");
  const result = await questionnaireService.assignQuestionnaire(target, {
    caseId: caseData._id,
    targetRole,
    assignedTo: assigneeForRole(caseData, targetRole),
    participantId: trigger.participantId,
    message: `Complete the required ${target.title}.`,
  }, user, req);
  return { changed: true, assignedQuestionnaireId: target._id, responseId: result.responseId };
}

async function applyRemove(caseData, trigger, target, user, req) {
  const reference = findActiveReference(caseData, target._id);
  if (!reference) return { changed: false };
  const caseService = require("../cases/case.service");
  if (["not_started", "in_progress"].includes(reference.status)) {
    reference.active = false;
    caseService.addAuditEntry(caseData, "checklist_auto_removed", `"${target.title}" automatically removed by rule "${trigger.label || trigger.key}".`, user, { questionnaireId: target._id, triggerKey: trigger.key }, req);
    await caseData.save();
    return { changed: true };
  }
  // Safety: never destroy completed/submitted/approved work - record why
  // instead of silently doing nothing.
  caseService.addAuditEntry(caseData, "checklist_auto_remove_skipped", `Rule "${trigger.label || trigger.key}" would remove "${target.title}", but it is already "${reference.status}" - left in place.`, user, { questionnaireId: target._id, triggerKey: trigger.key }, req);
  await caseData.save();
  return { changed: false };
}

async function applyTrigger(caseId, trigger, user, req) {
  const target = await resolveTargetQuestionnaire(trigger.targetQuestionnaireKey);
  if (!target) return { changed: false };
  const caseData = await Case.findById(caseId); // always fetched fresh - assignQuestionnaire() saves its own copy of the case, so a held reference here would go stale across iterations
  if (!caseData) return { changed: false };
  if (trigger.action === "assign") return applyAssign(caseData, trigger, target, user, req);
  if (trigger.action === "remove") return applyRemove(caseData, trigger, target, user, req);
  return { changed: false };
}

// Evaluates `questionnaire.checklistTriggers` against `answerMap` and applies
// any that match. Recursively re-evaluates a newly-assigned questionnaire's
// own triggers if it already has answered responses on this case (e.g. it was
// previously removed and is now being reassigned), bounded by MAX_ITERATIONS.
async function evaluateChecklistTriggers(caseId, questionnaire, answerMap, user, req) {
  const changes = [];
  const worklist = [{ questionnaire, answerMap }];
  let iterations = 0;

  while (worklist.length && iterations < MAX_ITERATIONS) {
    iterations += 1;
    const { questionnaire: currentQuestionnaire, answerMap: currentAnswerMap } = worklist.shift();
    const triggers = (currentQuestionnaire.checklistTriggers || []).filter((trigger) => trigger.active !== false);
    for (const trigger of triggers) {
      if (!evaluateConditionGroup(trigger.condition, currentAnswerMap)) continue;
      const outcome = await applyTrigger(caseId, trigger, user, req);
      if (!outcome.changed) continue;
      changes.push({ triggerKey: trigger.key, action: trigger.action, targetQuestionnaireKey: trigger.targetQuestionnaireKey });
      if (outcome.assignedQuestionnaireId && outcome.responseId) {
        const targetQuestionnaire = await Questionnaire.findById(outcome.assignedQuestionnaireId);
        if (targetQuestionnaire?.checklistTriggers?.length) {
          const priorAnswers = await Answer.find({ responseId: outcome.responseId });
          if (priorAnswers.length) {
            const priorAnswerMap = {};
            priorAnswers.forEach((answer) => { priorAnswerMap[answer.questionKey] = answer; });
            worklist.push({ questionnaire: targetQuestionnaire, answerMap: priorAnswerMap });
          }
        }
      }
    }
  }
  return { evaluated: iterations, changes };
}

module.exports = { evaluateChecklistTriggers };
