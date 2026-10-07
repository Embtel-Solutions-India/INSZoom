import { useEffect, useRef } from 'react'
import useCaseQuestionnaire from '../hooks/useCaseQuestionnaire'
import QuestionnaireAnswersPanel from './QuestionnaireAnswersPanel'

// One detailed answers panel for an approved checklist that has no dedicated panel of its own on the case page
// (e.g. a checklist role the fixed Employer / Employee / Business Plan / Family panels do not cover). It resolves the
// checklist by its referenceId, so it always shows the case's own - customised - copy, and re-reads it whenever
// `refreshToken` changes (an approval or edit made by anyone, delivered live).
export default function ApprovedChecklistPanel({ caseId, checklist, refreshToken }) {
  const panel = useCaseQuestionnaire(caseId, checklist.targetRole, { referenceId: checklist.referenceId })
  const first = useRef(true)
  const refetch = panel.refetch
  useEffect(() => {
    if (first.current) { first.current = false; return }
    refetch?.()
  }, [refreshToken, refetch])

  return (
    <QuestionnaireAnswersPanel
      title={checklist.title}
      questionnaire={panel.questionnaire}
      fieldQuestions={panel.fieldQuestions}
      documentQuestions={panel.documentQuestions}
      answerMap={panel.answerMap}
      filesByKey={panel.filesByKey}
      loading={panel.loading}
      onSaveAnswer={panel.saveAnswer}
      onSaveFile={panel.saveFileAnswer}
      onRemoveFile={panel.removeFileAnswer}
      onAutofill={panel.autofillFromDocument}
    />
  )
}
