import axios from 'axios'

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:7000/api',
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
  getRelated: (id) => api.get(`/cases/${id}/related`),
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
}

export const usersApi = {
  caseManagers: () => api.get('/users/case-managers'),
  assignable: (role, params = {}) => api.get('/users/assignable', { params: { role, ...params } }),
}

export const lifecycleApi = {
  tracking: (caseId) => api.get(`/lifecycle/cases/${caseId}/tracking`),
  saveTracking: (caseId, payload) => api.put(`/lifecycle/cases/${caseId}/tracking`, payload),
}

export const employmentWorkflowApi = {
  createRequest: (caseId, payload) => api.post(`/employment-workflow/${caseId}/requests`, payload),
}

export const questionnairesApi = {
  list: (params = {}) => api.get('/questionnaires', { params }),
  defaults: () => api.get('/questionnaires/defaults'),
  create: (payload) => api.post('/questionnaires', payload),
  update: (id, payload) => api.put(`/questionnaires/${id}`, payload),
  archive: (id) => api.delete(`/questionnaires/${id}`),
  duplicate: (id, payload = {}) => api.post(`/questionnaires/${id}/clone`, payload),
  version: (id) => api.post(`/questionnaires/${id}/version`),
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
  caseForms: (caseId) => api.get(`/uscis-forms/case/${caseId}`),
  createCaseForm: (caseId, payload) => api.post(`/uscis-forms/case/${caseId}`, payload),
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

export const formGenerationApi = {
  generatePdf: (caseFormId, payload = {}) => api.post(`/forms/${caseFormId}/generate`, payload),
  regeneratePdf: (caseFormId, payload = {}) => api.post(`/forms/${caseFormId}/regenerate`, payload),
  previewPdf: (caseFormId) => api.get(`/forms/${caseFormId}/preview`, { responseType: 'blob' }),
  downloadPdf: (caseFormId) => api.get(`/forms/${caseFormId}/download`, { responseType: 'blob' }),
  draftPdf: (caseFormId) => api.get(`/forms/${caseFormId}/draft-pdf`, { responseType: 'blob' }),
  // Phase 5 - clean, watermark-free filing copy (approved/locked/generated forms only).
  filingPdf: (caseFormId) => api.get(`/forms/${caseFormId}/filing-pdf`, { responseType: 'blob' }),
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
  finalize: (packageId, payload = {}) => api.post(`/petition/packages/${packageId}/finalize`, payload),
  unlock: (packageId, reason) => api.post(`/petition/packages/${packageId}/unlock`, { reason }),
  recordFiling: (packageId, payload) => api.post(`/petition/packages/${packageId}/filing`, payload),
  recordReceipt: (packageId, payload) => api.post(`/petition/packages/${packageId}/receipt`, payload),
  listDefinitions: () => api.get('/petition/definitions'),
  getDefinition: (key) => api.get(`/petition/definitions/${key}`),
  upsertDefinition: (key, payload) => api.put(`/petition/definitions/${key}`, payload),
}

// Public eligibility quiz leads — same Backend module BAIS's own admin
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
