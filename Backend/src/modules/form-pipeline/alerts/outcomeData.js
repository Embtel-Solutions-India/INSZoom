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

module.exports = { buildSuccessData, buildHeldData, describeRelease, editionOf, isoDay, safely, withTimeout, LOOKUP_MS };
