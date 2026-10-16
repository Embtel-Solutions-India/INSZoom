#!/usr/bin/env node
// Release 0a (docs/FORM_PIPELINE_RELIABILITY_PLAN.md, Rule C) - READ-ONLY pre-rollout report. Writes NOTHING to the database or the application.
//
// For every tracked form it shows what the edition-acceptance gate WOULD do once it exists (it does not exist yet - this simulates the plan's
// conservative rules over the stored data), how many case forms sit on each edition and status, which forms carry the most open work, and the
// data anomalies the plan asked to be surfaced before the enforcing release is approved.
//
//   node src/scripts/formEditionPolicyRolloutReport.js                 # human-readable report
//   node src/scripts/formEditionPolicyRolloutReport.js --json          # the same report as JSON
//   node src/scripts/formEditionPolicyRolloutReport.js --out report.json   # also write the JSON to a file you name (nothing else is written)
//
// Gate model used (evidence-first, plan decision 9 / 13 / 17):
//   - no policy record exists for ANY form yet, so every form is "needs initial evidence" and every pending edition would be HELD (no_policy);
//   - editions that are live today are GRANDFATHERED: technically available (existing references, editing, review, "ATTORNEY REVIEW" PDFs) but
//     not filing-eligible until a verified decision exists, and never promotable / re-activatable / migrated-to;
//   - conflicting data (edition date from an untrusted source, page date vs stored date, version vs edition date) is listed as its own reason.
// Reasons the plan lists that need an outbound evidence fetch (stale, notice detected, unverifiable) cannot be judged read-only; they are reported as
// "not assessable" so nothing is claimed that was not measured.

const fs = require("fs");
const { readOnlyDb } = require("./lib/readOnlyDb");

// Rule G's single frozen rule (the union of the three existing hard-coded lists, to be centralized in Phase 0). Defined here only to REPORT with it.
const { FROZEN_CASE_FORM_STATUSES } = require("../modules/form-mapping/config/caseFormFreeze");
const FROZEN = new Set(FROZEN_CASE_FORM_STATUSES);
// Not worked on any more: finalized / filed / archived. "Open" = every other case form (still being prepared, reviewed or generated).
const FINISHED = new Set(["finalized", "filed", "archived"]);
// The statuses next to the filing-ready transitions that Rule J will gate (ready_for_pdf / locked, FINAL copy, package finalize / record filing).
const RULE_J_WATCH = new Set(["approved", "under_review", "ready_for_pdf"]);
const AWAITING_PROMOTION = new Set(["draft", "review", "pending_review"]);

const REASON = {
  NO_POLICY: "no_policy",
  DATE_UNTRUSTED: "edition_date_untrusted",
  DATE_CONFLICT: "edition_date_conflict",
  VERSION_MISMATCH: "version_edition_mismatch",
};

const NOT_ASSESSABLE = [
  { reason: "stale", why: "needs the date of the last verified official fetch; no verification record exists before Release 0b" },
  { reason: "notice_detected", why: "needs an outbound read of uscis.gov notices and the 0b fixtures that define an explicit statement" },
  { reason: "unverifiable", why: "needs an evidence fetch of the official source for each form (Release 0b)" },
];

const TEMPLATE_PROJECTION = {
  formCode: 1, formNumber: 1, formName: 1, title: 1, version: 1, editionDate: 1, status: 1, currentStatus: 1, activeFlag: 1, officialStatus: 1,
  mappingStatus: 1, retiredAt: 1, activatedAt: 1, importedAt: 1, pdfStorageKey: 1, officialPdfUrl: 1,
  "lifecycle.sourcePageUrl": 1, "lifecycle.sourcePdfUrl": 1, "lifecycle.detectionStatus": 1,
  "artifacts.form.sourceUrl": 1, "artifacts.form.storageKey": 1,
  "importMetadata.source": 1, "importMetadata.editionDateSource": 1, "importMetadata.publishedEditionDate": 1, "importMetadata.checksum": 1,
  "importMetadata.validationSummary.certification.passed": 1, "importMetadata.validationSummary.certification.certifiedAt": 1,
  "importMetadata.validationSummary.certification.version": 1,
};

// ---- small pure helpers ---------------------------------------------------------------------------------------------------------------------

const pad = (value) => String(value).padStart(2, "0");

/** A Date / ISO string -> "YYYY-MM-DD" (UTC), or null. */
function isoDay(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

/** An edition string such as "2026-09-22", "07/22/2025" or "07/22/25" -> "YYYY-MM-DD", or null when it is not a date. */
function versionAsDay(version) {
  const text = String(version ?? "").trim();
  let match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) return `${match[1]}-${match[2]}-${match[3]}`;
  match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4}|\d{2})$/);
  if (match) return `${match[3].length === 2 ? `20${match[3]}` : match[3]}-${pad(match[1])}-${pad(match[2])}`;
  return null;
}

const idOf = (value) => (value === undefined || value === null ? "" : String(value));
const byDescending = (field) => (a, b) => String(b[field] || "").localeCompare(String(a[field] || ""));

function certificationState(template) {
  const certification = template?.importMetadata?.validationSummary?.certification;
  if (!certification || typeof certification.passed !== "boolean") return { state: "none" };
  return {
    state: certification.passed ? "passed" : "failed",
    certifiedAt: certification.certifiedAt ? new Date(certification.certifiedAt).toISOString() : null,
    certifiedVersion: certification.version || null,
  };
}

/** What the stored data says about ONE edition (a template document). Pure. */
function analyzeEdition(template) {
  const editionDay = isoDay(template.editionDate);
  const pageDay = isoDay(template.importMetadata?.publishedEditionDate);
  const versionDay = versionAsDay(template.version);
  const source = template.importMetadata?.editionDateSource || null;
  const flags = {
    untrusted: source === "version_backfill",
    pageConflict: Boolean(pageDay && editionDay && pageDay !== editionDay),
    versionMismatch: Boolean(versionDay && editionDay && versionDay !== editionDay),
  };
  const reasons = [REASON.NO_POLICY];
  if (flags.untrusted) reasons.push(REASON.DATE_UNTRUSTED);
  if (flags.pageConflict) reasons.push(REASON.DATE_CONFLICT);
  if (flags.versionMismatch) reasons.push(REASON.VERSION_MISMATCH);
  return {
    templateId: idOf(template._id),
    version: template.version ?? null,
    editionDate: editionDay,
    editionDateSource: source,
    publishedEditionDate: pageDay,
    status: template.status || null,
    mappingStatus: template.mappingStatus || null,
    certification: certificationState(template),
    importedAt: template.importedAt ? new Date(template.importedAt).toISOString() : null,
    retiredAt: template.retiredAt ? new Date(template.retiredAt).toISOString() : null,
    flags,
    reasons,
  };
}

const editionLabel = (edition) => (edition.editionDate && edition.editionDate !== edition.version ? `${edition.version} (edition ${edition.editionDate})` : String(edition.version));

/** Case-form counts by status for ONE group of rows [{status,isLocked,n}] -> { total, open, frozen, ruleJWatch, byStatus }. */
function summarizeCaseForms(rows) {
  const byStatus = {};
  let total = 0;
  let open = 0;
  let frozen = 0;
  let ruleJWatch = 0;
  for (const row of rows) {
    const status = row.status || "unknown";
    const count = Number(row.n) || 0;
    byStatus[status] = (byStatus[status] || 0) + count;
    total += count;
    if (!FINISHED.has(status)) open += count;
    if (FROZEN.has(status) || row.isLocked === true) frozen += count;
    if (RULE_J_WATCH.has(status)) ruleJWatch += count;
  }
  return { total, open, frozen, ruleJWatch, byStatus };
}

// ---- the report -------------------------------------------------------------------------------------------------------------------------------

/**
 * Pure: builds the whole report from plain data. Never mutates its inputs.
 *   templates:      USCISFormTemplate documents (light projection)
 *   caseFormGroups: [{ formCode, parentFormCode, formTemplateId, formVersion, status, isLocked, n }]
 *   registryForms:  VisaFormMapping rows [{ formNumber, formTemplateFormCode, agency, active, componentType }]
 */
function buildRolloutReport({ templates = [], caseFormGroups = [], registryForms = [], generatedAt = new Date() } = {}) {
  const anomalies = [];
  const note = (type, formCode, severity, detail) => anomalies.push({ type, formCode, severity, detail });

  const byForm = new Map();
  for (const template of templates) {
    const code = template.formCode || "(no formCode)";
    if (!byForm.has(code)) byForm.set(code, []);
    byForm.get(code).push(template);
  }
  const templateById = new Map(templates.map((template) => [idOf(template._id), template]));

  // case forms grouped under the form whose template they use (supplements / components belong to their parent form)
  const casesByForm = new Map();
  for (const group of caseFormGroups) {
    const owner = templateById.get(idOf(group.formTemplateId));
    const code = owner?.formCode || group.parentFormCode || group.formCode || "(unknown)";
    if (!casesByForm.has(code)) casesByForm.set(code, []);
    casesByForm.get(code).push(group);
    if (!owner) note("caseform_orphan_template", code, "warning", `${group.n} case form(s) with status "${group.status}" point at a template that does not exist`);
    else if (group.formVersion && owner.version && String(group.formVersion) !== String(owner.version)) {
      note("caseform_version_differs_from_template", code, "info", `${group.n} case form(s) record version ${group.formVersion} but their template is ${owner.version}`);
    }
  }

  const forms = [];
  for (const code of [...byForm.keys()].sort()) {
    const docs = byForm.get(code);
    const analyses = docs.map((doc) => ({ doc, edition: analyzeEdition(doc) }));
    const active = analyses.filter(({ doc }) => doc.status === "active");
    const pending = analyses.filter(({ doc }) => AWAITING_PROMOTION.has(doc.status));
    const retired = analyses.filter(({ doc }) => doc.status === "retired").sort((a, b) => byDescending("retiredAt")(a.edition, b.edition));
    const highlights = [];

    if (active.length === 0) { highlights.push("no_active_edition"); note("no_active_edition", code, "warning", "no edition of this form is active"); }
    if (active.length > 1) { highlights.push("multiple_active_editions"); note("multiple_active_editions", code, "warning", `${active.length} editions are active at once`); }
    for (const { doc, edition } of active) {
      if (doc.activeFlag !== true) note("status_flag_mismatch", code, "warning", `edition ${editionLabel(edition)} has status "active" but activeFlag is not true`);
      if (!doc.pdfStorageKey && !doc.artifacts?.form?.storageKey) note("active_without_pdf", code, "warning", `edition ${editionLabel(edition)} is active but has no stored PDF key`);
      if (edition.certification.state !== "passed") { highlights.push("active_not_certified"); note("active_not_certified", code, "info", `live edition ${editionLabel(edition)} has no passing certification on record (re-activating it would first need certify-on-demand)`); }
    }
    for (const { doc, edition } of analyses) {
      if (doc.currentStatus && doc.status && doc.currentStatus !== doc.status) note("status_mismatch", code, "info", `edition ${editionLabel(edition)}: status "${doc.status}" but currentStatus "${doc.currentStatus}"`);
      if (edition.flags.untrusted) { highlights.push("edition_date_untrusted"); note("edition_date_untrusted", code, "warning", `edition ${editionLabel(edition)} (${edition.status}): the edition date came from "version_backfill", not from the PDF or the USCIS page`); }
      if (edition.flags.pageConflict) { highlights.push("edition_date_conflict"); note("edition_date_conflict", code, "warning", `edition ${editionLabel(edition)}: stored edition ${edition.editionDate} but the USCIS page showed ${edition.publishedEditionDate}`); }
      if (edition.flags.versionMismatch) { highlights.push("version_edition_mismatch"); note("version_edition_mismatch", code, "warning", `edition ${editionLabel(edition)} (${edition.status}): version ${edition.version} is a different date from editionDate ${edition.editionDate}`); }
    }

    const activeEditions = active.map(({ edition }) => ({
      ...edition,
      gate: { servedAs: "grandfathered", filingEligible: false, canBePromotedOrReactivated: false, wouldDo: "serve-only", reasons: edition.reasons },
    }));

    const pendingEditions = pending.map(({ edition }) => {
      const activeDays = active.map(({ edition: live }) => live.editionDate).filter(Boolean).sort();
      const newestLive = activeDays[activeDays.length - 1] || null;
      const newer = !edition.editionDate || !newestLive ? null : edition.editionDate > newestLive;
      if (newer !== false) highlights.push("pending_newer_edition");
      return { ...edition, newerThanLive: newer, gate: { wouldDo: "hold", reasons: edition.reasons } };
    });

    const rescue = retired[0] || null;
    const rescueCandidate = rescue
      ? {
          ...rescue.edition,
          // OnDemandFormAcquisitionService: when an activation dies half-way and no edition is active, the most recently retired edition is put back with no gate
          note: "the existing half-way rescue would re-activate this edition without any policy check (rerouted through the gate in Release 0b-2)",
          wouldDo: "hold",
          reasons: rescue.edition.reasons,
        }
      : null;
    if (rescue && rescue.edition.certification.state !== "passed") highlights.push("rescue_candidate_uncertified");

    const cases = casesByForm.get(code) || [];
    const byEdition = [];
    const editionGroups = new Map();
    for (const group of cases) {
      const key = idOf(group.formTemplateId);
      if (!editionGroups.has(key)) editionGroups.set(key, []);
      editionGroups.get(key).push(group);
    }
    for (const [templateId, rows] of editionGroups) {
      const owner = templateById.get(templateId);
      const edition = owner ? analyzeEdition(owner) : null;
      byEdition.push({ templateId, edition: edition ? editionLabel(edition) : "(template missing)", templateStatus: owner?.status || null, ...summarizeCaseForms(rows) });
    }
    byEdition.sort((a, b) => b.open - a.open || String(a.edition).localeCompare(String(b.edition)));
    const caseTotals = summarizeCaseForms(cases);

    forms.push({
      formCode: code,
      formName: docs.find((doc) => doc.formName || doc.title)?.formName || docs.find((doc) => doc.title)?.title || null,
      needsInitialEvidence: true,
      highlights: [...new Set(highlights)],
      activeEditions,
      pendingEditions,
      rescueCandidate,
      editionCount: docs.length,
      caseForms: { ...caseTotals, byEdition },
    });
  }

  // forms the registry tracks (USCIS, active, standalone) that have no template installed at all. The registry writes form numbers in
  // either case ("i-129" / "I-129"), so codes are compared upper-cased with single spaces.
  const normalizeCode = (code) => String(code || "").toUpperCase().replace(/\s+/g, " ").trim();
  const installed = new Set([...byForm.keys()].map(normalizeCode));
  const registryOnly = new Map();
  for (const row of registryForms) {
    if (row.agency && row.agency !== "USCIS") continue;
    if (row.active === false) continue;
    if (row.componentType && row.componentType !== "STANDALONE_FORM") continue;
    const code = normalizeCode(row.formTemplateFormCode || row.formNumber);
    if (code && !installed.has(code)) registryOnly.set(code, code);
  }
  for (const code of [...registryOnly.keys()].sort()) note("registry_form_not_installed", code, "info", "tracked in the form registry but no template is installed");

  const caseTotals = summarizeCaseForms(caseFormGroups);
  const withPending = forms.filter((form) => form.pendingEditions.length);
  const summary = {
    formsTracked: forms.length,
    editionsStored: templates.length,
    formsNeedingInitialEvidence: forms.length,
    formsWithoutActiveEdition: forms.filter((form) => !form.activeEditions.length).length,
    liveEditionsGrandfathered: forms.reduce((sum, form) => sum + form.activeEditions.length, 0),
    editionsAwaitingPromotion: forms.reduce((sum, form) => sum + form.pendingEditions.length, 0),
    formsWithPendingEdition: withPending.length,
    editionsWithUntrustedDate: templates.filter((template) => analyzeEdition(template).flags.untrusted).length,
    editionsWithVersionMismatch: templates.filter((template) => analyzeEdition(template).flags.versionMismatch).length,
    editionsWithPageConflict: templates.filter((template) => analyzeEdition(template).flags.pageConflict).length,
    registryFormsNotInstalled: registryOnly.size,
    editionDateSources: templates.reduce((counts, template) => { const key = template.importMetadata?.editionDateSource || "(not recorded)"; counts[key] = (counts[key] || 0) + 1; return counts; }, {}),
    caseForms: caseTotals,
  };

  // open case forms of forms that have NO template at all (their template was removed): invisible in `forms`, so listed here too
  const withoutTemplate = [...casesByForm.keys()]
    .filter((code) => !byForm.has(code))
    .map((code) => ({ formCode: code, templateMissing: true, ...summarizeCaseForms(casesByForm.get(code)) }));
  const openWork = [
    ...forms.map((form) => ({ formCode: form.formCode, templateMissing: false, ...form.caseForms })),
    ...withoutTemplate,
  ]
    .filter((row) => row.open > 0)
    .map((row) => ({ formCode: row.formCode, templateMissing: row.templateMissing, open: row.open, ruleJWatch: row.ruleJWatch, total: row.total, byStatus: row.byStatus }))
    .sort((a, b) => b.ruleJWatch - a.ruleJWatch || b.open - a.open || a.formCode.localeCompare(b.formCode));

  return {
    report: "form-edition-policy-rollout",
    release: "0a",
    readOnly: true,
    generatedAt: generatedAt instanceof Date ? generatedAt.toISOString() : String(generatedAt),
    definitions: {
      frozenCaseFormStatuses: FROZEN_CASE_FORM_STATUSES,
      finishedStatuses: [...FINISHED],
      open: "every case form whose status is not finalized / filed / archived",
      ruleJWatchStatuses: [...RULE_J_WATCH],
      gateModel: "evidence-first: no policy exists for any form, pending editions would be held, live editions are grandfathered (serve-only, not filing-eligible)",
    },
    summary,
    openWorkPriority: openWork,
    forms,
    anomalies: anomalies.sort((a, b) => (a.severity === b.severity ? a.formCode.localeCompare(b.formCode) || a.type.localeCompare(b.type) : a.severity === "warning" ? -1 : 1)),
    notAssessable: NOT_ASSESSABLE,
  };
}

// ---- loading (read-only) ----------------------------------------------------------------------------------------------------------------------

/** Reads the three inputs through a handle that can only read. `db` is a native MongoDB Db (or a test double with collection(name)). */
async function loadRolloutInputs(db) {
  const reader = readOnlyDb(db);
  const templates = await reader.collection("uscisformtemplates").find({}, { projection: TEMPLATE_PROJECTION }).toArray();
  const caseFormGroups = (
    await reader
      .collection("caseforms")
      .aggregate([{ $group: { _id: { formCode: "$formCode", parentFormCode: "$parentFormCode", formTemplateId: "$formTemplateId", formVersion: "$formVersion", status: "$status", isLocked: "$isLocked" }, n: { $sum: 1 } } }], { allowDiskUse: false })
      .toArray()
  ).map((row) => ({ ...row._id, n: row.n }));
  const registryForms = await reader
    .collection("visaformmappings")
    .find({}, { projection: { formNumber: 1, formTemplateFormCode: 1, agency: 1, active: 1, componentType: 1 } })
    .toArray();
  return { templates, caseFormGroups, registryForms };
}

// ---- output -----------------------------------------------------------------------------------------------------------------------------------

function renderText(report) {
  const out = [];
  const s = report.summary;
  out.push("FORM EDITION POLICY - PRE-ROLLOUT REPORT (Release 0a, read-only)");
  out.push(`generated ${report.generatedAt}`);
  out.push("");
  out.push("SUMMARY");
  out.push(`  forms tracked: ${s.formsTracked}   editions stored: ${s.editionsStored}   live editions (grandfathered): ${s.liveEditionsGrandfathered}`);
  out.push(`  forms needing initial evidence: ${s.formsNeedingInitialEvidence} (all - no policy record exists for any form)`);
  out.push(`  editions awaiting promotion: ${s.editionsAwaitingPromotion} across ${s.formsWithPendingEdition} forms (every one would be HELD: no_policy)`);
  out.push(`  forms without an active edition: ${s.formsWithoutActiveEdition}`);
  out.push(`  edition date untrusted (version_backfill): ${s.editionsWithUntrustedDate}   version != edition date: ${s.editionsWithVersionMismatch}   page != stored date: ${s.editionsWithPageConflict}`);
  out.push(`  registry forms with no installed template: ${s.registryFormsNotInstalled}`);
  out.push(`  edition date sources: ${Object.entries(s.editionDateSources).map(([key, count]) => `${key}=${count}`).join(", ")}`);
  out.push(`  case forms: ${s.caseForms.total} total, ${s.caseForms.open} open, ${s.caseForms.frozen} frozen (would be reported, never migrated), ${s.caseForms.ruleJWatch} next to the filing-ready steps (Rule J)`);
  out.push("");
  out.push("OPEN CASE FORMS BY FORM (where evidence is needed first)");
  if (!report.openWorkPriority.length) out.push("  none");
  for (const row of report.openWorkPriority) out.push(`  ${row.formCode.padEnd(10)}${row.templateMissing ? " (template missing)" : ""} open ${String(row.open).padStart(3)}   Rule-J watch ${String(row.ruleJWatch).padStart(3)}   ${Object.entries(row.byStatus).map(([key, count]) => `${key}=${count}`).join(" ")}`);
  out.push("");
  out.push("ANOMALIES");
  if (!report.anomalies.length) out.push("  none");
  for (const item of report.anomalies) out.push(`  [${item.severity}] ${item.formCode}: ${item.type} - ${item.detail}`);
  out.push("");
  out.push("FORMS (gate simulation)");
  for (const form of report.forms) {
    out.push(`  ${form.formCode}${form.formName ? ` - ${form.formName}` : ""}: needs initial evidence${form.highlights.length ? `   [${form.highlights.join(", ")}]` : ""}`);
    for (const edition of form.activeEditions) out.push(`      live      ${editionLabel(edition)}  -> serve-only, not filing-eligible (${edition.reasons.join(", ")})`);
    for (const edition of form.pendingEditions) out.push(`      awaiting  ${editionLabel(edition)} [${edition.status}${edition.newerThanLive === true ? ", newer than live" : edition.newerThanLive === false ? ", not newer" : ""}]  -> HOLD (${edition.reasons.join(", ")})`);
    if (form.rescueCandidate) out.push(`      rescue    ${editionLabel(form.rescueCandidate)} (retired, certification ${form.rescueCandidate.certification.state})  -> would be HELD (${form.rescueCandidate.reasons.join(", ")})`);
    if (form.caseForms.total) out.push(`      cases     ${form.caseForms.total} total, ${form.caseForms.open} open: ${form.caseForms.byEdition.map((edition) => `${edition.edition} [${Object.entries(edition.byStatus).map(([key, count]) => `${key}=${count}`).join(" ")}]`).join("; ")}`);
  }
  out.push("");
  out.push("NOT ASSESSABLE READ-ONLY (reported, not guessed)");
  for (const item of report.notAssessable) out.push(`  ${item.reason}: ${item.why}`);
  return out.join("\n");
}

function writeOutputFile(path, text) {
  fs.writeFileSync(path, text, "utf8");
}

function parseArgs(argv) {
  const args = { json: false, out: null, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--json") args.json = true;
    else if (argv[index] === "--help" || argv[index] === "-h") args.help = true;
    else if (argv[index] === "--out") {
      args.out = argv[index + 1] || null;
      index += 1;
    }
  }
  return args;
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log("usage: node src/scripts/formEditionPolicyRolloutReport.js [--json] [--out <file>]\nRead-only. Writes nothing to the database; --out writes the JSON report to the file you name.");
    return 0;
  }
  require("dotenv").config();
  const mongoose = require("mongoose");
  const env = require("../config/env");
  await mongoose.connect(env.mongoUri || process.env.MONGODB_URI, { autoIndex: false, autoCreate: false, serverSelectionTimeoutMS: 15000 });
  try {
    const report = buildRolloutReport(await loadRolloutInputs(mongoose.connection.db));
    if (args.out) writeOutputFile(args.out, JSON.stringify(report, null, 2));
    console.log(args.json ? JSON.stringify(report, null, 2) : renderText(report));
    return 0;
  } finally {
    await mongoose.disconnect();
  }
}

module.exports = {
  buildRolloutReport, loadRolloutInputs, renderText, analyzeEdition, summarizeCaseForms, isoDay, versionAsDay, parseArgs,
  FROZEN_CASE_FORM_STATUSES, RULE_J_WATCH, REASON, NOT_ASSESSABLE, TEMPLATE_PROJECTION,
};

if (require.main === module) {
  main().then((code) => process.exit(code)).catch((error) => { console.error(`rollout report failed: ${error.message}`); process.exit(1); });
}
