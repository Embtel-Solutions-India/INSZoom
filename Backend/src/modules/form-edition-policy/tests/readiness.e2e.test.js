// The plan's READINESS GATE before Release 0b-2, proven DB-free: the evidence path resolves every supported hold END TO END through the real HTTP
// handlers - submit -> verification results -> the reviewer explicitly confirms -> decision persisted -> gate re-run and its new result shown -
// and every ambiguous case stays held. The Admin screen depends on exactly the JSON shapes asserted here. In-memory store, scripted fetchers.
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const express = require("express");
const authorizeRoles = require("../../../middleware/authorizeRoles");
const controller = require("../form-edition-policy.controller");
const { setServiceForTests } = require("../EvidenceService");
const { EVIDENCE_ROLES } = require("../editionPolicy.constants");
const H = require("./helpers");

// the real handlers + the real exact-role guard; only authentication is stubbed (a header names the caller)
function startApp(service) {
  setServiceForTests(service);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = { _id: `user-${req.headers["x-user"]}`, role: req.headers["x-role"] }; next(); });
  app.use(authorizeRoles(...EVIDENCE_ROLES));
  app.get("/editions", controller.listEditions);
  app.get("/gate", controller.checkGate);
  app.post("/evidence", controller.submitEvidence);
  app.get("/evidence/:evidenceCaseId", controller.getEvidenceCase);
  app.post("/evidence/:evidenceCaseId/decision", controller.recordDecision);
  return new Promise((resolve) => {
    const server = http.createServer(app).listen(0, () => resolve({ server, base: `http://127.0.0.1:${server.address().port}` }));
  });
}
const call = async (base, method, path, { who = ["admin", "admin"], body } = {}) => {
  const response = await fetch(`${base}${path}`, { method, headers: { "content-type": "application/json", "x-role": who[0], "x-user": who[1] }, body: body ? JSON.stringify(body) : undefined });
  return { status: response.status, body: await response.json() };
};
const ADMIN = ["admin", "admin"];
const LEAD = ["team_lead", "lead"];
const decisionBody = (decision, over = {}) => ({ decision, rationale: "Verified against the official USCIS notice.", confirmation: { confirmed: true, decision, formCode: "I-131", editionIdentifier: H.edition }, ...over });

async function withApp(options, run) {
  const { service } = H.build(options);
  const { server, base } = await startApp(service);
  try { await run(base); } finally { await new Promise((resolve) => server.close(resolve)); setServiceForTests(null); }
}

test("READINESS: submit -> verification results -> explicit confirmation -> decision persisted -> gate re-run (allowed), by a different reviewer", async () => {
  await withApp({}, async (base) => {
    const before = await call(base, "GET", "/editions");
    assert.equal(before.status, 200);
    assert.equal(before.body.success, true);
    const live = before.body.data.find((row) => row.formCode === "I-131");
    assert.deepEqual([live.canSubmitEvidence, live.gate.allowed, live.gate.reasons, live.decision], [true, false, ["no_policy"], null]);

    // 1. submit the claim: the system fetches, snapshots and verifies
    const submitted = await call(base, "POST", "/evidence", { who: ADMIN, body: { formCode: "I-131", editionIdentifier: H.edition, sourceUrl: "https://www.uscis.gov/i-131-alert", quote: H.QUOTE } });
    assert.equal(submitted.status, 200);
    const evidence = submitted.body.data;
    assert.equal(evidence.verification.overall, "verified");
    assert.ok(Array.isArray(evidence.verification.checks) && evidence.verification.checks.every((item) => item.name && typeof item.passed === "boolean" && item.detail));
    assert.deepEqual([evidence.snapshot.hash.length, evidence.snapshot.finalUrl], [64, "https://www.uscis.gov/i-131-alert"]);
    assert.equal(evidence.gate.allowed, false, "evidence alone authorizes nothing");

    // 2. the case is readable (what the screen shows next to the quote)
    const shown = await call(base, "GET", `/evidence/${evidence.evidenceCaseId}`, { who: LEAD });
    assert.equal(shown.body.data.verification.overall, "verified");
    assert.equal(shown.body.data.claim.quote, H.QUOTE);
    assert.equal(shown.body.data.decisionRecorded, false);

    // 3. without the explicit confirmation nothing is written
    const unconfirmed = await call(base, "POST", `/evidence/${evidence.evidenceCaseId}/decision`, { who: LEAD, body: decisionBody("accepted", { confirmation: undefined }) });
    assert.equal(unconfirmed.status, 422);
    assert.equal(unconfirmed.body.code, "CONFIRMATION_REQUIRED");
    assert.equal((await call(base, "GET", "/editions")).body.data.find((row) => row.formCode === "I-131").decision, null);

    // 4. the submitter cannot accept their own evidence
    const sameUser = await call(base, "POST", `/evidence/${evidence.evidenceCaseId}/decision`, { who: ADMIN, body: decisionBody("accepted") });
    assert.deepEqual([sameUser.status, sameUser.body.code], [403, "FOUR_EYES_REQUIRED"]);

    // 5. a different reviewer confirms: decision persisted, gate re-run and its NEW result returned
    const decided = await call(base, "POST", `/evidence/${evidence.evidenceCaseId}/decision`, { who: LEAD, body: decisionBody("accepted") });
    assert.equal(decided.status, 200);
    assert.equal(decided.body.data.decision.decision, "accepted");
    assert.equal(decided.body.data.decision.version, 1);
    assert.deepEqual([decided.body.data.gate.allowed, decided.body.data.gate.decision, decided.body.data.gate.reasons], [true, "accepted", []]);

    // 6. the list and the gate endpoint now agree, and the case shows the recorded decision and its audit events
    const after = (await call(base, "GET", "/editions")).body.data.find((row) => row.formCode === "I-131");
    assert.deepEqual([after.decision.decision, after.gate.allowed], ["accepted", true]);
    assert.equal((await call(base, "GET", `/gate?formCode=I-131&edition=${H.edition}`)).body.data.allowed, true);
    const done = (await call(base, "GET", `/evidence/${evidence.evidenceCaseId}`)).body.data;
    assert.equal(done.decisionRecorded, true);
    assert.deepEqual(done.events.map((event) => event.type), ["EVIDENCE_SUBMITTED", "SOURCE_FETCHED", "VERIFICATION_COMPLETED", "DECISION_RECORDED", "GATE_RECALCULATED"]);
  });
});

test("READINESS: every ambiguous case stays HELD - unverifiable quote, conflicting template, unreachable page, backfilled date, unknown edition", async () => {
  const scenarios = [
    ["a quote that is not on the official page", {}, { quote: "USCIS will accept the 01/20/25 edition of Form I-131 for filing from today." }, "unverifiable"],
    ["a page that cannot be fetched", { html: H.failFetch() }, {}, "unverifiable"],
    ["a template whose date came from version_backfill", { templates: [H.template({ importMetadata: { editionDateSource: "version_backfill", checksum: H.template().importMetadata.checksum } })] }, {}, "conflicting"],
    ["an official PDF that differs from the imported one", { pdf: H.pdfFetch(Buffer.from("different bytes")) }, {}, "conflicting"],
    ["an edition with no template on file", { templates: [] }, {}, "unverifiable"],
    ["claimed dates the quote does not contain", {}, { effectiveDate: "2026-03-01" }, "conflicting"],
  ];
  for (const [label, options, claim, expected] of scenarios) {
    await withApp(options, async (base) => {
      const submitted = await call(base, "POST", "/evidence", { who: ADMIN, body: { formCode: "I-131", editionIdentifier: H.edition, sourceUrl: "https://www.uscis.gov/i-131-alert", quote: H.QUOTE, ...claim } });
      assert.equal(submitted.body.data.verification.overall, expected, label);
      assert.equal(submitted.body.data.gate.allowed, false, `${label}: gate must hold`);
      const accept = await call(base, "POST", `/evidence/${submitted.body.data.evidenceCaseId}/decision`, { who: LEAD, body: decisionBody("accepted") });
      assert.deepEqual([accept.status, accept.body.code], [422, "EVIDENCE_NOT_VERIFIED"], `${label}: acceptance must be refused`);
      const gate = (await call(base, "GET", `/gate?formCode=I-131&edition=${H.edition}`)).body.data;
      assert.equal(gate.allowed, false, `${label}: still held afterwards`);
      assert.deepEqual(gate.reasons, ["no_policy"]);
    });
  }
});

test("READINESS: a restricting decision resolves an ambiguous case to a visible hold, and not_accepted can never be reversed by these roles", async () => {
  await withApp({}, async (base) => {
    const first = (await call(base, "POST", "/evidence", { who: ADMIN, body: { formCode: "I-131", editionIdentifier: H.edition, sourceUrl: "https://www.uscis.gov/x", quote: H.QUOTE } })).body.data;
    const blocked = await call(base, "POST", `/evidence/${first.evidenceCaseId}/decision`, { who: ADMIN, body: decisionBody("not_accepted") });
    assert.deepEqual([blocked.status, blocked.body.data.gate.allowed, blocked.body.data.gate.reasons], [200, false, ["not_accepted_by_uscis"]]);
    const again = (await call(base, "POST", "/evidence", { who: ADMIN, body: { formCode: "I-131", editionIdentifier: H.edition, sourceUrl: "https://www.uscis.gov/x", quote: H.QUOTE } })).body.data;
    const reversal = await call(base, "POST", `/evidence/${again.evidenceCaseId}/decision`, { who: LEAD, body: decisionBody("accepted") });
    assert.deepEqual([reversal.status, reversal.body.code], [409, "NOT_ACCEPTED_LOCKED"]);
  });
});

test("the role guard turns away every other role over HTTP, with 403 and no data", async () => {
  await withApp({}, async (base) => {
    for (const role of ["super_admin", "case_manager", "attorney", "paralegal", "finance", "hr", "client"]) {
      for (const [method, path] of [["GET", "/editions"], ["GET", "/gate?formCode=I-131&edition=2025-01-20"], ["POST", "/evidence"], ["GET", "/evidence/x"], ["POST", "/evidence/x/decision"]]) {
        const result = await call(base, method, path, { who: [role, role], body: method === "POST" ? {} : undefined });
        assert.equal(result.status, 403, `${role} ${method} ${path}`);
        assert.equal(result.body.success, false);
        assert.equal(result.body.data, undefined);
      }
    }
  });
});

test("service errors come back as JSON with the right status and code; invalid input is a 400, an unknown case a 404", async () => {
  await withApp({}, async (base) => {
    const invalid = await call(base, "POST", "/evidence", { who: ADMIN, body: { formCode: "I-131", editionIdentifier: "01/20/25", sourceUrl: "x", quote: "short" } });
    assert.deepEqual([invalid.status, invalid.body.success, invalid.body.code], [400, false, "INVALID_EVIDENCE"]);
    assert.ok(invalid.body.details.problems.length >= 2);
    const missing = await call(base, "GET", "/evidence/does-not-exist");
    assert.deepEqual([missing.status, missing.body.code], [404, "EVIDENCE_NOT_FOUND"]);
  });
});
