// Phase 3E/3F of the Visa-Form-Checklist intelligence layer (see
// docs/forms/CHECKLIST_CANONICAL_TRACEABILITY_REPORT.md for Phase 1/2).
//
// Goal: given ONE CaseForm (a specific case's specific form instance), answer
// "is this form actually ready to file, and if not, exactly why" - reusing
// every existing service, never a second mapping/traceability/coverage
// engine:
//   - MappingGraphService / FormMappingService - the persisted mapping graph
//     (edges: sourcePath, targetFieldId, confidence, status) and the EXACT
//     resolution order the real autofill runtime uses to pick which mapping
//     VERSION produced a given CaseForm's data (loadMappingVersion: explicit
//     mappingVersionId > template.activeMappingVersionId > latest "active"
//     USCISMappingVersion for the template).
//   - ChecklistFieldTraceabilityService - checklist-question <-> canonical
//     <-> PDF-field traceability, confidence tiering (HIGH/MEDIUM/LOW,
//     unchanged cutoffs), matchType ("canonical"/"direct_binding").
//   - MappingResolver - the same dotted-path resolution/emptiness check
//     FormMappingService.calculateCompletion and AutoFillService already use
//     against CaseForm.filledData - never a second "is this field filled"
//     definition.
//   - visaFormMapping.service.resolveChecklistsForCase - which checklist(s)
//     the registry ACTUALLY assigns to this specific case (visaType,
//     triggerCondition, processingPath), so "no mapped collection source" is
//     never confused with "there IS a source, the client just hasn't
//     answered it yet".
//
// Deliberately NOT here: any new mapping/scoring algorithm, any write to
// CaseForm/mapping graph (this is diagnostics only), any OCR extraction
// logic (fieldValueProvenance.source === "ocr" is read, never produced,
// here).
const CaseForm = require("../../../models/CaseForm");
const Case = require("../../../models/Case");
const USCISFormTemplate = require("../../../models/USCISFormTemplate");
const USCISFormComponentDefinition = require("../../../models/USCISFormComponentDefinition");
const Answer = require("../../../models/Answer");
const MappingGraphService = require("./MappingGraphService");
const FormMappingService = require("./FormMappingService");
const MappingResolver = require("./MappingResolver");
const ChecklistFieldTraceabilityService = require("./ChecklistFieldTraceabilityService");
const visaFormMappingService = require("../../form-registry/visaFormMapping.service");

class FormReadinessService {
  static notFound(message) {
    return Object.assign(new Error(message), { status: 404 });
  }

  // Provenance can arrive either as a real Mongoose Map (a live document) or
  // as a plain object (a .lean() read - Mongoose Map fields are stored as
  // ordinary BSON subdocuments, so .lean() naturally yields a plain object).
  // Accepting both means this service works identically whichever way a
  // caller happened to load the CaseForm.
  static getProvenance(caseForm, fieldId) {
    const store = caseForm?.fieldValueProvenance;
    if (!store) return null;
    if (store instanceof Map) return store.get(fieldId) || null;
    return store[fieldId] || null;
  }

  static getFieldReview(caseForm, fieldId) {
    return (caseForm?.fieldReviews || {})[fieldId] || null;
  }

  static getSourceAttribution(caseForm, fieldId) {
    return (caseForm?.sourceAttribution || {})[fieldId] || null;
  }

  // A field's provenance/review is "confirmed" the exact same way
  // AutoFillService.isReviewedOrManual already treats a field as settled -
  // reused verbatim (not re-derived) so this service can never disagree
  // with the real autofill engine about what counts as reviewed.
  static isConfirmed(caseForm, fieldId) {
    const review = this.getFieldReview(caseForm, fieldId);
    if (["approved", "edited"].includes(review?.status)) return true;
    const attribution = this.getSourceAttribution(caseForm, fieldId);
    if (["manual_override", "approved", "attorney_verified", "case_manager_verified"].includes(attribution?.verificationStatus || attribution?.validationStatus)) return true;
    return false;
  }

  // Load the exact mapping graph that actually produced (or would produce)
  // this CaseForm's data - the same version-resolution FormMappingService
  // uses at runtime, preferring the CaseForm's OWN recorded mappingVersionId
  // (the version that generated ITS filledData) over the template's current
  // active version, which may have moved on since.
  static async loadGraphForCaseForm(caseForm, template) {
    const mappingVersionDoc = await FormMappingService.loadMappingVersion(template, caseForm.mappingVersionId);
    if (mappingVersionDoc?.graph) return { graph: mappingVersionDoc.graph, mappingVersionId: mappingVersionDoc._id, mappingVersionStatus: mappingVersionDoc.status };
    const graph = await MappingGraphService.loadCurrentGraph(template);
    return { graph, mappingVersionId: null, mappingVersionStatus: null };
  }

  // Every checklist key the registry actually resolves as applicable to THIS
  // case (visaType/triggerCondition/processingPath), narrowed to the ones
  // actually assigned against this CaseForm's own formCode - never a global
  // scan of every checklist in the system, and never a checklist that isn't
  // really assigned to this case (per resolveChecklistsForCase's own
  // AUTO/satisfied-CONDITIONAL/EXPLICIT_CM resolution).
  static async applicableChecklistKeys(caseForm, caseData) {
    if (!caseData) return ChecklistFieldTraceabilityService.checklistKeysForForm(caseForm.formCode);
    const resolved = await visaFormMappingService.resolveChecklistsForCase(caseData);
    const entries = [...resolved.auto, ...resolved.explicitCm].filter((entry) => entry.formNumber === caseForm.formCode);
    const keys = [...new Set(entries.map((entry) => entry.checklistKey))];
    // A case with no registry entry naming this exact formCode yet (e.g. a
    // form provisioned via the legacy assignmentRules path, outside the
    // VisaFormMapping registry) still deserves a real answer, not a false
    // "nothing could ever map here" - fall back to every checklist the
    // registry associates with the formCode in the abstract.
    return keys.length ? keys : ChecklistFieldTraceabilityService.checklistKeysForForm(caseForm.formCode);
  }

  // canonicalPath/directBindingPath -> every checklist question (across only
  // the checklists actually applicable to this case) that could supply it.
  // Never fabricated: only real Question/QuestionLibraryItem canonicalPath
  // links, or the literal raw.questionnaireAnswers.<key>.value binding
  // CanonicalBuilderService always populates for an answered question.
  static async buildQuestionsByPath(checklistKeys) {
    const byPath = new Map();
    for (const key of checklistKeys) {
      const { questionnaire, questions } = await ChecklistFieldTraceabilityService.canonicalPathsForQuestionnaire(key);
      if (!questionnaire) continue;
      questions.forEach((question) => {
        [question.canonicalPath, question.directBindingPath].filter(Boolean).forEach((path) => {
          if (!byPath.has(path)) byPath.set(path, []);
          byPath.get(path).push({
            questionnaireKey: questionnaire.key,
            questionnaireTitle: questionnaire.title,
            checklistRole: questionnaire.checklistRole,
            questionKey: question.questionKey,
            label: question.label,
            matchType: path === question.canonicalPath ? "canonical" : "direct_binding",
          });
        });
      });
    }
    return byPath;
  }

  // Restricts the template's fields to one component's own fieldIds when
  // this CaseForm is a component (e.g. I129_H) - mirrors AutoFillService's
  // own componentFieldIds lookup so a component's readiness is never
  // inflated/deflated by a sibling component's fields on the same shared
  // parent template.
  static async templateFieldsForCaseForm(caseForm, template) {
    const allFields = MappingGraphService.getTemplateFields(template);
    if (!caseForm.componentCode) return allFields;
    const componentDef = await USCISFormComponentDefinition.findOne({
      parentTemplateId: caseForm.formTemplateId,
      componentCode: caseForm.componentCode,
      status: "ACTIVE",
    }).select("fieldIds").lean();
    if (!componentDef?.fieldIds?.length) return allFields;
    const allowed = new Set(componentDef.fieldIds);
    return allFields.filter((field) => allowed.has(field.targetFieldId));
  }

  // The one place that decides "is this field, as it currently stands,
  // filled/confirmed or does it still need a human's attention" - a needs-
  // review OCR value that hasn't been confirmed is NEVER counted as filled,
  // per the governing spec.
  static classifyField(caseForm, field, edge) {
    const mapped = Boolean(edge);
    const rawValue = mapped ? MappingResolver.resolvePath(caseForm.filledData || {}, field.targetFieldId) : undefined;
    const hasValue = !MappingResolver.isEmpty(rawValue);
    const provenance = this.getProvenance(caseForm, field.targetFieldId);
    const review = this.getFieldReview(caseForm, field.targetFieldId);
    const confidenceTier = ChecklistFieldTraceabilityService.confidenceTier(edge);
    const lowConfidenceMapping = mapped && (edge.status === "needs_review" || confidenceTier === "LOW");
    const pendingOcrReview = Boolean(
      hasValue
      && (provenance?.source === "ocr" || ["needs_review", "manual_review", "pending_review"].includes(review?.status))
      && !this.isConfirmed(caseForm, field.targetFieldId)
    );

    let fieldStatus;
    if (!mapped) fieldStatus = "unmapped";
    else if (!hasValue) fieldStatus = "missing_value";
    else if (pendingOcrReview) fieldStatus = "needs_review";
    else if (lowConfidenceMapping) fieldStatus = "needs_review";
    else fieldStatus = "filled";

    return {
      targetFieldId: field.targetFieldId,
      label: field.label,
      section: field.section,
      required: field.required,
      mapped,
      sourcePath: edge?.sourcePath || null,
      confidence: edge?.confidence ?? null,
      confidenceTier,
      mappingStatus: edge?.status || null,
      hasValue,
      provenanceSource: provenance?.source || null,
      pendingOcrReview,
      lowConfidenceMapping: Boolean(lowConfidenceMapping),
      fieldStatus,
    };
  }

  static provenanceBreakdown(fields) {
    const bySource = { canonical: 0, case_manager_override: 0, ocr: 0, questionnaire: 0, unknown: 0 };
    let needsReviewCount = 0;
    fields.forEach((field) => {
      if (!field.hasValue) return;
      const key = Object.prototype.hasOwnProperty.call(bySource, field.provenanceSource || "") ? field.provenanceSource : "unknown";
      bySource[key] += 1;
      if (field.fieldStatus === "needs_review") needsReviewCount += 1;
    });
    return { bySource, needsReviewCount };
  }

  // Never from percentage alone (per the governing spec) - purely a
  // hierarchy of real field states, worst-first: any REQUIRED field with no
  // mapping edge at all is a structural blocker (no amount of client/CM data
  // entry can fix it without new mapping work); then a required field that
  // IS mapped but has no value; then a required field whose value exists but
  // is either a low-confidence/unverified mapping or an unconfirmed
  // needs-review value (OCR or otherwise); only once none of those apply is
  // the form actually READY.
  static computeStatus(fields) {
    const required = fields.filter((field) => field.required);
    if (required.some((field) => !field.mapped)) return "BLOCKED";
    if (required.some((field) => field.mapped && !field.hasValue)) return "NOT_READY";
    if (required.some((field) => field.fieldStatus === "needs_review")) return "NEEDS_REVIEW";
    return "READY";
  }

  static async loadCaseFormAndTemplate(caseFormId) {
    const caseForm = await CaseForm.findById(caseFormId).lean();
    if (!caseForm) throw this.notFound("CaseForm not found");
    const template = await USCISFormTemplate.findById(caseForm.formTemplateId).select("-definition").lean();
    if (!template) throw this.notFound("USCIS form template not found for this CaseForm");
    return { caseForm, template };
  }

  // The primary diagnostic: for one CaseForm, exactly which fields are
  // mapped/filled/missing/needing review, and the readiness STATUS that
  // follows from that real field state.
  static async computeReadiness(caseFormId) {
    const { caseForm, template } = await this.loadCaseFormAndTemplate(caseFormId);
    const caseData = await Case.findById(caseForm.caseId)
      .select("visaType processingPath assignedAttorney attorney plan premiumProcessing questionnaireData assessmentAnswers conditionalFormDecisions jointSponsorUser")
      .lean();

    const { graph, mappingVersionId, mappingVersionStatus } = await this.loadGraphForCaseForm(caseForm, template);
    const edgesByTarget = new Map((graph.edges || []).map((edge) => [edge.targetFieldId, edge]));
    const templateFields = await this.templateFieldsForCaseForm(caseForm, template);

    const fields = templateFields.map((field) => this.classifyField(caseForm, field, edgesByTarget.get(field.targetFieldId)));

    const totalRelevantFields = fields.length;
    const mappedFields = fields.filter((field) => field.mapped).length;
    const unmappedFields = totalRelevantFields - mappedFields;
    const fieldsWithValues = fields.filter((field) => field.hasValue).length;
    const missingValues = totalRelevantFields - fieldsWithValues;
    const needsReviewFields = fields.filter((field) => field.fieldStatus === "needs_review").length;

    const requiredFields = fields.filter((field) => field.required);
    const requiredUnmapped = requiredFields.filter((field) => !field.mapped);
    const requiredMissingValues = requiredFields.filter((field) => field.mapped && !field.hasValue);
    const requiredNeedsReview = requiredFields.filter((field) => field.fieldStatus === "needs_review");

    const status = this.computeStatus(fields);

    return {
      caseFormId: String(caseForm._id),
      caseId: String(caseForm.caseId),
      formCode: caseForm.formCode,
      formTemplateId: String(template._id),
      componentCode: caseForm.componentCode || null,
      mappingVersionId: mappingVersionId ? String(mappingVersionId) : null,
      mappingVersionStatus,
      status,
      summary: {
        totalRelevantFields,
        mappedFields,
        unmappedFields,
        fieldsWithValues,
        missingValues,
        needsReviewFields,
        requiredFields: requiredFields.length,
        requiredUnmapped: requiredUnmapped.length,
        requiredMissingValues: requiredMissingValues.length,
        requiredNeedsReview: requiredNeedsReview.length,
      },
      provenance: this.provenanceBreakdown(fields),
      // Full per-field breakdown, always returned - a governance UI needs
      // the individual rows (per spec Rule 16), not only the rolled-up
      // summary; missingRequiredFieldIds/needsReviewFieldIds are provided as
      // a convenience index into it for "which required fields need a
      // traceMissingField(...) call next".
      fields,
      missingRequiredFieldIds: requiredMissingValues.map((field) => field.targetFieldId),
      unmappedRequiredFieldIds: requiredUnmapped.map((field) => field.targetFieldId),
      needsReviewFieldIds: requiredNeedsReview.map((field) => field.targetFieldId),
    };
  }

  // For one specific (typically missing) field on a CaseForm: trace it back
  // - PDF field -> canonical field (sourcePath) -> checklist
  // mapping (which checklist/question, if any) -> participant/role. Never
  // fabricates a question to fill the gap: absence of a match is reported
  // as "No mapped collection source", exactly as instructed.
  static async traceMissingField(caseFormId, targetFieldId) {
    const { caseForm, template } = await this.loadCaseFormAndTemplate(caseFormId);
    const templateFields = await this.templateFieldsForCaseForm(caseForm, template);
    const field = templateFields.find((item) => item.targetFieldId === targetFieldId);
    if (!field) throw this.notFound(`Field "${targetFieldId}" not found on this CaseForm's template (or not part of its component)`);

    const { graph } = await this.loadGraphForCaseForm(caseForm, template);
    const edge = (graph.edges || []).find((item) => item.targetFieldId === targetFieldId);
    const rawValue = edge ? MappingResolver.resolvePath(caseForm.filledData || {}, targetFieldId) : undefined;
    const hasValue = !MappingResolver.isEmpty(rawValue);

    const base = {
      targetFieldId,
      label: field.label,
      section: field.section,
      required: field.required,
      mapped: Boolean(edge),
      hasValue,
    };

    if (!edge) {
      return {
        ...base,
        reason: "UNMAPPED_PDF_FIELD",
        message: "No mapping graph edge exists for this PDF field at all - it cannot be autofilled from any canonical/checklist source until a mapping is authored (see MappingGraphService.upsertMapping).",
        sourcePath: null,
        checklistMatches: [],
      };
    }

    const caseData = await Case.findById(caseForm.caseId)
      .select("visaType processingPath assignedAttorney attorney plan premiumProcessing questionnaireData assessmentAnswers conditionalFormDecisions jointSponsorUser")
      .lean();
    const checklistKeys = await this.applicableChecklistKeys(caseForm, caseData);
    const questionsByPath = await this.buildQuestionsByPath(checklistKeys);
    const matches = questionsByPath.get(edge.sourcePath) || [];

    if (!matches.length) {
      return {
        ...base,
        sourcePath: edge.sourcePath,
        confidence: edge.confidence,
        confidenceTier: ChecklistFieldTraceabilityService.confidenceTier(edge),
        reason: "NO_MAPPED_COLLECTION_SOURCE",
        message: `Canonical path "${edge.sourcePath}" is not fed by any checklist question in the checklist(s) actually applicable to this case (${checklistKeys.join(", ") || "none assigned"}). If a value is ever present here it came from another source (profile data collected outside a checklist, OCR, or manual entry) - no checklist gap was fabricated to explain it.`,
        checklistMatches: [],
      };
    }

    // Distinguish "a real question exists but the client hasn't answered it
    // yet" from "it was answered but the answer never reached this field" -
    // the latter is a real bug (the Phase 2 report's I-130 case), never
    // silently reported the same way as an ordinary pending answer.
    const questionKeys = matches.map((match) => match.questionKey);
    const answers = await Answer.find({ caseId: caseForm.caseId, questionKey: { $in: questionKeys } }).select("questionKey value status").lean();
    const answeredKeys = new Set(answers.filter((answer) => !MappingResolver.isEmpty(answer.value)).map((answer) => answer.questionKey));

    let reason;
    let message;
    if (hasValue) {
      reason = "VALUE_PRESENT";
      message = "A value is already present for this field - this trace is informational, not a gap.";
    } else if (answeredKeys.size) {
      reason = "ANSWERED_BUT_NOT_REACHING_FIELD";
      message = "At least one matching checklist question HAS been answered for this case, but the value is not present in this CaseForm's filledData - a real autofill/mapping bug, not a missing answer (see Phase 2's I-130 precedent).";
    } else {
      reason = "AWAITING_CHECKLIST_ANSWER";
      message = "A checklist question maps to this field, but it has not been answered yet for this case.";
    }

    return {
      ...base,
      sourcePath: edge.sourcePath,
      confidence: edge.confidence,
      confidenceTier: ChecklistFieldTraceabilityService.confidenceTier(edge),
      reason,
      message,
      checklistMatches: matches,
      participantRoles: [...new Set(matches.map((match) => match.checklistRole).filter(Boolean))],
      answeredQuestionKeys: [...answeredKeys],
    };
  }
}

module.exports = FormReadinessService;
