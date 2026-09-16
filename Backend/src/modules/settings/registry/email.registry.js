const { z } = require("zod");

// Settings → Email & Templates. Actual template CRUD lives in the new
// EmailTemplate model/routes (not settings values) — these are the
// firm-wide email defaults only.
module.exports = [
  { key: "email.fromName", category: "email", group: "Defaults", label: "Sender display name", type: "string", default: "Immiglance", validation: z.string().min(1).max(200), scopes: ["system"], requiresPermission: "settings:manage_email", affects: "not yet wired — email.service.js's From header is not sourced from settings this pass" },
  { key: "email.replyTo", category: "email", group: "Defaults", label: "Reply-to address", type: "string", default: "", validation: z.union([z.literal(""), z.string().email()]), scopes: ["system"], requiresPermission: "settings:manage_email", affects: "not yet wired" },
  { key: "email.includeLogoInEmails", category: "email", group: "Defaults", label: "Include firm logo in email header", type: "boolean", default: true, validation: z.boolean(), scopes: ["system"], requiresPermission: "settings:manage_email", affects: "not yet wired — email.service.js wrapHtml() not updated this pass" },
  { key: "email.signature", category: "email", group: "Defaults", label: "Default email signature", type: "string", default: "", validation: z.string().max(5000), scopes: ["system"], requiresPermission: "settings:manage_email", affects: "not yet wired — email compose UI not built this pass" },
  { key: "email.ccCorpContact", category: "email", group: "Defaults", label: "CC corporation contact on client emails", type: "boolean", default: false, validation: z.boolean(), scopes: ["system"], requiresPermission: "settings:manage_email", affects: "not yet wired" },
  { key: "email.sendCopyToSender", category: "email", group: "Defaults", label: "BCC sender on all outbound", type: "boolean", default: false, validation: z.boolean(), scopes: ["system"], requiresPermission: "settings:manage_email", affects: "not yet wired" },
  { key: "email.authForQuestionnaires", category: "email", group: "Defaults", label: "Require login to access emailed questionnaire links", type: "boolean", default: true, validation: z.boolean(), scopes: ["system"], requiresPermission: "settings:manage_email", affects: "not yet wired" },
];
