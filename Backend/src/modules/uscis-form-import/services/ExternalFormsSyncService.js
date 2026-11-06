// The 12-hourly step for the forms published outside uscis.gov (uscis-form-import/config/externalForms.js - the two DOL ETA-9089 forms). It runs INDEPENDENTLY of the USCIS catalog
// sync: it is called by its own step in the same scheduled job, so a failure of the USCIS directory can never skip these forms and a failure here can never skip a USCIS form.
// Each form goes through the one pipeline door (FormPipeline.runForm: durable job, retries with backoff, failure classification, alerts) exactly like a USCIS form, and one form's failure
// never affects the other. Never throws.
const logger = require("../../../utils/logger");
const { externalFormCodes } = require("../config/externalForms");

const enabled = (env = process.env) => String(env.EXTERNAL_FORMS_SYNC || "true").toLowerCase() !== "false";

/**
 * @param {{ user?, req?, only?: string[], deps? }} options deps.runForm replaces the pipeline door (tests)
 * @returns {{ enabled, checked, results: [{ formCode, outcome, detail? }] }}
 */
async function runExternalFormsSync(options = {}) {
  if (!enabled()) return { enabled: false, checked: 0, results: [] };
  const runForm = options.deps?.runForm || ((args) => require("../../form-pipeline/FormPipeline").runForm(args));
  const Acquisition = options.deps?.acquisition || (() => require("./OnDemandFormAcquisitionService"));
  const req = options.req || { ip: "system", headers: {} };
  const results = [];
  for (const formCode of externalFormCodes().filter((code) => !options.only?.length || options.only.includes(code))) {
    try {
      const result = await runForm({
        formCode, trigger: "catalog_sync", user: options.user, req, options: { forceCheck: true },
        direct: () => (typeof Acquisition === "function" ? Acquisition() : Acquisition).ensureCurrentUSCISForm(formCode, options.user, req, { forceCheck: true }),
      });
      if (result?.queued) { results.push({ formCode, outcome: "queued", detail: `job ${result.jobId}` }); continue; }
      const promoted = Boolean(result?.template && result.template.status === "active" && !result.requiresActivation);
      results.push({ formCode, outcome: result?.checkError ? "source_unreachable" : (result?.versionChanged || result?.alreadyActive === false) ? (promoted ? "new_version_live" : "kept_in_review") : result?.reissuedIdentical ? "identical_reissue" : "no_change", detail: result?.checkError || result?.activationBlockedReason || undefined });
    } catch (error) {
      results.push({ formCode, outcome: "error", detail: String(error?.message || error).slice(0, 200) }); // the live edition is untouched; the pipeline job retries with backoff
    }
    logger.info("external_forms_sync_form", results.at(-1));
  }
  logger.info("external_forms_sync_completed", { checked: results.length, outcomes: results.map((item) => `${item.formCode}:${item.outcome}`) });
  return { enabled: true, checked: results.length, results };
}

module.exports = { runExternalFormsSync, enabled };
