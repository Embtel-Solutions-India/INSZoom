const AuditLog = require("../../../models/AuditLog");
const Case = require("../../../models/Case");
const caseService = require("../../cases/case.service");
const CanonicalBuilderService = require("./CanonicalBuilderService");
const CanonicalComparisonService = require("./CanonicalComparisonService");
const CanonicalHistoryService = require("./CanonicalHistoryService");
const CanonicalMergeService = require("./CanonicalMergeService");
const CanonicalValidationService = require("./CanonicalValidationService");

class CanonicalProfileService {
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
    const built = await CanonicalBuilderService.build(caseId);
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

  static async validate(caseId, user, req, options = {}) {
    const caseRecord = await Case.findById(caseId);
    if (!caseRecord) throw Object.assign(new Error("Case not found"), { status: 404 });
    if (!caseService.canAccessCase(user, caseRecord)) throw Object.assign(new Error("Not authorized to validate canonical profile"), { status: 403 });
    await this.audit("CANONICAL_VALIDATION_STARTED", caseId, user, req, { options });
    const state = caseRecord.canonicalProfile?.lastBuiltAt
      ? caseRecord.canonicalProfile
      : await this.rebuild(caseId, user, req, { reason: "validation_requested" });
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
