import axios from 'axios'

// BUG (fixed): silently falling back to a dev-only localhost URL shipped to
// production when a deployment's build environment never set VITE_API_URL —
// confirmed live: the deployed admin.immiglance.com bundle was calling
// http://localhost:7000, meaning it worked (misleadingly) only for whoever
// happened to have a local backend running on that port, and would fail to
// even log in for every real user. In dev, fall back to a relative /api
// (proxied by Vite — see scripts/vite-options.mjs) rather than an absolute
// cross-port URL, which also made the refresh_token cookie cross-site and
// thus dropped under SameSite=Lax. In a PRODUCTION build with no
// VITE_API_URL, fail loudly instead of silently pointing at localhost.
function resolveBaseUrl() {
  if (import.meta.env.VITE_API_URL) return import.meta.env.VITE_API_URL
  if (import.meta.env.DEV) return '/api'
  console.error('[FATAL CONFIG] VITE_API_URL is not set in this production build — every API call will fail. Set it in the build server\'s environment before deploying.')
  return 'https://MISSING-VITE_API_URL.invalid/api'
}

const api = axios.create({
  baseURL: resolveBaseUrl(),
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json'
  },
  timeout: 120_000
})

let refreshPromise = null
let accessToken = null
// Remove bearer tokens written by older releases during migration.
localStorage.removeItem('token')
localStorage.removeItem('refreshToken')

export const setAccessToken = (token) => {
  accessToken = token || null
}

export const getAccessToken = () => accessToken

const clearStoredSession = () => {
  accessToken = null
  localStorage.removeItem('loginTime')
  localStorage.removeItem('user')
}

const refreshAccessToken = async () => {
  const response = await axios.post(`${api.defaults.baseURL}/auth/refresh`, {}, { withCredentials: true })
  const { accessToken: nextAccessToken } = response.data || {}
  if (!nextAccessToken) throw new Error('Refresh failed')

  accessToken = nextAccessToken
  localStorage.setItem('loginTime', Date.now().toString())
  return nextAccessToken
}

const shortGetCache = new Map()
const cachedGet = (url, config = {}, ttlMs = 5000) => {
  const key = `${url}?${JSON.stringify(config.params || {})}`
  const cached = shortGetCache.get(key)
  if (cached && cached.expiresAt > Date.now()) return cached.promise
  const promise = api.get(url, config)
    .then((response) => response)
    .catch((error) => {
      const item = shortGetCache.get(key)
      if (item?.promise === promise) shortGetCache.delete(key)
      throw error
    })
    .finally(() => {
      const item = shortGetCache.get(key)
      if (item?.promise === promise) item.expiresAt = Date.now() + ttlMs
    })
  shortGetCache.set(key, { promise, expiresAt: Date.now() + ttlMs })
  return promise
}

// Add token to requests
api.interceptors.request.use(
  (config) => {
    const token = accessToken
    if (token) {
      config.headers.Authorization = `Bearer ${token}`
    }
    // The instance default Content-Type is 'application/json'. Left in place
    // for a FormData payload (file uploads), axios's own transformRequest
    // sees that header and JSON-stringifies the FormData instead of sending
    // it as multipart — silently dropping every file. Clearing it here lets
    // axios detect FormData and hand it to the browser to set the correct
    // multipart boundary itself.
    if (config.data instanceof FormData) {
      if (typeof config.headers?.delete === 'function') {
        config.headers.delete('Content-Type')
      } else if (config.headers) {
        delete config.headers['Content-Type']
      }
    }
    return config
  },
  (error) => {
    return Promise.reject(error)
  }
)
export const notificationsApi = {
  registerDevice: (token, meta = {}) => api.post('/notifications/register-device', { token, ...meta }),
  unregisterDevice: (token) => api.delete('/notifications/unregister-device', { data: { token } }),
};

// Requests made with responseType: 'blob' (PDF previews/downloads) get their
// error body decoded as a Blob by axios instead of JSON, even though the
// backend always sends JSON error bodies. Left unpatched, error.response.data
// is a Blob for these requests, so error.response.data.code/.message are
// always undefined - the 401 handler below can never detect TOKEN_EXPIRED
// (forcing a hard logout instead of a silent refresh) and every caller's
// `error.response?.data?.message` extraction silently loses the real backend
// error text. Re-hydrating the Blob back into the parsed JSON body here fixes
// both without touching every call site.
export const rehydrateBlobErrorBody = async (error) => {
  const data = error.response?.data
  if (!(data instanceof Blob) || !data.type?.includes('json')) return
  try {
    error.response.data = JSON.parse(await data.text())
  } catch {
    // Not actually JSON - leave as-is.
  }
}

// Handle response errors
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (error.code === 'ECONNABORTED' || error.message?.includes('timeout')) {
      error.userMessage = 'The server is taking too long to respond. Please try again.'
    }
    await rehydrateBlobErrorBody(error)
    const originalRequest = error.config
    if (originalRequest?._skipAuthRedirect) {
      return Promise.reject(error)
    }
    if (error.response?.status === 401 && !originalRequest?._retry) {
      if (error.response?.data?.code === 'TOKEN_EXPIRED') {
        originalRequest._retry = true
        try {
          if (!refreshPromise) {
            refreshPromise = refreshAccessToken().finally(() => { refreshPromise = null })
          }
          const nextToken = await refreshPromise
          originalRequest.headers = originalRequest.headers || {}
          originalRequest.headers.Authorization = `Bearer ${nextToken}`
          return api(originalRequest)
        } catch {
          clearStoredSession()
        }
      } else {
        clearStoredSession()
      }
      if (window.location.pathname !== '/login') {
        window.location.href = '/login'
      }
    }
    return Promise.reject(error)
  }
)
export default api

export const casesApi = {
  dashboardStats: (params = {}) => api.get('/cases/dashboard/stats', { params }),
  list: (params = {}) => api.get('/cases', { params }),
  get: (id) => api.get(`/cases/${id}`),
  workflow: (id) => api.get(`/cases/${id}/workflow`),
  recalculateWorkflow: (id, reason) => api.post(`/cases/${id}/workflow/recalculate`, { reason }),
  generateForms: (id) => api.post(`/cases/${id}/workflow/generate-forms`),
  generatePackage: (id, payload = {}) => api.post(`/cases/${id}/workflow/generate-package`, payload),
  generateWordPackage: (id, payload = {}) => api.post(`/cases/${id}/workflow/generate-word-package`, payload),
  create: (payload) => api.post('/cases', payload),
  createWithClient: (payload) => api.post('/cases/create-with-client', payload),
  update: (id, payload) => api.put(`/cases/${id}`, payload),
  archive: (id) => api.delete(`/cases/${id}`),
  updateStage: (id, payload) => api.put(`/cases/${id}/stage`, payload),
  addInternalNote: (id, payload) => api.post(`/cases/${id}/notes`, payload),
  assignCaseManager: (id, caseManagerId, notes, extra = {}) =>
    api.put(`/cases/${id}/assign-case-manager`, { caseManagerId, notes, ...extra }),
  // Phase 7 — assigning a principal/single case cascades to its non-overridden
  // child cases server-side; assigning a child case directly (e.g. from that
  // child's own detail page) marks it individually overridden. Same two
  // endpoints serve both the "assign" and "assign-override" use cases from
  // the Phase 7 spec — see case.controller.js's cascadeAssignmentToChildren.
  assignTeamLead: (id, teamLeadId, notes) =>
    api.put(`/cases/${id}/assign-team-lead`, { teamLeadId, notes }),
  // Second staff assignment alongside case manager/team lead — grants an
  // attorney portal-access to this case (Backend/src/models/Case.js's
  // attorneyAccess[]). Distinct endpoint (not assign-case-manager) because
  // it's additive/revocable rather than a single-slot reassignment.
  grantAttorneyAccess: (id, attorneyId) =>
    api.patch(`/cases/${id}/attorney-access`, { attorneyId, action: 'grant' }),
  revokeAttorneyAccess: (id, attorneyId) =>
    api.patch(`/cases/${id}/attorney-access`, { attorneyId, action: 'revoke' }),
  getRelated: (id) => api.get(`/cases/${id}/related`),
  // Employer/employee child-case slots (case.controller.js's Phase 9 +
  // extensions) — staff can act on any child case; the employer client can
  // act on their own principal's children (enforced server-side).
  restoreEmployee: (childCaseId) => api.patch(`/cases/${childCaseId}/restore-employee`),
  resendEmployeeInvite: (principalId, childCaseId) => api.post(`/cases/${principalId}/resend-employee-invite`, { childCaseId }),
  addEmployeeSlot: (principalId) => api.post(`/cases/${principalId}/add-employee-slot`),
  removeEmployee: (childCaseId) => api.patch(`/cases/${childCaseId}/remove-employee`),
  getTeamLeadDashboard: (params = {}) => api.get('/cases/dashboard/team-lead', { params }),
  addDocumentReference: (id, documentId) =>
    api.post(`/cases/${id}/document-references`, { documentId }),
  addUSCISFormReference: (id, payload) =>
    api.post(`/cases/${id}/uscis-form-references`, payload),
  addQuestionnaireReference: (id, payload) =>
    api.post(`/cases/${id}/questionnaire-references`, payload),
  sendQuestionnaire: (id, payload) =>
    api.post(`/cases/${id}/send-questionnaire`, payload),
  submitQuestionnaire: (id, payload) =>
    api.post(`/cases/${id}/submit-questionnaire`, payload),
  approveQuestionnaire: (id, payload) =>
    api.post(`/cases/${id}/approve-questionnaire`, payload),
  addons: (id) => api.get(`/cases/${id}/addons`),

  // EB-1A criterion-grouped checklist
  getEb1aCriteria: (id) => api.get(`/cases/${id}/eb1a-criteria`),
  updateEb1aCriterion: (id, criterionId, payload) =>
    api.put(`/cases/${id}/eb1a-criteria/${criterionId}`, payload),
  updateEb1aFinalMerits: (id, payload) =>
    api.put(`/cases/${id}/final-merits`, payload),
  linkExistingChecklistDocument: (id, idx, payload) =>
    api.post(`/cases/${id}/checklist/${idx}/link-existing-document`, payload),
}

export const usersApi = {
  caseManagers: () => api.get('/users/case-managers'),
  assignable: (role, params = {}) => api.get('/users/assignable', { params: { role, ...params } }),
}

// Staff side of the attorney<->case-team thread (Backend/src/modules/feedback,
// models/Feedback.js). Client is never a participant — see that model's own
// header comment. Mirrors the Attorney portal's attorneyApi.* shape exactly
// (Attorney/src/services/api.js) so both sides of the same thread are driven
// by symmetric client code.
function toFeedbackFormData(message, files) {
  const form = new FormData()
  if (message) form.append('message', message)
  ;(files || []).forEach((file) => form.append('attachments', file))
  return form
}

export const feedbackApi = {
  list: (caseId) => api.get(`/cases/${caseId}/feedback`),
  send: (caseId, message, files = []) => api.post(`/cases/${caseId}/feedback`, toFeedbackFormData(message, files)),
  reply: (caseId, feedbackId, message, files = []) =>
    api.post(`/cases/${caseId}/feedback/${feedbackId}/reply`, toFeedbackFormData(message, files)),
  markRead: (caseId) => api.patch(`/cases/${caseId}/feedback/mark-read`),
  downloadAttachment: (caseId, feedbackId, attachmentId) =>
    api.get(`/cases/${caseId}/feedback/${feedbackId}/attachments/${attachmentId}`, { responseType: 'blob' }),
}

export const lifecycleApi = {
  tracking: (caseId) => api.get(`/lifecycle/cases/${caseId}/tracking`),
  saveTracking: (caseId, payload) => api.put(`/lifecycle/cases/${caseId}/tracking`, payload),
}

export const employmentWorkflowApi = {
  createRequest: (caseId, payload) => api.post(`/employment-workflow/${caseId}/requests`, payload),
}

// Staff-only family/sponsor-visa (K-1/K-3/IR-1/CR-1/F2A/F2B/...) case
// creation - POST /family-workflow/cases previously had no frontend caller
// anywhere in the app; CreateCaseModal.jsx now uses this for any visa type
// whose caseStructure is "family".
export const familyWorkflowApi = {
  createCase: (payload) => api.post('/family-workflow/cases', payload),
  // Case Manager approval gate for the optional "Green Card – National Visa
  // Center (NVC) / Consular Processing Checklist" - never auto-assigned
  // merely because processingPath is CONSULAR, see approveGcNvcChecklist.
  approveGcNvcChecklist: (caseId) => api.post(`/family-workflow/${caseId}/gc-nvc-checklist/approve`),
}

// Single-party individual filings (H-4 Extension / H-4 EAD / H-4 Extension +
// EAD, COS to F-2, and any other standalone filingTypeKey from
// filingTypes.js) - POST /single-party-filings/cases creates the Case AND
// auto-assigns its single applicant checklist in one call (see
// single-party-filing.controller.js's createFiling). CreateCaseModal.jsx
// uses this only for those standalone filing-type visa options; every other
// visa type keeps using casesApi.create.
export const singlePartyFilingsApi = {
  types: () => api.get('/single-party-filings/types'),
  createCase: (payload) => api.post('/single-party-filings/cases', payload),
  changeFilingType: (caseId, payload) => api.patch(`/single-party-filings/cases/${caseId}/filing-type`, payload),
}

export const questionnairesApi = {
  list: (params = {}) => api.get('/questionnaires', { params }),
  defaults: () => api.get('/questionnaires/defaults'),
  create: (payload) => api.post('/questionnaires', payload),
  update: (id, payload) => api.put(`/questionnaires/${id}`, payload),
  archive: (id) => api.delete(`/questionnaires/${id}`),
  duplicate: (id, payload = {}) => api.post(`/questionnaires/${id}/clone`, payload),
  version: (id) => api.post(`/questionnaires/${id}/version`),
  publish: (id) => api.post(`/questionnaires/${id}/publish`),
  reorder: (id, payload) => api.put(`/questionnaires/${id}/reorder`, payload),
  get: (id) => api.get(`/questionnaires/${id}`),
  getForCase: (caseId, params = {}) => cachedGet(`/questionnaires/case/${caseId}`, { params }),
  listCaseChecklists: (caseId) => cachedGet(`/questionnaires/case/${caseId}/checklists`),
  createQuestion: (id, payload) => api.post(`/questionnaires/${id}/questions`, payload),
  updateQuestion: (id, questionId, payload) => api.put(`/questionnaires/${id}/questions/${questionId}`, payload),
  deleteQuestion: (id, questionId) => api.delete(`/questionnaires/${id}/questions/${questionId}`),
  assign: (id, payload) => api.post(`/questionnaires/${id}/assign`, payload),
  answers: (id, params = {}) => api.get(`/questionnaires/${id}/answers`, { params }),
  progress: (id, params = {}) => api.get(`/questionnaires/${id}/progress`, { params }),
  mappings: (id) => api.get(`/questionnaires/${id}/uscis-mappings`),
  generateDocumentRequests: (id, payload) => api.post(`/questionnaires/${id}/document-requests`, payload),
}

// Public, unauthenticated - the single source of truth for the visa list +
// categories (Backend/src/modules/eligibility-quiz/quiz.config.js's
// VISA_PATHWAYS). Reused here instead of a hardcoded copy so the checklist
// builder's visa picker can never drift out of sync with the backend.
export const eligibilityQuizApi = {
  visas: () => api.get('/eligibility-quiz/visas'),
}

export const documentsApi = {
  preview: (documentId) => api.get(`/documents/${documentId}/preview`, { responseType: 'blob' }),
  review: (documentId, payload) => api.put(`/documents/${documentId}/review`, payload),
  versions: (documentId) => api.get(`/documents/${documentId}/versions`),
}

export const clientIntakeApi = {
  caseIntake: (caseId) => api.get(`/client-intake/cases/${caseId}`),
}

export const uscisFormsApi = {
  templatePdf: (templateId) => api.get(`/uscis-forms/${templateId}/pdf`, { responseType: 'blob' }),
  // Interactive-viewer copy of the full template: barcode fields baked into
  // page content so pdf.js shows the real barcode image rather than an
  // editable text box over it. templatePdf above stays the untouched
  // official blank PDF.
  templatePdfViewer: (templateId) => api.get(`/uscis-forms/${templateId}/pdf`, { params: { purpose: 'viewer' }, responseType: 'blob' }),
  // Component-scoped blank PDF (e.g. the I-129 H Classification Supplement's
  // own pages only, not the full parent) - Adobe combinepdf-sliced server-side.
  componentTemplatePdf: (templateId, componentCode) =>
    api.get(`/uscis-forms/${templateId}/component-pdf/${encodeURIComponent(componentCode)}`, { responseType: 'blob' }),
  caseForms: (caseId) => api.get(`/uscis-forms/case/${caseId}`),
  createCaseForm: (caseId, payload) => api.post(`/uscis-forms/case/${caseId}`, payload),
  // Registry-driven form visibility (Phase 1): the full applicable form set
  // for this case's visa, provisioned or not - not just the CaseForms that
  // already exist (that's caseForms() above, still used by the workspace).
  formsOverview: (caseId) => api.get(`/cases/${caseId}/forms-overview`),
  // On-demand live USCIS fetch (Phase 2) for a mapped form with no active
  // template yet.
  acquireForm: (caseId, formNumber) => api.post(`/cases/${caseId}/forms/acquire`, { formNumber }),
  // Curated + biographic-fallback autofill for one already-provisioned form
  // (Phase 3) - distinct from the bulk casesApi.generateForms(), which
  // provisions/autofills every AUTO_CREATE form on the case but does not run
  // the biographic fallback.
  autofill: (caseId, formId) => api.post(`/uscis-forms/case/${caseId}/${formId}/autofill`),
  // Existing conditional-form decision endpoint (visaFormMapping.service.js's
  // recordConditionalDecision) - "Add"/"Not applicable" actions on a
  // CONDITIONAL_PENDING forms-overview row.
  decideMapping: (caseId, mappingId, decision, reason) => api.post(`/cases/${caseId}/form-mappings/${mappingId}/decision`, { decision, reason }),
  // Single-form, conflict-independent "Add" for an AVAILABLE_TO_PROVISION
  // forms-overview row (mapping + template both ready, no CaseForm yet) -
  // distinct from casesApi.generateForms(), which is correctly blocked by
  // any unresolved canonical-profile conflict on the case even when it has
  // nothing to do with this specific form.
  provisionMapping: (caseId, mappingId) => api.post(`/cases/${caseId}/form-mappings/${mappingId}/provision`),
  // Biographic Activation tier: no state change, just a staff notification
  // asking an admin to complete a full curated mapping review for a
  // biographic_active template.
  requestMappingReview: (templateId) => api.post(`/uscis-forms/${templateId}/mapping-review-request`),
  render: (caseId, formId) => api.get(`/uscis-forms/case/${caseId}/${formId}/render`),
  workspace: (caseId, formId) => api.get(`/uscis-forms/case/${caseId}/${formId}/workspace`),
  saveDraft: (caseId, formId, payload) => api.put(`/uscis-forms/case/${caseId}/${formId}/draft`, payload),
  autoSave: (caseId, formId, payload) => api.put(`/uscis-forms/case/${caseId}/${formId}/autosave`, payload),
  saveSection: (caseId, formId, payload) => api.put(`/uscis-forms/case/${caseId}/${formId}/section`, payload),
  review: (caseId, formId, payload) => api.post(`/uscis-forms/case/${caseId}/${formId}/review`, payload),
  saveWorkspaceField: (caseId, formId, payload) => api.patch(`/uscis-forms/case/${caseId}/${formId}/workspace/field`, payload),
  saveWorkspaceSection: (caseId, formId, payload) => api.put(`/uscis-forms/case/${caseId}/${formId}/workspace/section`, payload),
  reviewWorkspaceField: (caseId, formId, payload) => api.post(`/uscis-forms/case/${caseId}/${formId}/workspace/field/review`, payload),
  reviewWorkspaceSection: (caseId, formId, payload) => api.post(`/uscis-forms/case/${caseId}/${formId}/workspace/section/review`, payload),
  decideWorkspaceForm: (caseId, formId, payload) => api.post(`/uscis-forms/case/${caseId}/${formId}/workspace/decision`, payload),
  lockWorkspaceForm: (caseId, formId, payload) => api.post(`/uscis-forms/case/${caseId}/${formId}/workspace/lock`, payload),
  refreshWorkspace: (caseId, formId, payload = {}) => api.post(`/uscis-forms/case/${caseId}/${formId}/workspace/refresh`, payload),
  resetWorkspace: (caseId, formId, payload) => api.post(`/uscis-forms/case/${caseId}/${formId}/workspace/reset`, payload),
  resolveWorkspaceConflict: (caseId, formId, payload) => api.post(`/uscis-forms/case/${caseId}/${formId}/workspace/conflict`, payload),
  // Phase 3: resolves a Phase-2 per-field sync-state CONFLICT (sourceAttribution[fieldName].syncState) -
  // a different endpoint from resolveWorkspaceConflict above, which handles the older canonical-merge
  // conflict type (canonicalState.conflicts). payload: {fieldName, sectionKey, direction: "canonical"|"manual", reason?}.
  resolveFieldConflict: (caseId, formId, payload) => api.post(`/uscis-forms/case/${caseId}/${formId}/workspace/field/resolve-conflict`, payload),
  rollbackWorkspaceField: (caseId, formId, historyId) => api.post(`/uscis-forms/case/${caseId}/${formId}/workspace/history/${historyId}/rollback`),
  addWorkspaceComment: (caseId, formId, payload) => api.post(`/uscis-forms/case/${caseId}/${formId}/workspace/comments`, payload),
  resolveWorkspaceComment: (caseId, formId, commentId) => api.patch(`/uscis-forms/case/${caseId}/${formId}/workspace/comments/${commentId}/resolve`),
  createWorkspaceTask: (caseId, formId, payload) => api.post(`/uscis-forms/case/${caseId}/${formId}/workspace/tasks`, payload),
  workspaceValidation: (caseId, formId) => api.get(`/uscis-forms/case/${caseId}/${formId}/workspace/validation`),
  workspaceHistory: (caseId, formId) => api.get(`/uscis-forms/case/${caseId}/${formId}/workspace/history`),
  workspaceSources: (caseId, formId) => api.get(`/uscis-forms/case/${caseId}/${formId}/workspace/sources`),
  workspaceComparison: (caseId, formId) => api.get(`/uscis-forms/case/${caseId}/${formId}/workspace/comparison`),
  searchWorkspaceFields: (caseId, formId, q) => api.get(`/uscis-forms/case/${caseId}/${formId}/workspace/search`, { params: { q } }),
}

// Form Governance page: which USCIS forms exist in this system, whether
// they've been fetched from uscis.gov, their field-mapping/autofill review
// state, and which visa types/case types reference them (from the
// VisaFormMapping registry). Global/not case-scoped - distinct from
// uscisFormsApi above, which is case- or template-detail-scoped.
export const formGovernanceApi = {
  catalog: () => api.get('/form-registry/catalog'),
  fetchFromUSCIS: (formCode) => api.post(`/form-registry/catalog/${encodeURIComponent(formCode)}/fetch`),
  templateUrl: (templateId) => api.get(`/uscis-forms/${templateId}/url`),
  approveTemplate: (templateId) => api.put(`/uscis-forms/${templateId}/approve`),
  activateTemplate: (templateId) => api.put(`/uscis-forms/${templateId}/activate`),
  mappingPreview: (templateId) => api.get(`/form-mappings/templates/${templateId}/preview`),
  generateMapping: (templateId, persist = true) => api.post(`/form-mappings/templates/${templateId}/generate`, { persist }),
  upsertMapping: (templateId, targetFieldId, payload) => api.put(`/form-mappings/templates/${templateId}/mappings/${encodeURIComponent(targetFieldId)}`, payload),
  activateMapping: (templateId) => api.post(`/form-mappings/templates/${templateId}/activate`),
  autofillPreview: (templateId, caseId) => api.get(`/form-mappings/templates/${templateId}/autofill-preview`, { params: { caseId } }),
  // Checklist <-> field traceability (Visa-Form-Checklist intelligence
  // layer) - which checklist question(s) feed each mapped PDF field, and
  // the system-wide coverage view across every active form.
  checklistTraceFields: (templateId) => api.get(`/form-mappings/templates/${templateId}/checklist-trace/fields`),
  checklistTraceCoverageAll: () => api.get('/form-mappings/checklist-trace/coverage'),
  // Phase 3H/3I governance additions - read-only defect/health diagnostics,
  // same endpoints family as the checklist-trace calls above.
  governanceDefects: (templateId) => api.get(`/form-mappings/templates/${templateId}/checklist-trace/defects`),
  checklistHealth: () => api.get('/form-mappings/checklist-health'),
  // "Add case type" - maps this template's form to another visa type, with
  // an assignment type (Automatic = AUTO_CREATE, Conditional = CONDITIONAL).
  // Reuses the existing per-template VisaFormMapping CRUD (also used by the
  // legacy USCISForms.jsx "Visa mappings" panel) rather than a new endpoint.
  visaRegistry: () => api.get('/uscis-forms/registry/visa-registry'),
  addCaseType: (templateId, payload) => api.post(`/uscis-forms/${templateId}/mappings`, payload),
  componentPdf: (templateId, componentCode) => api.get(`/uscis-forms/${templateId}/component-pdf/${encodeURIComponent(componentCode)}`, { responseType: 'blob' }),
  // Upload/Replace Form - reuses the existing manual-import pipeline
  // (qpdf normalization, PDF validation, AcroForm field scan, storage
  // upload, USCISFormTemplate creation - all already automatic and
  // identical for a new form code or a same-form-code replacement).
  // analyze writes nothing; upload/publish is the confirming step
  // (expectedSha256 in formData guarantees "publish exactly what was
  // reviewed"). Replacing an existing form is the same call with the same
  // formType as the form being replaced - VisaFormMapping associations key
  // off the formCode string and re-resolve automatically once the new
  // edition activates, so nothing else needs to change.
  analyzeFormPdf: (formData) => api.post('/uscis/forms/analyze', formData),
  uploadFormPdf: (formData) => api.post('/uscis/forms/upload', formData),
}

export const formGenerationApi = {
  generatePdf: (caseFormId, payload = {}) => api.post(`/forms/${caseFormId}/generate`, payload),
  regeneratePdf: (caseFormId, payload = {}) => api.post(`/forms/${caseFormId}/regenerate`, payload),
  previewPdf: (caseFormId) => api.get(`/forms/${caseFormId}/preview`, { responseType: 'blob' }),
  downloadPdf: (caseFormId) => api.get(`/forms/${caseFormId}/download`, { responseType: 'blob' }),
  // The one official download: real, authentic, watermark-free USCIS PDF,
  // no status gate. Replaces the old draftPdf/filingPdf split.
  downloadForm: (caseFormId) => api.get(`/forms/${caseFormId}/download-form`, { responseType: 'blob' }),
}

export const petitionApi = {
  assemble: (caseId, payload = {}) => api.post(`/petition/cases/${caseId}/assemble`, payload),
  listPackages: (caseId) => api.get(`/petition/cases/${caseId}/packages`),
  getPackage: (packageId) => api.get(`/petition/packages/${packageId}`),
  getValidation: (packageId) => api.get(`/petition/packages/${packageId}/validation`),
  previewUrl: (packageId) => `${api.defaults.baseURL}/petition/packages/${packageId}/preview`,
  preview: (packageId) => api.get(`/petition/packages/${packageId}/preview`, { responseType: 'blob' }),
  download: (packageId, format = 'pdf') => api.get(`/petition/packages/${packageId}/download`, { params: { format }, responseType: 'blob' }),
  saveLetter: (packageId, sectionKey, html) => api.patch(`/petition/packages/${packageId}/letters/${sectionKey}`, { html }),
  reorderExhibits: (packageId, order) => api.patch(`/petition/packages/${packageId}/exhibits/order`, { order }),
  insertPage: (packageId, payload) => api.post(`/petition/packages/${packageId}/pages`, payload),
  removePage: (packageId, sectionKey) => api.delete(`/petition/packages/${packageId}/pages/${sectionKey}`),
  finalize: (packageId, payload = {}) => api.post(`/petition/packages/${packageId}/finalize`, payload),
  unlock: (packageId, reason) => api.post(`/petition/packages/${packageId}/unlock`, { reason }),
  recordFiling: (packageId, payload) => api.post(`/petition/packages/${packageId}/filing`, payload),
  recordReceipt: (packageId, payload) => api.post(`/petition/packages/${packageId}/receipt`, payload),
  getBranding: () => api.get('/petition/branding'),
  listDefinitions: () => api.get('/petition/definitions'),
  getDefinition: (key) => api.get(`/petition/definitions/${key}`),
  upsertDefinition: (key, payload) => api.put(`/petition/definitions/${key}`, payload),
}

// Public eligibility quiz leads — same Backend module Immiglance's own admin
// portal reads from (Backend/src/modules/eligibility-quiz/quiz.routes.js,
// mounted at /eligibility-quiz). Every lead here originated from a
// prospect completing the public quiz (and, if consultationId is
// populated, going on to book a free consultation).
export const leadsApi = {
  list: (params = {}) => api.get('/eligibility-quiz/leads', { params }),
  get: (id) => api.get(`/eligibility-quiz/leads/${id}`),
  markSeen: (id) => api.post(`/eligibility-quiz/leads/${id}/seen`, {}),
  updateStatus: (id, status) => api.patch(`/eligibility-quiz/leads/${id}/status`, { status }),
  addNote: (id, text) => api.post(`/eligibility-quiz/leads/${id}/notes`, { text }),
  // State-machine-enforced lifecycle transitions (Phase 6) — each permits
  // exactly one transition server-side, unlike the freeform updateStatus above.
  confirmConsultation: (id) => api.patch(`/eligibility-quiz/leads/${id}/confirm-consultation`, {}),
  completeConsultation: (id, notes) => api.patch(`/eligibility-quiz/leads/${id}/complete-consultation`, { notes }),
  approve: (id) => api.patch(`/eligibility-quiz/leads/${id}/approve`, {}),
  reject: (id, rejectionReason) => api.patch(`/eligibility-quiz/leads/${id}/reject`, { rejectionReason }),
}

export const eligibilityApi = {
  evaluate: (caseId, payload = {}) => api.post('/eligibility/evaluate', { caseId, ...payload }),
  results: (caseId) => api.get(`/eligibility/${caseId}/results`),
  gaps: (caseId) => api.get(`/eligibility/${caseId}/gaps`),
  recommendations: (caseId) => api.get(`/eligibility/${caseId}/recommendations`),
  recalculate: (caseId, payload = {}) => api.post(`/eligibility/${caseId}/recalculate`, payload),
  override: (caseId, payload = {}) => api.post(`/eligibility/${caseId}/override`, payload),
}
