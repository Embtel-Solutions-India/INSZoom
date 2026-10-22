// Persistence of suggestions (collection FormAiMappingSuggestion). Rows are immutable: written once with $setOnInsert and read back as the cache; the only later change is the
// "applied" stamp when mode "on" wrote one into a mapping version. Injectable in tests; the default is the Mongoose-backed store.
const FIELDS = ["templateId", "formCode", "editionDate", "targetFieldId", "targetPdfField", "inputHash", "candidate", "reasonCode", "labelEvidence", "rawScore", "tier", "checks", "reasons", "risks", "corroboratedBy", "corroboration", "existingEdge", "registryVersion", "questionnaireSchemaVersion", "model", "promptVersion", "mode"];

const model = () => require("../../models/FormAiMappingSuggestion");
const plain = (suggestion) => Object.fromEntries(FIELDS.filter((key) => suggestion[key] !== undefined).map((key) => [key, suggestion[key]]));

const mongoStore = {
  /** Stored suggestions of this edition whose inputs are unchanged: Map("<targetFieldId>|<inputHash>" -> suggestion). */
  async findCached(templateId, hashes) {
    if (!hashes.length) return new Map();
    const rows = await model().find({ templateId, inputHash: { $in: hashes } }).lean();
    return new Map(rows.map((row) => [`${row.targetFieldId}|${row.inputHash}`, row]));
  },
  async saveMany(suggestions) {
    const rows = suggestions.filter((suggestion) => !suggestion.transient);
    if (!rows.length) return { saved: 0 };
    const result = await model().bulkWrite(rows.map((suggestion) => ({
      updateOne: { filter: { templateId: suggestion.templateId, targetFieldId: suggestion.targetFieldId, inputHash: suggestion.inputHash }, update: { $setOnInsert: { ...plain(suggestion), createdAt: new Date() } }, upsert: true },
    })), { ordered: false });
    return { saved: result.upsertedCount || 0 };
  },
  async markApplied(templateId, targetFieldIds, mappingVersion) {
    if (!targetFieldIds.length) return;
    await model().updateMany({ templateId, targetFieldId: { $in: targetFieldIds }, tier: "auto_use", appliedAt: { $exists: false } }, { $set: { appliedAt: new Date(), appliedMappingVersion: mappingVersion, mode: "on" } });
  },
  async counts() {
    return model().aggregate([{ $group: { _id: { formCode: "$formCode", tier: "$tier" }, count: { $sum: 1 }, applied: { $sum: { $cond: [{ $ifNull: ["$appliedAt", false] }, 1, 0] } } } }]);
  },
  async list({ formCode, tier, limit = 100 } = {}) {
    const filter = {};
    if (formCode) filter.formCode = String(formCode).toUpperCase();
    if (tier) filter.tier = tier;
    return model().find(filter).sort({ createdAt: -1 }).limit(Math.min(Number(limit) || 100, 500)).lean();
  },
};

module.exports = { mongoStore, FIELDS };
