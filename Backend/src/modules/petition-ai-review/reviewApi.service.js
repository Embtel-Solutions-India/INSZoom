// What the team can see and do with petition AI scans (Petition AI Review, Phase 4). Used by petitionAiReview.routes.js.
// Who: STAFF only (super admin, admin, team lead, case manager) who may access the case - the same rule as the petition review module, through the
// same case lookup (petition-review/petitionReview.data.js) and the same canAccessCase. A scan of another case, or of a case the person cannot
// access, is "not found" (404) / "not allowed" (403), never a hint of its content.
// Reads are small: the case list returns counts only; findings are paged (50 by default, at most 200); diagnostics are cut to the newest 50.
const { SCAN_STATUS, SEVERITIES, CATEGORIES, LIMITS } = require("./constants");
const { readPricing, costOf } = require("./pricing");

const STAFF_ROLES = new Set(["super_admin", "admin", "team_lead", "case_manager"]);
const PETITION_DOCUMENT_TYPE = "petition_manual_upload";
const idOf = (value) => String(value?._id || value || "");
const roleOf = (user) => String(user?.role || "").toLowerCase().replace(/[\s-]+/g, "_");
const refuse = (status, message) => Object.assign(new Error(message), { status });
// Token use and estimated cost of a scan (Phase 6). Older scans stored only calls / tokens: their split is 0 and the cost reads as unknown.
function usageView(usage = {}, pricing = readPricing()) {
  const split = { input: usage?.input || 0, output: usage?.output || 0, thinking: usage?.thinking || 0 };
  const known = split.input + split.output + split.thinking > 0;
  return {
    calls: usage?.calls || 0,
    tokens: usage?.tokens || 0,
    ...split,
    costUsd: known ? costOf(split, pricing) : null,
    pricing: { inputPerMillion: pricing.inputPerMillion, outputPerMillion: pricing.outputPerMillion },
  };
}
const isId = (value) => /^[a-f0-9]{24}$/i.test(String(value || ""));

/** Plain scan fields the screens use (never the lease / worker internals). */
function scanView(scan, { detail = false } = {}) {
  if (!scan) return null;
  const view = {
    id: idOf(scan._id),
    documentId: idOf(scan.documentId),
    documentName: scan.documentName || "",
    status: scan.status,
    trigger: scan.trigger,
    totalPages: scan.totalPages || 0,
    lastPage: scan.lastPage || 0,
    pagesDone: scan.pagesDone || 0,
    skippedFrom: scan.skippedFrom ?? null,
    counts: { error: scan.counts?.error || 0, warning: scan.counts?.warning || 0, info: scan.counts?.info || 0 },
    paused: scan.paused?.code ? { code: scan.paused.code, message: scan.paused.message || "", since: scan.paused.since || null } : null,
    error: scan.error?.code ? { code: scan.error.code, message: scan.error.message || "" } : null,
    nextAttemptAt: scan.nextAttemptAt || null,
    usedFallback: Boolean(scan.usedFallback),
    startedAt: scan.startedAt || null,
    finishedAt: scan.finishedAt || null,
    createdAt: scan.createdAt || null,
    updatedAt: scan.updatedAt || null,
  };
  if (!detail) return view;
  const byCategory = scan.summary?.byCategory instanceof Map ? Object.fromEntries(scan.summary.byCategory) : scan.summary?.byCategory || {};
  return {
    ...view,
    summary: { text: scan.summary?.text || "", byPage: scan.summary?.byPage || [], byCategory, points: scan.summary?.points || [], more: scan.summary?.more || 0, builtAt: scan.summary?.builtAt || null },
    gaps: (scan.gaps || []).map(({ from, to, reason }) => ({ from, to, reason })),
    diagnostics: (scan.diagnostics || []).slice(-50).map(({ from, to, outcome, finishReason, model, tokens, latencyMs, note, at }) => ({ from, to, outcome, finishReason, model, tokens, latencyMs, note, at })),
    usage: usageView(scan.usage),
    modelUsed: scan.modelUsed || "",
    modelVersion: scan.modelVersion || "",
  };
}

function findingView(finding) {
  return {
    id: idOf(finding._id),
    page: finding.page,
    severity: finding.severity,
    category: finding.category,
    excerpt: finding.excerpt || "",
    found: finding.found || "",
    suggestion: finding.suggestion || "",
    section: finding.section || "",
    confidence: finding.confidence ?? null,
  };
}

/**
 * deps: { Scan, Finding, Document, getCase(caseId), canAccessCase(user, caseData), handle() -> { scanService, worker } | null }
 */
function createReviewApi(deps = {}) {
  const Scan = deps.Scan || require("../../models/PetitionAiScan");
  const Finding = deps.Finding || require("../../models/PetitionAiFinding");
  const Document = deps.Document || require("../../models/Document");
  const getCase = deps.getCase || ((id) => require("../petition-review/petitionReview.data").getCase(id));
  const canAccessCase = deps.canAccessCase || ((user, caseData) => require("../cases/case.service").canAccessCase(user, caseData));
  const handle = deps.handle || (() => require("./index").getHandle());

  function running() {
    const live = handle();
    if (!live?.scanService) throw refuse(404, "AI review is switched off on this server.");
    return live;
  }

  async function assertStaffCase(user, caseId) {
    if (!STAFF_ROLES.has(roleOf(user))) throw refuse(403, "Only the case team can use AI review.");
    if (!isId(caseId)) throw refuse(404, "Case not found.");
    const caseData = await getCase(caseId);
    if (!caseData) throw refuse(404, "Case not found.");
    if (!canAccessCase(user, caseData)) throw refuse(403, "You do not have permission to access this case.");
    return caseData;
  }

  async function loadScan(user, scanId) {
    if (!isId(scanId)) throw refuse(404, "Scan not found.");
    const scan = await Scan.findById(scanId).select("-lease").lean();
    if (!scan) throw refuse(404, "Scan not found.");
    await assertStaffCase(user, scan.caseId);
    return scan;
  }

  /** The petitions of a case with their latest scan (counts only - no findings). */
  async function listForCase({ caseId, user }) {
    await assertStaffCase(user, caseId);
    const documents = await Document.find({ caseId, documentType: PETITION_DOCUMENT_TYPE, deletedAt: { $exists: false } }).select("_id originalName originalFileName createdAt").sort({ createdAt: -1 }).lean();
    if (!documents.length) return { enabled: Boolean(handle()?.scanService), petitions: [] };
    const scans = await Scan.find({ documentId: { $in: documents.map((doc) => doc._id) } }).select("-lease -diagnostics -summary -gaps -retryRanges").sort({ createdAt: -1 }).lean();
    const latest = new Map();
    for (const scan of scans) if (!latest.has(idOf(scan.documentId))) latest.set(idOf(scan.documentId), scan);
    return {
      enabled: Boolean(handle()?.scanService),
      petitions: documents.map((doc) => ({ documentId: idOf(doc._id), name: doc.originalName || doc.originalFileName || "", uploadedAt: doc.createdAt, scan: scanView(latest.get(idOf(doc._id))) })),
    };
  }

  async function getScan({ scanId, user }) {
    return scanView(await loadScan(user, scanId), { detail: true });
  }

  /** Paged findings of a scan: ?page=1&limit=50&severity=error&category=typo&fromPage=10&toPage=20 */
  async function listFindings({ scanId, user, query = {} }) {
    const scan = await loadScan(user, scanId);
    const limit = Math.min(LIMITS.findingsMaxPageSize, Math.max(1, Number.parseInt(query.limit, 10) || LIMITS.findingsPageSize));
    const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
    const filter = { scanId: scan._id };
    const severities = String(query.severity || "").split(",").map((s) => s.trim()).filter((s) => SEVERITIES.includes(s));
    const categories = String(query.category || "").split(",").map((c) => c.trim()).filter((c) => CATEGORIES.includes(c));
    if (severities.length) filter.severity = { $in: severities };
    if (categories.length) filter.category = { $in: categories };
    const fromPage = Number.parseInt(query.fromPage, 10);
    const toPage = Number.parseInt(query.toPage, 10);
    if (Number.isInteger(fromPage) || Number.isInteger(toPage)) filter.page = { ...(Number.isInteger(fromPage) ? { $gte: fromPage } : {}), ...(Number.isInteger(toPage) ? { $lte: toPage } : {}) };
    const [rows, total] = await Promise.all([
      Finding.find(filter).sort({ page: 1, severity: 1, _id: 1 }).skip((page - 1) * limit).limit(limit).lean(),
      Finding.countDocuments(filter),
    ]);
    return { findings: rows.map(findingView), pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) } };
  }

  /** A fresh scan of a petition from page 1 (the open one is returned if a scan is already running). */
  async function rescan({ caseId, documentId, user }) {
    const caseData = await assertStaffCase(user, caseId);
    if (!isId(documentId)) throw refuse(404, "This petition was not found on the case.");
    const document = await Document.findById(documentId).select("_id caseId documentType deletedAt originalName originalFileName").lean();
    if (!document || document.deletedAt || document.documentType !== PETITION_DOCUMENT_TYPE || idOf(document.caseId) !== idOf(caseData._id)) throw refuse(404, "This petition was not found on the case.");
    const live = running();
    const { scan, created } = await live.scanService.rescan({ caseId: caseData._id, documentId: document._id, documentName: document.originalName || document.originalFileName || "", requestedBy: user?._id || null, batchSize: require("./config").readConfig().pagesPerCall });
    if (created) live.worker?.kick?.();
    return { scan: scanView(scan), created };
  }

  /** Re-check a waiting scan now, or reopen a failed / cancelled one from the page it reached. */
  async function retry({ scanId, user }) {
    await loadScan(user, scanId);
    const live = running();
    const result = await live.scanService.retry(scanId);
    if (result.conflict) throw refuse(409, "This petition already has a scan running.");
    if (result.notRetryable) throw refuse(409, "This scan cannot be retried (it finished successfully).");
    live.worker?.kick?.();
    return { scan: scanView(result.scan), reopened: Boolean(result.reopened) };
  }

  async function cancel({ scanId, user }) {
    await loadScan(user, scanId);
    const live = running();
    const cancelled = await live.scanService.cancel(scanId);
    if (!cancelled) throw refuse(409, "This scan is not running.");
    return { scan: scanView(await Scan.findById(scanId).select("-lease").lean()) };
  }

  return { listForCase, getScan, listFindings, rescan, retry, cancel };
}

module.exports = { usageView, createReviewApi, scanView, findingView, STAFF_ROLES, SCAN_STATUS };
