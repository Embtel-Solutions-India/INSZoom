const CanonicalProfileService = require("../../canonical/services/CanonicalProfileService");
const Case = require("../../../models/Case");

class CanonicalDataService {
  // options.skipRebuild: read CanonicalProfileService's cached profile
  // (rebuild: false) instead of forcing the 8-query CanonicalBuilderService
  // rebuild. Used only by AutoFillService.generate() when called with
  // selectedFieldIds (a sibling-field fan-out from a single field save) -
  // that path already has a just-written canonical profile from the
  // preceding applyStaffEdit() call in the same request, so re-deriving it
  // from scratch is redundant work on the request's critical path. Every
  // other caller (workspace open, explicit Refresh, first-time auto-fill)
  // omits this option and keeps forcing a full rebuild, unchanged.
  static async build(caseId, user, req, options = {}) {
    const [canonicalState, caseData] = await Promise.all([
      CanonicalProfileService.get(caseId, user, req, { rebuild: !options.skipRebuild, reason: options.reason || "form_mapping" }),
      Case.findById(caseId).select("questionnaireData").lean(),
    ]);
    const masterData = caseData?.questionnaireData?.masterData || {};
    const profile = {
      ...masterData,
      ...(canonicalState.profile || {}),
      questionnaireMasterData: masterData,
    };
    return {
      ...profile,
      canonicalProfile: profile,
      fieldMetadata: canonicalState.fieldMetadata || {},
      sourceAttribution: canonicalState.fieldMetadata || {},
      sources: canonicalState.sources || [],
      conflicts: canonicalState.conflicts || [],
      validation: canonicalState.validation || {},
      metadata: {
        ...((canonicalState.profile || {}).metadata || {}),
        masterDataVersion: caseData?.questionnaireData?.questionnaireVersion,
        canonicalVersion: canonicalState.version,
        canonicalStatus: canonicalState.status,
        builtAt: canonicalState.lastBuiltAt,
      },
    };
  }
}

module.exports = CanonicalDataService;
