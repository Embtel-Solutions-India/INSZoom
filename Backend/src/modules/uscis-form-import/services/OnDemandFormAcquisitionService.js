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
const { migrateMappingToEdition, checkEditionReady, findPreviousEdition } = require("../../form-mapping/services/EditionMigrationService");
const { deriveVisaTypesFromRegistry } = require("../seeds/deriveVisaTypesFromRegistry");
const { migrateCaseFormsToEdition } = require("../../form-mapping/services/CaseFormEditionMigrationService");
const BiographicMappingService = require("../../form-mapping/services/BiographicMappingService");
const MappingGraphService = require("../../form-mapping/services/MappingGraphService");
const PartyFieldMappingService = require("../../form-mapping/services/PartyFieldMappingService");
const FormCertificationService = require("../../form-mapping/services/FormCertificationService");
const { retryUntilSuccess } = require("../../../utils/resilientRetry");
const CanonicalProfileService = require("../../canonical/services/CanonicalProfileService");
const CanonicalBiographicAutofill = require("../../uscis-forms/CanonicalBiographicAutofill");
const uscisFormService = require("../../uscis-forms/uscis-form.service");
const caseFormSelection = require("../../uscis-forms/case-form-selection.service");
const CaseForm = require("../../../models/CaseForm");
const VisaFormMapping = require("../../../models/VisaFormMapping");
const USCISFormTemplate = require("../../../models/USCISFormTemplate");
const logger = require("../../../utils/logger");
const { pageUrlFor: aliasPageUrl } = require("../config/formSourceAliases");

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

// BUG (fixed): a VisaFormMapping.formNumber for a genuinely-separate
// SUPPLEMENT (componentType SUPPLEMENT, its own USCISFormTemplate — never a
// FORM_COMPONENT page-range) is stored spelled out, e.g. "I-918 Supplement
// B", "I-485 Supplement A/J" (see visaFormMappings.seed.js). normalizeFormCode
// alone left the space and the word "SUPPLEMENT" in place, which failed
// STANDALONE_FORM_CODE_PATTERN outright and threw USCIS_FORM_NOT_STANDALONE
// before ever reaching the parent-page fallback below — even though that
// fallback exists SPECIFICALLY for this class of form (its own comment
// already names I-918 Supplement A/B) and already works correctly for the
// compact form of the same idea (confirmed live: "I-130A" resolves fine).
// Collapsing "<parent> Supplement <letter>" to "<parent><letter>" here
// (I-918 Supplement B -> I918B) is enough to let that same, already-correct
// fallback do its job — no other logic in this file changes.
function compactSupplementCode(formCode) {
  return formCode.replace(/^([A-Z]{1,3}-\d{2,4})\s+SUPPLEMENT\s+([A-Z0-9]{1,2})$/, "$1$2");
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
// Up to 2 trailing letters (not just 1) - real USCIS codes include e.g.
// I-864EZ (confirmed live: uscis.gov/i-864ez is a genuine standalone form
// page, not a supplement; the previous 1-letter-only pattern wrongly
// rejected it as USCIS_FORM_NOT_STANDALONE).
const STANDALONE_FORM_CODE_PATTERN = /^[A-Z]{1,3}-\d{2,4}[A-Z]{0,2}$/;

// USCIS's own site convention for a form's individual page (confirmed
// against real, live URLs — uscis.gov/i-129, uscis.gov/n-400, uscis.gov/
// i-485, uscis.gov/i-140, etc.). Not itself a scraper — just the entry
// point handed to the scanner's OWN existing fetchPage/
// extractFormPageMetadata, which do the actual HTML parsing (reused
// verbatim, per Constraint #4). Returns null for a non-standalone
// (component/supplement) formNumber, which has no such page - callers must
// check for null rather than fetching a guaranteed-broken/misleading URL.
function guessedFormPageUrl(formNumber) {
  const formCode = compactSupplementCode(normalizeFormCode(formNumber));
  if (!require("../config/formCodePattern").isStandaloneFormCode(formCode, "importer")) return null; // Phase 7.2: the one shared pattern; with the switch off it IS the old pattern
  // Phase 7.E: USCIS publishes some forms under another address (I-485J -> /i-485supj); the alias data knows them, everything else keeps the code-derived address
  return aliasPageUrl(formCode) || `https://www.uscis.gov/${formCode.toLowerCase()}`;
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
  const formCode = compactSupplementCode(normalizeFormCode(formNumber));
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
    // BUG (fixed): the directory lists a genuinely-separate SUPPLEMENT
    // spelled out exactly like its VisaFormMapping.formNumber ("I-485
    // Supplement A"/"I-485 Supplement J"), never in the compact form used
    // above for the parent-suffix fallback ("I-485A") - comparing against
    // the compact `formCode` here never matched, so this tier silently
    // found nothing for either and both requests fell through to the SAME
    // last-resort "first PDF on the page" fallback deeper in this file,
    // resolving both to the base I-485 PDF (confirmed live: byte-identical
    // downloads for "Supplement A" and "Supplement J"). Checking the
    // original, un-compacted formNumber too is what actually matches the
    // directory's own listing.
    const originalCode = normalizeFormCode(formNumber);
    const codeMatches = directoryForms.filter((item) => {
      const itemCode = normalizeFormCode(item.formCode);
      return itemCode === formCode || itemCode === originalCode;
    });
    // The directory lists several rows per form code (the real form-detail
    // page, a "File Online" link to my.uscis.gov, a generic "Form Details"
    // stub) - .find()'s natural array order isn't guaranteed to put the real
    // page first (confirmed live: "File Online" preceded the actual
    // "Supplement A to Form I-485..." row for this exact form), so prefer
    // whichever match has a real, descriptive formName over those two
    // generic placeholders, falling back to the first match if that's all
    // there is.
    const match = codeMatches.find((item) => !["File Online", "Form Details"].includes(item.formName)) || codeMatches[0];
    if (match?.pdfUrl) return { pdfUrl: match.pdfUrl, editionDate: match.editionDate, officialPageUrl: match.pageUrl || pageUrl, formName: match.formName };
    if (match?.pageUrl) {
      const html = await USCISScannerService.fetchPage(match.pageUrl);
      const meta = USCISScannerService.extractFormPageMetadata(html, match.pageUrl, formNumber);
      if (meta.pdfUrl) return { pdfUrl: meta.pdfUrl, editionDate: meta.editionDate, officialPageUrl: match.pageUrl, formName: meta.formName };
    }
  } catch (error) {
    // Directory fetch/parse failed too — fall through to the parent-page
    // fallback below.
  }
  // Some lettered sub-forms (confirmed live: I-130A, I-918 Supplement A/B)
  // have no page or directory entry of their own - USCIS distributes their
  // PDF as a second download link on their PARENT form's own page (e.g.
  // uscis.gov/i-130 links both I-130 and I-130A). Only tried for a code that
  // looks like "<parent><1-2 letters>" - never for a bare form code, so this
  // can't misfire into fetching an unrelated page.
  const parentSuffixMatch = formCode.match(/^([A-Z]{1,3}-\d{2,4})([A-Z]{1,2})$/);
  if (parentSuffixMatch) {
    const parentFormCode = parentSuffixMatch[1];
    const parentPageUrl = guessedFormPageUrl(parentFormCode);
    if (parentPageUrl) {
      try {
        const html = await USCISScannerService.fetchPage(parentPageUrl);
        // BUG (fixed): extractFormPageMetadata's own anchor match strips to
        // alphanumeric-only and compares as a plain substring - the compact
        // formCode here ("I-485A" -> "I485A") is NEVER a substring of the
        // real anchor text USCIS actually uses ("I-485 Supplement A" ->
        // "I485SUPPLEMENTA"), so it always missed and silently fell through
        // to that function's OWN last-resort "first non-instructions PDF on
        // the page" fallback - returning the SAME link (confirmed live:
        // "Supplement A" and "Supplement J" both resolved to byte-identical
        // downloads) no matter which supplement letter was actually
        // requested. The un-compacted original formNumber ("I-485 Supplement
        // A") strips to the exact same "I485SUPPLEMENTA" the real anchor
        // text does, so passing that instead - only for this match, the URL
        // guess above still needs the compact parent code - lets the
        // existing match logic actually find the right link.
        const meta = USCISScannerService.extractFormPageMetadata(html, parentPageUrl, formNumber);
        if (meta.pdfUrl) return { pdfUrl: meta.pdfUrl, editionDate: meta.editionDate, officialPageUrl: parentPageUrl, formName: meta.formName };
      } catch (error) {
        // Parent page fetch/parse failed too - fall through to the typed error.
      }
    }
  }
  // Phase 7.E: last resort before failing - the verified source resolver (it only runs where the paths above found nothing, so a form that resolved before resolves the same way)
  try {
    const { resolveSource } = require("./SourceResolver");
    const found = await resolveSource({ formCode });
    if (found.ok && found.pdfUrl) {
      logger.info("uscis_source_resolved_by_fallback", { formCode, via: found.via, pdfUrl: found.pdfUrl });
      return { pdfUrl: found.pdfUrl, editionDate: null, officialPageUrl: found.pageUrl || guessedFormPageUrl(formCode), formName: formCode };
    }
  } catch (error) {
    logger.warn("uscis_source_resolver_failed", { formCode, error: error.message });
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
// Where the filer's data belongs (beneficiary.* applicant vs petitioner.*) is decided from the registry, never guessed: inference (which maps the filer's own block to
// the applicant root beneficiary.*) is allowed only when every registry visa type using this form is a single-applicant case. A petition / sponsored form (family or
// employer structure) keeps its earlier edition's verified mapping or its authored rules instead; a form the registry does not know is inferred only if it is not a petition.
async function inferenceAllowed(template) {
  try {
    const { getCaseStructure } = require("../../../config/visaCategories");
    const code = template.formCode;
    const rows = await VisaFormMapping.find({ active: true, $or: [{ formNumber: code }, { formTemplateFormCode: String(code).toLowerCase() }, { parentForm: code }] }).select("visaType").lean();
    const structures = [...new Set(rows.map((row) => getCaseStructure(row.visaType)).filter(Boolean))];
    if (structures.length) return structures.every((structure) => structure === "single");
    return !/^\s*petition/i.test(String(template.formName || template.title || ""));
  } catch (_error) {
    return false; // when in doubt, do not infer
  }
}

// `pipeline` (optional, Phase 1): the job context of the durable pipeline. With it each major step is recorded as a stage of the job and the promotion step is
// lease-checked and mutex-guarded; without it every stage() below simply runs its function, so behavior is exactly what it was.
async function activateOrPromote(template, user, req, pipeline = null) {
  const stage = (name, fn) => (pipeline ? pipeline.stage(name, fn) : fn());
  // Carry the field mapping onto this edition automatically (previous edition's graph, or the form's authored crosswalk). A lossless result
  // activates the mapping, and the edition is then activated below so every visa uses it; a lossy one leaves the old edition in service.
  let migration = null;
  try {
    migration = await stage("map", () => migrateMappingToEdition(template, user, req));
    if (migration.migrated) {
      template = await USCISFormTemplate.findById(template._id);
      logger.info("uscis_form_mapping_migrated", { formCode: template.formCode, templateId: String(template._id), activated: migration.activated, reason: migration.reason, lost: migration.lostEdges?.length || 0, source: migration.summary?.source });
    }
  } catch (error) {
    logger.info("uscis_form_mapping_migration_failed", { formCode: template.formCode, error: error.message });
  }
  // Forms with authored, verified field rules (partyFieldRules.js) get their mapping built from those rules by code - retried until it saves - so a freshly
  // imported edition is mapped without any person or AI step. Idempotent: an already-correct graph reports "unchanged".
  let ruleMapping = null;
  // (a form with no authored rules gets conservative rules inferred from its own PDF field names - FieldRuleInferenceService - so ANY imported form is mapped by code)
  {
    try {
      ruleMapping = await stage("map", () => retryUntilSuccess(async () => PartyFieldMappingService.apply(template, user, req, { allowInference: await inferenceAllowed(template) }), { attempts: 4, label: `rules:${template.formCode}`, onRetry: (info) => logger.info("uscis_form_rule_mapping_retry", { formCode: template.formCode, attempt: info.attempt, error: info.error.message }) }));
      logger.info("uscis_form_rule_mapping_applied", { formCode: template.formCode, saved: ruleMapping.saved, activated: ruleMapping.activated, matched: ruleMapping.matched, skipped: ruleMapping.skipped, error: ruleMapping.error, validation: ruleMapping.validation });
      template = await USCISFormTemplate.findById(template._id);
    } catch (error) {
      logger.info("uscis_form_rule_mapping_failed", { formCode: template.formCode, error: error.message });
    }
  }
  // Phase 4 (optional, OFF unless FORM_AI_MAPPING=shadow|on): Gemini suggestions for the boxes the rules left unmapped. Shadow only stores them; "on" adds validated low-risk ones to a
  // NEW mapping version of a pending edition (and only while the accuracy gate is open) BEFORE certification, so they are certified with the rest. Never fails the pipeline.
  try {
    const aiMapping = require("../../form-ai-mapping");
    if (aiMapping.mode() !== "off") {
      await stage("ai_map", async () => {
        try { return await aiMapping.runForTemplate({ template, user, req }); } catch (error) { logger.info("uscis_form_ai_mapping_skipped", { formCode: template.formCode, error: error.message }); return { skipped: true, error: error.message }; }
      });
      template = await USCISFormTemplate.findById(template._id);
    }
  } catch (error) {
    logger.info("uscis_form_ai_mapping_skipped", { formCode: template.formCode, error: error.message });
  }
  // The live edition is never replaced until the new one is fully ready (mapping lossless + every component sliceable); otherwise it stays as is.
  let readiness = null;
  if (migration?.activated) {
    try {
      readiness = await checkEditionReady(template, await findPreviousEdition(template));
    } catch (error) {
      readiness = { ready: false, problems: [error.message] };
    }
    if (!readiness.ready) logger.info("uscis_form_new_edition_not_ready", { formCode: template.formCode, version: template.version, problems: readiness.problems });
  }
  // A template with no visa-type scope can never be provisioned onto a case (Add then silently does nothing): always scope it from the registry.
  try {
    const derived = await deriveVisaTypesFromRegistry(template.formCode);
    const merged = Array.from(new Set([...(template.visaTypes || []), ...derived]));
    if (merged.length !== (template.visaTypes || []).length) { template.visaTypes = merged; await template.save(); }
  } catch (error) {
    logger.info("uscis_form_visa_types_scope_failed", { formCode: template.formCode, error: error.message });
  }
  // Automatic certification (mapping, fillability, filled-not-blank round trip, viewer/download bytes, component slicing). Only a PASS may promote the edition;
  // the backup snapshot is written first and the edition being replaced stays in service until then.
  let certification = null;
  try {
    certification = await stage("certify", async () => {
      const previousEdition = await findPreviousEdition(template);
      const certified = await FormCertificationService.certify(template, { previous: previousEdition });
      await FormCertificationService.backupTemplate(template, await MappingGraphService.loadCurrentGraph(template).catch(() => null));
      return certified;
    });
  } catch (error) {
    certification = { passed: false, checks: [{ name: "certification", passed: false, detail: error.message }] };
  }
  const readyToPromote = Boolean(certification?.passed) && ((Boolean(ruleMapping) && !ruleMapping.skipped) || (Boolean(migration?.activated) && Boolean(readiness?.ready)));
  const autoActivate = readyToPromote || (String(process.env.USCIS_ONDEMAND_AUTOACTIVATE || "").toLowerCase() === "true" && Boolean(certification?.passed));
  let activationBlockedReason = null;
  let componentDiscovery = null; // Phase 7.0: what activation's component discovery reported (an error there is surfaced in the job outcome, not swallowed)
  let activationBlockedCode = null; // e.g. EDITION_POLICY_HELD: lets the pipeline job tell "waiting for a decision" from an ordinary failure
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
    // the edition that is live right now (if any): the only one the rescue below may ever put back
    const liveBefore = await USCISFormTemplate.findOne({ formCode: template.formCode, status: "active" }).select("_id").lean();
    try {
      // VersionManagementService.activate returns { template, impact, componentDiscovery } - keep the document itself (a later step persists against it)
      const activated = await stage("promote", () => versionService.activate(template._id, user, req));
      componentDiscovery = activated?.componentDiscovery || null;
      template = activated?.template || (await USCISFormTemplate.findById(template._id));
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
      activationBlockedCode = error.code || null;
      // never leave a form without a live edition: put the edition that WAS live back if activation died half-way (e.g. a failed save after the old one
      // was retired). Release 0b-2: only that exact edition - never "the most recently retired one", which could be an older edition no policy ever
      // accepted. (The acceptance gate runs inside activate() BEFORE anything is retired, so a policy hold never reaches this point.)
      const stillActive = await USCISFormTemplate.findOne({ formCode: template.formCode, status: "active" }).select("_id").lean();
      if (!stillActive && liveBefore) {
        const previousEdition = await USCISFormTemplate.findOne({ _id: liveBefore._id, status: "retired" });
        if (previousEdition) { previousEdition.status = "active"; previousEdition.currentStatus = "active"; previousEdition.activeFlag = true; await previousEdition.save(); }
      }
      logger.info("uscis_form_mapping_review_required", { formCode: template.formCode, templateId: String(template._id), reason: error.message });
    }
  }

  // The new edition is live: every visa that used the old one keeps using it (visa types carried over), and every open case form of the old
  // edition moves onto it with all saved values (nothing is dropped; unmatched values are archived on the form).
  let caseMigration = null;
  let caseMigrationError = null; // Phase 7.0: a migration that threw is REPORTED in the job outcome (it used to be logged at info level and forgotten)
  if (template.status === "active" && certification?.passed && (readyToPromote || (migration?.activated && readiness?.ready))) {
    try {
      const others = await USCISFormTemplate.find({ formCode: template.formCode, _id: { $ne: template._id } }).select("visaTypes").lean();
      const merged = Array.from(new Set([...(template.visaTypes || []), ...others.flatMap((other) => other.visaTypes || [])]));
      if (merged.length !== (template.visaTypes || []).length) { template.visaTypes = merged; await template.save(); }
      caseMigration = await stage("migrate_cases", () => migrateCaseFormsToEdition({ newTemplate: template, actor: user, req }));
      logger.info("uscis_form_cases_migrated", { formCode: template.formCode, considered: caseMigration.considered, migrated: caseMigration.migrated, verified: caseMigration.verified, skippedFrozen: caseMigration.skippedFrozen, valuesCarried: caseMigration.valuesCarried, valuesArchived: caseMigration.valuesArchived, unresolved: (caseMigration.unresolved || []).length, reconciliationRequired: (caseMigration.reconciliationRequired || []).length, failed: caseMigration.failed.length });
    } catch (error) {
      caseMigrationError = error.message;
      logger.warn("uscis_form_cases_migration_failed", { formCode: template.formCode, error: error.message });
    }
  }
  // Phase 5: what the migration left behind (frozen case forms, lost mapping edges) is recorded for the governance screens; fail-safe, never throws, changes nothing
  try { await require("../../form-governance/GovernanceRecorder").recordMigrationOutcome({ template, caseMigration, lostEdges: migration?.lostEdges, actor: user }); } catch { /* bookkeeping only */ }

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
    biographicMapping = await stage("finalize", () => BiographicMappingService.ensureBiographicMapping(template, user, req));
    if (!biographicMapping.skipped) template = biographicMapping.template;
  }

  uscisFormService.invalidateTemplateCache();
  return {
    template,
    requiresActivation: template.status !== "active",
    activationBlockedReason,
    activationBlockedCode,
    biographicReady: template.mappingStatus === "biographic_active",
    coverage: biographicMapping?.coverage || null,
    migration,
    readiness,
    certification,
    caseMigration,
    caseMigrationError,
    componentDiscovery,
  };
}

// Tells the durable pipeline job which edition it is working on (form + edition date + file checksum) and which templates are involved. Best effort: the
// pipeline must never fail because it could not record its own bookkeeping.
async function recordEdition(pipeline, formCode, template, previous) {
  if (!pipeline?.recordEdition || !template) return;
  try {
    const editionDate = template.editionDate ? new Date(template.editionDate).toISOString().slice(0, 10) : String(template.version || "");
    const checksum = template.importMetadata?.checksum || template.lifecycle?.sourceChecksum || "";
    await pipeline.recordEdition({
      editionKey: `${formCode}|${editionDate}|${checksum}`, newTemplateId: template._id, previousTemplateId: previous?._id, checksum: checksum || undefined,
      storageKey: template.pdfStorageKey || template.artifacts?.form?.storageKey || undefined,
    });
  } catch (error) {
    if (error?.name === "LeaseLostError") throw error;
    logger.info("uscis_form_pipeline_record_failed", { formCode, error: error.message });
  }
}

// Phase 7.E. The check of an existing form failed with an address problem (HTTP 404/403 on the page, or no PDF located). Resolve the form's REAL address (stored address,
// alias slugs such as I-485J -> /i-485supj, the parent form's page for I-539A, the stable PDF address, the directory), verify it, remember it (only when
// FORM_PIPELINE_AUTONOMY=on), and - when the form has a page of its own - check the edition there. Returns { scanResult } (checked at the real page),
// { sourceResolved } (the PDF is reachable but only through a parent page / stable address, so there is no edition page to compare: nothing is changed and no
// error is reported) or null (unchanged failure). A failure that is NOT an address problem (503, timeout, a qpdf problem) is never touched. Never throws.
const ADDRESS_FAILURE = /page fetch failed: (404|403|410)|USCIS_PDF_UNRESOLVED|could not locate a current pdf/i;
async function recoverFormSource({ formCode, existing, failure, pageUrl, user, req }) {
  try {
    if (!ADDRESS_FAILURE.test(String(failure || ""))) return null;
    const { resolveSource, rememberSource } = require("./SourceResolver");
    const resolved = await resolveSource({ formCode, template: existing });
    if (!resolved.ok) {
      logger.info("uscis_source_resolver_exhausted", { formCode, tried: resolved.tried.length });
      return null;
    }
    const remembered = await rememberSource({ template: existing, resolved });
    logger.info("uscis_source_resolved", { formCode, via: resolved.via, pageUrl: resolved.pageUrl, pdfUrl: resolved.pdfUrl, remembered });
    const ownPage = resolved.pageUrl && (resolved.via === "alias" || resolved.via === "stored") && resolved.pageUrl !== pageUrl;
    if (ownPage) {
      const scanResult = await USCISScannerService.scanForm({ formType: formCode, pageUrl: resolved.pageUrl }, user, req);
      if (scanResult.action !== "scan_failed") return { scanResult };
    }
    return { sourceResolved: { via: resolved.via, pageUrl: resolved.pageUrl, pdfUrl: resolved.pdfUrl, remembered } };
  } catch (error) {
    logger.warn("uscis_source_recovery_failed", { formCode, error: error.message });
    return null;
  }
}

// The "form has never been acquired at all" path — resolve → download →
// import (via the existing, unmodified USCISFormImporterService) →
// activateOrPromote. Extracted from the original acquireAndActivate (no
// behavior change) so ensureCurrentUSCISForm's "missing" branch and the
// legacy acquireAndActivate entry point share one implementation.
async function acquireMissingForm(formCode, user, req, pipeline = null) {
  logger.info("uscis_form_download_started", { formCode });
  // resolve + download + normalize + import is retried (re-resolving the official PDF each attempt) until it succeeds or the bounded attempts run out
  const importResult = await (pipeline ? (fn) => pipeline.stage("import", fn) : (fn) => fn())(() => retryUntilSuccess(async () => {
    const resolved = await resolveOfficialPdf(formCode);
    return USCISFormImporterService.importFromUrl(
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
  }, { attempts: 5, label: `import:${formCode}`, onRetry: (info) => logger.info("uscis_form_import_retry", { formCode, attempt: info.attempt, delay: info.delay, error: info.error.message }) }));
  logger.info("uscis_form_download_completed", { formCode, templateId: String(importResult.template._id) });
  await recordEdition(pipeline, formCode, importResult.template, null);
  const activation = await activateOrPromote(importResult.template, user, req, pipeline);
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
  const pipeline = options.pipeline || null;
  const ttlMs = Number(process.env.USCIS_ENSURE_CHECK_TTL_MS || 12 * 60 * 60 * 1000);
  const existing = await uscisFormService.findLatestActiveTemplate(formCode);

  if (!existing) {
    logger.info("uscis_form_check_started", { formCode, reason: "missing" });
    const result = await acquireMissingForm(formCode, user, req, pipeline);
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
    scanResult = await (pipeline ? pipeline.stage("detect", () => USCISScannerService.scanForm({ formType: formCode, pageUrl }, user, req)) : USCISScannerService.scanForm({ formType: formCode, pageUrl }, user, req));
  } catch (error) {
    // USCIS unreachable — the existing, previously-validated template is
    // still safe to keep serving. Never let a network failure here break a
    // case that already has a working form.
    scanResult = { action: "scan_failed", error: error.message };
  }

  if (scanResult.action === "scan_failed") {
    // Phase 7.E: a 404 / unlocatable page is an address problem, not "USCIS unreachable": find the real address (verified), remember it, and check again there
    const recovered = await recoverFormSource({ formCode, existing, failure: scanResult.error, pageUrl, user, req });
    if (recovered?.scanResult) {
      scanResult = recovered.scanResult;
    } else if (recovered?.sourceResolved) {
      logger.info("uscis_form_check_completed", { formCode, outcome: "source_resolved_no_edition_page", via: recovered.sourceResolved.via });
      return { template: existing, alreadyActive: true, requiresActivation: false, checked: true, sourceResolved: recovered.sourceResolved };
    }
  }

  if (scanResult.action === "scan_failed") {
    // Phase 7.E: only a failure to REACH the USCIS page is "USCIS unavailable". A failure of OUR OWN import work (qpdf, normalize, scan, save) is reported with its real stage and
    // cause. Inside a pipeline job it is thrown so the error-resolution engine can diagnose and fix it (the live edition keeps serving: nothing was changed); everywhere else, and
    // whenever FORM_PIPELINE_AUTONOMY is off, the caller gets exactly the result it always got (the existing edition and a checkError), with the real stage added.
    if (scanResult.stage && scanResult.stage !== "page_fetch" && pipeline && require("../../../config/formPipelineAutonomy").mode() !== "off") {
      throw Object.assign(new Error(scanResult.error), { code: scanResult.code || undefined, cause: scanResult.cause || undefined, stage: scanResult.stage });
    }
    logger.info("uscis_form_check_completed", { formCode, outcome: "uscis_unavailable", error: scanResult.error, stage: scanResult.stage });
    return { template: existing, alreadyActive: true, requiresActivation: false, checked: true, checkError: scanResult.error, ...(scanResult.stage ? { checkStage: scanResult.stage, checkCause: scanResult.cause } : {}) };
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
  await recordEdition(pipeline, formCode, newTemplate, existing);
  const activation = await activateOrPromote(newTemplate, user, req, pipeline);
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
    activationBlockedCode: activation.activationBlockedCode,
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
    // acquiring a form for a case is an explicit Case Manager action: recorded as the selection
    await caseFormSelection.recordExplicitInclude(caseData, caseFormSelection.identityOfTemplate(templateForProvisioning), user, "Added by a Case Manager (acquired from USCIS)");
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
    await caseFormSelection.recordExplicitInclude(caseData, { formCode }, user, "Added by a Case Manager (acquired from USCIS)");
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
  recoverFormSource,
};
