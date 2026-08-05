// Generic, read-only render of a resolved case Questionnaire's answers — the
// single-source-of-truth replacement for CRMCaseDetail.jsx's old hand-written,
// H-1B-only renderH1BEmployerPanel()/renderH1BEmployeePanel() (which read from
// a masterData.h1bEmployer/h1bEmployee path nothing writes anymore). Renders
// whatever fields/sections/answers the assigned Questionnaire actually has, for
// any visa type — no visa-specific branching lives in this file or its caller.

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

function AnswerRow({ label, value }) {
  return (
    <p>
      <span className="text-gray-500">{label}:</span>{' '}
      <span className="font-semibold text-gray-900">{value ?? 'Needed'}</span>
    </p>
  )
}

function RepeatingGroupRows({ question, rows }) {
  const fields = question.metadata?.repeatableFields || []
  return (
    <div className="mt-2 grid grid-cols-1 gap-3 md:grid-cols-2">
      {(rows || []).map((row, index) => (
        <div key={row?.id || index} className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm">
          <p className="font-semibold text-gray-900 mb-1">{question.label} {index + 1}</p>
          <p className="text-gray-600">
            {fields.length
              ? fields.map((field) => row?.[field.key]).filter(Boolean).join(', ') || 'Needed'
              : Object.values(row || {}).filter(Boolean).join(', ') || 'Needed'}
          </p>
        </div>
      ))}
      {!(rows || []).length && <p className="text-sm text-gray-500">Needed</p>}
    </div>
  )
}

export default function QuestionnaireAnswersPanel({ title, questionnaire, fieldQuestions, answerMap, loading }) {
  if (loading) {
    return (
      <div className="card">
        <p className="text-sm text-gray-500">Loading questionnaire…</p>
      </div>
    )
  }
  if (!questionnaire || !fieldQuestions?.length) return null

  const sectionOrder = []
  const bySection = new Map()
  fieldQuestions.forEach((question) => {
    const key = question.sectionKey || 'general'
    if (!bySection.has(key)) {
      sectionOrder.push(key)
      bySection.set(key, [])
    }
    bySection.get(key).push(question)
  })

  return (
    <div className="card">
      <h3 className="text-lg font-semibold text-gray-900 mb-4">{title || questionnaire.title}</h3>
      <div className="space-y-5">
        {sectionOrder.map((sectionKey) => {
          const questions = bySection.get(sectionKey)
          const repeatingQuestions = questions.filter((q) => q.type === 'repeating_group')
          const plainQuestions = questions.filter((q) => q.type !== 'repeating_group')
          return (
            <div key={sectionKey}>
              <p className="mb-2 text-sm font-semibold text-gray-900">{sectionTitleFor(questionnaire, sectionKey)}</p>
              {plainQuestions.length > 0 && (
                <div className="grid grid-cols-1 gap-2 text-sm md:grid-cols-2">
                  {plainQuestions.map((question) => (
                    <AnswerRow key={question.key} label={question.label} value={formatAnswerValue(question, answerMap?.[question.key])} />
                  ))}
                </div>
              )}
              {repeatingQuestions.map((question) => (
                <RepeatingGroupRows key={question.key} question={question} rows={answerMap?.[question.key]} />
              ))}
            </div>
          )
        })}
      </div>
    </div>
  )
}
