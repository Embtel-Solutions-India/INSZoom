const FieldDiffService = require("./FieldDiffService");
const MigrationSuggestionService = require("./MigrationSuggestionService");

class FormComparisonService {
  static compare(previousTemplate = {}, newTemplate = {}) {
    const diff = FieldDiffService.diff(previousTemplate.formFields || [], newTemplate.formFields || []);
    const suggestions = MigrationSuggestionService.suggest(previousTemplate, newTemplate);
    const editionChanged = String(previousTemplate.editionDate || "") !== String(newTemplate.editionDate || "");
    const severityScore = Math.min(10, diff.summary.removed * 3 + diff.summary.modified * 2 + diff.summary.added + diff.summary.renamed);
    const severity = severityScore >= 8 ? "critical" : severityScore >= 5 ? "high" : severityScore >= 2 ? "medium" : severityScore >= 1 ? "low" : "none";
    return {
      previousTemplateId: previousTemplate._id,
      newTemplateId: newTemplate._id,
      formCode: newTemplate.formCode || previousTemplate.formCode,
      editionDate: {
        previous: previousTemplate.editionDate,
        current: newTemplate.editionDate,
        changed: editionChanged,
      },
      fieldDiff: diff,
      migrationSuggestions: suggestions,
      severity: { score: severityScore, level: severity },
      generatedAt: new Date(),
    };
  }
}

module.exports = FormComparisonService;
