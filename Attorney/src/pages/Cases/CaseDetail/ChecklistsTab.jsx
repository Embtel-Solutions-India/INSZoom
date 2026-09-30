import { useEffect, useState } from 'react'
import { useOutletContext, useParams } from 'react-router-dom'
import { Loader2, Paperclip } from 'lucide-react'
import { questionnairesApi } from '../../../services/api'

// Read-only port of Admin's QuestionnaireAnswersPanel.jsx formatting logic
// (no edit controls - an attorney never edits a client's checklist answers,
// only reviews them). questionnaires:read was deliberately re-added for the
// attorney role (permissions.registry.js, questionnaire.routes.js's
// caseReaderRoles) specifically for this tab, reversing ATTORNEY_PORTAL.md's
// original "client-intake data, not case-review material" exclusion.
function formatAnswerValue(question, value) {
  if (value === undefined || value === null || value === '') return null
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (Array.isArray(value)) return value.length ? value.map((item) => (typeof item === 'object' ? JSON.stringify(item) : String(item))).join(', ') : null
  if (question.type === 'date' || question.type === 'datetime') {
    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toLocaleDateString()
  }
  return String(value)
}

function sectionTitleFor(questionnaire, sectionKey) {
  return questionnaire?.sections?.find((section) => section.key === sectionKey)?.title
    || questionnaire?.pages?.find((page) => page.key === sectionKey)?.title
    || sectionKey
}

function ChecklistPanel({ summary, caseId }) {
  const [detail, setDetail] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    const params = {}
    if (summary.targetRole) params.targetRole = summary.targetRole
    if (summary.referenceId) params.referenceId = summary.referenceId
    questionnairesApi
      .getForCase(caseId, params)
      .then(({ data }) => setDetail(data.data))
      .catch((err) => setError(err.response?.data?.message || 'Could not load this checklist.'))
  }, [caseId, summary.targetRole, summary.referenceId])

  if (error) return <div className="card"><p className="text-sm text-destructive">{error}</p></div>
  if (!detail) {
    return (
      <div className="card">
        <p className="text-sm font-semibold text-foreground mb-2">{summary.title}</p>
        <Loader2 className="w-4 h-4 animate-spin text-primary" />
      </div>
    )
  }

  const { questionnaire, fieldQuestions = [], documentQuestions = [], answers = [] } = detail
  if (!questionnaire || (!fieldQuestions.length && !documentQuestions.length)) return null

  const answerMap = {}
  const filesByKey = {}
  answers.forEach((answer) => {
    answerMap[answer.questionKey] = answer.value ?? answer.normalizedValue
    if (answer.files?.length) filesByKey[answer.questionKey] = answer.files
  })

  const allQuestions = [...fieldQuestions, ...documentQuestions]
  const sectionOrder = []
  const bySection = new Map()
  allQuestions.forEach((question) => {
    const key = question.sectionKey || 'general'
    if (!bySection.has(key)) {
      sectionOrder.push(key)
      bySection.set(key, [])
    }
    bySection.get(key).push(question)
  })

  return (
    <div className="card">
      <h3 className="text-lg font-semibold text-foreground mb-4">{summary.title || questionnaire.title}</h3>
      <div className="space-y-5">
        {sectionOrder.map((sectionKey) => {
          const questions = bySection.get(sectionKey)
          const fileQuestions = questions.filter((q) => q.type === 'file' || q.type === 'file-multiple')
          const plainQuestions = questions.filter((q) => q.type !== 'file' && q.type !== 'file-multiple' && q.type !== 'repeating_group')
          const repeatingQuestions = questions.filter((q) => q.type === 'repeating_group')
          return (
            <div key={sectionKey}>
              <p className="mb-2 text-sm font-semibold text-foreground">{sectionTitleFor(questionnaire, sectionKey)}</p>
              {plainQuestions.length > 0 && (
                <div className="grid grid-cols-1 gap-x-4 gap-y-1.5 text-sm md:grid-cols-2">
                  {plainQuestions.map((question) => (
                    <p key={question.key}>
                      <span className="text-muted-foreground">{question.label}:</span>{' '}
                      <span className="font-semibold text-foreground">{formatAnswerValue(question, answerMap[question.key]) ?? 'Needed'}</span>
                    </p>
                  ))}
                </div>
              )}
              {repeatingQuestions.map((question) => {
                const rows = Array.isArray(answerMap[question.key]) ? answerMap[question.key] : []
                const fields = question.metadata?.repeatableFields || []
                return (
                  <div key={question.key} className="mt-2 grid grid-cols-1 gap-3 md:grid-cols-2">
                    {rows.length ? rows.map((row, index) => (
                      <div key={row?.id || index} className="rounded-lg border border-border bg-muted p-3 text-sm">
                        <p className="font-semibold text-foreground mb-1">{question.label} {index + 1}</p>
                        <p className="text-muted-foreground">
                          {fields.length
                            ? fields.map((f) => row?.[f.key]).filter(Boolean).join(', ') || 'Needed'
                            : Object.values(row || {}).filter(Boolean).join(', ') || 'Needed'}
                        </p>
                      </div>
                    )) : <p className="text-sm text-muted-foreground">Needed</p>}
                  </div>
                )
              })}
              {fileQuestions.map((question) => (
                <div key={question.key} className="mt-2 rounded-lg border border-border bg-muted p-3 text-sm">
                  <p className="font-semibold text-foreground mb-1">{question.label}</p>
                  {filesByKey[question.key]?.length ? (
                    <ul className="space-y-1">
                      {filesByKey[question.key].map((file, index) => (
                        <li key={file.storageKey || index} className="flex items-center gap-1 text-muted-foreground">
                          <Paperclip className="h-3.5 w-3.5 shrink-0" />
                          {file.url ? <a href={file.url} target="_blank" rel="noreferrer" className="hover:underline">{file.originalName}</a> : <span>{file.originalName}</span>}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-muted-foreground">Needed</p>
                  )}
                </div>
              ))}
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default function ChecklistsTab() {
  const { caseId } = useParams()
  const { refreshToken } = useOutletContext()
  const [checklists, setChecklists] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    questionnairesApi
      .listChecklists(caseId)
      .then(({ data }) => setChecklists(data.data?.checklists || []))
      .catch((err) => setError(err.response?.data?.message || 'Could not load checklists.'))
  }, [caseId, refreshToken])

  if (error) return <p className="text-sm text-destructive">{error}</p>
  if (!checklists) return <Loader2 className="w-6 h-6 animate-spin text-primary" />
  if (!checklists.length) {
    return <p className="text-sm text-muted-foreground card text-center">No checklists assigned on this case yet.</p>
  }

  return (
    <div className="space-y-4">
      {checklists.map((summary) => (
        <ChecklistPanel key={summary.referenceId || summary.questionnaireId} summary={summary} caseId={caseId} />
      ))}
    </div>
  )
}
