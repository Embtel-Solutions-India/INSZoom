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

// Drops any cachedGet entry whose URL starts with `urlPrefix` so the next
// read is forced back to the server instead of serving up to `ttlMs` (5s) of
// stale data. Needed because cachedGet has no write-side invalidation of its
// own - callers that know a relevant write just happened (e.g. a case's
// questionnaire/checklist data changing via a socket push) call this before
// re-fetching, instead of waiting out the TTL.
export const invalidateCachedGet = (urlPrefix) => {
  for (const key of shortGetCache.keys()) {
    if (key.startsWith(urlPrefix)) shortGetCache.delete(key)
  }
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

    // A 502/503/504 (or a dropped connection, which the browser reports as a
    // CORS/network error because the proxy's error page carries no CORS
    // headers) is a momentary gateway blip, not a real answer. Read-only (GET)
    // requests are safe to repeat, so retry them a couple of times with a short
    // pause before surfacing an error. Writes are never retried, and neither is
    // a request that timed out after its full wait.
    const gatewayBlip = !error.response
      ? error.code === 'ERR_NETWORK'
      : [502, 503, 504].includes(error.response.status)
    if (
      originalRequest &&
      String(originalRequest.method || '').toLowerCase() === 'get' &&
      gatewayBlip &&
      error.code !== 'ECONNABORTED' &&
      (originalRequest._gatewayRetries || 0) < 2
    ) {
      originalRequest._gatewayRetries = (originalRequest._gatewayRetries || 0) + 1
      await new Promise((resolve) => setTimeout(resolve, 1500 * originalRequest._gatewayRetries))
      return api(originalRequest)
    }
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

// OCR/Document-AI autofill: scans one uploaded document (e.g. a passport) and
// writes the extracted values into the case's checklist answers server-side.
export const documentIntelligenceApi = {
  autofillFromDocument: (caseId, documentType, file) => {
    const fd = new FormData()
    fd.append('file', file)
    fd.append('documentType', documentType)
    return api.post(`/document-intelligence/case/${caseId}/autofill`, fd, { headers: { 'Content-Type': 'multipart/form-data' } })
  },
}

// Deleted cases held for 30 days (admins and super admins)
export const recycleBinApi = {
  list: () => api.get('/recycle-bin'),
  restore: (id) => api.post(`/recycle-bin/${id}/restore`, undefined, { timeout: 120000 }),
  purge: (id) => api.delete(`/recycle-bin/${id}`),
}

export const casesApi = {
  dashboardStats: (params = {}) => api.get('/cases/dashboard/stats', { params }),
  list: (params = {}) => api.get('/cases', { params }),
  // Every creatable case type from the registry (drives the Create Case dropdown).
  visaTypes: () => api.get('/cases/visa-types'),
  get: (id) => api.get(`/cases/${id}`),
  workflow: (id) => api.get(`/cases/${id}/workflow`),
  // Case Manager upgrade: assigns the Form I-907 checklist to the client and adds Form I-907 to the case.
  upgradePremiumProcessing: (id) => api.post(`/cases/${id}/premium-processing/upgrade`),
  recalculateWorkflow: (id, reason) => api.post(`/cases/${id}/workflow/recalculate`, { reason }),
  generateForms: (id) => api.post(`/cases/${id}/workflow/generate-forms`),
  generatePackage: (id, payload = {}) => api.post(`/cases/${id}/workflow/generate-package`, payload),
  generateWordPackage: (id, payload = {}) => api.post(`/cases/${id}/workflow/generate-word-package`, payload),
  create: (payload) => api.post('/cases', payload),
  createWithClient: (payload) => api.post('/cases/create-with-client', payload),
  update: (id, payload) => api.put(`/cases/${id}`, payload),
  archive: (id) => api.delete(`/cases/${id}`),
  // Permanent: removes the case (and its child cases) from the database.
  deletePermanently: (id) => api.delete(`/cases/${id}/permanent`),
  updateStage: (id, payload) => api.put(`/cases/${id}/stage`, payload),
  addInternalNote: (id, payload) => api.post(`/cases/${id}/notes`, payload),
  assignCaseManager: (id, caseManagerId, notes, extra = {}) =>
    api.put(`/cases/${id}/assign-case-manager`, { caseManagerId, notes, ...extra }),
  // Additional case managers working the case alongside the primary one (the primary is changed through assignCaseManager above).
  addCaseManager: (id, caseManagerId) => api.post(`/cases/${id}/case-managers`, { caseManagerId }),
  removeCaseManager: (id, userId) => api.delete(`/cases/${id}/case-managers/${userId}`),
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
  // scope: 'children' = just the principal/child links (what the Employees panel reads and polls) instead of every related record
  getRelated: (id, params) => api.get(`/cases/${id}/related`, params ? { params } : undefined),
  // Employer/employee child-case slots (case.controller.js's Phase 9 +
  // extensions) — staff can act on any child case; the employer client can
  // act on their own principal's children (enforced server-side).
  restoreEmployee: (childCaseId) => api.patch(`/cases/${childCaseId}/restore-employee`),
  resendEmployeeInvite: (principalId, childCaseId) => api.post(`/cases/${principalId}/resend-employee-invite`, { childCaseId }),
  // a fresh one-time link the employee opens to choose their own password (passwords are never stored readable, so there is nothing to display)
  createEmployeeSetupLink: (principalId, childCaseId) => api.post(`/cases/${principalId}/employee-setup-link`, { childCaseId }),
  // Per-employee workflow: { mode: 'fill_self' } revokes an invitation, { mode: 'invite', employeeName, employeeEmail } invites.
  setEmployeeDataEntryMode: (principalId, childCaseId, payload) => api.patch(`/cases/${principalId}/employees/${childCaseId}/data-entry-mode`, payload),
  addEmployeeSlot: (principalId, payload = {}) => api.post(`/cases/${principalId}/add-employee-slot`, payload),
  // who an employee case is: { name?, email? } - the same fields the employer fills in the client portal
  setEmployeeIdentity: (principalId, childCaseId, payload) => api.patch(`/cases/${principalId}/employees/${childCaseId}/identity`, payload),
  employeeVisaOptions: () => api.get('/cases/employee-visa-options'),
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
function toFeedbackFormData(message, files, clientMessageId, uploadIds) {
  const form = new FormData()
  if (message) form.append('message', message)
  if (clientMessageId) form.append('clientMessageId', clientMessageId)
  // Big files are uploaded in chunks beforehand (utils/chunkedUpload.js) and referenced by id.
  if (uploadIds?.length) form.append('uploadIds', JSON.stringify(uploadIds))
  ;(files || []).forEach((file) => form.append('attachments', file))
  return form
}

// `options`: { uploadIds, ...axiosConfig } - e.g. signal / onUploadProgress for the multipart part.
export const feedbackApi = {
  list: (caseId) => api.get(`/cases/${caseId}/feedback`),
  send: (caseId, message, files = [], clientMessageId, { uploadIds, ...config } = {}) =>
    api.post(`/cases/${caseId}/feedback`, toFeedbackFormData(message, files, clientMessageId, uploadIds), config),
  reply: (caseId, feedbackId, message, files = [], clientMessageId, { uploadIds, ...config } = {}) =>
    api.post(`/cases/${caseId}/feedback/${feedbackId}/reply`, toFeedbackFormData(message, files, clientMessageId, uploadIds), config),
  markRead: (caseId) => api.patch(`/cases/${caseId}/feedback/mark-read`),
  downloadAttachment: (caseId, feedbackId, attachmentId, config = {}) =>
    api.get(`/cases/${caseId}/feedback/${feedbackId}/attachments/${attachmentId}`, { responseType: 'blob', ...config }),
}

// Client<->staff / staff<->staff message thread (Backend/src/modules/messages). Sender-only: edit replaces the text (the
// message keeps its place and gains `editedAt`); delete-for-everyone wipes text, attachments and reactions but leaves the
// message in the thread with `deletedForEveryoneAt` set. Both return { success, message }.
export const messagesApi = {
  edit: (messageId, messageBody) => api.put(`/messages/${messageId}`, { messageBody }, { timeout: 20_000 }),
  deleteForEveryone: (messageId) => api.delete(`/messages/${messageId}/everyone`, { timeout: 20_000 }),
}

export const lifecycleApi = {
  tracking: (caseId) => api.get(`/lifecycle/cases/${caseId}/tracking`),
  saveTracking: (caseId, payload) => api.put(`/lifecycle/cases/${caseId}/tracking`, payload),
}

// Generic staff "Request information" flow (recipient selector + per-person checklist row).
export const informationRequestsApi = {
  recipients: (caseId) => api.get(`/cases/${caseId}/information-requests/recipients`),
  list: (caseId) => api.get(`/cases/${caseId}/information-requests`),
  create: (caseId, payload) => api.post(`/cases/${caseId}/information-requests`, payload),
  // "Request" next to an item already on the client's checklist: becomes required for this case only (re-sends when already requested)
  requestItem: (caseId, payload) => api.post(`/cases/${caseId}/information-requests/item`, payload),
  cancelItemRequest: (caseId, requestId) => api.post(`/cases/${caseId}/information-requests/${requestId}/cancel`),
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

// Email Template Customization page (Backend modules/settings/emailTemplates.routes.js).
export const emailTemplatesApi = {
  meta: () => api.get('/email-templates/meta'),
  library: () => api.get('/email-templates/library'),
  defaults: (triggerKey) => api.get(`/email-templates/defaults/${triggerKey}`),
  get: (id) => api.get(`/email-templates/${id}`),
  create: (payload) => api.post('/email-templates', { ...payload, managed: true }),
  update: (id, payload) => api.patch(`/email-templates/${id}`, payload),
  activate: (id) => api.post(`/email-templates/${id}/activate`),
  deactivate: (id) => api.post(`/email-templates/${id}/deactivate`),
  duplicate: (id) => api.post(`/email-templates/${id}/duplicate`),
  archive: (id) => api.delete(`/email-templates/${id}`),
  preview: (payload) => api.post('/email-templates/preview', payload),
  sendTest: (payload) => api.post('/email-templates/test', payload),
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
  // Case manager: release draft checklists to the client (body: { checklistIds } or { all: true }).
  approveCaseChecklists: (caseId, body) => api.post(`/questionnaires/case/${caseId}/checklists/approve`, body),
  // Case manager: edit / add / remove a question on this case's own copy of a checklist (never the shared template).
  getRemovedCaseChecklistQuestions: (caseId, checklistId) => api.get(`/questionnaires/case/${caseId}/checklists/removed-questions`, { params: { checklistId } }),
  editCaseChecklist: (caseId, body) => api.post(`/questionnaires/case/${caseId}/checklists/edit`, body),
  removeCaseChecklist: (caseId, body) => api.post(`/questionnaires/case/${caseId}/checklists/remove`, body),
  createQuestion: (id, payload) => api.post(`/questionnaires/${id}/questions`, payload),
  updateQuestion: (id, questionId, payload) => api.put(`/questionnaires/${id}/questions/${questionId}`, payload),
  deleteQuestion: (id, questionId) => api.delete(`/questionnaires/${id}/questions/${questionId}`),
  assign: (id, payload) => api.post(`/questionnaires/${id}/assign`, payload),
  // Where a checklist is used: visa types (with open-case counts), forms and assigned cases - and the actions on them.
  usage: (id) => api.get(`/questionnaires/${id}/usage`),
  formOptions: (id, params = {}) => api.get(`/questionnaires/${id}/form-options`, { params }),
  addFormMapping: (id, payload) => api.post(`/questionnaires/${id}/form-mappings`, payload),
  removeFormMapping: (id, mappingId) => api.delete(`/questionnaires/${id}/form-mappings/${mappingId}`),
  answers: (id, params = {}) => api.get(`/questionnaires/${id}/answers`, { params }),
  // Case-manager correction of a client's already-submitted answer -
  // preserveStatus:true tells the backend to keep that answer's existing
  // status (submitted/approved) instead of resetting it to auto_saved (see
  // questionnaire.service.js's PRESERVE_ANSWER_STATUS). Client-side save
  // calls in Immiglance never set this flag.
  saveAnswer: (id, payload) => api.post(`/questionnaires/${id}/answers`, { ...payload, preserveStatus: true }),
  // One entry of a multi-entry file answer: stream it (auth header) for view/download, or remove it.
  downloadAnswerFile: (id, params) => api.get(`/questionnaires/${id}/answers/files/download`, { params, responseType: 'blob' }),
  removeAnswerFile: (id, data) => api.delete(`/questionnaires/${id}/answers/files`, { data }),
  // Files up to 3 MB go up in one request; larger ones (up to the 50 MB limit) are sent in 2 MB chunks so no single request exceeds what a hosting
  // proxy accepts (413 above ~5 MB), then assembled and saved by the server.
  saveFileAnswer: async (id, formData) => {
    formData.append('preserveStatus', 'true')
    const files = formData.getAll('files')
    const large = files.filter((file) => file.size > 700 * 1024)
    if (!large.length) return api.post(`/questionnaires/${id}/answers/files`, formData, { headers: { 'Content-Type': 'multipart/form-data' } })
    const payload = {}
    for (const [key, value] of formData.entries()) if (key !== 'files') payload[key] = value
    let result
    for (const file of files) {
      if (file.size <= 700 * 1024) {
        const fd = new FormData()
        Object.entries(payload).forEach(([key, value]) => fd.append(key, value))
        fd.append('files', file)
        result = await api.post(`/questionnaires/${id}/answers/files`, fd, { headers: { 'Content-Type': 'multipart/form-data' } })
        continue
      }
      const created = await api.post(`/questionnaires/${id}/answers/files/sessions`, { originalName: file.name, mimeType: file.type || 'application/octet-stream', expectedSize: file.size, chunkSize: 700 * 1024 })
      const session = created.data.session
      // several chunks go up at once (each a separate small request); a failed chunk is retried
      let nextChunk = 0
      let failure = null
      const sendChunks = async () => {
        while (!failure && nextChunk < session.totalChunks) {
          const index = nextChunk
          nextChunk += 1
          const start = index * session.chunkSize
          const chunk = file.slice(start, Math.min(start + session.chunkSize, file.size), file.type)
          let lastError
          for (let attempt = 1; attempt <= 3; attempt += 1) {
            try {
              const fd = new FormData()
              fd.append('chunk', chunk, file.name)
              await api.put(`/questionnaires/${id}/answers/files/sessions/${session.uploadId}/chunks/${index}`, fd, { headers: { 'Content-Type': 'multipart/form-data' } })
              lastError = null
              break
            } catch (error) {
              lastError = error
              if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 500))
            }
          }
          if (lastError) { failure = lastError; return }
        }
      }
      await Promise.all(Array.from({ length: Math.min(4, session.totalChunks) }, sendChunks))
      if (failure) throw failure
      result = await api.post(`/questionnaires/${id}/answers/files/sessions/${session.uploadId}/complete`, payload)
    }
    return result
  },
  progress: (id, params = {}) => api.get(`/questionnaires/${id}/progress`, { params }),
  mappings: (id) => api.get(`/questionnaires/${id}/uscis-mappings`),
  visaOptions: () => api.get('/questionnaires/visa-options'),
  visaMappings: (id) => api.get(`/questionnaires/${id}/visa-mappings`),
  addVisaMapping: (id, visaType) => api.post(`/questionnaires/${id}/visa-mappings`, { visaType }),
  removeVisaMapping: (id, visaType) => api.delete(`/questionnaires/${id}/visa-mappings/${encodeURIComponent(visaType)}`),
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
  // Petition tab's manual "Upload Petition" - a real Document (uploadedBy
  // the case manager, never 'system'), tagged documentType
  // "petition_manual_upload" so both this tab and the Attorney Portal's
  // Petition tab can query for exactly these without pulling in every other
  // case document. Separate from the auto-assembled PetitionPackage
  // pipeline (petitionApi below) entirely - see document.service.js's
  // createDocumentFromFile for the matching caseService.addAuditEntry hook
  // that makes this show up live on the Attorney side.
  listPetitionUploads: (caseId) => api.get('/documents', { params: { caseId, documentType: 'petition_manual_upload' } }),
  // Petitions can be very large (up to 200 MB): anything over one chunk goes
  // through the resumable chunked-session API (3 retries per chunk, reassembled
  // server-side) instead of one long request. Chunks stay under 1 MB so every request
  // passes a web server / reverse proxy that caps request bodies at its 1 MB default
  // (a larger body is refused with 413 before it ever reaches the API).
  uploadPetition: async (caseId, file, onProgress) => {
    const chunkSize = 896 * 1024
    const context = { caseId, documentType: 'petition_manual_upload', category: 'legal', legacySource: 'Admin' }
    if (file.size <= chunkSize) {
      const formData = new FormData()
      formData.append('file', file)
      Object.entries(context).forEach(([key, value]) => formData.append(key, value))
      const response = await api.post('/documents', formData, { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 0 })
      onProgress?.(100)
      return response
    }
    const created = await api.post('/documents/uploads/sessions', {
      originalName: file.name,
      mimeType: file.type || 'application/pdf',
      expectedSize: file.size,
      chunkSize,
      ...context,
    })
    const session = created.data.session
    for (let index = 0; index < session.totalChunks; index += 1) {
      const start = index * session.chunkSize
      const chunk = file.slice(start, Math.min(start + session.chunkSize, file.size), file.type)
      let lastError
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        try {
          const formData = new FormData()
          formData.append('chunk', chunk, file.name)
          await api.put(`/documents/uploads/sessions/${session.uploadId}/chunks/${index}`, formData, { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 300_000 })
          lastError = null
          break
        } catch (error) {
          lastError = error
          if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 700))
        }
      }
      if (lastError) {
        // the proxy's 413 carries no CORS headers, so the browser reports it as a network error with no response
        if (!lastError.response) lastError.message = 'The upload was interrupted by the server or network. Please try again.'
        throw lastError
      }
      onProgress?.(Math.round(((index + 1) / session.totalChunks) * 95))
    }
    const done = await api.post(`/documents/uploads/sessions/${session.uploadId}/complete`, {}, { timeout: 600_000 })
    onProgress?.(100)
    return done
  },
  download: (documentId) => api.get(`/documents/${documentId}/download`, { responseType: 'blob' }),
  // In-place editing (plain-text documents only) - case manager view/edit/save,
  // reusing the document's existing version history under the hood.
  getContent: (documentId) => api.get(`/documents/${documentId}/content`),
  saveContent: (documentId, content, changeReason) => api.put(`/documents/${documentId}/content`, { content, changeReason }),
}

export const clientIntakeApi = {
  // params.view = 'client': only the client profile (the case page reads nothing else from the bundle)
  caseIntake: (caseId, params) => api.get(`/client-intake/cases/${caseId}`, params ? { params } : undefined),
}

// Case Manager control over which USCIS forms a case has (catalogue, per-case selection with typed add / remove, checklist coverage, autofill).
export const caseFormsApi = {
  catalog: (params = {}) => api.get('/case-forms/catalog', { params }),
  resolve: (name) => api.get('/case-forms/resolve', { params: { name } }),
  getSelection: (caseId, params = {}) => api.get(`/case-forms/cases/${caseId}/selection`, { params }),
  // payload: { targetCaseId, expectedRevision, add: [{ name | formCode, componentCode? }], remove: [...], assignChecklists?, assignChecklistKeys?, autofill? }
  updateSelection: (caseId, payload) => api.put(`/case-forms/cases/${caseId}/selection`, payload, { timeout: 300_000 }),
  coverage: (caseId, params = {}) => api.get(`/case-forms/cases/${caseId}/selection/coverage`, { params, timeout: 120_000 }),
  autofill: (caseId, payload = {}) => api.post(`/case-forms/cases/${caseId}/selection/autofill`, payload, { timeout: 300_000 }),
}

export const uscisFormsApi = {
  templatePdf: (templateId) => api.get(`/uscis-forms/${templateId}/pdf`, { responseType: 'blob' }),
  // Interactive-viewer copy of the full template: barcode fields baked into
  // page content so pdf.js shows the real barcode image rather than an
  // editable text box over it. templatePdf above stays the untouched
  // official blank PDF.
  // `r` only changes when the prepared viewer copy changes (boxes unlocked), so a browser that cached the previous copy for an hour fetches the new one
  templatePdfViewer: (templateId) => api.get(`/uscis-forms/${templateId}/pdf`, { params: { purpose: 'viewer', r: 3 }, responseType: 'blob' }),
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
  // a field save can legitimately run longer than the default 2 minutes on a large form; aborting it only made the page send it again while the server was still working
  saveWorkspaceField: (caseId, formId, payload) => api.patch(`/uscis-forms/case/${caseId}/${formId}/workspace/field`, payload, { timeout: 300_000 }),
  saveWorkspaceSection: (caseId, formId, payload) => api.put(`/uscis-forms/case/${caseId}/${formId}/workspace/section`, payload),
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
// Release 0b-1: evidence-resolution API for USCIS form-edition acceptance (admin / team_lead only). Responses are { success, data }.
export const formEditionPolicyApi = {
  editions: () => api.get('/form-edition-policy/editions'),
  gate: (formCode, edition) => api.get('/form-edition-policy/gate', { params: { formCode, edition } }),
  autoCheck: (formCode, editionIdentifier) => api.post('/form-edition-policy/auto-check', { formCode, editionIdentifier }),
}

// Phase 1: the form import pipeline's durable jobs (what is running, what is stuck, why). Responses are { success, data }.
export const formPipelineApi = {
  status: () => api.get('/form-pipeline/status'),
  jobs: (params) => api.get('/form-pipeline/jobs', { params }),
  job: (jobId) => api.get(`/form-pipeline/jobs/${jobId}`),
  retry: (jobId) => api.post(`/form-pipeline/jobs/${jobId}/retry`),
}

// Phase 3 release safety (read the gate's decision, preview case-form migration, roll an edition back, run the recovery check, restore a case form from its pre-image).
// Responses are { success, data }. Pre-image routes are exactly admin; rollback / recovery admin and super_admin; the gate and the plan also team_lead.
export const formReleaseApi = {
  gate: (templateId) => api.get(`/form-release/templates/${templateId}/gate`),
  migrationPlan: (formCode, templateId) => api.get(`/form-release/forms/${encodeURIComponent(formCode)}/migration-plan`, { params: { templateId }, timeout: 120000 }),
  rollback: (formCode, payload) => api.post(`/form-release/forms/${encodeURIComponent(formCode)}/rollback`, payload, { timeout: 120000 }),
  reconcile: () => api.post('/form-release/reconcile', undefined, { timeout: 120000 }),
  snapshots: (caseFormId) => api.get('/form-release/migration-snapshots', { params: { caseFormId } }),
  restore: (snapshotId, payload) => api.post(`/form-release/migration-snapshots/${snapshotId}/restore`, payload, { timeout: 120000 }),
}

// Phase 5 governance (read-only): the operations overview, one form's separate statuses, the mapping-review queue and the frozen case forms. Responses are { success, data }.
export const governanceOpsApi = {
  overview: () => api.get('/form-governance/overview'),
  formStatus: (formCode) => api.get(`/form-governance/forms/${encodeURIComponent(formCode)}/status`),
  mappingReview: (params) => api.get('/form-governance/mapping-review', { params }),
  frozenCases: () => api.get('/form-governance/frozen-cases'),
}

// Phase 4: the AI field-mapping engine (read-only). The mode is the server's FORM_AI_MAPPING setting; suggestions hold form metadata only.
export const aiMappingApi = {
  status: () => api.get('/form-ai-mapping/status'),
  suggestions: (params) => api.get('/form-ai-mapping/suggestions', { params }),
}

// Phase 2: the golden set - the answer key a named reviewer confirms in plain language. Responses are { success, data }.
export const goldenSetApi = {
  summary: () => api.get('/golden-set/summary'),
  entries: (params) => api.get('/golden-set/entries', { params }),
  review: (entryId, payload) => api.put(`/golden-set/entries/${entryId}/review`, payload),
  signOff: () => api.post('/golden-set/sign-off', { confirm: true }),
  exportCsv: () => api.get('/golden-set/export.csv', { responseType: 'blob' }),
}

export const formGovernanceApi = {
  catalog: () => api.get('/form-registry/catalog'),
  // one form's catalog row, without reading every other form
  catalogEntry: (formCode) => api.get(`/form-registry/catalog/${encodeURIComponent(formCode)}`),
  fetchFromUSCIS: (formCode) => api.post(`/form-registry/catalog/${encodeURIComponent(formCode)}/fetch`),
  deleteForm: (formCode) => api.delete(`/form-registry/catalog/${encodeURIComponent(formCode)}`),
  templateUrl: (templateId) => api.get(`/uscis-forms/${templateId}/url`),
  approveTemplate: (templateId) => api.put(`/uscis-forms/${templateId}/approve`),
  activateTemplate: (templateId) => api.put(`/uscis-forms/${templateId}/activate`),
  mappingPreview: (templateId) => api.get(`/form-mappings/templates/${templateId}/preview`),
  generateMapping: (templateId, persist = true) => api.post(`/form-mappings/templates/${templateId}/generate`, { persist }),
  upsertMapping: (templateId, targetFieldId, payload) => api.put(`/form-mappings/templates/${templateId}/mappings/${encodeURIComponent(targetFieldId)}`, payload),
  activateMapping: (templateId) => api.post(`/form-mappings/templates/${templateId}/activate`),
  // "Keep blank": this box must stay EMPTY (no canonical field, no default value). keepBlank:false takes the decision back.
  keepBlank: (templateId, targetFieldId, payload) => api.put(`/form-mappings/templates/${templateId}/mappings/${encodeURIComponent(targetFieldId)}/keep-blank`, payload),
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
  // Phase 2: how well this form's mapping covers the form (contract findings, unmapped boxes by class, questions without a box, default values)
  mappingCoverage: (templateId) => api.get(`/form-mappings/templates/${templateId}/coverage`),
  // "Add case type" - maps this template's form to another visa type, with
  // an assignment type (Automatic = AUTO_CREATE, Conditional = CONDITIONAL).
  // Reuses the existing per-template VisaFormMapping CRUD (also used by the
  // legacy USCISForms.jsx "Visa mappings" panel) rather than a new endpoint.
  visaRegistry: () => api.get('/uscis-forms/registry/visa-registry'),
  addCaseType: (templateId, payload) => api.post(`/uscis-forms/${templateId}/mappings`, payload),
  // Edit which checklist(s) a visa -> form row sends (compulsory / conditional / case-manager-added, with its condition), then optionally apply the
  // row to the cases already in progress ({ dryRun: true } counts them first).
  removeCaseType: (templateId, mappingId) => api.delete(`/uscis-forms/${templateId}/mappings/${mappingId}`),
  checklistOptions: () => api.get('/form-registry/checklist-options'),
  updateMappingChecklists: (mappingId, payload) => api.put(`/form-registry/mappings/${mappingId}/checklists`, payload),
  applyMappingToCases: (mappingId, payload) => api.post(`/form-registry/mappings/${mappingId}/apply-to-cases`, payload),
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

// Fields the backend could not write exactly as stored (value longer than the
// PDF field allows) come back in the X-Form-Warnings response header.
export const readFormWarnings = (response) => {
  try {
    const raw = response?.headers?.['x-form-warnings']
    return raw ? JSON.parse(decodeURIComponent(raw)) : []
  } catch {
    return []
  }
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
  requestAttorneyReview: (caseId, note) => api.post(`/petition/cases/${caseId}/request-attorney-review`, { note }),
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

// GoHighLevel pipeline board. The browser only ever talks to our backend; the backend does all GHL syncing.
export const ghlApi = {
  status: () => api.get('/integrations/ghl/status'),
  board: (params = {}) => api.get('/integrations/ghl/board', { params }),
  caseStages: (caseId) => api.get(`/integrations/ghl/cases/${caseId}/stages`),
  moveStage: (caseId, payload) => api.patch(`/integrations/ghl/cases/${caseId}/pipeline-stage`, payload),
  setupPreview: () => api.get('/integrations/ghl/setup'),
  confirmMapping: () => api.post('/integrations/ghl/setup/confirm'),
  // A full pass reads every opportunity of both pipelines from GoHighLevel, so it can legitimately run longer than the default 2 minutes.
  syncNow: () => api.post('/integrations/ghl/sync', {}, { timeout: 600_000 }),
  reconcileNow: () => api.post('/integrations/ghl/reconcile', {}, { timeout: 600_000 }),
  retryJob: (jobId) => api.post(`/integrations/ghl/jobs/${jobId}/retry`),
}

// Petition review: release an uploaded petition to the attorney(s) and / or the client-side audience (single applicant / petitioner / employer), and the feedback
// conversation with that audience. Both release actions e-mail the people concerned.
export const petitionReviewApi = {
  list: (caseId) => api.get(`/petition-review/cases/${caseId}`),
  sendToAttorney: (caseId, documentId, note) => api.post(`/petition-review/cases/${caseId}/documents/${documentId}/attorney-review`, { note }),
  sendToClient: (caseId, documentId, note) => api.post(`/petition-review/cases/${caseId}/documents/${documentId}/client-review`, { note }),
  messages: (documentId, params = { limit: 100 }) => api.get(`/petition-review/documents/${documentId}/messages`, { params }),
  send: (documentId, body, clientMessageId) => api.post(`/petition-review/documents/${documentId}/messages`, { body, clientMessageId }),
  markRead: (documentId) => api.post(`/petition-review/documents/${documentId}/messages/read`, {}),
  // The viewer: a signed link for one petition (the server starts reading the big file at once), a long-poll that says when it is ready, and the stream the PDF viewer loads by URL.
  viewLink: (documentId) => api.post(`/petition-review/documents/${documentId}/view-link`, {}),
  ready: (token) => api.get(`/petition-review/stream/${encodeURIComponent(token)}/ready`),
  streamUrl: (token, { download = false } = {}) => `${api.defaults.baseURL}/petition-review/stream/${encodeURIComponent(token)}${download ? '?download=1' : ''}`,
}

// Organisation-level Google Drive ("Add to Drive"). Every route 404s on the server unless the feature is enabled; status says whether to show the button.
export const googleDriveApi = {
  status: () => api.get(`/integrations/google-drive/status`),
  connectStart: (returnPath) => api.post(`/integrations/google-drive/connect/start`, { returnPath }),
  disconnect: () => api.post(`/integrations/google-drive/disconnect`, {}),
  pickerToken: () => api.post(`/integrations/google-drive/picker-token`, {}),
  validateFolder: (folderId) => api.post(`/integrations/google-drive/folders/validate`, { folderId }),
  createFolder: (name, parentId) => api.post(`/integrations/google-drive/folders`, { name, ...(parentId ? { parentId } : {}) }),
  listFolders: (parentId) => api.get(`/integrations/google-drive/folders`, { params: parentId ? { parentId } : {} }),
  lookupLinks: (documentIds) => api.post(`/integrations/google-drive/links/lookup`, { documentIds }),
  sync: (payload) => api.post(`/integrations/google-drive/sync`, payload),
  job: (jobId) => api.get(`/integrations/google-drive/jobs/${jobId}`),
  retry: (jobId) => api.post(`/integrations/google-drive/jobs/${jobId}/retry`, {}),
}
