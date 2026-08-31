const crypto = require("crypto");
const { EventEmitter } = require("events");
const AuditLog = require("../../../models/AuditLog");
const Case = require("../../../models/Case");
const caseService = require("../../cases/case.service");
const MappingResolver = require("../../form-mapping/services/MappingResolver");
const CanonicalBuilderService = require("./CanonicalBuilderService");
const CanonicalComparisonService = require("./CanonicalComparisonService");
const CanonicalHistoryService = require("./CanonicalHistoryService");
const CanonicalMergeService = require("./CanonicalMergeService");
const CanonicalValidationService = require("./CanonicalValidationService");

// Ranked above CanonicalMergeService's own top tier (attorney_verified: 600)
// so a reader comparing priorities understands staff_override is meant to
// outrank everything merge.js itself ever selects - informational only here
// since applyStaffOverrides()/applyStaffEdit() below never call back into
// CanonicalMergeService.merge(); the actual precedence is enforced by always
// overwriting the rebuilt value at the end of applyStaffOverrides().
const STAFF_OVERRIDE_PRIORITY = 700;

// Phase 2 (§J.1, Option A - "staff always wins"): a staff correction applied
// via applyStaffEdit() must survive every future rebuild(), not just the one
// call it was made in. rebuild() always recomputes canonicalProfile.profile
// from scratch via CanonicalBuilderService.build() (raw DB/questionnaire/OCR
// candidates only - it has no notion of a staff override), so without this,
// the very next AutoFillService.generate() call (which every fan-out re-fill
// triggers via CanonicalDataService.build()'s unconditional {rebuild:true})
// would silently discard the edit. Staff overrides are recovered from
// canonicalHistory's "staff_edit_applied" entries (already-persisted, already
// Mixed-typed `changes`/`snapshot` fields - no Case schema change) and
// re-applied on top of the freshly-built profile, latest edit per path wins.
const canonicalProfileEvents = new EventEmitter();

function stableConflictId(parts) {
  return crypto.createHash("sha1").update(parts.map((part) => JSON.stringify(part ?? "")).join(":")).digest("hex");
}

class CanonicalProfileService {
  static events = canonicalProfileEvents;

  static #collectStaffOverrides(caseRecord) {
    const overridesByPath = new Map();
    (caseRecord.canonicalHistory || [])
      .filter((entry) => entry.action === "staff_edit_applied")
      .forEach((entry) => {
        (entry.changes?.edits || []).forEach((edit) => {
          if (edit?.path) overridesByPath.set(edit.path, edit);
        });
      });
    return overridesByPath;
  }

  // Re-applies durable staff overrides on top of a freshly-built profile.
  // Returns `built` untouched (same reference) when there are none, so a
  // case that has never had a staff edit applied is byte-for-byte unaffected
  // - this is what keeps phase0/phase1's golden PDFs from moving.
  static #applyStaffOverrides(built, caseRecord) {
    const overrides = this.#collectStaffOverrides(caseRecord);
    if (!overrides.size) return built;
    const profile = built.profile || {};
    const fieldMetadata = { ...(built.fieldMetadata || {}) };
    const conflicts = [...(built.conflicts || [])];
    overrides.forEach((edit, path) => {
      const rebuiltValue = MappingResolver.resolvePath(profile, path);
      if (rebuiltValue !== undefined && !CanonicalMergeService.valuesEqual(rebuiltValue, edit.value)) {
        // A later questionnaire/OCR/database update disagrees with the staff
        // correction. Per §J.1 Option A the staff value still wins - it is
        // NOT overwritten - but the disagreement is surfaced as a pending
        // conflict through the same conflicts[]/resolveConflict() flow the
        // CM already uses for merge-detected conflicts.
        conflicts.push({
          conflictId: stableConflictId([path, edit.value, rebuiltValue]),
          path,
          status: "pending_review",
          selectedValue: edit.value,
          selectedSource: "staff_override",
          candidates: [
            { value: edit.value, sourceType: "staff_override", confidence: 100, priority: STAFF_OVERRIDE_PRIORITY, status: "staff_locked" },
            { value: rebuiltValue, sourceType: fieldMetadata[path]?.sourceType || "database", confidence: fieldMetadata[path]?.confidence, priority: fieldMetadata[path]?.priority },
          ],
          detectedAt: new Date(),
        });
      }
      MappingResolver.setPath(profile, path, edit.value);
      fieldMetadata[path] = {
        ...(fieldMetadata[path] || {}),
        value: edit.value,
        sourceType: "staff_override",
        source: "staff_override",
        status: "staff_locked",
        confidence: 100,
        priority: STAFF_OVERRIDE_PRIORITY,
        verifiedBy: edit.overriddenBy,
        verificationDate: edit.appliedAt,
        resolutionReason: edit.reason,
      };
    });
    return { ...built, profile, fieldMetadata, conflicts };
  }
  static userId(user) {
    return user?._id || user?.id || user;
  }

  static async audit(action, caseId, user, req, changes = {}) {
    await AuditLog.create({
      userId: this.userId(user),
      userRole: user?.role,
      action,
      entityType: "CanonicalProfile",
      entityId: String(caseId),
      changes,
      ipAddress: req?.ip,
      userAgent: req?.headers?.["user-agent"],
      description: `${action} canonical profile`,
    }).catch(() => null);
  }

  static async get(caseId, user, req, options = {}) {
    const caseRecord = await Case.findById(caseId).lean();
    if (!caseRecord) throw Object.assign(new Error("Case not found"), { status: 404 });
    if (!caseService.canAccessCase(user, caseRecord)) throw Object.assign(new Error("Not authorized to access canonical profile"), { status: 403 });
    if (!caseRecord.canonicalProfile?.lastBuiltAt || options.rebuild) return this.rebuild(caseId, user, req, { reason: options.reason || "profile_requested" });
    return caseRecord.canonicalProfile;
  }

  static async rebuild(caseId, user, req, options = {}) {
    const caseRecord = await Case.findById(caseId);
    if (!caseRecord) throw Object.assign(new Error("Case not found"), { status: 404 });
    if (!caseService.canAccessCase(user, caseRecord)) throw Object.assign(new Error("Not authorized to rebuild canonical profile"), { status: 403 });
    const previous = caseRecord.canonicalProfile?.profile || {};
    const rawBuilt = await CanonicalBuilderService.build(caseId);
    const built = this.#applyStaffOverrides(rawBuilt, caseRecord);
    const validation = await CanonicalValidationService.validate(built);
    const version = (caseRecord.canonicalProfile?.version || 0) + 1;
    const changes = CanonicalComparisonService.compare(previous, built.profile);
    caseRecord.canonicalProfile = {
      profile: built.profile,
      fieldMetadata: built.fieldMetadata,
      sources: built.sources,
      conflicts: built.conflicts,
      validation,
      missingFields: validation.missingFields,
      version,
      status: validation.status,
      lastBuiltAt: new Date(),
      lastBuiltBy: this.userId(user),
      sourceFingerprint: built.sourceFingerprint,
    };
    CanonicalHistoryService.push(caseRecord, CanonicalHistoryService.entry({
      version,
      action: options.reason === "sync" ? "sync_completed" : "profile_rebuilt",
      changes,
      conflicts: built.conflicts,
      validation,
      user,
      source: options.source || "canonical_builder",
      reason: options.reason,
      snapshot: built.profile,
    }));
    await caseRecord.save();
    await this.audit(version === 1 ? "CANONICAL_PROFILE_CREATED" : "CANONICAL_PROFILE_UPDATED", caseId, user, req, { version, changes, validationStatus: validation.status });
    if (built.conflicts.length) await this.audit("CANONICAL_CONFLICT_DETECTED", caseId, user, req, { conflicts: built.conflicts });
    if (!validation.valid) await this.audit("CANONICAL_VALIDATION_FAILED", caseId, user, req, validation);
    return caseRecord.canonicalProfile;
  }

  static async resolveConflict(caseId, payload, user, req) {
    const caseRecord = await Case.findById(caseId);
    if (!caseRecord) throw Object.assign(new Error("Case not found"), { status: 404 });
    if (!caseService.canAccessCase(user, caseRecord)) throw Object.assign(new Error("Not authorized to resolve canonical profile conflicts"), { status: 403 });
    const previous = caseRecord.canonicalProfile?.profile || {};
    const nextState = CanonicalMergeService.resolveConflict(caseRecord.canonicalProfile || {}, payload, user);
    const validation = await CanonicalValidationService.validate(nextState);
    const version = (caseRecord.canonicalProfile?.version || 0) + 1;
    const changes = CanonicalComparisonService.compare(previous, nextState.profile || {});
    caseRecord.canonicalProfile = {
      ...nextState,
      validation,
      missingFields: validation.missingFields,
      version,
      status: validation.status,
      lastBuiltAt: caseRecord.canonicalProfile?.lastBuiltAt || new Date(),
      lastBuiltBy: caseRecord.canonicalProfile?.lastBuiltBy,
    };
    CanonicalHistoryService.push(caseRecord, CanonicalHistoryService.entry({
      version,
      action: "conflict_resolved",
      changes,
      conflicts: nextState.conflicts,
      validation,
      user,
      source: "manual_resolution",
      reason: payload.reason,
      snapshot: nextState.profile,
    }));
    await caseRecord.save();
    await this.audit("CANONICAL_CONFLICT_RESOLVED", caseId, user, req, { conflictId: payload.conflictId, path: payload.path, value: payload.value, reason: payload.reason });
    return caseRecord.canonicalProfile;
  }

  // edits: [{path, value, reason, sourceFormId?}]. Field-level, highest-
  // precedence write into Case.canonicalProfile - mirrors resolveConflict's
  // sequence (load -> authorize -> diff -> validate -> version -> history ->
  // audit) but writes a caller-supplied value instead of resolving an
  // existing merge conflict. See collectStaffOverrides/applyStaffOverrides
  // above for how this write is made durable across the next rebuild().
  static async applyStaffEdit(caseId, edits, actor, req) {
    if (!Array.isArray(edits) || !edits.length) throw Object.assign(new Error("At least one edit is required"), { status: 400 });
    const caseRecord = await Case.findById(caseId);
    if (!caseRecord) throw Object.assign(new Error("Case not found"), { status: 404 });
    if (!caseService.canAccessCase(actor, caseRecord)) throw Object.assign(new Error("Not authorized to edit canonical profile"), { status: 403 });

    const expectedVersion = caseRecord.canonicalProfile?.version || 0;
    const previous = caseRecord.canonicalProfile?.profile || {};
    // Both sides of the diff below are computed from a JSON-round-tripped
    // clone of `previous`, not the live Mongoose-read value itself. A real
    // profile (post-CanonicalBuilderService.build()) embeds ObjectId/Date
    // instances (case.id, metadata.caseId, ...); CanonicalComparisonService's
    // flatten() recurses into a live ObjectId as if it were a plain nested
    // object (it only special-cases Date) but treats its round-tripped hex-
    // string clone as an atomic leaf. Diffing the live `previous` against a
    // round-tripped `nextProfile` (as this used to) therefore fabricates a
    // pending diff at every ObjectId path on every call, defeating the no-op
    // short-circuit below the moment any real rebuild() has ever run for
    // this case. Diffing two round-tripped clones against each other keeps
    // both sides symmetric, independent of CanonicalComparisonService itself.
    const normalizedPrevious = JSON.parse(JSON.stringify(previous));
    const nextProfile = JSON.parse(JSON.stringify(previous));
    const fieldMetadata = { ...(caseRecord.canonicalProfile?.fieldMetadata || {}) };
    const now = new Date();
    const actorId = this.userId(actor);

    edits.forEach((edit) => {
      MappingResolver.setPath(nextProfile, edit.path, edit.value);
      fieldMetadata[edit.path] = {
        ...(fieldMetadata[edit.path] || {}),
        value: edit.value,
        sourceType: "staff_override",
        source: "staff_override",
        status: "staff_locked",
        confidence: 100,
        priority: STAFF_OVERRIDE_PRIORITY,
        verifiedBy: actorId,
        verificationDate: now,
        resolutionReason: edit.reason,
      };
    });

    const changes = CanonicalComparisonService.compare(normalizedPrevious, nextProfile);
    // Idempotency: an edit that doesn't actually change anything (e.g. the
    // same call retried, or a "correction" that matches the current value)
    // is a no-op - no version bump, no duplicate history entry.
    if (!changes.changedFieldCount) return caseRecord.canonicalProfile;

    const nextState = { profile: nextProfile, fieldMetadata, conflicts: caseRecord.canonicalProfile?.conflicts || [], sources: caseRecord.canonicalProfile?.sources || [] };
    const validation = await CanonicalValidationService.validate(nextState);
    const version = expectedVersion + 1;
    const historyEntry = CanonicalHistoryService.entry({
      version,
      action: "staff_edit_applied",
      changes,
      conflicts: nextState.conflicts,
      validation,
      user: actor,
      source: "staff_override",
      reason: edits[0]?.reason,
      snapshot: nextProfile,
    });
    // historyEntry.changes carries the CanonicalComparisonService diff, not
    // the raw edits themselves - collectStaffOverrides() needs the exact
    // {path, value} pairs to replay (a diff's oldValue/newValue keys don't
    // round-trip a full-object edit cleanly), so the raw edit list rides
    // alongside it under the same Mixed `changes` field.
    historyEntry.changes = { comparison: changes, edits: edits.map((edit) => ({ path: edit.path, value: edit.value, reason: edit.reason, sourceFormId: edit.sourceFormId, overriddenBy: actorId, appliedAt: now })) };

    // Optimistic concurrency: only succeeds if canonicalProfile.version still
    // matches what we loaded. Two concurrent callers loaded at the same
    // version race here; exactly one findOneAndUpdate matches and wins, the
    // other gets `updated === null` and must reload/retry.
    const updated = await Case.findOneAndUpdate(
      { _id: caseId, "canonicalProfile.version": expectedVersion },
      {
        $set: {
          "canonicalProfile.profile": nextProfile,
          "canonicalProfile.fieldMetadata": fieldMetadata,
          "canonicalProfile.validation": validation,
          "canonicalProfile.missingFields": validation.missingFields,
          "canonicalProfile.version": version,
          "canonicalProfile.status": validation.status,
        },
        $push: { canonicalHistory: { $each: [historyEntry], $slice: -50 } },
      },
      { new: true }
    );
    if (!updated) {
      throw Object.assign(new Error("Canonical profile was updated by another edit — reload and retry"), { code: "STALE_FORM_REVISION", status: 409 });
    }

    await this.audit("CANONICAL_STAFF_EDIT_APPLIED", caseId, actor, req, { version, changes, editCount: edits.length });
    canonicalProfileEvents.emit("staff-edit-applied", { caseId: String(caseId), canonicalVersion: version, changedPaths: edits.map((edit) => edit.path) });

    return updated.canonicalProfile;
  }

  static async validate(caseId, user, req, options = {}) {
    let caseRecord = await Case.findById(caseId);
    if (!caseRecord) throw Object.assign(new Error("Case not found"), { status: 404 });
    if (!caseService.canAccessCase(user, caseRecord)) throw Object.assign(new Error("Not authorized to validate canonical profile"), { status: 403 });
    await this.audit("CANONICAL_VALIDATION_STARTED", caseId, user, req, { options });
    let state = caseRecord.canonicalProfile;
    if (!caseRecord.canonicalProfile?.lastBuiltAt) {
      state = await this.rebuild(caseId, user, req, { reason: "validation_requested" });
      // rebuild() above loaded and saved its OWN Case document (bumping
      // __v). Continuing to mutate/save this method's now-stale caseRecord
      // would both throw a VersionError and silently overwrite the profile
      // rebuild() just persisted with this stale, pre-rebuild copy - refetch
      // once so the rest of this method (and its own save below) operates on
      // the actual current document. Only needed on this branch - the
      // already-built branch never touched the document.
      caseRecord = await Case.findById(caseId);
      state = caseRecord.canonicalProfile;
    }
    const validation = await CanonicalValidationService.validate(state, options);
    caseRecord.canonicalProfile = {
      ...(caseRecord.canonicalProfile || state),
      validation,
      missingFields: validation.missingFields,
      status: validation.status,
    };
    CanonicalHistoryService.push(caseRecord, CanonicalHistoryService.entry({
      version: caseRecord.canonicalProfile.version || 0,
      action: "validation_completed",
      changes: { validationStatus: validation.status, readinessScore: validation.readinessScore, completeness: validation.completeness },
      conflicts: validation.conflicts,
      validation,
      user,
      source: "canonical_validation_engine",
      reason: options.reason || "validation",
      snapshot: caseRecord.canonicalProfile.profile,
    }));
    await caseRecord.save();
    await this.audit("CANONICAL_VALIDATION_COMPLETED", caseId, user, req, {
      status: validation.status,
      completeness: validation.completeness,
      readinessScore: validation.readinessScore,
      errors: validation.errors.length,
      warnings: validation.warnings.length,
      conflicts: validation.conflictCount,
    });
    if (validation.conflictCount) await this.audit("CANONICAL_CONFLICTS_FOUND", caseId, user, req, { conflicts: validation.conflicts });
    if (validation.warnings.length) await this.audit("CANONICAL_WARNINGS_GENERATED", caseId, user, req, { warnings: validation.warnings });
    if (validation.errors.length) await this.audit("CANONICAL_ERRORS_GENERATED", caseId, user, req, { errors: validation.errors });
    return validation;
  }

  static async history(caseId, user) {
    const caseRecord = await Case.findById(caseId);
    if (!caseRecord) throw Object.assign(new Error("Case not found"), { status: 404 });
    if (!caseService.canAccessCase(user, caseRecord)) throw Object.assign(new Error("Not authorized to access canonical profile history"), { status: 403 });
    return caseRecord.canonicalHistory || [];
  }
}

module.exports = CanonicalProfileService;
