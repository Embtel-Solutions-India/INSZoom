// Clears away the leftover non-live copies of a form once its edition is live and the open cases have moved onto it.
//
// A form can end up with extra records next to its live edition: a second import of the same edition (a "re-fetch"), an older edition that was never promoted, or a record stored
// under a code that is not a form at all (I-854 is published only as I-854A / I-854B). They never serve a case, but they show in the Forms list as "Review" / "Retired" and can be
// picked up by a later lookup. This service removes them - and ONLY when every condition below holds:
//
//   1. the form has a LIVE edition, and the leftover is not newer than it (a newer review copy is a pending upgrade and is never touched - unless its PDF is proven to be another form);
//   2. the cases have finished moving: no pipeline job of this form is open (queued, running, blocked or held - the case migration is a pipeline job);
//   3. NOTHING references the leftover: no case form (current, migrated-from or version-locked), no migration snapshot or report, no checklist selection, no AI suggestion, no question
//      library item, no generated questionnaire, no component definition, no newer edition built from it;
//   4. it is not the live record and does not share the live edition's stored PDF file (the file is never touched - only database records are removed).
//
// A leftover that IS still referenced is only retired (it stops being offered; its data stays), and a later run removes it once nothing points at it. Removal also drops the
// leftover's own mapping versions. Fail-safe: never throws, never touches a live edition or a case.
const logger = require("../../../utils/logger");
const { parentOnlyChildren } = require("../config/formSourceAliases");

const model = (name) => require(`../../../models/${name}`);
const OPEN_JOB_STATES = ["pending", "running", "blocked", "held"];
const day = (value) => (value ? new Date(value).toISOString().slice(0, 10) : "");

/** Everything that points at a template (the mapping versions are the template's own and are counted apart). Returns { total, byKind }. */
async function referencesTo(id) {
  const kinds = {
    caseForms: () => model("CaseForm").countDocuments({ $or: [{ formTemplateId: id }, { "formVersionLock.formTemplateId": id }, { "formVersionLock.migratedFrom": id }] }),
    migrationSnapshots: () => model("CaseFormMigrationSnapshot").countDocuments({ $or: [{ fromTemplateId: id }, { toTemplateId: id }] }),
    migrationReports: () => model("FormMigrationReport").countDocuments({ templateId: id }),
    selections: () => model("CaseFormSelection").countDocuments({ templateId: id }),
    aiSuggestions: () => model("FormAiMappingSuggestion").countDocuments({ templateId: id }),
    questionLibrary: () => model("QuestionLibraryItem").countDocuments({ formTemplate: id }),
    questionnaires: () => model("Questionnaire").countDocuments({ "generation.formTemplateIds": id }),
    components: () => model("USCISFormComponentDefinition").countDocuments({ parentTemplateId: id }),
    newerEditions: () => model("USCISFormTemplate").countDocuments({ parentVersion: id }),
  };
  const byKind = {};
  let total = 0;
  for (const [name, count] of Object.entries(kinds)) {
    byKind[name] = await count();
    total += byKind[name];
  }
  return { total, byKind };
}

// A copy whose stored PDF is clearly ANOTHER form (FormIdentityService: the file's own footers name a different form - the EOIR-29 file stored as G-28 / I-130 / I-360, an I-485 Supplement J file
// stored as I-140) is not a pending upgrade whatever its edition date says: it is a wrong file. Fails safe: any doubt (no file, unreadable, no footer number) means "not proven wrong".
async function isWrongForm(template, formCode) {
  try {
    const key = template?.artifacts?.form?.storageKey || template?.pdfStorageKey;
    if (!key) return false;
    const buffer = await require("../../uploads/storage.service").readBuffer(key);
    const verdict = await require("./FormIdentityService").check(buffer, formCode);
    return verdict.ok === false;
  } catch (_error) {
    return false;
  }
}

const fileKeyOf = (template) => template?.artifacts?.form?.storageKey || template?.pdfStorageKey || null;

/**
 * One form code. Returns { formCode, removed: [...], retired: [...], kept: [{ id, reason }] }.
 * options.dryRun reports without changing anything.
 */
async function cleanupForm(formCode, { dryRun = false } = {}) {
  const result = { formCode, removed: [], retired: [], kept: [] };
  const USCISFormTemplate = model("USCISFormTemplate");
  const all = await USCISFormTemplate.find({ formCode }).select("version editionDate status pdfStorageKey artifacts.form.storageKey").lean();
  const live = all.filter((template) => template.status === "active").sort((a, b) => new Date(b.editionDate || 0) - new Date(a.editionDate || 0));
  const parentOnly = Boolean(parentOnlyChildren(formCode)); // a code that is not a form: nothing of it is ever live

  if (!live.length && !parentOnly) return result;
  const newestLive = live[0];
  const liveFiles = new Set(live.map(fileKeyOf).filter(Boolean));

  // condition 2: the cases have finished moving (an open job of this form may still be moving them)
  const openJobs = await model("FormPipelineJob").countDocuments({ formCode, state: { $in: OPEN_JOB_STATES } });
  if (openJobs) {
    result.kept.push({ reason: "a pipeline job of this form is still open (the cases may still be moving)" });
    return result;
  }

  for (const template of all.filter((item) => item.status !== "active")) {
    const id = template._id;
    const label = { id: String(id), version: template.version, status: template.status };
    const newer = !parentOnly && newestLive && template.editionDate && new Date(template.editionDate) > new Date(newestLive.editionDate);
    if (newer && !(await isWrongForm(template, formCode))) { result.kept.push({ ...label, reason: "newer than the live edition (a pending upgrade)" }); continue; }
    const file = fileKeyOf(template);
    const sharesFile = Boolean(file && liveFiles.has(file));
    const references = await referencesTo(id);
    if (references.total > 0) {
      // still in use somewhere: stop offering it, keep its data; a later run removes it once nothing points at it
      if (["retired", "archived"].includes(template.status)) { result.kept.push({ ...label, reason: "still referenced", references: references.byKind }); continue; }
      if (!dryRun) await require("../../uscis-lifecycle/services/VersionManagementService").retire(id, require("../../form-pipeline/systemActor").systemActor(), { headers: {}, ip: "pipeline", requestId: "stale-cleanup" }).catch(() => null);
      result.retired.push({ ...label, references: references.byKind });
      continue;
    }
    if (sharesFile) { /* the stored PDF is shared with the live edition: only the records go, never the file - which is exactly what happens below */ }
    if (!dryRun) {
      await model("USCISMappingVersion").deleteMany({ template: id });
      await USCISFormTemplate.deleteOne({ _id: id, status: { $ne: "active" } });
    }
    result.removed.push({ ...label, day: day(template.editionDate), sharedFile: sharesFile, wrongForm: Boolean(newer) });
  }
  if (!dryRun && (result.removed.length || result.retired.length)) {
    logger.info("uscis_stale_edition_cleanup", { formCode, removed: result.removed.map((item) => `${item.version}/${item.status}`), retired: result.retired.map((item) => `${item.version}/${item.status}`) });
    try { require("../../uscis-forms/uscis-form.service").invalidateTemplateCache(); } catch (_error) { /* cache only */ }
  }
  return result;
}

/** Every form code that has a live edition, plus the parent-only codes. Bounded by `limit`. Never throws. */
async function cleanupAll({ dryRun = false, limit = 400, only } = {}) {
  const summary = { forms: 0, removed: 0, retired: 0, details: [] };
  try {
    const USCISFormTemplate = model("USCISFormTemplate");
    const codes = new Set(await USCISFormTemplate.distinct("formCode", { status: "active" }));
    for (const code of Object.keys(require("../config/formSourceAliases").PARENT_ONLY)) codes.add(code);
    for (const formCode of [...codes].filter((code) => !only?.length || only.includes(code)).slice(0, limit)) {
      try {
        const result = await cleanupForm(formCode, { dryRun });
        summary.forms += 1;
        summary.removed += result.removed.length;
        summary.retired += result.retired.length;
        if (result.removed.length || result.retired.length) summary.details.push(result);
      } catch (error) {
        logger.warn("uscis_stale_edition_cleanup_form_failed", { formCode, error: error.message });
      }
    }
  } catch (error) {
    logger.warn("uscis_stale_edition_cleanup_failed", { error: error.message });
  }
  return summary;
}

module.exports = { cleanupForm, cleanupAll, referencesTo, OPEN_JOB_STATES };
