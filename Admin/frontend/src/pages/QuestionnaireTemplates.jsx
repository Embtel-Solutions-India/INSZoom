import { useEffect, useMemo, useState, useRef } from 'react'
import {
  Plus, Copy, Trash2, GripVertical, MoreVertical, Search, X, SeparatorHorizontal, Type as TypeIcon,
  Library, ChevronDown, ChevronRight, FileText, Lock, Pencil
} from 'lucide-react'
import { questionnairesApi, eligibilityQuizApi } from '../services/api'
import ChecklistUsageCard from '../components/ChecklistUsageCard'
import ConfirmModal from '../components/ConfirmModal'

const QUESTION_TYPE_OPTIONS = [
  { label: 'Short answer', value: 'text' },
  { label: 'Long answer', value: 'textarea' },
  { label: 'Number', value: 'number' },
  { label: 'Date', value: 'date' },
  { label: 'Email', value: 'email' },
  { label: 'Phone number', value: 'phone' },
  { label: 'Multiple choice', value: 'radio' },
  { label: 'Checkboxes', value: 'checkbox' },
  { label: 'Dropdown', value: 'select' },
  { label: 'Multi-select', value: 'multiselect' },
  { label: 'File upload', value: 'file' },
  { label: 'Multiple files', value: 'file-multiple' },
]
const QUESTION_TYPE_LABELS = Object.fromEntries(QUESTION_TYPE_OPTIONS.map((option) => [option.value, option.label]))
const CHOICE_TYPES = new Set(['radio', 'checkbox', 'select', 'multiselect', 'multi_select'])
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
  required: false,
  options: [],
  placeholder: '',
  showIf: { field: '', operator: 'equals', value: '' },
  uscisMappingsText: '',
  eligibilityWeight: 0,
  evidenceCategory: '',
}

function slug(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
}

const isActiveQuestion = (question) => question.active !== false && question.isActive !== false
// The type the designer picked: the stored type can be an alias ("multiselect" is stored as "multi_select", "file-multiple" as "file").
const typeOf = (question) => question.metadata?.requestedType || question.type
const pagesFrom = (sections) => (sections || []).map((section) => ({ key: section.key, title: section.title, order: section.order, sectionKeys: [section.key] }))
const readError = (error, fallback) => {
  const message = error?.response?.data?.message
  return typeof message === 'string' && message.trim() ? message : fallback
}

// ── question <-> editor form ────────────────────────────────────────────
// Options keep their stored value: renaming an option changes its label only (an answer a client already gave is stored by value). A new option's
// value follows its label until it is saved.
const optionRows = (options) => (options || []).map((option) => ({ label: String(option.label ?? option.value ?? ''), value: option.value ?? option.label, fixed: true }))

function questionToForm(question) {
  return {
    ...emptyQuestion,
    key: question.key || '',
    label: question.label || '',
    description: question.description || question.helpText || '',
    type: typeOf(question),
    sectionKey: question.sectionKey || '',
    required: Boolean(question.required),
    options: optionRows(question.options),
    placeholder: question.placeholder || '',
    showIf: question.showIf?.field ? { field: question.showIf.field, operator: question.showIf.operator || 'equals', value: question.showIf.value ?? '' } : { field: '', operator: 'equals', value: '' },
    uscisMappingsText: (question.uscisMappings || []).join('\n'),
    eligibilityWeight: question.eligibilityWeight || 0,
    evidenceCategory: question.evidenceCategory || '',
  }
}

const cleanOptionList = (rows) => (rows || [])
  .map((row) => ({ label: String(row.label ?? '').trim(), value: row.fixed ? row.value : String(row.label ?? '').trim() }))
  .filter((row) => row.label)

const linesOf = (text) => String(text || '').split('\n').map((line) => line.trim()).filter(Boolean)
const sameJson = (left, right) => JSON.stringify(left) === JSON.stringify(right)

// Only the fields the designer really changed. A save that sends the whole question back rewrote option values, dropped logic the simple editor cannot
// show and marked every field as hand-edited.
function buildQuestionPatch(form, original) {
  const before = questionToForm(original)
  const patch = {}
  const label = form.label.trim()
  if (label !== before.label) patch.label = label
  if ((form.description || '') !== before.description) { patch.description = form.description || ''; patch.helpText = form.description || '' }
  const typeChanged = form.type !== before.type
  if (typeChanged) patch.type = form.type
  if (Boolean(form.required) !== before.required) patch.required = Boolean(form.required)
  if (typeChanged || !sameJson(cleanOptionList(form.options), cleanOptionList(before.options))) {
    if (CHOICE_TYPES.has(form.type)) patch.options = cleanOptionList(form.options)
    else if ((original.options || []).length) patch.options = [] // a type with no choices: the old choices go
  }
  if ((form.placeholder || '') !== before.placeholder) patch.placeholder = form.placeholder || ''
  if (!sameJson(form.showIf, before.showIf)) {
    if (form.showIf?.field) patch.showIf = form.showIf
    else { patch.showIf = { field: '', operator: '', value: undefined }; patch.conditionalLogic = { mode: 'all', rules: [], groups: [] } }
  }
  if (!sameJson(linesOf(form.uscisMappingsText), linesOf(before.uscisMappingsText))) patch.uscisMappings = linesOf(form.uscisMappingsText)
  if (Number(form.eligibilityWeight || 0) !== Number(before.eligibilityWeight || 0)) patch.eligibilityWeight = Number(form.eligibilityWeight) || 0
  if ((form.evidenceCategory || '') !== before.evidenceCategory) patch.evidenceCategory = form.evidenceCategory || ''
  return patch
}

function buildNewQuestionPayload(form) {
  const payload = {
    label: form.label.trim(),
    description: form.description || '',
    helpText: form.description || '',
    type: form.type,
    sectionKey: form.sectionKey,
    pageKey: form.sectionKey,
    required: Boolean(form.required),
    placeholder: form.placeholder || '',
    eligibilityWeight: Number(form.eligibilityWeight) || 0,
    isActive: true,
  }
  // a key typed in "Advanced" is used; otherwise the server makes one from the text and numbers it if it is taken
  if (form.key.trim()) payload.key = slug(form.key)
  if (CHOICE_TYPES.has(form.type)) payload.options = cleanOptionList(form.options)
  if (form.showIf?.field) payload.showIf = form.showIf
  if (linesOf(form.uscisMappingsText).length) payload.uscisMappings = linesOf(form.uscisMappingsText)
  if (form.evidenceCategory) payload.evidenceCategory = form.evidenceCategory
  return payload
}

export default function QuestionnaireTemplates() {
  const [templates, setTemplates] = useState([])
  const [selectedId, setSelectedId] = useState('')
  const [selected, setSelected] = useState(null)
  const [questions, setQuestions] = useState([])
  const [templateForm, setTemplateForm] = useState(emptyTemplate)
  const [sectionTitle, setSectionTitle] = useState('')
  const [fieldMappings, setFieldMappings] = useState([])
  const [showFieldMappings, setShowFieldMappings] = useState(false)
  const [visaOptions, setVisaOptions] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')

  const [visaPathways, setVisaPathways] = useState([])
  const [createWizardOpen, setCreateWizardOpen] = useState(false)
  const [wizardStep, setWizardStep] = useState(1)
  const [wizardForm, setWizardForm] = useState({ title: '', visaType: '', checklistRole: '' })
  const [editingCardId, setEditingCardId] = useState('') // '' | 'new' | question._id
  const [questionForm, setQuestionForm] = useState(emptyQuestion)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [savingQuestion, setSavingQuestion] = useState(false)
  const [editorError, setEditorError] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [publishing, setPublishing] = useState(false)
  const [creatingVersion, setCreatingVersion] = useState(false)
  const [dragOverId, setDragOverId] = useState('')
  const [removeTarget, setRemoveTarget] = useState(null) // question waiting for the delete confirmation
  const [archiveOpen, setArchiveOpen] = useState(false)

  // The editor commits from event handlers that must see the latest form, so it is also kept in a ref; the question being edited is kept as it was loaded.
  const questionFormRef = useRef(emptyQuestion)
  questionFormRef.current = questionForm
  const originalRef = useRef(null)
  const savingQuestionRef = useRef(false)
  const loadSeq = useRef(0)

  const selectedTemplate = selected?.questionnaire || selected
  const isPublished = selectedTemplate?.status === 'published'

  const sections = useMemo(() => (
    [...(templateForm.sections || [])].sort((a, b) => (a.order || 0) - (b.order || 0))
  ), [templateForm.sections])

  const visibleQuestions = useMemo(() => questions.filter(isActiveQuestion), [questions])

  const visaCategoryByKey = useMemo(() => {
    // Keyed by the dashless-uppercase form ("L-1A" -> "L1A"), because a
    // checklist's visaType is stored that way ("L1A", "O1") and never matched
    // the pathway's own dashed key - which filed L-1/O-1 under "Other".
    const norm = (value) => String(value || '').replace(/[^a-z0-9]+/gi, '').toUpperCase()
    const map = {}
    visaPathways.forEach((visa) => { map[norm(visa.key)] = visa.category })
    // A bare family code ("O1") takes the category of its first sub-type ("O1A").
    return new Proxy(map, {
      get: (target, key) => {
        if (typeof key !== 'string') return target[key]
        const code = norm(key)
        if (target[code]) return target[code]
        const sub = Object.keys(target).find((k) => k.startsWith(code))
        return sub ? target[sub] : undefined
      },
    })
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
      [t.visaType, ...(t.visaTypes || [])].filter(Boolean).some((v) => v.toLowerCase().replace(/[^a-z0-9]+/g, '').includes(query.replace(/[^a-z0-9]+/g, '')))
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

  // ── Data loading ────────────────────────────────────────────────────────
  const loadTemplates = async () => {
    setLoading(true)
    try {
      // latestVersion + the API's max page size: every checklist (one row per
      // checklist, not per historical version) must fit on the page.
      const response = await questionnairesApi.list({ isTemplate: true, latestVersion: true, limit: 200 })
      const rows = response.data.data || []
      setTemplates(rows)
      if (!selectedId && rows[0]?._id) setSelectedId(rows[0]._id)
    } catch (error) {
      setMessage(readError(error, 'Could not load the checklists.'))
    } finally {
      setLoading(false)
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

  const loadVisaOptions = async () => {
    try {
      const response = await questionnairesApi.visaOptions()
      setVisaOptions(response.data.data || [])
    } catch (error) {
      console.error('Error loading visa options', error)
    }
  }

  const loadSelected = async (id) => {
    if (!id) return
    const seq = ++loadSeq.current
    try {
      const response = await questionnairesApi.get(id)
      if (seq !== loadSeq.current) return // a newer selection won
      const data = response.data.data
      setSelected(data)
      setQuestions(data.questions || [])
      setFieldMappings([])
      setShowFieldMappings(false)
      setTemplateForm({
        ...emptyTemplate,
        ...data.questionnaire,
        visaType: data.questionnaire.visaType || data.questionnaire.visaTypes?.[0] || '',
        sections: data.questionnaire.sections || [],
      })
    } catch (error) {
      if (seq === loadSeq.current) setMessage(readError(error, 'Could not open this checklist.'))
    }
  }

  useEffect(() => {
    loadTemplates()
    loadVisaPathways()
    loadVisaOptions()
  }, [])

  useEffect(() => {
    closeEditor()
    loadSelected(selectedId)
  }, [selectedId])

  // Leaving the page with a question half-edited is the one thing that loses work now.
  useEffect(() => {
    const warn = (event) => {
      if (!editingCardId) return undefined
      event.preventDefault()
      event.returnValue = ''
      return ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [editingCardId])

  // ── Question editor ─────────────────────────────────────────────────────
  const closeEditor = () => {
    setEditingCardId('')
    setAdvancedOpen(false)
    setEditorError('')
    originalRef.current = null
  }

  const replaceQuestion = (saved) => setQuestions((current) => current.map((item) => (String(item._id) === String(saved._id) ? { ...item, ...saved } : item)))

  // Saves what the designer changed and closes the editor. false = it stayed open (nothing typed is lost): the message says why.
  const commitEditor = async () => {
    if (!editingCardId) return true
    if (savingQuestionRef.current) return false
    const form = questionFormRef.current
    if (editingCardId === 'new') {
      if (!form.label.trim()) { closeEditor(); return true } // nothing typed: nothing to save
      return saveNewQuestion(form)
    }
    const original = originalRef.current
    if (!original) { closeEditor(); return true }
    if (!form.label.trim()) { setEditorError('A question needs text.'); return false }
    const patch = buildQuestionPatch(form, original)
    if (!Object.keys(patch).length) { closeEditor(); return true }
    savingQuestionRef.current = true
    setSavingQuestion(true)
    setEditorError('')
    try {
      const response = await questionnairesApi.updateQuestion(selectedTemplate._id, original._id, patch)
      replaceQuestion(response.data.data)
      closeEditor()
      return true
    } catch (error) {
      setEditorError(readError(error, 'Could not save this question.'))
      return false
    } finally {
      savingQuestionRef.current = false
      setSavingQuestion(false)
    }
  }

  const saveNewQuestion = async (form) => {
    savingQuestionRef.current = true
    setSavingQuestion(true)
    setEditorError('')
    try {
      const response = await questionnairesApi.createQuestion(selectedTemplate._id, buildNewQuestionPayload(form))
      const created = response.data.data
      setQuestions((current) => [...current, created])
      closeEditor()
      return true
    } catch (error) {
      setEditorError(readError(error, 'Could not add this question.'))
      return false
    } finally {
      savingQuestionRef.current = false
      setSavingQuestion(false)
    }
  }

  const beginEditQuestion = async (question) => {
    if (editingCardId === question._id) return
    if (!(await commitEditor())) return
    originalRef.current = question
    setQuestionForm(questionToForm(question))
    setEditorError('')
    setAdvancedOpen(false)
    setEditingCardId(question._id)
  }

  const beginNewQuestion = async (sectionKey) => {
    if (!(await commitEditor())) return
    originalRef.current = null
    setQuestionForm({ ...emptyQuestion, sectionKey: sectionKey || sections[0]?.key || '' })
    setEditorError('')
    setAdvancedOpen(false)
    setEditingCardId('new')
  }

  // The order of a section's questions as shown is what is stored: positions are written per section.
  const persistOrder = async (list) => {
    const counters = {}
    const rows = list.map((item) => {
      counters[item.sectionKey] = (counters[item.sectionKey] || 0) + 1
      return { key: item.key, order: counters[item.sectionKey], sectionKey: item.sectionKey, pageKey: item.pageKey || item.sectionKey }
    })
    try {
      await questionnairesApi.reorder(selectedTemplate._id, { questionOrder: list.map((item) => item.key), questions: rows })
    } catch (error) {
      setMessage(readError(error, 'Could not save the new order.'))
      await loadSelected(selectedTemplate._id)
    }
  }

  const duplicateQuestion = async (question) => {
    if (!(await commitEditor())) return
    setSavingQuestion(true)
    try {
      const payload = {
        label: `${question.label} (copy)`,
        description: question.description || question.helpText || '',
        helpText: question.description || question.helpText || '',
        type: typeOf(question),
        sectionKey: question.sectionKey,
        pageKey: question.pageKey || question.sectionKey,
        required: Boolean(question.required),
        placeholder: question.placeholder || '',
        options: (question.options || []).map((option) => ({ label: option.label, value: option.value })),
        isActive: true,
        ...(question.evidenceCategory ? { evidenceCategory: question.evidenceCategory } : {}),
      }
      const response = await questionnairesApi.createQuestion(selectedTemplate._id, payload)
      const created = response.data.data
      const next = []
      let placed = false
      questions.forEach((item) => {
        next.push(item)
        if (String(item._id) === String(question._id)) { next.push(created); placed = true }
      })
      if (!placed) next.push(created)
      setQuestions(next)
      await persistOrder(next)
      setMessage('Question duplicated.')
    } catch (error) {
      setMessage(readError(error, 'Could not duplicate this question.'))
    } finally {
      setSavingQuestion(false)
    }
  }

  const confirmRemoveQuestion = async () => {
    const question = removeTarget
    if (!question) return
    setSaving(true)
    try {
      await questionnairesApi.deleteQuestion(selectedTemplate._id, question._id)
      setQuestions((current) => current.map((item) => (String(item._id) === String(question._id) ? { ...item, active: false, isActive: false } : item)))
      if (editingCardId === question._id) closeEditor()
      setRemoveTarget(null)
    } catch (error) {
      setRemoveTarget(null)
      setMessage(readError(error, 'Could not delete this question.'))
    } finally {
      setSaving(false)
    }
  }

  // ── Checklist header / sections ─────────────────────────────────────────
  const saveHeaderIfChanged = async () => {
    if (!selectedTemplate?._id || isPublished) return
    const changed = (templateForm.title || '') !== (selectedTemplate.title || '') || (templateForm.description || '') !== (selectedTemplate.description || '')
    if (!changed || !templateForm.title.trim()) return
    try {
      const response = await questionnairesApi.update(selectedTemplate._id, { title: templateForm.title.trim(), description: templateForm.description || '' })
      setSelected((prev) => (prev ? { ...prev, questionnaire: { ...(prev.questionnaire || {}), title: response.data.data.title, description: response.data.data.description } } : prev))
      setTemplates((current) => current.map((item) => (item._id === selectedTemplate._id ? { ...item, title: response.data.data.title } : item)))
    } catch (error) {
      setMessage(readError(error, 'Could not save the title.'))
    }
  }

  const addSection = async (titleOverride) => {
    const title = (titleOverride ?? sectionTitle).trim()
    if (!title || !selectedTemplate?._id) return null
    const taken = new Set((templateForm.sections || []).map((section) => section.key))
    let key = slug(title) || `section_${Date.now()}`
    if (taken.has(key)) { let n = 2; while (taken.has(`${key}_${n}`)) n += 1; key = `${key}_${n}` }
    const next = { key, title, description: '', order: (templateForm.sections || []).length + 1, isActive: true }
    const nextSections = [...(templateForm.sections || []), next]
    try {
      // saved right away: a question added to a section that exists only on the page would be saved against a section the checklist does not have
      await questionnairesApi.update(selectedTemplate._id, { sections: nextSections, pages: pagesFrom(nextSections) })
      setTemplateForm((prev) => ({ ...prev, sections: nextSections }))
      setSectionTitle('')
      return next
    } catch (error) {
      setMessage(readError(error, 'Could not add the section.'))
      return null
    }
  }

  const duplicateTemplate = async () => {
    if (!selectedTemplate?._id) return
    try {
      const response = await questionnairesApi.duplicate(selectedTemplate._id, { title: `${selectedTemplate.title} Copy`, key: `${selectedTemplate.key}_copy_${Date.now()}` })
      setSelectedId(response.data.data._id)
      await loadTemplates()
    } catch (error) {
      setMessage(readError(error, 'Could not duplicate the checklist.'))
    }
  }

  const archiveTemplate = async () => {
    if (!selectedTemplate?._id) return
    try {
      await questionnairesApi.archive(selectedTemplate._id)
      setArchiveOpen(false)
      setSelectedId('')
      setSelected(null)
      await loadTemplates()
    } catch (error) {
      setArchiveOpen(false)
      setMessage(readError(error, 'Could not delete the checklist.'))
    }
  }

  // ── Create wizard ───────────────────────────────────────────────────────
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
      setMessage('Checklist created. Add a section, then your questions.')
    } catch (error) {
      setMessage(readError(error, 'Could not create the checklist.'))
    } finally {
      setSaving(false)
    }
  }

  // ── Publish / versioning ────────────────────────────────────────────────
  // A draft is saved as you work. Publish makes this version the one new cases get (and locks it); cases that already have the checklist keep the
  // version they were given. Editing a published checklist opens a new draft version.
  const handlePublish = async () => {
    if (!selectedTemplate?._id) return
    if (!(await commitEditor())) return
    setPublishing(true)
    setMessage('')
    try {
      // only what the page edits - never the visa mapping, version, history or approval, which the server owns
      await questionnairesApi.update(selectedTemplate._id, {
        title: templateForm.title.trim(),
        description: templateForm.description || '',
        sections: templateForm.sections || [],
        pages: pagesFrom(templateForm.sections),
      })
      await questionnairesApi.publish(selectedTemplate._id)
      setMessage('Published. New cases of the mapped visa types will use this version.')
      await loadTemplates()
      await loadSelected(selectedTemplate._id)
    } catch (error) {
      setMessage(readError(error, 'Could not publish this checklist.'))
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
      setSelectedId(response.data.data._id)
      await loadTemplates()
      setMessage(`Editing v${(selectedTemplate.version || 1) + 1} (draft). Cases that already have this checklist keep v${selectedTemplate.version || 1}.`)
    } catch (error) {
      setMessage(readError(error, 'Could not open a new version.'))
    } finally {
      setCreatingVersion(false)
    }
  }

  const selectTemplate = async (id) => {
    if (id === selectedId) return
    if (!(await commitEditor())) return
    await saveHeaderIfChanged()
    setSelectedId(id)
  }

  // ── Drag-and-drop reorder (HTML5 DnD, no extra library) ─────────────────
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
    const target = current[targetIndex]
    const [moved] = current.splice(sourceIndex, 1)
    // dropped on a question of another section: it joins that section
    const next = { ...moved, sectionKey: target.sectionKey, pageKey: target.pageKey || target.sectionKey }
    current.splice(targetIndex, 0, next)
    setQuestions(current)
    await persistOrder(current)
  }

  // Questions grouped by section, in section order, for card rendering (deleted ones are not shown).
  const questionsBySection = useMemo(() => {
    const groups = {}
    visibleQuestions.forEach((question) => {
      const key = question.sectionKey || ''
      if (!groups[key]) groups[key] = []
      groups[key].push(question)
    })
    return groups
  }, [visibleQuestions])

  const sectionsToRender = sections.length ? sections : (questionsBySection[''] ? [{ key: '', title: '', order: 0 }] : [])

  const toggleFieldMappings = async () => {
    const next = !showFieldMappings
    setShowFieldMappings(next)
    if (next && selectedTemplate?._id && !fieldMappings.length) {
      try {
        const response = await questionnairesApi.mappings(selectedTemplate._id)
        setFieldMappings(response.data.data || [])
      } catch (error) {
        setFieldMappings([])
      }
    }
  }

  const editorProps = {
    form: questionForm,
    setForm: setQuestionForm,
    saving: savingQuestion,
    error: editorError,
    advancedOpen,
    setAdvancedOpen,
    onDone: commitEditor,
    onCancel: closeEditor,
  }

  return (
    <div className="flex flex-col md:flex-row h-[calc(100vh-5rem)] -m-3 sm:-m-4 lg:-m-6 overflow-hidden">
      {/* ── Left sidebar ─────────────────────────────────────────────── */}
      <div className="w-full md:w-72 max-h-48 md:max-h-none shrink-0 border-b md:border-b-0 md:border-r border-border bg-card flex flex-col">
        <div className="p-4 border-b border-border flex items-center justify-between">
          <h2 className="font-bold text-foreground">Checklists</h2>
          <button onClick={openCreateWizard} className="p-2 rounded-lg bg-primary text-primary-foreground hover:opacity-90" title="Create checklist">
            <Plus className="w-4 h-4" />
          </button>
        </div>
        <div className="p-3 border-b border-border">
          <div className="relative">
            <Search className="w-4 h-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
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
            <div className="p-4 text-sm text-muted-foreground">Loading checklists...</div>
          ) : Object.keys(groupedTemplates).length === 0 ? (
            <div className="p-4 text-sm text-muted-foreground">No checklists yet.</div>
          ) : Object.entries(groupedTemplates).map(([category, items]) => (
            <div key={category}>
              <div className="px-4 pt-3 pb-1 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                {CATEGORY_LABELS[category] || category}
              </div>
              {items.map((template) => (
                <button
                  key={template._id}
                  onClick={() => selectTemplate(template._id)}
                  className={`w-full text-left px-4 py-3 border-l-4 hover:bg-muted transition-colors ${selectedId === template._id ? 'bg-primary-50 border-l-primary' : 'border-l-transparent'}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-foreground truncate text-sm">{template.title}</span>
                    <span className="text-[10px] bg-secondary text-muted-foreground rounded-full px-1.5 py-0.5 shrink-0">v{template.version}</span>
                  </div>
                  <div className="flex items-center gap-1.5 mt-1">
                    <span className="text-xs text-muted-foreground truncate" title={(template.visaTypes || []).join(', ')}>{template.visaType || template.visaTypes?.[0]}</span>
                    {template.checklistRole && (
                      <span className="text-[10px] bg-primary-50 text-primary rounded-full px-1.5 py-0.5">
                        {TARGET_ROLE_LABELS[template.checklistRole] || template.checklistRole}
                      </span>
                    )}
                    {selectedId === template._id && (
                      <span className={`text-[10px] rounded-full px-1.5 py-0.5 ${template.status === 'published' ? 'bg-emerald-100 text-emerald-700' : 'bg-muted text-muted-foreground'}`}>
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
      <div className="flex-1 min-h-0 overflow-y-auto relative">
        {message && (
          <div className="sticky top-0 z-20 p-3 border-b border-primary/30 bg-primary/5 text-sm font-medium text-primary flex items-center justify-between">
            {message}
            <button onClick={() => setMessage('')}><X className="w-4 h-4" /></button>
          </div>
        )}

        {!selectedTemplate ? (
          <div className="h-full flex flex-col items-center justify-center text-muted-foreground gap-3">
            <FileText className="w-12 h-12" />
            <p>Select a checklist, or create a new one to get started.</p>
          </div>
        ) : (
          <div className="max-w-3xl mx-auto py-8 px-6 space-y-4">
            {/* Header card */}
            <div className="card overflow-hidden !p-0">
              <div className="h-2 bg-primary" />
              <div className="p-6">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <input
                      className="text-2xl font-bold text-foreground w-full border-b border-transparent hover:border-border focus:border-primary outline-none pb-1 bg-transparent"
                      value={templateForm.title}
                      disabled={isPublished}
                      placeholder="Checklist title"
                      onChange={(e) => setTemplateForm((prev) => ({ ...prev, title: e.target.value }))}
                      onBlur={saveHeaderIfChanged}
                    />
                    <input
                      className="text-sm text-muted-foreground w-full border-b border-transparent hover:border-border focus:border-primary outline-none mt-2 pb-1 bg-transparent"
                      value={templateForm.description || ''}
                      disabled={isPublished}
                      placeholder="Checklist description (optional)"
                      onChange={(e) => setTemplateForm((prev) => ({ ...prev, description: e.target.value }))}
                      onBlur={saveHeaderIfChanged}
                    />
                    <div className="flex items-center gap-2 mt-3 flex-wrap">
                      <span className="text-xs bg-secondary text-muted-foreground rounded-full px-2.5 py-1 font-medium">{templateForm.visaType}</span>
                      {templateForm.checklistRole && (
                        <span className="text-xs bg-primary-50 text-primary rounded-full px-2.5 py-1 font-medium">{TARGET_ROLE_LABELS[templateForm.checklistRole]}</span>
                      )}
                      <span className="text-xs bg-secondary text-muted-foreground rounded-full px-2.5 py-1 font-medium">v{selectedTemplate.version}</span>
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
                      <button onClick={handlePublish} disabled={publishing || saving || !templateForm.title.trim()} className="btn-primary flex items-center gap-2 disabled:opacity-50" title="Make this version the one new cases get">
                        {publishing ? 'Publishing...' : 'Publish'}
                      </button>
                    )}
                    <div className="relative group">
                      <button className="p-2 rounded-lg border border-border hover:bg-muted">
                        <MoreVertical className="w-4 h-4 text-muted-foreground" />
                      </button>
                      <div className="absolute right-0 mt-1 w-44 bg-card border border-border rounded-lg shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-30 py-1">
                        <button onClick={duplicateTemplate} className="w-full text-left px-3 py-2 text-sm hover:bg-muted flex items-center gap-2">
                          <Copy className="w-3.5 h-3.5" /> Duplicate
                        </button>
                        <button onClick={() => setArchiveOpen(true)} className="w-full text-left px-3 py-2 text-sm text-red-600 hover:bg-red-50 flex items-center gap-2">
                          <Trash2 className="w-3.5 h-3.5" /> Delete
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
                {isPublished ? (
                  <div className="mt-4 flex items-center gap-2 text-xs text-muted-foreground bg-muted border border-border rounded-lg px-3 py-2">
                    <Lock className="w-3.5 h-3.5 shrink-0" />
                    This version is published and locked. Click "Edit" to open a new draft version; cases that already have this checklist keep this one.
                  </div>
                ) : (
                  <p className="mt-4 text-xs text-muted-foreground">Draft: your changes are saved as you make them. "Publish" makes this version the one new cases get.</p>
                )}
              </div>
            </div>

            {/* Where this checklist is used: visa types, forms, cases */}
            <ChecklistUsageCard
              questionnaire={selectedTemplate}
              visaOptions={visaOptions}
              isPublished={isPublished}
              onChanged={loadTemplates}
            />

            {/* Question sections (draft) */}
            {!isPublished && sectionsToRender.map((section) => (
              <div key={section.key || 'default'} className="space-y-3">
                {section.title && (
                  <div className="flex items-center gap-3 pt-2">
                    <h3 className="text-sm font-bold text-muted-foreground uppercase tracking-wide">{section.title}</h3>
                    <div className="flex-1 h-px bg-muted" />
                    <button onClick={() => beginNewQuestion(section.key)} className="text-xs text-primary font-semibold hover:underline shrink-0">
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
                    editorProps={editorProps}
                    onOpen={() => beginEditQuestion(question)}
                    onDuplicate={() => duplicateQuestion(question)}
                    onRemove={() => setRemoveTarget(question)}
                    onDragStart={(e) => handleDragStart(e, question._id)}
                    onDragOver={(e) => handleDragOver(e, question._id)}
                    onDrop={(e) => handleDrop(e, question._id)}
                    onDragLeave={() => setDragOverId('')}
                  />
                ))}
                {editingCardId === 'new' && questionForm.sectionKey === section.key && (
                  <QuestionEditor {...editorProps} isNew />
                )}
              </div>
            ))}

            {!isPublished && sections.length === 0 && (
              <div className="card text-center py-10 text-muted-foreground text-sm space-y-3">
                <p>No sections yet. Add one to start building this checklist.</p>
                <div className="flex items-center justify-center gap-2 max-w-sm mx-auto">
                  <input className="input-field" placeholder="Section title (e.g. Personal Information)" value={sectionTitle} onChange={(e) => setSectionTitle(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') addSection() }} />
                  <button onClick={() => addSection()} className="btn-primary shrink-0">Add</button>
                </div>
              </div>
            )}

            {!isPublished && sections.length > 0 && (
              <div className="flex items-center gap-2 max-w-sm">
                <input className="input-field text-sm" placeholder="New section title" value={sectionTitle} onChange={(e) => setSectionTitle(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') addSection() }} />
                <button onClick={() => addSection()} className="btn-secondary shrink-0 text-sm">
                  <SeparatorHorizontal className="w-3.5 h-3.5 inline mr-1" /> Add section
                </button>
              </div>
            )}

            {isPublished && visibleQuestions.length > 0 && (
              <div className="space-y-3">
                {visibleQuestions.map((question) => (
                  <div key={question._id} className="card !py-3 !px-4 flex items-center justify-between opacity-80">
                    <div>
                      <p className="font-medium text-foreground text-sm">{question.label}</p>
                      <p className="text-xs text-muted-foreground">{QUESTION_TYPE_LABELS[typeOf(question)] || typeOf(question)}</p>
                    </div>
                    <Lock className="w-3.5 h-3.5 text-muted-foreground" />
                  </div>
                ))}
              </div>
            )}

            {/* Question -> USCIS field links (read-only reference) */}
            <div className="pt-4">
              <button onClick={toggleFieldMappings} className="text-xs font-semibold text-muted-foreground hover:text-foreground flex items-center gap-1">
                {showFieldMappings ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                Question → USCIS field links
              </button>
              {showFieldMappings && (
                <div className="card mt-3">
                  {fieldMappings.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No question of this checklist is linked to a USCIS field directly. Forms read these answers through their own field mapping (see Forms above).</p>
                  ) : (
                    <div className="space-y-2 max-h-80 overflow-y-auto">
                      {fieldMappings.map((mapping) => (
                        <div key={mapping.questionKey} className="p-3 rounded-lg border border-border bg-muted">
                          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                            <FileText className="w-4 h-4 text-primary" />
                            {mapping.questionKey}
                          </div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            {mapping.uscisMappings.map((item) => <div key={item}>{item}</div>)}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Floating right toolbar (Google Forms-style) */}
        {selectedTemplate && !isPublished && (
          <div className="fixed right-2 sm:right-8 top-1/2 -translate-y-1/2 bg-card border border-border rounded-2xl shadow-lg flex flex-col divide-y divide-border z-20">
            <button onClick={() => beginNewQuestion(sections[sections.length - 1]?.key)} disabled={!sections.length} className="p-3 hover:bg-muted rounded-t-2xl disabled:opacity-30" title="Add question">
              <Plus className="w-5 h-5 text-muted-foreground" />
            </button>
            <button onClick={() => addSection(sectionTitle || `Section ${sections.length + 1}`)} className="p-3 hover:bg-muted" title="Add section divider">
              <SeparatorHorizontal className="w-5 h-5 text-muted-foreground" />
            </button>
            <button
              onClick={() => {
                const title = window.prompt('Section instructions (shown as a text block to the client):', '')
                if (title === null) return
                addSection(title || `Note ${sections.length + 1}`)
              }}
              className="p-3 hover:bg-muted"
              title="Add text block"
            >
              <TypeIcon className="w-5 h-5 text-muted-foreground" />
            </button>
            <button disabled className="p-3 rounded-b-2xl opacity-30 cursor-not-allowed" title="Import from library (coming soon)">
              <Library className="w-5 h-5 text-muted-foreground" />
            </button>
          </div>
        )}
      </div>

      {removeTarget && (
        <ConfirmModal
          tone="danger"
          title="Delete this question?"
          message={`"${removeTarget.label}" is removed from this checklist. Answers clients already gave stay on record, and cases that already have this checklist keep it.`}
          confirmLabel="Delete question"
          busy={saving}
          onConfirm={confirmRemoveQuestion}
          onCancel={() => setRemoveTarget(null)}
        />
      )}
      {archiveOpen && (
        <ConfirmModal
          tone="danger"
          title={`Delete "${selectedTemplate?.title}"?`}
          message="The checklist is taken out of use: it is no longer sent to new cases. Cases that already have it keep it."
          confirmLabel="Delete checklist"
          onConfirm={archiveTemplate}
          onCancel={() => setArchiveOpen(false)}
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

// ── Question card: the card, or its editor while it is open ──────────────
function QuestionCard({ question, isEditing, isDragOver, editorProps, onOpen, onDuplicate, onRemove, onDragStart, onDragOver, onDrop, onDragLeave }) {
  if (isEditing) {
    return <QuestionEditor {...editorProps} onDuplicate={onDuplicate} onRemove={onRemove} />
  }
  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragLeave={onDragLeave}
      onClick={onOpen}
      className={`card !py-4 !px-4 cursor-pointer hover:shadow-md transition-shadow ${isDragOver ? 'ring-2 ring-primary-300' : ''}`}
    >
      <div className="flex items-start gap-3">
        <GripVertical className="w-4 h-4 text-muted-foreground mt-1 shrink-0 cursor-grab" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-3">
            <p className="font-medium text-foreground truncate">{question.label}{question.required && <span className="text-red-500 ml-1">*</span>}</p>
            <span className="text-xs text-muted-foreground shrink-0">{QUESTION_TYPE_LABELS[typeOf(question)] || typeOf(question)}</span>
          </div>
          {CHOICE_TYPES.has(typeOf(question)) && (question.options || []).length > 0 && (
            <div className="mt-2 space-y-1">
              {question.options.slice(0, 4).map((option, index) => (
                <div key={`${option.value}-${index}`} className="text-sm text-muted-foreground flex items-center gap-2">
                  <span className="w-3 h-3 rounded-full border border-border shrink-0" />
                  {option.label}
                </div>
              ))}
              {question.options.length > 4 && <p className="text-xs text-muted-foreground">+{question.options.length - 4} more</p>}
            </div>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
          <button onClick={onDuplicate} title="Duplicate" className="p-1.5 rounded-lg hover:bg-secondary text-muted-foreground">
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

// One editor for an existing and a new question. Nothing is saved behind the designer's back: "Done" saves and closes, "Cancel" (or Escape) discards,
// and opening another question saves this one first.
function QuestionEditor({ form, setForm, isNew, saving, error, advancedOpen, setAdvancedOpen, onDone, onCancel, onDuplicate, onRemove }) {
  const typeOptions = QUESTION_TYPE_OPTIONS.some((option) => option.value === form.type)
    ? QUESTION_TYPE_OPTIONS
    : [...QUESTION_TYPE_OPTIONS, { label: `Other (${form.type})`, value: form.type }]
  const setOption = (index, label) => setForm((prev) => ({ ...prev, options: prev.options.map((row, i) => (i === index ? { ...row, label } : row)) }))
  const removeOption = (index) => setForm((prev) => ({ ...prev, options: prev.options.filter((_, i) => i !== index) }))
  const addOption = () => setForm((prev) => ({ ...prev, options: [...prev.options, { label: `Option ${prev.options.length + 1}`, value: '', fixed: false }] }))

  return (
    <div
      className="card !p-0 overflow-hidden border-l-4 border-l-primary ring-1 ring-primary-100"
      onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); onCancel() } }}
    >
      <div className="p-5 space-y-3">
        <div className="flex items-center gap-3">
          <input
            autoFocus
            className="flex-1 text-base font-medium text-foreground border-b border-border focus:border-primary outline-none pb-1 bg-transparent"
            placeholder="Question"
            value={form.label}
            onChange={(e) => setForm((prev) => ({ ...prev, label: e.target.value }))}
          />
          <select
            className="input-field !w-52 text-sm"
            value={form.type}
            onChange={(e) => setForm((prev) => ({ ...prev, type: e.target.value }))}
          >
            {typeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </div>

        <input
          className="w-full text-sm text-muted-foreground border-b border-transparent hover:border-border focus:border-primary outline-none py-1 bg-transparent"
          placeholder="Help text (optional)"
          value={form.description}
          onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
        />

        {CHOICE_TYPES.has(form.type) ? (
          <div className="space-y-2 pl-1">
            {form.options.map((row, index) => (
              <div key={index} className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full border border-border shrink-0" />
                <input
                  className="flex-1 text-sm border-b border-transparent hover:border-border focus:border-primary outline-none py-1 bg-transparent"
                  value={row.label}
                  onChange={(e) => setOption(index, e.target.value)}
                />
                <button type="button" onClick={() => removeOption(index)} className="text-muted-foreground hover:text-red-500" title="Remove option"><X className="w-3.5 h-3.5" /></button>
              </div>
            ))}
            <button type="button" onClick={addOption} className="text-sm text-primary font-medium hover:underline pl-5">+ Add option</button>
          </div>
        ) : form.type === 'file' || form.type === 'file-multiple' ? (
          <p className="text-xs text-muted-foreground pl-1">Accepted formats: PDF, DOC, JPG (all by default) · {form.type === 'file-multiple' ? 'Multiple files allowed' : 'Single file'}</p>
        ) : (
          <input
            className="w-full text-sm text-muted-foreground border-b border-dashed border-border outline-none py-1 bg-transparent"
            placeholder="Placeholder text (optional)"
            value={form.placeholder || ''}
            onChange={(e) => setForm((prev) => ({ ...prev, placeholder: e.target.value }))}
          />
        )}

        {advancedOpen && <AdvancedOptions form={form} setForm={setForm} isNew={isNew} />}

        {error && <p className="text-sm text-red-700">{error}</p>}

        <div className="flex items-center justify-between pt-3 border-t border-border">
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <button
              type="button"
              onClick={() => setForm((prev) => ({ ...prev, required: !prev.required }))}
              className={`relative w-9 h-5 rounded-full transition-colors ${form.required ? 'bg-primary' : 'bg-muted'}`}
              aria-pressed={Boolean(form.required)}
            >
              <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-card transition-transform ${form.required ? 'translate-x-4' : ''}`} />
            </button>
            Required
          </label>
          <div className="flex items-center gap-1">
            {!isNew && onDuplicate && (
              <button type="button" onClick={onDuplicate} title="Duplicate" className="p-2 rounded-lg hover:bg-secondary text-muted-foreground"><Copy className="w-4 h-4" /></button>
            )}
            {!isNew && onRemove && (
              <button type="button" onClick={onRemove} title="Delete" className="p-2 rounded-lg hover:bg-red-50 text-red-500"><Trash2 className="w-4 h-4" /></button>
            )}
            <button type="button" onClick={() => setAdvancedOpen(!advancedOpen)} title="Advanced options" className={`p-2 rounded-lg hover:bg-secondary ${advancedOpen ? 'text-primary' : 'text-muted-foreground'}`}><MoreVertical className="w-4 h-4" /></button>
            <button type="button" onClick={onCancel} disabled={saving} className="btn-secondary !py-1.5 text-sm ml-1 disabled:opacity-50">Cancel</button>
            <button type="button" onClick={onDone} disabled={saving} className="btn-primary !py-1.5 text-sm disabled:opacity-50">{saving ? 'Saving…' : 'Done'}</button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Advanced options (inline under the question, not a separate panel) ───
function AdvancedOptions({ form, setForm, isNew }) {
  return (
    <div className="rounded-lg border border-border bg-muted/40 p-4 space-y-4">
      <div>
        <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wide mb-1">Conditional logic</h4>
        <p className="text-xs text-muted-foreground mb-2">Show this question only when:</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <input className="input-field text-sm" placeholder="Question key" value={form.showIf?.field || ''} onChange={(e) => setForm((prev) => ({ ...prev, showIf: { ...(prev.showIf || {}), field: e.target.value } }))} />
          <select className="input-field text-sm" value={form.showIf?.operator || 'equals'} onChange={(e) => setForm((prev) => ({ ...prev, showIf: { ...(prev.showIf || {}), operator: e.target.value } }))}>
            {OPERATORS.map((operator) => <option key={operator} value={operator}>{operator}</option>)}
          </select>
          <input className="input-field text-sm" placeholder="Value" value={form.showIf?.value ?? ''} onChange={(e) => setForm((prev) => ({ ...prev, showIf: { ...(prev.showIf || {}), value: e.target.value } }))} />
        </div>
      </div>
      <div>
        <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wide mb-1">USCIS field links</h4>
        <p className="text-xs text-muted-foreground mb-2">One per line, e.g. I129.part2.fullName</p>
        <textarea className="input-field text-sm min-h-[70px]" value={form.uscisMappingsText} onChange={(e) => setForm((prev) => ({ ...prev, uscisMappingsText: e.target.value }))} />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wide mb-1">Eligibility weight</h4>
          <input type="number" className="input-field text-sm" value={form.eligibilityWeight} onChange={(e) => setForm((prev) => ({ ...prev, eligibilityWeight: e.target.value }))} />
        </div>
        <div>
          <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wide mb-1">Evidence category</h4>
          <select className="input-field text-sm" value={form.evidenceCategory} onChange={(e) => setForm((prev) => ({ ...prev, evidenceCategory: e.target.value }))}>
            <option value="">None</option>
            {EVIDENCE_CATEGORIES.map((category) => <option key={category} value={category}>{category}</option>)}
          </select>
        </div>
      </div>
      <div>
        <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wide mb-1">Question key</h4>
        {isNew ? (
          <>
            <p className="text-xs text-muted-foreground mb-2">Made from the question text. Type one only if you need a specific key.</p>
            <input className="input-field text-sm" value={form.key} onChange={(e) => setForm((prev) => ({ ...prev, key: e.target.value }))} />
          </>
        ) : (
          <>
            <p className="text-xs text-muted-foreground mb-2">Fixed: answers, document links and form mappings refer to it.</p>
            <input className="input-field text-sm" value={form.key} readOnly />
          </>
        )}
      </div>
    </div>
  )
}

// ── Create checklist wizard (2-step modal) ───────────────────────────────
function CreateWizardModal({ wizardStep, setWizardStep, wizardForm, setWizardForm, visasByCategory, roleOptionsForCategory, visaCategoryByKey, onClose, onCreate, saving }) {
  const selectedCategory = visaCategoryByKey[wizardForm.visaType] || ''
  const roleOptions = roleOptionsForCategory(selectedCategory)

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-card rounded-2xl shadow-xl w-full max-w-md p-4 sm:p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-lg font-bold text-foreground">Create checklist</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
        </div>

        {wizardStep === 1 ? (
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-muted-foreground mb-1.5">Checklist name</label>
              <input
                autoFocus
                className="input-field"
                placeholder="e.g. H-1B Employer Information"
                value={wizardForm.title}
                onChange={(e) => setWizardForm((prev) => ({ ...prev, title: e.target.value }))}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-muted-foreground mb-1.5">Visa type</label>
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
            <p className="text-sm font-semibold text-muted-foreground">Who completes this checklist?</p>
            <div className="space-y-2">
              {roleOptions.map((option) => (
                <label key={option.value} className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${wizardForm.checklistRole === option.value ? 'border-primary bg-primary-50' : 'border-border hover:bg-muted'}`}>
                  <input
                    type="radio"
                    name="checklistRole"
                    checked={wizardForm.checklistRole === option.value}
                    onChange={() => setWizardForm((prev) => ({ ...prev, checklistRole: option.value }))}
                  />
                  <span className="text-sm font-medium text-foreground">{option.label}</span>
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
