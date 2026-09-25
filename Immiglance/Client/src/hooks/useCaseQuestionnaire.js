import { useCallback, useEffect, useRef, useState } from "react";
import { questionnairesApi } from "../services/api";

// Resolves the assigned-or-default Questionnaire template for a case + role
// (e.g. targetRole="employer"|"employee"|"business_plan"), and exposes a
// saveAnswer() that persists a single field and refetches — the backend
// already evaluates conditionalLogic/showIf server-side (isQuestionVisible),
// so refetching after a save is how newly-visible/hidden questions surface;
// no client-side conditional evaluator is needed.
export default function useCaseQuestionnaire(caseId, targetRole, referenceId) {
  const [state, setState] = useState({
    questionnaire: null,
    documentQuestions: [],
    fieldQuestions: [],
    answers: [],
    responseId: null,
    progress: null,
    loading: true,
    error: null,
  });
  const saveTimers = useRef({});
  // Bug fix: a file upload (saveFiles in useQuestionnaireAnswers) calls
  // refetch() -> load() on success, which set `loading: true` for that
  // refetch exactly the same as the very first load - every render-gate that
  // did `if (loading) return <Loading />` was unmounting the ALREADY-VISIBLE
  // questionnaire for the ~1-2s round trip, not just showing a spinner on
  // first mount. `hasLoadedOnce` distinguishes "no data has ever arrived yet"
  // (initialLoading - the real blank-screen case) from "data exists, a
  // background refetch is in flight" (refreshing - must never unmount
  // existing content). `loading` itself is left untouched for any consumer
  // not yet migrated off it.
  const hasLoadedOnce = useRef(false);

  // Phase 12 fix (P12-C1): this is a pure read (GET), so retrying it has no
  // side-effect risk, unlike saveAnswer below. A single transient failure
  // here (this dev environment's remote DB routinely takes 15-45s under
  // load - see PHASE_F2/F3_COMPLETION_REPORT.md) previously surfaced
  // immediately and permanently as CaseRoleChecklistView's "Unable to load
  // this checklist" error, with no path back to a working state short of a
  // manual page reload - even though the checklist data was always
  // reachable a few seconds later. Two bounded automatic retries (short
  // backoff) let a slow-but-not-actually-broken backend resolve on its own
  // before giving up and showing the error state.
  const load = useCallback(async (attempt = 0) => {
    if (!caseId) {
      setState((prev) => ({ ...prev, loading: false }));
      return;
    }
    setState((prev) => ({ ...prev, loading: true, error: attempt > 0 ? prev.error : null }));
    try {
      const params = targetRole ? { targetRole } : {};
      // Disambiguates when 2+ active checklists share the same targetRole
      // (e.g. Green Card Beneficiary + the optional GC-NVC Beneficiary
      // checklist) - see questionnaire.service.js's getQuestionnaireForCase.
      // Omitted (undefined) for every case that has only one, so behavior
      // there is unchanged.
      if (referenceId) params.referenceId = referenceId;
      const response = await questionnairesApi.getForCase(caseId, params);
      const data = response.data;
      hasLoadedOnce.current = true;
      setState({
        questionnaire: data.questionnaire,
        documentQuestions: data.documentQuestions || [],
        fieldQuestions: data.fieldQuestions || [],
        answers: data.answers || [],
        responseId: data.responseId,
        loading: false,
        error: null,
      });
    } catch (error) {
      if (attempt < 2) {
        setTimeout(() => load(attempt + 1), 2000 * (attempt + 1));
        return;
      }
      setState((prev) => ({ ...prev, loading: false, error: error.message || "Failed to load questionnaire" }));
    }
  }, [caseId, targetRole, referenceId]);

  useEffect(() => {
    load();
  }, [load]);

  const saveAnswer = useCallback((questionKey, value) => {
    if (!state.questionnaire?._id) return;
    clearTimeout(saveTimers.current[questionKey]);
    saveTimers.current[questionKey] = setTimeout(async () => {
      try {
        await questionnairesApi.saveAnswer(state.questionnaire._id, {
          caseId,
          questionKey,
          value,
          responseId: state.responseId,
        });
      } finally {
        load();
      }
    }, 700);
  }, [caseId, state.questionnaire, state.responseId, load]);

  const answerMap = {};
  state.answers.forEach((answer) => {
    answerMap[answer.questionKey] = answer.value ?? answer.normalizedValue;
  });

  return {
    ...state,
    answerMap,
    saveAnswer,
    refetch: load,
    // true only for the genuine blank-screen case (no successful fetch yet) -
    // render gates should use this, never `loading`.
    initialLoading: state.loading && !hasLoadedOnce.current,
    // true while a background refetch (e.g. after a file upload) is in
    // flight and data from a prior successful fetch already exists - use
    // this only for a non-blocking indicator, never to unmount content.
    refreshing: state.loading && hasLoadedOnce.current,
  };
}
