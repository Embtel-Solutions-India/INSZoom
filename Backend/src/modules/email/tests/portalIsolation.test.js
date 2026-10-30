// Each email links ONLY to its recipient's own portal: clients -> Client portal, internal team -> Admin portal, attorneys -> Attorney
// portal. DB-free: the provider and EmailLog are stubbed. Sends deliberately omit `recipientRole`, the way notification emails with
// an explicit address do, so the template's own audience has to be right.
const test = require("node:test");
const assert = require("node:assert/strict");

const emailService = require("../email.service");
const triggers = require("../emailTriggers.registry");
const customization = require("../emailCustomization.service");
const { portalUrl, confineToPortal } = require("../portalUrls");
const EmailLog = require("../../../models/EmailLog");
const { getProvider } = require("../providers");

const ORIGINS = { client: portalUrl("client"), staff: portalUrl("admin"), attorney: portalUrl("attorney") };
const portalOf = (audience) => (audience === "client" ? "client" : audience === "attorney" ? "attorney" : "staff");
const hrefsOf = (html) => [...html.matchAll(/href="([^"]*)"/g)].map(([, href]) => href);

function stubMailer(t) {
  const sent = [];
  const provider = getProvider();
  const original = { send: provider.send, isConfigured: provider.isConfigured, create: EmailLog.create, exists: EmailLog.exists, active: customization.findActive };
  provider.send = async (mail) => { sent.push(mail); return { messageId: "m" }; };
  provider.isConfigured = () => true;
  EmailLog.create = async (doc) => { const log = { ...doc, save: async () => log }; return log; };
  EmailLog.exists = async () => null;
  customization.findActive = async () => null;
  t.after(() => { provider.send = original.send; provider.isConfigured = original.isConfigured; EmailLog.create = original.create; EmailLog.exists = original.exists; customization.findActive = original.active; });
  return sent;
}

test("case-manager assigned / reassigned go to the client: Client portal link only, no Admin login button", async (t) => {
  const sent = stubMailer(t);
  for (const key of ["case-manager-assigned", "case-manager-reassigned"]) {
    sent.length = 0;
    await emailService.sendTemplateEmail(key, { to: "client@real-domain.com", caseId: "64f0c0ffee0123456789abcd", data: { clientName: "Ana", caseNumber: "B1", caseManagerName: "Sam", newCaseManagerName: "Sam" } });
    assert.equal(sent.length, 1, key);
    assert.ok(!sent[0].html.includes("Log in to Admin"), `${key}: client got the staff button`);
    assert.equal(hrefsOf(sent[0].html).length, 1, `${key}: exactly one button`);
    assert.ok(hrefsOf(sent[0].html)[0].startsWith(ORIGINS.client), `${key}: not on the Client portal`);
  }
});

test("every built-in email, sent without a recipientRole, links only to its audience's portal", async (t) => {
  const sent = stubMailer(t);
  for (const trigger of triggers.TRIGGERS.filter((entry) => entry.builtIn && !entry.locked)) {
    sent.length = 0;
    // Another portal's address in the data must never reach this recipient.
    const foreign = Object.values(ORIGINS).map((origin) => `${origin}/x`);
    await emailService.sendTemplateEmail(trigger.key, {
      to: "person@real-domain.com",
      caseId: "64f0c0ffee0123456789abcd",
      data: { clientName: "Ana", caseNumber: "B1", recipientName: "Ana", portalLink: foreign[0], adminLink: foreign[1], attorneyPortalUrl: foreign[2], manageUrl: "https://immiglance.com/consultation/booking/abc" },
    });
    if (!sent.length) continue; // e.g. suppressed in this environment
    const own = ORIGINS[portalOf(emailService.TEMPLATE_AUDIENCE[trigger.key] === "team_member" ? "team_member" : emailService.TEMPLATE_AUDIENCE[trigger.key])];
    const others = Object.values(ORIGINS).filter((origin) => origin !== own);
    for (const href of hrefsOf(sent[0].html)) {
      assert.ok(!others.some((origin) => href.startsWith(origin)), `${trigger.key}: ${href} is on another portal (own: ${own})`);
    }
    const clientAudience = emailService.TEMPLATE_AUDIENCE[trigger.key] === "client";
    // every email has at most one button; a staff email's button opens the Admin login page
    const buttons = sent[0].html.split("display:inline-block").length - 1;
    assert.ok(buttons <= 1, `${trigger.key}: one button at most`);
    if (!clientAudience && emailService.TEMPLATE_AUDIENCE[trigger.key] === "team_member") assert.ok(sent[0].html.includes(`href="${ORIGINS.staff}/login"`), `${trigger.key}: Admin login button`);
  }
});

test("a link to the wrong portal in a client / staff / attorney email is replaced with the recipient's own portal", async (t) => {
  const sent = stubMailer(t);
  const caseId = "64f0c0ffee0123456789abcd";
  const wrong = { portalLink: `${ORIGINS.staff}/crm-cases/${caseId}` };
  await emailService.sendTemplateEmail("rfe-received", { to: "c@real-domain.com", recipientRole: "client", caseId, data: { clientName: "A", caseNumber: "B1", ...wrong } });
  await emailService.sendTemplateEmail("rfe-received", { to: "a@real-domain.com", recipientRole: "attorney", caseId, data: { clientName: "A", caseNumber: "B1", ...wrong } });
  assert.ok(hrefsOf(sent[0].html).every((href) => href.startsWith(ORIGINS.client)), "client");
  assert.ok(hrefsOf(sent[1].html).every((href) => href.startsWith(ORIGINS.attorney)), "attorney");
  assert.ok(!sent[0].text.includes(ORIGINS.staff) && !sent[1].text.includes(ORIGINS.staff), "plain-text part too");
});

test("internal roles (incl. paralegal / finance / hr and the generic team_member marker) are sent to the Admin portal", () => {
  for (const role of ["super_admin", "admin", "team_lead", "case_manager", "paralegal", "finance", "hr", "team_member"]) {
    assert.ok(emailService.defaultPortalLink("rfe-received", role, "64f0c0ffee0123456789abcd").startsWith(ORIGINS.staff), role);
  }
  assert.ok(emailService.defaultPortalLink("rfe-received", "attorney", "64f0c0ffee0123456789abcd").startsWith(ORIGINS.attorney));
  assert.ok(emailService.defaultPortalLink("rfe-received", "client", "64f0c0ffee0123456789abcd").startsWith(ORIGINS.client));
});

test("confineToPortal leaves own-portal, landing and USCIS links alone", () => {
  const html = `<a href="${ORIGINS.client}/dashboard">a</a> <a href="https://immiglance.com/consultation/booking/1">b</a> <a href="https://egov.uscis.gov/x">c</a> <a href="${ORIGINS.staff}/login">d</a>`;
  const out = confineToPortal(html, "client", `${ORIGINS.client}/dashboard`);
  assert.ok(out.includes(`${ORIGINS.client}/dashboard`) && out.includes("immiglance.com/consultation") && out.includes("egov.uscis.gov"));
  assert.ok(!out.includes(ORIGINS.staff));
});
