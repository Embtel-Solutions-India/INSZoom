// BUG (fixed): silently falling back to a dev-only localhost URL shipped to
// production when a deployment's build environment never set VITE_API_URL
// (confirmed live: https://client.immiglance.com was calling
// http://localhost:7000/api/auth/register, which no real user's browser can
// ever reach). A dev fallback still makes sense locally (relative /api,
// proxied by Vite — see vite.config.js — also fixes a separate bug where an
// absolute cross-port URL made the refresh_token cookie cross-site and thus
// dropped under SameSite=Lax). In a PRODUCTION build with no VITE_API_URL,
// fail loudly and obviously instead: an unmistakable, clearly-broken host
// name is far faster to diagnose from a network tab or error monitoring
// than a silent, confusing CORS failure days after deploy.
const BASE_URL = import.meta.env.VITE_API_URL || (import.meta.env.DEV ? "/api" : (() => {
  console.error("[FATAL CONFIG] VITE_API_URL is not set in this production build — every API call will fail. Set it in the build server's environment before deploying.")
  return "https://MISSING-VITE_API_URL.invalid/api"
})())
export const API_BASE_URL = BASE_URL;

// Non-sensitive marker only ("do we have a session to try refreshing?") — the
// actual refresh token lives in an httpOnly cookie the backend sets on
// login/refresh, so JS never has access to it.
const HAS_SESSION_KEY = "immiglance_has_session";
const LEGACY_TOKEN_KEY = "immiglance_access_token";
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
const UPLOAD_TIMEOUT_MS = Number(import.meta.env.VITE_UPLOAD_TIMEOUT_MS) || 180000;
// Writes that do a lot of work on the server (adding an employee slot provisions its checklists and forms; switching an employee's workflow
// moves the file and sends the invitation) can take far longer than an ordinary request on a slow connection to the database. Giving up at
// 25 s does NOT stop the server - it finishes, and a retry would repeat the action - so these wait longer.
const LONG_REQUEST_TIMEOUT_MS = Number(import.meta.env.VITE_LONG_API_TIMEOUT_MS) || 120000;
const longRequest = () => ({ signal: AbortSignal.timeout(LONG_REQUEST_TIMEOUT_MS) });

async function request(path, options = {}, retry = true) {
  const headers = { ...options.headers };

  // A caller that sends raw bytes (chunked uploads) sets its own Content-Type.
  if (!(options.body instanceof FormData) && !headers["Content-Type"]) {
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
      window.dispatchEvent(new Event("immiglance:session-expired"));
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
      // An upload is limited by file size and connection speed, not by the short budget of an ordinary request: aborting it at 25 s
      // showed "took too long" although the server was still saving the file.
      signal: options.signal || AbortSignal.timeout(options.body instanceof FormData ? UPLOAD_TIMEOUT_MS : REQUEST_TIMEOUT_MS),
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
        window.dispatchEvent(new Event("immiglance:session-expired"));
        throw new Error("Session expired. Please log in again.");
      }
    }
    tokenStore.clear();
    window.dispatchEvent(new Event("immiglance:session-expired"));
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: "Request failed" }));
    // express-validator's `validate` middleware (Backend/src/middleware/
    // validate.js) always responds with the generic message "Validation
    // failed" plus an `errors` array holding the actual field-level reason
    // (e.g. "Password must contain a symbol") — reading only err.message
    // meant a real, specific validation error (like a password not meeting
    // the admin-configured complexity policy) always surfaced as an opaque
    // "Validation failed" with no indication of what to fix.
    const specificMessage = Array.isArray(err.errors) && err.errors.length ? err.errors.map((item) => item.msg).filter(Boolean).join(" ") : "";
    const error = new Error(specificMessage || err.message || "Request failed");
    error.status = res.status;
    if (err.code) error.code = err.code;
    error.data = err; // the full error body (e.g. a 409's `missingChunks` list)
    throw error;
  }

  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("application/json")) return res.json();
  return res;
}

export const api = {
  get: (path, options) => request(path, { method: "GET", ...options }),
  post: (path, body, options) =>
    request(path, {
      method: "POST",
      body: body instanceof FormData ? body : JSON.stringify(body),
      ...options,
    }),
  put: (path, body) =>
    request(path, {
      method: "PUT",
      body: body instanceof FormData ? body : JSON.stringify(body),
    }),
  patch: (path, body, options) =>
    request(path, {
      method: "PATCH",
      body: body instanceof FormData ? body : JSON.stringify(body),
      ...options,
    }),
  delete: (path, body) =>
    request(path, {
      method: "DELETE",
      ...(body !== undefined ? { body: body instanceof FormData ? body : JSON.stringify(body) } : {}),
    }),
};

// Axios-shaped adapter over request() for utils/chunkedUpload.js, which was written for an axios `api`
// (baseURL ending in /api; get/post/put/delete resolving { data }). It reuses request()'s auth + token refresh and
// adds what chunk traffic needs: an AbortSignal, raw Blob bodies, and no 25 s timeout for the chunk/complete calls
// (those get CHUNK_TIMEOUT_MS instead). Failures are thrown axios-shaped (error.response.status / .data,
// error.cancelled for an abort) so the helper's retry and 409 CHUNKS_MISSING handling work unchanged.
const CHUNK_TIMEOUT_MS = 10 * 60 * 1000;

async function chunkRequest(method, path, body, { signal, headers, timeout } = {}) {
  const budget = AbortSignal.timeout(timeout === 0 ? CHUNK_TIMEOUT_MS : REQUEST_TIMEOUT_MS);
  const combined = signal ? (AbortSignal.any ? AbortSignal.any([signal, budget]) : signal) : budget;
  const isRaw = typeof Blob !== "undefined" && body instanceof Blob;
  try {
    const data = await request(path, {
      method,
      signal: combined,
      headers,
      ...(body === undefined ? {} : { body: isRaw ? body : JSON.stringify(body) }),
    });
    return { data, status: 200 };
  } catch (error) {
    if (signal?.aborted) {
      const cancelled = new Error("Upload cancelled");
      cancelled.name = "AbortError";
      cancelled.code = "ERR_CANCELED";
      cancelled.cancelled = true;
      throw cancelled;
    }
    if (error.status) error.response = { status: error.status, data: error.data || { message: error.message } };
    throw error;
  }
}

export const chunkApi = {
  get: (path, config) => chunkRequest("GET", path, undefined, config),
  post: (path, body, config) => chunkRequest("POST", path, body, config),
  put: (path, body, config) => chunkRequest("PUT", path, body, config),
  delete: (path, config) => chunkRequest("DELETE", path, undefined, config),
};

// ── Auth ────────────────────────────────────────────
export const authApi = {
  register: (displayName, email, password, referralCode, phone, accountType = "client", sessionId) =>
    api.post("/auth/register", { displayName, email, password, referralCode, phone, accountType, sessionId }),
  login: (emailOrPayload, password) => api.post(
    "/auth/login",
    typeof emailOrPayload === "object" && emailOrPayload !== null
      ? emailOrPayload
      : { email: emailOrPayload, password }
  ),
  // Email-first login step's UX hint ONLY — login() above independently and
  // fully validates the real credential regardless of what this returns.
  checkEmail: (email) => api.post("/auth/check-email", { email }),
  googleToken: (idToken) => api.post("/auth/google-token", { idToken }),
  logout: () => api.post("/auth/logout", {}),
  me: () => api.get("/auth/me"),
  savePreferences: (preferences) => api.patch("/auth/me/preferences", preferences),
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

// Family/sponsor visa (I-130/Green Card, K-1/K-3) two-party path — mirrors
// employmentWorkflowApi's shape under separate field names.
export const familyWorkflowApi = {
  submit: (caseId, target) => api.post(`/family-workflow/${caseId}/submit`, { target }),
  // The petitioner's own "invite my beneficiary" / "I'll fill it myself"
  // choice, made from their own dashboard (Backend's
  // family-workflow.controller.js's setFamilyCompletionMode - same
  // canAccessFamilyCase gate as the case-creation flow, no staff action
  // needed for either branch).
  setCompletionMode: (caseId, payload) => api.post(`/family-workflow/${caseId}/completion-mode`, payload),
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
      participantId: context.participantId,
      legacySource: "Immiglance",
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
    // chunks stay small so no single request exceeds what a hosting proxy accepts (413 above ~5 MB)
    const chunkSize = 700 * 1024;
    if (file.size <= 700 * 1024) {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("category", category);
      formData.append("documentType", documentType);
      formData.append("legacySource", "Immiglance");
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
  // Which of this case's actual, currently-applicable checklist documents
  // Smart Scan (SmartScanStep.jsx) can offer to scan — backend intersects
  // the case's real file-type checklist questions against the OCR-capable
  // document-type allowlist, so this is never a static/hardcoded list here.
  caseScanOptions: (caseId) => api.get(`/document-intelligence/case/${caseId}/scan-options`),
  // Smart Scan offers whatever caseScanOptions() above returns for this
  // case — no longer just resume/passport (that was true before the
  // document-intelligence field-mapping expansion; AUTOFILL_DOCUMENT_TYPES
  // on the backend now covers most H-1B/L-1A/K-1/K-3 checklist documents).
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
  // Fire-and-forget autosave after every answered step — never blocks the
  // quiz's own step transition on a slow/failed network call.
  draft: (payload) => api.post("/eligibility-quiz/draft", payload).catch(() => null),
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
  myPipeline: () => api.get("/cases/my/pipeline"),
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

  // EB-1A criterion-grouped checklist
  getEb1aCriteria: (caseId) => api.get(`/cases/${caseId}/eb1a-criteria`),
  updateEb1aCriterion: (caseId, criterionId, payload) =>
    api.put(`/cases/${caseId}/eb1a-criteria/${criterionId}`, payload),
  updateEb1aFinalMerits: (caseId, payload) =>
    api.put(`/cases/${caseId}/final-merits`, payload),

  // Plan
  updatePlan: (caseId, payload) => api.put(`/cases/${caseId}/plan`, payload),
  signDeclaration: (caseId, payload) => api.put(`/cases/${caseId}/sign-declaration`, payload),

  // Assessment
  saveAssessment: (caseId, payload) =>
    api.put(`/cases/${caseId}/assessment`, payload),

  // Phase 9 — caseRole=principal/employee/beneficiary child-Case
  // architecture. Distinct from employmentWorkflowApi above, which is the
  // older employerUser/employeeUser-on-one-Case architecture.
  // scope: "children" = just the principal/child links (what the Employees dashboard reads and polls) instead of every related record
  getRelated: (id, { scope } = {}) => api.get(`/cases/${id}/related${scope ? `?scope=${encodeURIComponent(scope)}` : ""}`),
  setDataEntryMode: (principalId, mode) =>
    api.patch(`/cases/${principalId}/data-entry-mode`, { mode }),
  // Per-employee workflow: { mode: "fill_self" } revokes an invitation, { mode: "invite", employeeName, employeeEmail } invites.
  setEmployeeDataEntryMode: (principalId, childCaseId, payload) =>
    api.patch(`/cases/${principalId}/employees/${childCaseId}/data-entry-mode`, payload, longRequest()),
  inviteEmployee: (principalId, data) =>
    api.post(`/cases/${principalId}/invite-employee`, data, longRequest()),
  removeEmployee: (caseId) => api.patch(`/cases/${caseId}/remove-employee`, undefined, longRequest()),
  resendEmployeeInvite: (principalId, childCaseId) =>
    api.post(`/cases/${principalId}/resend-employee-invite`, { childCaseId }, longRequest()),
  addEmployeeSlot: (principalId, payload = {}) =>
    api.post(`/cases/${principalId}/add-employee-slot`, payload, longRequest()),
  // Who an employee case is: { name?, email? }. Staff write the same fields from Admin, so each side sees what the other typed.
  setEmployeeIdentity: (principalId, childCaseId, payload) =>
    api.patch(`/cases/${principalId}/employees/${childCaseId}/identity`, payload),
  employeeVisaOptions: () => api.get("/cases/employee-visa-options"),
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
async function uploadWithProgress(path, formData, { onProgress, signal } = {}) {
  // A long chunked upload can outlive the access token; get a fresh one before the final send.
  if (!tokenStore.getAccess() && tokenStore.hasSession()) {
    if (!refreshPromise) refreshPromise = refreshAccessToken().finally(() => { refreshPromise = null; });
    try { await refreshPromise; } catch { /* the send below fails with a 401 and surfaces it */ }
  }
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
    xhr.onerror = () => {
      const err = new Error("Network error");
      err.isNetworkError = true; // the request never got an answer - safe to retry (same as request()'s fetch failure)
      reject(err);
    };
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
  // `clientMessageId` identifies one send across automatic retries: the backend returns the already-stored message for a repeated
  // (sender, clientMessageId) instead of posting it twice.
  // `files` ride along as multipart (small ones); `uploadIds` reference big files already staged through chunkApi.
  sendMessage:      (threadId, body, files = [], isInternalNote = false, { onProgress, signal, clientMessageId, uploadIds = [], replyTo } = {}) => {
    const fd = new FormData();
    fd.append("messageBody", body);
    fd.append("isInternalNote", String(isInternalNote));
    if (clientMessageId) fd.append("clientMessageId", clientMessageId);
    if (replyTo) fd.append("replyTo", replyTo); // same FormData field the Admin portal uses
    if (uploadIds.length > 0) fd.append("uploadIds", JSON.stringify(uploadIds));
    files.forEach((f) => fd.append("attachments", f));
    if (files.length > 0 && (onProgress || signal)) {
      return uploadWithProgress(`/messages/${threadId}`, fd, { onProgress, signal });
    }
    return api.post(`/messages/${threadId}`, fd, signal ? { signal } : undefined);
  },
  // Returns the raw fetch Response (not JSON) — the server responds with the
  // file's own Content-Type, so the shared request() helper skips json()
  // parsing for us and hands the Response straight through.
  // `options.signal` lets the viewer abort a big download when it is closed.
  getAttachment:    (messageId, attachmentId, options) => api.get(`/messages/${messageId}/attachments/${attachmentId}`, options),
  typing:           (threadId, isTyping) => api.post(`/messages/conversations/${threadId}/typing`, { isTyping }),
  // Sender-only. Edit replaces the text (the message keeps its place and gains `editedAt`); delete-for-everyone wipes the
  // text/attachments/reactions but leaves the bubble in the thread with `deletedForEveryoneAt` set.
  editMessage:      (messageId, messageBody) => api.put(`/messages/${messageId}`, { messageBody }),
  deleteMessageForEveryone: (messageId) => api.delete(`/messages/${messageId}/everyone`),
};

// ── Presence ─────────────────────────────────────────
export const usersApi = {
  getPresence: (ids) => api.get(`/users/presence?ids=${ids.join(",")}`),
};

// ── Payments ───────────────────────────────────────
const ANSWER_FILE_DIRECT_LIMIT = 700 * 1024;
const ANSWER_FILE_CHUNK_SIZE = 700 * 1024;
const ANSWER_FILE_PARALLEL_CHUNKS = 4;
async function uploadAnswerFileInChunks(id, payload, file) {
  const created = await api.post(`/questionnaires/${id}/answers/files/sessions`, {
    originalName: file.name,
    mimeType: file.type || "application/octet-stream",
    expectedSize: file.size,
    chunkSize: ANSWER_FILE_CHUNK_SIZE,
  });
  const session = created.session || created.data?.session;
  // Several chunks go up at the same time (each one is a separate small request, so a proxy's body limit is never reached); a failed chunk is retried.
  let nextChunk = 0;
  let failure = null;
  const sendChunks = async () => {
    while (!failure && nextChunk < session.totalChunks) {
      const index = nextChunk;
      nextChunk += 1;
      const start = index * session.chunkSize;
      const chunk = file.slice(start, Math.min(start + session.chunkSize, file.size), file.type);
      let lastError;
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        try {
          const fd = new FormData();
          fd.append("chunk", chunk, file.name);
          await api.put(`/questionnaires/${id}/answers/files/sessions/${session.uploadId}/chunks/${index}`, fd);
          lastError = null;
          break;
        } catch (error) {
          lastError = error;
          if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 500));
        }
      }
      if (lastError) { failure = lastError; return; }
    }
  };
  await Promise.all(Array.from({ length: Math.min(ANSWER_FILE_PARALLEL_CHUNKS, session.totalChunks) }, sendChunks));
  if (failure) throw failure;
  return api.post(`/questionnaires/${id}/answers/files/sessions/${session.uploadId}/complete`, payload || {});
}

export const questionnairesApi = {
  // after Save progress: tells the case's case manager (email, throttled server-side). Never blocks or fails a save.
  notifyProgressSaved: (caseId, body = {}) => api.post(`/questionnaires/case/${caseId}/progress-saved`, body),
  getForCase: (caseId, params = {}) => {
    const q = new URLSearchParams(params).toString();
    return api.get(`/questionnaires/case/${caseId}${q ? "?" + q : ""}`);
  },
  listCaseChecklists: (caseId) => api.get(`/questionnaires/case/${caseId}/checklists`),
  getTemplate: (id) => api.get(`/questionnaires/${id}`),
  saveAnswer: (id, payload) => api.post(`/questionnaires/${id}/answers`, payload),
  // Files up to ANSWER_FILE_DIRECT_LIMIT go up in one multipart request. Larger ones (up to the 50 MB limit) are sent in small chunks so no single
  // request exceeds what a hosting proxy accepts (a 413 "Request Entity Too Large" above ~5 MB), then assembled and saved by the server.
  saveFileAnswer: async (id, payload, files = []) => {
    const small = files.filter((file) => file.size <= ANSWER_FILE_DIRECT_LIMIT);
    const large = files.filter((file) => file.size > ANSWER_FILE_DIRECT_LIMIT);
    let result;
    if (small.length || !large.length) {
      const fd = new FormData();
      Object.entries(payload || {}).forEach(([key, value]) => {
        if (value !== undefined && value !== null) fd.append(key, value);
      });
      small.forEach((file) => fd.append("files", file));
      result = await api.post(`/questionnaires/${id}/answers/files`, fd);
    }
    for (const file of large) result = await uploadAnswerFileInChunks(id, payload, file);
    return result;
  },
  // Removes ONE entry (by storageKey) from a file question's answer.
  removeAnswerFile: (id, payload) => api.delete(`/questionnaires/${id}/answers/files`, payload),
  getProgress: (id, params = {}) => {
    const q = new URLSearchParams(params).toString();
    return api.get(`/questionnaires/${id}/progress${q ? "?" + q : ""}`);
  },
  submit: (id, payload) => api.post(`/questionnaires/${id}/submit`, payload),
  // Opens one stored answer file in a new tab (read-only view of an invited employee's documents). The download route authorizes
  // against the answer's own case, so this works for exactly the people allowed to read that file.
  viewAnswerFile: async (id, { responseId, questionKey, storageKey }) => {
    // the tab opens on the click itself (a tab opened after a slow download is blocked by the browser); the file is loaded into it later
    const tab = window.open("", "_blank");
    if (tab) { try { tab.opener = null; tab.document.body.innerText = "Opening document…"; } catch { /* cosmetic only */ } }
    try {
      const query = new URLSearchParams({ responseId, questionKey, storageKey, inline: "true" }).toString();
      const response = await api.get(`/questionnaires/${id}/answers/files/download?${query}`);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      if (tab) tab.location.href = url; else window.open(url, "_blank", "noopener");
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (error) {
      if (tab) tab.close();
      throw error;
    }
  },
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
