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
const { wrapCaseMatcher } = require("../matching/editionCarry");
const { MATCHER_VERSION } = require("../matching");
const ConflictPolicy = require("./migration/ConflictPolicy");
const MetaRemap = require("./migration/MetaRemap");
const logger = require("../../../utils/logger");

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
  const current = (path) => newByKey.get(path) || newByBase.get(stripSubform(path)) || renamed.get(path);
  // Phase 7.3 (gated by FORM_PIPELINE_AUTONOMY): off returns `current` unchanged; shadow logs where the semantic matcher differs; on lets it resolve ONLY what `current` did not
  const wrapped = wrapCaseMatcher({ current, oldTemplate, newTemplate });
  // exact-name pairs whose widget kind / options / help text changed: exposed for the planning step (not applied yet); empty and unset when the switch is off
  if (wrapped.conflicts.length) wrapped.match.conflicts = wrapped.conflicts;
  return wrapped.match;
}

const targetIdOf = (target) => target.fieldId || target.id || target.fieldName;
/** Phase 7.7: the OLD edition's field for an answer key (its type / options are what a conversion rule compares against). */
function oldFieldLookup(template) {
  const map = new Map();
  ((template && template.formFields) || []).forEach((field) => fieldKeys(field).forEach((key) => map.set(key, field)));
  return (path) => map.get(path) || map.get(stripSubform(path)) || null;
}
const modeOf = (deps = {}) => Recovery.modeOf(deps);
const isApplicableTarget = (target) => target.hidden !== true;

/** Shadow mode: plan with the new rules too and log HOW it would differ from what is about to be done. Never changes anything, never throws. */
function shadowCompare({ image, matcher, previous, plan, formCode, caseFormId }) {
  try {
    const next = Recovery.planCarry(image, matcher, { isApplicable: isApplicableTarget, v7: { oldField: oldFieldLookup(previous) } });
    const sum = (p) => ({ carried: p.counts.carried, archived: p.counts.archived, unresolved: p.unresolved.length, converted: p.dispositions.filter((item) => item.converted).length });
    const now = sum(plan);
    const would = sum(next);
    if (JSON.stringify(now) !== JSON.stringify(would)) logger.warn("case_migration_shadow_difference", { formCode, caseFormId: String(caseFormId), now, wouldBe: would, newUnresolved: next.unresolved.map((item) => item.code + ":" + (item.policy || "")).slice(0, 10) });
  } catch (error) {
    try { logger.warn("case_migration_shadow_failed", { formCode, error: error.message }); } catch { /* never throw */ }
  }
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
  const mode = modeOf(deps);
  try {
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const loaded = await Recovery.loadImage(CaseForm, caseFormId);
      if (!loaded) return { outcome: "failed", error: "case form not found" };
      if (isFrozen(loaded.doc)) return { outcome: "frozen" };
      if (idStr(loaded.doc.formTemplateId) === idStr(newTemplate._id)) return { outcome: "skipped", reason: "already on the new edition" };
      const parkedNow = loaded.doc.migrationState && loaded.doc.migrationState.step === "parked" ? loaded.doc.migrationState.parked : null;
      // Phase 7.7 (on): a parked case form is not re-planned in a loop - only when the rules / matcher changed, the edition changed, or the case form was edited since
      if (mode === "on" && parkedNow && ConflictPolicy.isParkCurrent(parkedNow, { toTemplateId: newTemplate._id, updatedAt: loaded.doc.updatedAt, matcherVersion: MATCHER_VERSION })) {
        return { outcome: "unresolved", parked: true, cached: true, unresolved: (parkedNow.unresolved || []).map((item) => ({ caseFormId: idStr(caseFormId), caseId: idStr(loaded.doc.caseId), ...item })) };
      }
      const matcher = buildMatcher(previous, newTemplate);
      const v7 = mode === "on" ? { oldField: oldFieldLookup(previous) } : null;
      const plan = Recovery.planCarry(loaded.image, matcher, { isApplicable: isApplicableTarget, ...(v7 ? { v7 } : {}) });
      if (mode === "shadow") shadowCompare({ image: loaded.image, matcher, previous, plan, formCode: loaded.doc.formCode, caseFormId });
      if (plan.unresolved.length) {
        if (mode === "on") {
          // persistent, re-evaluable "parked" record: the case form itself is untouched (updatedAt unchanged) and stays on its old edition
          await Recovery.setState(deps, caseFormId, { step: "parked", parked: ConflictPolicy.parkRecord({ unresolved: plan.unresolved, toTemplateId: newTemplate._id, updatedAt: loaded.doc.updatedAt, matcherVersion: MATCHER_VERSION }) });
        }
        return { outcome: "unresolved", ...(mode === "on" ? { parked: true } : {}), counts: plan.counts, unresolved: plan.unresolved.map((item) => ({ caseFormId: idStr(caseFormId), caseId: idStr(loaded.doc.caseId), ...item })) };
      }
      // Phase 7.7 (on): the non-answer records that name a field follow it, and generated PDFs are marked stale (nothing deleted); both are undoable from the snapshot
      let remap = null;
      let stale = null;
      if (mode === "on") {
        remap = MetaRemap.plan(loaded.doc, matcher, targetIdOf);
        if (loaded.doc.filledPdfPath || loaded.doc.generatedPdfDocument || (loaded.doc.generatedPdfVersions || []).length) {
          stale = { since: new Date(), reason: "edition_migration", fromVersion: previous && previous.version, toVersion: newTemplate.version, migrationJobId: jobId, hadFilledPdfPath: Boolean(loaded.doc.filledPdfPath), generatedPdfVersions: (loaded.doc.generatedPdfVersions || []).length };
        }
      }

      await deps.checkpoint?.("planned");
      const extraPre = mode === "on" && ((remap && Object.keys(remap.pre).length) || stale) ? { ...remap.pre, ...(stale ? { stalePdf: true } : {}) } : null;
      const snapshot = await Recovery.createSnapshot(deps, { caseForm: loaded.doc, image: loaded.image, jobId, fromTemplateId: previous?._id, toTemplateId: newTemplate._id, dispositions: plan.dispositions, proof: mode === "on" ? plan.proof : null, extraPre });
      await Recovery.setState(deps, caseFormId, { jobId, snapshotId: snapshot._id, step: "snapshotted", error: null, ...(mode === "on" && parkedNow ? { parked: null } : {}) });
      await deps.checkpoint?.("snapshotted");

      const now = new Date();
      const archive = { fromVersion: previous?.version, fromTemplateId: previous?._id, toVersion: newTemplate.version, migratedAt: now, migratedBy: actor?._id, migrationJobId: jobId, snapshotId: snapshot._id, unmatchedValues: plan.archive.unmatchedValues, ...(Object.keys(plan.archive.unmatchedMeta).length ? { unmatchedMeta: plan.archive.unmatchedMeta } : {}), ...(plan.archive.merged.length ? { mergedCollisions: plan.archive.merged } : {}), ...(plan.flags.provenanceUnknown.length ? { provenanceUnknown: plan.flags.provenanceUnknown } : {}), ...(mode === "on" && plan.proof ? { proofChecksum: plan.proof.checksum, conversions: plan.proof.entries.filter((entry) => entry.converted).map((entry) => ({ bag: entry.bag, from: entry.oldKey, to: entry.newKey, rule: entry.rule })) } : {}), ...(mode === "on" && remap && remap.changed ? { remappedRecords: remap.changed } : {}) };
      const $set = {};
      for (const [key, value] of Object.entries(plan.writes)) $set[key] = key === "fieldValueProvenance" ? Object.fromEntries(Object.entries(value).map(([field, item]) => [Recovery.encodeKey(field), item])) : value;
      const lock = loaded.image.pointers.formVersionLock || {};
      Object.assign($set, {
        formTemplateId: newTemplate._id, formVersion: newTemplate.version, formEditionDate: newTemplate.editionDate,
        mappingVersion: newTemplate.activeMappingVersion || 0, mappingVersionId: newTemplate.activeMappingVersionId,
        formVersionLock: { ...lock, formType: loaded.doc.formCode, editionDate: newTemplate.editionDate, version: newTemplate.version, mappingVersion: newTemplate.activeMappingVersion || 0, mappingVersionId: newTemplate.activeMappingVersionId, formTemplateId: newTemplate._id, migratedFrom: previous?._id, migratedAt: now, migratedBy: actor?._id },
      });
      if (mode === "on") { Object.assign($set, remap ? remap.set : {}); if (stale) $set.generatedPdfStale = stale; }
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
      if (mode === "on" && finished.outcome === "restored") {
        // a verification that failed (and was safely undone) must not be retried in a loop on every run: park it until the rules / matcher change or the case form is edited
        try {
          const after = await CaseForm.findById(caseFormId).select("updatedAt").lean();
          const problem = (finished.problems || [])[0] || {};
          await Recovery.setState(deps, caseFormId, { step: "parked", parked: ConflictPolicy.parkRecord({ unresolved: [{ code: "VERIFICATION_FAILED", reason: "the migrated case form did not verify against its pre-image and was restored: " + (problem.code || "unknown"), policy: problem.code || "verification_failed" }], toTemplateId: newTemplate._id, updatedAt: after && after.updatedAt, matcherVersion: MATCHER_VERSION }) });
        } catch (parkError) { logger.warn("case_migration_park_after_restore_failed", { caseFormId: idStr(caseFormId), error: parkError.message }); }
      }
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
  if (modeOf(deps) === "on") return migrateStreaming({ newTemplate, formCode, actor, req, deps, result });
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

/** What happened to one case form, folded into the run's result (Phase 7.7 path; the original loop above keeps its own inline copy). */
function applyOutcome(result, outcome, id) {
  switch (outcome.outcome) {
    case "migrated":
      result.migrated += 1;
      if (outcome.verified) result.verified += 1;
      result.valuesCarried += outcome.counts?.carried || 0;
      result.valuesArchived += outcome.counts?.archived || 0;
      break;
    case "unresolved":
      result.unresolved.push(...outcome.unresolved);
      if (outcome.parked) (result.parked ||= []).push({ caseFormId: id, reasons: [...new Set(outcome.unresolved.map((item) => item.code))], cached: Boolean(outcome.cached) });
      break;
    case "restored": result.restored += 1; break;
    case "reconciliation_required": result.reconciliationRequired.push({ caseFormId: id, changes: outcome.changes || [], problems: outcome.problems || [] }); break;
    case "concurrent_edit": result.failed.push({ caseFormId: id, stage: "concurrent_edit", error: "a person edited this case form while it was being migrated; it was left on its old edition" }); break;
    case "frozen": result.skippedFrozen += 1; break;
    case "skipped": break;
    default: result.failed.push({ caseFormId: id, stage: outcome.stage || "migrate", error: outcome.error || "unknown error" });
  }
}

const withBudget = (promise, ms, id) => {
  if (!(ms > 0)) return promise;
  let timer;
  const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve({ outcome: "failed", stage: "time_budget", error: "the case form did not finish within its time budget (" + ms + " ms); it is re-checked by the recovery sweep and the next run", requeue: true, caseFormId: id }), ms); timer.unref?.(); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
};

/**
 * Phase 7.7 (FORM_PIPELINE_AUTONOMY on): the same migration, paged by _id (no whole-collection load), with bounded concurrency (CASE_MIGRATION_CONCURRENCY, default 1 = sequential),
 * a time budget per case form, a lease check before each batch (deps.leaseAlive), and forms already on a NEWER edition left alone. A stopped / timed-out run reports
 * result.requeue = true so the caller runs the remaining case forms again; nothing is lost either way (every case form is migrated or left untouched).
 */
async function migrateStreaming({ newTemplate, formCode, actor, req, deps, result }) {
  const { CaseForm } = caseFormDeps(deps);
  const priorEditions = await USCISFormTemplate.find({ formCode, _id: { $ne: newTemplate._id } }).lean();
  const priorById = new Map(priorEditions.map((template) => [String(template._id), template]));
  const query = { $or: [{ formCode }, { parentFormCode: formCode }], formTemplateId: { $in: [...priorById.keys()] } };
  const pageSize = Math.max(1, Number(process.env.CASE_MIGRATION_PAGE_SIZE || 50));
  const concurrency = Math.max(1, Number(process.env.CASE_MIGRATION_CONCURRENCY || 1));
  const budgetMs = Number(process.env.CASE_MIGRATION_CASE_FORM_BUDGET_MS || 120000);
  const jobId = crypto.randomUUID();
  result.parked = [];
  result.skippedNewer = 0;
  const frozen = [];
  let lastId = null;
  let stop = false;
  const processOne = async (caseForm) => {
    const id = idStr(caseForm._id);
    const previous = priorById.get(idStr(caseForm.formTemplateId));
    if (previous && previous.editionDate && newTemplate.editionDate && new Date(previous.editionDate) > new Date(newTemplate.editionDate)) { result.skippedNewer += 1; return; }
    const outcome = await withBudget(migrateOneCaseForm({ caseFormId: caseForm._id, previous, newTemplate, actor, req, deps, jobId, result }), budgetMs, id);
    if (outcome.requeue) result.requeue = true;
    applyOutcome(result, outcome, id);
  };
  while (!stop) {
    const page = await CaseForm.find(lastId ? { $and: [query, { _id: { $gt: lastId } }] } : query).sort({ _id: 1 }).limit(pageSize).lean();
    if (!page.length) break;
    lastId = page[page.length - 1]._id;
    result.considered += page.length;
    const todo = [];
    for (const caseForm of page) {
      if (isFrozen(caseForm)) { frozen.push(caseForm); result.skippedFrozen += 1; continue; }
      if (Recovery.IN_PROGRESS_STEPS.includes(caseForm.migrationState?.step)) { result.inProgress += 1; continue; }
      todo.push(caseForm);
    }
    for (let i = 0; i < todo.length; i += concurrency) {
      if (deps.leaseAlive && !(await Promise.resolve(deps.leaseAlive()).catch(() => false))) { result.stopped = "lease_lost"; result.requeue = true; stop = true; break; }
      await Promise.all(todo.slice(i, i + concurrency).map(processOne));
    }
  }
  result.frozenReport = await describeFrozen(frozen, priorById, newTemplate, deps).catch(() => []);
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
  migrateCaseFormsToEdition, migrateOneCaseForm, planMigration, frozenReconciliationReport, buildMatcher, oldFieldLookup, FROZEN_STATUSES, leaves,
  // re-exported so the pipeline / a future admin tool needs one require
  reconcileIncompleteMigrations: (options) => Recovery.reconcileIncompleteMigrations(options),
  restoreCaseFormFromPreImage: (snapshotId, options) => Recovery.restoreCaseFormFromPreImage(snapshotId, options),
};
