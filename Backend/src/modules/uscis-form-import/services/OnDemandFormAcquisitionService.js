// Bridges the VisaFormMapping registry to the live USCIS import pipeline:
// given a form number the registry says a case needs but no active
// USCISFormTemplate exists for yet (templateStatus TEMPLATE_MISSING), find
// that form's current edition on uscis.gov, import it through the existing,
// unmodified importer, provision it onto the case through the existing,
// unmodified ensureAssignedForms, and autofill it through the existing
// autofill systems — never a second fetch/import/fill mechanism of its own
// (Non-Negotiable Constraints #4/#5).
const mongoose = require("mongoose");
const USCISScannerService = require("../../uscis-lifecycle/services/USCISScannerService");
const USCISFormImporterService = require("./USCISFormImporterService");
const FormVersionService = require("./FormVersionService");
const VersionManagementService = require("../../uscis-lifecycle/services/VersionManagementService");
const AutoFillService = require("../../form-mapping/services/AutoFillService");
const BiographicMappingService = require("../../form-mapping/services/BiographicMappingService");
const CanonicalProfileService = require("../../canonical/services/CanonicalProfileService");
const CanonicalBiographicAutofill = require("../../uscis-forms/CanonicalBiographicAutofill");
const uscisFormService = require("../../uscis-forms/uscis-form.service");
const CaseForm = require("../../../models/CaseForm");
const VisaFormMapping = require("../../../models/VisaFormMapping");
const USCISFormTemplate = require("../../../models/USCISFormTemplate");
const logger = require("../../../utils/logger");

const versionService = new FormVersionService();

// Same-process concurrency guard for ensureCurrentUSCISForm: without this,
// N simultaneous callers for the same formCode (e.g. several case-managers'
// tabs, or a case's "Acquire" click firing twice) would each independently
// decide "no local template" or "edition looks stale" and race into N
// downloads/imports. Cross-process/duplicate-document safety already exists
// further down the pipeline (USCISFormImporterService's checksum-based
// duplicate detection, CaseForm's unique index) — this just avoids paying
// for N redundant USCIS fetches within one Node process by having every
// concurrent caller await the same in-flight promise and share its result.
const inFlightEnsures = new Map();

function normalizeFormCode(value = "") {
  return String(value).trim().toUpperCase();
}

function enterpriseError(message, statusCode, code) {
  return Object.assign(new Error(message), { statusCode, status: statusCode, code });
}

// A real, standalone USCIS form code (I-129, N-400, DS-160, ETA-9035, ...) -
// deliberately excludes compound "formNumber" values the registry also
// stores for FORM_COMPONENT/SUPPLEMENT mappings, e.g. "I-129 O/P
// Classification Supplement" (confirmed live against this DB: that exact
// string is a real VisaFormMapping.formNumber for an O-1A case, and it has
// no uscis.gov page of its own - the supplement's pages ship inside its
// parent form's own PDF/template, not as a separately fetchable form).
const STANDALONE_FORM_CODE_PATTERN = /^[A-Z]{1,3}-\d{2,4}[A-Z]?$/;

// USCIS's own site convention for a form's individual page (confirmed
// against real, live URLs — uscis.gov/i-129, uscis.gov/n-400, uscis.gov/
// i-485, uscis.gov/i-140, etc.). Not itself a scraper — just the entry
// point handed to the scanner's OWN existing fetchPage/
// extractFormPageMetadata, which do the actual HTML parsing (reused
// verbatim, per Constraint #4). Returns null for a non-standalone
// (component/supplement) formNumber, which has no such page - callers must
// check for null rather than fetching a guaranteed-broken/misleading URL.
function guessedFormPageUrl(formNumber) {
  const formCode = normalizeFormCode(formNumber);
  if (!STANDALONE_FORM_CODE_PATTERN.test(formCode)) return null;
  return `https://www.uscis.gov/${formCode.toLowerCase()}`;
}

// Resolves {pdfUrl, editionDate, officialPageUrl} for a form number with no
// pre-known page URL (unlike USCISScannerService.scanForm, which requires
// formConfig.pageUrl already be configured — there is no such static config
// for the ~182 registry-mapped forms, so this fills that gap). Two-tier: try
// the form's own conventional page first (fast, works for the overwhelming
// majority of USCIS forms), then fall back to the forms directory listing.
// Both tiers reuse USCISScannerService's own fetch/parse — never a new
// scraper — and USCISScannerService.fetchPage itself enforces the *.uscis.gov
// host guard (Constraint #5), so this cannot be pointed at an arbitrary URL.
async function resolveOfficialPdf(formNumber) {
  const formCode = normalizeFormCode(formNumber);
  const pageUrl = guessedFormPageUrl(formCode);
  if (!pageUrl) {
    throw enterpriseError(
      `"${formCode}" is not a standalone USCIS form — it's a component/supplement distributed as part of its parent form's own PDF, with no separate uscis.gov page to fetch. Import its parent form instead (or via the registry's Upload PDF flow if it needs to be added as its own template).`,
      422,
      "USCIS_FORM_NOT_STANDALONE"
    );
  }
  try {
    const html = await USCISScannerService.fetchPage(pageUrl);
    const meta = USCISScannerService.extractFormPageMetadata(html, pageUrl, formCode);
    if (meta.pdfUrl) return { pdfUrl: meta.pdfUrl, editionDate: meta.editionDate, officialPageUrl: pageUrl, formName: meta.formName };
  } catch (error) {
    // Page doesn't exist at the conventional slug, or fetch failed — fall
    // through to the directory search below rather than failing outright.
  }
  try {
    const directoryHtml = await USCISScannerService.fetchPage(USCISScannerService.OFFICIAL_SOURCES?.formsDirectoryUrl || "https://www.uscis.gov/forms/all-forms");
    const directoryForms = USCISScannerService.extractDirectoryForms(directoryHtml);
    const match = directoryForms.find((item) => normalizeFormCode(item.formCode) === formCode);
    if (match?.pdfUrl) return { pdfUrl: match.pdfUrl, editionDate: match.editionDate, officialPageUrl: match.pageUrl || pageUrl, formName: match.formName };
    if (match?.pageUrl) {
      const html = await USCISScannerService.fetchPage(match.pageUrl);
      const meta = USCISScannerService.extractFormPageMetadata(html, match.pageUrl, formCode);
      if (meta.pdfUrl) return { pdfUrl: meta.pdfUrl, editionDate: meta.editionDate, officialPageUrl: match.pageUrl, formName: meta.formName };
    }
  } catch (error) {
    // Directory fetch/parse failed too — fall through to the typed error.
  }
  throw enterpriseError(
    `Could not locate a current PDF for ${formCode} on uscis.gov — import it manually via the form registry's Upload PDF flow.`,
    422,
    "USCIS_PDF_UNRESOLVED"
  );
}

// Shared by both "form never seen before" and "new edition detected"
// acquisition paths — a freshly-imported template (via
// USCISFormImporterService for a missing form, or via
// USCISScannerService.scanForm for a newly-detected edition) always lands
// in draft/review status; this is the one place that tries to move it to
// production-active, or failing that, to the biographic-fallback tier.
// Extracted from the original acquireAndActivate (no behavior change) so
// ensureCurrentUSCISForm's new-edition branch reuses it instead of
// duplicating the approve/activate/biographic-tier sequence.
async function activateOrPromote(template, user, req) {
  const autoActivate = String(process.env.USCIS_ONDEMAND_AUTOACTIVATE || "").toLowerCase() === "true";
  let activationBlockedReason = null;
  if (autoActivate && template.status !== "active") {
    // VersionManagementService.activate() requires the edition to already
    // be approved (confirmed live: activating a freshly-imported draft
    // directly throws "Approve the USCIS form edition before activation") -
    // the same two-step approve-then-activate an admin performs manually
    // via the registry console's own "Approve"/"Activate" buttons
    // (uscis-form.controller.js's approveTemplate/activateTemplate), done
    // here in sequence rather than skipping the approval gate.
    if (template.status !== "review") {
      template = await VersionManagementService.approve(template._id, user, req);
    }
    try {
      template = await versionService.activate(template._id, user, req);
      logger.info("uscis_form_activated", { formCode: template.formCode, templateId: String(template._id), version: template.version });
    } catch (error) {
      // Also confirmed live: activate() additionally requires
      // template.mappingStatus === "active" - i.e. a human-reviewed field-
      // mapping graph, which by definition does not exist yet for a form
      // that was JUST fetched with no curated crosswalk (this is precisely
      // the gap CanonicalBiographicAutofill's fallback exists to partially
      // cover at the FIELD-VALUE level - it does not and must not touch
      // this template-level mapping-review gate). This is Constraint #3's
      // human/attorney gate working as designed, not a bug to route around:
      // the template stays at "review" and this is reported back as
      // requiresActivation, not silently swallowed or forced through.
      activationBlockedReason = error.message;
      logger.info("uscis_form_mapping_review_required", { formCode: template.formCode, templateId: String(template._id), reason: error.message });
    }
  }

  // Biographic Activation tier: since full production activation is
  // correctly blocked without a human-reviewed curated mapping (above),
  // promote the template to mappingStatus:"biographic_active" instead -
  // never a substitute for real activation (template.status stays
  // "review", VersionManagementService.activate's Gate 2 still and always
  // refuses it), just enough to unlock biographic-core autofill via
  // AutoFillService's biographicFallback option. Idempotent - safe even if
  // this template was already promoted by a prior acquisition.
  let biographicMapping = null;
  if (template.status !== "active") {
    biographicMapping = await BiographicMappingService.ensureBiographicMapping(template, user, req);
    if (!biographicMapping.skipped) template = biographicMapping.template;
  }

  uscisFormService.invalidateTemplateCache();
  return {
    template,
    requiresActivation: template.status !== "active",
    activationBlockedReason,
    biographicReady: template.mappingStatus === "biographic_active",
    coverage: biographicMapping?.coverage || null,
  };
}

// The "form has never been acquired at all" path — resolve → download →
// import (via the existing, unmodified USCISFormImporterService) →
// activateOrPromote. Extracted from the original acquireAndActivate (no
// behavior change) so ensureCurrentUSCISForm's "missing" branch and the
// legacy acquireAndActivate entry point share one implementation.
async function acquireMissingForm(formCode, user, req) {
  logger.info("uscis_form_download_started", { formCode });
  const resolved = await resolveOfficialPdf(formCode);
  const importResult = await USCISFormImporterService.importFromUrl(
    {
      pdfUrl: resolved.pdfUrl,
      formType: formCode,
      source: "on_demand_acquisition",
      officialPageUrl: resolved.officialPageUrl,
      editionDate: resolved.editionDate,
    },
    user,
    req
  );
  logger.info("uscis_form_download_completed", { formCode, templateId: String(importResult.template._id) });
  const activation = await activateOrPromote(importResult.template, user, req);
  return { ...activation, alreadyActive: false };
}

// ensureCurrentUSCISForm — the single entry point that both "a case needs a
// form it has never had" and "an explicit staleness check" now go through.
// This is the piece that was missing: the old acquireAndActivate (below)
// only ever asked "does any active local template exist?" — if yes, it
// returned immediately and NEVER checked USCIS for a newer edition. That
// edition-diff logic already existed, correctly, inside the decoupled
// background monitoring job (USCISScannerService.scanForm/scanAll +
// FormComparisonService) — this wires the same, unmodified scanner function
// into the case-triggered path instead of duplicating its logic.
//
// forceCheck:true (used by the explicit "Acquire from USCIS" action) always
// asks USCIS. forceCheck:false (available for future callers) additionally
// skips the network call entirely when the existing template was checked
// within USCIS_ENSURE_CHECK_TTL_MS — this is what keeps ordinary read paths
// (forms-overview, page loads) from ever triggering a USCIS request; none
// of them call this function at all today, and if one ever does, this TTL
// is what stops it from becoming a per-request network call.
async function ensureCurrentUSCISForm(formNumber, user, req, options = {}) {
  const formCode = normalizeFormCode(formNumber);
  const dedupeKey = `${formCode}:${options.forceCheck ? "force" : "ttl"}`;
  if (inFlightEnsures.has(dedupeKey)) {
    logger.info("uscis_form_acquisition_deduplicated", { formCode });
    return inFlightEnsures.get(dedupeKey);
  }
  const run = ensureCurrentUSCISFormInner(formCode, user, req, options).finally(() => {
    inFlightEnsures.delete(dedupeKey);
  });
  inFlightEnsures.set(dedupeKey, run);
  return run;
}

async function ensureCurrentUSCISFormInner(formCode, user, req, options) {
  const forceCheck = Boolean(options.forceCheck);
  const ttlMs = Number(process.env.USCIS_ENSURE_CHECK_TTL_MS || 12 * 60 * 60 * 1000);
  const existing = await uscisFormService.findLatestActiveTemplate(formCode);

  if (!existing) {
    logger.info("uscis_form_check_started", { formCode, reason: "missing" });
    const result = await acquireMissingForm(formCode, user, req);
    logger.info("uscis_form_check_completed", { formCode, outcome: "acquired" });
    return result;
  }

  const lastCheckedAt = existing.lastChecked ? new Date(existing.lastChecked).getTime() : 0;
  if (!forceCheck && Date.now() - lastCheckedAt < ttlMs) {
    return { template: existing, alreadyActive: true, requiresActivation: false, checked: false };
  }

  // A component/supplement formNumber (e.g. an I-129 classification
  // supplement) has no standalone uscis.gov page of its own to check —
  // nothing to compare against, so the existing template stands.
  const pageUrl = guessedFormPageUrl(formCode);
  if (!pageUrl) {
    return { template: existing, alreadyActive: true, requiresActivation: false, checked: false };
  }

  logger.info("uscis_form_check_started", { formCode, reason: forceCheck ? "forced" : "ttl_expired" });
  let scanResult;
  try {
    scanResult = await USCISScannerService.scanForm({ formType: formCode, pageUrl }, user, req);
  } catch (error) {
    // USCIS unreachable — the existing, previously-validated template is
    // still safe to keep serving. Never let a network failure here break a
    // case that already has a working form.
    logger.info("uscis_form_check_completed", { formCode, outcome: "uscis_unavailable", error: error.message });
    return { template: existing, alreadyActive: true, requiresActivation: false, checked: true, checkError: error.message };
  }

  if (scanResult.action === "scan_failed") {
    logger.info("uscis_form_check_completed", { formCode, outcome: "uscis_unavailable", error: scanResult.error });
    return { template: existing, alreadyActive: true, requiresActivation: false, checked: true, checkError: scanResult.error };
  }

  if (scanResult.action === "no_change_detected") {
    logger.info("uscis_form_check_completed", { formCode, outcome: "no_change" });
    return { template: existing, alreadyActive: true, requiresActivation: false, checked: true };
  }

  // action === "draft_version_created": USCIS has published a different
  // edition. scanForm already created the new template in draft/review
  // status WITHOUT touching the existing active one (never a silent
  // replacement), and already ran FormComparisonService against the old
  // version — reuse that comparison report rather than re-deriving it.
  logger.info("uscis_form_version_detected", { formCode, previousTemplateId: String(existing._id), newTemplateId: String(scanResult.templateId) });
  const newTemplate = await USCISFormTemplate.findById(scanResult.templateId);
  const activation = await activateOrPromote(newTemplate, user, req);
  if (activation.template.status === "active") {
    logger.info("uscis_form_mapping_migrated", { formCode, templateId: String(activation.template._id) });
  }
  logger.info("uscis_form_check_completed", { formCode, outcome: activation.template.status === "active" ? "new_edition_activated" : "new_edition_pending_review" });

  const currentTemplate = activation.template.status === "active" ? activation.template : existing;
  return {
    template: currentTemplate,
    previousTemplate: existing,
    newTemplateId: newTemplate._id,
    alreadyActive: false,
    requiresActivation: activation.requiresActivation,
    activationBlockedReason: activation.activationBlockedReason,
    biographicReady: activation.biographicReady,
    coverage: activation.coverage,
    comparisonReport: scanResult.comparisonReport,
    checked: true,
    versionChanged: true,
  };
}

// Legacy entry point, kept for backward compatibility with every existing
// caller (acquireForCase below, and any other code that imports this
// directly) — now a thin delegation to ensureCurrentUSCISForm with
// forceCheck:true, since an explicit "Acquire from USCIS" click should
// always ask USCIS, not rely on the TTL fast path. Return shape unchanged:
// {template, alreadyActive, requiresActivation, activationBlockedReason,
// biographicReady, coverage} — callers destructuring exactly those fields
// are unaffected by the additional fields ensureCurrentUSCISForm may return.
async function acquireAndActivate(formNumber, user, req) {
  return ensureCurrentUSCISForm(formNumber, user, req, { forceCheck: true });
}

// Full case-scoped flow: acquire+activate the template, provision it onto
// the case through the exact same single-template path
// visaFormMapping.service.js's recordConditionalDecision already uses
// (ensureAssignedForms with options.templates — never a second CaseForm-
// creation function), then autofill it through the existing curated system
// first and the biographic fallback second (Phase 3's precedence: curated >
// heuristic > blank).
async function acquireForCase(caseId, formNumber, user, req) {
  const caseData = await uscisFormService.getAccessibleCase(caseId, user, { requestId: req?.requestId });
  const formCode = normalizeFormCode(formNumber);

  // Server-side enforcement of the same agency gate
  // form-registry.controller.js's deriveUiStatus already applies client-side
  // (it only ever offers "Acquire from USCIS" when
  // VisaFormMapping.agency === "USCIS" — confirmed live against this DB's
  // real registry: DOS's DS-160/DS-156E, DOL's ETA-9035/ETA-790, and
  // SEVP/school-issued I-20/DS-2019 all have real mappings with a non-USCIS
  // agency and no uscis.gov page at all). The UI not showing the button is
  // a UX nicety, not a trust boundary — this is the actual boundary: reject
  // the request outright rather than letting it fall through to
  // resolveOfficialPdf, which would guess a nonsensical uscis.gov URL for a
  // form that was never USCIS's to begin with and fail late/confusingly.
  const mapping = await VisaFormMapping.findOne({ formNumber: formCode, active: true }).select("agency").lean();
  if (mapping?.agency && mapping.agency !== "USCIS") {
    throw enterpriseError(
      `${formCode} is a ${mapping.agency} form, not a downloadable USCIS PDF — it can't be fetched from uscis.gov. See the VisaFormMapping registry entry for how to obtain it.`,
      422,
      "USCIS_FORM_WRONG_AGENCY"
    );
  }

  const acquisition = await acquireAndActivate(formCode, user, req);
  const { template, requiresActivation, activationBlockedReason, biographicReady, coverage } = acquisition;

  if (requiresActivation && !biographicReady) {
    // No production template AND no biographic-tier mapping either (e.g.
    // BiographicMappingService found zero fields above the confidence
    // threshold) - left as a draft/review-pending edition for an admin to
    // finish reviewing, never provisioned onto a live case while still
    // completely unreviewed. This is Constraint #3's human/attorney gate,
    // not a bug.
    return { template, requiresActivation: true, activationBlockedReason, biographicReady: false, caseForm: null, autofill: null };
  }

  let caseForm;
  if (template.status === "active") {
    // Full production template - provision through the standard, unmodified
    // ensureAssignedForms single-template path (recordConditionalDecision's
    // own pattern) exactly as before.
    const mapping = await VisaFormMapping.findOne({
      visaType: caseData.visaType,
      formTemplateFormCode: formCode.toLowerCase(),
      active: true,
    }).lean();
    const templateForProvisioning = {
      ...(template.toObject ? template.toObject() : template),
      _visaFormMapping: mapping
        ? {
            mappingId: mapping._id,
            provisioningType: mapping.provisioningType,
            createdReason: `VisaFormMapping registry: ${mapping.visaType} -> ${mapping.formNumber} (on-demand USCIS acquisition)`,
            visaType: caseData.visaType,
            processingPath: caseData.processingPath || "",
          }
        : undefined,
    };
    const created = await uscisFormService.ensureAssignedForms(caseData, user, req, { templates: [templateForProvisioning] });
    caseForm = created[0] || await CaseForm.findOne({ caseId: caseData._id, formCode }).sort({ updatedAt: -1 });
  } else {
    // Biographic-tier template (status still "review", mappingStatus
    // "biographic_active") - ensureAssignedForms only ever provisions
    // status:"active" templates (by design - Constraint #1's "never touch
    // ensureAssignedForms' metadataOnly early-return" extends to not
    // routing unreviewed templates through the same path a fully-activated
    // one uses), so the CaseForm is created directly here instead. Upsert,
    // never a duplicate: same (caseId, formCode) uniqueness every other
    // CaseForm creation path in this codebase relies on.
    caseForm = await CaseForm.findOneAndUpdate(
      { caseId: caseData._id, formCode },
      {
        $setOnInsert: {
          caseId: caseData._id,
          formCode,
          formTemplateId: template._id,
          formVersion: template.version,
          formEditionDate: template.editionDate,
          status: "pending",
          filledData: {},
          fieldValues: {},
        },
      },
      { upsert: true, new: true }
    );
  }
  if (!caseForm) {
    throw enterpriseError(`${formCode} was acquired but could not be provisioned onto this case.`, 500, "ACQUIRED_FORM_NOT_PROVISIONED");
  }

  // Curated/biographic-graph fill first (AutoFillService.generate — the
  // same pipeline "Generate USCIS Forms"/"Refresh Auto Fill" already runs
  // for every other form on the case). biographicFallback:true lets this
  // succeed against a mappingStatus:"biographic_active" template instead of
  // 404ing - existing callers that don't pass it are unaffected. Safe to
  // call even with zero curated/biographic edges: FormMappingService.
  // mapTemplate leaves an unmapped field blank rather than erroring.
  let curatedFill = null;
  try {
    curatedFill = await AutoFillService.generate(caseData._id, formCode, user, req, { biographicFallback: true });
  } catch (error) {
    curatedFill = { error: error.message };
  }

  // Label-matching heuristic fallback second — fills whatever the
  // mapping-graph-driven pass (curated or biographic) left blank, using the
  // same canonical profile. A different, complementary matching strategy
  // (field label regex vs. MappingGraphService's token-overlap scoring), so
  // the two catch different fields; never overwrites what the pass above
  // already filled.
  let biographicFill = null;
  try {
    const canonicalState = await CanonicalProfileService.get(caseData._id, user, req).catch(() => null);
    const canonicalProfile = canonicalState?.profile || caseData.canonicalProfile?.profile || {};
    biographicFill = await CanonicalBiographicAutofill.fillMissingBiographicFields(caseForm._id, canonicalProfile);
  } catch (error) {
    biographicFill = { error: error.message };
  }

  return { template, requiresActivation: template.status !== "active", biographicReady, coverage, caseForm, autofill: { curatedFill, biographicFill } };
}

module.exports = {
  resolveOfficialPdf,
  ensureCurrentUSCISForm,
  acquireAndActivate,
  acquireForCase,
  guessedFormPageUrl,
};
