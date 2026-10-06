// Every link in every email must land on a REAL page of the RIGHT portal:
//   clients  -> Immiglance Client portal   (CLIENT_URL)
//   staff    -> Admin portal               (ADMIN_PORTAL_URL)
//   attorneys-> Attorney portal            (ATTORNEY_PORTAL_URL)
// and no email may ever contain a dead "#" link.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

process.env.ATTORNEY_PORTAL_URL = "https://attorney.example-portal.test";
process.env.ADMIN_PORTAL_URL = "https://admin.example-portal.test";
process.env.LANDING_URL = "https://landing.example-portal.test";

const triggers = require("../emailTriggers.registry");
const emailService = require("../email.service");
const customization = require("../emailCustomization.service");
const triggerEvents = require("../../notifications/triggerEvents.service");
const env = require("../../../config/env");
const EmailLog = require("../../../models/EmailLog");
const { getProvider } = require("../providers");

const ROOT = path.join(__dirname, "..", "..", "..", "..", "..");
const routesOf = (file, { prefix = "" } = {}) => {
  const source = fs.readFileSync(path.join(ROOT, file), "utf8");
  return [...source.matchAll(/path="([^"*]+)"/g)].map(([, route]) => (route.startsWith("/") ? route : `${prefix}/${route}`)).filter((route) => route !== "/");
};
const ROUTES = {
  client: routesOf("Immiglance/Client/src/App.jsx"),
  staff: routesOf("Admin/frontend/src/App.jsx"),
  attorney: routesOf("Attorney/src/App.jsx"),
};
const matchesRoute = (pathname, routes) => routes.some((route) => new RegExp(`^${route.replace(/:[^/]+/g, "[^/]+")}$`).test(pathname));
const portalOf = (audience) => (audience === "client" ? "client" : audience === "attorney" ? "attorney" : "staff");
const ORIGIN = { client: env.clientUrl.replace(/\/+$/, ""), staff: "https://admin.example-portal.test", attorney: "https://attorney.example-portal.test" };

test("each portal's route table was read (sanity)", () => {
  assert.ok(matchesRoute("/dashboard", ROUTES.client));
  assert.ok(matchesRoute("/crm-cases/abc", ROUTES.staff));
  assert.ok(matchesRoute("/cases/abc", ROUTES.attorney));
  assert.ok(!matchesRoute("/dashboard/case/abc", ROUTES.client), "the client portal has no /dashboard/case/:id page");
});

test("every event trigger's in-app link and email button land on a real page of the recipient's own portal", () => {
  triggers.TRIGGERS.filter((t) => !t.builtIn && t.available).forEach((trigger) => {
    const portal = portalOf(trigger.audience);
    const pathname = triggerEvents.linkFor(trigger, "64f0c0ffee0123456789abcd");
    assert.ok(matchesRoute(pathname, ROUTES[portal]), `${trigger.key}: ${pathname} is not a route of the ${portal} portal`);
    const absolute = triggerEvents.portalLinkFor(trigger, "64f0c0ffee0123456789abcd");
    assert.equal(absolute, `${ORIGIN[portal]}${pathname}`, `${trigger.key}: wrong portal origin`);
    // case-less events (system alerts / leads) still resolve
    assert.ok(matchesRoute(triggerEvents.linkFor(trigger, undefined), ROUTES[portal]), `${trigger.key}: case-less link`);
  });
});

test("links that the existing code builds no longer point at pages that do not exist", () => {
  const read = (file) => fs.readFileSync(path.join(__dirname, "..", "..", "..", "..", file), "utf8");
  assert.ok(!/dashboard\/case\//.test(read("src/modules/cases/case.controller.js")), "case.controller still links to /dashboard/case/:id");
  assert.ok(!/`\/questionnaire\/\$\{/.test(read("src/modules/questionnaires/questionnaire.service.js")), "questionnaire.service still links to /questionnaire/:id");
});

test("every built-in email, rendered the way a real send does, has working links in the right portal and never a dead '#'", async (t) => {
  const sent = [];
  const provider = getProvider();
  const original = { send: provider.send, isConfigured: provider.isConfigured, create: EmailLog.create, exists: EmailLog.exists, active: customization.findActive };
  provider.send = async (message) => { sent.push(message); return { messageId: "m" }; };
  provider.isConfigured = () => true;
  EmailLog.create = async (doc) => { const log = { ...doc, save: async () => log }; return log; };
  EmailLog.exists = async () => null; // no DB in unit tests: nothing was sent a moment ago
  customization.findActive = async () => null;
  t.after(() => { provider.send = original.send; provider.isConfigured = original.isConfigured; EmailLog.create = original.create; EmailLog.exists = original.exists; customization.findActive = original.active; });

  const builtIns = triggers.TRIGGERS.filter((trigger) => trigger.builtIn);
  for (const trigger of builtIns) {
    sent.length = 0;
    // Typical data a call site passes - deliberately WITHOUT portalLink for the emails that used to fall back to "#".
    await emailService.sendTemplateEmail(trigger.key, {
      to: "person@real-domain.com",
      data: { clientName: "Ana", caseNumber: "B1", token: "tok", recipientName: "Ana", manageUrl: "https://landing.example-portal.test/consultation/booking/abc", attorneyPortalUrl: ORIGIN.attorney, role: "super_admin", password: "pw" },
      caseId: "64f0c0ffee0123456789abcd",
      recipientRole: trigger.audience === "attorney" ? "attorney" : trigger.audience === "client" ? "client" : trigger.audience,
    });
    assert.equal(sent.length, 1, `${trigger.key} was not sent`);
    const html = sent[0].html;
    const hrefs = [...html.matchAll(/href="([^"]*)"/g)].map(([, href]) => href).filter((href) => !href.startsWith("https://egov.uscis.gov"));
    hrefs.forEach((href) => {
      assert.notEqual(href, "#", `${trigger.key} has a dead '#' link`);
      assert.match(href, /^https?:\/\//, `${trigger.key}: link is not absolute: ${href}`);
      assert.ok(!/undefined|null|\[object/.test(href), `${trigger.key}: broken link ${href}`);
    });

    // Portal-bound emails must use the recipient's own portal.
    const portal = portalOf(trigger.audience);
    const portalLinks = hrefs.filter((href) => !href.includes("/consultation/booking/"));
    if (!["consultation-confirmation", "consultation-reschedule", "consultation-cancel", "consultation-host-notify", "lead-approved", "lead-rejected", "quiz-lead-internal", "password-reset", "staff-credentials"].includes(trigger.key)) {
      portalLinks.forEach((href) => assert.ok(href.startsWith(ORIGIN[portal]), `${trigger.key}: ${href} is not on the ${portal} portal (${ORIGIN[portal]})`));
    }
  }
});

test("consultation emails link to the public booking page, invitations/reset to the client portal's real routes, staff credentials to their own portal", () => {
  assert.ok(matchesRoute("/accept-invite", ROUTES.client));
  assert.ok(matchesRoute("/reset-password", ROUTES.client));
  const landing = fs.readFileSync(path.join(ROOT, "Immiglance/Landing/src/App.jsx"), "utf8");
  assert.match(landing, /path="\/consultation\/booking\/:token"/);
  const credentials = require("../templates/staff-credentials");
  const lines = credentials.bodyLines({ name: "Alka", role: "attorney", email: "a@real.com", password: "pw" }).join(" ");
  assert.match(lines, /attorney\.example-portal\.test/);
  const adminLines = credentials.bodyLines({ name: "Sam", role: "case_manager", email: "s@real.com", password: "pw" }).join(" ");
  assert.match(adminLines, /admin\.example-portal\.test/);
});
