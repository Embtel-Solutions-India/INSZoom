import axios from 'axios'

// Same contract as the other two portals (Admin/Immiglance): the access
// token lives in memory only, the refresh token is an httpOnly cookie set by
// the backend, and a 401 triggers exactly one silent refresh before giving
// up and bouncing to /login.
const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:7000/api',
  withCredentials: true,
  headers: { 'Content-Type': 'application/json' },
  timeout: 120_000,
})

let accessToken = null
let refreshPromise = null

export const setAccessToken = (token) => {
  accessToken = token || null
}
export const getAccessToken = () => accessToken

const clearStoredSession = () => {
  accessToken = null
  localStorage.removeItem('loginTime')
  localStorage.removeItem('attorneyUser')
}

const refreshAccessToken = async () => {
  const response = await axios.post(`${api.defaults.baseURL}/auth/refresh`, {}, { withCredentials: true })
  const next = response.data?.accessToken || response.data?.token
  if (!next) throw new Error('Refresh failed')
  accessToken = next
  localStorage.setItem('loginTime', Date.now().toString())
  return next
}

api.interceptors.request.use((config) => {
  if (accessToken) config.headers.Authorization = `Bearer ${accessToken}`
  // The instance default Content-Type is 'application/json'. Left in place
  // for a FormData payload (feedback attachments), axios's transformRequest
  // sees that header and JSON-stringifies the FormData instead of sending
  // it as multipart — silently dropping every file. Clearing it here lets
  // axios detect FormData and hand it to the browser to set the correct
  // multipart boundary itself. Same fix Admin's api.js already applies.
  if (config.data instanceof FormData) {
    if (typeof config.headers?.delete === 'function') config.headers.delete('Content-Type')
    else if (config.headers) delete config.headers['Content-Type']
  }
  return config
})

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const original = error.config
    if (error.response?.status !== 401 || original?._retried || original?._skipAuthRedirect) {
      return Promise.reject(error)
    }
    original._retried = true
    try {
      // One shared in-flight refresh, so a burst of parallel 401s doesn't
      // fire N refresh calls (and invalidate each other's rotated token).
      refreshPromise = refreshPromise || refreshAccessToken().finally(() => { refreshPromise = null })
      const token = await refreshPromise
      original.headers.Authorization = `Bearer ${token}`
      return api(original)
    } catch (refreshError) {
      clearStoredSession()
      if (!window.location.pathname.startsWith('/login')) window.location.href = '/login'
      return Promise.reject(refreshError)
    }
  }
)

export const authApi = {
  login: (email, password) => api.post('/auth/login', { email, password }),
  me: () => api.get('/auth/me'),
  logout: () => api.post('/auth/logout'),
}

// The portal's "Messages" feature IS the Feedback thread (models/Feedback.js)
// — a staff-only channel by construction (attorney <-> case manager/team
// lead/admin, never the client). There is no separate case-scoped
// conversation here on purpose: the general client-inclusive Messages
// system (Backend/src/modules/messages) was deliberately NOT extended to
// attorneys, so a client can never end up in the same thread.
function toFeedbackFormData(message, files) {
  const form = new FormData()
  if (message) form.append('message', message)
  ;(files || []).forEach((file) => form.append('attachments', file))
  return form
}

export const attorneyApi = {
  dashboard: () => api.get('/attorney/dashboard'),
  cases: (params = {}) => api.get('/attorney/cases', { params }),
  case: (caseId) => api.get(`/attorney/cases/${caseId}`),
  feedback: (caseId) => api.get(`/attorney/cases/${caseId}/feedback`),
  sendFeedback: (caseId, message, files = []) => api.post(`/attorney/cases/${caseId}/feedback`, toFeedbackFormData(message, files)),
  replyFeedback: (caseId, feedbackId, message, files = []) =>
    api.post(`/attorney/cases/${caseId}/feedback/${feedbackId}/reply`, toFeedbackFormData(message, files)),
  markFeedbackRead: (caseId) => api.patch(`/attorney/cases/${caseId}/feedback/mark-read`),
  attachmentUrl: (caseId, feedbackId, attachmentId) =>
    `${api.defaults.baseURL}/attorney/cases/${caseId}/feedback/${feedbackId}/attachments/${attachmentId}`,
  downloadAttachment: (caseId, feedbackId, attachmentId) =>
    api.get(`/attorney/cases/${caseId}/feedback/${feedbackId}/attachments/${attachmentId}`, { responseType: 'blob' }),
}

// Case sub-resources reuse the SAME endpoints the staff portal uses — the
// backend authorizes them through canAccessCase, which is attorney-aware
// (see Backend/src/modules/cases/case.service.js). No attorney-specific
// duplicates of these handlers exist, by design.
export const caseDataApi = {
  documents: (caseId) => api.get('/documents', { params: { caseId } }),
  downloadDocument: (documentId) => api.get(`/documents/${documentId}/download`, { responseType: 'blob' }),
  forms: (caseId) => api.get(`/uscis-forms/case/${caseId}`),
  timeline: (caseId) => api.get(`/cases/${caseId}/timeline`),
  // Read-only endpoints reused from CRMCaseDetail.jsx's own tab set
  // (Petition/USCIS Tracking) — same backend routes the case manager page
  // calls, each already scoped through canAccessCase.
  petitionPackages: (caseId) => api.get(`/petition/cases/${caseId}/packages`),
  // Bearer-token auth (not a cookie) means a plain <a href> to these can't
  // carry the Authorization header — fetched as blobs instead, same as
  // downloadDocument above.
  previewPetitionPackage: (packageId) => api.get(`/petition/packages/${packageId}/preview`, { responseType: 'blob' }),
  downloadPetitionPackage: (packageId, format) => api.get(`/petition/packages/${packageId}/download`, { params: { format }, responseType: 'blob' }),
  tracking: (caseId) => api.get(`/lifecycle/cases/${caseId}/tracking`),
}

export const notificationsApi = {
  list: (params = {}) => api.get('/notifications/me', { params }),
  unreadCount: () => api.get('/notifications/unread-count'),
  markManyRead: (ids) => api.put('/notifications/mark-many-read', { ids }),
  registerDevice: (token, meta = {}) => api.post('/notifications/register-device', { token, ...meta }),
  unregisterDevice: (token) => api.delete('/notifications/unregister-device', { data: { token } }),
}

// Tasks assigned to the attorney. /my-tasks is already self-scoped
// server-side (task.controller.js forces assignedTo = req.user._id) — no
// caseId filtering needed here.
export const tasksApi = {
  myTasks: (params = {}) => api.get('/tasks/my-tasks', { params }),
  get: (id) => api.get(`/tasks/${id}`),
  // The backend defaults assignedTo to self when omitted and rejects
  // (403) any explicit assignedTo other than the caller for a non-admin/
  // team_lead role (task.controller.js's resolveAssignment) — an attorney
  // can only ever create a task assigned to themselves. This payload never
  // includes assignedTo, so it always lands on self.
  create: (payload) => api.post('/tasks', payload),
  updateStatus: (id, status) => api.put(`/tasks/${id}`, { status }),
  addComment: (id, text) => api.post(`/tasks/${id}/comments`, { text }),
}

export default api
