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
  // I-864 joint sponsor - a third party distinct from the petitioner,
  // invited the same self-service way "beneficiary" already is. Kept
  // separate so a joint sponsor's own financial checklist is never
  // conflated with the petitioner's.
  "joint_sponsor",
  // External counsel with portal access scoped to whichever cases a Case
  // Manager/Admin has explicitly granted (Case.attorneyAccess[]) — see
  // Attorney/PHASE0_FINDINGS.md. Not a staff role (no authority over
  // other accounts, no case creation/assignment) and not a client-portal
  // role (different app, different data shape) — its own peer entry.
  "attorney",
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
  joint_sponsor: 4,
  attorney: 4,
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
