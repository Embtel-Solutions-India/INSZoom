const crypto = require("crypto");
const AuditLog = require("../../../models/AuditLog");
const QuestionLibraryItem = require("../../../models/QuestionLibraryItem");
const USCISMappingVersion = require("../../../models/USCISMappingVersion");
const USCISFormTemplate = require("../../../models/USCISFormTemplate");
const CanonicalFieldRegistryService = require("./CanonicalFieldRegistryService");

class MappingGraphService {
  static userId(user) {
    return user?._id || user?.id || null;
  }

  static normalizeText(value = "") {
    return String(value)
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  static loadTemplateOrThrow(templateId) {
    return USCISFormTemplate.findById(templateId);
  }

  static getTemplateFields(template = {}) {
    return (template.formFields || [])
      .map((field, index) => ({
        ...(field.toObject?.() || field),
        targetFieldId: field.fieldId || field.id || field.fieldName || `field_${index + 1}`,
        targetPdfField: field.pdfFieldName || field.fieldName || field.originalName || field.fieldId,
        label: field.label || field.fieldLabel || field.normalizedName || field.fieldName || field.fieldId,
        type: field.fieldType || field.type || field.semanticType || "text",
        section: field.sectionTitle || field.sectionKey || field.sectionId || "general",
        pageNumber: field.pageNumber,
        required: Boolean(field.required || field.validation?.required || field.validationRules?.required),
      }))
      .filter((field) => field.targetFieldId);
  }

  static scoreField(sourceField, targetField) {
    const targetTokens = new Set(CanonicalFieldRegistryService.tokenize([
      targetField.targetFieldId,
      targetField.targetPdfField,
      targetField.label,
      targetField.section,
      targetField.normalizedName,
    ].join(" ")));
    const sourceTokens = new Set(sourceField.tokens || CanonicalFieldRegistryService.tokenize([sourceField.path, ...(sourceField.aliases || [])].join(" ")));
    if (!targetTokens.size || !sourceTokens.size) return 0;

    let overlap = 0;
    sourceTokens.forEach((token) => {
      if (targetTokens.has(token)) overlap += 1;
    });

    const sourceTail = sourceField.path.split(".").pop().replace(/\[\]/g, "").toLowerCase();
    const targetText = this.normalizeText([targetField.targetFieldId, targetField.targetPdfField, targetField.label].join(" "));
    const exactBoost = targetText.includes(this.normalizeText(sourceTail)) ? 0.2 : 0;
    const typeBoost = this.typesCompatible(sourceField.type, targetField.type) ? 0.12 : 0;
    return Math.min(1, overlap / Math.max(sourceTokens.size, targetTokens.size) + exactBoost + typeBoost);
  }

  static typesCompatible(sourceType = "text", targetType = "text") {
    const left = String(sourceType).toLowerCase();
    const right = String(targetType).toLowerCase();
    if (left === right) return true;
    if (left === "boolean" && ["checkbox", "radio", "choice"].some((type) => right.includes(type))) return true;
    if (left === "date" && right.includes("date")) return true;
    if (left === "text" && ["text", "string", "field"].some((type) => right.includes(type))) return true;
    return false;
  }

  static inferMappingType(sourceField, targetField) {
    const targetType = String(targetField.type || "").toLowerCase();
    const targetText = this.normalizeText([targetField.targetFieldId, targetField.label].join(" "));
    if (sourceField.repeatable || /\[\]/.test(sourceField.path)) return "repeating";
    if (targetType.includes("check")) return "checkbox";
    if (targetType.includes("radio")) return "boolean";
    if (sourceField.type === "date" || targetType.includes("date")) return "date";
    if (sourceField.derived) return "calculated";
    if (targetText.includes("full name") || targetText.includes("legal name")) return "concatenated";
    if (["street", "city", "state", "zip", "postal", "address"].some((token) => targetText.includes(token))) return "nested";
    return "direct";
  }

  static inferCondition(sourceField, targetField, template) {
    if (sourceField.condition) return sourceField.condition;
    return targetField.conditionalLogic || targetField.showWhen || undefined;
  }

  static buildEdge(sourceField, targetField, template, confidence) {
    const mappingType = this.inferMappingType(sourceField, targetField);
    const edge = {
      mappingId: `${template.formCode || template.formNumber}:${template.version}:${targetField.targetFieldId}`,
      formCode: template.formCode || template.formNumber,
      editionDate: template.editionDate,
      version: template.version,
      sourcePath: sourceField.path,
      sourceType: "canonical",
      targetFieldId: targetField.targetFieldId,
      targetPdfField: targetField.targetPdfField,
      targetLabel: targetField.label,
      targetType: targetField.type,
      section: targetField.section,
      pageNumber: targetField.pageNumber,
      mappingType,
      confidence,
      status: confidence >= 72 ? "active" : "needs_review",
      transform: this.buildTransform(mappingType, sourceField, targetField),
      condition: this.inferCondition(sourceField, targetField, template),
      repeatable: sourceField.repeatable ? { sourceCollection: sourceField.repeatable, targetGroup: targetField.groupId || targetField.section } : undefined,
      createdAt: new Date(),
    };
    Object.keys(edge).forEach((key) => edge[key] === undefined && delete edge[key]);
    return edge;
  }

  static buildTransform(mappingType, sourceField) {
    if (mappingType === "date") return { type: "date", format: "mm/dd/yyyy" };
    if (mappingType === "checkbox") return { type: "checkbox" };
    if (mappingType === "boolean") return { type: "boolean" };
    if (mappingType === "calculated") return {
      type: sourceField.derived,
      fields: sourceField.components,
    };
    if (mappingType === "concatenated") return {
      type: "concat",
      fields: sourceField.components || [sourceField.path],
      separator: " ",
    };
    if (mappingType === "repeating") return { type: "arrayItem", collection: sourceField.repeatable || sourceField.path.split("[")[0] };
    return { type: "direct" };
  }

  static generateGraph(template, canonicalProfile = {}, options = {}) {
    const sourceFields = CanonicalFieldRegistryService.list(canonicalProfile);
    Object.values(options.exactMappings || {}).forEach((path) => {
      if (path && !sourceFields.some((field) => field.path === path)) {
        sourceFields.push({
          id: `canonical:${path}`,
          path,
          label: path.split(".").pop().replace(/\[\]/g, ""),
          type: "text",
          aliases: [],
          tokens: CanonicalFieldRegistryService.tokenize(path),
        });
      }
    });
    const targetFields = this.getTemplateFields(template);
    const edges = [];
    const usedTargets = new Set();

    targetFields.forEach((targetField) => {
      const exactSourcePath = options.exactMappings?.[targetField.targetFieldId];
      const exactSource = exactSourcePath ? sourceFields.find((sourceField) => sourceField.path === exactSourcePath) : null;
      const best = exactSource
        ? { sourceField: exactSource, score: 1 }
        : sourceFields
          .map((sourceField) => ({ sourceField, score: this.scoreField(sourceField, targetField) }))
          .sort((left, right) => right.score - left.score)[0];
      const threshold = options.threshold ?? 0.34;
      if (best && best.score >= threshold) {
        edges.push(this.buildEdge(best.sourceField, targetField, template, Math.round(best.score * 100)));
        usedTargets.add(targetField.targetFieldId);
      }
    });

    const graph = {
      templateId: String(template._id || ""),
      formCode: template.formCode || template.formNumber,
      formName: template.formName || template.title,
      editionDate: template.editionDate,
      version: template.version,
      generatedAt: new Date(),
      nodes: {
        canonical: sourceFields.map((field) => ({ id: field.id, path: field.path, label: field.label, type: field.type, repeatable: field.repeatable })),
        form: targetFields.map((field) => ({
          id: `form:${field.targetFieldId}`,
          fieldId: field.targetFieldId,
          pdfField: field.targetPdfField,
          label: field.label,
          type: field.type,
          section: field.section,
          pageNumber: field.pageNumber,
          required: field.required,
        })),
      },
      edges,
      unmappedTargets: targetFields.filter((field) => !usedTargets.has(field.targetFieldId)).map((field) => field.targetFieldId),
      summary: {
        sourceFields: sourceFields.length,
        formFields: targetFields.length,
        mappedFields: edges.length,
        activeMappings: edges.filter((edge) => edge.status === "active").length,
        reviewRequired: edges.filter((edge) => edge.status === "needs_review").length,
        mappingCoverage: targetFields.length ? Math.round((edges.length / targetFields.length) * 100) : 100,
      },
    };
    graph.validation = this.validateGraph(graph, template);
    return graph;
  }

  static validateGraph(graph = {}, template = {}) {
    const errors = [];
    const warnings = [];
    const sourcePaths = new Set((graph.nodes?.canonical || []).map((node) => node.path));
    const targetIds = new Set((graph.nodes?.form || this.getTemplateFields(template)).map((node) => node.fieldId || node.targetFieldId));
    const targetCounts = {};

    (graph.edges || []).forEach((edge) => {
      targetCounts[edge.targetFieldId] = (targetCounts[edge.targetFieldId] || 0) + 1;
      if (!edge.sourcePath || !sourcePaths.has(edge.sourcePath)) errors.push({ code: "INVALID_SOURCE", mappingId: edge.mappingId, sourcePath: edge.sourcePath });
      if (!edge.targetFieldId || !targetIds.has(edge.targetFieldId)) errors.push({ code: "INVALID_TARGET", mappingId: edge.mappingId, targetFieldId: edge.targetFieldId });
      if (!edge.mappingType) errors.push({ code: "BROKEN_MAPPING", mappingId: edge.mappingId, reason: "Missing mapping type" });
      if (edge.mappingType === "repeating" && !edge.repeatable?.sourceCollection) errors.push({ code: "BROKEN_REPEATING_MAPPING", mappingId: edge.mappingId });
      if (edge.status === "needs_review") warnings.push({ code: "LOW_CONFIDENCE_MAPPING", mappingId: edge.mappingId, confidence: edge.confidence });
    });

    Object.entries(targetCounts)
      .filter(([, count]) => count > 1)
      .forEach(([targetFieldId]) => errors.push({ code: "DUPLICATE_TARGET_MAPPING", targetFieldId }));

    (template.formFields || [])
      .forEach((field) => {
        const fieldId = field.fieldId || field.id || field.fieldName;
        if (!targetCounts[fieldId]) warnings.push({
          code: field.required || field.validation?.required || field.validationRules?.required
            ? "MISSING_REQUIRED_MAPPING"
            : "MISSING_FIELD_MAPPING",
          targetFieldId: fieldId,
        });
      });

    const reviewRequired = (graph.edges || []).filter((edge) => edge.status !== "active").length;
    const unmapped = (graph.unmappedTargets || []).length;
    return {
      valid: errors.length === 0,
      readyForActivation: errors.length === 0 && reviewRequired === 0 && unmapped === 0,
      errors,
      warnings,
      summary: {
        errors: errors.length,
        warnings: warnings.length,
        reviewRequired,
        unmapped,
      },
    };
  }

  static graphToFieldMappings(graph = {}) {
    const byTarget = new Map();
    (graph.edges || []).forEach((edge) => {
      if (!byTarget.has(edge.targetFieldId)) byTarget.set(edge.targetFieldId, []);
      byTarget.get(edge.targetFieldId).push({
        source: "canonical",
        path: edge.sourcePath,
        sourceField: edge.sourcePath,
        mappingType: edge.mappingType,
        transform: edge.transform,
        condition: edge.condition,
        confidence: edge.confidence,
        status: edge.status,
        mappingId: edge.mappingId,
      });
    });
    return byTarget;
  }

  static applyGraphToTemplate(template, graph) {
    const mappingsByTarget = this.graphToFieldMappings(graph);
    template.formFields = (template.formFields || []).map((field) => {
      const plain = field.toObject?.() || field;
      const fieldId = plain.fieldId || plain.id || plain.fieldName;
      const mappings = mappingsByTarget.get(fieldId) || plain.mappings || [];
      return {
        ...plain,
        mappings,
      };
    });
    template.mappingGraph = graph;
    template.mappingStatus = graph.validation?.readyForActivation ? "draft" : "needs_review";
    template.mappingVersion = Number(template.mappingVersion || 0) + 1;
    graph.mappingVersion = template.mappingVersion;
    template.mappingAuditHistory = [
      ...(template.mappingAuditHistory || []),
      {
        action: template.mappingVersion > 1 ? "MAPPING_UPDATED" : "MAPPING_CREATED",
        performedAt: new Date(),
        summary: graph.summary,
        validation: graph.validation?.summary,
      },
    ];
    return template;
  }

  static graphChecksum(graph) {
    return crypto.createHash("sha256").update(JSON.stringify(graph)).digest("hex");
  }

  static async exactMappingsForTemplate(templateId) {
    const items = await QuestionLibraryItem.find({
      "sources.formTemplate": templateId,
      canonicalPath: { $exists: true, $nin: [null, ""] },
      active: true,
    }).select("canonicalPath sources review.status").lean();
    const mappings = {};
    items
      .sort((left, right) => (left.review?.status === "approved" ? -1 : 1) - (right.review?.status === "approved" ? -1 : 1))
      .forEach((item) => {
        item.sources
          .filter((source) => String(source.formTemplate) === String(templateId))
          .forEach((source) => {
            if (!mappings[source.fieldId]) mappings[source.fieldId] = item.canonicalPath;
          });
      });
    return mappings;
  }

  static async persistVersion(template, graph, user) {
    this.applyGraphToTemplate(template, graph);
    const status = graph.validation?.readyForActivation ? "draft" : "needs_review";
    const version = await USCISMappingVersion.create({
      template: template._id,
      formCode: template.formCode || template.formNumber,
      formVersion: template.version,
      editionDate: template.editionDate,
      mappingVersion: template.mappingVersion,
      checksum: this.graphChecksum(graph),
      graph,
      status,
      validation: graph.validation,
      createdBy: this.userId(user),
    });
    template.latestMappingVersionId = version._id;
    await template.save();
    return version;
  }

  static async audit(action, template, user, req, changes = {}) {
    await AuditLog.create({
      userId: this.userId(user),
      userRole: user?.role,
      action,
      entityType: "USCISFormTemplate",
      entityId: template?._id ? String(template._id) : undefined,
      changes,
      ipAddress: req?.ip,
      userAgent: req?.headers?.["user-agent"],
      source: "api",
    }).catch(() => null);
  }

  static async generate(templateId, payload = {}, user, req) {
    const template = await this.loadTemplateOrThrow(templateId);
    if (!template) {
      const error = new Error("USCIS form template not found");
      error.status = 404;
      throw error;
    }
    const exactMappings = await this.exactMappingsForTemplate(template._id);
    const graph = this.generateGraph(template, payload.canonicalProfile || {}, {
      ...(payload.options || {}),
      exactMappings: { ...exactMappings, ...(payload.exactMappings || {}) },
    });
    if (payload.persist) {
      const previousVersion = Number(template.mappingVersion || 0);
      const version = await this.persistVersion(template, graph, user);
      await this.audit(previousVersion ? "MAPPING_UPDATED" : "MAPPING_CREATED", template, user, req, {
        mappingVersion: template.mappingVersion,
        mappingVersionId: version._id,
        summary: graph.summary,
      });
    }
    return { templateId: template._id, graph };
  }

  static async validate(templateId, payload = {}) {
    const template = await USCISFormTemplate.findById(templateId).lean();
    if (!template) {
      const error = new Error("USCIS form template not found");
      error.status = 404;
      throw error;
    }
    const graph = payload.graph || template.mappingGraph || this.generateGraph(template, payload.canonicalProfile || {}, payload.options || {});
    return { templateId, validation: this.validateGraph(graph, template), graphSummary: graph.summary };
  }

  static async preview(templateId) {
    const template = await USCISFormTemplate.findById(templateId).lean();
    if (!template) {
      const error = new Error("USCIS form template not found");
      error.status = 404;
      throw error;
    }
    const graph = template.mappingGraph?.edges ? template.mappingGraph : this.generateGraph(template);
    return {
      template: {
        id: template._id,
        formCode: template.formCode,
        formName: template.formName || template.title,
        editionDate: template.editionDate,
        version: template.version,
        mappingVersion: template.mappingVersion,
        mappingStatus: template.mappingStatus,
      },
      graph,
    };
  }

  static async search(templateId, query = {}) {
    const { graph } = await this.preview(templateId);
    const term = this.normalizeText(query.q || query.search || "");
    const edges = (graph.edges || []).filter((edge) => {
      if (!term) return true;
      return this.normalizeText([edge.sourcePath, edge.targetFieldId, edge.targetPdfField, edge.targetLabel, edge.section, edge.mappingType].join(" ")).includes(term);
    });
    return { results: edges, count: edges.length };
  }

  static compareGraphs(leftGraph = {}, rightGraph = {}) {
    const leftByTarget = new Map((leftGraph.edges || []).map((edge) => [edge.targetFieldId, edge]));
    const rightByTarget = new Map((rightGraph.edges || []).map((edge) => [edge.targetFieldId, edge]));
    const added = [];
    const removed = [];
    const modified = [];

    rightByTarget.forEach((right, target) => {
      const left = leftByTarget.get(target);
      if (!left) added.push(right);
      else if (left.sourcePath !== right.sourcePath || left.mappingType !== right.mappingType || JSON.stringify(left.condition || {}) !== JSON.stringify(right.condition || {})) {
        modified.push({ targetFieldId: target, before: left, after: right });
      }
    });
    leftByTarget.forEach((left, target) => {
      if (!rightByTarget.has(target)) removed.push(left);
    });
    return { added, removed, modified, summary: { added: added.length, removed: removed.length, modified: modified.length } };
  }

  static async compare(templateId, otherTemplateId) {
    const [left, right] = await Promise.all([
      USCISFormTemplate.findById(templateId).lean(),
      USCISFormTemplate.findById(otherTemplateId).lean(),
    ]);
    if (!left || !right) {
      const error = new Error("Both USCIS form templates are required for comparison");
      error.status = 404;
      throw error;
    }
    const leftGraph = left.mappingGraph?.edges ? left.mappingGraph : this.generateGraph(left);
    const rightGraph = right.mappingGraph?.edges ? right.mappingGraph : this.generateGraph(right);
    return {
      left: { templateId: left._id, formCode: left.formCode, version: left.version, editionDate: left.editionDate },
      right: { templateId: right._id, formCode: right.formCode, version: right.version, editionDate: right.editionDate },
      diff: this.compareGraphs(leftGraph, rightGraph),
    };
  }

  static async deleteMapping(templateId, mappingId, user, req) {
    const template = await this.loadTemplateOrThrow(templateId);
    if (!template) {
      const error = new Error("USCIS form template not found");
      error.status = 404;
      throw error;
    }
    const graph = template.mappingGraph || { edges: [] };
    const previousCount = graph.edges?.length || 0;
    graph.edges = (graph.edges || []).filter((edge) => edge.mappingId !== mappingId);
    graph.summary = { ...(graph.summary || {}), mappedFields: graph.edges.length };
    graph.validation = this.validateGraph(graph, template);
    const version = await this.persistVersion(template, graph, user);
    template.mappingAuditHistory.push({ action: "MAPPING_DELETED", performedAt: new Date(), mappingId, mappingVersionId: version._id });
    await template.save();
    await this.audit("MAPPING_DELETED", template, user, req, { mappingId, previousCount, currentCount: graph.edges.length });
    return { templateId, mappingId, deleted: previousCount !== graph.edges.length, mappingVersionId: version._id, graph };
  }

  static async upsertMapping(templateId, payload, user, req) {
    const template = await this.loadTemplateOrThrow(templateId);
    if (!template) throw Object.assign(new Error("USCIS form template not found"), { status: 404 });
    const targetField = this.getTemplateFields(template).find((field) => field.targetFieldId === payload.targetFieldId);
    if (!targetField) throw Object.assign(new Error("USCIS target field not found"), { status: 404 });
    const sourcePath = String(payload.sourcePath || "").trim();
    if (!sourcePath) throw Object.assign(new Error("Master Case Data sourcePath is required"), { status: 400 });
    const librarySource = await QuestionLibraryItem.exists({ canonicalPath: sourcePath, active: true });
    const registrySource = CanonicalFieldRegistryService.list().find((field) => field.path === sourcePath);
    if (!librarySource && !registrySource) throw Object.assign(new Error("Unknown Master Case Data sourcePath"), { status: 422 });

    const graph = template.mappingGraph?.nodes
      ? JSON.parse(JSON.stringify(template.mappingGraph))
      : this.generateGraph(template);
    graph.nodes = graph.nodes || { canonical: [], form: [] };
    if (!graph.nodes.canonical.some((node) => node.path === sourcePath)) {
      graph.nodes.canonical.push({ id: `canonical:${sourcePath}`, path: sourcePath, type: payload.sourceType || "text" });
    }
    const mappingId = payload.mappingId || `${template.formCode}:${template.version}:${targetField.targetFieldId}`;
    const edge = {
      mappingId,
      formCode: template.formCode,
      editionDate: template.editionDate,
      version: template.version,
      sourcePath,
      sourceType: "canonical",
      targetFieldId: targetField.targetFieldId,
      targetPdfField: targetField.targetPdfField,
      targetLabel: targetField.label,
      targetType: targetField.type,
      section: targetField.section,
      pageNumber: targetField.pageNumber,
      mappingType: payload.mappingType || "direct",
      transform: payload.transform || { type: payload.mappingType || "direct" },
      condition: payload.condition,
      repeatable: payload.repeatable,
      confidence: Number(payload.confidence ?? 100),
      status: payload.status || "active",
      updatedAt: new Date(),
    };
    graph.edges = (graph.edges || []).filter((item) => item.targetFieldId !== targetField.targetFieldId);
    graph.edges.push(edge);
    graph.unmappedTargets = this.getTemplateFields(template)
      .filter((field) => !graph.edges.some((item) => item.targetFieldId === field.targetFieldId))
      .map((field) => field.targetFieldId);
    graph.summary = {
      ...(graph.summary || {}),
      formFields: this.getTemplateFields(template).length,
      mappedFields: graph.edges.length,
      activeMappings: graph.edges.filter((item) => item.status === "active").length,
      reviewRequired: graph.edges.filter((item) => item.status !== "active").length,
      mappingCoverage: this.getTemplateFields(template).length
        ? Math.round((graph.edges.length / this.getTemplateFields(template).length) * 100)
        : 100,
    };
    graph.validation = this.validateGraph(graph, template);
    const version = await this.persistVersion(template, graph, user);
    await this.audit("MAPPING_UPDATED", template, user, req, { mappingId, mappingVersion: template.mappingVersion, targetFieldId: payload.targetFieldId, sourcePath });
    return { templateId, mappingVersionId: version._id, mappingVersion: template.mappingVersion, edge, graph };
  }

  static async versions(templateId) {
    const versions = await USCISMappingVersion.find({ template: templateId }).sort({ mappingVersion: -1 }).lean();
    return { templateId, versions, count: versions.length };
  }

  static async activate(templateId, user, req) {
    const template = await this.loadTemplateOrThrow(templateId);
    if (!template) {
      const error = new Error("USCIS form template not found");
      error.status = 404;
      throw error;
    }
    const validation = this.validateGraph(template.mappingGraph || {}, template);
    if (!validation.readyForActivation) {
      const error = new Error("Cannot activate mapping until every USCIS field has an approved Master Case Data mapping");
      error.status = 422;
      error.details = validation;
      throw error;
    }
    const mappingVersion = await USCISMappingVersion.findOne({
      template: template._id,
      mappingVersion: template.mappingVersion,
    });
    if (!mappingVersion) throw Object.assign(new Error("Persisted mapping version not found"), { status: 409 });
    await USCISMappingVersion.updateMany({ template: template._id, status: "active" }, { $set: { status: "retired", retiredAt: new Date() } });
    mappingVersion.status = "active";
    mappingVersion.activatedBy = this.userId(user);
    mappingVersion.activatedAt = new Date();
    await mappingVersion.save();
    template.mappingStatus = "active";
    template.activeMappingVersion = mappingVersion.mappingVersion;
    template.activeMappingVersionId = mappingVersion._id;
    template.mappingAuditHistory = [...(template.mappingAuditHistory || []), { action: "MAPPING_VERSION_ACTIVATED", performedAt: new Date(), version: template.mappingVersion }];
    await template.save();
    await this.audit("MAPPING_VERSION_ACTIVATED", template, user, req, { mappingVersion: template.mappingVersion });
    return { templateId, mappingStatus: template.mappingStatus, mappingVersion: template.mappingVersion, mappingVersionId: mappingVersion._id };
  }
}

module.exports = MappingGraphService;
