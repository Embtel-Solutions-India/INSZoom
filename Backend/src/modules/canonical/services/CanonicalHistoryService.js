class CanonicalHistoryService {
  static entry({ version, action, changes, conflicts, validation, user, source, reason, snapshot }) {
    return {
      version,
      action,
      changes,
      conflicts,
      validation,
      changedBy: user?._id || user?.id || user,
      changedAt: new Date(),
      source,
      reason,
      snapshot,
    };
  }

  static push(caseRecord, entry, limit = 50) {
    caseRecord.canonicalHistory = [...(caseRecord.canonicalHistory || []), entry].slice(-limit);
  }
}

module.exports = CanonicalHistoryService;
