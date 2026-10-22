// Phase 5E: the facts a SUCCESS / HELD e-mail states (plan "Developer email notifications"): old and new edition, the visa types the form serves, whether the release was promoted
// or degraded (and who/what authorized it), the mapping coverage. Everything is read-only, each lookup is bounded in time and failure-tolerant: a lookup that fails leaves its
// fact out of the e-mail (the e-mail says so) and never fails the pipeline. Only form codes, edition dates, counts and check names go into the data - no client data.
const { sanitizeMessage } = require("../errorClassifier");

const LOOKUP_MS = 5000;

const isoDay = (value) => { const date = value ? new Date(value) : null; return date && !Number.isNaN(date.getTime()) ? date.toISOString().slice(0, 10) : ""; };
/** "2026-01-01" for a template-like object: its edition date, else its version string. */
const editionOf = (template) => (template ? isoDay(template.editionDate) || String(template.version || "") : "");

function withTimeout(promise, ms, label) {
  let timer;
  const limit = new Promise((_resolve, reject) => { timer = setTimeout(() => reject(new Error(`${label} timed out`)), ms); timer.unref?.(); });
  return Promise.race([promise, limit]).finally(() => clearTimeout(timer));
}
const safely = async (fn, fallback, label) => { try { return await withTimeout(Promise.resolve().then(fn), LOOKUP_MS, label); } catch { return fallback; } };

function defaultLookups() {
  return {
    visaTypes: (formCode) => require("../../uscis-form-import/seeds/deriveVisaTypesFromRegistry").deriveVisaTypesFromRegistry(formCode),
    coverage: async (template) => {
      if (!template?.activeMappingVersionId) return null;
      const version = await require("../../../models/USCISMappingVersion").findById(template.activeMappingVersionId).select("validation.coverage.fields").lean();
      return version?.validation?.coverage?.fields || null;
    },
  };
}

/** What a degraded release says about itself: the non-critical checks that failed and who/what authorized the promotion. */
function describeRelease(template) {
  const override = template?.lifecycle?.certificationOverride;
  if (!override) return { mode: "promoted" };
  const failed = (Array.isArray(override.failed) ? override.failed : []).map((item) => String(typeof item === "string" ? item : item?.name || item?.check || "")).filter(Boolean);
  return { mode: "degraded", failed, authorizedBy: override.by ? String(override.by) : "", authorizedAt: isoDay(override.at), reason: override.reason ? sanitizeMessage(override.reason) : "" };
}

// ---- Phase 7.E (B8): the "forms stuck" e-mail ------------------------------------------------------------------------------------------------------------------
// Pipeline stage names -> what a person calls them. The fetch / normalize / import steps all run inside the pipeline's "import" stage.
const STAGE_TEXT = { detect: "detect (asking USCIS)", import: "fetch / normalize / import", map: "map", ai_map: "map", certify: "certify", promote: "promote", migrate_cases: "migrate cases", finalize: "finalize" };
const stageText = (stage) => STAGE_TEXT[stage] || (stage ? String(stage) : "unknown");

/** "3 d 4 h" / "5 h 10 min" / "12 min" between two dates (never negative). */
function durationText(from, to = new Date()) {
  const start = from ? new Date(from).getTime() : NaN;
  if (!Number.isFinite(start)) return "";
  const minutes = Math.max(0, Math.round((new Date(to).getTime() - start) / 60000));
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  if (days) return `${days} d ${hours} h`;
  if (hours) return `${hours} h ${minutes % 60} min`;
  return `${minutes} min`;
}

const oneLine = (value, max = 160) => {
  let text;
  if (value && typeof value === "object" && !(value instanceof Error)) { try { text = JSON.stringify(value); } catch { text = String(value); } } else text = value;
  const clean = sanitizeMessage(text);
  return clean.length > max ? `${clean.slice(0, max - 3)}...` : clean;
};

/** One stuck job as the e-mail states it. `describe` is { activeEdition } from the alerter's describeForm; everything is sanitized (no secrets, client data or stack traces). */
function buildStuckItem({ job, describe = {}, now = new Date() }) {
  const hold = job?.hold || {};
  const stage = hold.stage || job?.lastError?.stage || job?.currentStage;
  const toEdition = String(job?.editionKey || "").split("|")[1] || "";
  const strategies = (Array.isArray(job?.resolutions) ? job.resolutions : []).map((entry) => ({
    strategy: oneLine(entry?.strategy, 80) || "unknown strategy",
    result: entry?.ok && entry?.verified ? "worked" : entry?.ok ? "unverified" : "failed",
    evidence: entry?.evidence ? oneLine(entry.evidence) : "",
  }));
  return {
    jobId: job?._id ? String(job._id) : "", formCode: job?.formCode || "", fromEdition: describe.activeEdition || "", toEdition, stage: stageText(stage),
    reason: oneLine(hold.detail || job?.lastError?.message || "no reason was recorded", 300), reasonCode: hold.reasonCode ? oneLine(hold.reasonCode, 80) : "",
    signature: job?.exhausted?.signature ? oneLine(job.exhausted.signature, 80) : "", strategies,
    releaseConditions: (Array.isArray(hold.releaseConditions) ? hold.releaseConditions : []).map((item) => oneLine(item, 200)).filter(Boolean),
    stuckFor: durationText(hold.firstHeldAt || job?.exhausted?.at, now), previousServing: Boolean(describe.activeEdition), activeEdition: describe.activeEdition || "",
  };
}

/** The data of the stuck e-mail. `jobs` are the currently stuck jobs, `resolved` the forms that were in the last e-mail's set and are not stuck any more. */
async function buildStuckData({ jobs = [], resolved = [], describeForm = async () => ({}), now = new Date(), adminLink = "", reminder = false } = {}) {
  const forms = [];
  for (const job of jobs) {
    const describe = await Promise.resolve(describeForm(job.formCode)).catch(() => ({}));
    forms.push(buildStuckItem({ job, describe: describe || {}, now }));
  }
  return { count: forms.length, forms, resolved: resolved.map((item) => ({ formCode: oneLine(item.formCode, 40) })), reminder: Boolean(reminder), adminLink };
}

const count = (value) => (Number.isFinite(Number(value)) ? Number(value) : null);

/** Facts for the "edition promoted" e-mail / digest line. `result` is the pipeline result, `lookups` can be replaced (tests). */
async function buildSuccessData({ job, result, lookups = {} } = {}) {
  const l = { ...defaultLookups(), ...lookups };
  const template = result?.template;
  const formCode = job?.formCode || template?.formCode || "";
  const data = { formCode, newEdition: editionOf(template), previousEdition: editionOf(result?.previousTemplate), jobId: job?._id ? String(job._id) : "", trigger: job?.trigger || "unknown" };
  data.release = describeRelease(template);
  const [visaTypes, coverage] = await Promise.all([safely(() => l.visaTypes(formCode), null, "visa types"), safely(() => l.coverage(template), null, "coverage")]);
  data.visaTypes = Array.isArray(visaTypes) ? visaTypes.map(String) : null;
  data.coverage = coverage ? { total: count(coverage.total), mapped: count(coverage.mapped), requiredUnmapped: count(coverage.requiredUnmapped) } : null;
  data.previousRetained = Boolean(result?.previousTemplate);
  return data;
}

/** Facts for the "imported but not promoted" e-mail. `kind` is "policy_hold" (USCIS acceptance not on record) or "approval_required" (needs a person's approval). */
function buildHeldData({ job, result, transition, reasonKind, describe = {} } = {}) {
  const template = result?.template;
  const editionDate = String(job?.editionKey || "").split("|")[1];
  const reason = sanitizeMessage(result?.activationBlockedReason || transition?.message || job?.lastError?.message || "The edition was not promoted");
  return {
    formCode: job?.formCode || "", editionDate: editionDate || editionOf(template), activeEdition: describe.activeEdition || "", reason, reasonKind,
    action: reasonKind === "policy_hold"
      ? "Submit the USCIS acceptance evidence for this edition on the Form Governance screen (team lead or admin). The edition stays unpromoted until an accepted decision is on record."
      : "Review the edition's mapping and certification on the Form Governance screen and approve it (or fix the mapping) so it can be promoted.",
    jobId: job?._id ? String(job._id) : "",
  };
}

module.exports = { buildStuckData, buildStuckItem, durationText, stageText, buildSuccessData, buildHeldData, describeRelease, editionOf, isoDay, safely, withTimeout, LOOKUP_MS };
