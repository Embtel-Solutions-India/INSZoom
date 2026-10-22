// Phase 7.1: what may be handed out as a FILING artifact. Pure rules + one switch-aware enforcer; nothing here touches a database or a PDF.
//
//   - a form is "filing" when it is ready for / in the filing step (ready_for_pdf, locked, finalized, filed) or explicitly locked; review copies, drafts and
//     "ATTORNEY REVIEW" PDFs are never filing artifacts and are never affected;
//   - an official download of a filing form must have PASSED the strict fidelity check: the fallback paths (pdf-lib without the check, the blank official form)
//     are fine for a person who needs a file, but they are not verified filled copies;
//   - a filing package (no watermark requested) may contain only clean, verified copies of each form, never a generated copy that carries a watermark.
// Behind FORM_PIPELINE_AUTONOMY: off = nothing changes; shadow = the verdict is logged as a warning ("would have refused"), the old result is still served; on = refused.
const autonomy = require("../../../config/formPipelineAutonomy");
const logger = require("../../../utils/logger");

const FILING_STATUSES = Object.freeze(["ready_for_pdf", "locked", "finalized", "filed"]);
const UNVERIFIED_MODES = Object.freeze(["blank-template", "pdf-lib-unverified"]);

const isFilingForm = (caseForm) => Boolean(caseForm) && (caseForm.isLocked === true || FILING_STATUSES.includes(caseForm.status));

/** A package is a filing package when no watermark was asked for (the finalized petition passes ""; review / draft packages pass a label). */
const isFilingPackage = (watermark) => !String(watermark || "").trim();

/** Pure. { filing, ok, problems[] } for an official download that ended in `mode` ("adobe" | "pdf-lib" | "pdf-lib-unverified" | "blank-template"). */
function assessDownload({ caseForm, mode }) {
  const filing = isFilingForm(caseForm);
  const problems = [];
  if (filing && UNVERIFIED_MODES.includes(mode)) {
    problems.push({
      code: mode === "blank-template" ? "FILING_DOWNLOAD_BLANK_FORM" : "FILING_DOWNLOAD_NOT_VERIFIED",
      message: mode === "blank-template"
        ? "The form could not be filled, so only the blank official form was available. It is not a filing copy."
        : "The filled form did not pass the strict accuracy check, so it cannot be used as a filing copy.",
    });
  }
  return { filing, ok: problems.length === 0, problems };
}

/** Pure. A stored generated copy is not a clean filing copy when it carries a watermark. */
function carriesWatermark(documentMetadata) {
  return Boolean(String(documentMetadata?.watermark || "").trim());
}

/**
 * Applies the switch to a verdict. `event` names what was assessed for the log. Returns "allowed" (off, or nothing wrong), "would_refuse" (shadow) or throws a 409
 * (on). The error never carries stored values, only the reasons.
 */
function enforce(assessment, { event, context = {}, env = process.env, log = logger } = {}) {
  const mode = autonomy.mode(env);
  if (mode === "off" || assessment.ok) return "allowed";
  if (mode === "shadow") {
    log.warn("form_filing_artifact_would_refuse", { event, ...context, problems: assessment.problems.map((problem) => problem.code) });
    return "would_refuse";
  }
  const error = new Error(`Filing copy refused: ${assessment.problems.map((problem) => problem.message).join(" ")}`);
  error.status = 409;
  error.statusCode = 409;
  error.code = "FILING_ARTIFACT_NOT_VALIDATED";
  error.problems = assessment.problems;
  throw error;
}

module.exports = { FILING_STATUSES, UNVERIFIED_MODES, isFilingForm, isFilingPackage, assessDownload, carriesWatermark, enforce };
