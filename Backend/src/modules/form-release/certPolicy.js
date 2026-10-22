// Phase 3 CERT_CHECK_POLICY: which certification checks (FormCertificationService) are critical and which may be overridden by an admin with a written, audited reason.
// ONE table for every release decision (VersionManagementService.activate, the ReleaseGate, the pipeline). An unknown check name is critical (fail closed); the previous
// code treated an unknown name as overridable, which is how a crashed certification could have been waved through.
const CERT_CHECK_POLICY = Object.freeze({
  pdf_fillable: "critical",        // the stored PDF loads and exposes every scanned field
  mapping_valid: "critical",       // the active mapping graph passes the contract
  fill_roundtrip: "critical",      // a filled form is not blank and survives save / reload
  party_markers: "critical",       // each person's data lands only in that person's boxes (Phase 3: distinct synthetic markers)
  widget_inputs: "critical",       // tick boxes get booleans, drop-downs get one of their options, dates are dates (Phase 3)
  viewer_download: "non_critical", // the filled bytes are a valid PDF with the template's page count
  components_slice: "non_critical", // every supplement the previous edition served can be sliced
});

const OVERRIDE_REASON_MIN = 10;
const classify = (name) => CERT_CHECK_POLICY[name] || "critical";
const CRITICAL_CERTIFICATION_CHECKS = Object.freeze(Object.keys(CERT_CHECK_POLICY).filter((name) => CERT_CHECK_POLICY[name] === "critical"));

/** Pure. { ok, error?, override? } - may this edition be activated given its stored certification report and the request. */
function certificationDecision(template, req) {
  const certification = template?.importMetadata?.validationSummary?.certification;
  if (!certification) return { ok: false, error: "This USCIS edition has not been certified yet; it is certified automatically on import, or re-run the certification before activating it" };
  if (certification.passed === true) return { ok: true };
  const failed = (certification.checks || []).filter((check) => !check.passed).map((check) => check.name);
  const critical = failed.filter((name) => !name || classify(name) === "critical");
  if (critical.length || !failed.length) return { ok: false, error: `Certification failed a critical check (${(critical.length ? critical : ["unknown"]).join(", ")}); this edition cannot be activated until it passes` };
  const reason = String(req?.body?.overrideReason || "").trim();
  if (reason.length < OVERRIDE_REASON_MIN) return { ok: false, error: `Certification failed non-critical check(s) (${failed.join(", ")}). Fix them, or activate with an overrideReason of at least ${OVERRIDE_REASON_MIN} characters (it is audited)` };
  return { ok: true, override: { reason, failed } };
}

module.exports = { CERT_CHECK_POLICY, CRITICAL_CERTIFICATION_CHECKS, OVERRIDE_REASON_MIN, classify, certificationDecision };
