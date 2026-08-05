const mongoose = require("mongoose");

function validateCaseId(req, res, next) {
  if (!mongoose.Types.ObjectId.isValid(req.params.caseId)) {
    return res.status(400).json({ success: false, message: "Invalid caseId" });
  }
  next();
}

function validateConflictResolution(req, res, next) {
  const { conflictId, value } = req.body || {};
  if (!conflictId) return res.status(400).json({ success: false, message: "conflictId is required" });
  if (value === undefined) return res.status(400).json({ success: false, message: "value is required" });
  next();
}

module.exports = {
  validateCaseId,
  validateConflictResolution,
};
