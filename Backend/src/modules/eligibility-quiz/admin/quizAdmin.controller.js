const QuizDefinition = require("../../../models/QuizDefinition");
const ScoringConfig = require("../../../models/ScoringConfig");
const copyLintService = require("../../compliance/copyLint.service");
const auditService = require("../../audit/audit.service");
const entityConfigService = require("../../entity-config/entityConfig.service");

function notFound(message) {
  const error = new Error(message);
  error.status = 404;
  return error;
}

async function lintCopyOrThrow(strings, entityType, req) {
  const combined = strings.filter(Boolean).join("\n");
  if (!combined.trim()) return;
  const result = await copyLintService.scan(combined);
  if (result.severity === "block") {
    await auditService.recordAuditEvent({
      req,
      action: `${entityType}.copylint_blocked`,
      entityType,
      severity: "high",
      status: "blocked",
      metadata: { violations: result.violations },
    });
    const error = new Error("This configuration contains prohibited language and cannot be saved.");
    error.status = 422;
    error.violations = result.violations;
    throw error;
  }
}

async function nextVersion(Model, visaPathway) {
  const latest = await Model.findOne({ visaPathway }).sort({ version: -1 }).select("version");
  return (latest?.version || 0) + 1;
}

// --- ScoringConfig ---

async function listScoringConfigs(req, res, next) {
  try {
    const filter = {};
    if (req.query.visaPathway) filter.visaPathway = req.query.visaPathway;
    const items = await ScoringConfig.find(filter).sort({ visaPathway: 1, version: -1 });
    res.json({ success: true, data: items });
  } catch (error) {
    next(error);
  }
}

async function createScoringConfig(req, res, next) {
  try {
    const payload = req.body || {};
    if (!payload.visaPathway) return res.status(422).json({ success: false, message: "visaPathway is required" });
    await lintCopyOrThrow((payload.tierRules || []).map((r) => r.pathwayString), "ScoringConfig", req);

    const version = await nextVersion(ScoringConfig, payload.visaPathway);
    const config = await ScoringConfig.create({
      ...payload,
      version,
      isActive: false, // new versions never auto-activate — see activateScoringConfig
      createdBy: req.user._id,
    });
    await auditService.recordAuditEvent({ req, action: "scoring_config.create", entityType: "ScoringConfig", entityId: String(config._id), severity: "medium", newValue: config.toObject() });
    res.status(201).json({ success: true, data: config });
  } catch (error) {
    next(error);
  }
}

// Edits a draft (not-yet-activated) version in place. An activated or
// superseded version is immutable — audit history must always reflect what
// was actually live, so those are only ever superseded by a new version,
// never rewritten.
async function updateScoringConfig(req, res, next) {
  try {
    const config = await ScoringConfig.findById(req.params.id);
    if (!config) throw notFound("Scoring config not found");
    if (config.isActive) {
      const error = new Error("Cannot edit an active scoring config — create a new version instead");
      error.status = 409;
      throw error;
    }
    const payload = req.body || {};
    if (payload.tierRules) await lintCopyOrThrow(payload.tierRules.map((r) => r.pathwayString), "ScoringConfig", req);

    ["filingStrengthThreshold", "developableThreshold", "tierRules", "alternativePathways", "criterionWeights"].forEach((field) => {
      if (payload[field] !== undefined) config[field] = payload[field];
    });
    await config.save();
    await auditService.recordAuditEvent({ req, action: "scoring_config.update", entityType: "ScoringConfig", entityId: String(config._id), severity: "medium" });
    res.json({ success: true, data: config });
  } catch (error) {
    next(error);
  }
}

async function activateScoringConfig(req, res, next) {
  try {
    const config = await ScoringConfig.findById(req.params.id);
    if (!config) throw notFound("Scoring config not found");
    await ScoringConfig.updateMany(
      { visaPathway: config.visaPathway, isActive: true, _id: { $ne: config._id } },
      { $set: { isActive: false, effectiveTo: new Date() } }
    );
    config.isActive = true;
    config.effectiveFrom = new Date();
    config.effectiveTo = null;
    await config.save();
    entityConfigService.bustCache();
    await auditService.recordAuditEvent({ req, action: "scoring_config.activate", entityType: "ScoringConfig", entityId: String(config._id), severity: "medium" });
    res.json({ success: true, data: config });
  } catch (error) {
    next(error);
  }
}

// --- QuizDefinition ---

async function listQuizDefinitions(req, res, next) {
  try {
    const filter = {};
    if (req.query.visaPathway) filter.visaPathway = req.query.visaPathway;
    const items = await QuizDefinition.find(filter).sort({ visaPathway: 1, version: -1 });
    res.json({ success: true, data: items });
  } catch (error) {
    next(error);
  }
}

async function createQuizDefinition(req, res, next) {
  try {
    const payload = req.body || {};
    if (!payload.visaPathway) return res.status(422).json({ success: false, message: "visaPathway is required" });
    const copyStrings = [
      ...(payload.profileQuestions || []).map((q) => q.label),
      ...(payload.criteriaQuestions || []).flatMap((q) => [q.label, q.helpText]),
    ];
    await lintCopyOrThrow(copyStrings, "QuizDefinition", req);

    const version = await nextVersion(QuizDefinition, payload.visaPathway);
    const definition = await QuizDefinition.create({
      ...payload,
      version,
      isActive: false,
      createdBy: req.user._id,
    });
    await auditService.recordAuditEvent({ req, action: "quiz_definition.create", entityType: "QuizDefinition", entityId: String(definition._id), severity: "medium", newValue: definition.toObject() });
    res.status(201).json({ success: true, data: definition });
  } catch (error) {
    next(error);
  }
}

async function updateQuizDefinition(req, res, next) {
  try {
    const definition = await QuizDefinition.findById(req.params.id);
    if (!definition) throw notFound("Quiz definition not found");
    if (definition.isActive) {
      const error = new Error("Cannot edit an active quiz definition — create a new version instead");
      error.status = 409;
      throw error;
    }
    const payload = req.body || {};
    const copyStrings = [
      ...(payload.profileQuestions || []).map((q) => q.label),
      ...(payload.criteriaQuestions || []).flatMap((q) => [q.label, q.helpText]),
    ];
    if (copyStrings.length) await lintCopyOrThrow(copyStrings, "QuizDefinition", req);

    ["profileQuestions", "criteriaQuestions"].forEach((field) => {
      if (payload[field] !== undefined) definition[field] = payload[field];
    });
    await definition.save();
    await auditService.recordAuditEvent({ req, action: "quiz_definition.update", entityType: "QuizDefinition", entityId: String(definition._id), severity: "medium" });
    res.json({ success: true, data: definition });
  } catch (error) {
    next(error);
  }
}

async function activateQuizDefinition(req, res, next) {
  try {
    const definition = await QuizDefinition.findById(req.params.id);
    if (!definition) throw notFound("Quiz definition not found");
    await QuizDefinition.updateMany(
      { visaPathway: definition.visaPathway, isActive: true, _id: { $ne: definition._id } },
      { $set: { isActive: false, effectiveTo: new Date() } }
    );
    definition.isActive = true;
    definition.effectiveFrom = new Date();
    definition.effectiveTo = null;
    await definition.save();
    await auditService.recordAuditEvent({ req, action: "quiz_definition.activate", entityType: "QuizDefinition", entityId: String(definition._id), severity: "medium" });
    res.json({ success: true, data: definition });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  listScoringConfigs,
  createScoringConfig,
  updateScoringConfig,
  activateScoringConfig,
  listQuizDefinitions,
  createQuizDefinition,
  updateQuizDefinition,
  activateQuizDefinition,
};
