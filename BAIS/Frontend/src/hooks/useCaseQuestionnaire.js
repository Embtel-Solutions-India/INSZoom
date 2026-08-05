import { useCallback, useEffect, useRef, useState } from "react";
import { questionnairesApi } from "../services/api";

// Resolves the assigned-or-default Questionnaire template for a case + role
// (e.g. targetRole="employer"|"employee"|"business_plan"), and exposes a
// saveAnswer() that persists a single field and refetches — the backend
// already evaluates conditionalLogic/showIf server-side (isQuestionVisible),
// so refetching after a save is how newly-visible/hidden questions surface;
// no client-side conditional evaluator is needed.
export default function useCaseQuestionnaire(caseId, targetRole) {
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

  const load = useCallback(async () => {
    if (!caseId) {
      setState((prev) => ({ ...prev, loading: false }));
      return;
    }
    setState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const params = targetRole ? { targetRole } : {};
      const response = await questionnairesApi.getForCase(caseId, params);
      const data = response.data;
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
      setState((prev) => ({ ...prev, loading: false, error: error.message || "Failed to load questionnaire" }));
    }
  }, [caseId, targetRole]);

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

  return { ...state, answerMap, saveAnswer, refetch: load };
}
