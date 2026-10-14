const assert = require("node:assert/strict");
const test = require("node:test");
const template = require("../templates/employee-access-restored");
const emailService = require("../email.service");
const triggers = require("../emailTriggers.registry");
const policy = require("../emailPolicy");
const env = require("../../../config/env");

// The email an employee gets when their employer gives them access to their information AGAIN.
test("it is a registered built-in email with trigger metadata, a send rule and is never throttled", () => {
  assert.equal(emailService.TEMPLATES["employee-access-restored"], template);
  assert.equal(emailService.TEMPLATE_AUDIENCE["employee-access-restored"], "client");
  assert.ok(triggers.TRIGGERS.some((trigger) => trigger.key === "employee-access-restored" && trigger.builtIn));
  assert.ok(policy.SEND_RULES["employee-access-restored"]?.when);
  assert.ok(policy.NEVER_THROTTLED.has("employee-access-restored"), "a second grant must always be sent");
});

test("an employee who already has an account is sent to their documents page, with no setup token in the email", () => {
  const html = template.bodyLines({ employeeName: "Ana", employerName: "Acme", caseNumber: "B1-A", token: "secret", needsSetup: false }).join(" ");
  assert.ok(html.includes(`${env.clientUrl}/dashboard/documents`));
  assert.ok(!html.includes("accept-invite") && !html.includes("secret"));
  assert.match(html, /Acme/);
  assert.match(html, /Everything you entered earlier is kept/);
});

test("an employee who never set a password gets the setup link", () => {
  const html = template.bodyLines({ employeeName: "Ana", employerName: "Acme", caseNumber: "B1-A", token: "tok123", needsSetup: true }).join(" ");
  assert.ok(html.includes(`${env.clientUrl}/accept-invite?token=tok123`));
});

test("a setup link is never built without a token", () => {
  const html = template.bodyLines({ needsSetup: true }).join(" ");
  assert.ok(!html.includes("accept-invite") && !/undefined|null/.test(html));
  assert.match(template.subject({ employerName: "Acme" }), /Acme/);
});
