// Keeps every tracked USCIS form on its newest edition, one form at a time, with no AI and no manual step.
// Per form: ask USCIS (OnDemandFormAcquisitionService.ensureCurrentUSCISForm) -> import the new edition normalized -> migrate its mapping ->
// readiness gate (mapping lossless, every component sliceable) -> activate and move the open cases. If the new edition is not ready (or anything
// fails) the CURRENT edition keeps serving untouched and the form is retried, up to maxAttempts with a growing delay; the next scheduled run
// tries again. Forms are processed sequentially so one failure can never affect another.
const USCISFormTemplate = require("../../../models/USCISFormTemplate");
const OnDemandFormAcquisitionService = require("./OnDemandFormAcquisitionService");
const logger = require("../../../utils/logger");

const STANDALONE = /^[A-Z]{1,3}-\d+[A-Z]?$/;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function trackedFormCodes() {
  const codes = await USCISFormTemplate.distinct("formCode", { status: "active" });
  return codes.filter((code) => STANDALONE.test(code)).sort();
}

async function upgradeOne(formCode, user, req, { maxAttempts, retryDelayMs }) {
  let last;
  const activeBefore = String((await USCISFormTemplate.findOne({ formCode, status: "active" }).select("_id").lean())?._id || "");
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const result = await require("../../form-pipeline/FormPipeline").runForm({
        formCode, trigger: "edition_upgrade", user, req, options: { forceCheck: true }, direct: () => OnDemandFormAcquisitionService.ensureCurrentUSCISForm(formCode, user, req, { forceCheck: true }),
      });
      if (result?.queued) return { formCode, status: "queued", attempts: attempt, jobId: result.jobId };
      if (result.checkError) { last = { status: "uscis_unreachable", detail: result.checkError }; }
      else if (!result.versionChanged) return { formCode, status: "up_to_date", attempts: attempt };
      // the scanner also reports a duplicate of the installed edition as "changed"; only a different live template is an upgrade
      else if (String(result.template?._id || "") === activeBefore && !result.requiresActivation) return { formCode, status: "up_to_date", attempts: attempt };
      else if (!result.requiresActivation) return { formCode, status: "upgraded", attempts: attempt, caseMigration: result.caseMigration && { migrated: result.caseMigration.migrated, valuesCarried: result.caseMigration.valuesCarried, valuesArchived: result.caseMigration.valuesArchived, failed: result.caseMigration.failed.length } };
      else last = { status: "new_edition_not_ready", detail: result.readiness?.problems || result.migration?.lostEdges?.map((edge) => edge.targetPdfField) || result.activationBlockedReason };
    } catch (error) {
      last = { status: "error", detail: error.message };
    }
    logger.info("uscis_form_upgrade_retry", { formCode, attempt, ...last });
    if (attempt < maxAttempts) await sleep(retryDelayMs * attempt);
  }
  return { formCode, attempts: maxAttempts, ...last, note: "current edition left in service" };
}

async function upgradeTrackedForms({ user, req, formCodes, maxAttempts = Number(process.env.USCIS_UPGRADE_MAX_ATTEMPTS || 3), retryDelayMs = Number(process.env.USCIS_UPGRADE_RETRY_DELAY_MS || 30000) } = {}) {
  const codes = formCodes?.length ? formCodes : await trackedFormCodes();
  const results = [];
  for (const formCode of codes) results.push(await upgradeOne(formCode, user, req || { ip: "system", headers: {} }, { maxAttempts, retryDelayMs }));
  const pending = results.filter((item) => !["up_to_date", "upgraded"].includes(item.status));
  if (pending.length) logger.info("uscis_form_upgrade_pending", { forms: pending.map((item) => `${item.formCode}:${item.status}`) });
  return { checked: results.length, upgraded: results.filter((item) => item.status === "upgraded").map((item) => item.formCode), pending, results };
}

module.exports = { upgradeTrackedForms, upgradeOne, trackedFormCodes };
