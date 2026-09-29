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
const CanonicalFieldRegistryService = require("./CanonicalFieldRegistryService");

// Phase 3H: visaTypes checklistMappings.seed.js's own header/scope-note
// comments explicitly call out as untouched-by-design (never a guess -
// transcribed verbatim from that file's "Scope notes" comment block, so a
// change to that comment is the only thing that should ever change this
// list). A form-without-checklist / visa-without-checklist defect on one of
// these visaTypes is an intentional, documented gap, never a bug.
const SEED_SCOPE_EXCLUDED_VISA_TYPES = new Set([
  "H-1B1 Chile", "H-1B1 Singapore", "H-2A", "H-2B", "H-3", "Q-1", "R-1", "R-2",
  "J-1", "J-2", "M-1", "M-2", "U-1", "U-2", "U-3", "U-4", "U-5",
  "Re-entry Permit", "EB-1C", "EB-4", "GC-NVC",
  // "EB-5 Regional Center stay GAP (§16) - explicitly not reusing
  // e2_visa_checklist/e2_business_plan_checklist" - the whole visaType, not
  // one form, per the seed comment; confirmed live every EB-5 Regional
  // Center/Standalone VisaFormMapping row (I-526/I-526E/I-956F/DS-260/
  // I-765/I-131/I-693/I-829/I-485) has an empty checklistMappings array.
  "EB-5 Regional Center", "EB-5 Standalone",
]);

// (visaType, formNumber) pairs the seed file's own inline comments call a
// deliberate GAP - never inferred, only transcribed from
// checklistMappings.seed.js's comments at the cited line.
const SEED_SCOPE_EXCLUDED_PAIRS = new Set([
  "L-1B|I-129", "L-1B|I-129S", "L-1B|I-907", // "GAP - no dedicated L-1B checklist exists yet"
  "O-2|I-129", "O-2|I-539", "O-2|I-907", // "GAP - no dedicated O-2 checklist"
]);

// formCodes that are not USCIS forms at all (DOS/DOL/other agencies) -
// checklistKeysForForm already returns [] for these by design (see its own
// test); a governance defect check must not flag them as "form without
// checklist" either. Kept in sync with the same agency concept
// VisaFormMapping.agency already models, without re-deriving it here.
const NON_USCIS_FORM_CODES = new Set(["DS-160", "DS-117", "ETA-9089", "ETA-9035"]);

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

  // True when checklistMappings.seed.js's OWN header/inline comments call
  // this (visaType, formNumber) pair (or the whole visaType) a deliberate,
  // documented GAP - never inferred, only matched against the transcribed
  // lists above. Callers use this to keep "form/visa without a checklist"
  // from ever flagging an intentional design decision as a defect.
  static isDocumentedGap(visaType, formNumber) {
    if (SEED_SCOPE_EXCLUDED_VISA_TYPES.has(visaType)) return true;
    if (SEED_SCOPE_EXCLUDED_PAIRS.has(`${visaType}|${formNumber}`)) return true;
    return false;
  }

  // Phase 3H governance defects (plan's "REQUIRED DEFECT CATEGORIES", scoped
  // to ONE template) - extends the existing coverageSummary()/validateGraph()
  // diagnostics, never a second validation engine. Every defect carries a
  // `code` drawn from MappingGraphService.validateGraph's own enum where one
  // already exists (INVALID_SOURCE, INVALID_TARGET, BROKEN_MAPPING,
  // BROKEN_REPEATING_MAPPING, DUPLICATE_TARGET_MAPPING,
  // MISSING_REQUIRED_MAPPING, MISSING_FIELD_MAPPING) - new codes are added
  // only for categories that enum has no equivalent for. Read-only: no
  // record is created, changed, or auto-fixed by calling this.
  static async governanceDefects(templateId) {
    const template = await USCISFormTemplate.findById(templateId).lean();
    if (!template) return null;
    const formCode = template.formCode;
    const { graph } = await MappingGraphService.preview(templateId);
    const validation = graph.validation || MappingGraphService.validateGraph(graph, template);
    const defects = [];
    const intentionalGaps = [];

    // 1. Invalid PDF-field->canonical mapping / broken mapping graph edges -
    // reuse validateGraph's own errors verbatim, never re-derived.
    (validation.errors || []).forEach((e) => defects.push({ category: "INVALID_MAPPING_EDGE", code: e.code, detail: e }));
    // Unmapped PDF field - validateGraph's own MISSING_*_MAPPING warnings.
    (validation.warnings || [])
      .filter((w) => w.code === "MISSING_FIELD_MAPPING" || w.code === "MISSING_REQUIRED_MAPPING")
      .forEach((w) => defects.push({ category: "UNMAPPED_PDF_FIELD", code: w.code, detail: w }));

    // 2. Registry-level defects: every VisaFormMapping row that actually
    // targets this real formCode (mirrors checklistKeysForForm's own
    // scoping - never a global scan).
    const rows = await VisaFormMapping.find({ formTemplateFormCode: String(formCode || "").toLowerCase() }).lean();
    for (const row of rows) {
      if (row.active === false) {
        defects.push({ category: "INACTIVE_MAPPING", visaType: row.visaType, formNumber: row.formNumber, detail: "VisaFormMapping row is inactive but still on record for this form/visa" });
        continue;
      }
      const entries = row.checklistMappings || [];
      if (!entries.length) {
        const gap = this.isDocumentedGap(row.visaType, row.formNumber) || NON_USCIS_FORM_CODES.has(formCode);
        const item = { visaType: row.visaType, formNumber: row.formNumber, detail: "No checklist registered for this visa/form pair" };
        if (gap) intentionalGaps.push({ category: "VISA_WITHOUT_CHECKLIST_MAPPING", ...item });
        else defects.push({ category: "VISA_WITHOUT_CHECKLIST_MAPPING", ...item });
        continue;
      }
      for (const entry of entries) {
        // Invalid checklist reference: checklistKey resolves to no real
        // Questionnaire at all.
        const questionnaire = await Questionnaire.findOne({ key: entry.checklistKey, latestVersion: true }).select("_id checklistRole").lean();
        if (!questionnaire) {
          defects.push({ category: "INVALID_CHECKLIST_REFERENCE", visaType: row.visaType, formNumber: row.formNumber, checklistKey: entry.checklistKey });
          continue;
        }
        // Invalid participant mapping: an authored role outside the
        // Questionnaire model's own CHECKLIST_ROLES enum, or one that
        // contradicts the questionnaire's own recorded checklistRole when
        // that questionnaire only ever plays one role.
        if (entry.role && !Questionnaire.CHECKLIST_ROLES.includes(entry.role)) {
          defects.push({ category: "INVALID_PARTICIPANT_MAPPING", visaType: row.visaType, formNumber: row.formNumber, checklistKey: entry.checklistKey, role: entry.role, reason: "role is not a recognized CHECKLIST_ROLES value" });
        } else if (entry.role && questionnaire.checklistRole && questionnaire.checklistRole !== entry.role) {
          defects.push({ category: "INVALID_PARTICIPANT_MAPPING", visaType: row.visaType, formNumber: row.formNumber, checklistKey: entry.checklistKey, role: entry.role, reason: `registry role "${entry.role}" does not match this questionnaire's own checklistRole "${questionnaire.checklistRole}"` });
        }
        // Conditionally unreachable mapping: assignmentType CONDITIONAL
        // with no condition ever gates it - it can never actually be
        // evaluated for or against a case, so it's either dead code or
        // should be AUTO.
        if (entry.assignmentType === "CONDITIONAL" && !entry.condition) {
          defects.push({ category: "CONDITIONALLY_UNREACHABLE_MAPPING", visaType: row.visaType, formNumber: row.formNumber, checklistKey: entry.checklistKey, reason: "assignmentType is CONDITIONAL but no condition is set" });
        }
      }
    }

    // 3. Checklist question without canonical mapping - only for the
    // checklist(s) actually registered to THIS form (checklistKeysForForm's
    // own scoping), excluding document/file questions (no canonical field
    // applies) and scaffold questions (singlePartyChecklists.js's own
    // scaffold convention - not production content yet, so not a defect).
    const checklistKeys = await this.checklistKeysForForm(formCode);
    const edgesByPath = new Map();
    (graph.edges || []).forEach((edge) => {
      if (!edgesByPath.has(edge.sourcePath)) edgesByPath.set(edge.sourcePath, []);
      edgesByPath.get(edge.sourcePath).push(edge);
    });
    for (const checklistKey of checklistKeys) {
      const { questionnaire, questions } = await this.canonicalPathsForQuestionnaire(checklistKey);
      if (!questionnaire) continue;
      const rawQuestions = await Question.find({ questionnaire: questionnaire._id, active: { $ne: false } }).select("key type metadata").lean();
      const byKey = new Map(rawQuestions.map((q) => [q.key, q]));
      questions.forEach((question) => {
        const raw = byKey.get(question.questionKey);
        if (raw?.metadata?.scaffold) return;
        if (raw?.type === "file" || raw?.type === "section_break") return;
        const matched = this.matchedSourcePath(question, edgesByPath);
        if (!question.canonicalPath && !matched) {
          defects.push({ category: "CHECKLIST_QUESTION_WITHOUT_CANONICAL_MAPPING", checklistKey, questionKey: question.questionKey, label: question.label });
        }
      });
    }

    return { formCode, templateId: String(templateId), defects, intentionalGaps };
  }

  // Phase 3I "Checklist Health" - one row per production checklist/
  // questionnaire, system-wide. Reuses canonicalPathsForQuestionnaire,
  // CanonicalFieldRegistryService.list (the SAME "recognized canonical
  // path" check QuestionLibraryItem/AutoFillService trust - no new validity
  // rule) and the same graph-edge direct-binding recognition governanceDefects
  // above uses - never a parallel diagnostics engine.
  static async checklistHealth() {
    const recognizedPaths = new Set(CanonicalFieldRegistryService.list({}).map((f) => f.path));
    const isRecognizedPath = (path) => {
      if (!path) return false;
      if (recognizedPaths.has(path)) return true;
      // A repeatable canonical path may be authored either as
      // "employment[].employerName" (the registry's own shape) or without
      // the "[]" - accept both rather than false-flagging a real field.
      return recognizedPaths.has(path.replace(/\[\]/g, ""));
    };

    const questionnaires = await Questionnaire.find({ latestVersion: true }).select("_id key title checklistRole status isActive checklistTriggers").lean();
    const visaFormRows = await VisaFormMapping.find({ active: true }).select("visaType formNumber formTemplateFormCode checklistMappings").lean();
    const activeTemplatesByFormCode = new Map(
      (await USCISFormTemplate.find({ status: "active" }).select("_id formCode").lean()).map((t) => [String(t.formCode || "").toLowerCase(), t])
    );

    // Reverse index: checklistKey -> every {visaType, formNumber, ...} entry
    // that names it, scoped exactly like checklistKeysForForm's own lookup,
    // just inverted.
    const applicableByChecklistKey = new Map();
    visaFormRows.forEach((row) => {
      (row.checklistMappings || []).forEach((entry) => {
        if (!applicableByChecklistKey.has(entry.checklistKey)) applicableByChecklistKey.set(entry.checklistKey, []);
        applicableByChecklistKey.get(entry.checklistKey).push({
          visaType: row.visaType,
          formNumber: row.formNumber,
          formTemplateFormCode: row.formTemplateFormCode,
          assignmentType: entry.assignmentType,
          role: entry.role,
        });
      });
    });
    // Any questionnaire named as a checklistTrigger's target counts as
    // "live-assigned" too (Questionnaire.checklistTriggers - an active
    // assign/remove rule, not the VisaFormMapping registry, but a real,
    // in-production assignment path all the same).
    const triggerTargets = new Set();
    questionnaires.forEach((q) => (q.checklistTriggers || []).forEach((trig) => {
      if (trig.active !== false && trig.targetQuestionnaireKey) triggerTargets.add(trig.targetQuestionnaireKey);
    }));

    // One graph/edge-index load per active template, shared across every
    // questionnaire that names it applicable - the same graph would
    // otherwise be reloaded from scratch (MappingGraphService.preview) once
    // per questionnaire per form, which is the entire catalog's worth of
    // redundant work for a page that's read hundreds of times.
    const edgesByPathByTemplate = new Map();
    async function edgesByPathFor(templateId) {
      const key = String(templateId);
      if (edgesByPathByTemplate.has(key)) return edgesByPathByTemplate.get(key);
      const { graph } = await MappingGraphService.preview(templateId);
      const map = new Map();
      (graph.edges || []).forEach((edge) => {
        if (!map.has(edge.sourcePath)) map.set(edge.sourcePath, []);
        map.get(edge.sourcePath).push(edge);
      });
      edgesByPathByTemplate.set(key, map);
      return map;
    }

    const rows = [];
    for (const questionnaire of questionnaires) {
      const applicable = applicableByChecklistKey.get(questionnaire.key) || [];
      const rawQuestions = await Question.find({ questionnaire: questionnaire._id, active: { $ne: false } }).select("key type metadata conditionalLogic sectionKey mapping libraryItem").lean();
      const { questions } = await this.canonicalPathsForQuestionnaire(questionnaire.key);
      const canonicalPathByKey = new Map(questions.map((q) => [q.questionKey, q.canonicalPath]));

      const isDataQuestion = (q) => q.type !== "file" && q.type !== "section_break";
      const dataQuestions = rawQuestions.filter(isDataQuestion);
      const canonicalMappingCount = dataQuestions.filter((q) => canonicalPathByKey.get(q.key)).length;
      const unmappedQuestionCount = dataQuestions.length - canonicalMappingCount;
      const documentRequirementCount = rawQuestions.filter((q) => q.type === "file").length;
      const conditionalSectionKeys = new Set(
        rawQuestions.filter((q) => q.conditionalLogic?.enabled || (q.conditionalLogic?.rules || []).length).map((q) => q.sectionKey)
      );
      const scaffold = rawQuestions.some((q) => q.metadata?.scaffold === true);

      const applicableFormCodes = [...new Set(applicable.map((a) => a.formTemplateFormCode || String(a.formNumber || "").toLowerCase()))];
      const applicableActiveTemplateIds = applicableFormCodes
        .map((formCode) => activeTemplatesByFormCode.get(formCode))
        .filter(Boolean)
        .map((t) => t._id);

      // Direct-legacy-binding flag: does at least one question's literal
      // raw.questionnaireAnswers.<key>.value path actually match a real
      // edge on one of this checklist's own applicable, active form
      // templates (the exact matchedSourcePath recognition
      // traceQuestionsToFields/governanceDefects already use) - never
      // guessed.
      let directLegacyBinding = false;
      const consumedPaths = new Set();
      for (const templateId of applicableActiveTemplateIds) {
        const edgesByPath = await edgesByPathFor(templateId);
        edgesByPath.forEach((_edges, path) => consumedPaths.add(path));
        if (!directLegacyBinding) {
          directLegacyBinding = questions.some((q) => q.directBindingPath && q.directBindingPath !== q.canonicalPath && edgesByPath.has(q.directBindingPath));
        }
      }

      // Invalid canonical paths: authored (via QuestionLibraryItem or
      // question.mapping.canonicalPath) but not a path
      // CanonicalFieldRegistryService.list() recognizes at all.
      const invalidCanonicalPaths = [...new Set(questions.filter((q) => q.canonicalPath && !isRecognizedPath(q.canonicalPath)).map((q) => q.canonicalPath))];

      // Canonical fields with no form consumer: a real, recognized
      // canonicalPath this checklist uses that no edge on ANY of its
      // applicable active templates' mapping graphs actually consumes.
      const usedPaths = [...new Set(questions.filter((q) => q.canonicalPath && isRecognizedPath(q.canonicalPath)).map((q) => q.canonicalPath))];
      const canonicalFieldsNoConsumer = applicableActiveTemplateIds.length ? usedPaths.filter((path) => !consumedPaths.has(path)) : [];

      const isLive = applicable.some((a) => activeTemplatesByFormCode.has((a.formTemplateFormCode || String(a.formNumber || "").toLowerCase())))
        || triggerTargets.has(questionnaire.key);

      rows.push({
        key: questionnaire.key,
        title: questionnaire.title,
        checklistRole: questionnaire.checklistRole,
        active: questionnaire.isActive !== false && questionnaire.status !== "archived",
        status: questionnaire.status,
        applicable: applicable.map((a) => ({ visaType: a.visaType, formNumber: a.formNumber, assignmentType: a.assignmentType, role: a.role })),
        questionCount: dataQuestions.length,
        canonicalMappingCount,
        unmappedQuestionCount,
        conditionalSectionCount: conditionalSectionKeys.size,
        documentRequirementCount,
        directLegacyBinding,
        orphan: applicable.length === 0 && !triggerTargets.has(questionnaire.key),
        notAssignedToLiveWorkflow: !isLive,
        scaffold,
        invalidCanonicalPaths,
        canonicalFieldsNoConsumer,
      });
    }
    return rows;
  }
}

module.exports = ChecklistFieldTraceabilityService;
