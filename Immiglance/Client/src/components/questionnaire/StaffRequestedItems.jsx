import { useMemo } from "react";
import useCaseChecklists from "../../hooks/useCaseChecklists";
import useQuestionnaireAnswers from "../../hooks/useQuestionnaireAnswers";
import QuestionInput from "./QuestionInput";
import { questionKey, isEmptyValue } from "../../utils/questionnaireEngine";

// One "Additional Requested Information" checklist (created when a case
// manager requests a document/answer from this user, see Backend
// modules/information-requests). Rows are ordinary questions, so answers and
// uploads use the same save/Add-entry/storage pipeline as every other row.
function RequestedChecklist({ caseId, checklist }) {
  const qa = useQuestionnaireAnswers(caseId, checklist.targetRole, { referenceId: checklist.referenceId });
  const questions = qa.visibleQuestions || [];
  const pending = useMemo(
    () => questions.filter((question) => isEmptyValue(qa.answers[questionKey(question)]) && !(qa.answerByKey?.get(questionKey(question))?.files || []).length).length,
    [questions, qa.answers, qa.answerByKey]
  );
  if (qa.loading && !questions.length) return null;
  if (!questions.length) return null;

  return (
    <section className="rounded-2xl border border-border bg-card shadow-sm" aria-labelledby={`staff-requests-${checklist.referenceId}`}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3 sm:px-6">
        <div>
          <h2 id={`staff-requests-${checklist.referenceId}`} className="text-base font-semibold text-foreground">Requested by your case manager</h2>
          <p className="text-xs text-muted-foreground">Please provide the items below. Save when you are done and your case manager is notified.</p>
        </div>
        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${pending ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800"}`}>
          {pending ? `${pending} to provide` : "All provided"}
        </span>
      </div>
      <div className="grid grid-cols-1 gap-4 p-4 sm:p-6 md:grid-cols-2">
        {questions.map((question) => {
          const key = questionKey(question);
          const value = qa.answers[key] ?? question.defaultValue ?? "";
          return (
            <div key={key} className="rounded-xl border border-border bg-background p-3">
              <p className="text-sm font-semibold text-foreground">
                {question.label}
                <span className="ml-1 text-red-500" aria-hidden="true">*</span>
              </p>
              {(question.description || question.helpText) && <p className="mb-2 mt-0.5 text-xs text-muted-foreground">{question.description || question.helpText}</p>}
              <QuestionInput
                question={question}
                value={value}
                saving={qa.savingKey === key}
                onChange={(nextValue) => qa.saveAnswer(question, nextValue)}
                onFileChange={(uploadedFiles) => qa.saveFiles(question, uploadedFiles)}
                files={qa.answerByKey?.get(key)?.files}
                onRemoveFile={(file) => qa.removeFile(question, file)}
              />
            </div>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3 sm:px-6">
        <p className="text-xs text-muted-foreground" role="status">
          {qa.saveState === "saving" ? "Saving..." : qa.saveState === "saved" ? `Saved${qa.lastSavedAt ? ` at ${qa.lastSavedAt}` : ""}` : qa.saveState === "error" ? qa.statusMessage : qa.uploadsInFlight ? "Waiting for uploads to finish..." : ""}
        </p>
        <button
          type="button"
          onClick={() => qa.commitAll().catch(() => null)}
          disabled={qa.saveState === "saving" || qa.uploadsInFlight > 0}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {qa.saveState === "saving" ? "Saving..." : "Save"}
        </button>
      </div>
    </section>
  );
}

export default function StaffRequestedItems({ caseId, user }) {
  const { checklists } = useCaseChecklists(caseId);
  const mine = checklists.filter((checklist) => checklist.staffRequest && (!checklist.assignedTo || String(checklist.assignedTo) === String(user?._id || user?.id)));
  if (!caseId || !mine.length) return null;
  return (
    <div className="mt-6 space-y-4">
      {mine.map((checklist) => <RequestedChecklist key={checklist.referenceId} caseId={caseId} checklist={checklist} />)}
    </div>
  );
}
