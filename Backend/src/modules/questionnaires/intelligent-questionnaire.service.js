const crypto = require("crypto");
const AuditLog = require("../../models/AuditLog");
const Question = require("../../models/Question");
const Questionnaire = require("../../models/Questionnaire");
const QuestionLibraryItem = require("../../models/QuestionLibraryItem");
const MappingResolver = require("../form-mapping/services/MappingResolver");

function idOf(value) {
  return value?._id?.toString?.() || value?.toString?.();
}

function hasValue(value) {
  return value !== undefined && value !== null && value !== "" && (!Array.isArray(value) || value.length > 0);
}

function unique(values = []) {
  return [...new Set(values.filter(Boolean).map(String))];
}

function questionKey(item) {
  return `library_${String(item.key).replace(/[^a-zA-Z0-9]+/g, "_")}`;
}

function fingerprint(templates, items) {
  const payload = {
    templates: templates.map((template) => [idOf(template._id), template.version, template.activeMappingVersion || template.mappingVersion || 0]).sort(),
    library: items.map((item) => [idOf(item._id), item.version]).sort(),
  };
  return crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

function validationRulesFor(item) {
  const supported = new Set(["required", "min", "max", "minLength", "maxLength", "regex", "email", "phone", "date", "fileType", "fileSize"]);
  const rules = [];
  (item.validationRules || []).forEach((entry) => {
    if (entry?.type && supported.has(entry.type)) {
      rules.push(entry);
      return;
    }
    Object.entries(entry || {}).forEach(([type, value]) => {
      if (!supported.has(type) || value === false || value === undefined) return;
      rules.push({ type, value, severity: "error" });
    });
  });
  if (item.requirement === "required" && !rules.some((rule) => rule.type === "required")) {
    rules.push({ type: "required", value: true, severity: "error" });
  }
  return rules;
}

class IntelligentQuestionnaireService {
  static async audit(action, entity, user, req, changes = {}) {
    await AuditLog.create({
      userId: user?._id,
      userRole: user?.role,
      action,
      entityType: "Questionnaire",
      entityId: idOf(entity),
      changes,
      ipAddress: req?.ip,
      userAgent: req?.headers?.["user-agent"],
      description: `${action} intelligent questionnaire`,
    }).catch(() => null);
  }

  static async libraryItemsForTemplates(templates = []) {
    const templateIds = templates.map((template) => template._id).filter(Boolean);
    if (!templateIds.length) return [];
    return QuestionLibraryItem.find({
      "sources.formTemplate": { $in: templateIds },
      active: true,
      "review.status": { $ne: "rejected" },
    }).sort({ sectionKey: 1, label: 1 }).lean();
  }

  static async ensureGeneratedForCase(caseData, templates, user, req) {
    const items = await this.libraryItemsForTemplates(templates);
    if (!items.length) return null;
    const sourceFingerprint = fingerprint(templates, items);
    let questionnaire = await Questionnaire.findOne({
      "generation.source": "uscis_question_library",
      "generation.fingerprint": sourceFingerprint,
      status: "published",
      isActive: true,
    });
    const sectionMap = new Map();
    items.forEach((item) => {
      if (!sectionMap.has(item.sectionKey)) {
        sectionMap.set(item.sectionKey, {
          key: item.sectionKey,
          title: item.sectionTitle,
          description: "",
          order: sectionMap.size + 1,
          isActive: true,
          repeatable: false,
        });
      }
    });
    const sections = [...sectionMap.values()];
    const visaTypes = unique([caseData.visaType, ...(templates.flatMap((template) => template.visaTypes || []))]);
    const questionnairePayload = {
      key: `uscis_library_${sourceFingerprint.slice(0, 20)}`,
      title: `${caseData.visaType || "Immigration"} Filing Intake`,
      description: "Questions required by the assigned USCIS form editions.",
      version: 1,
      visaType: caseData.visaType,
      visaTypes,
      caseTypes: unique([caseData.caseType]),
      status: "published",
      isActive: true,
      type: "questionnaire",
      module: "uscis_forms",
      category: "immigration",
      tags: ["generated", "uscis-question-library"],
      isTemplate: true,
      templateCategory: "uscis_question_library",
      latestVersion: true,
      sections,
      pages: sections.map((section) => ({
        key: section.key,
        title: section.title,
        order: section.order,
        sectionKeys: [section.key],
      })),
      settings: {
        multiStep: true,
        autoSave: true,
        allowBackNavigation: true,
        requireReview: true,
        progressMode: "questions",
        defaultLocale: "en",
        enableBranching: true,
      },
      builder: {
        layout: "wizard",
        pageOrder: sections.map((section) => section.key),
        sectionOrder: sections.map((section) => section.key),
        questionOrder: items.map(questionKey),
      },
      assignmentRules: {
        visaTypes,
        caseTypes: unique([caseData.caseType]),
        petitionTypes: unique([caseData.petitionType]),
        required: true,
        priority: 100,
      },
      requiredCanonicalFields: unique(items.filter((item) => item.requirement === "required").map((item) => item.canonicalPath)),
      approval: { status: "approved", reviewedBy: user?._id, reviewedAt: new Date() },
      generation: {
        source: "uscis_question_library",
        fingerprint: sourceFingerprint,
        formTemplateIds: templates.map((template) => template._id),
        libraryItemIds: items.map((item) => item._id),
        generatedAt: new Date(),
        generatedBy: user?._id,
      },
      publishedAt: new Date(),
      publishedBy: user?._id,
      createdBy: user?._id,
      updatedBy: user?._id,
    };
    if (!questionnaire) {
      try {
        questionnaire = await Questionnaire.create(questionnairePayload);
        questionnaire.rootQuestionnaire = questionnaire._id;
        await questionnaire.save();
      } catch (error) {
        if (error.code !== 11000) throw error;
        questionnaire = await Questionnaire.findOne({ "generation.fingerprint": sourceFingerprint });
        if (!questionnaire) throw error;
      }
    }

    const relevantTemplateIds = new Set(templates.map((template) => idOf(template._id)));
    const sourceFieldToQuestion = new Map();
    items.forEach((item) => {
      (item.sources || [])
        .filter((source) => relevantTemplateIds.has(idOf(source.formTemplate)))
        .forEach((source) => sourceFieldToQuestion.set(source.fieldId, questionKey(item)));
    });
    const questionPayloads = items.map((item, index) => ({
      libraryItem: item._id,
      libraryKey: item.key,
      libraryVersion: item.version,
      questionnaire: questionnaire._id,
      questionnaireKey: questionnaire.key,
      questionnaireVersion: questionnaire.version,
      key: questionKey(item),
      sectionKey: item.sectionKey,
      pageKey: item.sectionKey,
      order: index + 1,
      type: item.type,
      label: item.label,
      options: item.options || [],
      validationRules: validationRulesFor(item),
      conditionalLogic: {
        mode: "all",
        rules: (item.dependencies || []).map((dependency) => {
          const sourceQuestionKey = sourceFieldToQuestion.get(dependency.sourceFieldId);
          if (!sourceQuestionKey) return null;
          const condition = dependency.condition || {};
          return {
            questionKey: sourceQuestionKey,
            operator: condition.operator === "hasValue" ? "exists" : condition.operator || "equals",
            value: condition.value,
          };
        }).filter(Boolean),
        groups: [],
      },
      dependencies: (item.dependencies || [])
        .map((dependency) => sourceFieldToQuestion.get(dependency.sourceFieldId))
        .filter(Boolean),
      repeatable: item.repeatable,
      repeatableConfig: item.repeatableConfig,
      required: item.requirement === "required",
      mapping: {
        masterDataPath: item.canonicalPath,
        canonicalPath: item.canonicalPath,
      },
      uscisMappings: (item.sources || [])
        .filter((source) => relevantTemplateIds.has(idOf(source.formTemplate)))
        .map((source) => `${source.formCode}.${source.fieldId}`),
      metadata: {
        libraryRequirement: item.requirement,
        sourceForms: item.sourceForms,
        confidence: item.confidence,
        reviewStatus: item.review?.status,
      },
      visibility: {
        roles: ["client", "case_manager", "team_lead", "attorney", "paralegal", "admin", "super_admin"],
        portals: ["client", "admin"],
      },
      createdBy: user?._id,
      updatedBy: user?._id,
    }));
    await Question.bulkWrite(questionPayloads.map((question) => ({
      updateOne: {
        filter: { questionnaire: questionnaire._id, key: question.key },
        update: { $setOnInsert: question },
        upsert: true,
      },
    })), { ordered: false });
    await this.audit("INTELLIGENT_QUESTIONNAIRE_GENERATED", questionnaire, user, req, {
      sourceFingerprint,
      formTemplateIds: templates.map((template) => template._id),
      questionCount: items.length,
    });
    return questionnaire;
  }

  static buildCaseQuestionState(questions = [], canonicalState = {}, answers = []) {
    const answerByQuestion = new Map(answers.map((answer) => [answer.questionKey, answer]));
    const pendingConflicts = (canonicalState.conflicts || []).filter((conflict) => conflict.status === "pending_review");
    const conflictByPath = new Map(pendingConflicts.map((conflict) => [conflict.path, conflict]));
    const pendingQuestions = [];
    const completedQuestions = [];
    const prefill = {};
    const conflicts = {};

    questions.forEach((question) => {
      const path = question.mapping?.canonicalPath || question.mapping?.masterDataPath || question.masterDataPath;
      const answer = answerByQuestion.get(question.key);
      const value = path ? MappingResolver.resolvePath(canonicalState.profile || {}, path) : answer?.normalizedValue ?? answer?.value;
      const metadata = path ? canonicalState.fieldMetadata?.[path] : undefined;
      const conflict = path ? conflictByPath.get(path) : undefined;
      const completed = hasValue(value) && !conflict;
      const state = {
        questionId: question._id,
        questionKey: question.key,
        canonicalPath: path,
        value,
        source: metadata?.sourceType || metadata?.source || (answer ? "questionnaire" : undefined),
        confidence: metadata?.confidence ?? (answer ? 100 : undefined),
        candidates: conflict?.candidates || metadata?.candidates || [],
      };
      if (hasValue(value)) prefill[question.key] = state;
      if (conflict) conflicts[question.key] = { ...state, conflictId: conflict.conflictId, status: conflict.status };
      if (completed) completedQuestions.push({ question, ...state });
      else pendingQuestions.push(question);
    });
    return {
      pendingQuestions,
      completedQuestions,
      prefill,
      conflicts,
      summary: {
        total: questions.length,
        pending: pendingQuestions.length,
        completed: completedQuestions.length,
        conflicts: Object.keys(conflicts).length,
        percent: questions.length ? Math.round((completedQuestions.length / questions.length) * 100) : 100,
      },
    };
  }
}

module.exports = IntelligentQuestionnaireService;
