const BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:7000/api";
export const API_BASE_URL = BASE_URL;

// Non-sensitive marker only ("do we have a session to try refreshing?") — the
// actual refresh token lives in an httpOnly cookie the backend sets on
// login/refresh, so JS never has access to it.
const HAS_SESSION_KEY = "bais_has_session";
const LEGACY_TOKEN_KEY = "bais_access_token";
// Remove tokens written by older builds during the first load after upgrade.
localStorage.removeItem(LEGACY_TOKEN_KEY);

export const tokenStore = {
  getAccess: () => {
    const token = accessToken;
    if (!token) return null;
    try {
      const encodedPayload = token.split(".")[1]?.replace(/-/g, "+").replace(/_/g, "/");
      const payload = JSON.parse(atob(encodedPayload));
      if (payload.exp && payload.exp * 1000 <= Date.now()) {
        accessToken = null;
        return null;
      }
    } catch {
      accessToken = null;
      return null;
    }
    return token;
  },
  hasSession: () => localStorage.getItem(HAS_SESSION_KEY) === "1",
  set: (access) => {
    accessToken = access || null;
    localStorage.setItem(HAS_SESSION_KEY, "1");
  },
  clear: () => {
    accessToken = null;
    localStorage.removeItem(LEGACY_TOKEN_KEY);
    localStorage.removeItem(HAS_SESSION_KEY);
  },
};

let accessToken = null;

let refreshPromise = null;

async function refreshAccessToken() {
  const res = await fetch(`${BASE_URL}/auth/refresh`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });

  if (!res.ok) {
    tokenStore.clear();
    throw new Error("Session expired");
  }

  const data = await res.json();
  tokenStore.set(data.accessToken);
  return data.accessToken;
}

// No request timeout existed here at all — a backend request stuck behind
// MongoDB connection-pool contention (or a slow downstream call like Stripe)
// would hang the fetch indefinitely, which is exactly what "page takes 10+
// minutes to load" looks like client-side: not an error, just a spinner that
// never resolves. This bounds every request so a stuck backend surfaces as a
// clear, retriable error instead of an infinite wait.
const REQUEST_TIMEOUT_MS = Number(import.meta.env.VITE_API_TIMEOUT_MS) || 25000;

async function request(path, options = {}, retry = true) {
  const headers = { ...options.headers };

  if (!(options.body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
  }

  let token = tokenStore.getAccess();
  if (!token && tokenStore.hasSession()) {
    try {
      if (!refreshPromise) {
        refreshPromise = refreshAccessToken().finally(() => { refreshPromise = null; });
      }
      token = await refreshPromise;
    } catch {
      tokenStore.clear();
      window.dispatchEvent(new Event("bais:session-expired"));
      throw new Error("Session expired. Please log in again.");
    }
  }
  if (token) headers["Authorization"] = `Bearer ${token}`;

  let res;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      ...options,
      headers,
      credentials: "include",
      signal: options.signal || AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (networkError) {
    if (networkError.name === "TimeoutError" || networkError.name === "AbortError") {
      const error = new Error("The server took too long to respond. Please try again.");
      error.cause = networkError;
      error.isTimeout = true;
      throw error;
    }
    // A raw TypeError("Failed to fetch") means the request never reached the
    // server at all (offline, backend down/restarting, DNS/CORS blocked) -
    // surfacing that literal browser message to the user is meaningless,
    // so translate it into something actionable instead of leaking it as-is.
    const error = new Error("Unable to reach the server. Check your connection and try again.");
    error.cause = networkError;
    error.isNetworkError = true;
    throw error;
  }

  if (res.status === 401 && retry) {
    const data = await res.json().catch(() => ({}));
    if (data.code === "TOKEN_EXPIRED") {
      if (!refreshPromise) {
        refreshPromise = refreshAccessToken().finally(() => { refreshPromise = null; });
      }  
      try {
        await refreshPromise;
        return request(path, options, false);
      } catch {
        tokenStore.clear();
        window.dispatchEvent(new Event("bais:session-expired"));
        throw new Error("Session expired. Please log in again.");
      }
    }
    tokenStore.clear();
    window.dispatchEvent(new Event("bais:session-expired"));
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: "Request failed" }));
    const error = new Error(err.message || "Request failed");
    error.status = res.status;
    if (err.code) error.code = err.code;
    throw error;
  }

  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("application/json")) return res.json();
  return res;
}

export const api = {
  get: (path) => request(path, { method: "GET" }),
  post: (path, body) =>
    request(path, {
      method: "POST",
      body: body instanceof FormData ? body : JSON.stringify(body),
    }),
  put: (path, body) =>
    request(path, {
      method: "PUT",
      body: body instanceof FormData ? body : JSON.stringify(body),
    }),
  patch: (path, body) =>
    request(path, {
      method: "PATCH",
      body: body instanceof FormData ? body : JSON.stringify(body),
    }),
  delete: (path, body) =>
    request(path, {
      method: "DELETE",
      ...(body !== undefined ? { body: body instanceof FormData ? body : JSON.stringify(body) } : {}),
    }),
};

// ── Auth ────────────────────────────────────────────
export const authApi = {
  register: (displayName, email, password, referralCode, phone, accountType = "client") =>
    api.post("/auth/register", { displayName, email, password, referralCode, phone, accountType }),
  login: (emailOrPayload, password) => api.post(
    "/auth/login",
    typeof emailOrPayload === "object" && emailOrPayload !== null
      ? emailOrPayload
      : { email: emailOrPayload, password }
  ),
  googleToken: (idToken) => api.post("/auth/google-token", { idToken }),
  logout: () => api.post("/auth/logout", {}),
  me: () => api.get("/auth/me"),
  // PHASE 3: single source of truth for post-auth routing (see
  // components/AuthGate.jsx) — resolves the parsed JSON body directly, same
  // as every other api.* call (this client is a fetch wrapper, not axios).
  sessionContext: () => api.get("/auth/session-context"),
  // Pre-case applicant-type choice (individual vs. employer sponsoring
  // employees) — changeable at any time from PlanSelection or Profile.
  updateApplicantType: (applicantType) => api.put("/auth/updatedetails", { applicantType }),
  changePassword: (currentPassword, newPassword) =>
    api.put("/auth/change-password", { currentPassword, newPassword }),
  getInviteDetails: (token) => api.get(`/auth/invite/${token}`),
  acceptInvite: (token, password, confirmPassword, username) =>
    api.post(`/auth/invite/${token}/accept`, { password, confirmPassword, ...(username ? { username } : {}) }),
  forgotPassword: (email) => api.post("/auth/forgot-password", { email }),
  resetPassword: (token, newPassword, confirmPassword) =>
    api.post("/auth/reset-password", { token, newPassword, confirmPassword }),
  // Public + neutral — for a passwordless invited employee who wandered to
  // login/signup, or whose invite link expired; never reveals whether the
  // email exists or is a pending invite.
  resendInvite: (email) => api.post("/auth/resend-invite", { email }),
};

export const employmentWorkflowApi = {
  me: () => api.get("/employment-workflow/me"),
  saveCompany: (payload) => api.put("/employment-workflow/company", payload),
  createCase: (payload) => api.post("/employment-workflow/cases", payload),
  inviteEmployee: (caseId, payload) => api.post(`/employment-workflow/${caseId}/invite-employee`, payload),
  resendEmployeeInvite: (caseId) => api.post(`/employment-workflow/${caseId}/resend-employee-invite`, {}),
  saveJob: (caseId, payload) => api.put(`/employment-workflow/${caseId}/job`, payload),
  // Content-free by design — only assigns which side completes the employee
  // packet (masterData.employee content lives in the Questionnaire/Answer
  // system now); see chooseEmployerCompletedPacket() in EmployerWorkspace.jsx.
  saveEmployeeQuestionnaire: (caseId, payload) => api.put(`/employment-workflow/${caseId}/employee-questionnaire`, payload),
  submit: (caseId, target) => api.post(`/employment-workflow/${caseId}/submit`, { target }),
};

// Family/sponsor visa (K-1/K-3) two-party path — mirrors
// employmentWorkflowApi's shape under separate field names. Only `submit`
// is needed by the client portal today (case creation/invite happen via
// direct backend calls only — no self-serve UI exists for this yet).
export const familyWorkflowApi = {
  submit: (caseId, target) => api.post(`/family-workflow/${caseId}/submit`, { target }),
};

// ── Profile ─────────────────────────────────────────
export const profileApi = {
  get: () => api.get("/clients/me"),
  save: (data, completed, lastStep) =>
    api.put("/clients/me", { data, completed, lastStep }),
  getIntake: () => api.get("/client-intake/me"),
  saveIntake: (data, context = {}) => api.put("/client-intake/me", { data, ...context }),
  submitIntake: (caseId) => api.post("/client-intake/me/submit", { caseId }),
};

// ── Documents ────────────────────────────────────────
export const documentsApi = {
  list: () => api.get("/documents/me"),
  count: () => api.get("/documents/me/count"),
  upload: (file, category, documentType, context = {}) => {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("category", category);
    fd.append("documentType", documentType);
    if (context.caseId) fd.append("caseId", context.caseId);
    if (context.beneficiaryId) fd.append("beneficiaryId", context.beneficiaryId);
    return api.post("/documents/me", fd);
  },
  createUploadSession: (file, category, documentType, context = {}, chunkSize = 5 * 1024 * 1024) =>
    api.post("/documents/uploads/sessions", {
      originalName: file.name,
      mimeType: file.type || "application/octet-stream",
      expectedSize: file.size,
      chunkSize,
      category,
      documentType,
      caseId: context.caseId,
      beneficiaryId: context.beneficiaryId,
      legacySource: "BAIS",
    }),
  uploadChunk: (uploadId, chunkIndex, chunk, fileName) => {
    const fd = new FormData();
    fd.append("chunk", chunk, fileName);
    return api.put(`/documents/uploads/sessions/${uploadId}/chunks/${chunkIndex}`, fd);
  },
  uploadStatus: (uploadId) => api.get(`/documents/uploads/sessions/${uploadId}`),
  completeUpload: (uploadId) => api.post(`/documents/uploads/sessions/${uploadId}/complete`, {}),
  cancelUpload: (uploadId) => api.delete(`/documents/uploads/sessions/${uploadId}`),
  uploadResumable: async (file, category, documentType, context = {}, controls = {}) => {
    const chunkSize = 5 * 1024 * 1024;
    if (file.size <= chunkSize) {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("category", category);
      formData.append("documentType", documentType);
      formData.append("legacySource", "BAIS");
      if (context.caseId) formData.append("caseId", context.caseId);
      if (context.questionnaireId) formData.append("questionnaireId", context.questionnaireId);
      if (context.participantId) formData.append("participantId", context.participantId);
      if (context.beneficiaryId) formData.append("beneficiaryId", context.beneficiaryId);
      if (context.clientId) formData.append("clientId", context.clientId);
      if (context.userId) formData.append("userId", context.userId);
      const response = await api.post("/documents/upload", formData);
      controls.onProgress?.(100);
      return response.document || response;
    }
    const created = await documentsApi.createUploadSession(file, category, documentType, context, chunkSize);
    const session = created.session;
    for (let chunkIndex = 0; chunkIndex < session.totalChunks; chunkIndex += 1) {
      while (controls.isPaused?.()) await new Promise((resolve) => setTimeout(resolve, 200));
      const start = chunkIndex * session.chunkSize;
      const chunk = file.slice(start, Math.min(start + session.chunkSize, file.size), file.type);
      let lastError;
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        try {
          await documentsApi.uploadChunk(session.uploadId, chunkIndex, chunk, file.name);
          lastError = null;
          break;
        } catch (error) {
          lastError = error;
          if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 500));
        }
      }
      if (lastError) throw lastError;
      controls.onProgress?.(Math.round(((chunkIndex + 1) / session.totalChunks) * 100), session.uploadId);
    }
    return documentsApi.completeUpload(session.uploadId);
  },
  remove: (docId) => api.delete(`/documents/${docId}`),
  download: (docId) => `${BASE_URL}/documents/${docId}/download`,
};

export const documentIntelligenceApi = {
  list: (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return api.get(`/document-intelligence${q ? "?" + q : ""}`);
  },
  getByDocument: (documentId) => api.get(`/document-intelligence/documents/${documentId}`),
  reprocessDocument: (documentId) => api.post(`/document-intelligence/documents/${documentId}/extract`),
  reviewQueue: (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return api.get(`/document-intelligence/review-queue${q ? "?" + q : ""}`);
  },
  getExtraction: (id) => api.get(`/document-intelligence/${id}`),
  approveExtraction: (id, payload = {}) => api.post(`/document-intelligence/${id}/approve`, payload),
  rejectExtraction: (id, payload = {}) => api.post(`/document-intelligence/${id}/reject`, payload),
  editField: (id, payload) => api.put(`/document-intelligence/${id}/field`, payload),
  // Unified prefill summary across the generic Answer questionnaire and the
  // employer-employee masterData blob, for a given case.
  casePrefillSummary: (caseId) => api.get(`/document-intelligence/case/${caseId}/prefill-summary`),
  reviewMasterDataField: (caseId, prefillId, action, payload = {}) =>
    api.post(`/document-intelligence/case/${caseId}/masterdata-field/${prefillId}/${action}`, payload),
  // Only resume/passport are offered — the two document types with a
  // hand-authored field mapping (see Backend's autofill-document-types.js).
  // There is deliberately no generic "any supporting document" autofill
  // trigger; a normal checklist upload already gets OCR-processed in the
  // background and surfaces later via casePrefillSummary.
  autofillFromDocument: (caseId, documentType, file) => {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("documentType", documentType);
    return api.post(`/document-intelligence/case/${caseId}/autofill`, fd);
  },
};

// ── Appointments ────────────────────────────────────
export const appointmentsApi = {
  book: (payload) => api.post("/appointments/public", payload),
  my: () => api.get("/appointments/my"),
  // Admin
  all: (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return api.get(`/appointments${q ? "?" + q : ""}`);
  },
  updateStatus: (id, status, notes) =>
    api.put(`/appointments/${id}/status`, { status, notes }),
};

export const leadsApi = {
  create: (payload) => api.post("/leads/public", payload),

  // ── Phase 4 ──
  // Public, pre-login quiz-shaped lead creation. Not currently called from
  // any page — EligibilityQuiz.jsx deliberately stays on the pre-existing
  // eligibilityQuizApi.submit() → POST /api/eligibility-quiz/submit path
  // (see that file's own comment). Added so the backend capability the
  // Phase 4 spec asked for exists and is callable, for a future caller.
  createLead: (payload) => api.post("/leads", payload),
  // Authenticated — creates a Lead from a logged-in client's completed
  // intake questionnaire and sets User.leadId server-side. Response is the
  // parsed JSON body directly (api.js is a fetch wrapper, not axios — see
  // request()'s implementation), so callers read res.leadId, not res.data.leadId.
  createLeadFromIntake: (payload) => api.post("/leads/from-intake", payload),

  // ── Admin Leads Inbox (Phase 1) ──
  list: (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return api.get(`/eligibility-quiz/leads${q ? "?" + q : ""}`);
  },
  get: (id) => api.get(`/eligibility-quiz/leads/${id}`),
  updateStatus: (id, status) => api.patch(`/eligibility-quiz/leads/${id}/status`, { status }),
  assign: (id, userId) => api.patch(`/eligibility-quiz/leads/${id}/assign`, { assignedTo: userId }),
  addNote: (id, text) => api.post(`/eligibility-quiz/leads/${id}/notes`, { text }),
  markSeen: (id) => api.post(`/eligibility-quiz/leads/${id}/seen`, {}),
};

// ── Public eligibility quiz (Phase 1) ────────────────
export const eligibilityQuizApi = {
  visas: () => api.get("/eligibility-quiz/visas"),
  definition: (visaPathway, sessionId) => {
    const q = new URLSearchParams({ ...(visaPathway ? { visa: visaPathway } : {}), ...(sessionId ? { sessionId } : {}) }).toString();
    return api.get(`/eligibility-quiz/definition${q ? "?" + q : ""}`);
  },
  submit: (payload) => api.post("/eligibility-quiz/submit", payload),
};

// ── Free consultation booking (Phase 1 add-on) ───────
export const consultationApi = {
  config: () => api.get("/consultation/config"),
  slots: (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return api.get(`/consultation/slots${q ? "?" + q : ""}`);
  },
  book: (payload) => api.post("/consultation/book", payload),
  getBooking: (token) => api.get(`/consultation/booking/${token}`),
  reschedule: (token, newStartAt) => api.post(`/consultation/booking/${token}/reschedule`, { newStartAt }),
  cancel: (token, reason) => api.post(`/consultation/booking/${token}/cancel`, { reason }),
};

// ── Phase 0 entity config + compliance (consumed by the public quiz) ─
export const entityConfigApi = {
  public: () => api.get("/entity-config/public"),
};

export const complianceApi = {
  disclaimer: () => api.get("/compliance/disclaimer"),
  acceptDisclaimer: (payload) => api.post("/compliance/disclaimer/accept", payload),
};

export const telemetryApi = {
  track: (payload) => api.post("/telemetry/track", payload).catch(() => null), // fire-and-forget, never blocks the caller
};

// ── Cases ────────────────────────────────────────────
export const casesApi = {
  my: () => api.get("/cases/my"),
  dashboardStats: (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return api.get(`/cases/dashboard/stats${q ? "?" + q : ""}`);
  },
  all: (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return api.get(`/cases${q ? "?" + q : ""}`);
  },
  get: (id) => api.get(`/cases/${id}`),
  workflow: (id) => api.get(`/cases/${id}/workflow`),
  recalculateWorkflow: (id, reason) => api.post(`/cases/${id}/workflow/recalculate`, { reason }),
  create: (payload) => api.post("/cases", payload),
  update: (id, payload) => api.put(`/cases/${id}`, payload),
  archive: (id) => api.delete(`/cases/${id}`),
  updateStage: (id, payload) => api.put(`/cases/${id}/stage`, payload),
  addInternalNote: (id, payload) => api.post(`/cases/${id}/notes`, payload),
  assignCaseManager: (id, caseManagerId, notes) =>
    api.put(`/cases/${id}/assign-case-manager`, { caseManagerId, notes }),
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
  purchaseAddon: (id, addonKey) => api.post(`/cases/${id}/addons/${addonKey}/purchase`, {}),

  // Checklist
  uploadChecklistFile: (caseId, idx, files) => {
    const fd = new FormData();
    files.forEach((f) => fd.append("files", f));
    return api.post(`/cases/${caseId}/checklist/${idx}/upload`, fd);
  },
  updateChecklistItem: (caseId, idx, payload) =>
    api.put(`/cases/${caseId}/checklist/${idx}`, payload),
  generateChecklist: (caseId, visaType) =>
    api.post(`/cases/${caseId}/checklist/generate`, { visaType }),

  // Plan
  updatePlan: (caseId, payload) => api.put(`/cases/${caseId}/plan`, payload),

  // Assessment
  saveAssessment: (caseId, payload) =>
    api.put(`/cases/${caseId}/assessment`, payload),

  // Phase 9 — caseRole=principal/employee/beneficiary child-Case
  // architecture. Distinct from employmentWorkflowApi above, which is the
  // older employerUser/employeeUser-on-one-Case architecture.
  getRelated: (id) => api.get(`/cases/${id}/related`),
  setDataEntryMode: (principalId, mode) =>
    api.patch(`/cases/${principalId}/data-entry-mode`, { mode }),
  inviteEmployee: (principalId, data) =>
    api.post(`/cases/${principalId}/invite-employee`, data),
  removeEmployee: (caseId) => api.patch(`/cases/${caseId}/remove-employee`),
};

// ── Employer / Employee canonical profiles (Phase 9) ───────────────────
// The sole read/write path for EmployerProfile/EmployeeProfile — see
// Backend/src/modules/employer-profile/ and employee-profile/. `fields` is
// a flat map of dot-paths into canonicalData, e.g. { legalName: "Acme Corp",
// "address.city": "San Francisco" }.
export const employerProfileApi = {
  get: (principalCaseId) => api.get(`/employer-profile/${principalCaseId}`),
  mySummary: () => api.get("/employer-profile/summary/me"),
  upsert: (principalCaseId, fields, source = "questionnaire") =>
    api.post(`/employer-profile/${principalCaseId}`, { fields, source }),
};

export const employeeProfileApi = {
  get: (caseId) => api.get(`/employee-profile/${caseId}`),
  upsert: (caseId, fields, source = "questionnaire") =>
    api.post(`/employee-profile/${caseId}`, { fields, source }),
};

// ── Single-party filings (COS / Extension / EAD / Reinstatement) ──────
// Third structural pattern alongside employment-workflow (employer/employee)
// and family-workflow (petitioner/beneficiary): exactly one applicant
// checklist, no second party, no invite.
export const singlePartyFilingsApi = {
  types: () => api.get("/single-party-filings/types"),
  create: (payload) => api.post("/single-party-filings/cases", payload),
};

// ── Profile extended ─────────────────────────────────
// Save intake assessment and recommended visa
profileApi.saveAssessment = (payload) =>
  api.put("/clients/me", { data: payload, completed: false, lastStep: 1 });
profileApi.selectPlan = (plan) =>
  api.put("/clients/me", { data: { selectedPlan: plan, planSelectedAt: new Date().toISOString() }, completed: false, lastStep: 1 });

// fetch() has no upload-progress API — XHR is the only browser primitive
// that exposes upload.onprogress, so file sends that need a progress bar
// go through this instead of the shared request() helper. Plain text-only
// sends keep using request()/fetch (and its 401-refresh-retry logic) since
// there's nothing to show progress for.
function uploadWithProgress(path, formData, { onProgress, signal } = {}) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${BASE_URL}${path}`);
    xhr.withCredentials = true;
    const token = tokenStore.getAccess();
    if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);

    xhr.upload.onprogress = (e) => {
      if (!e.lengthComputable || !onProgress) return;
      onProgress(Math.round((e.loaded / e.total) * 100));
    };

    xhr.onload = () => {
      let data;
      try { data = JSON.parse(xhr.responseText); } catch { data = null; }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(data);
      } else {
        const err = new Error(data?.message || "Request failed");
        err.status = xhr.status;
        reject(err);
      }
    };
    xhr.onerror = () => reject(new Error("Network error"));
    xhr.onabort = () => {
      const err = new Error("Upload canceled");
      err.code = "ERR_CANCELED";
      reject(err);
    };

    if (signal) {
      if (signal.aborted) { xhr.abort(); return; }
      signal.addEventListener("abort", () => xhr.abort());
    }

    xhr.send(formData);
  });
}

// ── Messages ─────────────────────────────────────────
export const messagesApi = {
  getThreads:       ()           => api.get("/messages"),
  getOrCreateThread:(caseId)     => api.get(`/messages/case/${caseId}`),
  getMessages:      (threadId, params = {}) => {
    const q = new URLSearchParams(params).toString();
    return api.get(`/messages/${threadId}${q ? "?" + q : ""}`);
  },
  getUnreadCount:   ()           => api.get("/messages/unread-count"),
  sendMessage:      (threadId, body, files = [], isInternalNote = false, { onProgress, signal } = {}) => {
    const fd = new FormData();
    fd.append("messageBody", body);
    fd.append("isInternalNote", String(isInternalNote));
    files.forEach((f) => fd.append("attachments", f));
    if (files.length > 0 && (onProgress || signal)) {
      return uploadWithProgress(`/messages/${threadId}`, fd, { onProgress, signal });
    }
    return api.post(`/messages/${threadId}`, fd);
  },
  // Returns the raw fetch Response (not JSON) — the server responds with the
  // file's own Content-Type, so the shared request() helper skips json()
  // parsing for us and hands the Response straight through.
  getAttachment:    (messageId, attachmentId) => api.get(`/messages/${messageId}/attachments/${attachmentId}`),
  typing:           (threadId, isTyping) => api.post(`/messages/conversations/${threadId}/typing`, { isTyping }),
};

// ── Presence ─────────────────────────────────────────
export const usersApi = {
  getPresence: (ids) => api.get(`/users/presence?ids=${ids.join(",")}`),
};

// ── Payments ───────────────────────────────────────
export const questionnairesApi = {
  getForCase: (caseId, params = {}) => {
    const q = new URLSearchParams(params).toString();
    return api.get(`/questionnaires/case/${caseId}${q ? "?" + q : ""}`);
  },
  listCaseChecklists: (caseId) => api.get(`/questionnaires/case/${caseId}/checklists`),
  getTemplate: (id) => api.get(`/questionnaires/${id}`),
  saveAnswer: (id, payload) => api.post(`/questionnaires/${id}/answers`, payload),
  saveFileAnswer: (id, payload, files = []) => {
    const fd = new FormData();
    Object.entries(payload || {}).forEach(([key, value]) => {
      if (value !== undefined && value !== null) fd.append(key, value);
    });
    files.forEach((file) => fd.append("files", file));
    return api.post(`/questionnaires/${id}/answers/files`, fd);
  },
  getProgress: (id, params = {}) => {
    const q = new URLSearchParams(params).toString();
    return api.get(`/questionnaires/${id}/progress${q ? "?" + q : ""}`);
  },
  submit: (id, payload) => api.post(`/questionnaires/${id}/submit`, payload),
  generateDocumentRequests: (id, payload) => api.post(`/questionnaires/${id}/document-requests`, payload),
};

export const paymentsApi = {
  summary: () => api.get("/payments/summary"),
  confirmCheckoutSession: (sessionId) => api.post("/payments/confirm-checkout-session", { sessionId }),

  // amount is in cents when opts.amountUnit === "cents"; otherwise dollars.
  createPartialCheckoutSession: (amount, opts = {}) =>
    api.post("/payments/create-partial-checkout-session", { amount, ...opts }),
  downloadReceipt: async (paymentId, transactionId) => {
    const response = await api.get(`/payments/${paymentId}/receipt/${transactionId}/download`);
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `payment-receipt-${transactionId}.pdf`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  },
};

// ── Referrals ───────────────────────────────────────
export const referralApi = {
  me: () => api.get("/referrals/me"),
  validate: (code) => api.get(`/referrals/validate/${encodeURIComponent(code)}`),
};

// ── Notifications ───────────────────────────────────
export const notificationsApi = {
  my: () => api.get("/notifications/me"),
  unreadCount: () => api.get("/notifications/unread-count"),
  markRead: (id) => api.put(`/notifications/${id}/read`, {}),
  markAllRead: () => api.put("/notifications/mark-all-read", {}),
  registerDevice: (token, { browser, platform } = {}) => api.post("/notifications/register-device", { token, browser, platform }),
  unregisterDevice: (token) => api.delete("/notifications/unregister-device", { token }),
  devices: () => api.get("/notifications/devices"),
  getPreferences: () => api.get("/notifications/preferences/me"),
  updatePreferences: (payload) => api.put("/notifications/preferences/me", payload),
};

// ── Admin ────────────────────────────────────────────
export const adminApi = {
  overview: () => api.get("/admin/overview"),
  users: (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return api.get(`/admin/users${q ? "?" + q : ""}`);
  },
  userDetail: (userId) => api.get(`/admin/users/${userId}`),
  toggleStatus: (userId) => api.put(`/admin/users/${userId}/toggle-status`),
  documents: () => api.get("/admin/documents"),
};
