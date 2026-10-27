// DB-free: the owner policy for G-325R and G-639 - the edition printed in the PDF's own footer is the approved edition when USCIS publishes no statement. Scoped to the two forms, only when
// the gate holds NO record, never over an explicit decision, and only when the footer edition equals the template's edition date.
const assert = require("node:assert/strict");
const test = require("node:test");
const enforcer = require("../EditionPolicyEnforcer");
const { OWNER_FOOTER_EDITION_FORMS } = require("../editionPolicy.constants");

const outcomes = [];
const service = { recordOutcome: async (entry) => outcomes.push(entry) };
const deps = (decisionRow, footer) => ({ service, store: { findDecision: async () => decisionRow }, autoEvidence: false, footerEdition: async () => footer });
const template = (formCode, editionDate) => ({ formCode, editionDate: new Date(editionDate), importMetadata: { editionDateSource: "pdf" } });

test.afterEach(() => enforcer.setDepsForTests(null));

test("the policy covers exactly G-325R and G-639", () => {
  assert.deepEqual([...OWNER_FOOTER_EDITION_FORMS].sort(), ["G-325R", "G-639"]);
});

test("no record + footer edition equals the edition: allowed (G-325R 09/04/26, G-639 12/12/24)", async () => {
  enforcer.setDepsForTests(deps(null, "2026-09-04"));
  const a = await enforcer.requireAcceptedEdition(template("G-325R", "2026-09-04"), { entryPoint: "test" });
  assert.equal(a.allowed, true);
  assert.equal(a.ownerPolicy, "footer_edition");
  enforcer.setDepsForTests(deps(null, "2024-12-12"));
  assert.equal((await enforcer.requireAcceptedEdition(template("G-639", "2024-12-12"), { entryPoint: "test" })).allowed, true);
  assert.equal((await enforcer.peekAcceptance(template("G-639", "2024-12-12"))).allowed, true);
});

test("the footer must be the SAME edition: the stray G-325R copy dated 2026-10-15 stays held", async () => {
  enforcer.setDepsForTests(deps(null, "2026-09-04"));
  await assert.rejects(enforcer.requireAcceptedEdition(template("G-325R", "2026-10-15"), { entryPoint: "test" }), { code: "EDITION_POLICY_HELD" });
  assert.equal((await enforcer.peekAcceptance(template("G-325R", "2026-10-15"))).allowed, false);
});

test("no footer edition readable: held, as before", async () => {
  enforcer.setDepsForTests(deps(null, null));
  await assert.rejects(enforcer.requireAcceptedEdition(template("G-325R", "2026-09-04"), { entryPoint: "test" }), { code: "EDITION_POLICY_HELD" });
});

test("never over a recorded decision: not accepted / held / stale keep blocking", async () => {
  for (const row of [{ decision: "not_accepted", status: "verified" }, { decision: "held", status: "unverified" }, { decision: "accepted", status: "stale" }]) {
    enforcer.setDepsForTests(deps(row, "2026-09-04"));
    await assert.rejects(enforcer.requireAcceptedEdition(template("G-325R", "2026-09-04"), { entryPoint: "test" }), { code: "EDITION_POLICY_HELD" }, JSON.stringify(row));
  }
});

test("every other form is untouched: no record means held, even with a matching footer", async () => {
  enforcer.setDepsForTests(deps(null, "2026-09-04"));
  await assert.rejects(enforcer.requireAcceptedEdition(template("I-130", "2026-09-04"), { entryPoint: "test" }), { code: "EDITION_POLICY_HELD" });
  assert.equal((await enforcer.peekAcceptance(template("G-325", "2026-09-04"))).allowed, false);
});

// ---- the approved edition of a whole form family: I-485 = 09/18/26, and its supplements ----
const { OWNER_APPROVED_EDITIONS, familyOf } = require("../editionPolicy.constants");

test("the family of a supplement is the number it shares with its form", () => {
  assert.equal(familyOf("I-485"), "I-485");
  for (const code of ["I-485A", "I-485J", "I-485 SUPPLEMENT A", "I-485 Supplement J", "i-485 sup a", "I-485SUPA", "I-485 Supp. J"]) assert.equal(familyOf(code), "I-485", code);
  assert.equal(familyOf("I-4851"), "I-4851");
  assert.equal(familyOf("G-325R"), "G-325");
  assert.equal(familyOf(""), "");
  assert.deepEqual(OWNER_APPROVED_EDITIONS, { "I-485": "2026-09-18" });
});

test("I-485 and every supplement of it are approved at 09/18/26 when the gate holds no record", async () => {
  enforcer.setDepsForTests(deps(null, null)); // the footer is not even needed
  for (const code of ["I-485", "I-485A", "I-485J", "I-485 SUPPLEMENT A", "I-485 SUPPLEMENT J", "I-485SUPA"]) {
    const result = await enforcer.requireAcceptedEdition(template(code, "2026-09-18"), { entryPoint: "test" });
    assert.equal(result.allowed, true, code);
    assert.equal(result.ownerPolicy, "approved_edition", code);
    assert.equal((await enforcer.peekAcceptance(template(code, "2026-09-18"))).allowed, true, code);
  }
});

test("any other edition of the I-485 family stays held: the stray I-485A dated 2026-10-07 is not approved", async () => {
  enforcer.setDepsForTests(deps(null, null));
  for (const date of ["2026-10-07", "2024-04-01", "2026-09-17"]) {
    await assert.rejects(enforcer.requireAcceptedEdition(template("I-485A", date), { entryPoint: "test" }), { code: "EDITION_POLICY_HELD" }, date);
  }
});

test("a recorded decision always wins over the approved-edition policy, and other families are untouched", async () => {
  for (const row of [{ decision: "not_accepted", status: "verified" }, { decision: "held", status: "unverified" }]) {
    enforcer.setDepsForTests(deps(row, null));
    await assert.rejects(enforcer.requireAcceptedEdition(template("I-485A", "2026-09-18"), { entryPoint: "test" }), { code: "EDITION_POLICY_HELD" }, JSON.stringify(row));
  }
  enforcer.setDepsForTests(deps(null, null));
  await assert.rejects(enforcer.requireAcceptedEdition(template("I-130", "2026-09-18"), { entryPoint: "test" }), { code: "EDITION_POLICY_HELD" });
  await assert.rejects(enforcer.requireAcceptedEdition(template("I-486", "2026-09-18"), { entryPoint: "test" }), { code: "EDITION_POLICY_HELD" });
});
