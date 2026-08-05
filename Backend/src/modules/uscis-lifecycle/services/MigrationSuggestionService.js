const FieldDiffService = require("./FieldDiffService");

class MigrationSuggestionService {
  static suggest(oldTemplate = {}, newTemplate = {}) {
    const oldFields = oldTemplate.formFields || [];
    const newFields = newTemplate.formFields || [];
    const suggestions = [];

    oldFields.forEach((oldField) => {
      const oldNormalized = FieldDiffService.normalizeField(oldField);
      let best = null;
      newFields.forEach((newField) => {
        const newNormalized = FieldDiffService.normalizeField(newField);
        const labelScore = FieldDiffService.similarity(oldNormalized.label || oldNormalized.id, newNormalized.label || newNormalized.id);
        const idScore = FieldDiffService.similarity(oldNormalized.id, newNormalized.id);
        const typeBonus = oldNormalized.type === newNormalized.type ? 0.15 : 0;
        const score = Math.min(1, Math.max(labelScore, idScore) + typeBonus);
        if (!best || score > best.score) best = { oldField: oldNormalized, newField: newNormalized, score };
      });
      if (best && best.score >= 0.65) {
        suggestions.push({
          oldField: best.oldField.id,
          newField: best.newField.id,
          confidence: Math.round(best.score * 100),
          status: "pending",
          rationale: best.oldField.type === best.newField.type ? "similar_name_and_type" : "similar_name_type_changed",
        });
      }
    });

    return suggestions.sort((left, right) => right.confidence - left.confidence);
  }
}

module.exports = MigrationSuggestionService;
