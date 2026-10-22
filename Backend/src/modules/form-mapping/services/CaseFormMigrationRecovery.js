// Safe case migration, part 2 (plan Rule G): everything that makes moving a case form to a new USCIS edition recoverable.
//
//   pure     canonical images + checksums, the carry PLAN (dispositions per old answer record), verification of a result against the pre-image, state diffs
//   stored   the pre-image snapshot (CaseFormMigrationSnapshot), migrationState on the case form, compare-and-set writes, the step machine that continues a migration
//            after the new edition was saved (autofill -> restore -> verify -> complete), the safe restore, and the sweeper that resumes migrations that stopped half-way
//
// Rules that hold everywhere in this file:
//   - a person's newer edit is NEVER overwritten: every write is a compare-and-set on updatedAt, and a restore only happens when the case form is exactly in the state the
//     migration itself left it in (otherwise the case form goes to `reconciliation_required` and the pre-image is kept, with no expiry, for an audited admin decision);
//   - nothing is deleted: not a case form, not an answer (values with no counterpart are archived on the case form with the reason);
//   - writes go through the native collection (no Mongoose casting of dotted PDF field names) and the migration's own bookkeeping never changes `updatedAt`.
const crypto = require("crypto");
const logger = require("../../../utils/logger");

const ANSWER_KEYS = ["filledData", "fieldValues", "manualOverrides", "fieldValueProvenance", "sourceAttribution", "fieldReviews", "sectionReviews"];
const POINTER_KEYS = ["status", "isLocked", "formTemplateId", "formVersion", "formEditionDate", "mappingVersion", "mappingVersionId", "formVersionLock"];
const VALUE_BAGS = ["filledData", "fieldValues", "manualOverrides"];
const META_MAPS = ["fieldValueProvenance", "sourceAttribution", "fieldReviews"]; // keyed by field id: they travel with the value
const IN_PROGRESS_STEPS = ["snapshotted", "saved", "autofilled", "verified"];
const RETENTION_DAYS = () => Number(process.env.CASE_FORM_MIGRATION_SNAPSHOT_DAYS || 90);
const DAY_MS = 24 * 60 * 60 * 1000;

const VERIFIED_REVIEW = new Set(["approved", "confirmed", "verified"]);
const VERIFIED_ATTRIBUTION = new Set(["manual_override", "approved", "attorney_verified", "case_manager_verified"]);
const AUTOFILL_SOURCES = new Set(["canonical", "ocr", "questionnaire"]);

// ── small pure helpers ───────────────────────────────────────────────────────
const isPlain = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value) && !(value instanceof Date) && value._bsontype === undefined && !(value instanceof Map);
const isMissing = (value) => value === undefined || value === null || value === "";
const idString = (value) => (value === undefined || value === null ? null : String(value._id || value));
const encodeKey = (key) => String(key).replace(/\./g, "․"); // CaseForm.fieldValueProvenance is a Mongoose Map: its keys cannot hold "." (AutoFillService encodes the same way)
const decodeKey = (key) => String(key).replace(/․/g, ".");

function clonePlain(value) {
  if (value instanceof Map) return clonePlain(Object.fromEntries(value.entries()));
  if (Array.isArray(value)) return value.map(clonePlain);
  if (value instanceof Date) return new Date(value.getTime());
  if (isPlain(value)) { const out = {}; for (const [key, item] of Object.entries(value)) if (item !== undefined) out[key] = clonePlain(item); return out; }
  return value;
}

/** A plain object from a lean document, a Mongoose document or a plain test object. */
function toPlain(doc) {
  if (!doc) return doc;
  if (typeof doc.toObject === "function") return doc.toObject({ flattenMaps: true, minimize: false, depopulate: true });
  return doc;
}

/** Stable JSON text: sorted keys, dates and ids as text, undefined / empty objects as null (a value that survives a database round trip hashes the same). */
function canonical(value) {
  const norm = (item) => {
    if (item === undefined || item === null) return null;
    if (item instanceof Date) return { $date: item.toISOString() };
    if (item._bsontype === "ObjectId" || item._bsontype === "ObjectID") return { $oid: String(item) };
    if (item instanceof Map) return norm(Object.fromEntries(item.entries()));
    if (Array.isArray(item)) return item.map(norm);
    if (typeof item === "object") {
      const keys = Object.keys(item).filter((key) => item[key] !== undefined).sort();
      if (!keys.length) return null;
      return Object.fromEntries(keys.map((key) => [key, norm(item[key])]));
    }
    return item;
  };
  return JSON.stringify(norm(value));
}
const sha256 = (text) => crypto.createHash("sha256").update(text).digest("hex");
const sameValue = (left, right) => canonical(left) === canonical(right);

/** leaves of a bag as [path, value]; a flat bag (dotted top-level keys) is its own leaves */
function leaves(bag, prefix = "", forceFlat = false) {
  if (!isPlain(bag)) return [];
  const flat = forceFlat || (!prefix && Object.keys(bag).some((key) => key.includes(".")));
  const out = [];
  for (const [key, value] of Object.entries(bag)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (!flat && isPlain(value) && Object.keys(value).length) out.push(...leaves(value, path));
    else out.push([path, value]);
  }
  return out;
}

const getPath = (source, path) => path.split(".").reduce((node, key) => (node === undefined || node === null ? undefined : node[key]), source);
function setPath(target, path, value) {
  const keys = path.split(".");
  let node = target;
  keys.slice(0, -1).forEach((key) => { if (!isPlain(node[key])) node[key] = {}; node = node[key]; });
  node[keys[keys.length - 1]] = value;
}
/** a bag value by field id: a flat key first, then the nested path */
const bagValue = (bag, key) => (isPlain(bag) && Object.prototype.hasOwnProperty.call(bag, key) ? bag[key] : getPath(bag, key));
function setBagValue(bag, key, value) {
  if (Object.keys(bag).some((item) => item.includes(".")) || Object.prototype.hasOwnProperty.call(bag, key)) bag[key] = value;
  else setPath(bag, key, value);
}

// ── images ───────────────────────────────────────────────────────────────────
/** The persisted answer records + edition pointers of a case form. Provenance keys are decoded (the real field id). */
function imageOf(doc) {
  const plain = toPlain(doc) || {};
  const answers = {};
  for (const key of ANSWER_KEYS) answers[key] = clonePlain(plain[key]) ?? null;
  if (answers.fieldValueProvenance) answers.fieldValueProvenance = Object.fromEntries(Object.entries(answers.fieldValueProvenance).map(([key, value]) => [decodeKey(key), value]));
  const pointers = {};
  for (const key of POINTER_KEYS) pointers[key] = clonePlain(plain[key]) ?? null;
  return { answers, pointers };
}
const imageChecksum = (image) => sha256(canonical(image));

/** Where two images differ: [{ path, expected, actual }] (at most `limit`). */
function diffImages(expected, actual, limit = 200) {
  const left = JSON.parse(canonical(expected) || "null");
  const right = JSON.parse(canonical(actual) || "null");
  const out = [];
  const walk = (a, b, path) => {
    if (out.length >= limit) return;
    if (JSON.stringify(a) === JSON.stringify(b)) return;
    if (isPlain(a) && isPlain(b) && !("$date" in a) && !("$oid" in a)) {
      for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) walk(a[key], b[key], path ? `${path}.${key}` : key);
      return;
    }
    out.push({ path, expected: a === undefined ? null : a, actual: b === undefined ? null : b });
  };
  walk(left, right, "");
  return out;
}

// ── what kind of record is this ──────────────────────────────────────────────
/**
 * userSourced: a person typed / overrode it (manualOverrides, or provenance case_manager_override)      verified: a reviewer approved it
 * provenAutofill: provenance says the system derived it (canonical / ocr / questionnaire) and nobody overrode it
 * unknownProvenance: nothing says where it came from - never silently dropped, kept and flagged
 */
function classifyRecord(key, image) {
  const { answers } = image;
  const provenance = isPlain(answers.fieldValueProvenance) ? answers.fieldValueProvenance[key] : undefined;
  const overridden = Boolean(answers.manualOverrides && bagValue(answers.manualOverrides, key) !== undefined);
  const userSourced = overridden || provenance?.source === "case_manager_override" || Boolean(provenance?.overriddenBy || provenance?.overriddenAt);
  const review = isPlain(answers.fieldReviews) ? answers.fieldReviews[key] : undefined;
  const attribution = isPlain(answers.sourceAttribution) ? answers.sourceAttribution[key] : undefined;
  const verified = VERIFIED_REVIEW.has(review?.status) || VERIFIED_ATTRIBUTION.has(attribution?.verificationStatus || attribution?.validationStatus);
  const provenAutofill = !userSourced && !verified && Boolean(provenance) && AUTOFILL_SOURCES.has(provenance.source || "canonical");
  return { userSourced, verified, provenAutofill, unknownProvenance: !provenance && !overridden };
}
/** A value that says nothing: blank, or an unticked / false value the system itself derived. A user-sourced `false` (or one of unknown origin) IS an answer. */
const isNonAnswer = (value, kind) => isMissing(value) || (value === false && kind.provenAutofill);

// ── the carry plan ───────────────────────────────────────────────────────────
/**
 * PURE. Decides, before anything is written, where every old answer record goes. `match(path)` returns the new edition's field (or nothing).
 * Dispositions: preserved | archived (with a reason, the value is kept on the case form) | unresolved (blocks THIS case's migration).
 * Returns { writes, archive, dispositions, unresolved, flags, counts }.
 */
function planCarry(image, match, { isApplicable = () => true } = {}) {
  const writes = {};
  const archive = { unmatchedValues: {}, unmatchedMeta: {}, merged: [] };
  const dispositions = [];
  const unresolved = [];
  const flags = { provenanceUnknown: [] };
  const counts = { total: 0, carried: 0, archived: 0 };
  const winners = new Map(); // new field id -> the old key whose value was kept

  const targetIdOf = (target) => target.fieldId || target.id || target.fieldName;
  const archiveValue = (bag, oldKey, value, reason, extra = {}) => {
    (archive.unmatchedValues[bag] ||= {})[oldKey] = value;
    dispositions.push({ kind: "value", bag, oldKey, disposition: "archived", reason, ...extra });
    counts.archived += 1;
  };

  for (const bag of VALUE_BAGS) {
    const original = image.answers[bag];
    if (!isPlain(original)) continue;
    const flatOutput = bag !== "filledData" || Object.keys(original).some((key) => key.includes("."));
    const entries = leaves(original, "", bag !== "filledData");
    const out = {};
    const byTarget = new Map();
    for (const [path, value] of entries) {
      counts.total += 1;
      const kind = classifyRecord(path, image);
      const target = match(path);
      const common = { userSourced: kind.userSourced, verified: kind.verified, unknownProvenance: kind.unknownProvenance };
      if (!target) {
        // a value a person typed or a reviewer verified, with nowhere to go, blocks the migration of this case (it is never dropped and never silently archived)
        if (bag === "manualOverrides" || kind.userSourced || kind.verified) {
          unresolved.push({ code: "NO_COUNTERPART_FOR_PROTECTED_VALUE", bag, oldKeys: [path], reason: "a manual or verified value has no matching box in the new edition" });
          dispositions.push({ kind: "value", bag, oldKey: path, disposition: "unresolved", reason: "no_counterpart_protected", ...common });
        } else if (isNonAnswer(value, kind)) archiveValue(bag, path, value, "no_counterpart_non_answer", common);
        else archiveValue(bag, path, value, "no_counterpart", common);
        continue;
      }
      if (!isApplicable(target)) { archiveValue(bag, path, value, "inapplicable_in_new_edition", common); continue; }
      const id = targetIdOf(target);
      byTarget.set(id, [...(byTarget.get(id) || []), { path, value, kind, common }]);
    }
    for (const [id, group] of byTarget) {
      let keep = group;
      if (group.length > 1) {
        const real = group.filter((item) => !isNonAnswer(item.value, item.kind));
        const distinct = new Set(real.map((item) => canonical(item.value)));
        if (distinct.size > 1) {
          unresolved.push({ code: "COLLISION", bag, targetId: id, oldKeys: group.map((item) => item.path), values: group.map((item) => item.value), reason: "two old records with different values land on one box of the new edition" });
          group.forEach((item) => dispositions.push({ kind: "value", bag, oldKey: item.path, newKey: id, disposition: "unresolved", reason: "collision_different_values", ...item.common }));
          continue;
        }
        const winner = real.find((item) => item.kind.userSourced) || real[0] || group[0];
        keep = [winner];
        for (const item of group) {
          if (item === winner) continue;
          archiveValue(bag, item.path, item.value, real.length > 1 ? "equal_value_collision_merge" : "collision_non_answer", { ...item.common, newKey: id });
          archive.merged.push({ bag, targetId: id, kept: winner.path, archived: item.path });
        }
      }
      const [item] = keep;
      if (flatOutput) out[id] = item.value; else setPath(out, id, item.value);
      dispositions.push({ kind: "value", bag, oldKey: item.path, newKey: id, disposition: "preserved", ...item.common });
      counts.carried += 1;
      if (bag !== "manualOverrides" && item.common.unknownProvenance && !isMissing(item.value)) flags.provenanceUnknown.push(item.path);
      if (bag === "fieldValues" || (bag === "filledData" && !winners.has(id))) winners.set(id, item.path);
    }
    writes[bag] = out;
  }

  // metadata keyed by field id travels with the value that was kept
  const taken = new Set();
  for (const map of META_MAPS) {
    const original = image.answers[map];
    if (!isPlain(original)) continue;
    const out = {};
    for (const [key, value] of Object.entries(original)) {
      const target = match(key);
      const id = target ? targetIdOf(target) : null;
      const lostCollision = id && winners.has(id) && winners.get(id) !== key;
      if (!id || lostCollision || taken.has(`${map}|${id}`)) {
        (archive.unmatchedMeta[map] ||= {})[key] = value;
        dispositions.push({ kind: "meta", bag: map, oldKey: key, disposition: "archived", reason: id ? "lost_collision" : "no_counterpart" });
        continue;
      }
      out[id] = value;
      taken.add(`${map}|${id}`);
      const kind = classifyRecord(key, image);
      dispositions.push({ kind: "meta", bag: map, oldKey: key, newKey: id, disposition: "preserved", userSourced: kind.userSourced, verified: kind.verified });
    }
    writes[map] = out;
  }
  if (isPlain(image.answers.sectionReviews)) writes.sectionReviews = clonePlain(image.answers.sectionReviews); // keyed by section, not by field: unchanged by an edition move
  return { writes, archive, dispositions, unresolved, flags, counts };
}

/** The preserved records a person must find again after the migration: typed, overridden, verified, or of unknown origin. */
const needsProof = (item) => item.disposition === "preserved" && (item.userSourced || item.verified || item.unknownProvenance || item.bag === "manualOverrides");

/**
 * PURE. Verifies a migrated case form (re-read from the database) against the pre-image and the dispositions. Typed / overridden / verified values and their metadata
 * must be exactly what they were; a value of unknown origin must still be there (autofill may refresh it, never blank it); every archived value must be on the case form.
 */
function verifyAgainstPlan({ preImage, dispositions, current, archiveEntry, newTemplateId }) {
  const problems = [];
  const before = preImage.answers;
  const after = current.answers;
  for (const item of dispositions || []) {
    if (item.disposition === "archived") {
      if (item.kind !== "value") continue;
      const original = bagValue(before[item.bag], item.oldKey);
      const kept = archiveEntry?.unmatchedValues?.[item.bag]?.[item.oldKey];
      if (!archiveEntry || (original !== undefined && !sameValue(original, kept))) problems.push({ code: "ARCHIVED_VALUE_MISSING", bag: item.bag, oldKey: item.oldKey });
      continue;
    }
    if (!needsProof(item)) continue;
    if (item.kind === "value") {
      const expected = bagValue(before[item.bag], item.oldKey);
      const actual = bagValue(after[item.bag], item.newKey);
      const protectedValue = item.userSourced || item.verified || item.bag === "manualOverrides";
      if (protectedValue ? !sameValue(expected, actual) : (isMissing(actual) && !isMissing(expected))) problems.push({ code: protectedValue ? "PROTECTED_VALUE_CHANGED" : "VALUE_BLANKED", bag: item.bag, oldKey: item.oldKey, newKey: item.newKey, expected, actual: actual ?? null });
    } else if (item.userSourced || item.verified) {
      const expected = before[item.bag]?.[item.oldKey];
      const actual = after[item.bag]?.[item.newKey];
      if (!sameValue(expected, actual)) problems.push({ code: "METADATA_CHANGED", bag: item.bag, oldKey: item.oldKey, newKey: item.newKey, expected, actual: actual ?? null });
    }
  }
  if (idString(current.pointers.formTemplateId) !== idString(newTemplateId)) problems.push({ code: "NOT_ON_NEW_EDITION", expected: idString(newTemplateId), actual: idString(current.pointers.formTemplateId) });
  return problems;
}

/** The values to put back when autofill blanked something a person had saved (a `false` the person set counts as an answer; one the system derived does not). */
function valuesToRestore(preImage, dispositions, currentFilled) {
  const out = [];
  for (const item of dispositions || []) {
    if (item.bag !== "filledData" || item.kind !== "value" || item.disposition !== "preserved") continue;
    const value = bagValue(preImage.answers.filledData, item.oldKey);
    if (isMissing(value) || (value === false && !item.userSourced && !item.unknownProvenance)) continue;
    const now = bagValue(currentFilled, item.newKey);
    if (isMissing(now) || (now === false && value !== false && item.userSourced)) out.push({ key: item.newKey, value });
  }
  return out;
}

// ── stores ───────────────────────────────────────────────────────────────────
function stores(deps = {}) {
  return {
    CaseForm: deps.CaseForm || require("../../../models/CaseForm"),
    Snapshot: deps.Snapshot || require("../../../models/CaseFormMigrationSnapshot"),
    now: deps.now || (() => new Date()),
  };
}
const expiryFrom = (now) => new Date(now.getTime() + RETENTION_DAYS() * DAY_MS);

async function loadImage(CaseForm, caseFormId) {
  const doc = await CaseForm.findById(caseFormId).lean();
  return doc ? { doc, image: imageOf(doc) } : null;
}

/** Writes only the migration's own bookkeeping; never touches updatedAt (that stays the clock of real content changes). */
async function setState(deps, caseFormId, patch) {
  const { CaseForm, now } = stores(deps);
  const $set = { "migrationState.updatedAt": now() };
  for (const [key, value] of Object.entries(patch)) $set[`migrationState.${key}`] = value;
  await CaseForm.collection.updateOne({ _id: caseFormId }, { $set });
}

/** Compare-and-set: applies `update` only while the case form is still exactly as it was read (updatedAt). Resolves true / false. */
async function casUpdate(deps, caseFormId, expectedUpdatedAt, update) {
  const { CaseForm, now } = stores(deps);
  const filter = { _id: caseFormId, updatedAt: expectedUpdatedAt ?? null };
  const result = await CaseForm.collection.updateOne(filter, { ...update, $set: { ...(update.$set || {}), updatedAt: now() } });
  return result.modifiedCount === 1;
}

async function createSnapshot(deps, { caseForm, image, jobId, fromTemplateId, toTemplateId, dispositions }) {
  const { Snapshot } = stores(deps);
  return Snapshot.create({
    caseFormId: caseForm._id, caseId: caseForm.caseId, migrationJobId: jobId, formCode: caseForm.formCode, fromTemplateId, toTemplateId,
    preImage: image, checksum: imageChecksum(image), dispositions,
  });
}

async function captureIntermediate(deps, caseFormId, snapshotId) {
  const { CaseForm, Snapshot } = stores(deps);
  const loaded = await loadImage(CaseForm, caseFormId);
  const checksum = imageChecksum(loaded.image);
  await Snapshot.updateOne({ _id: snapshotId }, { $set: { intermediateImage: loaded.image, intermediateChecksum: checksum } });
  await setState(deps, caseFormId, { expectedIntermediateChecksum: checksum });
  return loaded;
}

/** The retention clock starts only when nothing is left to decide: never while unresolved, failed, waiting for reconciliation or under legal hold. */
async function setSnapshotExpiry(deps, snapshotId) {
  const { Snapshot, now } = stores(deps);
  const snapshot = await Snapshot.findById(snapshotId).lean();
  if (!snapshot || snapshot.legalHold) return null;
  const expiresAt = expiryFrom(now());
  await Snapshot.updateOne({ _id: snapshotId }, { $set: { expiresAt } });
  return expiresAt;
}
async function clearSnapshotExpiry(deps, snapshotId) {
  const { Snapshot } = stores(deps);
  await Snapshot.updateOne({ _id: snapshotId }, { $unset: { expiresAt: "" } });
}

async function markReconciliation(deps, caseFormId, snapshotId, error) {
  await setState(deps, caseFormId, { step: "reconciliation_required", error: String(error || "a person edited this case form after the migration started").slice(0, 500) });
  await clearSnapshotExpiry(deps, snapshotId);
}

// ── restore (safe recovery) ──────────────────────────────────────────────────
/** The update that puts a case form's answer records and edition pointers back exactly as the pre-image has them. */
function restoreUpdate(preImage, jobId, auditEntry) {
  const $set = {};
  const $unset = {};
  const put = (key, value) => { if (value === null || value === undefined) $unset[key] = ""; else $set[key] = value; };
  for (const key of ANSWER_KEYS) {
    let value = preImage.answers[key];
    if (key === "fieldValueProvenance" && isPlain(value)) value = Object.fromEntries(Object.entries(value).map(([field, item]) => [encodeKey(field), item]));
    if (value === null || value === undefined) { if (key === "fieldValues" || key === "manualOverrides" || key === "sourceAttribution") $set[key] = {}; else $unset[key] = ""; } else $set[key] = value;
  }
  for (const key of POINTER_KEYS) put(key, preImage.pointers[key]);
  const update = { $set, ...(Object.keys($unset).length ? { $unset } : {}), $pull: { editionMigrations: { migrationJobId: jobId } } };
  return { update, auditEntry };
}

/**
 * Puts a case form back from its pre-image - ONLY when that cannot overwrite anything newer.
 *   1. the snapshot checksum must still match its pre-image (otherwise refused);
 *   2. already equal to the pre-image -> nothing to do (idempotent);
 *   3. equal to the state the migration left behind (intermediate checksum) -> restored (dryRun only reports);
 *   4. anything else is a newer edit: not restored, the case form goes to reconciliation_required, the pre-image is kept without expiry, the changed fields are listed.
 * Resolves { restored, dryRun?, alreadyRestored?, refused?, reconciliationRequired?, changes? }.
 */
async function restoreCaseFormFromPreImage(snapshotId, { dryRun = true, actor, deps = {}, reason = "restore from pre-image" } = {}) {
  const { CaseForm, Snapshot, now } = stores(deps);
  const snapshot = await Snapshot.findById(snapshotId).lean();
  if (!snapshot) return { restored: false, refused: "SNAPSHOT_NOT_FOUND" };
  if (imageChecksum(snapshot.preImage) !== snapshot.checksum) return { restored: false, refused: "SNAPSHOT_CHECKSUM_MISMATCH" };
  const loaded = await loadImage(CaseForm, snapshot.caseFormId);
  if (!loaded) return { restored: false, refused: "CASE_FORM_NOT_FOUND" };
  const currentChecksum = imageChecksum(loaded.image);
  if (currentChecksum === snapshot.checksum) return { restored: false, alreadyRestored: true };
  const ownChanges = snapshot.intermediateChecksum ? currentChecksum === snapshot.intermediateChecksum : Boolean(loaded.doc.migrationState?.expectedIntermediateChecksum && currentChecksum === loaded.doc.migrationState.expectedIntermediateChecksum);
  if (!ownChanges) {
    const changes = diffImages(snapshot.intermediateImage || snapshot.preImage, loaded.image);
    if (!dryRun) await markReconciliation(deps, snapshot.caseFormId, snapshot._id);
    return { restored: false, reconciliationRequired: true, dryRun, changes };
  }
  if (dryRun) return { restored: false, dryRun: true, wouldRestore: true, changes: diffImages(loaded.image, snapshot.preImage) };
  const audit = { action: "EDITION_MIGRATION_RESTORED", changes: { snapshotId: String(snapshot._id), jobId: snapshot.migrationJobId, reason }, performedBy: actor?._id, performedAt: now() };
  const { update } = restoreUpdate(snapshot.preImage, snapshot.migrationJobId, audit);
  update.$push = { auditHistory: audit };
  const written = await casUpdate(deps, snapshot.caseFormId, loaded.doc.updatedAt, update);
  if (!written) { await markReconciliation(deps, snapshot.caseFormId, snapshot._id, "a person edited this case form while it was being restored"); return { restored: false, reconciliationRequired: true, changes: [] }; }
  const after = await loadImage(CaseForm, snapshot.caseFormId);
  if (imageChecksum(after.image) !== snapshot.checksum) { await markReconciliation(deps, snapshot.caseFormId, snapshot._id, "the restored case form does not equal its pre-image"); return { restored: false, reconciliationRequired: true, changes: diffImages(snapshot.preImage, after.image) }; }
  await setState(deps, snapshot.caseFormId, { step: "completed", outcome: "restored" });
  await setSnapshotExpiry(deps, snapshot._id);
  try { await require("../../../models/AuditLog").create({ userId: actor?._id, userRole: actor?.role, action: "case_form_migration_restored", entityType: "CaseForm", entityId: String(snapshot.caseFormId), changes: { snapshotId: String(snapshot._id), reason } }); } catch (error) { logger.warn("case_form_restore_audit_failed", { error: error.message }); }
  return { restored: true };
}

// ── the step machine after the new edition was saved ─────────────────────────
const defaultAutofill = (caseId, formCode, actor, req, options) => require("./AutoFillService").generate(caseId, formCode, actor, req, options);

/**
 * Continues a migration whose new edition is already saved on the case form: autofill -> put back what autofill blanked -> read back and verify -> complete.
 * `from` is the recorded step ("saved" | "autofilled" | "verified"), so the same function resumes a crashed run. Never throws: resolves a plain outcome.
 */
async function continueAfterSave({ caseFormId, snapshotId, newTemplate, actor, req, deps = {}, from = "saved", result = {} }) {
  const { CaseForm, Snapshot } = stores(deps);
  const snapshot = await Snapshot.findById(snapshotId).lean();
  if (!snapshot) return { outcome: "failed", error: "snapshot missing" };
  const failed = (stage, error) => { (result.failed ||= []).push({ caseFormId: String(caseFormId), stage, error: String(error) }); };
  try {
    if (from === "saved") {
      const run = deps.autofill || defaultAutofill;
      const loaded = await loadImage(CaseForm, caseFormId);
      await Promise.resolve(run(loaded.doc.caseId, loaded.doc.formCode, actor, req || { ip: "system", headers: {} }, { regenerate: true })).catch((error) => failed("autofill", error.message));
      // never let autofill blank a value a person had saved
      const after = await loadImage(CaseForm, caseFormId);
      const filled = clonePlain(after.doc.filledData) || {};
      const restore = valuesToRestore(snapshot.preImage, snapshot.dispositions, filled);
      if (restore.length) {
        restore.forEach(({ key, value }) => setBagValue(filled, key, value));
        const written = await casUpdate(deps, caseFormId, after.doc.updatedAt, { $set: { filledData: filled } });
        if (!written) { await markReconciliation(deps, caseFormId, snapshotId, "a person edited this case form while the migration was restoring autofill-blanked values"); return { outcome: "reconciliation_required", changes: [] }; }
        result.valuesRestoredAfterAutofill = (result.valuesRestoredAfterAutofill || 0) + restore.length;
      }
      await captureIntermediate(deps, caseFormId, snapshotId);
      await setState(deps, caseFormId, { step: "autofilled" });
      await deps.checkpoint?.("autofilled"); // test seam: a simulated crash (throw) or a person's edit at exactly this step
    }
    // read back from the database and verify against the pre-image
    const loaded = await loadImage(CaseForm, caseFormId);
    const fresh = await Snapshot.findById(snapshotId).lean();
    const archiveEntry = (loaded.doc.editionMigrations || []).slice().reverse().find((entry) => entry && entry.migrationJobId === snapshot.migrationJobId);
    const problems = verifyAgainstPlan({ preImage: snapshot.preImage, dispositions: snapshot.dispositions, current: loaded.image, archiveEntry, newTemplateId: newTemplate?._id || snapshot.toTemplateId });
    if (problems.length) {
      failed("verify", `${problems.length} problem(s), first: ${JSON.stringify(problems[0]).slice(0, 240)}`);
      // safe recovery: restore only if nothing but the migration changed this case form since it left it; a newer edit is never overwritten
      const restored = await restoreCaseFormFromPreImage(snapshotId, { dryRun: false, actor, deps, reason: "verification failed after the edition migration" });
      if (restored.restored || restored.alreadyRestored) return { outcome: "restored", problems };
      return { outcome: "reconciliation_required", problems, changes: restored.changes || [] };
    }
    await setState(deps, caseFormId, { step: "verified" });
    await setState(deps, caseFormId, { step: "completed", outcome: "migrated", error: null });
    await setSnapshotExpiry(deps, snapshotId);
    return { outcome: "migrated", verified: true, expectedChecksum: fresh?.intermediateChecksum };
  } catch (error) {
    failed("migrate", error.message);
    return { outcome: "failed", error: error.message };
  }
}

// ── the sweeper ──────────────────────────────────────────────────────────────
/**
 * Finds case forms whose migration stopped half-way (a crash after the new edition was saved but before autofill or verification is otherwise never found again:
 * the normal selection only looks at case forms still on an OLD template) and resumes each from its recorded step. Idempotent; one case form never stops the batch.
 * Resolves { examined, resumed[], released[], reconciliationRequired[], failed[] }.
 */
async function reconcileIncompleteMigrations({ limit = 50, deps = {}, actor, req } = {}) {
  const { CaseForm, Snapshot } = stores(deps);
  const out = { examined: 0, resumed: [], released: [], reconciliationRequired: [], failed: [] };
  const stuck = await CaseForm.find({ "migrationState.step": { $in: IN_PROGRESS_STEPS } }).limit(limit).lean();
  for (const caseForm of stuck) {
    out.examined += 1;
    const state = caseForm.migrationState || {};
    try {
      const snapshot = state.snapshotId ? await Snapshot.findById(state.snapshotId).lean() : null;
      if (!snapshot) { out.failed.push({ caseFormId: String(caseForm._id), error: "snapshot missing" }); continue; }
      const NewTemplate = deps.Template || require("../../../models/USCISFormTemplate");
      const newTemplate = await NewTemplate.findById(snapshot.toTemplateId).lean();
      if (state.step === "snapshotted") {
        const current = imageChecksum(imageOf(caseForm));
        if (current === snapshot.checksum) {
          // nothing was written: the pre-image equals the case form. Release the snapshot; the next promotion (or an explicit run) migrates it from scratch.
          await Snapshot.updateOne({ _id: snapshot._id }, { $set: { state: "released" } });
          await CaseForm.collection.updateOne({ _id: caseForm._id }, { $unset: { migrationState: "" } });
          out.released.push(String(caseForm._id));
          continue;
        }
        // the new edition was written but the step was not recorded: continue as "saved" (the verification decides)
        await setState(deps, caseForm._id, { step: "saved" });
        state.step = "saved";
      }
      const outcome = await continueAfterSave({ caseFormId: caseForm._id, snapshotId: snapshot._id, newTemplate, actor, req, deps, from: state.step === "verified" ? "verified" : state.step === "autofilled" ? "autofilled" : "saved" });
      if (outcome.outcome === "reconciliation_required") out.reconciliationRequired.push({ caseFormId: String(caseForm._id), changes: outcome.changes || [] });
      else if (outcome.outcome === "failed") out.failed.push({ caseFormId: String(caseForm._id), error: outcome.error });
      else out.resumed.push({ caseFormId: String(caseForm._id), outcome: outcome.outcome });
    } catch (error) {
      out.failed.push({ caseFormId: String(caseForm._id), error: error.message });
      logger.warn("case_form_migration_reconcile_failed", { caseFormId: String(caseForm._id), error: error.message });
    }
  }
  return out;
}

module.exports = {
  ANSWER_KEYS, POINTER_KEYS, VALUE_BAGS, META_MAPS, IN_PROGRESS_STEPS,
  canonical, sha256, sameValue, clonePlain, toPlain, leaves, bagValue, setBagValue, isMissing, encodeKey, decodeKey,
  imageOf, imageChecksum, diffImages, classifyRecord, planCarry, verifyAgainstPlan, valuesToRestore, needsProof,
  stores, loadImage, setState, casUpdate, createSnapshot, captureIntermediate, setSnapshotExpiry, clearSnapshotExpiry, markReconciliation,
  restoreUpdate, restoreCaseFormFromPreImage, continueAfterSave, reconcileIncompleteMigrations,
};
