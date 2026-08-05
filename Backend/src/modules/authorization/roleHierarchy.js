const CANONICAL_ROLES = [
  "super_admin",
  "admin",
  "team_lead",
  "case_manager",
  "employer",
  "employee",
  "client",
  // Family/sponsor visa (K-1/K-3) invited second party — mirrors "employee"
  // as its own dedicated role, kept separate so a beneficiary is never
  // conflated with an employer-sponsored employee.
  "beneficiary",
];

const LEGACY_ROLES = [];

const ROLE_HIERARCHY = {
  super_admin: 0,
  admin: 1,
  team_lead: 2,
  case_manager: 3,
  employer: 4,
  employee: 4,
  client: 4,
  user: 4,
  beneficiary: 4,
};

function normalizeRole(role) {
  return role === "user" ? "client" : role;
}

function getRoleRank(role) {
  return ROLE_HIERARCHY[role] ?? Number.MAX_SAFE_INTEGER;
}

function isHigherRole(userRole, targetRole) {
  return getRoleRank(userRole) < getRoleRank(targetRole);
}

module.exports = {
  CANONICAL_ROLES,
  LEGACY_ROLES,
  ROLE_HIERARCHY,
  normalizeRole,
  getRoleRank,
  isHigherRole,
};
