import { useMemo } from "react";
import useQuestionnaireAnswers from "../../hooks/useQuestionnaireAnswers";
import ChecklistItemRow from "../checklist/ChecklistItemRow";
import QuestionInput, { AutofillButton } from "./QuestionInput";
import PrefillBadge from "../PrefillBadge";
import { questionKey, sectionKey, matchingAutofillSources } from "../../utils/questionnaireEngine";
import { fieldItemStatus, STATUS } from "../../utils/checklistStatus";

// Renders ONE case document's ONE targetRole questionnaire through the exact
// same card UI (ChecklistItemRow: FIELD/DOCUMENT badge, REQUIRED/OPTIONAL,
// status chip) and OCR autofill wiring (AutofillButton/PrefillBadge) the
// original single-Case employer_employee flow already used — reusing
// useQuestionnaireAnswers as-is, just parameterized per Case document instead
// of per role-on-one-shared-case. This is what makes per-employee data
// isolation fall out for free: each child Case has its own `caseId`, so its
// Answer documents (keyed by responseId, which embeds caseId) never overlap
// with a sibling's or the principal's — see PHASE_9/bridge report for why
// this works without changing questionnaire.service.js or
// case-participant.service.js at all.
//
// Split into a presentational view (below) plus this hook-calling
// convenience wrapper so a caller that already needs the same
// useQuestionnaireAnswers(caseId, targetRole) result for its own purposes
// (e.g. PrincipalCaseWorkspace gating the data-entry-mode modal on whether
// the employer has started answering) can call the hook once and pass it
// down, instead of this component fetching the same case+role a second time
// — useCaseQuestionnaire has no request cache of its own.
export function CaseRoleChecklistView({ qa, caseId, readOnly = false }) {
  const {
    questionnaire, loading, error, sections, questionsBySection, answers, answerByKey,
    prefillMeta, savingKey, saveAnswer, saveFiles, commitAll, handleAutofillResult,
    overallCompletion, missingRequiredCount, dirty, saveState, lastSavedAt, statusMessage,
  } = qa;

  const sectionsWithItems = useMemo(() => sections.map((section) => {
    const key = sectionKey(section);
    const questions = questionsBySection.get(key) || [];
    return { key, title: section.title, questions, autofillSources: matchingAutofillSources(questions) };
  }).filter((section) => section.questions.length > 0), [sections, questionsBySection]);

  if (loading) return <p className="text-sm text-slate-400">Loading…</p>;
  if (error) return <p className="text-sm text-red-600">{error.message || "Unable to load this checklist."}</p>;
  if (!questionnaire) return <p className="text-sm text-slate-400">No checklist is available for this visa type yet.</p>;

  return (
    <div className="space-y-6">
      {!readOnly && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-5 py-4">
          <div>
            <p className="text-sm font-bold text-slate-900">{questionnaire.title}</p>
            <p className="text-xs text-slate-500 mt-0.5">
              {overallCompletion}% complete
              {missingRequiredCount > 0 && ` · ${missingRequiredCount} required item${missingRequiredCount === 1 ? "" : "s"} remaining`}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-slate-400">
              {saveState === "saving" ? "Saving…" : saveState === "error" ? "Save failed" : dirty ? "Unsaved changes" : lastSavedAt ? `Saved at ${lastSavedAt}` : ""}
            </span>
            <button
              type="button"
              onClick={commitAll}
              disabled={!dirty || saveState === "saving"}
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-bold text-white hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Save progress
            </button>
          </div>
          {statusMessage && <p className="w-full text-xs text-slate-500">{statusMessage}</p>}
        </div>
      )}

      {sectionsWithItems.map((section) => (
        <section key={section.key}>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">{section.title}</h2>
            <span className="text-xs font-semibold text-slate-400">
              {section.questions.filter((q) => fieldItemStatus(answerByKey.get(questionKey(q)), answers[questionKey(q)]).status !== STATUS.NOT_STARTED).length}/{section.questions.length} complete
            </span>
          </div>

          {!readOnly && section.autofillSources.length > 0 && (
            <div className="mb-3 flex flex-wrap gap-2">
              {section.autofillSources.map((documentType) => (
                <AutofillButton key={documentType} documentType={documentType} caseId={caseId} disabled={!caseId} onUploaded={handleAutofillResult} />
              ))}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
            {section.questions.map((question) => {
              const key = questionKey(question);
              const value = answers[key] ?? question.defaultValue ?? "";
              const { status, reason } = fieldItemStatus(answerByKey.get(key), value);
              return (
                <ChecklistItemRow
                  key={key}
                  id={key}
                  type={question.type === "file" ? "document" : "field"}
                  label={question.label}
                  help={question.description}
                  required={question.required}
                  status={status}
                  statusReason={reason}
                  savingLabel={savingKey === key ? "Saving…" : undefined}
                >
                  <QuestionInput
                    question={question}
                    value={value}
                    disabled={readOnly}
                    saving={savingKey === key}
                    onChange={(nextValue) => saveAnswer(question, nextValue)}
                    onFileChange={(uploadedFiles) => saveFiles(question, uploadedFiles)}
                  />
                  {!readOnly && (
                    <PrefillBadge
                      meta={prefillMeta[key]}
                      onAccept={() => saveAnswer(question, value)}
                      onReject={() => saveAnswer(question, "")}
                    />
                  )}
                </ChecklistItemRow>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

export default function CaseRoleChecklist({ caseId, targetRole, readOnly = false }) {
  const qa = useQuestionnaireAnswers(caseId, targetRole, { disabled: readOnly });
  return <CaseRoleChecklistView qa={qa} caseId={caseId} readOnly={readOnly} />;
}
