const CanonicalProfileService = require("../../canonical/services/CanonicalProfileService");
const Case = require("../../../models/Case");

class CanonicalDataService {
  static async build(caseId, user, req) {
    const [canonicalState, caseData] = await Promise.all([
      CanonicalProfileService.get(caseId, user, req, { rebuild: true, reason: "form_mapping" }),
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
