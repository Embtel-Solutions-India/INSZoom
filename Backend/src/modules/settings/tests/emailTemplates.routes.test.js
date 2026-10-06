const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const path = require("node:path");

// Replace auth/permission middleware with pass-throughs BEFORE the router loads.
const stub = (relative, exports) => {
  const resolved = require.resolve(path.join(__dirname, "..", relative));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
};
let permissionsChecked = [];
stub("../../middleware/authenticate", (req, res, next) => { req.user = { _id: "507f1f77bcf86cd799439011", role: req.headers["x-role"] || "admin" }; next(); });
stub("../../middleware/authorizePermissions", (permission) => (req, res, next) => { permissionsChecked.push(permission); next(); });

const express = require("express");
const EmailTemplate = require("../../../models/EmailTemplate");
const SettingsAuditLog = require("../../../models/SettingsAuditLog");
const emailService = require("../../email/email.service");
const router = require("../emailTemplates.routes");

const app = express();
app.use(express.json());
app.use("/email-templates", router);
app.use((err, req, res, next) => res.status(500).json({ success: false, message: err.message }));

let server; let base;
test.before(async () => { server = http.createServer(app); await new Promise((r) => server.listen(0, r)); base = `http://127.0.0.1:${server.address().port}/email-templates`; });
test.after(() => server.close());

const call = async (method, url, body, role) => {
  const res = await fetch(base + url, { method, headers: { "content-type": "application/json", ...(role ? { "x-role": role } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json() };
};

// Minimal in-memory EmailTemplate store.
function fakeStore(t, seed = []) {
  const docs = seed.map((doc, i) => makeDoc({ _id: `id${i + 1}`, managed: true, status: "draft", version: 1, recipients: { to: [], cc: [], bcc: [] }, ...doc }));
  const originals = { find: EmailTemplate.find, findOne: EmailTemplate.findOne, findById: EmailTemplate.findById, create: EmailTemplate.create, audit: SettingsAuditLog.create };
  const matches = (doc, query) => Object.entries(query).every(([k, v]) => (v && v.$ne !== undefined ? String(doc[k]) !== String(v.$ne) : String(doc[k]) === String(v)));
  const lean = (value) => ({ lean: async () => value, sort() { return this; } });
  EmailTemplate.find = (query = {}) => ({ sort() { return this; }, lean: async () => docs.filter((d) => matches(d, query)).map((d) => d.toObject()), then: undefined });
  EmailTemplate.findOne = (query) => { const doc = docs.find((d) => matches(d, query)); return Object.assign(Promise.resolve(doc || null), { lean: async () => (doc ? doc.toObject() : null) }); };
  EmailTemplate.findById = async (id) => docs.find((d) => d._id === id) || null;
  EmailTemplate.create = async (data) => { const doc = makeDoc({ _id: `id${docs.length + 1}`, version: 1, ...data }); docs.push(doc); return doc; };
  SettingsAuditLog.create = async () => ({});
  t.after(() => { EmailTemplate.find = originals.find; EmailTemplate.findOne = originals.findOne; EmailTemplate.findById = originals.findById; EmailTemplate.create = originals.create; SettingsAuditLog.create = originals.audit; });
  return docs;
}
function makeDoc(data) {
  const doc = { ...data, save: async () => doc, deleteOne: async () => {}, toObject: () => { const { save, deleteOne, toObject, ...rest } = doc; return { ...rest }; } };
  return doc;
}

const valid = { managed: true, name: "RFE Notice", subject: "RFE for [case.id]", heading: "Hello [client.name]", body: "<p>Dear [client.name]</p>", triggerKey: "rfe-received", category: "RFE", recipients: { to: [{ type: "client" }], cc: [{ type: "attorney" }], bcc: [] } };

test("customization endpoints require settings:manage_email_templates", async (t) => {
  fakeStore(t);
  permissionsChecked = [];
  await call("GET", "/meta");
  await call("GET", "/library");
  await call("POST", "/preview", { subject: "x", body: "y" });
  assert.deepEqual([...new Set(permissionsChecked)], ["settings:manage_email_templates"]);
  assert.equal(permissionsChecked.length, 3);
});

test("meta exposes the central variable registry, triggers and recipient types", async () => {
  const { body } = await call("GET", "/meta");
  assert.ok(body.data.variables.some((v) => v.key === "client.name"));
  assert.ok(body.data.variableGroups.includes("Case Manager"));
  assert.ok(body.data.triggers.some((tr) => tr.key === "rfe-received"));
  assert.ok(body.data.recipientTypes.some((r) => r.type === "custom"));
  assert.ok(!JSON.stringify(body.data.variables).includes('"path"'));
});

test("preview renders sample data, keeps stored tokens untouched, highlights typos", async () => {
  const { body } = await call("POST", "/preview", { subject: "Case [case.id]", heading: "Hi [client.name]", body: "<p>[client.nmae] and [casemanager.name]</p>", triggerKey: "rfe-received", recipients: { to: [{ type: "client" }], cc: [{ type: "attorney" }], bcc: [{ type: "custom", value: "a@b.co" }] } });
  assert.equal(body.data.subject, "Case CASE-10234");
  assert.match(body.data.html, /Hi John Smith/);
  assert.match(body.data.html, /Sarah Johnson/);
  assert.match(body.data.html, /<mark[^>]*>\[client\.nmae\]<\/mark>/);
  assert.deepEqual(body.data.validation.unknown, ["client.nmae"]);
  assert.deepEqual(body.data.to, ["john.smith@example.com"]);
  assert.deepEqual(body.data.cc, ["david.miller@lawfirm.com"]);
  assert.deepEqual(body.data.bcc, ["a@b.co"]);
});

test("create rejects unknown variables, unavailable variables, bad recipients and locked triggers", async (t) => {
  fakeStore(t);
  let r = await call("POST", "/", { ...valid, subject: "Hi [client.nmae]" });
  assert.equal(r.status, 400); assert.match(r.body.message, /Unknown variable.*client\.nmae/);
  r = await call("POST", "/", { ...valid, triggerKey: "consultation-confirmation", body: "<p>[attorney.name]</p>" });
  assert.equal(r.status, 400); assert.match(r.body.message, /Not available for this trigger.*attorney\.name/);
  r = await call("POST", "/", { ...valid, recipients: { cc: [{ type: "custom", value: "nope" }] } });
  assert.equal(r.status, 400); assert.match(r.body.message, /Invalid custom email/);
  r = await call("POST", "/", { ...valid, triggerKey: "password-reset" });
  assert.equal(r.status, 400); assert.match(r.body.message, /cannot be customized/);
  r = await call("POST", "/", { ...valid, triggerKey: "made-up" });
  assert.equal(r.status, 400);
});

test("create stores a draft with structured recipients and extracted variables", async (t) => {
  const docs = fakeStore(t);
  const { status, body } = await call("POST", "/", valid);
  assert.equal(status, 201);
  assert.equal(body.data.status, "draft");
  assert.equal(docs[0].managed, true);
  assert.deepEqual(docs[0].recipients.cc, [{ type: "attorney" }]);
  assert.deepEqual(docs[0].variables.sort(), ["case.id", "client.name"]);
});

test("activate: needs a trigger + content, and only one active template per trigger", async (t) => {
  fakeStore(t, [
    { name: "A", subject: "s [case.id]", heading: "", body: "<p>x</p>", triggerKey: "rfe-received", status: "active" },
    { name: "B", subject: "s", heading: "", body: "<p>y</p>", triggerKey: "rfe-received", status: "draft" },
    { name: "C", subject: "s", heading: "", body: "<p>y</p>", triggerKey: null, status: "draft" },
  ]);
  let r = await call("POST", "/id2/activate");
  assert.equal(r.status, 409); assert.match(r.body.message, /"A" is already active/);
  r = await call("POST", "/id3/activate");
  assert.equal(r.status, 400); assert.match(r.body.message, /Choose the trigger/);
  r = await call("POST", "/id1/deactivate");
  assert.equal(r.body.data.status, "inactive");
  r = await call("POST", "/id2/activate");
  assert.equal(r.status, 200); assert.equal(r.body.data.status, "active");
});

test("library lists built-ins, hides a built-in once its customization is active, marks locked ones", async (t) => {
  fakeStore(t, [{ name: "Custom RFE", subject: "s", heading: "", body: "<p>x</p>", triggerKey: "rfe-received", status: "active", category: "RFE" }]);
  const { body } = await call("GET", "/library");
  const rfeRows = body.data.filter((row) => row.triggerKey === "rfe-received");
  assert.equal(rfeRows.length, 1);
  assert.equal(rfeRows[0].kind, "custom");
  assert.equal(body.data.find((row) => row.triggerKey === "password-reset").locked, true);
  assert.ok(body.data.some((row) => row.kind === "default" && row.triggerKey === "case-approved"));
});

test("defaults endpoint returns the built-in wording with variables inserted; refuses locked emails", async () => {
  let r = await call("GET", "/defaults/rfe-received");
  assert.equal(r.status, 200);
  assert.match(r.body.data.body, /\[client\.name\]/);
  assert.match(r.body.data.body, /\[case\.rfe_deadline\]/);
  r = await call("GET", "/defaults/password-reset");
  assert.equal(r.status, 403);
  r = await call("GET", "/defaults/nope");
  assert.equal(r.status, 404);
});

test("duplicate creates an inactive draft copy; delete archives instead of removing", async (t) => {
  const docs = fakeStore(t, [{ name: "A", subject: "s", heading: "", body: "<p>x</p>", triggerKey: "rfe-received", status: "active" }]);
  let r = await call("POST", "/id1/duplicate");
  assert.equal(r.status, 201);
  assert.equal(r.body.data.name, "A (Copy)");
  assert.equal(r.body.data.status, "draft");
  r = await call("DELETE", "/id1");
  assert.equal(r.body.data.status, "archived");
  assert.equal(docs.length, 2);
});

test("test email goes only to the typed address with a [TEST] subject, never the case recipients", async (t) => {
  const sent = [];
  const original = emailService.dispatch;
  emailService.dispatch = async (message) => { sent.push(message); return { sent: true }; };
  t.after(() => { emailService.dispatch = original; });
  let r = await call("POST", "/test", { to: "not-an-email", subject: "s", body: "b" });
  assert.equal(r.status, 400);
  r = await call("POST", "/test", { to: "Me@Example.com", subject: "Case [case.id]", heading: "", body: "<p>Hi [client.name]</p>", triggerKey: "rfe-received", recipients: { to: [{ type: "client" }] } });
  assert.equal(r.status, 200);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, "me@example.com");
  assert.equal(sent[0].cc, undefined);
  assert.equal(sent[0].subject, "[TEST] Case CASE-10234");
  assert.match(sent[0].html, /Hi John Smith/);
});

test("legacy (non-managed) template creation is unchanged", async (t) => {
  const docs = fakeStore(t);
  const { status } = await call("POST", "/", { name: "Old", subject: "s", body: "b" });
  assert.equal(status, 201);
  assert.equal(docs[0].managed, undefined);
});

test("RBAC: super admin, admin, team lead and case manager can manage email templates and Settings -> Email; nobody else", () => {
  const { hasPermission } = require("../../authorization/rbac.service");
  for (const role of ["super_admin", "admin", "team_lead", "case_manager"]) {
    assert.equal(hasPermission({ role }, "settings:manage_email_templates"), true, `${role} should manage email templates`);
    assert.equal(hasPermission({ role }, "settings:manage_email"), true, `${role} should manage Settings -> Email`);
  }
  for (const role of ["client", "attorney", "beneficiary"]) {
    assert.equal(hasPermission({ role }, "settings:manage_email_templates"), false);
    assert.equal(hasPermission({ role }, "settings:manage_email"), false);
  }
  // other settings categories stay admin-only
  assert.equal(hasPermission({ role: "case_manager" }, "settings:manage_firm"), false);
  assert.equal(hasPermission({ role: "case_manager" }, "settings:manage_security"), false);
  assert.equal(hasPermission({ role: "team_lead" }, "settings:manage_users"), false);
  assert.equal(hasPermission({ role: "team_lead" }, "settings:manage_invoice"), false);
});

test("legacy Settings-panel templates are reachable by case manager / team lead, but not by roles without settings:manage_email", async (t) => {
  const docs = fakeStore(t, [{ name: "Legacy", subject: "s", body: "b", managed: false, isSystem: false }]);
  let r = await call("GET", "/id1", undefined, "case_manager");
  assert.equal(r.status, 200);
  r = await call("POST", "/", { name: "Old", subject: "s", body: "b" }, "team_lead");
  assert.equal(r.status, 201);
  r = await call("GET", "/id1", undefined, "attorney");
  assert.equal(r.status, 403);
  r = await call("DELETE", "/id1", undefined, "client");
  assert.equal(r.status, 403);
  assert.equal(docs.length, 2);
});

test("library offers only emails that exist, one entry per moment (hidden duplicates and removed emails are not listed)", async (t) => {
  fakeStore(t);
  const lib = await call("GET", "/library");
  const keys = lib.body.data.map((row) => row.triggerKey);
  assert.equal(new Set(keys).size, keys.length);
  assert.ok(lib.body.data.every((row) => row.available !== false && row.audience));
  ["case.ready_for_tl_review:team_lead", "case-on-hold", "questionnaire-assigned", "attorney.assigned:attorney", "documents.requested:client", "lead.created:admin"].forEach((key) => assert.ok(!keys.includes(key), `${key} should not be listed`));
  ["attorney-assignment", "document-requested", "quiz-lead-internal", "questionnaire.assigned:client", "document.rejected:client"].forEach((key) => assert.ok(keys.includes(key), `${key} should be listed`));
  const live = lib.body.data.find((row) => row.triggerKey === "rfe.received:admin");
  assert.equal(live.sendsPush, true);
  assert.equal(live.audience, "admin");
  const meta = await call("GET", "/meta");
  assert.ok(meta.body.data.audiences.some((a) => a.key === "super_admin"));
  assert.ok(!meta.body.data.triggers.some((trigger) => trigger.hidden));
  let r = await call("GET", "/defaults/attorney.assigned:attorney");
  assert.equal(r.status, 404);
  r = await call("POST", "/", { ...valid, triggerKey: "documents.requested:client", subject: "s", body: "<p>x</p>" });
  assert.equal(r.status, 400);
  r = await call("GET", "/defaults/rfe.received:admin");
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.data.recipients.to, [], "event triggers have no To rule - the event decides");
});

test("meta offers real link destinations for email buttons (the recipient's own portal first, tokens for activation/reset)", async () => {
  const { body } = await call("GET", "/meta");
  const presets = body.data.linkPresets;
  assert.equal(presets[0].value, "[system.portal_link]");
  assert.ok(presets.every((preset) => preset.label && preset.text && preset.value));
  assert.ok(presets.some((preset) => /\/accept-invite\?token=\[system\.invite_token\]$/.test(preset.value)));
  assert.ok(presets.some((preset) => /\/reset-password\?token=\[system\.invite_token\]$/.test(preset.value)));
  assert.ok(presets.some((preset) => /\/dashboard\/documents$/.test(preset.value)));
  // every variable used in a preset is a real, registered variable
  const registry = require("../../email/emailVariables.registry");
  presets.forEach((preset) => assert.deepEqual(registry.validateTokens([preset.value], null).unknown, [], preset.value));
});
