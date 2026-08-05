const crypto = require("crypto");
const MappingResolver = require("../../form-mapping/services/MappingResolver");
const CanonicalTransformationService = require("./CanonicalTransformationService");

const SOURCE_PRIORITY = {
  attorney_verified: 600,
  case_manager_verified: 500,
  ocr_verified: 450,
  ocr: 350,
  questionnaire: 300,
  client_questionnaire: 300,
  database: 200,
  existing_database: 200,
  default: 50,
};

const VERIFIED_STATUSES = new Set(["approved", "verified", "edited", "auto_accepted"]);

function stableId(parts) {
  return crypto.createHash("sha1").update(parts.map((part) => JSON.stringify(part ?? "")).join(":")).digest("hex");
}

class CanonicalMergeService {
  static priorityFor(candidate = {}) {
    if (candidate.verificationStatus === "attorney_verified" || candidate.verifiedRole === "attorney") return SOURCE_PRIORITY.attorney_verified;
    if (candidate.verificationStatus === "case_manager_verified" || candidate.verifiedRole === "case_manager") return SOURCE_PRIORITY.case_manager_verified;
    if (candidate.sourceType === "ocr" && VERIFIED_STATUSES.has(candidate.status)) return SOURCE_PRIORITY.ocr_verified;
    return SOURCE_PRIORITY[candidate.sourceType] || SOURCE_PRIORITY[candidate.source] || SOURCE_PRIORITY.default;
  }

  static valuesEqual(left, right) {
    return JSON.stringify(left) === JSON.stringify(right);
  }

  static normalizeCandidate(candidate = {}) {
    const value = CanonicalTransformationService.normalizeByPath(candidate.path, candidate.value);
    return {
      ...candidate,
      value,
      sourceType: candidate.sourceType || candidate.source || "database",
      confidence: Math.max(0, Math.min(100, Number(candidate.confidence ?? 75))),
      priority: candidate.priority ?? this.priorityFor(candidate),
      collectedAt: candidate.collectedAt || candidate.updatedAt || new Date(),
    };
  }

  static merge(candidates = []) {
    const profile = {};
    const fieldMetadata = {};
    const conflicts = [];
    const sources = [];
    const byPath = new Map();

    candidates
      .filter((candidate) => candidate?.path && !MappingResolver.isEmpty(candidate.value))
      .map((candidate) => this.normalizeCandidate(candidate))
      .forEach((candidate) => {
        sources.push({
          path: candidate.path,
          sourceType: candidate.sourceType,
          sourceId: candidate.sourceId,
          sourceField: candidate.sourceField,
          confidence: candidate.confidence,
          status: candidate.status,
          collectedAt: candidate.collectedAt,
        });
        if (!byPath.has(candidate.path)) byPath.set(candidate.path, []);
        byPath.get(candidate.path).push(candidate);
      });

    byPath.forEach((fieldCandidates, path) => {
      const sorted = [...fieldCandidates].sort((left, right) => {
        if (right.priority !== left.priority) return right.priority - left.priority;
        if ((right.confidence || 0) !== (left.confidence || 0)) return (right.confidence || 0) - (left.confidence || 0);
        return new Date(right.collectedAt).getTime() - new Date(left.collectedAt).getTime();
      });
      const winner = sorted[0];
      MappingResolver.setPath(profile, path, winner.value);
      fieldMetadata[path] = {
        value: winner.value,
        sourceType: winner.sourceType,
        source: winner.source,
        sourceId: winner.sourceId,
        sourceField: winner.sourceField,
        sourceDocumentId: winner.sourceDocumentId,
        confidence: winner.confidence,
        verifiedBy: winner.verifiedBy,
        verificationDate: winner.verificationDate,
        status: winner.status || "selected",
        priority: winner.priority,
        collectedAt: winner.collectedAt,
        candidates: sorted.map((candidate) => ({
          value: candidate.value,
          sourceType: candidate.sourceType,
          sourceId: candidate.sourceId,
          sourceField: candidate.sourceField,
          confidence: candidate.confidence,
          status: candidate.status,
          priority: candidate.priority,
        })),
      };

      const competing = sorted.filter((candidate) => !this.valuesEqual(candidate.value, winner.value));
      if (competing.length) {
        conflicts.push({
          conflictId: stableId([path, winner.value, competing.map((item) => item.value)]),
          path,
          status: "pending_review",
          selectedValue: winner.value,
          selectedSource: winner.sourceType,
          candidates: sorted.map((candidate) => ({
            value: candidate.value,
            sourceType: candidate.sourceType,
            sourceId: candidate.sourceId,
            sourceField: candidate.sourceField,
            confidence: candidate.confidence,
            status: candidate.status,
            priority: candidate.priority,
          })),
          detectedAt: new Date(),
        });
      }
    });

    return {
      profile: CanonicalTransformationService.transformProfile(profile),
      fieldMetadata,
      conflicts,
      sources,
    };
  }

  static resolveConflict(profileState = {}, payload = {}, user) {
    const conflictId = payload.conflictId;
    const conflicts = (profileState.conflicts || []).map((conflict) => {
      if (conflict.conflictId !== conflictId) return conflict;
      return {
        ...conflict,
        status: payload.status || "resolved",
        resolvedValue: payload.value,
        resolutionReason: payload.reason,
        resolvedBy: user?._id || user?.id || user,
        resolvedAt: new Date(),
      };
    });
    const conflict = conflicts.find((item) => item.conflictId === conflictId);
    if (!conflict) {
      const error = new Error("Canonical conflict not found");
      error.status = 404;
      throw error;
    }
    const profile = { ...(profileState.profile || {}) };
    const fieldMetadata = { ...(profileState.fieldMetadata || {}) };
    MappingResolver.setPath(profile, conflict.path, payload.value);
    fieldMetadata[conflict.path] = {
      ...(fieldMetadata[conflict.path] || {}),
      value: payload.value,
      status: "resolved",
      verifiedBy: user?._id || user?.id || user,
      verificationDate: new Date(),
      resolutionReason: payload.reason,
      sourceType: "manual_resolution",
      confidence: 100,
    };
    return { ...profileState, profile, fieldMetadata, conflicts };
  }
}

module.exports = CanonicalMergeService;
