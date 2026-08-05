const CanonicalProfileService = require("../services/CanonicalProfileService");
const CanonicalValidationService = require("../services/CanonicalValidationService");

function statusOf(error) {
  return error.status || error.statusCode || 500;
}

function handle(res, error) {
  return res.status(statusOf(error)).json({
    success: false,
    message: error.message || "Canonical profile request failed",
    code: error.code,
  });
}

exports.getProfile = async (req, res) => {
  try {
    const profile = await CanonicalProfileService.get(req.params.caseId, req.user, req, { rebuild: req.query.rebuild === "true" });
    res.json({ success: true, profile: profile.profile, canonicalProfile: profile, data: profile });
  } catch (error) {
    handle(res, error);
  }
};

exports.rebuildProfile = async (req, res) => {
  try {
    const profile = await CanonicalProfileService.rebuild(req.params.caseId, req.user, req, { reason: req.body?.reason || "manual_rebuild" });
    res.json({ success: true, profile: profile.profile, canonicalProfile: profile, data: profile });
  } catch (error) {
    handle(res, error);
  }
};

exports.resolveConflict = async (req, res) => {
  try {
    const profile = await CanonicalProfileService.resolveConflict(req.params.caseId, req.body, req.user, req);
    res.json({ success: true, profile: profile.profile, canonicalProfile: profile, data: profile });
  } catch (error) {
    handle(res, error);
  }
};

exports.history = async (req, res) => {
  try {
    const history = await CanonicalProfileService.history(req.params.caseId, req.user);
    res.json({ success: true, history, data: history });
  } catch (error) {
    handle(res, error);
  }
};

exports.validation = async (req, res) => {
  try {
    const profile = await CanonicalProfileService.get(req.params.caseId, req.user, req);
    const validation = profile.validation?.checkedAt ? profile.validation : await CanonicalValidationService.validate(profile);
    res.json({ success: true, validation, data: validation });
  } catch (error) {
    handle(res, error);
  }
};

exports.validateProfile = async (req, res) => {
  try {
    const validation = await CanonicalProfileService.validate(req.params.caseId, req.user, req, req.body || {});
    res.json({ success: true, validation, data: validation });
  } catch (error) {
    handle(res, error);
  }
};

exports.validationSummary = async (req, res) => {
  try {
    const validation = await CanonicalProfileService.validate(req.params.caseId, req.user, req, { reason: "summary_requested" });
    res.json({
      success: true,
      summary: {
        validationStatus: validation.validationStatus,
        readyForForms: validation.readyForForms,
        completeness: validation.completeness,
        readinessScore: validation.readinessScore,
        warnings: validation.warnings,
        errors: validation.errors,
        missingFields: validation.missingFields,
        suggestedFixes: validation.suggestedFixes,
        fieldConflicts: validation.fieldConflicts,
        readiness: validation.readiness,
      },
      data: validation,
    });
  } catch (error) {
    handle(res, error);
  }
};

exports.conflicts = async (req, res) => {
  try {
    const profile = await CanonicalProfileService.get(req.params.caseId, req.user, req);
    const conflicts = (profile.conflicts || []).filter((conflict) => !req.query.status || conflict.status === req.query.status);
    res.json({ success: true, conflicts, data: conflicts });
  } catch (error) {
    handle(res, error);
  }
};

exports.readiness = async (req, res) => {
  try {
    const validation = await CanonicalProfileService.validate(req.params.caseId, req.user, req, { reason: "readiness_requested" });
    res.json({ success: true, readiness: validation.readiness, readinessScore: validation.readinessScore, data: validation.readiness });
  } catch (error) {
    handle(res, error);
  }
};

exports.sources = async (req, res) => {
  try {
    const profile = await CanonicalProfileService.get(req.params.caseId, req.user, req);
    res.json({ success: true, sources: profile.sources || [], fieldMetadata: profile.fieldMetadata || {}, data: { sources: profile.sources || [], fieldMetadata: profile.fieldMetadata || {} } });
  } catch (error) {
    handle(res, error);
  }
};

exports.missingFields = async (req, res) => {
  try {
    const validation = await CanonicalProfileService.validate(req.params.caseId, req.user, req, { reason: "missing_fields_requested" });
    res.json({ success: true, missingFields: validation.missingFields || [], data: validation.missingFields || [] });
  } catch (error) {
    handle(res, error);
  }
};
