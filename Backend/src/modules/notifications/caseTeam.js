// Who on the internal team works a case, and so the ONLY internal people told about it (emails, push, in-app): its assigned case
// manager(s) and its team lead. No other team lead, case manager, admin or super admin hears about that case.
//
// The team lead is the one on the case (Case.assignedTeamLead). A team lead who creates a case is set as its team lead on creation
// (case.service.js resolveTeamLeadForCase), so the creator is the one told. A case with NO team lead (created by an admin without
// naming one, GoHighLevel, older cases) has the default team lead - teamlead@immiglance.com (DEFAULT_TEAM_LEAD_EMAIL) - as its team
// lead here too, without waiting for the case to be updated. Only if the case has none, the creator counts when they are a team lead.
const mongoose = require("mongoose");
const User = require("../../models/User");
const env = require("../../config/env");
const { allCaseManagerIds } = require("../cases/caseManagerAccess");

const idOf = (value) => String(value?._id || value || "");
const roleOf = (user) => String(user?.role || "").toLowerCase().replace(/[\s-]+/g, "_");

// Everything the helpers below read from a Case.
const CASE_FIELDS = "assignedCaseManager additionalCaseManagers primaryOwner assignedTeamLead createdBy";

// The default team lead's user id (active team lead with DEFAULT_TEAM_LEAD_EMAIL), or "" when that account does not exist.
async function defaultTeamLeadId() {
  if (mongoose.connection.readyState !== 1) return "";
  const email = String(env.defaultTeamLeadEmail || "").trim().toLowerCase();
  if (!email) return "";
  const user = await User.findOne({ email, role: "team_lead", isActive: { $ne: false } }).select("_id").lean();
  return user ? idOf(user) : "";
}

// The team lead of a case: its own, else (when the creator is a team lead) the creator, else the default team lead. "" if none exist.
async function effectiveTeamLeadId(caseData) {
  const own = idOf(caseData?.assignedTeamLead);
  if (own) return own;
  if (mongoose.connection.readyState !== 1) return ""; // no database to look the fallbacks up in
  const creatorId = idOf(caseData?.createdBy);
  if (creatorId) {
    const creator = await User.findOne({ _id: creatorId, role: "team_lead", isActive: { $ne: false } }).select("_id").lean();
    if (creator) return creatorId;
  }
  return defaultTeamLeadId();
}

function caseManagerIdsOf(caseData) {
  const ids = allCaseManagerIds(caseData);
  if (!ids.length && caseData?.primaryOwner) ids.push(idOf(caseData.primaryOwner));
  return ids;
}

// Ids (strings) of everyone on the case's internal team: case manager(s) + team lead.
async function caseTeamIds(caseData) {
  const ids = new Set(caseManagerIdsOf(caseData));
  const lead = await effectiveTeamLeadId(caseData);
  if (lead) ids.add(lead);
  return ids;
}

// Returns [{ user: { _id, name, displayName, email, role }, kind: "case_manager" | "team_lead" }], de-duplicated, active users with an
// email only. Never throws.
async function resolveCaseTeam(caseData) {
  try {
    if (!caseData) return [];
    const managerIds = caseManagerIdsOf(caseData);
    const teamLeadId = await effectiveTeamLeadId(caseData);
    const ids = [...new Set([...managerIds, teamLeadId].filter(Boolean))];
    if (!ids.length) return [];

    const users = await User.find({ _id: { $in: ids } }).select("name displayName email role isActive").lean();
    const byId = new Map(users.map((user) => [idOf(user), user]));
    const usable = (user, roles) => Boolean(user && user.isActive !== false && user.email && roles.includes(roleOf(user)));

    const members = [];
    const taken = new Set();
    const add = (user, kind) => {
      if (!user || taken.has(idOf(user))) return;
      taken.add(idOf(user));
      members.push({ user, kind });
    };
    managerIds.forEach((id) => { const user = byId.get(id); if (usable(user, ["case_manager", "team_lead"])) add(user, "case_manager"); });
    const lead = byId.get(teamLeadId);
    if (usable(lead, ["team_lead"])) add(lead, "team_lead");
    return members;
  } catch {
    return [];
  }
}

module.exports = { resolveCaseTeam, caseTeamIds, effectiveTeamLeadId, defaultTeamLeadId, CASE_FIELDS };
