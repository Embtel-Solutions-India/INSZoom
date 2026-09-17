const mongoose = require("mongoose");
const Case = require("../models/Case");
const caseService = require("../modules/cases/case.service");

// Case-level guard for every /api/attorney/cases/:caseId route. Runs AFTER
// authenticate + authorizeRoles("attorney"), so req.user is already a
// verified attorney — this only answers "does THIS attorney have an active
// grant on THIS case".
//
// Shares one definition of "has access" with case.service.canAccessCase
// (hasActiveAttorneyAccess) rather than re-implementing the check, so a
// route that reuses an existing case controller and a route guarded only by
// this middleware can never disagree about who is allowed in.
async function requireAttorneyAccess(req, res, next) {
  try {
    const caseId = req.params.caseId || req.params.id;
    if (!mongoose.Types.ObjectId.isValid(caseId)) {
      return res.status(400).json({ success: false, message: "Invalid case id" });
    }

    const caseDoc = await Case.findById(caseId).select("+attorneyAccess");
    if (!caseDoc || caseDoc.deletedAt) {
      // Same response as "not granted" on purpose — an attorney probing IDs
      // must not be able to tell an existing case they lack access to apart
      // from one that doesn't exist.
      return res.status(403).json({ success: false, message: "Access denied to this case" });
    }

    if (!caseService.hasActiveAttorneyAccess(caseDoc, req.user._id)) {
      return res.status(403).json({ success: false, message: "Access denied to this case" });
    }

    req.authorizedCase = caseDoc;
    return next();
  } catch (error) {
    return next(error);
  }
}

module.exports = requireAttorneyAccess;
