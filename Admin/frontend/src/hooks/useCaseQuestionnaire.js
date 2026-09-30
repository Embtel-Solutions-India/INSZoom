import { useCallback, useEffect, useState } from 'react'
import { questionnairesApi, invalidateCachedGet } from '../services/api'

// Resolves the assigned-or-default Questionnaire template for a case + role
// (targetRole="employer"|"employee"|"business_plan") — the same SSOT endpoint
// (GET /questionnaires/case/:caseId) the client portal already uses via its
// own useCaseQuestionnaire hook (Immiglance/Frontend/src/hooks/useCaseQuestionnaire.js).
// Also exposes saveAnswer/saveFileAnswer so a case manager can correct a
// client's already-submitted answer directly from the Admin case view - both
// go through questionnairesApi's preserveStatus:true path (see
// questionnaire.service.js's PRESERVE_ANSWER_STATUS) so fixing a value never
// silently reopens an already-submitted/approved checklist.
export default function useCaseQuestionnaire(caseId, targetRole, options = {}) {
  const enabled = options.enabled !== false
  // Disambiguates when 2+ active checklists share the same targetRole (e.g.
  // Green Card Beneficiary + the optional GC-NVC Beneficiary checklist) -
  // see questionnaire.service.js's getQuestionnaireForCase. Omitted for
  // every case that has only one, which keeps its current behavior.
  const referenceId = options.referenceId
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
      if (referenceId) params.referenceId = referenceId
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
  }, [caseId, targetRole, enabled, referenceId])

  useEffect(() => {
    load()
  }, [load])

  const answerMap = {}
  const filesByKey = {}
  state.answers.forEach((answer) => {
    answerMap[answer.questionKey] = answer.value ?? answer.normalizedValue
    if (answer.files?.length) filesByKey[answer.questionKey] = answer.files
  })

  // saveAnswers() resolves which response a save belongs to from
  // payload.responseId first, falling back to re-deriving one from the
  // caller's own participant identity only if it's missing. A case manager
  // is never a case participant, so that fallback would resolve against the
  // case manager's OWN user id instead of the client's — a different,
  // orphaned response, not the one being displayed/edited. Passing the exact
  // responseId already on the loaded answers (every answer in this
  // questionnaire's response shares one) makes the edit land on the same
  // record the client's own save did, regardless of who the caller is.
  const responseId = state.answers[0]?.responseId

  const saveAnswer = useCallback(async (questionKey, value) => {
    if (!state.questionnaire?._id) throw new Error('Questionnaire not loaded')
    if (!responseId) throw new Error('No existing response to edit — the client has not answered this questionnaire yet')
    await questionnairesApi.saveAnswer(state.questionnaire._id, {
      caseId,
      targetRole,
      referenceId,
      responseId,
      answers: [{ questionKey, value }],
    })
    invalidateCachedGet(`/questionnaires/case/${caseId}`)
    await load()
  }, [state.questionnaire, responseId, caseId, targetRole, referenceId, load])

  const saveFileAnswer = useCallback(async (questionKey, file) => {
    if (!state.questionnaire?._id) throw new Error('Questionnaire not loaded')
    if (!responseId) throw new Error('No existing response to edit — the client has not answered this questionnaire yet')
    const formData = new FormData()
    formData.append('files', file)
    formData.append('caseId', caseId)
    if (targetRole) formData.append('targetRole', targetRole)
    if (referenceId) formData.append('referenceId', referenceId)
    formData.append('responseId', responseId)
    formData.append('questionKey', questionKey)
    await questionnairesApi.saveFileAnswer(state.questionnaire._id, formData)
    invalidateCachedGet(`/questionnaires/case/${caseId}`)
    await load()
  }, [state.questionnaire, responseId, caseId, targetRole, referenceId, load])

  return { ...state, answerMap, filesByKey, refetch: load, saveAnswer, saveFileAnswer }
}
