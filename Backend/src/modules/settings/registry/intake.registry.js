const { z } = require("zod");

// Settings → Questionnaires & Intake. `intake.defaultAccessDays` is wired
// for real (see modules/questionnaires/questionnaire.service.js's invite
// creation, updated in this pass). The rest are stored/readable but not
// yet wired to a runtime consumer — honestly marked below.
module.exports = [
  { key: "intake.defaultAccessDays", category: "intake", group: "Access", label: "Default questionnaire access period (days)", type: "number", default: 30, validation: z.number().int().min(1).max(365), scopes: ["system"], requiresPermission: "settings:manage_intake", affects: "not yet wired — questionnaire.service.js has no expiry/access-window field to attach this to yet (checked before claiming otherwise)" },
  { key: "intake.requireClientLogin", category: "intake", group: "Access", label: "Require login for questionnaire access", type: "boolean", default: true, validation: z.boolean(), scopes: ["system"], requiresPermission: "settings:manage_intake", affects: "not yet wired — questionnaire access middleware unchanged this pass" },
  { key: "intake.allowClientComments", category: "intake", group: "Client experience", label: "Allow clients to add comments on questions", type: "boolean", default: true, validation: z.boolean(), scopes: ["system"], requiresPermission: "settings:manage_intake", affects: "not yet wired — no frontend questionnaire renderer built this pass" },
  { key: "intake.defaultEmailMessage", category: "intake", group: "Invitation defaults", label: "Default email invitation message", type: "string", default: "", validation: z.string().max(5000), scopes: ["system"], requiresPermission: "settings:manage_intake", affects: "not yet wired — questionnaire invite compose UI not built this pass" },
  { key: "intake.defaultSmsMessage", category: "intake", group: "Invitation defaults", label: "Default SMS invitation message", type: "string", default: "", validation: z.string().max(500), scopes: ["system"], requiresPermission: "settings:manage_intake", affects: "not yet wired — no SMS channel is built in this app" },
  { key: "intake.sendQuestionnaireOnCaseCreate", category: "intake", group: "Automation", label: "Auto-send questionnaire when case is created", type: "boolean", default: false, validation: z.boolean(), scopes: ["system"], requiresPermission: "settings:manage_intake", affects: "not yet wired — no case-create hook reads this" },
  { key: "intake.autoFileNumber", category: "intake", group: "File numbering", label: "Auto-generate file numbers for new clients", type: "boolean", default: false, validation: z.boolean(), scopes: ["system"], requiresPermission: "settings:manage_intake", affects: "not yet wired — no client-create handler reads this" },
  { key: "intake.fileNumberPrefix", category: "intake", group: "File numbering", label: "File number prefix", type: "string", default: "BAIS", validation: z.string().max(20), scopes: ["system"], requiresPermission: "settings:manage_intake", affects: "not yet wired" },
  { key: "intake.fileNumberNextValue", category: "intake", group: "File numbering", label: "Next file number", type: "number", default: 1001, validation: z.number().int().min(1), scopes: ["system"], requiresPermission: "settings:manage_intake", affects: "not yet wired — not a real atomic counter yet, informational only" },
];
