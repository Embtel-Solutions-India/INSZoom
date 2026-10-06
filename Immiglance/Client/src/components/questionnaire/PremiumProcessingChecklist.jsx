import { useMemo } from "react";
import useQuestionnaireAnswers from "../../hooks/useQuestionnaireAnswers";
import QuestionInput from "./QuestionInput";
import { questionKey, sectionKey, isQuestionRequired, isEmptyValue, isWideQuestion } from "../../utils/questionnaireEngine";

// The "Form I-907 Information Checklist" a case manager attaches when upgrading a case to
// Premium Processing. It is an ordinary questionnaire (same answers/save pipeline as every other
// checklist, and the same answers the Admin portal shows), rendered here as its own section BELOW
// the case's regular checklists - never as one of them. A standalone "Premium Processing" case does
// not use this: there the checklist is the case's own and renders on the main checklist page.
export const PREMIUM_PROCESSING_CHECKLIST_KEY = "i907_premium_processing_profile";

export default function PremiumProcessingChecklist({ caseId, checklist }) {
  const qa = useQuestionnaireAnswers(caseId, checklist.targetRole, { referenceId: checklist.referenceId });
  const sections = useMemo(
    () => (qa.sections || [])
      .map((section) => ({ section, questions: qa.questionsBySection?.get(sectionKey(section)) || [] }))
      .filter((entry) => entry.questions.length > 0),
    [qa.sections, qa.questionsBySection]
  );
  const required = useMemo(
    () => (qa.visibleQuestions || []).filter((question) => isQuestionRequired(question, qa.answers)),
    [qa.visibleQuestions, qa.answers]
  );
  const missing = required.filter((question) => isEmptyValue(qa.answers[questionKey(question)])).length;

  if (qa.loading && !sections.length) return null;
  if (!sections.length) return null;

  return (
    <section className="rounded-2xl border border-border bg-card shadow-sm" aria-labelledby="premium-processing-heading">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3 sm:px-6">
        <div>
          <h2 id="premium-processing-heading" className="text-base font-semibold text-foreground">Premium Processing - Form I-907</h2>
          <p className="text-xs text-muted-foreground">Your case manager upgraded this case to Premium Processing. Please complete the information below - it is used to prepare Form I-907.</p>
        </div>
        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${missing ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800"}`}>
          {missing ? `${missing} required to complete` : "All required items complete"}
        </span>
      </div>

      <div className="space-y-6 p-4 sm:p-6">
        {sections.map(({ section, questions }) => (
          <div key={sectionKey(section)}>
            <h3 className="mb-3 text-xs font-bold uppercase tracking-wide text-muted-foreground">{section.title}</h3>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {questions.map((question) => {
                const key = questionKey(question);
                const value = qa.answers[key] ?? question.defaultValue ?? "";
                const isRequired = isQuestionRequired(question, qa.answers);
                return (
                  <div key={key} className={`rounded-xl border border-border bg-background p-3 ${isWideQuestion(question) ? "md:col-span-2" : ""}`}>
                    <p className="text-sm font-semibold text-foreground">
                      {question.label}
                      {isRequired && <span className="ml-1 text-red-500" aria-hidden="true">*</span>}
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
          </div>
        ))}
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
