const crypto = require("crypto");
const AIJob = require("../../models/AIJob");
const AIProviderConfig = require("../../models/AIProviderConfig");
const AuditLog = require("../../models/AuditLog");
const User = require("../../models/User");
const providerRegistry = require("./ai-provider.registry");
const promptService = require("./ai-prompt.service");
const contextService = require("./ai-context.service");
const searchService = require("../search/search.service");
const TaskManagementService = require("../case-collaboration/services/TaskManagementService");
const caseService = require("../cases/case.service");
const { normalizeRole } = require("../authorization/roleHierarchy");
const logger = require("../../utils/logger");

// Bounds how many recovered AI jobs run concurrently per recovery tick —
// mirrors document-intelligence.queue.js's DOCUMENT_INTELLIGENCE_CONCURRENCY
// pattern rather than introducing a new queue: each of these jobs calls out
// to an LLM provider and builds a full case context bundle, so dispatching
// all 20 recovered jobs at once (the old behavior) meant up to 20 concurrent
// model calls plus their DB/context work competing for the same pool.
const AI_JOB_RECOVERY_CONCURRENCY = Math.max(1, Number(process.env.AI_JOB_RECOVERY_CONCURRENCY || 3));

const cache = new Map();
const rateWindows = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000;

function hash(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function redact(value = "") {
  return String(value)
    .replace(/\b\d{3}-\d{2}-\d{4}\b/g, "***-**-****")
    .replace(/\b(?=[A-Z0-9]{7,12}\b)(?=[A-Z0-9]*[A-Z])(?=[A-Z0-9]*\d)[A-Z0-9]+\b/g, (match) => `${match.slice(0, 2)}***${match.slice(-2)}`)
    .slice(0, 500);
}

function redactSensitiveObject(value, key = "") {
  if (value == null) return value;
  if (Array.isArray(value)) return value.map((item) => redactSensitiveObject(item, key));
  if (typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([childKey, childValue]) => [childKey, redactSensitiveObject(childValue, childKey)]));
  }
  if (/(ssn|socialsecurity|passport|aliennumber|anumber|bankaccount|routingnumber)/i.test(key.replace(/[^a-z]/gi, ""))) return "[REDACTED]";
  return value;
}

function rateLimit(userId, limit = 30) {
  const key = String(userId);
  const now = Date.now();
  const window = (rateWindows.get(key) || []).filter((timestamp) => timestamp > now - 60000);
  if (window.length >= limit) throw Object.assign(new Error("AI request rate limit exceeded"), { status: 429, code: "AI_RATE_LIMIT" });
  window.push(now);
  rateWindows.set(key, window);
}

function deterministicFindings(bundle) {
  const now = new Date();
  const expiredDocuments = bundle.documents.filter((document) => document.expiryDate && new Date(document.expiryDate) < now);
  const overdueTasks = bundle.tasks.filter((task) => task.dueDate && new Date(task.dueDate) < now && task.status !== "completed");
  const incompleteForms = bundle.forms.filter((form) => !["approved", "ready_for_pdf", "generated", "locked", "filed"].includes(form.status));
  return {
    missingCanonicalFields: bundle.canonical.validation?.missingFields || bundle.canonical.profile?.missingFields || [],
    canonicalConflicts: bundle.canonical.conflicts?.filter((conflict) => !conflict.resolved) || [],
    missingEvidence: bundle.evidence.missing || [],
    weakEvidence: (bundle.evidence.requirements || []).filter((item) => item.strongestScore > 0 && item.strongestScore < 50),
    expiredDocuments: expiredDocuments.map((document) => ({ documentId: document._id, name: document.originalName, expiryDate: document.expiryDate })),
    incompleteForms: incompleteForms.map((form) => ({ formId: form._id, formCode: form.formCode, status: form.status, completion: form.completion })),
    overdueTasks: overdueTasks.map((task) => ({ taskId: task._id, title: task.title, dueDate: task.dueDate })),
  };
}

function suggestionList(output) {
  return output.suggestions || output.suggestedNextSteps || output.recommendations || [];
}

async function audit(job, action, user, metadata = {}, req) {
  job.auditHistory.push({ action, performedBy: user?._id, metadata });
  await AuditLog.create({
    userId: user?._id,
    action,
    entityType: "ai_job",
    entityId: String(job._id),
    changes: metadata,
    ipAddress: req?.ip,
    userAgent: req?.headers?.["user-agent"],
    description: `${action} ${job.jobType}`,
  }).catch(() => null);
}

async function createJob(jobType, payload, user) {
  return AIJob.create({
    jobType,
    caseId: payload.caseId,
    requestedBy: user._id,
    status: "queued",
    input: {
      question: payload.question ? redact(payload.question) : undefined,
      entities: payload.entities,
      filters: payload.filters,
      focus: payload.focus,
      artifactType: payload.artifactType,
      templateInstructions: payload.templateInstructions,
    },
    maxAttempts: Number(payload.maxAttempts || 3),
    expiresAt: payload.retain === true ? undefined : new Date(Date.now() + 180 * 24 * 60 * 60 * 1000),
    auditHistory: [{ action: "queued", performedBy: user._id }],
  });
}

async function callModel(job, promptKey, variables, user, req) {
  const template = await promptService.resolve(promptKey, user);
  const providerConfig = await providerRegistry.resolve(template.providerKey, user);
  const safeVariables = providerConfig.privacy?.sendSensitiveData === false ? redactSensitiveObject(variables) : variables;
  const rendered = promptService.render(template, safeVariables);
  const characterCount = rendered.systemPrompt.length + rendered.userPrompt.length;
  if (characterCount > Number(providerConfig.limits?.maxInputCharacters || 120000)) {
    throw Object.assign(new Error("AI request exceeds the configured provider input limit"), { status: 413, code: "AI_INPUT_LIMIT" });
  }
  rateLimit(user._id, providerConfig.limits?.requestsPerMinute || 30);
  const promptHash = hash(`${user._id}:${job.caseId || ""}:${template._id}:${rendered.systemPrompt}:${rendered.userPrompt}`);
  const cached = cache.get(promptHash);
  job.promptTemplate = template._id;
  job.promptKey = template.key;
  job.promptVersion = template.version;
  job.promptHash = promptHash;
  job.promptMetadata = {
    variableKeys: Object.keys(variables),
    redactedPreview: redact(variables.question || `${job.jobType} request`),
    characterCount,
  };
  if (cached && cached.expiresAt > Date.now()) {
    job.usage.cacheHit = true;
    return cached.output;
  }
  const response = await providerRegistry.generate({
    providerKey: template.providerKey,
    systemPrompt: rendered.systemPrompt,
    userPrompt: rendered.userPrompt,
    temperature: template.modelSettings?.temperature,
    maxOutputTokens: template.modelSettings?.maxOutputTokens,
    responseFormat: template.modelSettings?.responseFormat || "json",
    outputSchema: template.outputSchema,
  }, user);
  job.providerKey = response.providerKey;
  job.provider = response.provider;
  job.model = response.model;
  const currentUsage = job.usage?.toObject ? job.usage.toObject() : (job.usage || {});
  job.usage = { ...currentUsage, ...response.usage };
  cache.set(promptHash, { output: response.data, expiresAt: Date.now() + CACHE_TTL_MS });
  return response.data;
}

async function execute(job, user, req) {
  job.status = "processing";
  job.startedAt = new Date();
  job.attempts += 1;
  await audit(job, "processing", user, {}, req);
  await job.save();
  try {
    let output;
    if (job.jobType === "semantic_search") {
      const interpretation = await callModel(job, "semantic_search", {
        question: job.input.question,
        entities: ["cases", "documents", "messages", "questionnaires", "uscis_forms", "tasks", "clients", "companies"],
      }, user, req);
      const results = await searchService.globalSearch({
        query: interpretation.searchQuery || job.input.question,
        entities: interpretation.entities || job.input.entities || [],
        filters: { ...(job.input.filters || {}), ...(interpretation.filters || {}) },
        source: "natural_language",
        limit: 25,
      }, user, req);
      output = { interpretation, results };
    } else {
      const bundle = await contextService.build(job.caseId, user, req);
      const findings = deterministicFindings(bundle);
      if (job.jobType === "copilot") {
        output = await callModel(job, "case_copilot", { question: job.input.question, context: bundle.context }, user, req);
      } else if (job.jobType === "case_review" || job.jobType === "ocr_review" || job.jobType === "data_quality") {
        output = await callModel(job, "case_review", { context: bundle.context, findings }, user, req);
        output.deterministicFindings = findings;
      } else if (job.jobType === "task_suggestions") {
        output = await callModel(job, "task_suggestions", { context: bundle.context, findings }, user, req);
        output.deterministicFindings = findings;
      } else if (job.jobType === "draft") {
        output = await callModel(job, "legal_draft", {
          artifactType: job.input.artifactType,
          focus: job.input.focus || "",
          templateInstructions: job.input.templateInstructions || "",
          context: bundle.context,
        }, user, req);
      } else {
        throw Object.assign(new Error(`Unsupported AI job type: ${job.jobType}`), { status: 422 });
      }
    }
    job.output = output;
    job.confidence = Number(output.confidence || output.interpretation?.confidence || 0);
    job.citations = output.citations || [];
    job.suggestions = suggestionList(output);
    job.status = "completed";
    job.completedAt = new Date();
    await audit(job, "completed", user, { confidence: job.confidence, suggestions: job.suggestions.length }, req);
    await job.save();
    return job;
  } catch (error) {
    const retryable = error.retryable !== false && (error.status === 429 || error.status >= 500 || error.name === "AbortError");
    job.status = retryable && job.attempts < job.maxAttempts ? "queued" : "failed";
    job.nextAttemptAt = job.status === "queued" ? new Date(Date.now() + Math.min(60000, 1000 * (2 ** job.attempts))) : undefined;
    job.error = { code: error.code || "AI_EXECUTION_FAILED", message: error.message, retryable };
    await audit(job, "failed", user, { code: job.error.code, retryable }, req);
    await job.save();
    throw error;
  }
}

async function run(jobType, payload, user, req, background = false) {
  const job = await createJob(jobType, payload, user);
  if (background) {
    setImmediate(() => execute(job, user, req).catch(() => null));
    return job;
  }
  return execute(job, user, req);
}

async function listJobs(query, user) {
  const filter = {};
  if (query.caseId) {
    await caseService.getAccessibleCaseOrThrow(query.caseId, user);
    filter.caseId = query.caseId;
  } else if (!["super_admin", "admin"].includes(normalizeRole(user.role))) {
    filter.requestedBy = user._id;
  }
  if (query.jobType) filter.jobType = query.jobType;
  if (query.status) filter.status = query.status;
  return AIJob.find(filter).populate("requestedBy", "name displayName email role").sort({ createdAt: -1 }).limit(Math.min(Number(query.limit || 100), 500));
}

async function review(jobId, payload, user, req) {
  const job = await AIJob.findById(jobId);
  if (!job) throw Object.assign(new Error("AI job not found"), { status: 404 });
  if (job.caseId) await contextService.build(job.caseId, user, req);
  else if (String(job.requestedBy) !== String(user._id) && !["super_admin", "admin"].includes(normalizeRole(user.role))) throw Object.assign(new Error("AI job access denied"), { status: 403 });
  job.review = {
    status: payload.status,
    reviewedBy: user._id,
    reviewedAt: new Date(),
    notes: payload.notes,
    approvedSuggestionIndexes: payload.approvedSuggestionIndexes || [],
  };
  await audit(job, "reviewed", user, { status: payload.status, approvedSuggestionIndexes: payload.approvedSuggestionIndexes }, req);
  await job.save();
  return job;
}

function assigneeForRole(caseData, role) {
  return {
    client: caseData.user,
    case_manager: caseData.assignedCaseManager,
    attorney: caseData.assignedAttorney,
    team_lead: caseData.assignedTeamLead,
    professor: caseData.assignedProfessor,
    finance: caseData.assignedFinance,
  }[role];
}

function taskCategory(value) {
  const allowed = new Set(["case_preparation", "document_review", "legal_review", "expert_letter", "filing", "rfe_response", "follow_up", "administrative", "finance", "client_communication", "renewal", "deadline", "escalation", "approval", "automation", "other"]);
  return allowed.has(value) ? value : "case_preparation";
}

async function applyTaskSuggestions(jobId, payload, user, req) {
  const job = await AIJob.findById(jobId);
  if (!job || job.jobType !== "task_suggestions") throw Object.assign(new Error("Task suggestion job not found"), { status: 404 });
  const bundle = await contextService.build(job.caseId, user, req);
  if (!["super_admin", "admin", "team_lead", "case_manager", "attorney"].includes(normalizeRole(user.role))) throw Object.assign(new Error("Task approval permission denied"), { status: 403 });
  const indexes = payload.approvedSuggestionIndexes || [];
  const created = [];
  for (const index of indexes) {
    const suggestion = job.suggestions[index];
    if (!suggestion) continue;
    const dueDate = suggestion.dueInDays ? new Date(Date.now() + Number(suggestion.dueInDays) * 86400000) : undefined;
    created.push(await TaskManagementService.create(bundle.caseData, {
      title: suggestion.title,
      description: suggestion.description || suggestion.reason,
      priority: ["low", "medium", "high", "urgent"].includes(suggestion.priority) ? suggestion.priority : "medium",
      category: taskCategory(suggestion.category),
      assignedTo: assigneeForRole(bundle.caseData, suggestion.assignedRole) || bundle.caseData.assignedCaseManager || user._id,
      dueDate,
      tags: ["ai-suggested", job.jobType],
    }, user, req));
  }
  job.review = { status: indexes.length === job.suggestions.length ? "approved" : "partially_approved", reviewedBy: user._id, reviewedAt: new Date(), notes: payload.notes, approvedSuggestionIndexes: indexes };
  await audit(job, "suggestions_applied", user, { createdTaskIds: created.map((task) => task._id), indexes }, req);
  await job.save();
  return { job, tasks: created };
}

async function usage(query = {}) {
  const match = {};
  if (query.from || query.to) {
    match.createdAt = {};
    if (query.from) match.createdAt.$gte = new Date(query.from);
    if (query.to) match.createdAt.$lte = new Date(query.to);
  }
  return AIJob.aggregate([
    { $match: match },
    { $group: { _id: { provider: "$provider", model: "$model", jobType: "$jobType" }, requests: { $sum: 1 }, inputTokens: { $sum: "$usage.inputTokens" }, outputTokens: { $sum: "$usage.outputTokens" }, totalTokens: { $sum: "$usage.totalTokens" }, estimatedCost: { $sum: "$usage.estimatedCost" }, averageLatencyMs: { $avg: "$usage.latencyMs" }, failures: { $sum: { $cond: [{ $eq: ["$status", "failed"] }, 1, 0] } } } },
    { $sort: { requests: -1 } },
  ]);
}

async function listProviders(user) {
  await providerRegistry.ensureDefaults(user);
  return AIProviderConfig.find().select("-metadata.secret -metadata.apiKey").sort({ isDefault: -1, displayName: 1 });
}

async function updateProvider(key, payload, user) {
  if (payload.isDefault) await AIProviderConfig.updateMany({ key: { $ne: key } }, { $set: { isDefault: false } });
  return AIProviderConfig.findOneAndUpdate({ key }, { ...payload, key, updatedBy: user._id }, { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }).select("-metadata.secret -metadata.apiKey");
}

async function recoverQueuedJobs() {
  const candidates = await AIJob.find({ status: "queued", $or: [{ nextAttemptAt: { $exists: false } }, { nextAttemptAt: { $lte: new Date() } }] })
    .select("_id requestedBy")
    .limit(20)
    .lean();
  let active = 0;
  let index = 0;
  await new Promise((resolve) => {
    const launchNext = () => {
      if (index >= candidates.length && active === 0) return resolve();
      while (active < AI_JOB_RECOVERY_CONCURRENCY && index < candidates.length) {
        const candidate = candidates[index];
        index += 1;
        active += 1;
        recoverOne(candidate).finally(() => {
          active -= 1;
          launchNext();
        });
      }
    };
    launchNext();
  });
}

async function recoverOne(candidate) {
  // Atomic claim: without this, two recovery ticks (this process racing a
  // second setInterval fire — normally excluded by withJobLock, but that
  // guard only spans one process — or a second backend instance's own tick,
  // if this app is ever run as more than one instance) could both match the
  // same "queued" job from the find() above and both dispatch execute() on
  // it concurrently. A plain find() + status flip only inside execute()'s own
  // save() isn't atomic; this findOneAndUpdate is, since it only succeeds if
  // the job is *still* "queued" at the moment of the write.
  const job = await AIJob.findOneAndUpdate(
    { _id: candidate._id, status: "queued" },
    { $set: { status: "processing" } },
    { new: true }
  );
  if (!job) return; // already claimed by another tick/instance
  const user = await User.findById(job.requestedBy);
  if (!user) {
    // Previously left silently "queued" forever when requestedBy no longer
    // resolved to a user — an unrecoverable job that got rescanned and
    // reconsidered on every future tick indefinitely. Terminal "failed"
    // status (same field/semantics execute()'s own catch block already uses)
    // stops that.
    job.status = "failed";
    job.error = { code: "AI_JOB_USER_NOT_FOUND", message: "Requesting user no longer exists" };
    await job.save().catch((error) => logger.error("ai_job_recovery_save_failed", { jobId: job._id, error }));
    return;
  }
  await execute(job, user, null).catch(() => null);
}

module.exports = { applyTaskSuggestions, deterministicFindings, listJobs, listProviders, recoverQueuedJobs, review, run, updateProvider, usage };
