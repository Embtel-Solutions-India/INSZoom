// Phase 5E: the three new e-mail templates, their registration (email.service, emailPolicy, notification types) and the content rules (escaped, no secrets / client data).
const test = require("node:test");
const assert = require("node:assert/strict");
const success = require("../../email/templates/form-pipeline-success");
const held = require("../../email/templates/form-pipeline-held");
const digest = require("../../email/templates/form-pipeline-digest");
const emailService = require("../../email/email.service");
const { SEND_RULES } = require("../../email/emailPolicy");
const { NOTIFICATION_TYPES } = require("../../notifications/notification.constants");
const Notification = require("../../../models/Notification");

const text = (lines) => lines.join("\n");

test("success e-mail follows the plan wording: old -> new edition, visa types, release, coverage, previous edition retained", () => {
  const data = { formCode: "I-130", previousEdition: "2024-04-01", newEdition: "2025-01-20", visaTypes: ["IR-1", "CR-1"], release: { mode: "promoted" }, coverage: { total: 300, mapped: 290, requiredUnmapped: 2 }, jobId: "j1", adminLink: "https://admin.test/form-governance" };
  assert.equal(success.subject(data), "Form pipeline: I-130 updated to edition 2025-01-20");
  const body = text(success.bodyLines(data));
  assert.match(body, /Form <strong>I-130<\/strong> was updated from edition <strong>2024-04-01<\/strong> to edition <strong>2025-01-20<\/strong>/);
  assert.match(body, /mapped to these visa types and case-creation options, from which the form will now activate: IR-1, CR-1/);
  assert.match(body, /Release: <strong>promoted<\/strong>/);
  assert.match(body, /Coverage: 290 of 300 fields mapped; 2 required field\(s\) unresolved/);
  assert.match(body, /Previous edition: retired and retained for rollback/);
  assert.match(body, /<a href="https:\/\/admin\.test\/form-governance">Open Form Governance<\/a>/);
});

test("success e-mail: a degraded release names the failed non-critical checks and who authorized it; a first edition says so; missing facts are stated, not invented", () => {
  const degraded = text(success.bodyLines({ formCode: "I-90", newEdition: "2026-01-01", release: { mode: "degraded", failed: ["viewer_render", "download"], authorizedBy: "user-7", authorizedAt: "2026-02-03", reason: "cosmetic" }, visaTypes: [], coverage: null }));
  assert.match(degraded, /Release: <strong>degraded<\/strong> - these non-critical checks failed: viewer_render, download, authorized by user-7 on 2026-02-03 \(cosmetic\)/);
  assert.match(degraded, /added to the registry at edition <strong>2026-01-01<\/strong>/);
  assert.match(degraded, /not mapped to any visa type/);
  assert.match(degraded, /Coverage: not available/);
  assert.match(degraded, /There was no previous edition/);
  assert.match(text(success.bodyLines({ formCode: "I-90", newEdition: "x", release: { mode: "promoted" }, visaTypes: null })), /could not be read for this e-mail/);
});

test("held e-mail states the reason and the action needed; the subject tells a policy hold from an approval", () => {
  const policy = { formCode: "I-485", editionDate: "2026-09-18", reason: "USCIS has not confirmed that edition 2026-09-18 is accepted", reasonKind: "policy_hold", action: "Submit the USCIS acceptance evidence", activeEdition: "2024-04-01", jobId: "j2" };
  assert.equal(held.subject(policy), "Form pipeline HELD: I-485 edition 2026-09-18");
  const body = text(held.bodyLines(policy));
  assert.match(body, /was imported but not promoted: USCIS has not confirmed that edition 2026-09-18 is accepted\./);
  assert.match(body, /Action needed: Submit the USCIS acceptance evidence/);
  assert.match(body, /active edition \(2024-04-01\) stays live/);
  assert.equal(held.subject({ ...policy, reasonKind: "approval_required" }), "Form pipeline approval needed: I-485 edition 2026-09-18");
});

test("digest lists the promoted editions, caps the list and says how many more", () => {
  const entries = Array.from({ length: 60 }, (_, index) => ({ formCode: `I-${index}`, fromEdition: "2024-01-01", toEdition: "2025-01-01", release: index === 0 ? "degraded" : "promoted" }));
  assert.equal(digest.subject({ trigger: "catalog_sync", count: 60 }), "Form pipeline summary: 60 editions promoted (catalog sync)");
  assert.equal(digest.subject({ trigger: "autopilot", count: 1 }), "Form pipeline summary: 1 edition promoted (autopilot)");
  const lines = digest.bodyLines({ trigger: "catalog_sync", count: 60, individualSent: 5, entries });
  assert.match(lines[0], /promoted <strong>60<\/strong> form editions \(5 more already e-mailed on their own\)/);
  assert.equal(lines.length, 1 + digest.SHOWN + 1 + 1, "header + shown entries + 'and N more' + admin link line");
  assert.match(lines[1], /I-0<\/strong>: 2024-01-01 &rarr; 2025-01-01 \(degraded release\)/);
  assert.match(text(lines), /\.\.\.and 10 more/);
});

test("every dynamic value in every new template is HTML-escaped", () => {
  const evil = "<img src=x onerror=alert(1)>";
  const bodies = [
    success.bodyLines({ formCode: evil, previousEdition: evil, newEdition: evil, visaTypes: [evil], release: { mode: "degraded", failed: [evil], authorizedBy: evil, reason: evil }, coverage: { total: 1, mapped: 1, requiredUnmapped: 0 }, jobId: evil, adminLink: `"><script>${evil}` }),
    held.bodyLines({ formCode: evil, editionDate: evil, reason: evil, action: evil, activeEdition: evil, jobId: evil, adminLink: `"><b>` }),
    digest.bodyLines({ trigger: evil, count: 1, entries: [{ formCode: evil, toEdition: evil }], adminLink: `"><b>` }),
  ].map(text);
  for (const body of bodies) assert.equal(body.includes("<img"), false, body);
});

test("the templates are registered: e-mail service (audience + template), e-mail policy rules, in-app notification types", () => {
  for (const key of ["form-pipeline-alert", "form-pipeline-success", "form-pipeline-held", "form-pipeline-digest"]) {
    assert.ok(emailService.TEMPLATES[key], `${key} template`);
    assert.equal(emailService.TEMPLATES[key].key, key);
    assert.equal(emailService.TEMPLATE_AUDIENCE[key], "team_member", `${key} audience`);
    assert.ok(SEND_RULES[key]?.when && SEND_RULES[key]?.unless, `${key} send rule`);
  }
  assert.ok(NOTIFICATION_TYPES.includes("form_pipeline_alert"));
  assert.ok(NOTIFICATION_TYPES.includes("form_pipeline_update"));
  // the Notification model accepts both (it validates the enum)
  for (const type of ["form_pipeline_alert", "form_pipeline_update"]) {
    const error = new Notification({ source: "shared", category: "system", type, title: "t", message: "m", priority: "high" }).validateSync();
    assert.equal(error?.errors?.type, undefined, `${type} validates`);
    assert.equal(error?.errors?.priority, undefined);
    assert.equal(error?.errors?.category, undefined);
  }
});
