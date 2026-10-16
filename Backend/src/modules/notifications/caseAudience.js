// "Only the people working a case hear about it." Internal staff (case manager, team lead, admin, super admin) are told about a case
// only when they are on its team - the case's case manager(s) and its team lead (see caseTeam.js). Everyone else on the staff side
// (another team lead, another case manager, any admin or super admin) is skipped for that case's emails, push and in-app notices.
// Clients, employers, employees, petitioners, beneficiaries and attorneys are not covered by this rule.
//
// Fails OPEN: if the database cannot be reached, or anything throws, the notice goes out as before - this check must never be the reason
// a notification or email is lost.
const mongoose = require("mongoose");
const User = require("../../models/User");
const Case = require("../../models/Case");
const { caseTeamIds, CASE_FIELDS } = require("./caseTeam");
const logger = require("../../utils/logger");

const RESTRICTED_ROLES = new Set(["admin", "super_admin", "team_lead", "case_manager"]);
// Assignment notices go to people who are being given - or taken off - the case; they are not "outside" it.
const ASSIGNMENT_TYPE = /assign|remov|transfer|revoke/i;

const normalizeRole = (role) => String(role || "").toLowerCase().replace(/[\s-]+/g, "_");
const exportsApi = {};

exportsApi.dbReady = () => mongoose.connection.readyState === 1;

// True when this staff recipient should NOT be told about this case. { userId | email, caseId }
exportsApi.isOutsideCaseTeam = async function isOutsideCaseTeam({ userId, email, caseId, type } = {}) {
  try {
    if (!caseId || !(userId || email)) return false;
    if (type && ASSIGNMENT_TYPE.test(String(type))) return false;
    if (!exportsApi.dbReady()) return false;
    const user = userId
      ? await User.findById(userId).select("role").lean()
      : await User.findOne({ email: String(email).trim().toLowerCase() }).select("role").lean();
    if (!user || !RESTRICTED_ROLES.has(normalizeRole(user.role))) return false;
    const caseData = await Case.findById(caseId).select(CASE_FIELDS).lean();
    if (!caseData) return false;
    return !(await caseTeamIds(caseData)).has(String(user._id));
  } catch (error) {
    logger.error("case_audience_check_failed", { caseId: String(caseId), error: error.message });
    return false;
  }
};

exportsApi.RESTRICTED_ROLES = RESTRICTED_ROLES;
module.exports = exportsApi;
