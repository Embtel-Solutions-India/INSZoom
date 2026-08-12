const crypto = require("crypto");
const Case = require("../../models/Case");
const CaseForm = require("../../models/CaseForm");
const Question = require("../../models/Question");
const Questionnaire = require("../../models/Questionnaire");
const AutoFillService = require("../form-mapping/services/AutoFillService");
const CanonicalProfileService = require("../canonical/services/CanonicalProfileService");
const caseService = require("./case.service");
const questionnaireService = require("../questionnaires/questionnaire.service");
const IntelligentQuestionnaireService = require("../questionnaires/intelligent-questionnaire.service");
const uscisFormService = require("../uscis-forms/uscis-form.service");

const PROTECTED_FORM_STATUSES = new Set(["approved", "ready_for_pdf", "generated", "finalized", "filed", "locked", "archived"]);
const FILE_QUESTION_TYPES = new Set(["file", "file-multiple"]);

function idOf(value) {
  return value?._id?.toString?.() || value?.toString?.();
}

function normalize(value) {
  return String(value || "").trim().replace(/[^a-z0-9]+/gi, "").toUpperCase();
}

function getByPath(source, path) {
  return String(path || "").split(".").filter(Boolean).reduce((current, key) => (current == null ? undefined : current[key]), source);
}

function uniqueBy(items, keyFor) {
  const seen = new Set();
  return items.filter((item) => {
    const key = keyFor(item);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

class ImmigrationKnowledgeEngineService {
  static userId(user) {
    return user?._id || user?.id || user;
  }

  static ruleMatches(values = [], target) {
    if (!values?.length) return true;
    const normalizedTarget = normalize(target);
    return values.some((value) => normalize(value) === normalizedTarget);
  }

  static hasQuestionnaireScope(questionnaire = {}) {
    const rules = questionnaire.assignmentRules || {};
    return Boolean(
      questionnaire.appliesToAllVisas
      || rules.visaTypes?.length
      || questionnaire.visaTypes?.length
      || questionnaire.visaType
      || rules.visaCategories?.length
      || rules.caseTypes?.length
      || questionnaire.caseTypes?.length
      || rules.petitionTypes?.length
      || rules.applicantTypes?.length
      || rules.employerTypes?.length
      || rules.organizationRules
    );
  }

  // The full set of visa types a questionnaire is explicitly scoped to, from
  // whichever of the three places it might be declared. Never falls back to
  // `[undefined]` — an absent value here means "no explicit visa scope",
  // which questionnaireApplies() treats as "not visa-specific", never as
  // "matches every visa" (that fail-open behavior was the cross-visa leak:
  // an H-1B case could pick up an L-1A checklist, and vice versa).
  static resolveVisaTypes(questionnaire = {}) {
    const rules = questionnaire.assignmentRules || {};
    const list = rules.visaTypes?.length
      ? rules.visaTypes
      : questionnaire.visaTypes?.length
        ? questionnaire.visaTypes
        : questionnaire.visaType
          ? [questionnaire.visaType]
          : [];
    return list.filter(Boolean);
  }

  static questionnaireApplies(questionnaire = {}, caseData = {}) {
    if (!this.hasQuestionnaireScope(questionnaire)) return false;
    const rules = questionnaire.assignmentRules || {};
    if (rules.required === false) return false;

    const visaTypes = this.resolveVisaTypes(questionnaire);
    if (visaTypes.length) {
      // Explicit visa scope declared — must match this case's visa exactly.
      // Only visaTypes actually present are ever compared; there is no
      // "empty means all" fallback for this dimension.
      if (!this.ruleMatches(visaTypes, caseData.visaType)) return false;
    } else if (!questionnaire.appliesToAllVisas) {
      // No visa scope declared at all, and not explicitly marked global —
      // never assign a visa-agnostic questionnaire onto a visa-specific
      // checklist. Only questionnaires opting in via appliesToAllVisas may
      // apply here without a visaTypes match.
      return false;
    }

    if (rules.requiresNewOfficePetition) {
      const newOffice = String(caseData.assessmentAnswers?.newOfficePetition || caseData.questionnaireData?.masterData?.newOfficePetition || "").trim().toLowerCase();
      if (newOffice !== "yes") return false;
    }
    if (!this.ruleMatches(rules.visaCategories, caseData.visaCategory)) return false;
    if (!this.ruleMatches(rules.caseTypes?.length ? rules.caseTypes : questionnaire.caseTypes, caseData.caseType)) return false;
    if (!this.ruleMatches(rules.petitionTypes, caseData.petitionType)) return false;
    if (!this.ruleMatches(rules.applicantTypes, caseData.applicantType || caseData.assessmentAnswers?.applicantType)) return false;
    if (!this.ruleMatches(rules.employerTypes, caseData.employerType || caseData.assessmentAnswers?.employerType)) return false;
    return true;
  }

  static async applicableQuestionnaires(caseData) {
    const candidates = await Questionnaire.find({
      isActive: { $ne: false },
      status: { $ne: "archived" },
      latestVersion: { $ne: false },
      module: { $in: ["cases", "clients"] },
    }).sort({ "assignmentRules.priority": -1, version: -1 }).lean();
    const grouped = new Map();
    candidates
      .filter((item) => this.questionnaireApplies(item, caseData))
      // Defense in depth: even if questionnaireApplies() matched, never let
      // a questionnaire whose declared visa scope excludes this case's visa
      // slip through (e.g. a template edited to add a second dimension
      // without also fixing a stale/misconfigured visaTypes list).
      .filter((item) => {
        const visaTypes = this.resolveVisaTypes(item);
        return !visaTypes.length || this.ruleMatches(visaTypes, caseData.visaType);
      })
      .forEach((item) => {
        const key = item.rootQuestionnaire ? idOf(item.rootQuestionnaire) : item.key;
        if (!grouped.has(key)) grouped.set(key, item);
      });
    return [...grouped.values()];
  }

  static normalizeRequirement(requirement, defaults = {}) {
    const source = typeof requirement === "string" ? { name: requirement } : requirement || {};
    const name = source.name || source.label || source.documentType || source.type || defaults.name;
    if (!name) return null;
    return {
      key: source.key || normalize(source.documentType || source.type || name).toLowerCase(),
      name,
      documentType: source.documentType || source.type || name,
      description: source.description || defaults.description || "",
      required: source.required !== false,
      category: source.category || defaults.category || "immigration",
      condition: source.condition || source.visibleWhen || null,
      source: source.source || defaults.source,
      role: source.role || defaults.role || "",
    };
  }

  static requirementsFromQuestionnaires(questionnaires, questions) {
    const documents = [];
    const evidence = [];
    const requiredCanonicalFields = [];
    const questionnaireMap = new Map(questionnaires.map((item) => [idOf(item._id), item]));

    questionnaires.forEach((questionnaire) => {
      (questionnaire.documentRequirements || []).forEach((item) => {
        const normalized = this.normalizeRequirement(item, { source: `questionnaire:${questionnaire.key}`, role: questionnaire.checklistRole });
        if (normalized) documents.push(normalized);
      });
      (questionnaire.evidenceRequirements || []).forEach((item) => {
        const normalized = this.normalizeRequirement(item, { source: `questionnaire:${questionnaire.key}`, category: "evidence", role: questionnaire.checklistRole });
        if (normalized) evidence.push(normalized);
      });
      requiredCanonicalFields.push(...(questionnaire.requiredCanonicalFields || []));
    });

    questions.forEach((question) => {
      const questionnaire = questionnaireMap.get(idOf(question.questionnaire));
      const source = `questionnaire:${questionnaire?.key || idOf(question.questionnaire)}`;
      const role = questionnaire?.checklistRole;
      if (FILE_QUESTION_TYPES.has(question.type) || question.metadata?.requestedType === "file-multiple") {
        const normalized = this.normalizeRequirement({
          name: question.metadata?.documentName || question.label,
          documentType: question.fileConstraints?.requireDocumentCategory || question.metadata?.documentType || question.evidenceCategory || question.key,
          description: question.helpText || question.description,
          required: question.required,
          // A file question built with a real, specific category (e.g.
          // employmentChecklists.js's documentQuestions() always sets
          // metadata.category to "us_business"/"foreign_business"/"identity"/
          // etc.) keeps that category, so the Documents page's reusable-doc
          // baseline groups it under its own real section ("U.S. Company
          // Documents", "Foreign Company Documents", ...) instead of every
          // evidenceCategory-tagged document collapsing into one generic
          // "Supporting Evidence" bucket. Only a question with no specific
          // category at all (just a bare evidenceCategory, e.g. O-1A/EB-1A's
          // open-ended award/publication evidence uploads) falls back to
          // "evidence".
          category: question.metadata?.category || (question.evidenceCategory ? "evidence" : "questionnaire"),
          condition: question.conditionalLogic,
        }, { source, role });
        if (normalized) documents.push(normalized);
      }
      if (question.evidenceCategory) {
        const normalized = this.normalizeRequirement({
          name: question.evidenceCategory,
          documentType: question.evidenceCategory,
          required: question.required,
          category: "evidence",
          condition: question.conditionalLogic,
        }, { source, role });
        if (normalized) evidence.push(normalized);
      }
      if (question.required && (question.mapping?.canonicalPath || question.mapping?.masterDataPath)) {
        requiredCanonicalFields.push(question.mapping.canonicalPath || question.mapping.masterDataPath);
      }
    });

    return {
      documents: uniqueBy(documents, (item) => normalize(item.documentType || item.name)),
      evidence: uniqueBy(evidence, (item) => normalize(item.documentType || item.name)),
      requiredCanonicalFields: [...new Set(requiredCanonicalFields.filter(Boolean))],
    };
  }

  static requiredCanonicalFieldsFromForms(templates) {
    const paths = [];
    templates.forEach((template) => {
      (template.formFields || []).forEach((field) => {
        if (!field.required && !field.validation?.required && !field.validationRules?.required) return;
        const mappings = field.mappings?.length ? field.mappings : field.mapping ? [field.mapping] : [];
        mappings.forEach((mapping) => {
          const path = mapping.canonicalPath || mapping.sourceField || mapping.path || mapping.source;
          if (path && typeof path === "string") paths.push(path.replace(/^canonical\./, ""));
        });
      });
    });
    return [...new Set(paths)];
  }

  static requirementsFromForms(templates) {
    const documents = [];
    const evidence = [];
    templates.forEach((template) => {
      (template.documentRequirements || template.definition?.documentRequirements || []).forEach((item) => {
        const normalized = this.normalizeRequirement(item, { source: `uscis_form:${template.formCode}` });
        if (normalized) documents.push(normalized);
      });
      (template.evidenceRequirements || template.definition?.evidenceRequirements || []).forEach((item) => {
        const normalized = this.normalizeRequirement(item, { source: `uscis_form:${template.formCode}`, category: "evidence" });
        if (normalized) evidence.push(normalized);
      });
    });
    return {
      documents: uniqueBy(documents, (item) => normalize(item.documentType || item.name)),
      evidence: uniqueBy(evidence, (item) => normalize(item.documentType || item.name)),
    };
  }

  static mergeChecklist(caseData, requirements) {
    const existing = [...(caseData.documentChecklist || caseData.checklistItems || [])];
    const byKey = new Map(existing.map((item) => [normalize(item.documentType || item.name), item]));
    requirements.forEach((requirement) => {
      const key = normalize(requirement.documentType || requirement.name);
      if (!key) return;
      const already = byKey.get(key);
      if (already) {
        // Non-destructive metadata reconciliation only — never touches
        // status/uploaded files/answers. Corrects a mis-set category label
        // (e.g. a prior bug that collapsed every evidenceCategory-tagged
        // document to "evidence" instead of its real "us_business"/
        // "foreign_business"/etc. category) on an already-assigned item, so
        // an existing case doesn't stay stuck with the wrong section split
        // forever once the underlying template/mapping is fixed.
        if (requirement.category && already.category !== requirement.category) already.category = requirement.category;
        if (requirement.description && already.description !== requirement.description) already.description = requirement.description;
        return;
      }
      existing.push({
        name: requirement.name,
        documentType: requirement.documentType,
        description: requirement.description,
        required: requirement.required,
        category: requirement.category,
        targetRole: requirement.role || "client",
        condition: requirement.condition || undefined,
        status: "pending",
        requestedDate: new Date(),
      });
      byKey.set(key, existing[existing.length - 1]);
    });
    caseData.documentChecklist = existing;
    caseData.checklistItems = existing;
    return existing;
  }

  // Routes each questionnaire to the case participant its checklistRole
  // (employer / employee / business_plan / client) actually applies to,
  // instead of dumping every matched questionnaire onto the same person.
  // Falls back to caseData.user/clientProfile when a role-specific user
  // hasn't been linked to the case yet (e.g. an employee not yet invited),
  // so the assignment is never silently orphaned.
  static assigneeForRole(caseData, checklistRole) {
    if (checklistRole === "employer" || checklistRole === "business_plan") {
      return caseData.employerUser || caseData.user || caseData.clientProfile;
    }
    if (checklistRole === "employee") {
      // "Fill myself" (employeeCompletionMode: employer_completes): no
      // employee account exists yet, so route the employee checklist to the
      // employer instead of leaving it unassigned. "Invite employee": once
      // employeeUser is linked, it correctly takes priority and routes to
      // the employee instead.
      return caseData.employeeUser || caseData.employerUser || caseData.user || caseData.clientProfile;
    }
    return caseData.user || caseData.clientProfile;
  }

  static async assignQuestionnaires(caseData, questionnaires, user, req) {
    const activeReferences = (caseData.questionnaireReferences || []).filter((item) => item.status !== "returned" && item.active !== false && item.questionnaireId);
    const existing = new Set(activeReferences.map((item) => idOf(item.questionnaireId || item.questionnaireTemplateId)));
    // FIX (duplicate checklist accumulation): a regenerated
    // uscis_question_library questionnaire (see ensureGeneratedForCase) gets
    // a brand-new _id every time its underlying content changes, so `existing`
    // never recognizes it as "the same checklist, just updated" - this used
    // to push a parallel questionnaireReference every time content changed,
    // so a single case could accumulate several ~900-1000-question "Filing
    // Intake" checklists over time, all still active, with getForCase simply
    // serving whichever was sent most recently. Looking up each active
    // reference's own rootQuestionnaire lets a same-lineage regeneration
    // retire the old reference before the new one is assigned, exactly like
    // reconcileConditionalAssignments already does for a no-longer-applicable
    // checklist above.
    const generatedTargets = questionnaires.filter(
      (item) => item.generation?.source === "uscis_question_library" && !existing.has(idOf(item._id))
    );
    const priorReferenceByLineage = new Map();
    if (generatedTargets.length && activeReferences.length) {
      const referencedQuestionnaires = await Questionnaire.find({ _id: { $in: activeReferences.map((item) => item.questionnaireId) } })
        .select("rootQuestionnaire generation.source")
        .lean();
      const lineageById = new Map(referencedQuestionnaires.map((item) => [idOf(item._id), idOf(item.rootQuestionnaire) || idOf(item._id)]));
      activeReferences.forEach((reference) => {
        const lineage = lineageById.get(idOf(reference.questionnaireId));
        if (lineage) priorReferenceByLineage.set(lineage, reference);
      });
    }
    const assigned = [];
    for (const questionnaire of questionnaires) {
      if (existing.has(idOf(questionnaire._id))) continue;
      if (questionnaire.generation?.source === "uscis_question_library") {
        const lineage = idOf(questionnaire.rootQuestionnaire) || idOf(questionnaire._id);
        const priorReference = priorReferenceByLineage.get(lineage);
        // questionnaireService.assignQuestionnaire() below loads its own fresh
        // Case document (it's only given caseId, not this caseData instance),
        // so mutating caseData.questionnaireReferences in memory here would
        // never actually persist - the deactivation has to land in the DB
        // directly, before that fresh load happens.
        if (priorReference) {
          await Case.updateOne(
            { _id: caseData._id, "questionnaireReferences._id": priorReference._id },
            { $set: { "questionnaireReferences.$.active": false } }
          );
        }
      }
      const targetRole = questionnaire.checklistRole || "";
      const result = await questionnaireService.assignQuestionnaire(await Questionnaire.findById(questionnaire._id), {
        caseId: caseData._id,
        assignedTo: this.assigneeForRole(caseData, targetRole),
        targetRole,
        message: `Complete the required ${questionnaire.title}.`,
      }, user, req);
      assigned.push({ questionnaireId: questionnaire._id, responseId: result.responseId, title: questionnaire.title, version: questionnaire.version, targetRole });
      existing.add(idOf(questionnaire._id));
    }
    return assigned;
  }

  // Deactivates a previously-assigned checklist that carries
  // `assignmentRules.requiresNewOfficePetition` once it's no longer in the
  // currently-applicable set — e.g. the L-1A Business Plan checklist after
  // the case's New Office answer changes from yes to no. Scoped narrowly to
  // only questionnaires that opted into this conditional-gating flag, so it
  // can never touch any other already-assigned checklist. Mirrors
  // checklist-rule-engine.service.js's applyRemove() safety: work already
  // past "in_progress" (completed/submitted/returned/approved) is left in
  // place, never silently discarded.
  static async reconcileConditionalAssignments(caseData, applicableQuestionnaireIds, user, req) {
    const activeReferences = (caseData.questionnaireReferences || []).filter((item) => item.active !== false && item.questionnaireId);
    if (!activeReferences.length) return [];
    const referencedIds = activeReferences.map((item) => item.questionnaireId);
    const conditionalQuestionnaires = await Questionnaire.find({
      _id: { $in: referencedIds },
      "assignmentRules.requiresNewOfficePetition": true,
    }).select("_id title").lean();
    if (!conditionalQuestionnaires.length) return [];
    const removed = [];
    for (const questionnaire of conditionalQuestionnaires) {
      const id = idOf(questionnaire._id);
      if (applicableQuestionnaireIds.has(id)) continue;
      const reference = activeReferences.find((item) => idOf(item.questionnaireId) === id);
      if (!reference) continue;
      if (!["not_started", "in_progress"].includes(reference.status)) continue;
      reference.active = false;
      caseService.addAuditEntry(caseData, "checklist_auto_removed", `"${questionnaire.title}" automatically removed — no longer applicable (New Office petition answer changed).`, user, { questionnaireId: id }, req);
      removed.push(id);
    }
    return removed;
  }

  static async autoFill(caseData, canonicalState, user, req) {
    const forms = await CaseForm.find({ caseId: caseData._id });
    const results = [];
    for (const form of forms) {
      const canonicalVersion = Number(canonicalState?.version || 0);
      const syncedVersion = Number(form.syncState?.canonicalVersion || 0);
      if (PROTECTED_FORM_STATUSES.has(form.status) || form.isLocked) {
        if (canonicalVersion > syncedVersion) {
          form.syncState = {
            ...(form.syncState?.toObject?.() || form.syncState || {}),
            stale: true,
            requiresRegeneration: true,
            staleReason: "canonical_profile_updated",
          };
          await form.save();
        }
        results.push({ formCode: form.formCode, status: "protected", completion: form.completion?.percent || 0 });
        continue;
      }
      if (form.versionNumber > 0 && canonicalVersion <= syncedVersion && !form.syncState?.stale) {
        results.push({ formCode: form.formCode, status: "current", completion: form.completion?.percent || 0 });
        continue;
      }
      try {
        const generated = await AutoFillService.generate(caseData._id, form.formCode, user, req, {
          regenerate: form.versionNumber > 0,
          overwriteReviewed: false,
        });
        results.push({
          formCode: form.formCode,
          status: "auto_filled",
          completion: generated.caseForm?.completion?.percent || 0,
          updatedFields: generated.report?.population?.updatedFieldCount || generated.caseForm?.autoFillReport?.updatedFieldCount || 0,
        });
      } catch (error) {
        results.push({ formCode: form.formCode, status: "failed", error: error.message });
      }
    }
    return results;
  }

  static fingerprint(plan) {
    return crypto.createHash("sha256").update(JSON.stringify(plan)).digest("hex");
  }

  static async orchestrate(caseOrId, user, req, options = {}) {
    // A bare ObjectId also has a truthy `._id` (bson's ObjectId.prototype._id
    // getter returns `this`, for code that does `value?._id || value`), so
    // that alone can't tell a real document apart from just its id - every
    // caller here (initializeCase, refreshAfterCanonicalSync) passes a bare
    // id, so the old `caseOrId?._id` check always took this branch and left
    // `caseData` as the ObjectId itself. Every field access below then read
    // undefined, so canAccessCase() always failed and orchestrate() never
    // actually assigned questionnaires/documents/autofill for any case.
    // `.save` only exists on a real Mongoose document - mirrors the fix
    // already applied in CaseLifecycleOrchestrator.recalculate().
    let caseData = typeof caseOrId?.save === "function" ? caseOrId : await Case.findById(caseOrId);
    if (!caseData) throw Object.assign(new Error("Case not found"), { status: 404 });
    if (!caseService.canAccessCase(user, caseData)) throw Object.assign(new Error("Not authorized to orchestrate this case"), { status: 403 });

    const [templates, configuredQuestionnaires] = await Promise.all([
      uscisFormService.latestTemplatesByAssignmentRules(caseData),
      this.applicableQuestionnaires(caseData),
    ]);
    const assignedForms = await uscisFormService.ensureAssignedForms(caseData, user, req, { templates, metadataOnly: true });
    const canonicalState = options.canonicalState || await CanonicalProfileService.rebuild(caseData._id, user, req, {
      reason: options.reason || "immigration_knowledge_orchestration",
      source: "immigration_knowledge_engine",
    });
    // CanonicalProfileService.rebuild() loads and saves its own independent
    // copy of this Case document (it's only given the id, not `caseData`),
    // which bumps __v underneath us. Without reloading here, every save on
    // the in-memory `caseData` below throws a Mongoose VersionError, so
    // mergeChecklist/assignQuestionnaires/autoFill never actually persist -
    // this was silently no-op'ing the entire orchestration on every case.
    caseData = await Case.findById(caseData._id);
    const generatedQuestionnaire = await IntelligentQuestionnaireService.ensureGeneratedForCase(caseData, templates, user, req);
    const questionnaires = uniqueBy([
      ...configuredQuestionnaires,
      ...(generatedQuestionnaire ? [generatedQuestionnaire] : []),
    ], (item) => idOf(item._id));
    const questions = questionnaires.length
      ? await Question.find({ questionnaire: { $in: questionnaires.map((item) => item._id) }, active: true }).lean()
      : [];
    const questionnaireRequirements = this.requirementsFromQuestionnaires(questionnaires, questions);
    const formRequirements = this.requirementsFromForms(templates);
    const requirements = {
      documents: uniqueBy([...questionnaireRequirements.documents, ...formRequirements.documents], (item) => normalize(item.documentType || item.name)),
      evidence: uniqueBy([...questionnaireRequirements.evidence, ...formRequirements.evidence], (item) => normalize(item.documentType || item.name)),
      requiredCanonicalFields: questionnaireRequirements.requiredCanonicalFields,
    };
    const requiredCanonicalFields = [...new Set([
      ...requirements.requiredCanonicalFields,
      ...this.requiredCanonicalFieldsFromForms(templates),
    ])];
    this.mergeChecklist(caseData, requirements.documents);
    const applicableQuestionnaireIds = new Set(questionnaires.map((item) => idOf(item._id)));
    await this.reconcileConditionalAssignments(caseData, applicableQuestionnaireIds, user, req);
    await caseData.save();
    const assignedQuestionnaires = await this.assignQuestionnaires(caseData, questionnaires, user, req);
    const autoFill = await this.autoFill(caseData, canonicalState, user, req);
    const missingCanonicalFields = requiredCanonicalFields.filter((path) => {
      const value = getByPath(canonicalState.profile || {}, path);
      return value === undefined || value === null || value === "" || (Array.isArray(value) && !value.length);
    });
    const configurationIssues = [];
    if (!templates.length) configurationIssues.push({ type: "uscis_forms", message: `No active metadata-scoped USCIS form templates match ${caseData.visaType}.` });
    if (!questionnaires.length) configurationIssues.push({ type: "questionnaire", message: `No active metadata-scoped questionnaire matches ${caseData.visaType}.` });

    const planSnapshot = {
      visaType: caseData.visaType,
      visaCategory: caseData.visaCategory,
      caseType: caseData.caseType,
      petitionType: caseData.petitionType,
      forms: templates.map((item) => ({ id: idOf(item._id), code: item.formCode, version: item.version, editionDate: item.editionDate })),
      questionnaires: questionnaires.map((item) => ({ id: idOf(item._id), key: item.key, version: item.version })),
      documents: requirements.documents,
      evidence: requirements.evidence,
      requiredCanonicalFields,
    };
    caseData = await Case.findById(caseData._id);
    caseData.knowledgePlan = {
      status: configurationIssues.length ? "needs_configuration" : "configured",
      ruleSources: [
        ...templates.map((item) => ({ type: "uscis_form_template", id: item._id, version: item.version })),
        ...questionnaires.map((item) => ({ type: "questionnaire", id: item._id, version: item.version })),
      ],
      formAssignments: templates.map((item) => ({
        formTemplateId: item._id,
        formCode: item.formCode,
        formName: item.title,
        editionDate: item.editionDate,
        version: item.version,
        mappingVersion: item.activeMappingVersion || item.mappingVersion || 0,
        validationVersion: item.validationVersion || 0,
        renderingVersion: item.renderingVersion || 0,
      })),
      questionnaireAssignments: questionnaires.map((item) => ({
        questionnaireId: item._id,
        key: item.key,
        title: item.title,
        version: item.version,
      })),
      documentRequirements: requirements.documents,
      evidenceRequirements: requirements.evidence,
      requiredCanonicalFields,
      missingCanonicalFields,
      configurationIssues,
      autoFill,
      generatedAt: new Date(),
      generatedBy: this.userId(user),
      sourceFingerprint: this.fingerprint(planSnapshot),
    };
    caseService.addAuditEntry(caseData, "immigration_knowledge_orchestrated", "Immigration requirements and USCIS forms orchestrated from metadata", user, {
      forms: templates.map((item) => item.formCode),
      questionnaires: questionnaires.map((item) => item.key),
      documents: requirements.documents.map((item) => item.documentType),
      assignedForms: assignedForms.length,
      assignedQuestionnaires: assignedQuestionnaires.length,
      autoFill,
      configurationIssues,
    }, req);
    await caseData.save();
    await caseService.writeAuditLog("immigration_knowledge_orchestrated", caseData, user, caseData.knowledgePlan, req);
    return { case: caseData, knowledgePlan: caseData.knowledgePlan, assignedForms, assignedQuestionnaires, canonicalState, autoFill };
  }

  static async refreshAfterCanonicalSync(caseId, canonicalState, user, req, reason = "canonical_sync") {
    return this.orchestrate(caseId, user, req, { canonicalState, reason });
  }
}

module.exports = ImmigrationKnowledgeEngineService;
