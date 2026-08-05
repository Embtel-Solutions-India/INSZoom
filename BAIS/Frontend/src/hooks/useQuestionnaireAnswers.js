import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { questionnairesApi } from "../services/api";
import useCaseQuestionnaire from "./useCaseQuestionnaire";
import {
  clampPercent,
  sectionKey,
  questionKey,
  unwrapApiData,
  valueFromAnswers,
  prefillMetaFromAnswers,
  isFileQuestion,
  isQuestionVisible,
  validateQuestion,
  DOCUMENTS_SECTION_KEY,
} from "../utils/questionnaireEngine";

// Headless answer-state engine for one case + targetRole's questionnaire —
// extracted out of QuestionnaireRenderer so any surface that needs to
// read/save a case's questionnaire (the panel-style renderer, the
// single-page case Checklist on Documents.jsx) shares one implementation
// instead of re-deriving visibleQuestions/progress logic.
//
// FIX (data-loss bug): this used to autosave every field on a 550ms debounce,
// firing one network round-trip + refetch per field — slow, race-prone, and
// the direct cause of the "documents/answers vanish after submit" bug (submit
// navigated away while several of these debounced saves were still
// in-flight, so only whichever had already landed persisted). Field answers
// now live ONLY in local state until commitAll() is called (by Documents.jsx's
// Save progress / Submit buttons) — no per-keystroke network call, no
// per-field refetch storm. File-question uploads (saveFiles) still fire
// immediately on selection (so the H2 Autofill preview still works against
// something already on the server), but are tracked in pendingUploads so
// commitAll() can await them before batch-saving answers.
export default function useQuestionnaireAnswers(caseId, targetRole, { disabled = false } = {}) {
  const { questionnaire, documentQuestions, fieldQuestions, answers: rawAnswers, responseId, progress: hookProgress, loading, error, refetch } =
    useCaseQuestionnaire(caseId, targetRole);

  const [answers, setAnswers] = useState({});
  const [prefillMeta, setPrefillMeta] = useState({});
  const [savingKey, setSavingKey] = useState("");
  const [saveState, setSaveState] = useState("idle");
  const [lastSavedAt, setLastSavedAt] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [localProgress, setLocalProgress] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [uploadsInFlight, setUploadsInFlight] = useState(0);
  const dirtyKeys = useRef(new Set());
  const pendingUploads = useRef(new Set());
  const loadedQuestionnaireId = useRef(null);

  // Saving one field triggers a refetch (to learn its new completion/status),
  // and that refetch's response reflects a snapshot that may be older than
  // whatever the user is mid-typing into a *different* field right now. Fully
  // replacing `answers` from that snapshot would flash the field back to its
  // last-saved value for a moment (visible as "typed text vanishes, then
  // reappears a few seconds later") — so any key still marked dirty (typed,
  // not yet round-tripped through its own save) keeps its local value instead
  // of being overwritten by a sibling field's refetch.
  useEffect(() => {
    const isNewQuestionnaire = loadedQuestionnaireId.current !== (questionnaire?._id || null);
    if (isNewQuestionnaire) {
      dirtyKeys.current.clear();
      setDirty(false);
      loadedQuestionnaireId.current = questionnaire?._id || null;
    }
    const fromServer = valueFromAnswers(rawAnswers);
    setAnswers((previous) => {
      if (isNewQuestionnaire) return fromServer;
      const merged = { ...fromServer };
      dirtyKeys.current.forEach((key) => {
        if (key in previous) merged[key] = previous[key];
      });
      return merged;
    });
    setPrefillMeta(prefillMetaFromAnswers(rawAnswers));
    setLocalProgress(hookProgress);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [questionnaire?._id, rawAnswers]);

  // Keyed by questionKey — the raw Answer record (status/rejectionReason/etc.),
  // for surfaces that need real review-status chips, not just the value.
  const answerByKey = useMemo(() => {
    const map = new Map();
    rawAnswers.forEach((answer) => map.set(answer.questionKey || answer.question?.key, answer));
    return map;
  }, [rawAnswers]);

  const questionnaireSections = useMemo(
    () => [...(questionnaire?.sections || [])].sort((a, b) => (a.order || 0) - (b.order || 0)),
    [questionnaire]
  );

  const visibleQuestions = useMemo(
    () => [...fieldQuestions, ...documentQuestions]
      .filter((question) => isQuestionVisible(question, answers))
      .sort((a, b) => (a.order || 0) - (b.order || 0)),
    [fieldQuestions, documentQuestions, answers]
  );
  const visibleFieldQuestions = useMemo(() => visibleQuestions.filter((question) => !isFileQuestion(question)), [visibleQuestions]);
  const visibleDocumentQuestions = useMemo(() => visibleQuestions.filter(isFileQuestion), [visibleQuestions]);

  // Documents step is appended after the questionnaire's own sections, and
  // only shows up once there's at least one currently-applicable document
  // question — this is exactly where a conditional document (e.g. "Upload
  // FEIN Letter" when DOL verification = No) surfaces, inside the
  // questionnaire, never on the reusable Documents page's own baseline list.
  const sections = useMemo(() => {
    if (!visibleDocumentQuestions.length) return questionnaireSections;
    return [...questionnaireSections, { key: DOCUMENTS_SECTION_KEY, title: "Documents", description: "Upload the documents this section requires." }];
  }, [questionnaireSections, visibleDocumentQuestions.length]);

  const questionsBySection = useMemo(() => {
    const map = new Map();
    sections.forEach((section) => map.set(sectionKey(section), []));
    visibleFieldQuestions.forEach((question) => {
      const key = question.sectionKey || "general";
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(question);
    });
    if (visibleDocumentQuestions.length) map.set(DOCUMENTS_SECTION_KEY, visibleDocumentQuestions);
    return map;
  }, [sections, visibleFieldQuestions, visibleDocumentQuestions]);

  const allValidationErrors = useMemo(() => visibleQuestions.flatMap((question) =>
    validateQuestion(question, answers[questionKey(question)], answers).map((message) => ({
      key: questionKey(question),
      sectionKey: isFileQuestion(question) ? DOCUMENTS_SECTION_KEY : (question.sectionKey || "general"),
      label: question.label,
      message,
    }))
  ), [answers, visibleQuestions]);
  const missingRequiredCount = allValidationErrors.filter((validationError) => validationError.message === "This field is required.").length;

  const progress = localProgress || hookProgress || {};
  const overallCompletion = clampPercent(progress.completionPercentage ?? progress.percent ?? progress.overall ?? 0);

  const handleAutofillResult = useCallback((documentType, data, autofillError) => {
    if (autofillError) {
      setStatusMessage(autofillError.message || `Unable to process the uploaded ${documentType}.`);
      return;
    }
    const prefill = data?.prefill || [];
    const appliedCount = prefill.filter((item) => item.applied).length;
    const conflictCount = prefill.filter((item) => item.conflict).length;
    setStatusMessage(
      appliedCount || conflictCount
        ? `Applied ${appliedCount} field${appliedCount === 1 ? "" : "s"}${conflictCount ? `; ${conflictCount} need${conflictCount === 1 ? "s" : ""} your review below` : ""}.`
        : `We couldn't find any matching fields in that ${documentType}.`
    );
    refetch();
  }, [refetch]);

  // No network call, no debounce — just local state + the dirty flag the
  // unsaved-changes guard and commitAll() both read. Replaces the old
  // per-field autosave (Bug A/B): a field answer only ever reaches the
  // server via commitAll(), called by Save progress or Submit.
  const saveAnswer = useCallback((question, value) => {
    if (!questionnaire?._id || !caseId || disabled) return;
    const key = questionKey(question);
    setAnswers((previous) => ({ ...previous, [key]: value }));
    setPrefillMeta((previous) => {
      if (!previous[key]) return previous;
      const next = { ...previous };
      delete next[key];
      return next;
    });
    dirtyKeys.current.add(key);
    setDirty(true);
  }, [caseId, disabled, questionnaire]);

  // File-question uploads still fire immediately on selection (so an H2
  // Autofill preview run against this file has something already persisted
  // to match against) — but are tracked via pendingUploads/uploadsInFlight so
  // commitAll() can await them instead of racing a still-uploading file.
  const saveFiles = useCallback(async (question, files) => {
    if (!files.length || !questionnaire?._id || !caseId || disabled) return;
    const key = questionKey(question);
    setSavingKey(key);
    setUploadsInFlight((count) => count + 1);
    const uploadPromise = questionnairesApi.saveFileAnswer(
      questionnaire._id,
      { caseId, responseId, questionKey: key, currentSectionKey: question.sectionKey },
      files
    );
    pendingUploads.current.add(uploadPromise);
    try {
      await uploadPromise;
      setLastSavedAt(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
      await refetch();
    } catch (fileError) {
      setStatusMessage(fileError.message || "Unable to upload files.");
      throw fileError;
    } finally {
      pendingUploads.current.delete(uploadPromise);
      setUploadsInFlight((count) => Math.max(0, count - 1));
      setSavingKey("");
    }
  }, [caseId, disabled, questionnaire, responseId, refetch]);

  // Shared batched-persistence path for both "Save progress" and "Submit
  // case" (AC-S3: identical payload either way — Submit only differs by the
  // extra submit-endpoint call + navigation, both handled by the caller
  // after commitAll() resolves). Awaits any file-question uploads still in
  // flight first, then persists every current answer in ONE request via the
  // existing /questionnaires/:id/answers route (already supports a batched
  // `answers` array server-side — see questionnaire.service.js's saveAnswers)
  // instead of the one-request-per-field pattern this replaces.
  const commitAll = useCallback(async () => {
    if (!questionnaire?._id || !caseId || disabled) return null;
    await Promise.all([...pendingUploads.current]);
    setSaveState("saving");
    try {
      const entries = Object.entries(answers).map(([questionKeyValue, value]) => ({ questionKey: questionKeyValue, value }));
      const response = entries.length
        ? await questionnairesApi.saveAnswer(questionnaire._id, { caseId, responseId, answers: entries })
        : null;
      const data = response ? unwrapApiData(response) : null;
      if (data?.completion) setLocalProgress(data.completion);
      dirtyKeys.current.clear();
      setDirty(false);
      setLastSavedAt(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
      setSaveState("saved");
      await refetch();
      return data;
    } catch (saveError) {
      setStatusMessage(saveError.message || "Unable to save your progress.");
      setSaveState("error");
      throw saveError;
    }
  }, [answers, caseId, disabled, questionnaire, responseId, refetch]);

  return {
    questionnaire,
    loading,
    error,
    answers,
    answerByKey,
    prefillMeta,
    sections,
    questionsBySection,
    visibleQuestions,
    visibleFieldQuestions,
    visibleDocumentQuestions,
    allValidationErrors,
    missingRequiredCount,
    overallCompletion,
    savingKey,
    saveState,
    lastSavedAt,
    statusMessage,
    dirty,
    uploadsInFlight,
    saveAnswer,
    saveFiles,
    commitAll,
    handleAutofillResult,
    refetch,
  };
}
