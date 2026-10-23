// The Phase 4 accuracy gate's release criteria (plan: "Accuracy gate (release criteria, decision 19)"). These numbers were approved BEFORE any shadow run: they are constants,
// never derived from a baseline, and a caller can only make them STRICTER (effectiveThresholds clamps every override to the pre-approved floor / ceiling).
const PRE_APPROVED_THRESHOLDS = Object.freeze({
  maxCriticalRoleViolations: 0,   // an auto-used suggestion that puts one party's data in the other party's box
  maxDataIntegrityFailures: 0,    // an auto-used suggestion that must never be auto-used (blank box, risky box kind, sensitive field, ...)
  minPrecision: 0.99,             // correct / auto-used, over verified auto-used TEXT mappings
  minAutoUsedTextMappings: 300,   // "zero errors in 300 bounds the error rate at about 1% at 95% confidence" - a smaller sample supports no precision claim
  minFormsPerFamily: 3,           // forms evaluated in each main family
  minVerifiedPerWidgetType: 25,   // verified golden fields per widget type a family contains
  requireHeldOutForm: true,       // a form never used to tune prompts or rules is evaluated
});

// the families the plan requires (the golden draft also holds one "general" form, which is reported but not required to reach three)
const MAIN_FAMILIES = Object.freeze(["employment", "family", "single"]);
// only unambiguous, low-risk TEXT mappings may be auto-used (decision 3); every other box kind stays needs_review whatever the model says
const AUTO_USE_KINDS = Object.freeze(["text"]);
const REVIEW_ONLY_KINDS = Object.freeze(["checkbox", "radio", "dropdown", "date"]);

/** Pre-approved thresholds with optional overrides that can only tighten them. */
function effectiveThresholds(overrides = {}) {
  const base = PRE_APPROVED_THRESHOLDS;
  const out = { ...base };
  for (const key of ["maxCriticalRoleViolations", "maxDataIntegrityFailures"]) if (Number.isFinite(overrides[key])) out[key] = Math.min(base[key], overrides[key]);
  for (const key of ["minPrecision", "minAutoUsedTextMappings", "minFormsPerFamily", "minVerifiedPerWidgetType"]) if (Number.isFinite(overrides[key])) out[key] = Math.max(base[key], overrides[key]);
  if (overrides.requireHeldOutForm === true) out.requireHeldOutForm = true;
  return Object.freeze(out);
}

module.exports = { PRE_APPROVED_THRESHOLDS, MAIN_FAMILIES, AUTO_USE_KINDS, REVIEW_ONLY_KINDS, effectiveThresholds };
