import { useEffect, useMemo, useState, useRef } from 'react'
import {
  Plus, Copy, Trash2, GripVertical, MoreVertical, Search, X, SeparatorHorizontal, Type as TypeIcon,
  Library, ChevronLeft, ChevronRight, FileText, Lock, Pencil
} from 'lucide-react'
import api, { questionnairesApi, eligibilityQuizApi } from '../services/api'

const QUESTION_TYPE_OPTIONS = [
  { label: 'Short answer', value: 'text', icon: '—' },
  { label: 'Long answer', value: 'textarea', icon: '≡' },
  { label: 'Number', value: 'number', icon: '#' },
  { label: 'Date', value: 'date', icon: '📅' },
  { label: 'Email', value: 'email', icon: '@' },
  { label: 'Phone number', value: 'phone', icon: '☎' },
  { label: 'Multiple choice', value: 'radio', icon: '○' },
  { label: 'Checkboxes', value: 'checkbox', icon: '☑' },
  { label: 'Dropdown', value: 'select', icon: '▼' },
  { label: 'Multi-select', value: 'multiselect', icon: '☑☑' },
  { label: 'File upload', value: 'file', icon: '📎' },
  { label: 'Multiple files', value: 'file-multiple', icon: '📎' },
]
const QUESTION_TYPE_LABELS = Object.fromEntries(QUESTION_TYPE_OPTIONS.map((option) => [option.value, option.label]))
const CHOICE_TYPES = new Set(['radio', 'checkbox', 'select', 'multiselect'])
const OPERATORS = ['equals', 'not_equals', 'contains', 'greater_than', 'less_than', 'exists', 'not_exists']
const EVIDENCE_CATEGORIES = ['Publication', 'Award', 'Patent', 'Press', 'Membership', 'Judging', 'High Salary', 'Education', 'Employment', 'Impact', 'National Importance']

const CATEGORY_LABELS = {
  work: 'Employment',
  family: 'Family',
  green_card: 'Green Card',
  investor: 'Investor',
  extraordinary_ability: 'Extraordinary Ability',
  temporary: 'Temporary',
  other: 'Other',
}

// Who can be assigned this checklist, based on the selected visa's category.
// Values map onto the existing CHECKLIST_ROLES enum
// (["employer","employee","petitioner","beneficiary","client","business_plan",""]).
const ROLE_CONFIG = {
  work: [
    { label: 'Employer', value: 'employer' },
    { label: 'Employee / Beneficiary', value: 'employee' },
    { label: 'Business Plan', value: 'business_plan' },
  ],
  family: [
    { label: 'Petitioner', value: 'petitioner' },
    { label: 'Beneficiary', value: 'beneficiary' },
    { label: 'Joint Sponsor', value: 'client' },
  ],
  green_card: [
    { label: 'Employer', value: 'employer' },
    { label: 'Applicant / Beneficiary', value: 'beneficiary' },
    { label: 'Business Plan', value: 'business_plan' },
  ],
  investor: [
    { label: 'Investor / Applicant', value: 'beneficiary' },
    { label: 'Business Plan', value: 'business_plan' },
  ],
  extraordinary_ability: [
    { label: 'Applicant / Beneficiary', value: 'beneficiary' },
    { label: 'Petitioning Organization', value: 'employer' },
  ],
}
const DEFAULT_ROLE_OPTIONS = [{ label: 'General / Client', value: 'client' }]

const TARGET_ROLES = ['', 'employer', 'employee', 'petitioner', 'beneficiary', 'client', 'business_plan']
const TARGET_ROLE_LABELS = {
  '': 'General',
  employer: 'Employer',
  employee: 'Employee',
  petitioner: 'Petitioner',
  beneficiary: 'Beneficiary',
  client: 'Client',
  business_plan: 'Business Plan',
}

const emptyTemplate = {
  title: '',
  key: '',
  visaType: '',
  description: '',
  version: 1,
  status: 'draft',
  isActive: true,
  isTemplate: true,
  type: 'template',
  module: 'cases',
  category: 'immigration',
  checklistRole: '',
  sections: [],
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
  evidenceCategory: '',
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
    isActive: true,
  }
}

export default function QuestionnaireTemplates() {
  // ── Existing state (unchanged) ──────────────────────────────────────────
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

  // ── New state (Google Forms-style builder) ──────────────────────────────
  const [visaPathways, setVisaPathways] = useState([])
  const [createWizardOpen, setCreateWizardOpen] = useState(false)
  const [wizardStep, setWizardStep] = useState(1)
  const [wizardForm, setWizardForm] = useState({ title: '', visaType: '', checklistRole: '' })
  const [editingCardId, setEditingCardId] = useState('') // '' | 'new' | question._id
  const [advancedPanelOpen, setAdvancedPanelOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [publishing, setPublishing] = useState(false)
  const [creatingVersion, setCreatingVersion] = useState(false)
  const [dragOverId, setDragOverId] = useState('')
  const [showCaseTools, setShowCaseTools] = useState(false)
  const cardRef = useRef(null)

  const selectedTemplate = selected?.questionnaire || selected
  const isPublished = selectedTemplate?.status === 'published'

  const sections = useMemo(() => (
    [...(templateForm.sections || [])].sort((a, b) => (a.order || 0) - (b.order || 0))
  ), [templateForm.sections])

  const visaCategoryByKey = useMemo(() => {
    const map = {}
    visaPathways.forEach((visa) => { map[visa.key] = visa.category })
    return map
  }, [visaPathways])

  const visasByCategory = useMemo(() => {
    const groups = {}
    visaPathways.forEach((visa) => {
      const category = visa.category || 'other'
      if (!groups[category]) groups[category] = []
      groups[category].push(visa)
    })
    return groups
  }, [visaPathways])

  const roleOptionsForCategory = (category) => ROLE_CONFIG[category] || DEFAULT_ROLE_OPTIONS

  const groupedTemplates = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    const filtered = templates.filter((t) => (
      !query ||
      (t.title || '').toLowerCase().includes(query) ||
      (t.visaType || t.visaTypes?.[0] || '').toLowerCase().includes(query)
    ))
    const groups = {}
    filtered.forEach((t) => {
      const visaKey = t.visaType || t.visaTypes?.[0] || ''
      const category = visaCategoryByKey[visaKey] || 'other'
      if (!groups[category]) groups[category] = []
      groups[category].push(t)
    })
    return groups
  }, [templates, searchQuery, visaCategoryByKey])

  // ── Data loading (existing functions, unchanged) ────────────────────────
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

  const loadVisaPathways = async () => {
    try {
      const response = await eligibilityQuizApi.visas()
      setVisaPathways(response.data.data || [])
    } catch (error) {
      console.error('Error loading visa pathways', error)
    }
  }

  const loadSelected = async (id) => {
    if (!id) return
    const [templateResponse, mappingsResponse] = await Promise.all([
      questionnairesApi.get(id),
      questionnairesApi.mappings(id),
    ])
    const data = templateResponse.data.data
    setSelected(data)
    setQuestions(data.questions || [])
    setMappings(mappingsResponse.data.data || [])
    setTemplateForm({
      ...emptyTemplate,
      ...data.questionnaire,
      visaType: data.questionnaire.visaType || data.questionnaire.visaTypes?.[0] || '',
      sections: data.questionnaire.sections || [],
    })
    const firstSection = data.questionnaire.sections?.[0]?.key || ''
    setQuestionForm((prev) => ({ ...prev, sectionKey: firstSection }))
    setAssignTargetRole(data.questionnaire.checklistRole || '')
    setEditingCardId('')
  }

  useEffect(() => {
    loadTemplates()
    loadCases()
    loadVisaPathways()
  }, [])

  useEffect(() => {
    loadSelected(selectedId)
  }, [selectedId])

  // ── Existing mutation functions (unchanged) ─────────────────────────────
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
          pageOrder: (templateForm.sections || []).map((section) => section.key),
        },
        pages: (templateForm.sections || []).map((section) => ({
          key: section.key,
          title: section.title,
          order: section.order,
          sectionKeys: [section.key],
        })),
      }
      if (selectedTemplate?._id) {
        await questionnairesApi.update(selectedTemplate._id, payload)
      } else {
        const response = await questionnairesApi.create(payload)
        setSelectedId(response.data.data._id)
      }
      await loadTemplates()
      if (selectedId) await loadSelected(selectedId)
    } finally {
      setSaving(false)
    }
  }

  const addSection = (titleOverride) => {
    const title = (titleOverride ?? sectionTitle).trim()
    if (!title) return
    const next = {
      key: slug(title) || `section_${Date.now()}`,
      title,
      description: '',
      order: (templateForm.sections || []).length + 1,
      isActive: true,
    }
    setTemplateForm((prev) => ({ ...prev, sections: [...(prev.sections || []), next] }))
    setQuestionForm((prev) => ({ ...prev, sectionKey: next.key }))
    setSectionTitle('')
    return next
  }

  const saveQuestion = async () => {
    if (!selectedTemplate?._id || !questionForm.label.trim()) return
    setSaving(true)
    try {
      const payload = normalizeQuestionPayload(questionForm)
      if (selectedQuestionId) {
        await questionnairesApi.updateQuestion(selectedTemplate._id, selectedQuestionId, payload)
      } else {
        await questionnairesApi.createQuestion(selectedTemplate._id, payload)
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
      if (selectedQuestionId === question._id) {
        setSelectedQuestionId('')
        setEditingCardId('')
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
      showIf: question.showIf?.field ? question.showIf : { field: '', operator: 'equals', value: '' },
    })
  }

  const duplicateTemplate = async () => {
    if (!selectedTemplate?._id) return
    const response = await questionnairesApi.duplicate(selectedTemplate._id, {
      title: `${selectedTemplate.title} Copy`,
      key: `${selectedTemplate.key}_copy_${Date.now()}`,
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
    if (!window.confirm(`Delete "${selectedTemplate.title}"? This cannot be undone.`)) return
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

  // ── New: create wizard ───────────────────────────────────────────────────
  const openCreateWizard = () => {
    setWizardForm({ title: '', visaType: '', checklistRole: '' })
    setWizardStep(1)
    setCreateWizardOpen(true)
  }

  const handleCreateChecklist = async () => {
    if (!wizardForm.title.trim() || !wizardForm.visaType || !wizardForm.checklistRole) return
    setSaving(true)
    try {
      const payload = {
        title: wizardForm.title.trim(),
        key: slug(wizardForm.title) || `checklist_${Date.now()}`,
        visaType: wizardForm.visaType,
        visaTypes: [wizardForm.visaType],
        checklistRole: wizardForm.checklistRole,
        status: 'draft',
        isActive: true,
        isTemplate: true,
        type: 'template',
        module: 'cases',
        category: 'immigration',
        sections: [],
        version: 1,
      }
      const response = await questionnairesApi.create(payload)
      setSelectedId(response.data.data._id)
      await loadTemplates()
      setCreateWizardOpen(false)
      setMessage('Checklist created — add your questions below')
    } finally {
      setSaving(false)
    }
  }

  // ── New: publish / versioning lifecycle ─────────────────────────────────
  // Draft -> Save publishes it (live for future cases).
  // Published -> "Edit" transparently creates a new draft version first; the
  // subsequent Save on that draft publishes it, replacing the live version
  // for FUTURE cases only - resolveCaseQuestionnaires already keeps existing
  // case assignments pinned to the exact version they were given.
  const handleSave = async () => {
    if (!selectedTemplate?._id) return
    setPublishing(true)
    setMessage('')
    try {
      await saveTemplate()
      await questionnairesApi.publish(selectedTemplate._id)
      setMessage('Published — future cases will use this version')
      await loadTemplates()
      await loadSelected(selectedTemplate._id)
    } catch (error) {
      setMessage(error?.response?.data?.message || 'Could not publish checklist')
    } finally {
      setPublishing(false)
    }
  }

  const handleEditPublished = async () => {
    if (!selectedTemplate?._id) return
    setCreatingVersion(true)
    setMessage('')
    try {
      const response = await questionnairesApi.version(selectedTemplate._id)
      const newId = response.data.data._id
      setSelectedId(newId)
      await loadTemplates()
      setMessage(`Editing v${(selectedTemplate.version || 1) + 1} (draft) — existing cases keep using v${selectedTemplate.version || 1}`)
    } finally {
      setCreatingVersion(false)
    }
  }

  // ── New: inline question card editing ───────────────────────────────────
  const beginNewQuestion = (sectionKey) => {
    setSelectedQuestionId('')
    setQuestionForm({ ...emptyQuestion, sectionKey: sectionKey || sections[0]?.key || '' })
    setEditingCardId('new')
  }

  const beginEditQuestion = (question) => {
    editQuestion(question)
    setEditingCardId(question._id)
  }

  const closeCardEditor = () => {
    setEditingCardId('')
    setSelectedQuestionId('')
    setQuestionForm({ ...emptyQuestion, sectionKey: questionForm.sectionKey })
  }

  // Commits the card's edits when focus leaves the whole card (click
  // elsewhere on the page), so changes are persisted the moment the user is
  // done with a question - no separate "save question" button to remember.
  const handleCardBlur = (event) => {
    if (event.currentTarget.contains(event.relatedTarget)) return
    if (!questionForm.label.trim()) { closeCardEditor(); return }
    saveQuestion().then(() => setEditingCardId(''))
  }

  const handleAddOption = () => {
    setQuestionForm((prev) => ({
      ...prev,
      optionsText: prev.optionsText ? `${prev.optionsText}\nOption ${prev.optionsText.split('\n').filter(Boolean).length + 1}` : 'Option 1',
    }))
  }

  const removeOptionLine = (index) => {
    setQuestionForm((prev) => {
      const lines = prev.optionsText.split('\n').filter((_, i) => i !== index)
      return { ...prev, optionsText: lines.join('\n') }
    })
  }

  const updateOptionLine = (index, value) => {
    setQuestionForm((prev) => {
      const lines = prev.optionsText.split('\n')
      lines[index] = value
      return { ...prev, optionsText: lines.join('\n') }
    })
  }

  // ── New: drag-and-drop reorder (HTML5 DnD, no extra library) ────────────
  const handleDragStart = (event, questionId) => {
    event.dataTransfer.setData('text/plain', questionId)
    event.dataTransfer.effectAllowed = 'move'
  }

  const handleDragOver = (event, questionId) => {
    event.preventDefault()
    if (dragOverId !== questionId) setDragOverId(questionId)
  }

  const handleDrop = async (event, targetQuestionId) => {
    event.preventDefault()
    setDragOverId('')
    const sourceId = event.dataTransfer.getData('text/plain')
    if (!sourceId || sourceId === targetQuestionId) return
    const current = [...questions]
    const sourceIndex = current.findIndex((q) => q._id === sourceId)
    const targetIndex = current.findIndex((q) => q._id === targetQuestionId)
    if (sourceIndex === -1 || targetIndex === -1) return
    const [moved] = current.splice(sourceIndex, 1)
    current.splice(targetIndex, 0, moved)
    setQuestions(current)
    try {
      await questionnairesApi.reorder(selectedTemplate._id, { questionOrder: current.map((q) => q._id) })
    } catch (error) {
      console.error('Reorder failed', error)
      await loadSelected(selectedTemplate._id)
    }
  }

  // Questions grouped by section, in section order, for card rendering.
  const questionsBySection = useMemo(() => {
    const groups = {}
    questions.forEach((question) => {
      const key = question.sectionKey || ''
      if (!groups[key]) groups[key] = []
      groups[key].push(question)
    })
    return groups
  }, [questions])

  const sectionsToRender = sections.length ? sections : (questionsBySection[''] ? [{ key: '', title: '', order: 0 }] : [])

  return (
    <div className="flex h-[calc(100vh-5rem)] -m-6 overflow-hidden">
      {/* ── Left sidebar ─────────────────────────────────────────────── */}
      <div className="w-72 shrink-0 border-r border-gray-200 bg-white flex flex-col">
        <div className="p-4 border-b border-gray-200 flex items-center justify-between">
          <h2 className="font-bold text-gray-900">Checklists</h2>
          <button onClick={openCreateWizard} className="p-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700" title="Create checklist">
            <Plus className="w-4 h-4" />
          </button>
        </div>
        <div className="p-3 border-b border-gray-100">
          <div className="relative">
            <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              className="input-field pl-9 text-sm"
              placeholder="Search checklists"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="p-4 text-sm text-gray-500">Loading checklists...</div>
          ) : Object.keys(groupedTemplates).length === 0 ? (
            <div className="p-4 text-sm text-gray-500">No checklists yet.</div>
          ) : Object.entries(groupedTemplates).map(([category, items]) => (
            <div key={category}>
              <div className="px-4 pt-3 pb-1 text-[11px] font-bold uppercase tracking-wider text-gray-400">
                {CATEGORY_LABELS[category] || category}
              </div>
              {items.map((template) => (
                <button
                  key={template._id}
                  onClick={() => setSelectedId(template._id)}
                  className={`w-full text-left px-4 py-3 border-l-4 hover:bg-gray-50 transition-colors ${selectedId === template._id ? 'bg-blue-50 border-l-blue-500' : 'border-l-transparent'}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-gray-900 truncate text-sm">{template.title}</span>
                    <span className="text-[10px] bg-gray-100 text-gray-600 rounded-full px-1.5 py-0.5 shrink-0">v{template.version}</span>
                  </div>
                  <div className="flex items-center gap-1.5 mt-1">
                    <span className="text-xs text-gray-500">{template.visaType || template.visaTypes?.[0]}</span>
                    {template.checklistRole && (
                      <span className="text-[10px] bg-indigo-100 text-indigo-700 rounded-full px-1.5 py-0.5">
                        {TARGET_ROLE_LABELS[template.checklistRole] || template.checklistRole}
                      </span>
                    )}
                    {selectedId === template._id && (
                      <span className={`text-[10px] rounded-full px-1.5 py-0.5 ${template.status === 'published' ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-200 text-gray-600'}`}>
                        {template.status === 'published' ? 'Published' : 'Draft'}
                      </span>
                    )}
                  </div>
                </button>
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* ── Builder area ─────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto relative">
        {message && (
          <div className="sticky top-0 z-20 p-3 border-b border-blue-200 bg-blue-50 text-sm font-medium text-blue-700 flex items-center justify-between">
            {message}
            <button onClick={() => setMessage('')}><X className="w-4 h-4" /></button>
          </div>
        )}

        {!selectedTemplate ? (
          <div className="h-full flex flex-col items-center justify-center text-gray-400 gap-3">
            <FileText className="w-12 h-12" />
            <p>Select a checklist, or create a new one to get started.</p>
          </div>
        ) : (
          <div className="max-w-3xl mx-auto py-8 px-6 space-y-4">
            {/* Header card */}
            <div className="card overflow-hidden !p-0">
              <div className="h-2 bg-blue-600" />
              <div className="p-6">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <input
                      className="text-2xl font-bold text-gray-900 w-full border-b border-transparent hover:border-gray-200 focus:border-blue-500 outline-none pb-1 bg-transparent"
                      value={templateForm.title}
                      disabled={isPublished}
                      placeholder="Checklist title"
                      onChange={(e) => setTemplateForm((prev) => ({ ...prev, title: e.target.value, key: prev.key || slug(e.target.value) }))}
                    />
                    <input
                      className="text-sm text-gray-500 w-full border-b border-transparent hover:border-gray-200 focus:border-blue-500 outline-none mt-2 pb-1 bg-transparent"
                      value={templateForm.description || ''}
                      disabled={isPublished}
                      placeholder="Checklist description (optional)"
                      onChange={(e) => setTemplateForm((prev) => ({ ...prev, description: e.target.value }))}
                    />
                    <div className="flex items-center gap-2 mt-3 flex-wrap">
                      <span className="text-xs bg-gray-100 text-gray-700 rounded-full px-2.5 py-1 font-medium">{templateForm.visaType}</span>
                      {templateForm.checklistRole && (
                        <span className="text-xs bg-indigo-100 text-indigo-700 rounded-full px-2.5 py-1 font-medium">{TARGET_ROLE_LABELS[templateForm.checklistRole]}</span>
                      )}
                      <span className="text-xs bg-gray-100 text-gray-700 rounded-full px-2.5 py-1 font-medium">v{selectedTemplate.version}</span>
                      <span className={`text-xs rounded-full px-2.5 py-1 font-medium ${isPublished ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                        {isPublished ? 'Published' : 'Draft'}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {isPublished ? (
                      <button onClick={handleEditPublished} disabled={creatingVersion} className="btn-primary flex items-center gap-2 disabled:opacity-50">
                        <Pencil className="w-4 h-4" />
                        {creatingVersion ? 'Opening...' : 'Edit'}
                      </button>
                    ) : (
                      <button onClick={handleSave} disabled={publishing || saving || !templateForm.title.trim()} className="btn-primary flex items-center gap-2 disabled:opacity-50">
                        {publishing ? 'Publishing...' : 'Save'}
                      </button>
                    )}
                    <div className="relative group">
                      <button className="p-2 rounded-lg border border-gray-200 hover:bg-gray-50">
                        <MoreVertical className="w-4 h-4 text-gray-500" />
                      </button>
                      <div className="absolute right-0 mt-1 w-44 bg-white border border-gray-200 rounded-lg shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-30 py-1">
                        <button onClick={duplicateTemplate} className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 flex items-center gap-2">
                          <Copy className="w-3.5 h-3.5" /> Duplicate
                        </button>
                        <button onClick={archiveTemplate} className="w-full text-left px-3 py-2 text-sm text-red-600 hover:bg-red-50 flex items-center gap-2">
                          <Trash2 className="w-3.5 h-3.5" /> Delete
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
                {isPublished && (
                  <div className="mt-4 flex items-center gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                    <Lock className="w-3.5 h-3.5 shrink-0" />
                    Published checklists are locked. Click "Edit" to open a new draft version — existing cases keep the version they already have.
                  </div>
                )}
              </div>
            </div>

            {/* Question sections */}
            {!isPublished && sectionsToRender.map((section) => (
              <div key={section.key || 'default'} className="space-y-3">
                {section.title && (
                  <div className="flex items-center gap-3 pt-2">
                    <h3 className="text-sm font-bold text-gray-500 uppercase tracking-wide">{section.title}</h3>
                    <div className="flex-1 h-px bg-gray-200" />
                    <button onClick={() => beginNewQuestion(section.key)} className="text-xs text-blue-600 font-semibold hover:underline shrink-0">
                      + Add here
                    </button>
                  </div>
                )}
                {(questionsBySection[section.key] || []).map((question) => (
                  <QuestionCard
                    key={question._id}
                    question={question}
                    isEditing={editingCardId === question._id}
                    isDragOver={dragOverId === question._id}
                    questionForm={questionForm}
                    setQuestionForm={setQuestionForm}
                    onOpen={() => beginEditQuestion(question)}
                    onBlurContainer={handleCardBlur}
                    onDuplicate={() => {
                      setQuestionForm({ ...emptyQuestion, ...normalizeQuestionPayload(questionForm), sectionKey: question.sectionKey, key: '', label: `${question.label} (copy)` })
                      setSelectedQuestionId('')
                      setEditingCardId('new')
                    }}
                    onRemove={() => removeQuestion(question)}
                    onAddOption={handleAddOption}
                    onRemoveOption={removeOptionLine}
                    onUpdateOption={updateOptionLine}
                    onOpenAdvanced={() => setAdvancedPanelOpen(true)}
                    onDragStart={(e) => handleDragStart(e, question._id)}
                    onDragOver={(e) => handleDragOver(e, question._id)}
                    onDrop={(e) => handleDrop(e, question._id)}
                    onDragLeave={() => setDragOverId('')}
                  />
                ))}
                {editingCardId === 'new' && questionForm.sectionKey === section.key && (
                  <NewQuestionCard
                    questionForm={questionForm}
                    setQuestionForm={setQuestionForm}
                    onBlurContainer={handleCardBlur}
                    onAddOption={handleAddOption}
                    onRemoveOption={removeOptionLine}
                    onUpdateOption={updateOptionLine}
                    onCancel={closeCardEditor}
                  />
                )}
              </div>
            ))}

            {!isPublished && sections.length === 0 && (
              <div className="card text-center py-10 text-gray-400 text-sm space-y-3">
                <p>No sections yet. Add one to start building this checklist.</p>
                <div className="flex items-center justify-center gap-2 max-w-sm mx-auto">
                  <input className="input-field" placeholder="Section title (e.g. Personal Information)" value={sectionTitle} onChange={(e) => setSectionTitle(e.target.value)} />
                  <button onClick={() => addSection()} className="btn-primary shrink-0">Add</button>
                </div>
              </div>
            )}

            {!isPublished && sections.length > 0 && (
              <div className="flex items-center gap-2 max-w-sm">
                <input className="input-field text-sm" placeholder="New section title" value={sectionTitle} onChange={(e) => setSectionTitle(e.target.value)} />
                <button onClick={() => addSection()} className="btn-secondary shrink-0 text-sm">
                  <SeparatorHorizontal className="w-3.5 h-3.5 inline mr-1" /> Add section
                </button>
              </div>
            )}

            {isPublished && questions.length > 0 && (
              <div className="space-y-3">
                {questions.map((question) => (
                  <div key={question._id} className="card !py-3 !px-4 flex items-center justify-between opacity-80">
                    <div>
                      <p className="font-medium text-gray-900 text-sm">{question.label}</p>
                      <p className="text-xs text-gray-400">{QUESTION_TYPE_LABELS[question.metadata?.requestedType || question.type] || question.type}</p>
                    </div>
                    <Lock className="w-3.5 h-3.5 text-gray-300" />
                  </div>
                ))}
              </div>
            )}

            {/* Case assignment / progress / USCIS mappings - unchanged tools, tucked below the fold */}
            <div className="pt-6">
              <button onClick={() => setShowCaseTools((v) => !v)} className="text-xs font-semibold text-gray-400 hover:text-gray-600 flex items-center gap-1">
                {showCaseTools ? <ChevronLeft className="w-3.5 h-3.5 rotate-90" /> : <ChevronRight className="w-3.5 h-3.5" />}
                Case assignment, progress & USCIS mappings
              </button>
              {showCaseTools && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-3">
                  <div className="card">
                    <h3 className="font-semibold text-gray-900 mb-4">Case Assignment &amp; Progress</h3>
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
              )}
            </div>
          </div>
        )}

        {/* Floating right toolbar (Google Forms-style) */}
        {selectedTemplate && !isPublished && (
          <div className="fixed right-8 top-1/2 -translate-y-1/2 bg-white border border-gray-200 rounded-2xl shadow-lg flex flex-col divide-y divide-gray-100 z-20">
            <button onClick={() => beginNewQuestion(sections[sections.length - 1]?.key)} disabled={!sections.length} className="p-3 hover:bg-gray-50 rounded-t-2xl disabled:opacity-30" title="Add question">
              <Plus className="w-5 h-5 text-gray-600" />
            </button>
            <button onClick={() => { const created = addSection(sectionTitle || `Section ${sections.length + 1}`); if (created) setSectionTitle('') }} className="p-3 hover:bg-gray-50" title="Add section divider">
              <SeparatorHorizontal className="w-5 h-5 text-gray-600" />
            </button>
            <button
              onClick={() => {
                const title = window.prompt('Section instructions (shown as a text block to the client):', '')
                if (title === null) return
                addSection(title || `Note ${sections.length + 1}`)
              }}
              className="p-3 hover:bg-gray-50"
              title="Add text block"
            >
              <TypeIcon className="w-5 h-5 text-gray-600" />
            </button>
            <button disabled className="p-3 rounded-b-2xl opacity-30 cursor-not-allowed" title="Import from library (coming soon)">
              <Library className="w-5 h-5 text-gray-600" />
            </button>
          </div>
        )}
      </div>

      {/* Advanced options slide-out */}
      {advancedPanelOpen && (editingCardId === 'new' || editingCardId) && (
        <AdvancedOptionsPanel
          questionForm={questionForm}
          setQuestionForm={setQuestionForm}
          onClose={() => setAdvancedPanelOpen(false)}
        />
      )}

      {/* Create checklist wizard */}
      {createWizardOpen && (
        <CreateWizardModal
          wizardStep={wizardStep}
          setWizardStep={setWizardStep}
          wizardForm={wizardForm}
          setWizardForm={setWizardForm}
          visasByCategory={visasByCategory}
          roleOptionsForCategory={roleOptionsForCategory}
          visaCategoryByKey={visaCategoryByKey}
          onClose={() => setCreateWizardOpen(false)}
          onCreate={handleCreateChecklist}
          saving={saving}
        />
      )}
    </div>
  )
}

// ── Question card (display + inline edit) ───────────────────────────────
function QuestionCard({
  question, isEditing, isDragOver, questionForm, setQuestionForm, onOpen, onBlurContainer,
  onDuplicate, onRemove, onAddOption, onRemoveOption, onUpdateOption, onOpenAdvanced,
  onDragStart, onDragOver, onDrop, onDragLeave,
}) {
  if (isEditing) {
    return (
      <div
        tabIndex={-1}
        onBlur={onBlurContainer}
        className="card !p-0 overflow-hidden border-l-4 border-l-blue-400 ring-1 ring-blue-100"
      >
        <div className="p-5 space-y-3">
          <div className="flex items-center gap-3">
            <input
              autoFocus
              className="flex-1 text-base font-medium text-gray-900 border-b border-gray-300 focus:border-blue-500 outline-none pb-1 bg-transparent"
              placeholder="Question"
              value={questionForm.label}
              onChange={(e) => setQuestionForm((prev) => ({ ...prev, label: e.target.value, key: prev.key || slug(e.target.value) }))}
            />
            <select
              className="input-field !w-52 text-sm"
              value={questionForm.type}
              onChange={(e) => setQuestionForm((prev) => ({ ...prev, type: e.target.value }))}
            >
              {QUESTION_TYPE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </div>

          <QuestionTypeBody
            type={questionForm.type}
            questionForm={questionForm}
            setQuestionForm={setQuestionForm}
            onAddOption={onAddOption}
            onRemoveOption={onRemoveOption}
            onUpdateOption={onUpdateOption}
            editable
          />

          <div className="flex items-center justify-between pt-3 border-t border-gray-100">
            <label className="flex items-center gap-2 text-sm text-gray-600">
              <button
                type="button"
                onClick={() => setQuestionForm((prev) => ({ ...prev, required: !prev.required }))}
                className={`relative w-9 h-5 rounded-full transition-colors ${questionForm.required ? 'bg-blue-600' : 'bg-gray-300'}`}
              >
                <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${questionForm.required ? 'translate-x-4' : ''}`} />
              </button>
              Required
            </label>
            <div className="flex items-center gap-1">
              <button type="button" onClick={onDuplicate} title="Duplicate" className="p-2 rounded-lg hover:bg-gray-100 text-gray-500">
                <Copy className="w-4 h-4" />
              </button>
              <button type="button" onClick={onRemove} title="Delete" className="p-2 rounded-lg hover:bg-red-50 text-red-500">
                <Trash2 className="w-4 h-4" />
              </button>
              <button type="button" onClick={onOpenAdvanced} title="Advanced options" className="p-2 rounded-lg hover:bg-gray-100 text-gray-500">
                <MoreVertical className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragLeave={onDragLeave}
      onClick={onOpen}
      className={`card !py-4 !px-4 cursor-pointer hover:shadow-md transition-shadow ${isDragOver ? 'ring-2 ring-blue-400' : ''}`}
    >
      <div className="flex items-start gap-3">
        <GripVertical className="w-4 h-4 text-gray-300 mt-1 shrink-0 cursor-grab" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-3">
            <p className="font-medium text-gray-900 truncate">{question.label}{question.required && <span className="text-red-500 ml-1">*</span>}</p>
            <span className="text-xs text-gray-400 shrink-0">{QUESTION_TYPE_LABELS[question.metadata?.requestedType || question.type] || question.type}</span>
          </div>
          {CHOICE_TYPES.has(question.type) && (question.options || []).length > 0 && (
            <div className="mt-2 space-y-1">
              {question.options.slice(0, 4).map((option) => (
                <div key={option.value} className="text-sm text-gray-400 flex items-center gap-2">
                  <span className="w-3 h-3 rounded-full border border-gray-300 shrink-0" />
                  {option.label}
                </div>
              ))}
              {question.options.length > 4 && <p className="text-xs text-gray-300">+{question.options.length - 4} more</p>}
            </div>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
          <button onClick={onDuplicate} title="Duplicate" className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400">
            <Copy className="w-3.5 h-3.5" />
          </button>
          <button onClick={onRemove} title="Delete" className="p-1.5 rounded-lg hover:bg-red-50 text-red-400">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  )
}

function NewQuestionCard({ questionForm, setQuestionForm, onBlurContainer, onAddOption, onRemoveOption, onUpdateOption, onCancel }) {
  return (
    <div tabIndex={-1} onBlur={onBlurContainer} className="card !p-0 overflow-hidden border-l-4 border-l-blue-400 ring-1 ring-blue-100">
      <div className="p-5 space-y-3">
        <div className="flex items-center gap-3">
          <input
            autoFocus
            className="flex-1 text-base font-medium text-gray-900 border-b border-gray-300 focus:border-blue-500 outline-none pb-1 bg-transparent"
            placeholder="Question"
            value={questionForm.label}
            onChange={(e) => setQuestionForm((prev) => ({ ...prev, label: e.target.value, key: prev.key || slug(e.target.value) }))}
          />
          <select
            className="input-field !w-52 text-sm"
            value={questionForm.type}
            onChange={(e) => setQuestionForm((prev) => ({ ...prev, type: e.target.value }))}
          >
            {QUESTION_TYPE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </div>
        <QuestionTypeBody type={questionForm.type} questionForm={questionForm} setQuestionForm={setQuestionForm} onAddOption={onAddOption} onRemoveOption={onRemoveOption} onUpdateOption={onUpdateOption} editable />
        <div className="flex items-center justify-between pt-3 border-t border-gray-100">
          <label className="flex items-center gap-2 text-sm text-gray-600">
            <button
              type="button"
              onClick={() => setQuestionForm((prev) => ({ ...prev, required: !prev.required }))}
              className={`relative w-9 h-5 rounded-full transition-colors ${questionForm.required ? 'bg-blue-600' : 'bg-gray-300'}`}
            >
              <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${questionForm.required ? 'translate-x-4' : ''}`} />
            </button>
            Required
          </label>
          <button type="button" onClick={onCancel} className="text-sm text-gray-400 hover:text-gray-600">Cancel</button>
        </div>
      </div>
    </div>
  )
}

function QuestionTypeBody({ type, questionForm, setQuestionForm, onAddOption, onRemoveOption, onUpdateOption }) {
  if (CHOICE_TYPES.has(type)) {
    const lines = questionForm.optionsText ? questionForm.optionsText.split('\n') : []
    return (
      <div className="space-y-2 pl-1">
        {lines.map((line, index) => (
          <div key={index} className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full border border-gray-300 shrink-0" />
            <input
              className="flex-1 text-sm border-b border-transparent hover:border-gray-200 focus:border-blue-500 outline-none py-1 bg-transparent"
              value={line}
              onChange={(e) => onUpdateOption(index, e.target.value)}
            />
            <button onClick={() => onRemoveOption(index)} className="text-gray-300 hover:text-red-500"><X className="w-3.5 h-3.5" /></button>
          </div>
        ))}
        <button onClick={onAddOption} className="text-sm text-blue-600 font-medium hover:underline pl-5">+ Add option</button>
      </div>
    )
  }
  if (type === 'file' || type === 'file-multiple') {
    return <p className="text-xs text-gray-400 pl-1">Accepted formats: PDF, DOC, JPG (all by default) · {type === 'file-multiple' ? 'Multiple files allowed' : 'Single file'}</p>
  }
  return (
    <input
      className="w-full text-sm text-gray-400 border-b border-dashed border-gray-200 outline-none py-1 bg-transparent"
      placeholder="Placeholder text (optional)"
      value={questionForm.placeholder || ''}
      onChange={(e) => setQuestionForm((prev) => ({ ...prev, placeholder: e.target.value }))}
    />
  )
}

// ── Create checklist wizard (2-step modal) ───────────────────────────────
function CreateWizardModal({ wizardStep, setWizardStep, wizardForm, setWizardForm, visasByCategory, roleOptionsForCategory, visaCategoryByKey, onClose, onCreate, saving }) {
  const selectedCategory = visaCategoryByKey[wizardForm.visaType] || ''
  const roleOptions = roleOptionsForCategory(selectedCategory)

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-lg font-bold text-gray-900">Create checklist</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        </div>

        {wizardStep === 1 ? (
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1.5">Checklist name</label>
              <input
                autoFocus
                className="input-field"
                placeholder="e.g. H-1B Employer Information"
                value={wizardForm.title}
                onChange={(e) => setWizardForm((prev) => ({ ...prev, title: e.target.value }))}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1.5">Visa type</label>
              <select
                className="input-field"
                value={wizardForm.visaType}
                onChange={(e) => setWizardForm((prev) => ({ ...prev, visaType: e.target.value, checklistRole: '' }))}
              >
                <option value="">Select a visa type</option>
                {Object.entries(visasByCategory).map(([category, visas]) => (
                  <optgroup key={category} label={CATEGORY_LABELS[category] || category}>
                    {visas.map((visa) => <option key={visa.key} value={visa.key}>{visa.label}</option>)}
                  </optgroup>
                ))}
              </select>
            </div>
            <button
              onClick={() => setWizardStep(2)}
              disabled={!wizardForm.title.trim() || !wizardForm.visaType}
              className="btn-primary w-full disabled:opacity-50"
            >
              Next →
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm font-semibold text-gray-700">Who completes this checklist?</p>
            <div className="space-y-2">
              {roleOptions.map((option) => (
                <label key={option.value} className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${wizardForm.checklistRole === option.value ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:bg-gray-50'}`}>
                  <input
                    type="radio"
                    name="checklistRole"
                    checked={wizardForm.checklistRole === option.value}
                    onChange={() => setWizardForm((prev) => ({ ...prev, checklistRole: option.value }))}
                  />
                  <span className="text-sm font-medium text-gray-800">{option.label}</span>
                </label>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => setWizardStep(1)} className="btn-secondary flex-1">← Back</button>
              <button onClick={onCreate} disabled={!wizardForm.checklistRole || saving} className="btn-primary flex-1 disabled:opacity-50">
                {saving ? 'Creating...' : 'Create checklist'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Advanced options slide-out ───────────────────────────────────────────
function AdvancedOptionsPanel({ questionForm, setQuestionForm, onClose }) {
  return (
    <div className="fixed inset-y-0 right-0 w-96 bg-white shadow-2xl border-l border-gray-200 z-40 overflow-y-auto">
      <div className="p-5 border-b border-gray-100 flex items-center justify-between sticky top-0 bg-white">
        <h3 className="font-bold text-gray-900">Advanced options</h3>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
      </div>
      <div className="p-5 space-y-6">
        <div>
          <h4 className="text-sm font-bold text-gray-700 mb-2">Conditional logic</h4>
          <p className="text-xs text-gray-400 mb-3">Show this question only when:</p>
          <div className="space-y-2">
            <input
              className="input-field text-sm"
              placeholder="Field key"
              value={questionForm.showIf?.field || ''}
              onChange={(e) => setQuestionForm((prev) => ({ ...prev, showIf: { ...(prev.showIf || {}), field: e.target.value } }))}
            />
            <select
              className="input-field text-sm"
              value={questionForm.showIf?.operator || 'equals'}
              onChange={(e) => setQuestionForm((prev) => ({ ...prev, showIf: { ...(prev.showIf || {}), operator: e.target.value } }))}
            >
              {OPERATORS.map((operator) => <option key={operator} value={operator}>{operator}</option>)}
            </select>
            <input
              className="input-field text-sm"
              placeholder="Value"
              value={questionForm.showIf?.value || ''}
              onChange={(e) => setQuestionForm((prev) => ({ ...prev, showIf: { ...(prev.showIf || {}), value: e.target.value } }))}
            />
          </div>
        </div>

        <div>
          <h4 className="text-sm font-bold text-gray-700 mb-2">USCIS field mappings</h4>
          <p className="text-xs text-gray-400 mb-3">One per line</p>
          <textarea
            className="input-field text-sm min-h-[90px]"
            placeholder="I129.part2.fullName"
            value={questionForm.uscisMappingsText}
            onChange={(e) => setQuestionForm((prev) => ({ ...prev, uscisMappingsText: e.target.value }))}
          />
        </div>

        <div>
          <h4 className="text-sm font-bold text-gray-700 mb-2">Eligibility weight</h4>
          <input
            type="number"
            className="input-field text-sm"
            value={questionForm.eligibilityWeight}
            onChange={(e) => setQuestionForm((prev) => ({ ...prev, eligibilityWeight: e.target.value }))}
          />
        </div>

        <div>
          <h4 className="text-sm font-bold text-gray-700 mb-2">Evidence category</h4>
          <select
            className="input-field text-sm"
            value={questionForm.evidenceCategory}
            onChange={(e) => setQuestionForm((prev) => ({ ...prev, evidenceCategory: e.target.value }))}
          >
            <option value="">None</option>
            {EVIDENCE_CATEGORIES.map((category) => <option key={category} value={category}>{category}</option>)}
          </select>
        </div>

        <div>
          <h4 className="text-sm font-bold text-gray-700 mb-2">Question key</h4>
          <p className="text-xs text-gray-400 mb-2">Auto-generated. Override only if needed.</p>
          <input
            className="input-field text-sm"
            value={questionForm.key}
            onChange={(e) => setQuestionForm((prev) => ({ ...prev, key: e.target.value }))}
          />
        </div>
      </div>
    </div>
  )
}
