const PERMISSIONS = {
  users: ["create", "read", "update", "delete", "assign_roles"],
  cases: ["create", "read", "update", "delete", "assign", "review"],
  clients: ["create", "read", "update", "delete"],
  beneficiaries: ["create", "read", "update", "delete"],
  companies: ["create", "read", "update", "delete"],
  documents: ["create", "read", "update", "delete", "review"],
  document_intelligence: ["create", "read", "update", "review"],
  messages: ["create", "read", "update", "delete"],
  notifications: ["create", "read", "update", "delete"],
  payments: ["create", "read", "update", "delete", "report"],
  billing: ["create", "read", "update", "delete", "report", "reconcile"],
  dashboard: ["create", "read", "update", "delete", "export"],
  analytics: ["read", "export", "schedule"],
  reports: ["create", "read", "update", "delete", "export", "schedule", "review"],
  search: ["create", "read", "update", "delete"],
  teams: ["create", "read", "update", "delete"],
  tasks: ["create", "read", "update", "delete"],
  appointments: ["create", "read", "update", "delete"],
  calendar: ["create", "read", "update", "delete", "sync", "manage_resources"],
  workflows: ["create", "read", "update", "delete"],
  questionnaires: ["create", "read", "update", "delete", "publish", "assign", "submit", "review"],
  forms: ["create", "read", "update", "delete", "approve", "check_updates"],
  ai: ["create", "read", "update", "review"],
  audit: ["read", "export"],
  // "read"/"update" are the original whole-document settings CRUD (kept for
  // backward compat — modules/settings/settings.controller.js). The
  // settings-engine (modules/settings/settingsEngine.*) introduces one
  // fine-grained action per settings category, matching the enterprise
  // settings platform's permission model 1:1 (settings.security.manage,
  // etc. in the spec) but expressed in this repo's existing
  // "resource:action" convention rather than a parallel dot-notation system.
  settings: [
    "read", "update",
    "view", "audit_view",
    "manage_general", "manage_security", "manage_roles", "manage_data",
    "manage_notifications", "manage_integrations", "manage_ai",
    "manage_branding", "manage_workflow", "manage_modules", "view_billing",
    // Settings Overhaul pass — new category actions (firm/users/portal/
    // intake/email/invoice), additive alongside the ones above (manage_roles
    // is reused unchanged; roles.permissionOverrides just moved files, see
    // settings/registry/users.registry.js).
    "manage_firm", "manage_users", "manage_portal", "manage_intake",
    "manage_email", "manage_invoice",
  ],
  // Phase 0 — Foundation & Compliance layer.
  entity_config: ["read", "update"],
  compliance: ["read", "lint", "accept"],
  data_rights: ["create", "read", "approve", "reject", "export"],
  telemetry: ["track", "read"],
  // Phase 1 — Public Lead Generation & Eligibility Quiz Engine.
  leads: ["read", "update"],
  eligibility_quiz: ["read", "update", "admin"],
  consultation_routing: ["read", "update"],
  // Attorney <-> Case Manager case-scoped dialogue (see models/Feedback.js).
  // Distinct from "messages" (client-facing messaging) — kept separate so
  // granting one never accidentally grants the other.
  feedback: ["create", "read", "update"],
};

const ROLE_PERMISSIONS = {
  super_admin: ["*"],
  admin: ["users:*", "cases:*", "clients:*", "beneficiaries:*", "companies:*", "documents:*", "document_intelligence:*", "messages:*", "notifications:*", "payments:*", "billing:*", "dashboard:*", "analytics:*", "reports:*", "search:*", "teams:*", "tasks:*", "appointments:*", "calendar:*", "workflows:*", "questionnaires:*", "forms:*", "ai:*", "audit:*", "settings:*", "entity_config:*", "compliance:*", "data_rights:*", "telemetry:*", "leads:*", "eligibility_quiz:*", "consultation_routing:*", "feedback:*"],
  case_manager: ["users:read", "cases:read", "cases:create", "cases:update", "clients:create", "clients:read", "clients:update", "beneficiaries:create", "beneficiaries:read", "beneficiaries:update", "companies:read", "documents:*", "document_intelligence:*", "messages:*", "notifications:*", "appointments:*", "calendar:*", "dashboard:read", "analytics:read", "reports:create", "reports:read", "reports:update", "search:*", "tasks:*", "forms:read", "forms:create", "forms:update", "forms:approve", "workflows:read", "workflows:create", "workflows:update", "questionnaires:*", "ai:create", "ai:read", "ai:review", "compliance:lint", "telemetry:read", "consultation_routing:read", "consultation_routing:update", "settings:view", "feedback:*"],
  // cases:update / companies:update: a "client" account is how most
  // employer-sponsored cases are actually driven (selected "employer" during
  // intake rather than holding a distinct "employer" account type — see
  // Immiglance's resolveApplicableChecklistRoles), so it needs the same
  // case/company-management permissions "employer" has. Ownership is still
  // enforced per-case in employment-workflow.controller.js's
  // canAccessEmployerCase, not by this role-level grant alone.
  client: ["cases:create", "cases:read", "cases:update", "clients:read", "clients:update", "beneficiaries:read", "beneficiaries:update", "companies:update", "documents:create", "documents:read", "documents:delete", "document_intelligence:create", "document_intelligence:read", "messages:create", "messages:read", "messages:update", "notifications:read", "notifications:update", "notifications:delete", "payments:read", "payments:create", "appointments:create", "appointments:read", "appointments:update", "calendar:read", "dashboard:read", "search:create", "search:read", "search:update", "search:delete", "questionnaires:read", "questionnaires:update", "questionnaires:submit", "forms:read", "ai:create", "ai:read", "data_rights:create"],
  employee: ["cases:read", "clients:read", "clients:update", "beneficiaries:read", "beneficiaries:update", "documents:create", "documents:read", "documents:delete", "document_intelligence:create", "document_intelligence:read", "messages:create", "messages:read", "messages:update", "notifications:read", "notifications:update", "notifications:delete", "appointments:create", "appointments:read", "appointments:update", "calendar:read", "dashboard:read", "questionnaires:read", "questionnaires:update", "questionnaires:submit", "forms:read"],
  // The family-workflow (K-1/K-3) structural analog of "employee" — an
  // invited second party who completes only their own section of a
  // two-party case. Mirrors employee's permission set exactly; this role
  // previously had no ROLE_PERMISSIONS entry at all, so every
  // permission-gated route (not just questionnaires) 403'd for it.
  beneficiary: ["cases:read", "clients:read", "clients:update", "beneficiaries:read", "beneficiaries:update", "documents:create", "documents:read", "documents:delete", "document_intelligence:create", "document_intelligence:read", "messages:create", "messages:read", "messages:update", "notifications:read", "notifications:update", "notifications:delete", "appointments:create", "appointments:read", "appointments:update", "calendar:read", "dashboard:read", "questionnaires:read", "questionnaires:update", "questionnaires:submit", "forms:read"],
  employer: ["cases:create", "cases:read", "cases:update", "beneficiaries:create", "beneficiaries:read", "companies:read", "companies:update", "documents:create", "documents:read", "documents:delete", "messages:create", "messages:read", "messages:update", "notifications:read", "notifications:update", "notifications:delete", "appointments:create", "appointments:read", "appointments:update", "calendar:read", "dashboard:read", "questionnaires:read", "questionnaires:update", "questionnaires:submit", "forms:read"],
  team_lead: ["users:read", "cases:*", "clients:create", "clients:read", "clients:update", "beneficiaries:create", "beneficiaries:read", "beneficiaries:update", "companies:read", "documents:*", "document_intelligence:*", "messages:*", "notifications:*", "payments:read", "payments:update", "billing:read", "billing:report", "dashboard:*", "analytics:*", "reports:*", "search:*", "teams:*", "tasks:*", "appointments:*", "calendar:*", "workflows:read", "workflows:create", "workflows:update", "questionnaires:*", "forms:read", "forms:create", "forms:update", "forms:approve", "ai:create", "ai:read", "ai:review", "compliance:lint", "leads:read", "consultation_routing:read", "consultation_routing:update", "settings:view", "settings:manage_workflow", "settings:manage_notifications", "feedback:*"],
  // External counsel. Read-only on everything case-related, and only for
  // cases explicitly granted via Case.attorneyAccess[] — this role-level
  // grant is necessary but NOT sufficient: every attorney route also runs
  // middleware/requireAttorneyAccess.js, which checks that specific case.
  // No cases:create/update, no users:*, no billing/payments, no settings —
  // matches the Attorney Portal spec's "Out of Scope" list exactly.
  // tasks:create — an attorney can create their OWN task/reminder on a
  // case (e.g. "review the I-129 draft by Friday"); resolveAssignment
  // (task.controller.js) rejects (403) any non-admin/team_lead caller who
  // requests an assignee other than themselves — they can never assign
  // work to someone else. No tasks:delete. No reports:*/eod —
  // EOD reports are an internal
  // staff productivity log (EODReport.role enum doesn't even include
  // "attorney") unrelated to case work, deliberately not exposed here.
  // No "messages:*" — that resource is the client-inclusive Conversation
  // system (modules/messages); an attorney must never share a thread with a
  // client. "feedback:*" is the attorney's actual communication channel
  // (staff-only by construction — see models/Feedback.js), surfaced in the
  // portal both as the top-level "Messages" hub and a case-scoped
  // "Feedback" tab — same backend, two entry points. No "questionnaires:*"
  // — a client-intake artifact, not case-review material; not a page this
  // role needs.
  attorney: ["cases:read", "clients:read", "beneficiaries:read", "companies:read", "documents:read", "documents:create", "document_intelligence:read", "notifications:read", "notifications:update", "notifications:delete", "dashboard:read", "forms:read", "feedback:create", "feedback:read", "feedback:update", "tasks:read", "tasks:create", "tasks:update"],
};

function expandPermission(resource, action) {
  return `${resource}:${action}`;
}

module.exports = { PERMISSIONS, ROLE_PERMISSIONS, expandPermission };
