// Phase 1 of the Visa-Form-Checklist intelligence layer: bidirectional
// traceability between a checklist question and the USCIS PDF field(s)
// its answer feeds. Governance/query layer only - reuses every existing
// system rather than introducing a parallel one:
//   - Questionnaire/Question (the real checklist content)
//   - QuestionLibraryItem.canonicalPath (the EXISTING, review-gated
//     question -> canonical link MappingGraphService.exactMappingsForTemplate
//     already trusts - not re-derived here)
//   - MappingGraphService's persisted graph edges (the EXISTING canonical
//     -> PDF field mapping, with its own confidence score) - never a
//     second PDF-mapping engine
//   - VisaFormMapping.checklistMappings (which checklist(s) actually
//     apply to a given form - scopes every lookup below to the real
//     applicable checklist(s), never a global scan of every questionnaire
//     in the system, per the plan's §10)
//
// Deliberately NOT here (Phase 2/3, explicitly out of scope): OCR/document
// extraction, autofill coverage dashboards, missing-data prompts, edition
// comparison. This service only answers "which question feeds which
// field" and the reverse - Phase 2 is expected to consume it, not be
// built alongside it.
const QuestionLibraryItem = require("../../../models/QuestionLibraryItem");
const Question = require("../../../models/Question");
const Questionnaire = require("../../../models/Questionnaire");
const VisaFormMapping = require("../../../models/VisaFormMapping");
const USCISFormTemplate = require("../../../models/USCISFormTemplate");
const MappingGraphService = require("./MappingGraphService");

class ChecklistFieldTraceabilityService {
  // Confidence tiering directly off the EXISTING edge.confidence number
  // (MappingGraphService.buildEdge - an integer 0-100) and edge.status -
  // no new scoring algorithm, just named tiers for governance display.
  // 72 is MappingGraphService's own "active" cutoff, reused verbatim so
  // HIGH/MEDIUM here can never disagree with what the mapping editor
  // already calls "Mapped" vs "Needs review".
  static confidenceTier(edge) {
    if (!edge) return "UNMAPPED";
    if (edge.confidence >= 85) return "HIGH";
    if (edge.confidence >= 72) return "MEDIUM";
    return "LOW";
  }

  // Every checklistKey the registry actually associates with this real
  // formCode (VisaFormMapping.checklistMappings) - the scoping mechanism
  // behind every lookup below, so this never turns into "match every
  // questionnaire against every USCIS form" (§10).
  static async checklistKeysForForm(formCode) {
    const mappings = await VisaFormMapping.find({ active: true, formTemplateFormCode: String(formCode || "").toLowerCase() })
      .select("checklistMappings")
      .lean();
    const keys = new Set();
    mappings.forEach((mapping) => (mapping.checklistMappings || []).forEach((entry) => keys.add(entry.checklistKey)));
    return [...keys];
  }

  // Every question in ONE questionnaire that has a resolvable canonical
  // path - preferring the linked QuestionLibraryItem's canonicalPath (the
  // authoritative, review-gated source), falling back to the question's
  // own mapping.canonicalPath only when no library item is linked. A
  // question with neither still carries its `directBindingPath` - the
  // literal raw.questionnaireAnswers.<key>.value path CanonicalBuilderService
  // ALWAYS populates for every answered question, with zero mapping
  // required (see CanonicalBuilderService.js's `profile.raw.
  // questionnaireAnswers`). Some forms (e.g. I-129F) bind their PDF mapping
  // graph directly to that path instead of routing through a canonical
  // field - a legitimate, working, already-in-production binding style,
  // not a gap. This is not a guess: the literal string is deterministic
  // from the question's own key, and callers only treat it as "traced"
  // when it happens to equal a REAL edge.sourcePath on that specific
  // form's graph - never fabricated, never presented as canonical.
  static directBindingPath(questionKey) {
    return `raw.questionnaireAnswers.${questionKey}.value`;
  }

  static async canonicalPathsForQuestionnaire(questionnaireKey) {
    const questionnaire = await Questionnaire.findOne({ key: questionnaireKey, latestVersion: true })
      .select("_id key title checklistRole")
      .lean();
    if (!questionnaire) return { questionnaire: null, questions: [] };
    const questions = await Question.find({ questionnaire: questionnaire._id, active: { $ne: false } })
      .select("key label sectionKey libraryItem mapping")
      .lean();
    const libraryItemIds = questions.map((question) => question.libraryItem).filter(Boolean);
    const libraryItems = libraryItemIds.length
      ? await QuestionLibraryItem.find({ _id: { $in: libraryItemIds } }).select("canonicalPath review.status").lean()
      : [];
    const libraryItemById = new Map(libraryItems.map((item) => [String(item._id), item]));
    const resolved = questions.map((question) => {
      const libraryItem = question.libraryItem ? libraryItemById.get(String(question.libraryItem)) : null;
      const canonicalPath = libraryItem?.canonicalPath || question.mapping?.canonicalPath || null;
      return {
        questionKey: question.key,
        label: question.label,
        sectionKey: question.sectionKey,
        canonicalPath,
        canonicalPathSource: libraryItem?.canonicalPath ? "library_item" : question.mapping?.canonicalPath ? "question_mapping" : null,
        directBindingPath: this.directBindingPath(question.key),
      };
    });
    return { questionnaire, questions: resolved };
  }

  // A question's real matchable path(s) on a given graph: its canonical
  // path if one is set AND actually used by an edge on this form, else its
  // literal direct-answer binding if THAT is what an edge on this form
  // actually uses, else null (neither guessed nor assumed).
  static matchedSourcePath(question, edgesByPath) {
    if (question.canonicalPath && edgesByPath.has(question.canonicalPath)) return question.canonicalPath;
    if (question.directBindingPath && edgesByPath.has(question.directBindingPath)) return question.directBindingPath;
    return null;
  }

  // Direction A (plan §6): Checklist Question -> Canonical -> USCIS Form
  // Field(s), scoped to one template - "which fields on THIS form does
  // this checklist's data reach".
  static async traceQuestionsToFields(questionnaireKey, templateId) {
    const { questionnaire, questions } = await this.canonicalPathsForQuestionnaire(questionnaireKey);
    if (!questionnaire) return { questionnaire: null, results: [] };
    const { graph } = await MappingGraphService.preview(templateId);
    const edgesByPath = new Map();
    (graph.edges || []).forEach((edge) => {
      if (!edgesByPath.has(edge.sourcePath)) edgesByPath.set(edge.sourcePath, []);
      edgesByPath.get(edge.sourcePath).push(edge);
    });
    const results = questions
      .map((question) => {
        const matchedPath = this.matchedSourcePath(question, edgesByPath);
        return {
          ...question,
          matchedPath,
          matchType: matchedPath === question.canonicalPath ? "canonical" : matchedPath ? "direct_binding" : null,
          fields: (edgesByPath.get(matchedPath) || []).map((edge) => ({
            targetFieldId: edge.targetFieldId,
            targetLabel: edge.targetLabel,
            confidence: edge.confidence,
            tier: this.confidenceTier(edge),
          })),
        };
      })
      .filter((question) => question.matchedPath);
    return {
      questionnaire: { key: questionnaire.key, title: questionnaire.title, checklistRole: questionnaire.checklistRole },
      results,
    };
  }

  // Direction B (plan §6): USCIS Form Field -> Canonical -> Checklist
  // Question(s). Only considers checklists this form's OWN registry
  // associations name (checklistKeysForForm) - never a global reverse
  // scan across every questionnaire in the system.
  static async traceFieldToQuestions(templateId, targetFieldId) {
    const template = await USCISFormTemplate.findById(templateId).select("formCode").lean();
    if (!template) return { edge: null, tier: "UNMAPPED", matches: [] };
    const { graph } = await MappingGraphService.preview(templateId);
    const edge = (graph.edges || []).find((item) => item.targetFieldId === targetFieldId);
    if (!edge) return { edge: null, tier: "UNMAPPED", matches: [] };
    const checklistKeys = await this.checklistKeysForForm(template.formCode);
    const matches = [];
    for (const checklistKey of checklistKeys) {
      const { questionnaire, questions } = await this.canonicalPathsForQuestionnaire(checklistKey);
      if (!questionnaire) continue;
      questions
        .filter((question) => question.canonicalPath === edge.sourcePath || question.directBindingPath === edge.sourcePath)
        .forEach((question) => {
          matches.push({
            questionnaireKey: questionnaire.key,
            questionnaireTitle: questionnaire.title,
            checklistRole: questionnaire.checklistRole,
            questionKey: question.questionKey,
            label: question.label,
            sectionKey: question.sectionKey,
            matchType: question.canonicalPath === edge.sourcePath ? "canonical" : "direct_binding",
          });
        });
    }
    return { edge, tier: this.confidenceTier(edge), matches };
  }

  // Bulk per-template resolution for a governance table (plan §7): every
  // mapped field on this template, with whichever checklist question(s)
  // (across every checklist this form's registry associations name) share
  // its canonical path - one graph load + one per-checklist question load,
  // instead of a separate query per field/row.
  static async traceAllFieldsForTemplate(templateId) {
    const template = await USCISFormTemplate.findById(templateId).select("formCode").lean();
    if (!template) return { formCode: null, fields: [] };
    const { graph } = await MappingGraphService.preview(templateId);
    const checklistKeys = await this.checklistKeysForForm(template.formCode);
    const matchesByPath = new Map();
    for (const checklistKey of checklistKeys) {
      const { questionnaire, questions } = await this.canonicalPathsForQuestionnaire(checklistKey);
      if (!questionnaire) continue;
      questions.forEach((question) => {
        [question.canonicalPath, question.directBindingPath].filter(Boolean).forEach((path) => {
          if (!matchesByPath.has(path)) matchesByPath.set(path, []);
          matchesByPath.get(path).push({
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
    const fields = (graph.edges || []).map((edge) => ({
      targetFieldId: edge.targetFieldId,
      targetLabel: edge.targetLabel,
      sourcePath: edge.sourcePath,
      confidence: edge.confidence,
      tier: this.confidenceTier(edge),
      checklistMatches: matchesByPath.get(edge.sourcePath) || [],
    }));
    return { formCode: template.formCode, fields };
  }

  // Governance diagnostic (plan §14, scoped to this phase's boundary): for
  // one template, how many of its mapped fields can actually be traced
  // back to a real checklist question versus only resolving through the
  // generic canonical registry with no checklist behind it at all.
  static async coverageSummary(templateId) {
    const template = await USCISFormTemplate.findById(templateId).select("formCode").lean();
    if (!template) return null;
    const { graph } = await MappingGraphService.preview(templateId);
    const checklistKeys = await this.checklistKeysForForm(template.formCode);
    const canonicalPathsWithQuestion = new Set();
    for (const checklistKey of checklistKeys) {
      const { questions } = await this.canonicalPathsForQuestionnaire(checklistKey);
      questions.forEach((question) => {
        if (question.canonicalPath) canonicalPathsWithQuestion.add(question.canonicalPath);
        if (question.directBindingPath) canonicalPathsWithQuestion.add(question.directBindingPath);
      });
    }
    const edges = graph.edges || [];
    const tracedToQuestion = edges.filter((edge) => canonicalPathsWithQuestion.has(edge.sourcePath)).length;
    return {
      formCode: template.formCode,
      checklistKeys,
      totalMappedFields: edges.length,
      tracedToChecklistQuestion: tracedToQuestion,
      mappedWithNoChecklistQuestion: edges.length - tracedToQuestion,
    };
  }

  // System-wide governance view (plan §14): coverageSummary for EVERY
  // active USCIS form template, not one form picked by hand - this is
  // what actually answers "across all visas/forms/checklists, how much of
  // the mapping is traceable to a real checklist question". Templates
  // with zero registry-associated checklists are still included (with
  // checklistKeys: [] and 0/0 coverage) so a form/visa with NO checklist
  // mapping at all is visible as a gap, not silently skipped.
  static async coverageSummaryForAllForms() {
    const templates = await USCISFormTemplate.find({ status: "active" }).select("_id formCode title").lean();
    const results = [];
    for (const template of templates) {
      try {
        const summary = await this.coverageSummary(template._id);
        if (summary) results.push({ templateId: template._id, title: template.title, ...summary });
      } catch (error) {
        results.push({ templateId: template._id, formCode: template.formCode, title: template.title, error: error.message });
      }
    }
    return results;
  }
}

module.exports = ChecklistFieldTraceabilityService;
