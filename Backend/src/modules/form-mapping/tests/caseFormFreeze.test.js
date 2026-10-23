// Rule G: ONE definition of a frozen case form, used by every automatic path. DB-free.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { FROZEN_CASE_FORM_STATUSES, isFrozen } = require("../config/caseFormFreeze");
const { FROZEN_STATUSES } = require("../services/CaseFormEditionMigrationService");

const SRC = path.join(__dirname, "..", "..", "..");
const walk = (dir, out = []) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith(".js")) out.push(full);
  }
  return out;
};
const codeOf = (file) => fs.readFileSync(file, "utf8").split(/\r?\n/).filter((line) => !line.trim().startsWith("//")).join("\n");
const rel = (file) => path.relative(SRC, file).split(path.sep).join("/");

test("the frozen list is the union of the three old lists and every value is a case-form status (receipt_received is the one kept defensively)", () => {
  assert.deepEqual([...FROZEN_CASE_FORM_STATUSES].sort(), ["approved", "archived", "filed", "finalized", "generated", "locked", "ready_for_pdf", "receipt_received"]);
  const CaseForm = require("../../../models/CaseForm");
  const valid = CaseForm.schema.path("status").enumValues;
  assert.deepEqual(FROZEN_CASE_FORM_STATUSES.filter((status) => !valid.includes(status)), ["receipt_received"]);
  assert.deepEqual([...FROZEN_STATUSES], [...FROZEN_CASE_FORM_STATUSES]);
  assert.equal(Object.isFrozen(FROZEN_CASE_FORM_STATUSES), true);
});

test("isFrozen: a frozen status or an explicit lock freezes a form; in-progress statuses do not; it works for any form code", () => {
  for (const status of FROZEN_CASE_FORM_STATUSES) assert.equal(isFrozen({ status, formCode: "ANY-FORM" }), true, status);
  for (const status of ["pending", "draft", "ai_filled", "in_review", "under_review", "needs_revision", "rejected"]) assert.equal(isFrozen({ status }), false, status);
  assert.equal(isFrozen({ status: "draft", isLocked: true }), true);
  assert.equal(isFrozen({ status: "draft", isLocked: false }), false);
  assert.equal(isFrozen("filed"), true);
  assert.equal(isFrozen("draft"), false);
  assert.equal(isFrozen(null), false);
  assert.equal(isFrozen(undefined), false);
});

test("no automatic migration path keeps its own list of frozen statuses (only the shared module defines it; other lists have other meanings and are named here)", () => {
  const OTHER_MEANINGS = [
    "form-mapping/config/caseFormFreeze.js",
    "models/CaseForm.js", "models/PetitionPackage.js", // status enums
    "modules/cases/case-workflow-automation.service.js", // "all forms done" check
    "modules/cases/immigration-knowledge-engine.service.js", // protected-from-AI-rewrite set
    "modules/uscis-forms/uscis-form.service.js", // a $nin filter for listing
    "modules/form-generation/services/FilingArtifactPolicy.js", // which statuses count as the FILING step (a download / package rule, not a migration freeze)
    "scripts/formEditionPolicyRolloutReport.js", // FINISHED = no longer worked on (a report bucket, not a freeze)
  ];
  const offenders = walk(SRC)
    .filter((file) => !file.includes(`${path.sep}tests${path.sep}`) && !/\.test\.js$/.test(file))
    .filter((file) => /["']finalized["']\s*,\s*["']filed["']/.test(codeOf(file)))
    .map(rel)
    .filter((name) => !OTHER_MEANINGS.some((allowed) => name.endsWith(allowed)));
  assert.deepEqual(offenders, [], "use FROZEN_CASE_FORM_STATUSES / isFrozen from form-mapping/config/caseFormFreeze.js");
});
