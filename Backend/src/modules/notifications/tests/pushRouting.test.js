const assert = require("node:assert/strict");
const test = require("node:test");
const routing = require("../pushRouting");

// DB-free: pure routing decisions.
const ADMIN = "https://admin.immiglance.com";
const CLIENT = "https://client.immiglance.com";
const LANDING = "https://immiglance.com";

test("a role maps to exactly one portal", () => {
  assert.equal(routing.portalForRole("case_manager"), "admin");
  assert.equal(routing.portalForRole("team_lead"), "admin");
  assert.equal(routing.portalForRole("attorney"), "attorney");
  assert.equal(routing.portalForRole("client"), "client");
  assert.equal(routing.portalForRole(undefined), null);
});

test("staff push goes only to the Admin origin, with an absolute page address", () => {
  const plan = routing.planDeliveries({
    role: "case_manager",
    link: "/admin/portal?tab=leads",
    tokens: [{ token: "a", origin: ADMIN }, { token: "l", origin: LANDING }, { token: "c", origin: CLIENT }, { token: "old" }],
  });
  assert.deepEqual(plan.groups, [{ tokens: ["a", "old"], url: `${ADMIN}/leads` }]);
  assert.equal(plan.link, "/leads");
});

test("a client is never pushed on the admin origin", () => {
  const plan = routing.planDeliveries({ role: "client", link: "/dashboard/documents", tokens: [{ token: "a", origin: ADMIN }] });
  assert.deepEqual(plan.groups, []);
});

test("unknown origins are not stored", () => {
  assert.equal(routing.sanitizeOrigin("https://evil.example"), undefined);
  assert.equal(routing.sanitizeOrigin(ADMIN), ADMIN);
});

const ID = "60d0fe4f5311236168a10001";
const CASE = "60d0fe4f5311236168a10002";
const link = (role, l, caseId) => routing.resolveLinkForRole(role, l, { caseId });

test("each dead link is mapped to a page that exists in the recipient's portal", () => {
  assert.equal(link("case_manager", "/admin/portal?tab=leads"), "/leads");
  assert.equal(link("case_manager", `/cases/${ID}`), `/crm-cases/${ID}`);
  assert.equal(link("team_lead", `/cases/${ID}/petition`), `/crm-cases/${ID}`);
  assert.equal(link("case_manager", "/cases"), "/crm-cases");
  assert.equal(link("case_manager", `/payments/${ID}`, CASE), `/crm-cases/${CASE}`);
  assert.equal(link("case_manager", `/payments/${ID}`), "/dashboard");
  assert.equal(link("case_manager", `/appointments/${ID}`, CASE), "/leads");
  assert.equal(link("admin", "/appointments"), "/leads");
  assert.equal(link("case_manager", `/messages/${ID}`, CASE), `/messages/${CASE}`);
  assert.equal(link("client", `/messages/${ID}`, CASE), "/dashboard/messages");
  assert.equal(link("client", `/payments/${ID}`), "/dashboard");
  assert.equal(link("client", `/appointments/${ID}`), "/dashboard");
  assert.equal(link("client", "/dashboard/employer"), "/dashboard/profile");
  assert.equal(link("client", "/dashboard/payments"), "/dashboard");
  assert.equal(link("attorney", `/messages/${ID}`, CASE), `/messages/${CASE}`);
});

test("links that already work are left exactly as they are", () => {
  assert.equal(link("case_manager", `/crm-cases/${ID}?tab=forms&formId=${CASE}`), `/crm-cases/${ID}?tab=forms&formId=${CASE}`);
  assert.equal(link("attorney", `/cases/${ID}/petition`), `/cases/${ID}/petition`);
  assert.equal(link("attorney", `/messages/${CASE}`, CASE), `/messages/${CASE}`);
  assert.equal(link("case_manager", "/payments"), "/payments");
  assert.equal(link("case_manager", "/messages/user/abc"), "/messages/user/abc");
  assert.equal(link("client", "/dashboard/payments/success"), "/dashboard/payments/success");
  assert.equal(link("client", "/dashboard/documents"), "/dashboard/documents");
  assert.equal(link("case_manager", "/leads"), "/leads");
  assert.equal(link(undefined, `/cases/${ID}`), `/cases/${ID}`);
  assert.equal(link("case_manager", undefined), undefined);
});
