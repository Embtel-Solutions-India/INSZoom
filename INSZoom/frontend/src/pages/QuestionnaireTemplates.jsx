import { useEffect, useMemo, useState } from 'react'
import { Copy, FileText, GitBranch, Plus, RefreshCcw, Save, Trash2 } from 'lucide-react'
import api, { questionnairesApi } from '../services/api'

const QUESTION_TYPES = ['text', 'textarea', 'number', 'email', 'phone', 'date', 'select', 'multiselect', 'radio', 'checkbox', 'file', 'file-multiple']
const OPERATORS = ['equals', 'not_equals', 'contains', 'greater_than', 'less_than', 'exists', 'not_exists']
const EVIDENCE_CATEGORIES = ['Publication', 'Award', 'Patent', 'Press', 'Membership', 'Judging', 'High Salary', 'Education', 'Employment', 'Impact', 'National Importance']
const TARGET_ROLES = ['', 'employer', 'employee', 'client', 'business_plan']
const TARGET_ROLE_LABELS = { '': 'General', employer: 'Employer', employee: 'Employee', client: 'Client', business_plan: 'Business Plan' }

const emptyTemplate = {
  title: '',
  key: '',
  visaType: 'O1A',
  description: '',
  version: 1,
  status: 'draft',
  isActive: true,
  isTemplate: true,
  type: 'template',
  module: 'cases',
  category: 'immigration',
  sections: []
}

const emptyQuestion = {
  key: '',
  label: '',
  description: '',
  type: 'text',
  sectionKey: '',
  order: 1,
  required: false,
  optionsText: '',
  placeholder: '',
  showIf: { field: '', operator: 'equals', value: '' },
  uscisMappingsText: '',
  eligibilityWeight: 0,
  evidenceCategory: ''
}

function slug(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
}

function normalizeQuestionPayload(form) {
  const options = form.optionsText
    ? form.optionsText.split('\n').map((line) => line.trim()).filter(Boolean).map((value) => ({ label: value, value }))
    : []
  const uscisMappings = form.uscisMappingsText
    ? form.uscisMappingsText.split('\n').map((line) => line.trim()).filter(Boolean)
    : []
  return {
    key: form.key || slug(form.label),
    label: form.label,
    description: form.description,
    helpText: form.description,
    type: form.type,
    sectionKey: form.sectionKey,
    pageKey: form.sectionKey,
    order: Number(form.order) || 1,
    required: Boolean(form.required),
    options,
    placeholder: form.placeholder,
    showIf: form.showIf?.field ? form.showIf : undefined,
    uscisMappings,
    eligibilityWeight: Number(form.eligibilityWeight) || 0,
    evidenceCategory: form.evidenceCategory,
    isActive: true
  }
}

export default function QuestionnaireTemplates() {
  const [templates, setTemplates] = useState([])
  const [selectedId, setSelectedId] = useState('')
  const [selected, setSelected] = useState(null)
  const [questions, setQuestions] = useState([])
  const [cases, setCases] = useState([])
  const [templateForm, setTemplateForm] = useState(emptyTemplate)
  const [sectionTitle, setSectionTitle] = useState('')
  const [questionForm, setQuestionForm] = useState(emptyQuestion)
  const [selectedQuestionId, setSelectedQuestionId] = useState('')
  const [assignCaseId, setAssignCaseId] = useState('')
  const [assignTargetRole, setAssignTargetRole] = useState('')
  const [progressCaseId, setProgressCaseId] = useState('')
  const [progress, setProgress] = useState(null)
  const [mappings, setMappings] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')

  const selectedTemplate = selected?.questionnaire || selected

  const sections = useMemo(() => (
    [...(templateForm.sections || [])].sort((a, b) => (a.order || 0) - (b.order || 0))
  ), [templateForm.sections])

  const loadTemplates = async () => {
    setLoading(true)
    try {
      await questionnairesApi.defaults()
      const response = await questionnairesApi.list({ isTemplate: true, limit: 100 })
      const rows = response.data.data || []
      setTemplates(rows)
      if (!selectedId && rows[0]?._id) setSelectedId(rows[0]._id)
    } finally {
      setLoading(false)
    }
  }

  const loadCases = async () => {
    try {
      const response = await api.get('/cases', { params: { limit: 100 } })
      setCases(response.data.cases || response.data.data || [])
    } catch (error) {
      console.error('Error loading cases', error)
    }
  }

  const loadSelected = async (id) => {
    if (!id) return
    const [templateResponse, mappingsResponse] = await Promise.all([
      questionnairesApi.get(id),
      questionnairesApi.mappings(id)
    ])
    const data = templateResponse.data.data
    setSelected(data)
    setQuestions(data.questions || [])
    setMappings(mappingsResponse.data.data || [])
    setTemplateForm({
      ...emptyTemplate,
      ...data.questionnaire,
      visaType: data.questionnaire.visaType || data.questionnaire.visaTypes?.[0] || '',
      sections: data.questionnaire.sections || []
    })
    const firstSection = data.questionnaire.sections?.[0]?.key || ''
    setQuestionForm((prev) => ({ ...prev, sectionKey: firstSection }))
    setAssignTargetRole(data.questionnaire.checklistRole || '')
  }

  useEffect(() => {
    loadTemplates()
    loadCases()
  }, [])

  useEffect(() => {
    loadSelected(selectedId)
  }, [selectedId])

  const saveTemplate = async () => {
    setSaving(true)
    setMessage('')
    try {
      const payload = {
        ...templateForm,
        key: templateForm.key || slug(templateForm.title),
        visaTypes: [templateForm.visaType].filter(Boolean),
        builder: {
          ...(templateForm.builder || {}),
          layout: 'wizard',
          sectionOrder: (templateForm.sections || []).map((section) => section.key),
          pageOrder: (templateForm.sections || []).map((section) => section.key)
        },
        pages: (templateForm.sections || []).map((section) => ({
          key: section.key,
          title: section.title,
          order: section.order,
          sectionKeys: [section.key]
        }))
      }
      if (selectedTemplate?._id) {
        await questionnairesApi.update(selectedTemplate._id, payload)
        setMessage('Template saved')
      } else {
        const response = await questionnairesApi.create(payload)
        setSelectedId(response.data.data._id)
        setMessage('Template created')
      }
      await loadTemplates()
      if (selectedId) await loadSelected(selectedId)
    } finally {
      setSaving(false)
    }
  }

  const addSection = () => {
    if (!sectionTitle.trim()) return
    const next = {
      key: slug(sectionTitle),
      title: sectionTitle.trim(),
      description: '',
      order: (templateForm.sections || []).length + 1,
      isActive: true
    }
    setTemplateForm((prev) => ({ ...prev, sections: [...(prev.sections || []), next] }))
    setQuestionForm((prev) => ({ ...prev, sectionKey: next.key }))
    setSectionTitle('')
  }

  const saveQuestion = async () => {
    if (!selectedTemplate?._id || !questionForm.label.trim()) return
    setSaving(true)
    try {
      const payload = normalizeQuestionPayload(questionForm)
      if (selectedQuestionId) {
        await questionnairesApi.updateQuestion(selectedTemplate._id, selectedQuestionId, payload)
        setMessage('Question updated')
      } else {
        await questionnairesApi.createQuestion(selectedTemplate._id, payload)
        setMessage('Question added')
      }
      setQuestionForm({ ...emptyQuestion, sectionKey: questionForm.sectionKey })
      setSelectedQuestionId('')
      await loadSelected(selectedTemplate._id)
    } finally {
      setSaving(false)
    }
  }

  const removeQuestion = async (question) => {
    if (!selectedTemplate?._id) return
    if (!window.confirm(`Remove question "${question.label}"?`)) return
    setSaving(true)
    try {
      await questionnairesApi.deleteQuestion(selectedTemplate._id, question._id)
      setMessage('Question removed')
      if (selectedQuestionId === question._id) {
        setSelectedQuestionId('')
        setQuestionForm({ ...emptyQuestion, sectionKey: questionForm.sectionKey })
      }
      await loadSelected(selectedTemplate._id)
    } finally {
      setSaving(false)
    }
  }

  const editQuestion = (question) => {
    setSelectedQuestionId(question._id)
    setQuestionForm({
      ...emptyQuestion,
      ...question,
      description: question.description || question.helpText || '',
      type: question.metadata?.requestedType || question.type,
      optionsText: (question.options || []).map((option) => option.label || option.value).join('\n'),
      uscisMappingsText: (question.uscisMappings || []).join('\n'),
      showIf: question.showIf?.field ? question.showIf : { field: '', operator: 'equals', value: '' }
    })
  }

  const duplicateTemplate = async () => {
    if (!selectedTemplate?._id) return
    const response = await questionnairesApi.duplicate(selectedTemplate._id, {
      title: `${selectedTemplate.title} Copy`,
      key: `${selectedTemplate.key}_copy_${Date.now()}`
    })
    setSelectedId(response.data.data._id)
    await loadTemplates()
  }

  const versionTemplate = async () => {
    if (!selectedTemplate?._id) return
    const response = await questionnairesApi.version(selectedTemplate._id)
    setSelectedId(response.data.data._id)
    await loadTemplates()
  }

  const archiveTemplate = async () => {
    if (!selectedTemplate?._id) return
    await questionnairesApi.archive(selectedTemplate._id)
    setSelectedId('')
    setSelected(null)
    await loadTemplates()
  }

  const assignTemplate = async () => {
    if (!selectedTemplate?._id || !assignCaseId) return
    await questionnairesApi.assign(selectedTemplate._id, { caseId: assignCaseId, targetRole: assignTargetRole || undefined })
    setMessage('Questionnaire assigned to case')
  }

  const loadProgress = async () => {
    if (!selectedTemplate?._id || !progressCaseId) return
    const response = await questionnairesApi.progress(selectedTemplate._id, { caseId: progressCaseId })
    setProgress(response.data.data.progress)
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Questionnaire Templates</h1>
          <p className="text-gray-600 mt-1">Dynamic intake, evidence, USCIS mappings, and eligibility scoring setup</p>
        </div>
        <button onClick={loadTemplates} className="btn-secondary flex items-center gap-2">
          <RefreshCcw className="w-4 h-4" />
          Refresh
        </button>
      </div>

      {message && <div className="p-3 rounded-lg border border-blue-200 bg-blue-50 text-sm font-medium text-blue-700">{message}</div>}

      <div className="grid grid-cols-1 xl:grid-cols-[320px_1fr] gap-6">
        <div className="card p-0 overflow-hidden">
          <div className="p-4 border-b border-gray-200 flex items-center justify-between">
            <h2 className="font-semibold text-gray-900">Templates</h2>
            <button
              onClick={() => {
                setSelectedId('')
                setSelected(null)
                setQuestions([])
                setMappings([])
                setTemplateForm(emptyTemplate)
              }}
              className="p-2 rounded-lg bg-blue-50 text-blue-700 hover:bg-blue-100"
              title="Create template"
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>
          <div className="max-h-[680px] overflow-y-auto">
            {loading ? (
              <div className="p-4 text-sm text-gray-500">Loading templates...</div>
            ) : templates.map((template) => (
              <button
                key={template._id}
                onClick={() => setSelectedId(template._id)}
                className={`w-full text-left px-4 py-3 border-b border-gray-100 hover:bg-gray-50 ${selectedId === template._id ? 'bg-blue-50 border-l-4 border-l-blue-500' : 'border-l-4 border-l-transparent'}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-gray-900 truncate">{template.title}</span>
                  <span className="text-xs bg-gray-100 text-gray-700 rounded-full px-2 py-1">v{template.version}</span>
                </div>
                <p className="text-xs text-gray-500 mt-1 flex items-center gap-2">
                  <span>{template.visaType || template.visaTypes?.[0]} - {template.status}</span>
                  {template.checklistRole && (
                    <span className="text-xs bg-indigo-100 text-indigo-700 rounded-full px-2 py-0.5">{TARGET_ROLE_LABELS[template.checklistRole] || template.checklistRole}</span>
                  )}
                </p>
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-6">
          <div className="card">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
              <h2 className="text-xl font-semibold text-gray-900">Template Builder</h2>
              <div className="flex flex-wrap gap-2">
                <button onClick={saveTemplate} disabled={saving || !templateForm.title.trim()} className="btn-primary flex items-center gap-2 disabled:opacity-50">
                  <Save className="w-4 h-4" />
                  Save
                </button>
                <button onClick={duplicateTemplate} disabled={!selectedTemplate?._id} className="btn-secondary flex items-center gap-2 disabled:opacity-50">
                  <Copy className="w-4 h-4" />
                  Duplicate
                </button>
                <button onClick={versionTemplate} disabled={!selectedTemplate?._id} className="btn-secondary flex items-center gap-2 disabled:opacity-50">
                  <GitBranch className="w-4 h-4" />
                  Version
                </button>
                <button onClick={archiveTemplate} disabled={!selectedTemplate?._id} className="btn-secondary flex items-center gap-2 text-red-600 disabled:opacity-50">
                  <Trash2 className="w-4 h-4" />
                  Delete
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <input className="input-field" placeholder="Template title" value={templateForm.title} onChange={(e) => setTemplateForm((prev) => ({ ...prev, title: e.target.value, key: prev.key || slug(e.target.value) }))} />
              <input className="input-field" placeholder="Key" value={templateForm.key} onChange={(e) => setTemplateForm((prev) => ({ ...prev, key: e.target.value }))} />
              <input className="input-field" placeholder="Visa type" value={templateForm.visaType || ''} onChange={(e) => setTemplateForm((prev) => ({ ...prev, visaType: e.target.value }))} />
              <select className="input-field" value={templateForm.status || 'draft'} onChange={(e) => setTemplateForm((prev) => ({ ...prev, status: e.target.value }))}>
                <option value="draft">Draft</option>
                <option value="published">Published</option>
                <option value="archived">Archived</option>
              </select>
              <textarea className="input-field md:col-span-2 min-h-[90px]" placeholder="Description" value={templateForm.description || ''} onChange={(e) => setTemplateForm((prev) => ({ ...prev, description: e.target.value }))} />
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="card">
              <h3 className="font-semibold text-gray-900 mb-4">Sections</h3>
              <div className="flex gap-2 mb-4">
                <input className="input-field" placeholder="Section title" value={sectionTitle} onChange={(e) => setSectionTitle(e.target.value)} />
                <button onClick={addSection} className="btn-primary">Add</button>
              </div>
              <div className="space-y-2">
                {sections.map((section) => (
                  <div key={section.key} className="p-3 rounded-lg border border-gray-200 bg-gray-50 flex items-center justify-between">
                    <div>
                      <p className="font-medium text-gray-900">{section.title}</p>
                      <p className="text-xs text-gray-500">{section.key}</p>
                    </div>
                    <span className="text-xs text-gray-400">#{section.order}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="card">
              <h3 className="font-semibold text-gray-900 mb-4">{selectedQuestionId ? 'Edit Question' : 'Add Question'}</h3>
              <div className="space-y-3">
                <input className="input-field" placeholder="Question label" value={questionForm.label} onChange={(e) => setQuestionForm((prev) => ({ ...prev, label: e.target.value, key: prev.key || slug(e.target.value) }))} />
                <input className="input-field" placeholder="Question key" value={questionForm.key} onChange={(e) => setQuestionForm((prev) => ({ ...prev, key: e.target.value }))} />
                <div className="grid grid-cols-2 gap-3">
                  <select className="input-field" value={questionForm.sectionKey} onChange={(e) => setQuestionForm((prev) => ({ ...prev, sectionKey: e.target.value }))}>
                    <option value="">Section</option>
                    {sections.map((section) => <option key={section.key} value={section.key}>{section.title}</option>)}
                  </select>
                  <select className="input-field" value={questionForm.type} onChange={(e) => setQuestionForm((prev) => ({ ...prev, type: e.target.value }))}>
                    {QUESTION_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
                  </select>
                </div>
                <textarea className="input-field" placeholder="Description/help text" value={questionForm.description} onChange={(e) => setQuestionForm((prev) => ({ ...prev, description: e.target.value }))} />
                <textarea className="input-field" placeholder="Options, one per line" value={questionForm.optionsText} onChange={(e) => setQuestionForm((prev) => ({ ...prev, optionsText: e.target.value }))} />
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <input className="input-field" placeholder="Show if field" value={questionForm.showIf?.field || ''} onChange={(e) => setQuestionForm((prev) => ({ ...prev, showIf: { ...(prev.showIf || {}), field: e.target.value } }))} />
                  <select className="input-field" value={questionForm.showIf?.operator || 'equals'} onChange={(e) => setQuestionForm((prev) => ({ ...prev, showIf: { ...(prev.showIf || {}), operator: e.target.value } }))}>
                    {OPERATORS.map((operator) => <option key={operator} value={operator}>{operator}</option>)}
                  </select>
                  <input className="input-field" placeholder="Show if value" value={questionForm.showIf?.value || ''} onChange={(e) => setQuestionForm((prev) => ({ ...prev, showIf: { ...(prev.showIf || {}), value: e.target.value } }))} />
                </div>
                <textarea className="input-field" placeholder="USCIS mappings, one per line" value={questionForm.uscisMappingsText} onChange={(e) => setQuestionForm((prev) => ({ ...prev, uscisMappingsText: e.target.value }))} />
                <div className="grid grid-cols-2 gap-3">
                  <input className="input-field" type="number" placeholder="Eligibility weight" value={questionForm.eligibilityWeight} onChange={(e) => setQuestionForm((prev) => ({ ...prev, eligibilityWeight: e.target.value }))} />
                  <select className="input-field" value={questionForm.evidenceCategory} onChange={(e) => setQuestionForm((prev) => ({ ...prev, evidenceCategory: e.target.value }))}>
                    <option value="">Evidence category</option>
                    {EVIDENCE_CATEGORIES.map((category) => <option key={category} value={category}>{category}</option>)}
                  </select>
                </div>
                <label className="flex items-center gap-2 text-sm text-gray-700">
                  <input type="checkbox" checked={questionForm.required} onChange={(e) => setQuestionForm((prev) => ({ ...prev, required: e.target.checked }))} />
                  Required
                </label>
                <button onClick={saveQuestion} disabled={saving || !selectedTemplate?._id || !questionForm.label.trim()} className="btn-primary w-full disabled:opacity-50">
                  {selectedQuestionId ? 'Update Question' : 'Add Question'}
                </button>
              </div>
            </div>
          </div>

          <div className="card">
            <h3 className="font-semibold text-gray-900 mb-4">Questions</h3>
            {questions.length === 0 ? (
              <p className="text-sm text-gray-500">No questions yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 text-left text-gray-500">
                      <th className="py-2 pr-3">Order</th>
                      <th className="py-2 pr-3">Label</th>
                      <th className="py-2 pr-3">Type</th>
                      <th className="py-2 pr-3">Section</th>
                      <th className="py-2 pr-3">Weight</th>
                      <th className="py-2 pr-3">Evidence</th>
                      <th className="py-2 pr-3">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {questions.map((question) => (
                      <tr key={question._id} className="border-b border-gray-100">
                        <td className="py-2 pr-3">{question.order}</td>
                        <td className="py-2 pr-3 font-medium text-gray-900">{question.label}</td>
                        <td className="py-2 pr-3">{question.metadata?.requestedType || question.type}</td>
                        <td className="py-2 pr-3">{question.sectionKey}</td>
                        <td className="py-2 pr-3">{question.eligibilityWeight || 0}</td>
                        <td className="py-2 pr-3">{question.evidenceCategory || '-'}</td>
                        <td className="py-2 pr-3">
                          <div className="flex items-center gap-3">
                            <button onClick={() => editQuestion(question)} className="text-blue-700 font-medium">Edit</button>
                            <button onClick={() => removeQuestion(question)} className="text-red-600 font-medium">Remove</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="card">
              <h3 className="font-semibold text-gray-900 mb-4">Case Assignment & Progress</h3>
              <div className="space-y-3">
                <select className="input-field" value={assignCaseId} onChange={(e) => setAssignCaseId(e.target.value)}>
                  <option value="">Select case to assign</option>
                  {cases.map((item) => <option key={item._id} value={item._id}>{item.caseNumber || item.caseId} - {item.clientName}</option>)}
                </select>
                <select className="input-field" value={assignTargetRole} onChange={(e) => setAssignTargetRole(e.target.value)}>
                  {TARGET_ROLES.map((role) => <option key={role || 'general'} value={role}>{TARGET_ROLE_LABELS[role]}</option>)}
                </select>
                <button onClick={assignTemplate} disabled={!selectedTemplate?._id || !assignCaseId} className="btn-primary w-full disabled:opacity-50">Assign Questionnaire</button>
                <select className="input-field" value={progressCaseId} onChange={(e) => setProgressCaseId(e.target.value)}>
                  <option value="">Select case for progress</option>
                  {cases.map((item) => <option key={item._id} value={item._id}>{item.caseNumber || item.caseId} - {item.clientName}</option>)}
                </select>
                <button onClick={loadProgress} disabled={!selectedTemplate?._id || !progressCaseId} className="btn-secondary w-full disabled:opacity-50">Load Progress</button>
                {progress && (
                  <div className="p-3 rounded-lg bg-gray-50 border border-gray-200">
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-medium text-gray-900">Overall</span>
                      <span className="font-bold text-blue-700">{progress.completionPercentage}%</span>
                    </div>
                    <div className="h-2 rounded-full bg-gray-200 overflow-hidden">
                      <div className="h-full bg-blue-500" style={{ width: `${progress.completionPercentage}%` }} />
                    </div>
                    <div className="mt-3 space-y-2">
                      {(progress.sections || []).map((section) => (
                        <div key={section.key} className="flex items-center justify-between text-sm">
                          <span>{section.title}</span>
                          <span className="font-medium">{section.completionPercentage}%</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="card">
              <h3 className="font-semibold text-gray-900 mb-4">USCIS Mappings</h3>
              {mappings.length === 0 ? (
                <p className="text-sm text-gray-500">No mappings configured.</p>
              ) : (
                <div className="space-y-2 max-h-80 overflow-y-auto">
                  {mappings.map((mapping) => (
                    <div key={mapping.questionKey} className="p-3 rounded-lg border border-gray-200 bg-gray-50">
                      <div className="flex items-center gap-2 text-sm font-medium text-gray-900">
                        <FileText className="w-4 h-4 text-blue-600" />
                        {mapping.questionKey}
                      </div>
                      <div className="mt-1 text-xs text-gray-600">
                        {mapping.uscisMappings.map((item) => <div key={item}>{item}</div>)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
