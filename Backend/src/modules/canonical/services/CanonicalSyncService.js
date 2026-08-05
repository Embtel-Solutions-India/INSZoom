const CanonicalProfileService = require("./CanonicalProfileService");
const Case = require("../../../models/Case");
const participantService = require("../../cases/case-participant.service");

class CanonicalSyncService {
  static async syncParticipant(caseId, participantId, profilePatch = {}, user, req, reason = "participant_sync") {
    if (!caseId || !participantId) return null;
    const caseRecord = await Case.findById(caseId);
    if (!caseRecord) return null;
    const participant = participantService.findParticipant(caseRecord, { participantId });
    if (!participant) return null;
    participant.canonicalProfile = {
      ...(participant.canonicalProfile?.toObject?.() || participant.canonicalProfile || {}),
      profile: {
        ...(participant.canonicalProfile?.profile || {}),
        ...(profilePatch.profile || profilePatch || {}),
      },
      fieldMetadata: {
        ...(participant.canonicalProfile?.fieldMetadata || {}),
        ...(profilePatch.fieldMetadata || {}),
      },
      lastBuiltAt: new Date(),
      lastBuiltBy: user?._id || user?.id,
      source: reason,
    };
    caseRecord.markModified("participants");
    await caseRecord.save();
    return participant.canonicalProfile;
  }

  static async syncCase(caseId, user, req, reason = "sync") {
    if (!caseId) return null;
    const canonicalState = await CanonicalProfileService.rebuild(caseId, user, req, { reason: "sync", source: reason });
    await require("../../cases/immigration-knowledge-engine.service")
      .refreshAfterCanonicalSync(caseId, canonicalState, user, req, reason)
      .catch(() => null);
    return canonicalState;
  }

  static async syncFromDocument(document, user, req) {
    const caseId = document?.caseId?._id || document?.caseId;
    if (document?.participantId) return this.syncParticipant(caseId, document.participantId, {}, user, req, "document_changed");
    return this.syncCase(caseId, user, req, "document_changed");
  }

  static async syncFromExtraction(extraction, user, req) {
    const caseId = extraction?.caseId?._id || extraction?.caseId;
    if (extraction?.participantId) return this.syncParticipant(caseId, extraction.participantId, {}, user, req, "ocr_extraction_changed");
    return this.syncCase(caseId, user, req, "ocr_extraction_changed");
  }
}

module.exports = CanonicalSyncService;
