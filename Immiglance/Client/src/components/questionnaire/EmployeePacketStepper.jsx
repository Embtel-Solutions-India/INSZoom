import { useMemo, useState } from "react";
import ChecklistItemRow from "../checklist/ChecklistItemRow";
import QuestionInput, { AutofillButton } from "./QuestionInput";
import PrefillBadge from "../PrefillBadge";
import { questionKey, sectionKey, matchingAutofillSources, isFileQuestion } from "../../utils/questionnaireEngine";
import { fieldItemStatus, STATUS } from "../../utils/checklistStatus";
import { questionnairesApi } from "../../services/api";

const STEPS = [
  { key: "documents", label: "Documents" },
  { key: "information", label: "Information" },
  { key: "review", label: "Review" },
];

// Presents the SAME questionnaire engine CaseRoleChecklistView renders (same
// hook, same ChecklistItemRow/QuestionInput/AutofillButton/PrefillBadge — no
// parallel questionnaire logic here) as a 3-step flow instead of one long
// scroll: Documents (every file-type question across every section, flat),
// Information (every remaining section, one at a time), Review (a summary +
// the actual submit action). Reuses `qa` from useQuestionnaireAnswers as-is.
export default function EmployeePacketStepper({ qa, caseId, employeeLabel, onExit, onSubmitted, readOnly = false }) {
  const {
    questionnaire, initialLoading, error, sections, questionsBySection, answers, answerByKey,
    prefillMeta, savingKey, saveAnswer, saveFiles, commitAll, handleAutofillResult, responseId,
    questionnaireId, missingRequiredCount, dirty, saveState, lastSavedAt,
  } = qa;

  const [stepIndex, setStepIndex] = useState(0);
  const [activeInfoSection, setActiveInfoSection] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");

  const sectionsWithItems = useMemo(() => sections.map((section) => {
    const key = sectionKey(section);
    const questions = questionsBySection.get(key) || [];
    return { key, title: section.title, questions, autofillSources: matchingAutofillSources(questions) };
  }).filter((section) => section.questions.length > 0), [sections, questionsBySection]);

  const documentQuestions = useMemo(
    () => sectionsWithItems.flatMap((section) => section.questions.filter((q) => isFileQuestion(q))),
    [sectionsWithItems]
  );
  const infoSections = useMemo(
    () => sectionsWithItems
      .map((section) => ({ ...section, questions: section.questions.filter((q) => !isFileQuestion(q)) }))
      .filter((section) => section.questions.length > 0),
    [sectionsWithItems]
  );
  const documentAutofillSources = useMemo(() => matchingAutofillSources(documentQuestions), [documentQuestions]);

  const questionStatus = (question) => {
    const key = questionKey(question);
    const value = answers[key] ?? question.defaultValue ?? "";
    return { key, value, ...fieldItemStatus(answerByKey.get(key), value) };
  };

  const missingItems = useMemo(() => {
    const missing = [];
    sectionsWithItems.forEach((section) => {
      section.questions.forEach((question) => {
        if (!question.required) return;
        const { status } = questionStatus(question);
        if (status === STATUS.NOT_STARTED) missing.push({ section: section.title, question, isDocument: isFileQuestion(question) });
      });
    });
    return missing;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sectionsWithItems, answers, answerByKey]);

  const canSubmit = missingRequiredCount === 0 && missingItems.length === 0;

  const renderQuestionRow = (question) => {
    const key = questionKey(question);
    const { value, status, reason } = questionStatus(question);
    return (
      <ChecklistItemRow
        key={key}
        id={key}
        type={isFileQuestion(question) ? "document" : "field"}
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
  };

  const handleSaveAndReturn = async () => {
    setSubmitting(true);
    setSubmitError("");
    try {
      await commitAll();
      // submitResponse (questionnaire.service.js) is what actually flips this
      // checklist's status to "submitted" — commitAll only persists answers.
      // Without this call, listCaseChecklists (which the Employee Dashboard's
      // progress cards read from) would never show "Ready for Review".
      if (questionnaireId) {
        await questionnairesApi.submit(questionnaireId, { caseId, responseId });
      }
      onSubmitted?.();
    } catch (err) {
      setSubmitError(err.response?.message || err.message || "Unable to submit — please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  if (initialLoading) return <p className="text-sm text-slate-400">Loading…</p>;
  if (error) return <p className="text-sm text-red-600">{error.message || "Unable to load this checklist."}</p>;
  if (!questionnaire) return <p className="text-sm text-slate-400">No checklist is available for this visa type yet.</p>;

  return (
    <div className="max-w-3xl mx-auto space-y-6 pb-28">
      <div className="flex items-center gap-3">
        {onExit && (
          <button type="button" onClick={onExit} className="text-sm font-semibold text-slate-500 hover:text-slate-700 shrink-0">
            ← All employees
          </button>
        )}
        <div className="min-w-0">
          <p className="text-sm font-bold text-slate-900 truncate">{employeeLabel}</p>
          <p className="text-xs text-slate-500 truncate">{questionnaire.title}</p>
        </div>
      </div>

      {/* Stepper — collapses to "Step X of 3" + a thin bar below sm */}
      <div className="hidden sm:flex items-center gap-2">
        {STEPS.map((step, index) => (
          <div key={step.key} className="flex items-center gap-2 flex-1">
            <button
              type="button"
              onClick={() => index <= stepIndex && setStepIndex(index)}
              disabled={index > stepIndex}
              className={`flex items-center gap-2 text-sm font-semibold whitespace-nowrap transition-colors ${
                index === stepIndex ? "text-slate-900" : index < stepIndex ? "text-emerald-600" : "text-slate-300"
              }`}
            >
              <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold border transition-colors ${
                index === stepIndex ? "border-slate-900 bg-slate-900 text-white" : index < stepIndex ? "border-emerald-500 bg-emerald-500 text-white" : "border-slate-300 text-slate-400"
              }`}>
                {index < stepIndex ? "✓" : index + 1}
              </span>
              {step.label}
            </button>
            {index < STEPS.length - 1 && <div className={`h-px flex-1 transition-colors ${index < stepIndex ? "bg-emerald-400" : "bg-slate-200"}`} />}
          </div>
        ))}
      </div>
      <div className="sm:hidden space-y-1.5">
        <p className="text-sm font-bold text-slate-900">Step {stepIndex + 1} of {STEPS.length} · {STEPS[stepIndex].label}</p>
        <div className="h-1 rounded-full bg-slate-100 overflow-hidden">
          <div className="h-full rounded-full bg-slate-900 transition-all duration-300" style={{ width: `${((stepIndex + 1) / STEPS.length) * 100}%` }} />
        </div>
      </div>

      {/* Step 1: Documents */}
      {stepIndex === 0 && (
        <div className="space-y-4">
          <div className="rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(0,0,0,0.04)] p-5">
            <p className="text-sm font-bold text-slate-900">Documents we need</p>
          </div>
          {!readOnly && documentAutofillSources.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {documentAutofillSources.map((documentType) => (
                <AutofillButton key={documentType} documentType={documentType} caseId={caseId} disabled={!caseId} onUploaded={handleAutofillResult} />
              ))}
              {documentAutofillSources.includes("passport") && (
                <span className="self-center text-xs text-slate-500">Optional - scan your passport to fill in your name, date of birth, nationality and passport details. You can review and edit everything on the next steps.</span>
              )}
            </div>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
            {documentQuestions.map(renderQuestionRow)}
            {documentQuestions.length === 0 && <p className="text-sm text-slate-400">No documents required for this checklist.</p>}
          </div>
        </div>
      )}

      {/* Step 2: Information */}
      {stepIndex === 1 && (
        <div className="grid grid-cols-1 md:grid-cols-[200px_1fr] gap-6">
          <div className="flex md:flex-col gap-1 overflow-x-auto md:overflow-visible border-b md:border-b-0 md:border-r border-slate-200 pb-2 md:pb-0 md:pr-4 md:sticky md:top-4 md:self-start">
            {infoSections.map((section, index) => (
              <button
                key={section.key}
                type="button"
                onClick={() => setActiveInfoSection(index)}
                className={`text-left whitespace-nowrap px-3 py-2 rounded-lg text-sm font-semibold ${
                  activeInfoSection === index ? "bg-slate-900 text-white" : "text-slate-500 hover:bg-slate-100"
                }`}
              >
                {section.title}
              </button>
            ))}
          </div>
          <div className="space-y-4 min-w-0">
            {infoSections[activeInfoSection] && (
              <section>
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">{infoSections[activeInfoSection].title}</h2>
                  <span className="text-xs text-slate-400">
                    {/* BUG (fixed): this ternary never checked saveState === "error"
                        at all, unlike the equivalent status line in the sibling
                        CaseRoleChecklist.jsx — a failed save with no other unsaved
                        edits fell straight through to the stale lastSavedAt branch,
                        silently showing an old "Saved at ..." time as if the most
                        recent save had succeeded. */}
                    {saveState === "saving" ? "Saving…" : saveState === "error" ? "Save failed" : dirty ? "Unsaved changes" : lastSavedAt ? `Saved at ${lastSavedAt}` : ""}
                  </span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
                  {infoSections[activeInfoSection].questions.map(renderQuestionRow)}
                </div>
              </section>
            )}
            {infoSections.length === 0 && <p className="text-sm text-slate-400">No further information is required.</p>}
          </div>
        </div>
      )}

      {/* Step 3: Review */}
      {stepIndex === 2 && (
        <div className="space-y-4">
          <div className="rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(0,0,0,0.04)] divide-y divide-slate-100">
            {sectionsWithItems.map((section) => {
              const total = section.questions.length;
              const done = section.questions.filter((q) => questionStatus(q).status !== STATUS.NOT_STARTED).length;
              return (
                <div key={section.key} className="flex items-center justify-between px-5 py-3">
                  <span className="text-sm font-semibold text-slate-800">{section.title}</span>
                  <span className={`text-xs font-semibold ${done === total ? "text-emerald-600" : "text-amber-600"}`}>
                    {done === total ? "✓ Complete" : `${done}/${total} complete`}
                  </span>
                </div>
              );
            })}
          </div>
          {missingItems.length > 0 ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-5">
              <p className="text-sm font-bold text-amber-800 mb-2">A few things still need attention</p>
              <ul className="space-y-1.5">
                {missingItems.map((item) => (
                  <li key={item.question._id || item.question.key}>
                    <button
                      type="button"
                      onClick={() => { setStepIndex(item.isDocument ? 0 : 1); }}
                      className="text-sm text-amber-900 underline underline-offset-2"
                    >
                      {item.section} — {item.question.label}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-5">
              <p className="text-sm font-bold text-emerald-800">Everything's complete. Ready to submit.</p>
            </div>
          )}
          {submitError && <p className="text-sm text-red-600">{submitError}</p>}
        </div>
      )}

      {/* Sticky footer */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 px-4 py-3 flex items-center justify-between z-10 shadow-[0_-2px_8px_rgba(0,0,0,0.04)] pb-[calc(env(safe-area-inset-bottom)+0.75rem)]">
        <button
          type="button"
          onClick={() => setStepIndex((i) => Math.max(0, i - 1))}
          disabled={stepIndex === 0}
          className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 disabled:opacity-40 transition-colors hover:bg-slate-50"
        >
          Back
        </button>
        {stepIndex < STEPS.length - 1 ? (
          <button
            type="button"
            onClick={() => setStepIndex((i) => Math.min(STEPS.length - 1, i + 1))}
            className="rounded-lg bg-slate-900 px-5 py-2 text-sm font-bold text-white hover:bg-slate-700 transition-colors"
          >
            {stepIndex === STEPS.length - 2 ? "Continue to Review" : "Continue"}
          </button>
        ) : !readOnly ? (
          <button
            type="button"
            onClick={handleSaveAndReturn}
            disabled={!canSubmit || submitting}
            className="rounded-lg bg-slate-900 px-5 py-2 text-sm font-bold text-white hover:bg-slate-700 disabled:opacity-40 transition-colors"
            title={!canSubmit ? "Complete every required item first" : undefined}
          >
            {submitting ? "Saving…" : "Save & Return"}
          </button>
        ) : (
          <span className="text-xs text-slate-400">Read-only view</span>
        )}
      </div>
    </div>
  );
}
