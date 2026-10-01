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
const PDFRenderer = require("./PDFRenderer");
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
  const wasStale = Boolean(caseForm.syncState?.stale) || !caseForm.syncState?.lastSyncedAt;

  if (!isHistorical && wasStale) {
    try {
      const AutoFillService = deps.AutoFillService || require("../../form-mapping/services/AutoFillService");
      await AutoFillService.generate(caseForm.caseId, caseForm.formCode, user, req, { regenerate: true });
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

  if (adobeEnabled) {
    try {
      const AdobeFormRenderer = deps.AdobeFormRenderer || require("./AdobeFormRenderer");
      result = await withTimeout(AdobeFormRenderer.renderFiling({ caseForm, template }), ADOBE_TIMEOUT_MS, "Adobe form fill");
      mode = "adobe";
    } catch (error) {
      warnings.push(`The Adobe form-fill service could not process this form (${error.message}); the form was filled with the standard engine instead.`);
    }
  }

  if (!result) {
    try {
      result = await renderer.renderFiling({ caseForm, template });
      mode = "pdf-lib";
    } catch (error) {
      warnings.push(`The form failed its strict accuracy check (${error.message}); it was downloaded without that check, so please review the values.`);
    }
  }

  if (!result) {
    try {
      const rendered = await renderer.render({ caseForm, template, watermark: null, flatten: false });
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
  warnings.push(...fieldWarnings(result.renderReport));

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

module.exports = { prepareOfficialDownload, withTimeout };
