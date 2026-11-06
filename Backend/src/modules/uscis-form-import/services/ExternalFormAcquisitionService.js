// The "ensure this form is current" flow for a form published outside uscis.gov (config/externalForms.js - the two DOL ETA-9089 forms). OnDemandFormAcquisitionService.ensureCurrentUSCISForm
// hands such a form code here and every other form code never reaches this file, so the USCIS flow is untouched. Everything AFTER the download is the SAME shared pipeline: the
// importer (qpdf normalize / XFA check / field scan / labels / storage / comparison with the previous edition), mapping carry-forward and authored rules, optional AI suggestions,
// certification, the edition gate, activation and the migration of open cases - all through the `helpers` the caller passes in (activateOrPromote, recordEdition, ...).
//
// What differs, by design:
//   - the source: two routes to the official DOL file (ExternalFormSource: direct, then the current link on the forms page), both host-pinned;
//   - the version: these PDFs print no edition date, so a version is decided by CONTENT (ExternalFormFingerprint): first import "v1", a real revision "v2", ...; the same form re-saved
//     (different bytes, same content) creates nothing; the edition date stored is the day the version was FIRST DETECTED (editionDateSource "import_date"), never the OMB expiry.
// A failed check never disturbs the live edition: with an edition already live the caller gets it back with `checkError`; with none, the error is thrown for the pipeline job to
// classify, retry and alert.
const USCISFormTemplate = require("../../../models/USCISFormTemplate");
const logger = require("../../../utils/logger");
const { resolveExternalPdf } = require("./ExternalFormSource");
const Fingerprint = require("./ExternalFormFingerprint");
const { reportRuleHealth } = require("./ExternalFormHealth");

const MAX_REISSUES_KEPT = 20;
const labelOf = (entry, versionNumber) => `${entry.internalLabel}-v${versionNumber}`;

async function nextVersionNumber(formCode) {
  return (await USCISFormTemplate.countDocuments({ formCode })) + 1;
}

/** Writes the external-source bookkeeping onto a template (additive; never throws). */
async function stampExternal(templateId, patch) {
  try {
    const set = {};
    for (const [key, value] of Object.entries(patch)) set[`lifecycle.external.${key}`] = value;
    await USCISFormTemplate.updateOne({ _id: templateId }, { $set: { ...set, lastChecked: new Date() } });
  } catch (error) {
    logger.warn("external_form_stamp_failed", { templateId: String(templateId), error: error.message });
  }
}

// A copy of THIS content that was imported earlier but never went live (the run stopped before activation: a gate held it, a step failed, the process ended). The next run finishes that copy
// instead of importing the same file again - a half-finished run completes by itself and never leaves duplicate editions behind.
async function findPendingSameContent(formCode, fingerprint) {
  if (!fingerprint?.content) return null;
  return USCISFormTemplate.findOne({
    formCode,
    status: { $in: ["draft", "review", "pending_review"] },
    $or: [{ "lifecycle.external.fingerprint.content": fingerprint.content }, { "importMetadata.checksum": fingerprint.sha256 }, { "lifecycle.sourceChecksum": fingerprint.sha256 }],
  }).sort({ createdAt: -1 });
}

async function importVersion({ formCode, entry, resolved, fingerprint, comparison, user, req, helpers }) {
  const versionNumber = await nextVersionNumber(formCode);
  const result = await helpers.importer.importFromBuffer(resolved.bytes, {
    formType: formCode,
    formName: entry.title,
    provider: entry.provider,
    source: "external_official_fetch",
    pdfUrl: resolved.pdfUrl,
    pageUrl: resolved.pageUrl,
    officialPageUrl: resolved.pageUrl,
    version: `v${versionNumber}`,
    detectedEditionAt: new Date(), // the day this version was first seen: the edition label of a form that prints none
  }, user, req);
  const stamp = {
    provider: entry.provider,
    internalVersion: labelOf(entry, versionNumber),
    internalVersionNumber: versionNumber,
    firstDetectedAt: new Date(),
    fingerprint,
    via: resolved.via,
    sourcePdfUrl: resolved.pdfUrl,
    ombExpiration: fingerprint.ombExpiration || null,
    changeReason: comparison?.reason || "first_import",
  };
  await stampExternal(result.template._id, stamp);
  return { ...result, versionNumber, stamp };
}

// The shared activation step may rewrite the template's whole `lifecycle` object from an in-memory copy that is older than our stamp, which drops it. After activation (and for a resumed copy
// that never had one) the stamp is checked and written again if it is gone: the version bookkeeping can never be lost to that.
async function ensureStamp(templateId, stamp) {
  try {
    if (!stamp) return;
    const has = await USCISFormTemplate.exists({ _id: templateId, "lifecycle.external.fingerprint.content": stamp.fingerprint?.content });
    if (!has) await stampExternal(templateId, stamp);
  } catch (error) {
    logger.warn("external_form_stamp_check_failed", { templateId: String(templateId), error: error.message });
  }
}

function stampFor({ entry, fingerprint, resolved, template, comparison }) {
  const number = Number(template?.lifecycle?.external?.internalVersionNumber) || Number(String(template?.version || "").replace(/^v/i, "")) || 1;
  return { provider: entry.provider, internalVersion: labelOf(entry, number), internalVersionNumber: number, firstDetectedAt: template?.lifecycle?.external?.firstDetectedAt || template?.createdAt || new Date(), fingerprint, via: resolved.via, sourcePdfUrl: resolved.pdfUrl, ombExpiration: fingerprint.ombExpiration || null, changeReason: comparison?.reason || "first_import" };
}

/**
 * @param {{ formCode, entry, user, req, options, helpers }} input
 *   helpers = { importer, findLatestActiveTemplate, activateOrPromote, recordEdition, registerBrandNewFormUnlinked, compactActivationReport, enterpriseError, retryUntilSuccess }
 * @returns the same result shape ensureCurrentUSCISForm returns for a USCIS form
 */
async function ensureCurrentExternalForm({ formCode, entry, user, req, options = {}, helpers }) {
  const forceCheck = Boolean(options.forceCheck);
  const pipeline = options.pipeline || null;
  const stage = (name, fn) => (pipeline ? pipeline.stage(name, fn) : fn());
  const ttlMs = Number(process.env.USCIS_ENSURE_CHECK_TTL_MS || 12 * 60 * 60 * 1000);
  const existing = await helpers.findLatestActiveTemplate(formCode);

  if (existing && !forceCheck) {
    const lastCheckedAt = existing.lastChecked ? new Date(existing.lastChecked).getTime() : 0;
    if (Date.now() - lastCheckedAt < ttlMs) return { template: existing, alreadyActive: true, requiresActivation: false, checked: false };
  }

  logger.info("external_form_check_started", { formCode, reason: existing ? (forceCheck ? "forced" : "ttl_expired") : "missing" });
  // way 1 (direct) then way 2 (the official forms page) - see ExternalFormSource; never throws
  const resolved = await stage("detect", () => (helpers.resolveExternalPdf || resolveExternalPdf)({ formCode, template: existing }));
  if (!resolved.ok) {
    logger.warn("external_form_source_unavailable", { formCode, blocked: Boolean(resolved.blocked), tried: resolved.tried });
    if (existing) {
      // the live edition keeps serving; the failure is reported to the caller (and the job's alert) with its real stage
      return { template: existing, alreadyActive: true, requiresActivation: false, checked: true, checkError: resolved.error, checkStage: "page_fetch", ...(resolved.blocked ? { sourceBlocked: true } : {}) };
    }
    throw Object.assign(helpers.enterpriseError(resolved.error, resolved.blocked ? 403 : 502, resolved.code || "EXTERNAL_SOURCE_UNRESOLVED"), { tried: resolved.tried });
  }

  let fingerprint;
  try {
    fingerprint = await (helpers.fingerprintOf || Fingerprint.fingerprintOf)(resolved.bytes);
  } catch (error) {
    logger.warn("external_form_fingerprint_failed", { formCode, error: error.message });
    if (existing) return { template: existing, alreadyActive: true, requiresActivation: false, checked: true, checkError: `the downloaded PDF could not be read: ${error.message}`, checkStage: "scan" };
    throw Object.assign(helpers.enterpriseError(`The downloaded ${formCode} PDF could not be read: ${error.message}`, 422, "PDF_UNREADABLE"), { stage: "scan" });
  }

  // ---- nothing live yet: the first import is v1 ----------------------------------------------------------------------------------------------------------------------------
  if (!existing) {
    const pending = await findPendingSameContent(formCode, fingerprint);
    if (pending) {
      logger.info("external_form_resume_pending", { formCode, templateId: String(pending._id), version: pending.version });
      const stampPending = stampFor({ entry, fingerprint, resolved, template: pending, comparison: { reason: "resumed" } });
      await ensureStamp(pending._id, stampPending);
      const activation = await helpers.activateOrPromote(await USCISFormTemplate.findById(pending._id), user, req, pipeline);
      await ensureStamp(pending._id, stampPending);
      await reportRuleHealth(pending._id, formCode);
      return { ...activation, alreadyActive: false, resumedPending: true };
    }
    const importResult = await stage("import", () => helpers.retryUntilSuccess(() => importVersion({ formCode, entry, resolved, fingerprint, comparison: null, user, req, helpers }), { attempts: 3, label: `import:${formCode}` }));
    logger.info("external_form_download_completed", { formCode, templateId: String(importResult.template._id), version: importResult.template.version });
    await helpers.recordEdition(pipeline, formCode, importResult.template, null);
    const unlinked = await helpers.registerBrandNewFormUnlinked(importResult.template);
    // activation gets the template as it is NOW (it carries the stamp), and the stamp is verified once it is done
    const activation = await helpers.activateOrPromote(await USCISFormTemplate.findById(importResult.template._id), user, req, pipeline);
    await ensureStamp(importResult.template._id, importResult.stamp);
    await reportRuleHealth(importResult.template._id, formCode);
    return { ...activation, alreadyActive: false, ...(unlinked ? { unlinkedNewForm: true } : {}) };
  }

  // ---- a form is live: is the official file a new VERSION? ----------------------------------------------------------------------------------------------------------------------
  const stored = existing.lifecycle?.external?.fingerprint || null;
  const comparison = Fingerprint.compare(stored, fingerprint);
  if (comparison.same || comparison.sameContent) {
    const reissued = comparison.reason === "identical_reissue";
    if (reissued) {
      logger.info("external_form_reissued_identical", { formCode, templateId: String(existing._id) });
      const previous = Array.isArray(existing.lifecycle?.external?.reissued) ? existing.lifecycle.external.reissued : [];
      await stampExternal(existing._id, { reissued: [...previous, { at: new Date(), sha256: fingerprint.sha256 }].slice(-MAX_REISSUES_KEPT) });
    } else {
      await stampExternal(existing._id, { lastConfirmedAt: new Date() });
    }
    logger.info("external_form_check_completed", { formCode, outcome: reissued ? "identical_reissue" : "no_change" });
    return { template: existing, alreadyActive: true, requiresActivation: false, checked: true, ...(reissued ? { reissuedIdentical: true } : {}) };
  }

  logger.info("external_form_version_detected", { formCode, previousTemplateId: String(existing._id), reason: comparison.reason });
  const pending = await findPendingSameContent(formCode, fingerprint);
  const imported = pending
    ? { template: pending, comparisonReport: pending.lifecycle?.comparisonReport }
    : await stage("import", () => helpers.retryUntilSuccess(() => importVersion({ formCode, entry, resolved, fingerprint, comparison, user, req, helpers }), { attempts: 3, label: `import:${formCode}` }));
  if (pending) logger.info("external_form_resume_pending", { formCode, templateId: String(pending._id), version: pending.version });
  const newTemplate = await USCISFormTemplate.findById(imported.template._id);
  if (!pending) await helpers.recordEdition(pipeline, formCode, newTemplate, existing);
  const versionStamp = imported.stamp || stampFor({ entry, fingerprint, resolved, template: newTemplate, comparison: pending ? { reason: "resumed" } : comparison });
  if (pending) await ensureStamp(newTemplate._id, versionStamp);
  const activation = await helpers.activateOrPromote(newTemplate, user, req, pipeline);
  await ensureStamp(newTemplate._id, versionStamp);
  await reportRuleHealth(newTemplate._id, formCode); // DOL renamed a box? the rule that no longer matches is named in the log and on the template
  const live = activation.template.status === "active";
  logger.info("external_form_check_completed", { formCode, outcome: live ? "new_version_activated" : "new_version_pending_review", version: newTemplate.version });
  return {
    template: live ? activation.template : existing,
    previousTemplate: existing,
    newTemplateId: newTemplate._id,
    alreadyActive: false,
    requiresActivation: activation.requiresActivation,
    activationBlockedReason: activation.activationBlockedReason,
    activationBlockedCode: activation.activationBlockedCode,
    biographicReady: activation.biographicReady,
    coverage: activation.coverage,
    comparisonReport: imported.comparisonReport,
    checked: true,
    versionChanged: true,
    ...helpers.compactActivationReport(activation),
  };
}

module.exports = { ensureCurrentExternalForm, stampExternal, labelOf };
