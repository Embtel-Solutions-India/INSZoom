// The one official "Download Form" path, built so a download ALWAYS yields a
// file whenever the form exists. Each step that used to be able to abort the
// request is now best-effort, with the next-best option behind it:
//
//   1. refresh the form from the latest case data   -> on failure, use the
//                                                       values already saved
//   2. render with Adobe (when enabled)             -> on failure/timeout,
//   3. render with the built-in pdf-lib engine         use pdf-lib
//   4. pdf-lib render without the strict fidelity    -> if the strict check
//      check                                            was what failed
//   5. the official blank USCIS PDF                  -> last resort, so the
//                                                       user still gets the
//                                                       real form to fill
//   Saving the generated copy / audit log are best-effort and never block.
//
// Every degradation is reported in `warnings` (and `mode`) so the user is
// told exactly what they got instead of an error or a silent difference.
const PDFGenerationService = require("./PDFGenerationService");
const PDFRenderer = require("./GuardedPDFRenderer"); // PDFRenderer + the no-value-lost safeguards (kept out of PDFRenderer.js on purpose)
const FilingArtifactPolicy = require("./FilingArtifactPolicy");
const env = require("../../../config/env");

const ADOBE_TIMEOUT_MS = Number(process.env.ADOBE_DOWNLOAD_TIMEOUT_MS || 15000);

function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${Math.round(ms / 1000)}s`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

const shortFieldName = (pdfField) => String(pdfField || "").split(".").pop().replace(/\[\d+\]$/, "");

function fieldWarnings(renderReport) {
  return [
    ...(renderReport?.failedFieldWrites || []).map((item) => `${shortFieldName(item.pdfField)}: ${item.message}`),
    ...(renderReport?.adjustedFieldWrites || []).map((item) => `${shortFieldName(item.pdfField)}: ${item.reason}`),
  ];
}

// Is this form's saved copy behind the case's data? The editor shows the case's CURRENT data (it merges the canonical profile when it opens), but a download is
// built from what is saved on the form - so a name, e-mail or any answer that reached the case through another path (client portal, staff edit, profile, sync) after
// the form was last filled used to be missing from the downloaded PDF. The case's canonical profile carries a version that goes up with every change, and the form
// remembers the version it was filled from: a higher case version means the form is behind. One small read; never throws (false = "cannot tell", i.e. old behaviour).
async function isBehindCanonical(caseForm, deps = {}) {
  try {
    if (!caseForm || !caseForm.caseId || (caseForm.versionNumber || 0) <= 0) return false;
    if (!deps.Case && require("mongoose").connection.readyState !== 1) return false; // no database connection: cannot tell, and must not wait for one
    const CaseModel = deps.Case || require("../../../models/Case");
    const row = await CaseModel.findById(caseForm.caseId).select("canonicalProfile.version").lean();
    const caseVersion = Number(row?.canonicalProfile?.version || 0);
    const syncedVersion = Number(caseForm.syncState?.canonicalVersion || 0);
    return caseVersion > syncedVersion;
  } catch (_error) {
    return false;
  }
}

async function prepareOfficialDownload({ caseFormId, user, req, deferBookkeeping = false }, deps = {}) {
  const generation = deps.PDFGenerationService || PDFGenerationService;
  const renderer = deps.PDFRenderer || PDFRenderer;
  const adobeEnabled = deps.adobeEnabled ?? env.adobe.fillEnabled;
  const warnings = [];
  const timings = {};
  let mark = Date.now();
  const lap = (name) => { const now = Date.now(); timings[name] = now - mark; mark = now; };

  // The form itself must exist; everything after this point degrades
  // instead of failing.
  let caseForm = await generation.loadCaseForm(caseFormId, { readOnly: false });
  const isHistorical = caseForm.isLocked || ["locked", "filed"].includes(caseForm.status);
  const flaggedStale = Boolean(caseForm.syncState?.stale) || !caseForm.syncState?.lastSyncedAt;
  // behind the case's data without having been flagged: refreshed too, from the case's already-built profile (no 8-second rebuild)
  const behind = !isHistorical && !flaggedStale && (await isBehindCanonical(caseForm, deps));
  const wasStale = flaggedStale || behind;

  if (!isHistorical && wasStale) {
    try {
      const AutoFillService = deps.AutoFillService || require("../../form-mapping/services/AutoFillService");
      await AutoFillService.generate(caseForm.caseId, caseForm.formCode, user, req, { regenerate: true, ...(behind ? { useStoredCanonical: true } : {}) });
      caseForm = await generation.loadCaseForm(caseFormId, { readOnly: true });
    } catch (error) {
      warnings.push(`Could not refresh the form from the latest case data (${error.message}); downloaded with the values last saved.`);
      try {
        caseForm = await generation.loadCaseForm(caseFormId, { readOnly: true });
      } catch (reloadError) {
        // keep the form already loaded
      }
    }
  }

  lap("loadAndRefresh");
  const template = caseForm.formTemplateId.toObject();
  let result = null;
  let mode = null;

  // Everything the live form view shows must be in the file: a box the saved copy never received is filled from the case's current data, in memory only (see
  // LiveFormValues.js). Anything that goes wrong here leaves the saved copy as it was.
  const LiveFormValues = deps.LiveFormValues || require("./LiveFormValues");
  const live = await withTimeout(LiveFormValues.gapFill({ caseForm, template, user, req }, deps), Number(process.env.FORM_DOWNLOAD_LIVE_VALUES_TIMEOUT_MS || 20000), "Live form values")
    .catch((error) => ({ filledData: null, filledFieldIds: [], skipped: error.message }));
  const renderForm = live.filledData ? LiveFormValues.withFilledData(caseForm, live.filledData) : caseForm;
  if (live.restoredFieldIds?.length) warnings.push(`${live.restoredFieldIds.length} box(es) had been saved as empty by a PDF edit although the case holds a value for them; the value was restored in this download (nothing was changed on the case).`);
  if (live.filledFieldIds.length) warnings.push(`${live.filledFieldIds.length} box(es) shown on the live form were missing from the saved copy and were filled from the case's current data for this download.`);
  lap("liveValues");

  if (adobeEnabled) {
    try {
      const AdobeFormRenderer = deps.AdobeFormRenderer || require("./AdobeFormRenderer");
      result = await withTimeout(AdobeFormRenderer.renderFiling({ caseForm: renderForm, template }), ADOBE_TIMEOUT_MS, "Adobe form fill");
      mode = "adobe";
    } catch (error) {
      warnings.push(`The Adobe form-fill service could not process this form (${error.message}); the form was filled with the standard engine instead.`);
    }
  }

  if (!result) {
    try {
      result = await renderer.renderFiling({ caseForm: renderForm, template });
      mode = "pdf-lib";
    } catch (error) {
      warnings.push(`The form failed its strict accuracy check (${error.message}); it was downloaded without that check, so please review the values.`);
    }
  }

  if (!result) {
    try {
      const rendered = await renderer.render({ caseForm: renderForm, template, watermark: null, flatten: false });
      result = { buffer: rendered.buffer, renderReport: rendered.renderReport };
      mode = "pdf-lib-unverified";
    } catch (error) {
      warnings.push(`The form could not be filled automatically (${error.message}).`);
    }
  }

  if (!result) {
    // Last resort: the official, unfilled USCIS PDF - the user still gets
    // the real form and can complete it by hand.
    const buffer = await renderer.loadTemplateBuffer(template);
    result = { buffer, renderReport: null };
    mode = "blank-template";
    warnings.push("The blank official USCIS form was downloaded because it could not be filled automatically. Please fill it in manually.");
  }

  lap("render");
  // Phase 7.1 (FORM_PIPELINE_AUTONOMY): a form in the filing step is only handed out when it passed the strict fidelity check. Off = unchanged; shadow = logged;
  // on = refused (409) before anything is stored. Review copies and drafts are never affected.
  (deps.filingPolicy || FilingArtifactPolicy).enforce(
    (deps.filingPolicy || FilingArtifactPolicy).assessDownload({ caseForm, mode }),
    { event: "official_download", context: { caseFormId: String(caseForm._id), formCode: caseForm.formCode, status: caseForm.status, mode } }
  );
  warnings.push(...fieldWarnings(result.renderReport));

  // Data-completeness safety net (FormDataGuard): any saved value that did not reach a form box - orphan values, boxes missing from the PDF, supplement pages, rejected
  // choices, ... - is recorded in the download log with its value and named in the warning (the file itself stays the form alone - strict owner rule), so no saved value is ever silently lost. Never throws; on any problem the file
  // is served exactly as built.
  const recovery = await (deps.FormDataGuard || require("./FormDataGuard")).recover({ caseForm: renderForm, template, result, mode }, deps);
  if (recovery.buffer) result = { ...result, buffer: recovery.buffer };
  warnings.push(...recovery.warnings);
  // the download log keeps the VALUE too, so nothing that has no box on the form is ever lost (the file itself stays the form alone)
  const unplacedValues = recovery.entries.slice(0, 300).map((entry) => ({ label: entry.label || null, caseField: entry.caseField, pdfField: entry.pdfField || null, reason: entry.reason, value: String(Array.isArray(entry.value) ? entry.value.join(", ") : entry.value).slice(0, 500) }));
  lap("dataCheck");
  // Monitoring for every form, present and future (nothing here is form-specific): whenever a download had to rescue a value or found one with no box, one structured log line
  // names the form, so a new or changed form that starts losing values shows up at once instead of as a complaint. Best-effort; never affects the download.
  if (live.filledFieldIds.length || live.restoredFieldIds?.length || recovery.entries.length) {
    try {
      (deps.logger || require("../../../utils/logger")).warn("form_download_data_safeguard", {
        formCode: caseForm.componentCode || caseForm.formCode,
        caseFormId: String(caseForm._id),
        filledFromLiveView: live.filledFieldIds.length,
        restoredFromEmptyOverride: live.restoredFieldIds?.length || 0,
        noBoxOnForm: recovery.entries.length,
        reasons: [...new Set(recovery.entries.map((entry) => entry.reason))],
      });
    } catch (_error) { /* monitoring only */ }
  }

  // Keep a copy on the case and an audit trail - but never fail the download
  // because bookkeeping failed, and (when deferBookkeeping is set) do not make
  // the user wait for it: it runs after the file has been sent. A blank
  // template is not the case's filled form, so it is not stored as one.
  const bookkeeping = async () => {
    const problems = [];
    let documentId = null;
    if (mode !== "blank-template") {
      try {
        const document = await generation.createGeneratedDocument(caseForm, result.buffer, user, { valid: true }, result.renderReport, null);
        documentId = document?._id;
      } catch (error) {
        problems.push("A copy of this download could not be saved to the case documents.");
      }
    }
    try {
      await generation.audit("PDF_OFFICIAL_DOWNLOADED", caseForm, user, req, {
        documentId,
        mode,
        engine: mode,
        status: caseForm.status,
        warnings: [...warnings, ...problems].slice(0, 20),
        adjustedFieldWrites: result.renderReport?.adjustedFieldWrites || [],
        blankedFieldWrites: result.renderReport?.failedFieldWrites || [],
        unplacedValues,
      });
    } catch (error) {
      // audit is best-effort here
    }
    return problems;
  };

  if (!deferBookkeeping) warnings.push(...(await bookkeeping()));
  lap("saveCopyAndAudit");
  return { buffer: result.buffer, caseForm, mode, warnings, timings, bookkeeping: deferBookkeeping ? bookkeeping : null };
}

module.exports = { prepareOfficialDownload, isBehindCanonical, withTimeout };
