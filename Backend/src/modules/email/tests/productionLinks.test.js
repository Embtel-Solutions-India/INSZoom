// Email links always point at the production portals, never localhost. DB-free: the provider and EmailLog are stubbed.
const test = require("node:test");
const assert = require("node:assert/strict");

const { portalUrl, productionizeLinks } = require("../portalUrls");
const emailService = require("../email.service");
const customization = require("../emailCustomization.service");
const EmailLog = require("../../../models/EmailLog");
const { getProvider } = require("../providers");

const KEYS = ["ADMIN_PORTAL_URL", "ATTORNEY_PORTAL_URL", "CLIENT_URL", "LANDING_URL"];
function withEnv(values, fn) {
  const saved = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));
  KEYS.forEach((key) => { if (values[key] === undefined) delete process.env[key]; else process.env[key] = values[key]; });
  try { return fn(); } finally { KEYS.forEach((key) => { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; }); }
}

test("unset or localhost configuration resolves to the production addresses", () => {
  withEnv({}, () => {
    assert.equal(portalUrl("admin"), "https://admin.immiglance.com");
    assert.equal(portalUrl("attorney"), "https://attorney.immiglance.com");
    assert.equal(portalUrl("client"), "https://client.immiglance.com");
    assert.equal(portalUrl("landing"), "https://immiglance.com");
  });
  withEnv({ ADMIN_PORTAL_URL: "http://localhost:3002", ATTORNEY_PORTAL_URL: "http://127.0.0.1:5174/", CLIENT_URL: "http://localhost:5173", LANDING_URL: "http://localhost:5173" }, () => {
    assert.equal(portalUrl("admin"), "https://admin.immiglance.com");
    assert.equal(portalUrl("attorney"), "https://attorney.immiglance.com");
    assert.equal(portalUrl("client"), "https://client.immiglance.com");
    assert.equal(portalUrl("landing"), "https://immiglance.com");
  });
});

test("a real configured address (production or staging) is honoured, trailing slash removed", () => {
  withEnv({ ADMIN_PORTAL_URL: "https://admin.immiglance.com/", CLIENT_URL: "https://staging-client.example.com" }, () => {
    assert.equal(portalUrl("admin"), "https://admin.immiglance.com");
    assert.equal(portalUrl("client"), "https://staging-client.example.com");
  });
});

test("productionizeLinks rewrites every localhost origin by the portal its port stood for, and leaves real links alone", () => {
  withEnv({}, () => {
    const text = '<a href="http://localhost:3002/crm-cases/1">a</a> http://localhost:5174/cases/2 http://localhost:5173/login http://localhost:5175/dashboard http://127.0.0.1:5173/x https://immiglance.com/ok';
    assert.equal(
      productionizeLinks(text),
      '<a href="https://admin.immiglance.com/crm-cases/1">a</a> https://attorney.immiglance.com/cases/2 https://client.immiglance.com/login https://client.immiglance.com/dashboard https://client.immiglance.com/x https://immiglance.com/ok',
    );
    assert.equal(productionizeLinks("no links"), "no links");
    assert.equal(productionizeLinks(undefined), undefined);
  });
});

test("an email sent through the real send path never contains localhost, whatever the call site passed", async (t) => {
  const provider = getProvider();
  const original = { send: provider.send, isConfigured: provider.isConfigured, create: EmailLog.create, exists: EmailLog.exists, active: customization.findActive };
  const sent = [];
  provider.isConfigured = () => true;
  provider.send = async (mail) => { sent.push(mail); return { messageId: "m" }; };
  EmailLog.create = async (doc) => { const log = { ...doc, save: async () => log }; return log; };
  EmailLog.exists = async () => null;
  customization.findActive = async () => null;
  t.after(() => { provider.send = original.send; provider.isConfigured = original.isConfigured; EmailLog.create = original.create; EmailLog.exists = original.exists; customization.findActive = original.active; });

  await withEnv({ ADMIN_PORTAL_URL: "http://localhost:3002", CLIENT_URL: "http://localhost:5173" }, async () => {
    await emailService.sendTemplateEmail("questionnaire-submitted-team", { to: "tl@immiglance.com", recipientRole: "team_lead", caseId: "507f1f77bcf86cd799439011", data: { recipientName: "T", caseNumber: "B1", portalLink: "http://localhost:3002/crm-cases/1" } });
    await emailService.sendTemplateEmail("case-created-client", { to: "c@immiglance.com", recipientRole: "client", data: { clientName: "C", loginLink: "http://localhost:5173/login" } });
    await emailService.sendTemplateEmail("consultation-confirmation", { to: "p@immiglance.com", recipientRole: "client", data: { name: "P", manageUrl: "http://localhost:5173/consultation/booking/abc" } });
  });
  assert.equal(sent.length, 3);
  for (const mail of sent) {
    assert.ok(!/localhost|127\.0\.0\.1/i.test(`${mail.subject} ${mail.html} ${mail.text}`), `${mail.to}: no localhost anywhere`);
  }
  assert.ok(sent[0].html.includes('href="https://admin.immiglance.com/login"') && !sent[0].html.includes("/crm-cases/"), "staff get exactly one button: the Admin login");
  assert.equal(sent[0].html.split("<a ").length - 1, 1);
  assert.ok(sent[1].html.includes("https://client.immiglance.com/login"));
});
