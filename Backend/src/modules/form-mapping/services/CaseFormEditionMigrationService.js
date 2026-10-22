// Moves the open CaseForms of an older USCIS edition onto a newer edition with NO data loss - and with a way back (plan Rule G; the recovery machinery is in
// CaseFormMigrationRecovery.js). Per case form:
//   1. the carry is PLANNED first, without writing: every old answer record (value, provenance, attribution, review, override) ends as preserved, archived-with-reason or
//      unresolved. Two old records with different values landing on one box, or a typed / verified value with no box in the new edition, are UNRESOLVED: that case form
//      stays untouched on its old edition and is reported; the others go on;
//   2. a PRE-IMAGE is stored (separate collection, sha256-checksummed) and migrationState is written;
//   3. the new edition is saved with a compare-and-set (a person's edit made meanwhile is never overwritten), then the case is re-autofilled and anything autofill blanked
//      that a person had saved is put back (a `false` a person set is an answer);
//   4. the case form is RE-READ from the database and verified against the pre-image; a failure restores it from the pre-image ONLY when nothing but the migration changed
//      it, otherwise it goes to reconciliation_required with the pre-image kept without expiry;
//   5. finalized / filed / locked / approved ... forms are legal records: they stay on their edition and are listed in the frozen reconciliation report.
// A crash at any step is picked up by CaseFormMigrationRecovery.reconcileIncompleteMigrations from the recorded step.
const crypto = require("crypto");
const USCISFormTemplate = require("../../../models/USCISFormTemplate");
const FieldDiffService = require("../../uscis-lifecycle/services/FieldDiffService");
const Recovery = require("./CaseFormMigrationRecovery");

const { FROZEN_CASE_FORM_STATUSES, isFrozen } = require("../config/caseFormFreeze");

const FROZEN_STATUSES = FROZEN_CASE_FORM_STATUSES; // kept as an export name; the list lives in ONE place (Rule G)
const leaves = Recovery.leaves;

const fieldKeys = (field) => [field.fieldId, field.id, field.fieldName, field.pdfFieldName, field.normalizedName].filter(Boolean);
const stripSubform = (name) => String(name).replace(/#subform\[\d+\]\./g, "");

function buildMatcher(oldTemplate, newTemplate) {
  const newByKey = new Map();
  const newByBase = new Map();
  (newTemplate.formFields || []).forEach((field) => {
    fieldKeys(field).forEach((key) => newByKey.set(key, field));
    newByBase.set(stripSubform(field.fieldName || ""), field);
  });
  const renamed = new Map();
  if (oldTemplate) {
    const diff = FieldDiffService.diff(oldTemplate.formFields || [], newTemplate.formFields || []);
    (diff.renamed || []).forEach((item) => {
      const target = (newTemplate.formFields || []).find((field) => fieldKeys(field).includes(item.newField?.id));
      if (target) fieldKeys(item.oldField || {}).forEach((key) => renamed.set(key, target));
    });
  }
  return (path) => newByKey.get(path) || newByBase.get(stripSubform(path)) || renamed.get(path);
}

const caseFormDeps = (deps = {}) => ({ CaseForm: deps.CaseForm || require("../../../models/CaseForm"), ...deps });
const idStr = (value) => (value === undefined || value === null ? "" : String(value));

// frozen case forms of the older editions of a form (plan Rule G: stay on their edition, reported for admin reconciliation; PRIORITY when the old edition is no longer accepted)
async function describeFrozen(caseForms, priorById, newTemplate, deps) {
  if (!caseForms.length) return [];
  const caseNumbers = new Map();
  try {
    const Case = deps.Case || require("../../../models/Case");
    (await Case.find({ _id: { $in: [...new Set(caseForms.map((item) => item.caseId))] } }).select("caseNumber").lean()).forEach((item) => caseNumbers.set(idStr(item._id), item.caseNumber));
  } catch { /* the case number is a convenience */ }
  const notAccepted = new Map();
  const isOldEditionRefused = async (previous) => {
    if (!previous) return false;
    const key = idStr(previous._id);
    if (!notAccepted.has(key)) {
      // PRIORITY when the edition these forms are on is no longer accepted by USCIS: the caller supplies that check (deps.oldEditionNotAccepted(template) -> boolean);
      // this file only ever uses the edition ENFORCER, never the gate or its store, so without the hook nothing is flagged
      let refused = false;
      try { refused = deps.oldEditionNotAccepted ? Boolean(await deps.oldEditionNotAccepted(previous)) : false; } catch { refused = false; }
      notAccepted.set(key, refused);
    }
    return notAccepted.get(key);
  };
  const out = [];
  for (const item of caseForms) {
    const previous = priorById.get(idStr(item.formTemplateId));
    out.push({
      caseFormId: idStr(item._id), caseId: idStr(item.caseId), caseNumber: caseNumbers.get(idStr(item.caseId)) || null, status: item.status, isLocked: Boolean(item.isLocked),
      fromEdition: previous?.version || item.formVersion || null, toEdition: newTemplate.version, priority: await isOldEditionRefused(previous),
    });
  }
  return out;
}

/** The frozen case forms (finalized / filed / locked / approved / ...) that stay on their edition, as a report for an admin. Reads only. */
async function frozenReconciliationReport(newTemplate, { formCode = newTemplate.formCode, deps = {} } = {}) {
  const { priorById, caseForms } = await selection({ newTemplate, formCode, deps });
  return describeFrozen(caseForms.filter((item) => isFrozen(item)), priorById, newTemplate, deps);
}

/**
 * Migrates ONE case form (also used to start from scratch after a released snapshot). Never throws.
 * Resolves { outcome: migrated | unresolved | restored | reconciliation_required | concurrent_edit | frozen | skipped | failed, counts?, unresolved?, flags?, problems? }.
 */
async function migrateOneCaseForm({ caseFormId, previous, newTemplate, actor, req, deps = {}, jobId = crypto.randomUUID(), result = {} }) {
  const { CaseForm } = caseFormDeps(deps);
  try {
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const loaded = await Recovery.loadImage(CaseForm, caseFormId);
      if (!loaded) return { outcome: "failed", error: "case form not found" };
      if (isFrozen(loaded.doc)) return { outcome: "frozen" };
      if (idStr(loaded.doc.formTemplateId) === idStr(newTemplate._id)) return { outcome: "skipped", reason: "already on the new edition" };
      const plan = Recovery.planCarry(loaded.image, buildMatcher(previous, newTemplate), { isApplicable: (target) => target.hidden !== true });
      if (plan.unresolved.length) return { outcome: "unresolved", counts: plan.counts, unresolved: plan.unresolved.map((item) => ({ caseFormId: idStr(caseFormId), caseId: idStr(loaded.doc.caseId), ...item })) };

      await deps.checkpoint?.("planned");
      const snapshot = await Recovery.createSnapshot(deps, { caseForm: loaded.doc, image: loaded.image, jobId, fromTemplateId: previous?._id, toTemplateId: newTemplate._id, dispositions: plan.dispositions });
      await Recovery.setState(deps, caseFormId, { jobId, snapshotId: snapshot._id, step: "snapshotted", error: null });
      await deps.checkpoint?.("snapshotted");

      const now = new Date();
      const archive = { fromVersion: previous?.version, fromTemplateId: previous?._id, toVersion: newTemplate.version, migratedAt: now, migratedBy: actor?._id, migrationJobId: jobId, snapshotId: snapshot._id, unmatchedValues: plan.archive.unmatchedValues, ...(Object.keys(plan.archive.unmatchedMeta).length ? { unmatchedMeta: plan.archive.unmatchedMeta } : {}), ...(plan.archive.merged.length ? { mergedCollisions: plan.archive.merged } : {}), ...(plan.flags.provenanceUnknown.length ? { provenanceUnknown: plan.flags.provenanceUnknown } : {}) };
      const $set = {};
      for (const [key, value] of Object.entries(plan.writes)) $set[key] = key === "fieldValueProvenance" ? Object.fromEntries(Object.entries(value).map(([field, item]) => [Recovery.encodeKey(field), item])) : value;
      const lock = loaded.image.pointers.formVersionLock || {};
      Object.assign($set, {
        formTemplateId: newTemplate._id, formVersion: newTemplate.version, formEditionDate: newTemplate.editionDate,
        mappingVersion: newTemplate.activeMappingVersion || 0, mappingVersionId: newTemplate.activeMappingVersionId,
        formVersionLock: { ...lock, formType: loaded.doc.formCode, editionDate: newTemplate.editionDate, version: newTemplate.version, mappingVersion: newTemplate.activeMappingVersion || 0, mappingVersionId: newTemplate.activeMappingVersionId, formTemplateId: newTemplate._id, migratedFrom: previous?._id, migratedAt: now, migratedBy: actor?._id },
      });
      for (const key of Object.keys($set)) if ($set[key] === undefined) delete $set[key];
      const audit = { action: "EDITION_MIGRATED", changes: { from: previous?.version, to: newTemplate.version, carried: plan.counts.carried, archived: plan.counts.archived, snapshotId: idStr(snapshot._id), jobId }, performedBy: actor?._id, performedAt: now };
      const written = await Recovery.casUpdate(deps, caseFormId, loaded.doc.updatedAt, { $set, $push: { editionMigrations: archive, auditHistory: audit } });
      if (!written) {
        // a person edited this case form between the read and the write: nothing was changed. Release this pre-image, then re-read and re-plan once.
        await releaseSnapshot(deps, snapshot._id);
        await CaseForm.collection.updateOne({ _id: caseFormId }, { $unset: { migrationState: "" } });
        if (attempt === 1) continue;
        return { outcome: "concurrent_edit" };
      }
      await Recovery.setState(deps, caseFormId, { step: "saved" });
      await Recovery.captureIntermediate(deps, caseFormId, snapshot._id);
      await deps.checkpoint?.("saved");
      const finished = await Recovery.continueAfterSave({ caseFormId, snapshotId: snapshot._id, newTemplate, actor, req, deps, from: "saved", result });
      return { ...finished, counts: plan.counts, flags: plan.flags, snapshotId: snapshot._id };
    }
    return { outcome: "concurrent_edit" };
  } catch (error) {
    return { outcome: "failed", error: error.message };
  }
}

async function releaseSnapshot(deps, snapshotId) {
  const { Snapshot } = Recovery.stores(deps);
  await Snapshot.updateOne({ _id: snapshotId }, { $set: { state: "released" } });
}

async function migrateCaseFormsToEdition({ newTemplate, actor, req, formCode = newTemplate.formCode, deps = {} }) {
  // Release 0b-2: never move cases onto an edition USCIS's acceptance of which is not on record (fail closed; throws before any case form is touched)
  await (deps.requireAcceptedEdition || require("../../form-edition-policy/EditionPolicyEnforcer").requireAcceptedEdition)(newTemplate, { entryPoint: "migrateCaseFormsToEdition", actor });
  const result = { considered: 0, migrated: 0, skippedFrozen: 0, valuesCarried: 0, valuesArchived: 0, valuesRestoredAfterAutofill: 0, failed: [], verified: 0, unresolved: [], reconciliationRequired: [], frozenReport: [], restored: 0, inProgress: 0, dryRun: false };
  const { priorById, caseForms } = await selection({ newTemplate, formCode, deps });
  result.considered = caseForms.length;
  const jobId = crypto.randomUUID();
  const frozen = caseForms.filter((item) => isFrozen(item));
  result.skippedFrozen = frozen.length;
  result.frozenReport = await describeFrozen(frozen, priorById, newTemplate, deps).catch(() => []);

  for (const caseForm of caseForms) {
    if (isFrozen(caseForm)) continue;
    // a migration of this case form that is already under way belongs to the reconciliation sweeper, not to a second run
    if (Recovery.IN_PROGRESS_STEPS.includes(caseForm.migrationState?.step)) { result.inProgress += 1; continue; }
    const outcome = await migrateOneCaseForm({ caseFormId: caseForm._id, previous: priorById.get(idStr(caseForm.formTemplateId)), newTemplate, actor, req, deps, jobId, result });
    const id = idStr(caseForm._id);
    switch (outcome.outcome) {
      case "migrated":
        result.migrated += 1;
        if (outcome.verified) result.verified += 1;
        result.valuesCarried += outcome.counts?.carried || 0;
        result.valuesArchived += outcome.counts?.archived || 0;
        break;
      case "unresolved": result.unresolved.push(...outcome.unresolved); break;
      case "restored": result.restored += 1; break; // the failed verification was already added to failed[] by the step machine
      case "reconciliation_required": result.reconciliationRequired.push({ caseFormId: id, changes: outcome.changes || [], problems: outcome.problems || [] }); break;
      case "concurrent_edit": result.failed.push({ caseFormId: id, stage: "concurrent_edit", error: "a person edited this case form while it was being migrated; it was left on its old edition" }); break;
      case "frozen": result.skippedFrozen += 1; break;
      case "skipped": break;
      default: result.failed.push({ caseFormId: id, stage: "migrate", error: outcome.error || "unknown error" });
    }
  }
  return result;
}

async function selection({ newTemplate, formCode, deps }) {
  const { CaseForm } = caseFormDeps(deps);
  const priorEditions = await USCISFormTemplate.find({ formCode, _id: { $ne: newTemplate._id } }).lean();
  const priorById = new Map(priorEditions.map((template) => [String(template._id), template]));
  // the form itself plus its component rows (e.g. the I-129 H / H-1B supplements are their own CaseForms that point at the same template)
  const query = CaseForm.find({ $or: [{ formCode }, { parentFormCode: formCode }], formTemplateId: { $in: [...priorById.keys()] } });
  const caseForms = typeof query?.lean === "function" ? await query.lean() : await query;
  return { priorById, caseForms };
}

/**
 * DRY RUN: what a migration to `newTemplate` would do, writing NOTHING. Counts per status, the frozen report, what would migrate, the field changes between the editions,
 * collisions and other would-be-unresolved records, protected (manual / verified) answers affected, and how much provenance the answers carry.
 */
async function planMigration({ newTemplate, formCode = newTemplate.formCode, deps = {} }) {
  const { priorById, caseForms } = await selection({ newTemplate, formCode, deps });
  const byStatus = {};
  caseForms.forEach((item) => { byStatus[item.status] = (byStatus[item.status] || 0) + 1; });
  const frozen = caseForms.filter((item) => isFrozen(item));
  const report = {
    dryRun: true, formCode, toEdition: newTemplate.version, considered: caseForms.length, byStatus,
    frozen: { count: frozen.length, report: await describeFrozen(frozen, priorById, newTemplate, deps).catch(() => []) },
    wouldMigrate: 0, inProgress: 0, blocked: 0, unresolved: [], collisions: [], archivedValues: 0, flagsProvenanceUnknown: 0,
    protectedValuesAffected: { manualOverrides: 0, verified: 0 }, provenanceCoverage: { perForm: [], overall: null },
    fieldDiff: null,
  };
  const diffs = new Map();
  let withProvenance = 0;
  let filledTotal = 0;
  for (const caseForm of caseForms) {
    if (isFrozen(caseForm)) continue;
    if (Recovery.IN_PROGRESS_STEPS.includes(caseForm.migrationState?.step)) { report.inProgress += 1; continue; }
    const previous = priorById.get(idStr(caseForm.formTemplateId));
    if (previous && !diffs.has(idStr(previous._id))) {
      const diff = FieldDiffService.diff(previous.formFields || [], newTemplate.formFields || []);
      diffs.set(idStr(previous._id), { fromEdition: previous.version, summary: diff.summary, added: diff.added.slice(0, 25).map((field) => field.id), removed: diff.removed.slice(0, 25).map((field) => field.id), renamed: diff.renamed.slice(0, 25).map((item) => [item.oldField.id, item.newField.id]), modified: diff.modified.slice(0, 25).map((item) => [item.fieldId, Object.keys(item.changes)]) });
    }
    const image = Recovery.imageOf(caseForm);
    const plan = Recovery.planCarry(image, buildMatcher(previous, newTemplate), { isApplicable: (target) => target.hidden !== true });
    report.archivedValues += plan.counts.archived;
    report.flagsProvenanceUnknown += plan.flags.provenanceUnknown.length;
    plan.dispositions.filter((item) => item.kind === "value" && item.disposition === "preserved").forEach((item) => { if (item.bag === "manualOverrides") report.protectedValuesAffected.manualOverrides += 1; if (item.verified) report.protectedValuesAffected.verified += 1; });
    const filled = Recovery.leaves(image.answers.filledData || {}, "", false).filter(([, value]) => !Recovery.isMissing(value));
    const known = filled.filter(([key]) => image.answers.fieldValueProvenance && image.answers.fieldValueProvenance[key]).length;
    filledTotal += filled.length; withProvenance += known;
    report.provenanceCoverage.perForm.push({ caseFormId: idStr(caseForm._id), filled: filled.length, withProvenance: known, percent: filled.length ? Math.round((known / filled.length) * 100) : 100 });
    if (plan.unresolved.length) {
      report.blocked += 1;
      plan.unresolved.forEach((item) => { const entry = { caseFormId: idStr(caseForm._id), caseId: idStr(caseForm.caseId), ...item }; report.unresolved.push(entry); if (item.code === "COLLISION") report.collisions.push(entry); });
    } else report.wouldMigrate += 1;
  }
  report.provenanceCoverage.overall = filledTotal ? Math.round((withProvenance / filledTotal) * 100) : null;
  report.fieldDiff = [...diffs.values()];
  return report;
}

module.exports = {
  migrateCaseFormsToEdition, migrateOneCaseForm, planMigration, frozenReconciliationReport, buildMatcher, FROZEN_STATUSES, leaves,
  // re-exported so the pipeline / a future admin tool needs one require
  reconcileIncompleteMigrations: (options) => Recovery.reconcileIncompleteMigrations(options),
  restoreCaseFormFromPreImage: (snapshotId, options) => Recovery.restoreCaseFormFromPreImage(snapshotId, options),
};
