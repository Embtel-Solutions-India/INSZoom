const service = require("./employee-profile.service");

async function getEmployeeProfile(req, res, next) {
  try {
    const profile = await service.getEmployeeProfile(req.params.caseId, req.user);
    res.json({ success: true, profile: profile || null });
  } catch (error) {
    next(error);
  }
}

async function upsertEmployeeProfile(req, res, next) {
  try {
    const { fields, source = "questionnaire" } = req.body || {};
    if (!fields || typeof fields !== "object" || Array.isArray(fields) || !Object.keys(fields).length) {
      return res.status(400).json({ success: false, message: "fields object is required and must not be empty" });
    }
    const { profile, applied, conflicted } = await service.upsertEmployeeProfile(
      req.params.caseId, fields, source, req.user
    );
    res.json({ success: true, profile, updatedFields: applied, conflictedFields: conflicted });
  } catch (error) {
    next(error);
  }
}

module.exports = { getEmployeeProfile, upsertEmployeeProfile };
