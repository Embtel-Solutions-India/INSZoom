// The people offered wherever staff are picked for a case (New case "Assign Staff", the case's Assign Staff / Edit Staff). The server sends every
// active person at the assigner's own level and below (Backend user.service.js assignableStaffRoles: a team lead sees all team leads and case
// managers, an admin also admins, a super admin everyone). Shown case managers first, then team leads, admins, super admins - A-Z in each group -
// with a soft grey role label on the right for everyone who is not a case manager.
export const STAFF_ROLE_ORDER = ['case_manager', 'team_lead', 'admin', 'super_admin']
export const STAFF_ROLE_TAG = { team_lead: 'Team Lead', admin: 'Admin', super_admin: 'Super Admin' }

const nameOf = (person) => (person?.name || person?.displayName || person?.email || '').toLowerCase()
const rankOf = (person) => {
  const index = STAFF_ROLE_ORDER.indexOf(person?.role)
  return index === -1 ? STAFF_ROLE_ORDER.length : index
}

export const sortStaff = (list) => [...(list || [])].sort((a, b) => rankOf(a) - rankOf(b) || nameOf(a).localeCompare(nameOf(b)))

/** { value, label, tag? } for WrappingSelect */
export const staffOption = (person) => ({
  value: person._id,
  label: person.name || person.displayName || person.email,
  ...(STAFF_ROLE_TAG[person.role] ? { tag: STAFF_ROLE_TAG[person.role] } : {}),
})
