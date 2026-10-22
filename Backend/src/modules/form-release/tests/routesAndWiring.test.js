// Phase 3 wiring, DB-free: the release routes and their guards, and that the recovery sweeps are started by the API process and can only resume / recover.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const router = require("../form-release.routes");

const src = (file) => fs.readFileSync(path.join(__dirname, "..", "..", "..", file), "utf8");
const codeOf = (text) => text.split(/\r?\n/).filter((line) => !line.trim().startsWith("//")).join("\n");

test("the release API has exactly these six routes", () => {
  const routes = router.stack.filter((layer) => layer.route).map((layer) => `${Object.keys(layer.route.methods)[0].toUpperCase()} ${layer.route.path}`).sort();
  assert.deepEqual(routes, [
    "GET /forms/:formCode/migration-plan", "GET /migration-snapshots", "GET /templates/:id/gate", "POST /forms/:formCode/rollback", "POST /migration-snapshots/:id/restore", "POST /reconcile",
  ]);
  for (const layer of router.stack.filter((item) => item.route)) assert.ok(layer.route.stack.length >= 3, `${layer.route.path} is behind authenticate + a role guard`);
});

test("pre-images hold client answers: reading and restoring them is exactly `admin`, a restore defaults to a dry run, and the answers are never returned", () => {
  const routes = codeOf(src("modules/form-release/form-release.routes.js"));
  assert.match(routes, /const SNAPSHOT_ROLES = \["admin"\]/);
  assert.match(routes, /\.select\("-preImage -intermediateImage"\)/, "the listing excludes the stored answers");
  assert.match(routes, /dryRun: req\.body\?\.dryRun !== false/, "a restore is a dry run unless the caller says otherwise");
  assert.equal(/preImage/.test(routes.replace(/-preImage -intermediateImage/, "")), false, "nothing else in the routes touches the pre-image");
  assert.match(routes, /const CHANGE_ROLES = \["super_admin", "admin"\]/);
});

test("the API process starts the recovery sweeps, under a job lock, and they only resume / recover", () => {
  assert.match(codeOf(src("server.js")), /startFormReleaseMaintenance\(\{ withJobLock \}\)/);
  const job = codeOf(src("modules/form-release/index.js"));
  assert.match(job, /withJobLock\("form-release-reconcile"/);
  assert.match(job, /reconcilePromotions/);
  assert.match(job, /reconcileIncompleteMigrations/);
  assert.equal(/migrateCaseFormsToEdition|\.activate\(/.test(job), false, "the sweep never starts a migration or an activation of its own");
});

test("the form release routes are mounted", () => {
  assert.match(codeOf(src("routes/index.js")), /router\.use\("\/form-release", require\("\.\.\/modules\/form-release\/form-release\.routes"\)\)/);
});

test("nothing outside the lifecycle service makes an edition live: the release module only reads", () => {
  for (const file of ["certPolicy.js", "markerCertification.js", "ReleaseGate.js", "index.js", "form-release.routes.js"]) {
    const code = codeOf(src(`modules/form-release/${file}`));
    assert.equal(/status:\s*"active"\s*\}?\s*\}\s*\)?\s*;?\s*$/m.test("") || /\$set:[^}]*status:\s*"active"/.test(code), false, `${file} does not set an edition live`);
  }
});
