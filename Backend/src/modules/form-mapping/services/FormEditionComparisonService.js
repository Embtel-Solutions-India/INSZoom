// Phase 3J — USCIS form edition-change governance.
//
// Goal (per the governing spec): when a new PDF edition of a form is
// imported, detect what changed on the FORM ITSELF versus the previous
// edition, cross-reference that against the previous edition's live
// MAPPING GRAPH (and its checklist traceability), and gate the new
// edition's mapping activation behind an explicit human acknowledgement
// when the change could have broken something a real mapping/checklist
// depended on.
//
// Deliberately reuses, never duplicates:
//   - FieldDiffService (uscis-lifecycle) - the EXISTING raw
//     template.formFields[] differ (added/removed/renamed/modified),
//     already computed and stored on a new edition's own
//     template.lifecycle.comparisonReport by FormVersionService.createTemplate
//     (see uscis-form-import/services/FormVersionService.js). This service
//     does not re-implement that diff; it calls FieldDiffService.diff
//     directly, exactly like FormComparisonService does.
//   - MappingGraphService.loadCurrentGraph - the EXISTING persisted mapping
//     graph reader (active version if present, else latest draft) - never a
//     second graph-loading path.
//   - ChecklistFieldTraceabilityService.traceAllFieldsForTemplate - the
//     EXISTING checklist<->field traceability, to find which checklist
//     questions were riding on a mapping edge this edition just broke.
//   - MappingGraphService.activate()'s existing "every field must have an
//     approved mapping" gate is untouched; this module only adds a further,
//     independent block on top of it (see MappingGraphService.activate).
//
// What FieldDiffService.diff does NOT already cover: a required/optional
// flip expressed only via formFields[].required (FieldDiffService.
// normalizeField only compares the nested `validation`/`validationRules`
// object, not the top-level `required` boolean USCISFormTemplate's own
// pre-validate hook derives it from) - requiredChanges() below is the one
// genuinely new small diff this phase adds, scoped to exactly that gap.
const USCISFormTemplate = require("../../../models/USCISFormTemplate");
const FieldDiffService = require("../../uscis-lifecycle/services/FieldDiffService");

function fieldTargetId(field = {}) {
  return field.fieldId || field.id || field.fieldName;
}

function isFieldRequired(field = {}) {
  return Boolean(field.required || field.validation?.required || field.validationRules?.required);
}

class FormEditionComparisonService {
  // The one gap left by FieldDiffService.diff: a required<->optional flip
  // that isn't also reflected in the nested validation/validationRules
  // object (FieldDiffService.normalizeField never looks at the top-level
  // `required` boolean at all). Fields that were added/removed are already
  // reported by FieldDiffService.diff and are skipped here to avoid
  // double-reporting the same field under two different change types.
  static requiredChanges(oldFields = [], newFields = []) {
    const oldById = new Map(oldFields.map((field) => [fieldTargetId(field), field]).filter(([id]) => id));
    const changes = [];
    newFields.forEach((newField) => {
      const id = fieldTargetId(newField);
      if (!id) return;
      const oldField = oldById.get(id);
      if (!oldField) return;
      const oldRequired = isFieldRequired(oldField);
      const newRequired = isFieldRequired(newField);
      if (oldRequired !== newRequired) changes.push({ fieldId: id, oldRequired, newRequired });
    });
    return changes;
  }

  // Every mapping-graph edge (from the OLD template's currently-persisted
  // graph) whose targetFieldId is caught up in a breaking field-level
  // change on the NEW edition: removed outright, renamed to a different
  // fieldId (FieldDiffService's own rename-detection heuristic), an
  // incompatible type change, or a required/optional flip. This is the
  // piece nothing existing computed before this phase - FieldDiffService
  // only ever compared two formFields[] arrays to each other, never a
  // mapping graph's edges against either side of that diff.
  static findAffectedMappingEdges(fieldDiff, requiredChanges, oldGraph = {}) {
    const removedIds = new Set((fieldDiff.removed || []).map((field) => field.id));
    const renamedByOldId = new Map((fieldDiff.renamed || []).map((entry) => [entry.oldField.id, entry.newField]));
    const typeChangedIds = new Map(
      (fieldDiff.modified || [])
        .filter((entry) => entry.changes?.type)
        .map((entry) => [entry.fieldId, entry.changes.type])
    );
    const requiredChangedById = new Map(requiredChanges.map((entry) => [entry.fieldId, entry]));

    return (oldGraph.edges || [])
      .filter((edge) => removedIds.has(edge.targetFieldId) || renamedByOldId.has(edge.targetFieldId) || typeChangedIds.has(edge.targetFieldId) || requiredChangedById.has(edge.targetFieldId))
      .map((edge) => {
        const reasons = [];
        if (removedIds.has(edge.targetFieldId)) reasons.push("field_removed");
        if (renamedByOldId.has(edge.targetFieldId)) reasons.push("field_renamed");
        if (typeChangedIds.has(edge.targetFieldId)) reasons.push("field_type_changed");
        if (requiredChangedById.has(edge.targetFieldId)) reasons.push("field_required_changed");
        return {
          mappingId: edge.mappingId,
          targetFieldId: edge.targetFieldId,
          targetPdfField: edge.targetPdfField,
          sourcePath: edge.sourcePath,
          confidence: edge.confidence,
          status: edge.status,
          reasons,
          renamedTo: renamedByOldId.get(edge.targetFieldId) || null,
          typeChange: typeChangedIds.get(edge.targetFieldId) || null,
          requiredChange: requiredChangedById.get(edge.targetFieldId) || null,
        };
      });
  }

  // Which of the OLD template's checklist-traced fields (per
  // ChecklistFieldTraceabilityService.traceAllFieldsForTemplate - the real,
  // already-persisted checklist<->field links, never re-derived here) sit
  // on one of the now-affected mapping edges above. This is the "broken
  // checklist relationship" the edition change causes: a real checklist
  // question whose answer used to reach a PDF field that this edition just
  // removed/renamed/retyped.
  static async findBrokenChecklistTraces(oldTemplateId, affectedTargetFieldIds) {
    if (!affectedTargetFieldIds.size) return [];
    // Lazy require: ChecklistFieldTraceabilityService requires
    // MappingGraphService, which (as of this phase) requires this file back
    // for the activation gate. Requiring here, at call time rather than at
    // module load, sidesteps that circular require instead of restructuring
    // either module's existing shape.
    const ChecklistFieldTraceabilityService = require("./ChecklistFieldTraceabilityService");
    const traceability = await ChecklistFieldTraceabilityService.traceAllFieldsForTemplate(oldTemplateId).catch(() => ({ fields: [] }));
    return (traceability.fields || [])
      .filter((field) => affectedTargetFieldIds.has(field.targetFieldId) && (field.checklistMatches || []).length > 0)
      .map((field) => ({
        targetFieldId: field.targetFieldId,
        sourcePath: field.sourcePath,
        checklistMatches: field.checklistMatches,
      }));
  }

  // The main entry point: compareEditions(oldTemplateId, newTemplateId) ->
  // added/removed/renamed/typeChanged fields (FieldDiffService, reused
  // as-is) plus requiredChanges (the one real gap), plus the mapping edges
  // and checklist traces this edition change puts at risk.
  static async compareEditions(oldTemplateId, newTemplateId) {
    const MappingGraphService = require("./MappingGraphService");
    const [oldTemplate, newTemplate] = await Promise.all([
      USCISFormTemplate.findById(oldTemplateId).lean(),
      USCISFormTemplate.findById(newTemplateId).lean(),
    ]);
    if (!oldTemplate || !newTemplate) {
      const error = new Error("Both the previous and new USCIS form template editions are required for comparison");
      error.status = 404;
      throw error;
    }

    const fieldDiff = FieldDiffService.diff(oldTemplate.formFields || [], newTemplate.formFields || []);
    const requiredChanges = this.requiredChanges(oldTemplate.formFields || [], newTemplate.formFields || []);
    const oldGraph = await MappingGraphService.loadCurrentGraph(oldTemplate);
    const affectedMappingEdges = this.findAffectedMappingEdges(fieldDiff, requiredChanges, oldGraph);
    const affectedTargetFieldIds = new Set(affectedMappingEdges.map((edge) => edge.targetFieldId));
    const brokenChecklistTraces = await this.findBrokenChecklistTraces(oldTemplate._id, affectedTargetFieldIds);

    return {
      oldTemplate: { templateId: oldTemplate._id, formCode: oldTemplate.formCode, version: oldTemplate.version, editionDate: oldTemplate.editionDate },
      newTemplate: { templateId: newTemplate._id, formCode: newTemplate.formCode, version: newTemplate.version, editionDate: newTemplate.editionDate },
      fieldDiff,
      requiredChanges,
      affectedMappingEdges,
      brokenChecklistTraces,
      hasBreakingChanges: affectedMappingEdges.length > 0 || brokenChecklistTraces.length > 0,
      summary: {
        fieldsAdded: fieldDiff.summary.added,
        fieldsRemoved: fieldDiff.summary.removed,
        fieldsRenamed: fieldDiff.summary.renamed,
        fieldsModified: fieldDiff.summary.modified,
        requiredChanged: requiredChanges.length,
        affectedMappingEdges: affectedMappingEdges.length,
        brokenChecklistTraces: brokenChecklistTraces.length,
      },
      generatedAt: new Date(),
    };
  }

  // Resolves the previous edition automatically off template.parentVersion
  // (set by FormVersionService.createTemplate at import time) so a caller
  // that only has the NEW template's id - the activation gate, the preview
  // route - doesn't have to already know which document is "the previous
  // edition". Returns null (not an error) when there is no parent, meaning
  // there is nothing to compare against and no edition-change gate applies.
  static async compareToParent(templateId, options = {}) {
    const template = await USCISFormTemplate.findById(templateId).select("parentVersion formCode version").lean();
    if (!template) {
      const error = new Error("USCIS form template not found");
      error.status = 404;
      throw error;
    }
    const oldTemplateId = options.previousTemplateId || template.parentVersion;
    if (!oldTemplateId) return null;
    return this.compareEditions(oldTemplateId, templateId);
  }

  // Whether templateId (the CANDIDATE edition being considered for mapping
  // activation) has edition changes that are breaking AND have not yet been
  // explicitly acknowledged by a human reviewer for THIS specific previous
  // edition. Re-used by MappingGraphService.activate() as an additional
  // gate, and safe to call repeatedly (read-only, no side effects).
  static async hasUnreviewedEditionChanges(template, options = {}) {
    const comparison = await this.compareToParent(template._id, options);
    if (!comparison || !comparison.hasBreakingChanges) return { blocked: false, comparison };
    const acknowledgedAt = template.lifecycle?.editionReviewAcknowledgedAt;
    const acknowledgedFor = template.lifecycle?.editionReviewOldTemplateId;
    const acknowledged = Boolean(acknowledgedAt) && String(acknowledgedFor || "") === String(comparison.oldTemplate.templateId);
    return { blocked: !acknowledged, comparison };
  }

  // The explicit human-review step (per the governing spec: "gate
  // re-activation behind human review"). Records the acknowledgement on the
  // NEW template's lifecycle (additive schema fields on USCISFormTemplate -
  // see the model's `lifecycle` sub-schema) and audits it via
  // MappingGraphService's existing audit() helper, never a parallel audit
  // path. Does NOT itself activate anything - MappingGraphService.activate()
  // is still the only path to activation, and still re-runs its own
  // unmapped-field gate independently of this acknowledgement.
  static async acknowledge(templateId, user, req) {
    const MappingGraphService = require("./MappingGraphService");
    const template = await USCISFormTemplate.findById(templateId);
    if (!template) {
      const error = new Error("USCIS form template not found");
      error.status = 404;
      throw error;
    }
    if (!template.parentVersion) {
      const error = new Error("This template has no prior edition on record - there is nothing to acknowledge");
      error.status = 409;
      throw error;
    }
    const comparison = await this.compareEditions(template.parentVersion, template._id);
    template.lifecycle = {
      ...(template.lifecycle || {}),
      editionReviewAcknowledgedAt: new Date(),
      editionReviewAcknowledgedBy: MappingGraphService.userId(user),
      editionReviewOldTemplateId: template.parentVersion,
    };
    template.mappingAuditHistory = [
      ...(template.mappingAuditHistory || []),
      {
        action: "EDITION_CHANGES_ACKNOWLEDGED",
        performedAt: new Date(),
        previousTemplateId: template.parentVersion,
        affectedMappingEdgeCount: comparison.affectedMappingEdges.length,
        brokenChecklistTraceCount: comparison.brokenChecklistTraces.length,
      },
    ];
    await template.save();
    await MappingGraphService.audit("EDITION_CHANGES_ACKNOWLEDGED", template, user, req, {
      previousTemplateId: String(template.parentVersion),
      affectedMappingEdgeCount: comparison.affectedMappingEdges.length,
      brokenChecklistTraceCount: comparison.brokenChecklistTraces.length,
    });
    return { templateId: template._id, acknowledged: true, comparison };
  }
}

module.exports = FormEditionComparisonService;
