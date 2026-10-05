const test = require("node:test");
const assert = require("node:assert/strict");

const registry = require("../emailVariables.registry");
const triggers = require("../emailTriggers.registry");
const { renderCustom, sanitizeEmailHtml, layoutHtml } = require("../emailRenderer");
const customization = require("../emailCustomization.service");
const emailService = require("../email.service");
const EmailLog = require("../../../models/EmailLog");
const { getProvider } = require("../providers");

test("every built-in email key has trigger metadata and vice versa", () => {
  const codeKeys = Object.keys(emailService.TEMPLATES).sort();
  const triggerKeys = triggers.TRIGGERS.map((t) => t.key).sort();
  assert.deepEqual(triggerKeys, codeKeys);
  triggers.TRIGGERS.forEach((t) => assert.ok(triggers.CATEGORIES.includes(t.category), `${t.key} has unknown category ${t.category}`));
});

test("variable registry: keys unique, tokens extracted, typos flagged", () => {
  const keys = registry.VARIABLES.map((v) => v.key);
  assert.equal(new Set(keys).size, keys.length);
  assert.deepEqual(registry.extractTokens("Hi [client.name], case [case.id] [client.name]"), ["client.name", "case.id"]);
  const result = registry.validateTokens(["Hi [client.nmae] and [case.id]"], null);
  assert.deepEqual(result.unknown, ["client.nmae"]);
  assert.equal(result.valid, false);
});

test("variables outside a trigger's groups are reported unavailable; System always allowed", () => {
  const result = registry.validateTokens(["[attorney.name] [system.firm_name] [client.name]"], ["Client", "Case"]);
  assert.deepEqual(result.unavailable, ["attorney.name"]);
  assert.deepEqual(result.unknown, []);
});

test("sample mode substitutes sample data; live mode uses call-site data then fallback, never throws", () => {
  const sample = registry.substitute("Hello [client.name], [case.id]", {}, { mode: "sample" });
  assert.equal(sample, "Hello John Smith, CASE-10234");
  const live = registry.substitute("Hello [client.name], [case.id], [attorney.name]", { data: { clientName: "Ana", caseNumber: "B1" } });
  assert.equal(live, "Hello Ana, B1, your attorney");
  assert.equal(registry.substitute("x [client.name]", undefined), "x there");
});

test("live values are HTML-escaped; unknown tokens are left as-is", () => {
  const out = registry.substitute("<b>[client.name]</b> [bogus.thing]", { data: { clientName: "<script>x</script>" } });
  assert.equal(out, "<b>&lt;script&gt;x&lt;/script&gt;</b> [bogus.thing]");
});

test("renderCustom: stored template keeps tokens, rendered output has values, script stripped", () => {
  const template = { subject: "Update on [case.id]", heading: "Hello [client.name]", body: '<p onclick="x()">Case [case.id]</p><script>alert(1)</script><a href="javascript:alert(1)">bad</a>' };
  const out = renderCustom(template, {}, { mode: "sample" });
  assert.equal(out.subject, "Update on CASE-10234");
  assert.match(out.html, /Hello John Smith/);
  assert.match(out.html, /Case CASE-10234/);
  assert.doesNotMatch(out.html, /<script|onclick|javascript:/i);
  assert.match(template.body, /\[case\.id\]/);
  assert.match(out.text, /Case CASE-10234/);
});

test("sanitizeEmailHtml keeps normal formatting", () => {
  const html = '<p><strong>Hi</strong> <em>there</em></p><ul><li>a</li></ul><a href="https://x.test">go</a>';
  assert.equal(sanitizeEmailHtml(html), html);
});

test("built-in wrapHtml output equals layoutHtml with the subject as heading (no regression)", () => {
  const lines = ["Hello", "World"];
  const paragraphs = lines.map((line) => `<p style="margin:0 0 16px;color:#374151;font-size:15px;line-height:1.7;">${line}</p>`).join("");
  assert.equal(emailService.wrapHtml("Subj", lines), layoutHtml({ title: "Subj", heading: "Subj", innerHtml: paragraphs }));
});

test("every unlocked built-in email converts to editable content whose tokens are all valid", () => {
  triggers.TRIGGERS.filter((t) => !t.locked).forEach((trigger) => {
    const content = customization.defaultContentFor(trigger.key, emailService.TEMPLATES);
    assert.ok(content && content.subject && content.body, `${trigger.key} produced no content`);
    const check = registry.validateTokens([content.subject, content.heading, content.body], null);
    assert.deepEqual(check.unknown, [], `${trigger.key} has unknown tokens ${check.unknown}`);
    // And it must render without throwing in both modes.
    renderCustom(content, {}, { mode: "sample" });
    renderCustom(content, { data: {} }, { mode: "live" });
  });
});

test("preview shell (used by the browser's instant preview) reproduces renderCustom output exactly", () => {
  const { previewShells } = require("../emailRenderer");
  const shells = previewShells();
  const template = { subject: "Re: [case.id]", heading: "Hi [client.name]", body: "<p>Hello [client.name] & co</p>" };
  const expected = renderCustom(template, {}, { mode: "sample" });
  const sample = (text, escape) => registry.substitute(text, {}, { mode: "sample", escape });
  const html = shells.withHeading
    .split(shells.tokens.title).join(registry.escapeHtml(sample(template.subject, false)))
    .split(shells.tokens.heading).join(sample(template.heading, true))
    .split(shells.tokens.body).join(sample(sanitizeEmailHtml(template.body), true));
  assert.equal(html, expected.html);
  const noHeading = renderCustom({ ...template, heading: "" }, {}, { mode: "sample" });
  assert.equal(shells.withoutHeading.split(shells.tokens.title).join(registry.escapeHtml(noHeading.subject)).split(shells.tokens.body).join(sample(sanitizeEmailHtml(template.body), true)), noHeading.html);
});

test("recipient fields accept email variables like [client.email]; non-email variables are rejected", async () => {
  assert.deepEqual(customization.validateRecipients({ to: [{ type: "custom", value: "[client.email]" }] }), []);
  assert.equal(customization.validateRecipients({ to: [{ type: "custom", value: "[client.name]" }] }).length, 1);
  const ctx = { caseContext: { client: { email: "c@x.com" }, attorney: { email: "att@x.com" } }, data: {} };
  const out = await customization.applyRecipientRules(
    { recipients: { to: [{ type: "custom", value: "[client.email]" }], cc: [{ type: "custom", value: "[attorney.email]" }, { type: "custom", value: "[teamlead.email]" }] } },
    "fallback@x.com", ctx,
  );
  assert.deepEqual(out, { to: ["c@x.com"], cc: ["att@x.com"], bcc: [] });
});

test("recipient validation rejects unknown types and bad custom addresses", () => {
  assert.deepEqual(customization.validateRecipients({ to: [{ type: "client" }], cc: [{ type: "custom", value: "a@b.co" }] }), []);
  assert.equal(customization.validateRecipients({ to: [{ type: "nobody" }] }).length, 1);
  assert.equal(customization.validateRecipients({ bcc: [{ type: "custom", value: "not-an-email" }] }).length, 1);
});

test("recipient rules: CC/BCC resolved from the case context, deduped, bad To rule falls back to call-site To", async () => {
  const ctx = { caseContext: { client: { email: "c@x.com" }, caseManager: { email: "cm@x.com" }, attorney: { email: "att@x.com" } } };
  const out = await customization.applyRecipientRules(
    { recipients: { to: [{ type: "client" }, { type: "case_manager" }], cc: [{ type: "attorney" }, { type: "client" }], bcc: [{ type: "custom", value: "Boss@X.com" }] } },
    "fallback@x.com", ctx,
  );
  assert.deepEqual(out, { to: ["c@x.com", "cm@x.com"], cc: ["att@x.com"], bcc: ["boss@x.com"] });
  const fallback = await customization.applyRecipientRules({ recipients: { to: [{ type: "attorney" }] } }, "Fallback@x.com", { caseContext: {} });
  assert.deepEqual(fallback.to, ["fallback@x.com"]);
});

// ── send path ───────────────────────────────────────────────────────────
function stubSend(t) {
  const sent = [];
  const logs = [];
  const provider = getProvider();
  const original = { send: provider.send, isConfigured: provider.isConfigured, create: EmailLog.create };
  provider.send = async (message) => { sent.push(message); return { messageId: "m1" }; };
  provider.isConfigured = () => true;
  EmailLog.create = async (doc) => { const log = { ...doc, save: async () => log }; logs.push(log); return log; };
  t.after(() => { provider.send = original.send; provider.isConfigured = original.isConfigured; EmailLog.create = original.create; });
  return { sent, logs };
}

test("no active customization -> built-in email is sent unchanged", async (t) => {
  const { sent } = stubSend(t);
  const original = customization.findActive;
  customization.findActive = async () => null;
  t.after(() => { customization.findActive = original; });
  await emailService.sendTemplateEmail("case-created-client", { to: "client@x.com", data: { clientName: "Ana", caseNumber: "B1" } });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, "client@x.com");
  assert.match(sent[0].subject, /Your immigration case has been created — B1/);
  assert.equal(sent[0].bcc, undefined);
});

test("active customization overrides content and adds CC/BCC", async (t) => {
  const { sent, logs } = stubSend(t);
  const originalFind = customization.findActive;
  const originalCtx = customization.buildContext;
  customization.findActive = async () => ({
    _id: "t1", subject: "Hi [client.name] - [case.id]", heading: "Case [case.id]", body: "<p>Dear [client.name]</p>",
    recipients: { to: [], cc: [{ type: "attorney" }], bcc: [{ type: "custom", value: "audit@x.com" }] },
  });
  customization.buildContext = async ({ data }) => ({ data, caseContext: { attorney: { email: "att@x.com" } } });
  t.after(() => { customization.findActive = originalFind; customization.buildContext = originalCtx; });
  await emailService.sendTemplateEmail("case-created-client", { to: "client@x.com", data: { clientName: "Ana", caseNumber: "B1" } });
  assert.equal(sent[0].subject, "Hi Ana - B1");
  assert.match(sent[0].html, /<p>Dear Ana<\/p>/);
  assert.equal(sent[0].to, "client@x.com");
  assert.deepEqual(sent[0].cc, ["att@x.com"]);
  assert.deepEqual(sent[0].bcc, ["audit@x.com"]);
  assert.equal(logs[0].templateKey, "case-created-client");
});

test("customization failure falls back to the built-in email and still sends", async (t) => {
  const { sent } = stubSend(t);
  const original = customization.findActive;
  customization.findActive = async () => { throw new Error("db down"); };
  t.after(() => { customization.findActive = original; });
  const result = await emailService.sendTemplateEmail("case-created-client", { to: "client@x.com", data: { clientName: "Ana", caseNumber: "B1" } });
  assert.equal(result.sent, true);
  assert.match(sent[0].subject, /B1/);
});

test("locked security emails are never customized", async (t) => {
  const { sent } = stubSend(t);
  const original = customization.findActive;
  let asked = false;
  customization.findActive = async () => { asked = true; return { subject: "HACKED", body: "x", recipients: {} }; };
  t.after(() => { customization.findActive = original; });
  await emailService.sendTemplateEmail("password-reset", { to: "u@x.com", data: { token: "abc" } });
  assert.equal(asked, false);
  assert.doesNotMatch(sent[0].subject, /HACKED/);
});

test("an edit to the active template is used by the very next real send (no caching); only status:active rows are ever queried", async (t) => {
  const { sent } = stubSend(t);
  const EmailTemplate = require("../../../models/EmailTemplate");
  const originalFindOne = EmailTemplate.findOne;
  const queries = [];
  let stored = { _id: "t1", subject: "Version one for [case.id]", heading: "", body: "<p>v1</p>", recipients: {} };
  EmailTemplate.findOne = (query) => { queries.push(query); return { sort: () => ({ lean: async () => stored }) }; };
  t.after(() => { EmailTemplate.findOne = originalFindOne; });

  await emailService.sendTemplateEmail("case-created-client", { to: "client@x.com", data: { caseNumber: "B1" } });
  stored = { ...stored, subject: "Version two for [case.id]", body: "<p>v2</p>" }; // admin saves an edit
  await emailService.sendTemplateEmail("case-created-client", { to: "client@x.com", data: { caseNumber: "B1" } });

  assert.equal(sent[0].subject, "Version one for B1");
  assert.equal(sent[1].subject, "Version two for B1");
  assert.match(sent[1].html, /<p>v2<\/p>/);
  assert.ok(queries.every((query) => query.status === "active" && query.managed === true && query.triggerKey === "case-created-client"));
});
