const service = require("./employer-profile.service");

async function getEmployerProfile(req, res, next) {
  try {
    const profile = await service.getEmployerProfile(req.params.principalCaseId, req.user);
    // Not finding a profile yet (upsert never called) is a valid state, not
    // an error — the questionnaire simply hasn't been started.
    res.json({ success: true, profile: profile || null });
  } catch (error) {
    next(error);
  }
}

async function upsertEmployerProfile(req, res, next) {
  try {
    const { fields, source = "questionnaire" } = req.body || {};
    if (!fields || typeof fields !== "object" || Array.isArray(fields) || !Object.keys(fields).length) {
      return res.status(400).json({ success: false, message: "fields object is required and must not be empty" });
    }
    const { profile, applied, conflicted } = await service.upsertEmployerProfile(
      req.params.principalCaseId, fields, source, req.user
    );
    res.json({ success: true, profile, updatedFields: applied, conflictedFields: conflicted });
  } catch (error) {
    next(error);
  }
}

module.exports = { getEmployerProfile, upsertEmployerProfile };
