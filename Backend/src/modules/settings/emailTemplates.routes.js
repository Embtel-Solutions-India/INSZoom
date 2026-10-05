const router = require("express").Router();
const { body } = require("express-validator");
const authenticate = require("../../middleware/authenticate");
const authorizePermissions = require("../../middleware/authorizePermissions");
const validate = require("../../middleware/validate");
const EmailTemplate = require("../../models/EmailTemplate");
const SettingsAuditLog = require("../../models/SettingsAuditLog");
const emailService = require("../email/email.service");
const customization = require("../email/emailCustomization.service");
const registry = require("../email/emailVariables.registry");
const triggerRegistry = require("../email/emailTriggers.registry");
const { renderCustom, previewShells } = require("../email/emailRenderer");

router.use(authenticate);

// Two kinds of rows share this router:
//  - legacy catalog rows (managed:false) - the original Settings -> Email &
//    Templates panel; behaviour below is unchanged.
//  - managed rows (managed:true) - created through the Email Template
//    Customization page; each customizes one built-in email (its triggerKey)
//    and, while active, replaces that email's content/recipients at send time
//    (see modules/email/email.service.js resolveCustomization()).
const PERMISSION = "settings:manage_email";
const CONTENT_FIELDS = ["name", "description", "category", "subject", "heading", "body", "triggerKey", "recipients"];

const cleanRules = (list) => (Array.isArray(list) ? list : [])
  .filter((rule) => rule && typeof rule.type === "string")
  .map((rule) => ({ type: rule.type, ...(rule.type === "custom" ? { value: String(rule.value || "").trim() } : {}) }));
const cleanRecipients = (recipients = {}) => ({ to: cleanRules(recipients.to), cc: cleanRules(recipients.cc), bcc: cleanRules(recipients.bcc) });

async function audit(req, templateId, previousValue, newValue) {
  await SettingsAuditLog.create({
    key: `email_template:${templateId}`, category: "email", scope: "system",
    previousValue, newValue, changedBy: req.user._id, changedByRole: req.user.role,
    ip: req.ip, userAgent: req.headers?.["user-agent"], action: "set",
  }).catch(() => null);
}

const snapshot = (template) => template && ({
  name: template.name, status: template.status, triggerKey: template.triggerKey, subject: template.subject,
  heading: template.heading, body: template.body, recipients: template.recipients, version: template.version,
});

// Returns an error message (string) or null.
function contentError(fields, { requireComplete = false } = {}) {
  const trigger = fields.triggerKey ? triggerRegistry.getTrigger(fields.triggerKey) : null;
  if (fields.triggerKey && !trigger) return `Unknown trigger "${fields.triggerKey}"`;
  if (trigger?.locked) return `"${trigger.label}" is a security email and cannot be customized`;
  if (requireComplete) {
    if (!fields.triggerKey) return "Choose the trigger this email is sent for before activating";
    if (!String(fields.subject || "").trim() || !String(fields.body || "").replace(/<[^>]*>/g, "").trim()) return "Subject and body are required to activate a template";
  }
  const validation = customization.validateContent(fields);
  if (validation.errors.length) return validation.errors.join(". ");
  const recipientErrors = customization.validateRecipients(fields.recipients);
  return recipientErrors.length ? recipientErrors.join(". ") : null;
}

const defaultTo = (trigger) => (trigger?.recipient === "team_member" ? "case_manager" : trigger?.recipient || "client");

// Static metadata for the editor: variable registry, triggers, categories,
// recipient types. One call so the UI never keeps its own copy.
router.get("/meta", authorizePermissions(PERMISSION), (req, res) => {
  res.json({
    success: true,
    data: {
      variableGroups: registry.GROUPS,
      variables: registry.listVariables(),
      triggers: triggerRegistry.TRIGGERS,
      categories: triggerRegistry.CATEGORIES,
      recipientTypes: triggerRegistry.RECIPIENT_TYPES,
      fromName: process.env.EMAIL_FROM_NAME || "Immiglance",
      previewShells: previewShells(),
    },
  });
});

// Library = every built-in email (so any of them can be customized) plus
// every admin-created template. A built-in's row is hidden once an active
// customization replaces it, so the library never shows two "live" rows.
router.get("/library", authorizePermissions(PERMISSION), async (req, res, next) => {
  try {
    const managed = await EmailTemplate.find({ managed: true }).sort({ updatedAt: -1 }).lean();
    const activeKeys = new Set(managed.filter((t) => t.status === "active").map((t) => t.triggerKey));
    const rows = managed.map((t) => {
      const trigger = triggerRegistry.getTrigger(t.triggerKey);
      return {
        id: String(t._id), kind: "custom", name: t.name, category: t.category, status: t.status,
        triggerKey: t.triggerKey, triggerLabel: trigger?.label || null, recipient: trigger?.recipient || null,
        locked: false, updatedAt: t.updatedAt, description: t.description,
      };
    });
    triggerRegistry.TRIGGERS.forEach((trigger) => {
      if (activeKeys.has(trigger.key)) return;
      rows.push({
        id: null, kind: "default", name: trigger.label, category: trigger.category, status: "default",
        triggerKey: trigger.key, triggerLabel: trigger.label, recipient: trigger.recipient,
        locked: trigger.locked, updatedAt: null, description: trigger.description,
      });
    });
    res.json({ success: true, data: rows });
  } catch (error) { next(error); }
});

// Editable starting point for a built-in email: its own wording with the
// [variables] already inserted.
router.get("/defaults/:triggerKey", authorizePermissions(PERMISSION), (req, res) => {
  const trigger = triggerRegistry.getTrigger(req.params.triggerKey);
  if (!trigger) return res.status(404).json({ success: false, message: "Unknown email trigger" });
  if (trigger.locked) return res.status(403).json({ success: false, message: `"${trigger.label}" is a security email and cannot be customized` });
  const content = customization.defaultContentFor(trigger.key, emailService.TEMPLATES);
  res.json({
    success: true,
    data: {
      name: trigger.label, description: trigger.description, category: trigger.category, triggerKey: trigger.key,
      ...content, recipients: { to: [{ type: defaultTo(trigger) }], cc: [], bcc: [] },
    },
  });
});

function previewRecipients(fields) {
  const types = triggerRegistry.RECIPIENT_TYPES;
  const sampleFor = (rule) => {
    if (rule.type !== "custom") return types.find((entry) => entry.type === rule.type)?.sample;
    const variableKey = registry.emailVariableKey(rule.value);
    return variableKey ? registry.getVariable(variableKey).sample : rule.value;
  };
  const recipients = cleanRecipients(fields.recipients);
  let to = recipients.to.map(sampleFor).filter(Boolean);
  if (!to.length) {
    const trigger = triggerRegistry.getTrigger(fields.triggerKey);
    to = [types.find((entry) => entry.type === defaultTo(trigger))?.sample || "john.smith@example.com"];
  }
  return { to, cc: recipients.cc.map(sampleFor).filter(Boolean), bcc: recipients.bcc.map(sampleFor).filter(Boolean) };
}

// Live preview - the SAME renderCustom() the real send path uses, fed sample data.
router.post("/preview", authorizePermissions(PERMISSION), (req, res) => {
  const fields = { subject: String(req.body.subject || ""), heading: String(req.body.heading || ""), body: String(req.body.body || ""), triggerKey: req.body.triggerKey || null, recipients: req.body.recipients };
  const rendered = renderCustom(fields, {}, { mode: "sample", highlightUnknown: true });
  const validation = customization.validateContent(fields);
  res.json({
    success: true,
    data: { from: process.env.EMAIL_FROM_NAME || "Immiglance", ...previewRecipients(fields), subject: rendered.subject, html: rendered.html, text: rendered.text, validation },
  });
});

// Test send: ONLY to the address typed in, with sample data. Never resolves
// the template's real recipient rules, so it cannot reach real case contacts.
router.post("/test", authorizePermissions(PERMISSION), [body("to").isEmail().withMessage("Enter a valid test email address")], validate, async (req, res, next) => {
  try {
    const fields = { subject: String(req.body.subject || ""), heading: String(req.body.heading || ""), body: String(req.body.body || ""), triggerKey: req.body.triggerKey || null };
    if (!fields.subject.trim() || !fields.body.trim()) return res.status(400).json({ success: false, message: "Add a subject and body before sending a test" });
    const validation = customization.validateContent(fields);
    if (validation.errors.length) return res.status(400).json({ success: false, message: validation.errors.join(". ") });
    const rendered = renderCustom(fields, {}, { mode: "sample" });
    const result = await emailService.dispatch({
      templateKey: "custom-test", to: String(req.body.to).trim().toLowerCase(), subject: `[TEST] ${rendered.subject}`,
      html: rendered.html, text: rendered.text, data: { test: true, triggerKey: fields.triggerKey }, triggeredBy: req.user._id, source: "Admin",
    });
    if (result.skipped) return res.status(503).json({ success: false, message: "Email is not configured on this server, so the test was not sent" });
    if (!result.sent) return res.status(502).json({ success: false, message: `Test email failed: ${result.error?.message || "unknown error"}` });
    res.json({ success: true, message: `Test email sent to ${req.body.to}` });
  } catch (error) { next(error); }
});

router.get("/", authorizePermissions(PERMISSION), async (req, res, next) => {
  try {
    const templates = await EmailTemplate.find({}).sort({ updatedAt: -1 });
    res.json({ success: true, data: templates });
  } catch (error) { next(error); }
});

router.post(
  "/",
  authorizePermissions(PERMISSION),
  [body("name").trim().notEmpty(), body("subject").trim().notEmpty(), body("body").trim().notEmpty()],
  validate,
  async (req, res, next) => {
    try {
      if (req.body.managed) {
        const fields = { ...Object.fromEntries(CONTENT_FIELDS.map((key) => [key, req.body[key]])), recipients: cleanRecipients(req.body.recipients) };
        const problem = contentError(fields);
        if (problem) return res.status(400).json({ success: false, message: problem });
        const template = await EmailTemplate.create({
          ...fields, category: fields.category || "General", description: fields.description || "", heading: fields.heading || "",
          managed: true, status: "draft", variables: registry.extractTokens([fields.subject, fields.heading, fields.body].join("\n")),
          createdBy: req.user._id, updatedBy: req.user._id,
        });
        customization.invalidateCache();
        await audit(req, template._id, null, snapshot(template));
        return res.status(201).json({ success: true, data: template });
      }
      const template = await EmailTemplate.create({
        name: req.body.name, subject: req.body.subject, body: req.body.body,
        category: req.body.category || "general", tags: req.body.tags || [],
        createdBy: req.user._id,
      });
      res.status(201).json({ success: true, data: template });
    } catch (error) { next(error); }
  }
);

router.get("/:id", authorizePermissions(PERMISSION), async (req, res, next) => {
  try {
    const template = await EmailTemplate.findById(req.params.id);
    if (!template) return res.status(404).json({ success: false, message: "Template not found" });
    res.json({ success: true, data: template });
  } catch (error) { next(error); }
});

router.patch("/:id", authorizePermissions(PERMISSION), async (req, res, next) => {
  try {
    const template = await EmailTemplate.findById(req.params.id);
    if (!template) return res.status(404).json({ success: false, message: "Template not found" });
    if (template.managed) {
      const before = snapshot(template);
      const fields = {
        ...Object.fromEntries(CONTENT_FIELDS.map((key) => [key, req.body[key] !== undefined ? req.body[key] : template[key]])),
        recipients: req.body.recipients !== undefined ? cleanRecipients(req.body.recipients) : template.recipients,
      };
      const problem = contentError(fields, { requireComplete: template.status === "active" });
      if (problem) return res.status(400).json({ success: false, message: problem });
      if (template.status === "active" && fields.triggerKey !== template.triggerKey) {
        return res.status(409).json({ success: false, message: "Deactivate this template before moving it to a different trigger" });
      }
      CONTENT_FIELDS.forEach((key) => { template[key] = fields[key] ?? template[key]; });
      template.variables = registry.extractTokens([fields.subject, fields.heading, fields.body].join("\n"));
      template.updatedBy = req.user._id;
      template.version = (template.version || 1) + 1;
      await template.save();
      customization.invalidateCache();
      await audit(req, template._id, before, snapshot(template));
      return res.json({ success: true, data: template });
    }
    if (template.isSystem) {
      // System templates: only subject may be edited, never the body — the
      // rest of the app's transactional logic assumes the core body shape.
      if (req.body.subject) template.subject = req.body.subject;
    } else {
      if (req.body.name) template.name = req.body.name;
      if (req.body.subject) template.subject = req.body.subject;
      if (req.body.body) template.body = req.body.body;
      if (req.body.category) template.category = req.body.category;
      if (req.body.tags) template.tags = req.body.tags;
    }
    await template.save();
    res.json({ success: true, data: template });
  } catch (error) { next(error); }
});

async function setStatus(req, res, next, status) {
  try {
    const template = await EmailTemplate.findOne({ _id: req.params.id, managed: true });
    if (!template) return res.status(404).json({ success: false, message: "Template not found" });
    if (status === "active") {
      const problem = contentError(template, { requireComplete: true });
      if (problem) return res.status(400).json({ success: false, message: problem });
      const clash = await EmailTemplate.findOne({ managed: true, status: "active", triggerKey: template.triggerKey, _id: { $ne: template._id } });
      if (clash) return res.status(409).json({ success: false, message: `"${clash.name}" is already active for this trigger. Deactivate it first.` });
    }
    const before = snapshot(template);
    template.status = status;
    template.updatedBy = req.user._id;
    await template.save();
    customization.invalidateCache();
    await audit(req, template._id, before, snapshot(template));
    res.json({ success: true, data: template });
  } catch (error) { next(error); }
}
router.post("/:id/activate", authorizePermissions(PERMISSION), (req, res, next) => setStatus(req, res, next, "active"));
router.post("/:id/deactivate", authorizePermissions(PERMISSION), (req, res, next) => setStatus(req, res, next, "inactive"));

router.post("/:id/duplicate", authorizePermissions(PERMISSION), async (req, res, next) => {
  try {
    const source = await EmailTemplate.findOne({ _id: req.params.id, managed: true }).lean();
    if (!source) return res.status(404).json({ success: false, message: "Template not found" });
    const copy = await EmailTemplate.create({
      name: `${source.name} (Copy)`, description: source.description, category: source.category, subject: source.subject,
      heading: source.heading, body: source.body, triggerKey: source.triggerKey, recipients: source.recipients,
      variables: source.variables, managed: true, status: "draft", createdBy: req.user._id, updatedBy: req.user._id,
    });
    await audit(req, copy._id, null, snapshot(copy));
    res.status(201).json({ success: true, data: copy });
  } catch (error) { next(error); }
});

router.delete("/:id", authorizePermissions(PERMISSION), async (req, res, next) => {
  try {
    const template = await EmailTemplate.findById(req.params.id);
    if (!template) return res.status(404).json({ success: false, message: "Template not found" });
    if (template.managed) {
      // Customizations are archived, never hard-deleted - the built-in email
      // they replaced simply resumes being sent, and history stays auditable.
      const before = snapshot(template);
      template.status = "archived";
      template.updatedBy = req.user._id;
      await template.save();
      customization.invalidateCache();
      await audit(req, template._id, before, snapshot(template));
      return res.json({ success: true, data: template });
    }
    if (template.isSystem) return res.status(403).json({ success: false, message: "System templates cannot be deleted" });
    await template.deleteOne();
    res.json({ success: true });
  } catch (error) { next(error); }
});

module.exports = router;
