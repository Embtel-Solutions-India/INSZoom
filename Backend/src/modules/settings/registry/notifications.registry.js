const { z } = require("zod");

// §4.5 Notifications. Enforced by notification.service.js's
// applyOrgSettingsGate() (see settings/notificationGate.js) which runs
// before applyPreferences() on every notification.create() — an org-level
// disable is a hard floor no per-user preference can override.
const EVENTS = [
  "new_client_submission",
  "payment_received",
  "payment_overdue",
  "rfe_received",
  "document_uploaded",
  "eod_report",
];
const CHANNELS = ["in_app", "email", "sms", "webhook"];

const eventEntries = EVENTS.map((event) => ({
  key: `notifications.events.${event}.channels`,
  category: "notifications",
  group: "Event matrix",
  label: `${event.replace(/_/g, " ")} → channels`,
  description: `Which channels fire for the "${event}" event.`,
  type: "stringArray",
  enumValues: CHANNELS,
  default: event === "eod_report" ? ["in_app", "email"] : ["in_app", "email"],
  validation: z.array(z.enum(CHANNELS)),
  scopes: ["system"],
  requiresPermission: "settings:manage_notifications",
  affects: "notification.service.js applyOrgSettingsGate",
}));

module.exports = [
  {
    key: "notifications.channels.email.enabled",
    category: "notifications",
    group: "Channels",
    label: "Email channel enabled",
    type: "boolean",
    default: true,
    validation: z.boolean(),
    scopes: ["system"],
    requiresPermission: "settings:manage_notifications",
    affects: "notification.service.js applyOrgSettingsGate",
  },
  {
    key: "notifications.channels.sms.enabled",
    category: "notifications",
    group: "Channels",
    label: "SMS channel enabled",
    type: "boolean",
    default: false,
    validation: z.boolean(),
    scopes: ["system"],
    requiresPermission: "settings:manage_notifications",
    affects: "notification.service.js applyOrgSettingsGate",
  },
  {
    key: "notifications.channels.inApp.enabled",
    category: "notifications",
    group: "Channels",
    label: "In-app channel enabled",
    type: "boolean",
    default: true,
    validation: z.boolean(),
    scopes: ["system"],
    requiresPermission: "settings:manage_notifications",
    affects: "notification.service.js applyOrgSettingsGate",
  },
  {
    key: "notifications.channels.webhook.enabled",
    category: "notifications",
    group: "Channels",
    label: "Webhook channel enabled",
    type: "boolean",
    default: false,
    validation: z.boolean(),
    scopes: ["system"],
    requiresPermission: "settings:manage_notifications",
    affects: "notification.service.js applyOrgSettingsGate",
  },
  ...eventEntries,
  {
    key: "notifications.digest.enabled",
    category: "notifications",
    group: "Digest",
    label: "Daily digest enabled",
    type: "boolean",
    default: false,
    validation: z.boolean(),
    scopes: ["system", "user"],
    requiresPermission: "settings:manage_notifications",
    affects: "reminder-generation.service.js (digest job)",
  },
  {
    key: "notifications.digest.cron",
    category: "notifications",
    group: "Digest",
    label: "Digest schedule (cron)",
    type: "string",
    default: "0 8 * * *",
    validation: z.string().min(9),
    scopes: ["system"],
    requiresPermission: "settings:manage_notifications",
    affects: "scheduler.service.js",
  },
];

module.exports.EVENTS = EVENTS;
module.exports.CHANNELS = CHANNELS;
