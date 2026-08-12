import { useCallback, useEffect, useState } from 'react'
import { questionnairesApi } from '../services/api'

// Resolves the assigned-or-default Questionnaire template for a case + role
// (targetRole="employer"|"employee"|"business_plan") — the same SSOT endpoint
// (GET /questionnaires/case/:caseId) the client portal already uses via its
// own useCaseQuestionnaire hook (BAIS/Frontend/src/hooks/useCaseQuestionnaire.js).
// Kept read-focused for the admin/case-manager case view (no saveAnswer) since
// this app only needs to display live answers today, not collect them.
export default function useCaseQuestionnaire(caseId, targetRole, options = {}) {
  const enabled = options.enabled !== false
  const [state, setState] = useState({
    questionnaire: null,
    documentQuestions: [],
    fieldQuestions: [],
    answers: [],
    loading: true,
    error: null,
  })

  const load = useCallback(async () => {
    if (!enabled || !caseId) {
      setState((prev) => ({ ...prev, loading: false }))
      return
    }
    setState((prev) => ({ ...prev, loading: true, error: null }))
    try {
      const params = targetRole ? { targetRole } : {}
      const response = await questionnairesApi.getForCase(caseId, params)
      const data = response.data.data
      setState({
        questionnaire: data.questionnaire,
        documentQuestions: data.documentQuestions || [],
        fieldQuestions: data.fieldQuestions || [],
        answers: data.answers || [],
        loading: false,
        error: null,
      })
    } catch (error) {
      setState((prev) => ({ ...prev, loading: false, error: error.response?.data?.message || error.message || 'Failed to load questionnaire' }))
    }
  }, [caseId, targetRole, enabled])

  useEffect(() => {
    load()
  }, [load])

  const answerMap = {}
  state.answers.forEach((answer) => {
    answerMap[answer.questionKey] = answer.value ?? answer.normalizedValue
  })

  return { ...state, answerMap, refetch: load }
}
