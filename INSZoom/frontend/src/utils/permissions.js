import {
  Briefcase,
  CheckCircle,
  DollarSign,
  FileText,
  Inbox,
  LayoutDashboard,
  MessageSquare,
  Scale,
  Settings,
  Users,
} from 'lucide-react'

const ROLE_HIERARCHY = {
  super_admin: 0,
  admin: 1,
  team_lead: 2,
  case_manager: 3,
  client: 4,
}

const ADMIN_PORTAL_ROLES = ['super_admin', 'admin', 'team_lead', 'case_manager']

// Mirrors the backend's authorizeRoles(...) gate on the /eligibility-quiz/leads*
// routes exactly (Backend/src/modules/eligibility-quiz/quiz.routes.js) — no
// team_lead or case_manager there, so it's deliberately narrower than
// ADMIN_PORTAL_ROLES.
const LEADS_ROLES = ['super_admin', 'admin']

export const canAccessAdminPortal = (user) => Boolean(user?.role && ADMIN_PORTAL_ROLES.includes(user.role))

export const isHigherRole = (userRole, targetRole) => ROLE_HIERARCHY[userRole] < ROLE_HIERARCHY[targetRole]

export const canModifyUser = (currentUser, targetUser) => {
  if (currentUser.role === 'super_admin') return true
  if (currentUser.role === 'admin') return targetUser.role !== 'super_admin'
  if (currentUser.role === 'team_lead') return targetUser.role === 'case_manager' && targetUser.teamId === currentUser.teamId
  return false
}

export const canCreateUserRole = (currentUser, targetRole) => {
  if (currentUser.role === 'super_admin') return Object.prototype.hasOwnProperty.call(ROLE_HIERARCHY, targetRole)
  if (currentUser.role === 'admin') return ['admin', 'team_lead', 'case_manager', 'client'].includes(targetRole)
  return false
}

export const canAssignRole = (currentUser, targetRole) => canCreateUserRole(currentUser, targetRole)

export const canAccessDashboard = (user) => {
  if (!canAccessAdminPortal(user)) return false
  return {
    super_admin: 'full',
    admin: 'full',
    team_lead: 'team_view',
    case_manager: 'case_view',
  }[user.role] || false
}

export const canAccessModule = (user, module) => {
  if (!canAccessAdminPortal(user)) return false
  const moduleAccess = {
    dashboard: ADMIN_PORTAL_ROLES,
    leads: LEADS_ROLES,
    cases: ADMIN_PORTAL_ROLES,
    clients: ADMIN_PORTAL_ROLES,
    reports: ADMIN_PORTAL_ROLES,
    settings: ['super_admin', 'admin'],
    companies: ['super_admin', 'admin'],
    payments: ['super_admin', 'admin', 'team_lead'],
    documents: ADMIN_PORTAL_ROLES,
    notifications: ADMIN_PORTAL_ROLES,
    messaging: ADMIN_PORTAL_ROLES,
    questionnaires: ADMIN_PORTAL_ROLES,
    tasks: ADMIN_PORTAL_ROLES,
    'case-managers': ['super_admin', 'admin', 'team_lead'],
    teams: ['super_admin', 'admin', 'team_lead'],
  }
  return moduleAccess[module]?.includes(user.role) || false
}

export const hasPermission = (user, action, resource) => {
  const permissions = {
    'users:create': ['super_admin', 'admin'],
    'users:read': ['super_admin', 'admin', 'team_lead'],
    'users:update': ['super_admin', 'admin', 'team_lead'],
    'users:delete': ['super_admin', 'admin'],
    'users:assign_roles': ['super_admin', 'admin'],
    'users:assign_teams': ['super_admin', 'admin'],
    'cases:create': ['super_admin', 'admin'],
    'cases:read': ADMIN_PORTAL_ROLES,
    'cases:update': ADMIN_PORTAL_ROLES,
    'cases:delete': ['super_admin', 'admin'],
    'cases:assign': ['super_admin', 'admin', 'team_lead'],
    'clients:create': ['super_admin', 'admin', 'team_lead', 'case_manager'],
    'clients:read': ADMIN_PORTAL_ROLES,
    'clients:update': ADMIN_PORTAL_ROLES,
    'clients:delete': ['super_admin', 'admin'],
    'documents:create': ['super_admin', 'admin', 'case_manager'],
    'documents:read': ADMIN_PORTAL_ROLES,
    'documents:update': ADMIN_PORTAL_ROLES,
    'documents:delete': ['super_admin', 'admin'],
    'documents:review': ADMIN_PORTAL_ROLES,
    'companies:create': ['super_admin', 'admin'],
    'companies:read': ['super_admin', 'admin'],
    'companies:update': ['super_admin', 'admin'],
    'companies:delete': ['super_admin', 'admin'],
    'messages:create': ADMIN_PORTAL_ROLES,
    'messages:read': ADMIN_PORTAL_ROLES,
    'messages:update': ['super_admin', 'admin'],
    'messages:delete': ['super_admin', 'admin'],
    'notifications:read': ADMIN_PORTAL_ROLES,
    'notifications:update': ADMIN_PORTAL_ROLES,
    'tasks:create': ADMIN_PORTAL_ROLES,
    'tasks:read': ADMIN_PORTAL_ROLES,
    'tasks:update': ADMIN_PORTAL_ROLES,
    'tasks:delete': ['super_admin', 'admin'],
    'tasks:reassign': ['super_admin', 'admin', 'team_lead'],
    'tasks:comment': ADMIN_PORTAL_ROLES,
  }
  return permissions[`${resource}:${action}`]?.includes(user.role) || false
}

export const getSidebarMenuItems = (user) => {
  if (!canAccessAdminPortal(user)) return []
  const allMenuItems = [
    { path: '/dashboard', icon: LayoutDashboard, label: 'Dashboard', roles: ADMIN_PORTAL_ROLES },
    { path: '/leads', icon: Inbox, label: 'Leads', roles: LEADS_ROLES },
    { path: '/crm-cases', icon: Briefcase, label: 'Cases', roles: ADMIN_PORTAL_ROLES },
    { path: '/tasks', icon: CheckCircle, label: 'Tasks', roles: ADMIN_PORTAL_ROLES },
    { path: '/teams', icon: Users, label: 'Teams', roles: ['super_admin', 'admin', 'team_lead'] },
    { path: '/case-managers', icon: Users, label: 'Case Managers', roles: ['super_admin', 'admin'] },
    { path: '/leaderboard', icon: Scale, label: 'Leaderboard', roles: ['super_admin', 'admin', 'team_lead'] },
    { path: '/messages', icon: MessageSquare, label: 'Messages', roles: ADMIN_PORTAL_ROLES },
    { path: '/eod-reports', icon: FileText, label: 'EOD Reports', roles: ADMIN_PORTAL_ROLES },
    { path: '/payments', icon: DollarSign, label: 'Payments', roles: ['super_admin', 'admin', 'team_lead'] },
    { path: '/documents', icon: FileText, label: 'Documents', roles: ADMIN_PORTAL_ROLES },
    { path: '/questionnaires', icon: FileText, label: 'Questionnaires', roles: ADMIN_PORTAL_ROLES },
    { path: '/settings', icon: Settings, label: 'Settings', roles: ['super_admin', 'admin'] },
    { path: '/analytics', icon: Scale, label: 'Analytics', roles: ['super_admin', 'admin', 'team_lead'] },
  ]
  return allMenuItems.filter((item) => item.roles.includes(user.role))
}

export const getRoleDisplayName = (role) => ({
  super_admin: 'Super Admin',
  admin: 'Admin',
  team_lead: 'Team Lead',
  case_manager: 'Case Manager',
  client: 'Client',
}[role] || role)

export const getAssignableRoles = (currentUser) => {
  const allRoles = ['super_admin', 'admin', 'team_lead', 'case_manager', 'client']
  if (currentUser.role === 'super_admin') return allRoles
  if (currentUser.role === 'admin') return allRoles.filter((role) => role !== 'super_admin')
  return []
}

export const isInternalStaff = (user) => ['super_admin', 'admin', 'team_lead', 'case_manager'].includes(user.role)

export const isExternalUser = (user) => user.role === 'client'
