// Phase 5 governance: ONE read-only answer to "where is this form": the status of each stage (import, mapping, coverage, certification, release gate, edition policy,
// monitoring), the pipeline timeline of its latest job, the mapping edges its newest edition lost, and why it is degraded or held. Nothing here writes or changes a form.
// Every state is one of ok | warning | blocked | unknown; an error while reading one part makes only that part "unknown".
const { classify } = require("../form-release/certPolicy");

const MONITOR_FRESH_MS = 3 * 86400000;
const iso = (value) => (value ? new Date(value).toISOString() : null);
const unknown = (detail) => ({ state: "unknown", detail });

function defaultDeps() {
  return {
    Template: require("../../models/USCISFormTemplate"),
    MappingVersion: require("../../models/USCISMappingVersion"),
    Job: require("../../models/FormPipelineJob"),
    Report: require("../../models/FormMigrationReport"),
    releaseGate: require("../form-release/ReleaseGate"),
    peekAcceptance: (template) => require("../form-edition-policy/EditionPolicyEnforcer").peekAcceptance(template),
    now: () => new Date(),
  };
}

/** Pure. Stored certification report -> { state, detail, checks[{ name, passed, detail, severity }] }. */
function certificationStatus(certification) {
  if (!certification) return { ...unknown("not certified yet"), checks: [] };
  const checks = (certification.checks || []).map((check) => ({ name: check.name, passed: Boolean(check.passed), detail: check.detail || "", severity: classify(check.name) === "critical" ? "critical" : "non_critical" }));
  const failed = checks.filter((check) => !check.passed);
  const critical = failed.filter((check) => check.severity === "critical");
  if (!failed.length && certification.passed !== false) return { state: "ok", detail: "all checks passed", checks };
  if (critical.length || !failed.length) return { state: "blocked", detail: `failed: ${(critical.length ? critical : failed).map((check) => check.name).join(", ") || "certification"}`, checks };
  return { state: "warning", detail: `non-critical failed: ${failed.map((check) => check.name).join(", ")}`, checks };
}

/** Pure. Stored coverage report -> { state, detail, mapped, requiredUnmapped, unresolved }. */
function coverageStatus(coverage) {
  const fields = coverage?.fields;
  if (!fields) return { ...unknown("no coverage report for the active mapping"), mapped: null, requiredUnmapped: null, unresolved: null };
  const mapped = Number(fields.mapped) || 0;
  const requiredUnmapped = Number(fields.requiredUnmapped) || 0;
  const unresolved = Number(fields.unmappedByClass?.unresolved) || 0;
  const state = requiredUnmapped > 0 ? "blocked" : unresolved > 0 ? "warning" : "ok";
  const detail = `${mapped} mapped, ${requiredUnmapped} required unmapped, ${unresolved} unresolved`;
  return { state, detail, mapped, requiredUnmapped, unresolved };
}

/** Pure. Edition-acceptance preview -> { state, decision, reasons }. */
/** Pure. Phase 7.4: the stored per-field inventory summary -> { state, decision, counts, holdCount, gate }. Shown only while FORM_PIPELINE_AUTONOMY is not off. */
function inventoryStatus(summary, { gate = require("../form-mapping/inventory/FieldInventory").gateMode() } = {}) {
  if (!summary) return { ...unknown("no per-field inventory has been computed for this edition yet"), decision: null, counts: null, holdCount: null, gate };
  const held = summary.decision === "held";
  return {
    state: held ? "warning" : "ok",
    detail: held ? `${summary.hold?.count ?? 0} box(es) have no active mapping and cannot be left empty on their own${gate === "report" ? " (report only: nothing is blocked)" : ""}` : "every box is mapped, deliberately empty with a reason, or not client data",
    decision: summary.decision,
    counts: summary.counts || null,
    holdCount: summary.hold?.count ?? 0,
    holdFields: (summary.hold?.fields || []).slice(0, 20),
    previous: summary.previous || null,
    gate,
  };
}

function editionPolicyStatus(peek) {
  if (!peek) return { state: "unknown", decision: null, reasons: [] };
  const state = peek.allowed ? "ok" : peek.decision === "not_accepted" ? "blocked" : "warning";
  return { state, decision: peek.decision || (peek.allowed ? "accepted" : "held"), reasons: peek.reasons || [] };
}

/** Pure. Release-gate evaluation -> { decision, checks[{ name, outcome, detail }] }. */
function releaseStatus(evaluation) {
  if (!evaluation) return { decision: "unknown", checks: [] };
  return { decision: evaluation.decision, checks: (evaluation.checks || []).map((check) => ({ name: check.name, outcome: check.outcome, detail: check.detail })) };
}

/** Pure. Latest job -> timeline [{ stage, status, startedAt, finishedAt, attempts, error }], ordered by start. */
function timelineOf(job) {
  if (!job) return [];
  const stages = job.stages instanceof Map ? Object.fromEntries(job.stages) : job.stages || {};
  return Object.entries(stages).map(([stage, info]) => ({
    stage, status: info.status, startedAt: info.startedAt || null, finishedAt: info.finishedAt || null, attempts: info.attempts || 0, error: info.error?.message ? { class: info.error.class, code: info.error.code, message: info.error.message } : null,
  })).sort((a, b) => (a.startedAt ? new Date(a.startedAt).getTime() : Infinity) - (b.startedAt ? new Date(b.startedAt).getTime() : Infinity));
}

/** Pure. Degraded = an audited non-critical-check override on the live edition; hold = the release gate / edition policy says the edition waits for someone. */
function degradedOf(template) {
  const override = template?.lifecycle?.certificationOverride;
  if (!override) return null;
  return { reason: override.reason || null, failedChecks: override.failed || [], by: override.by ? String(override.by) : null, at: iso(override.at) };
}
function holdOf(release, policy) {
  if (release?.decision === "held" || release?.decision === "approval_required") {
    const reasons = (release.checks || []).filter((check) => !["pass", "degraded"].includes(check.outcome)).map((check) => check.detail || check.name);
    return { reasons: reasons.length ? reasons : policy?.reasons || [], decision: release.decision };
  }
  if (policy && policy.state === "warning") return { reasons: policy.reasons || [], decision: policy.decision };
  return null;
}

function monitoringStatus(template, now) {
  const last = template?.lastChecked ? new Date(template.lastChecked) : null;
  if (!last) return { state: "unknown", detail: "this edition has not been checked against uscis.gov yet", lastChecked: null };
  const fresh = now.getTime() - last.getTime() <= MONITOR_FRESH_MS;
  return { state: fresh ? "ok" : "warning", detail: fresh ? "checked recently" : "not checked for more than 3 days", lastChecked: last.toISOString() };
}

function importStatus(template, job) {
  if (!template) return unknown("no edition on file");
  const failed = job?.stages && Object.entries(job.stages instanceof Map ? Object.fromEntries(job.stages) : job.stages).find(([stage, info]) => stage === "import" && info.status === "failed");
  if (failed) return { state: "blocked", detail: failed[1].error?.message || "the last import failed" };
  if (!template.importMetadata?.importedAt && !template.importMetadata?.source) return { state: "warning", detail: "no import record on this edition" };
  return { state: "ok", detail: `imported ${iso(template.importMetadata.importedAt)?.slice(0, 10) || ""}${template.importMetadata.source ? ` from ${template.importMetadata.source}` : ""}`.trim() };
}

function mappingStatus(template, version) {
  if (!template) return { state: "unknown", detail: "no edition on file", activeVersion: null };
  const activeVersion = version?.mappingVersion ?? null;
  if (template.mappingStatus === "active" && version) {
    const left = version.validation?.readyForActivation === false && require("../../config/formPipelineAutonomy").mode() === "on" ? Number(version.validation?.summary?.reviewRequired) || 0 : 0;
    return { state: version.validation?.readyForActivation === false ? "warning" : "ok", detail: `mapping version ${activeVersion} is active${left ? `; ${left} box(es) left unmapped (blank)` : ""}`, activeVersion };
  }
  if (["needs_review", "draft", "biographic_active"].includes(template.mappingStatus)) return { state: "warning", detail: `mapping is ${template.mappingStatus}`, activeVersion };
  return { state: "blocked", detail: `mapping is ${template.mappingStatus || "unmapped"}`, activeVersion };
}

/** Never throws: a part that cannot be read is "unknown". */
async function safely(fn, fallback) {
  try { return await fn(); } catch (error) { return typeof fallback === "function" ? fallback(error) : fallback; }
}

/** Read-only status of one form. deps are injectable (tests). */
async function formStatus(formCode, deps = {}) {
  const d = { ...defaultDeps(), ...deps };
  const code = String(formCode || "").toUpperCase();
  const now = d.now();
  const templates = await d.Template.find({ formCode: code }).sort({ editionDate: -1, version: -1 }).limit(10)
    .select("formCode version editionDate status mappingStatus officialStatus approvedAt approvedBy lastChecked lifecycle importMetadata parentVersion").lean();
  const editions = templates.map((template) => ({ id: String(template._id), version: template.version, editionDate: iso(template.editionDate), status: template.status }));
  const template = templates.find((item) => item.status === "active") || templates[0] || null;

  const [version, job, outcome] = await Promise.all([
    template ? safely(() => d.MappingVersion.findOne({ template: template._id, status: "active" }).sort({ mappingVersion: -1 }).select("mappingVersion status validation graph.validation.coverage").lean(), null) : null,
    safely(() => d.Job.findOne({ formCode: code }).sort({ createdAt: -1 }).select("stages state currentStage lastError").lean(), null),
    safely(() => d.Report.findOne({ kind: "outcome", formCode: code }).sort({ reportedAt: -1 }).select("lostEdges toEdition reportedAt").lean(), null),
  ]);

  const peek = template ? await safely(() => d.peekAcceptance(template), null) : null;
  const evaluation = template ? await safely(() => d.releaseGate.evaluate(template, { deps: { policy: async () => peek || { allowed: false, decision: "held", reasons: ["unreadable"] } } }), null) : null;
  const policy = template ? editionPolicyStatus(peek) : { state: "unknown", decision: null, reasons: [] };
  const release = releaseStatus(evaluation);
  const coverage = version?.validation?.coverage || version?.graph?.validation?.coverage;

  return {
    formCode: code,
    editions,
    statuses: {
      import: importStatus(template, job),
      mapping: mappingStatus(template, version),
      coverage: template ? coverageStatus(coverage) : { ...unknown("no edition on file"), mapped: null, requiredUnmapped: null, unresolved: null },
      ...(require("../../config/formPipelineAutonomy").mode() !== "off" ? { inventory: template ? inventoryStatus(coverage?.inventory || version?.graph?.inventory) : { ...unknown("no edition on file"), decision: null, counts: null, holdCount: null } } : {}),
      certification: template ? certificationStatus(template.importMetadata?.validationSummary?.certification) : { ...unknown("no edition on file"), checks: [] },
      release,
      editionPolicy: policy,
      monitoring: monitoringStatus(template, now),
    },
    timeline: timelineOf(job),
    lostEdges: (outcome?.lostEdges || []).map((edge) => ({ targetFieldId: edge.targetFieldId || null, sourcePath: edge.sourcePath || null, reason: edge.reason || "field_removed_in_new_edition" })),
    degraded: degradedOf(template),
    hold: holdOf(release, policy),
  };
}

module.exports = { formStatus, inventoryStatus, certificationStatus, coverageStatus, editionPolicyStatus, releaseStatus, timelineOf, degradedOf, holdOf, monitoringStatus, importStatus, mappingStatus };
