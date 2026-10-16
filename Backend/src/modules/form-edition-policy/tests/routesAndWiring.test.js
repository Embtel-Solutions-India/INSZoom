// Releases 0b-1 / 0b-2: the API is restricted to EXACTLY admin and team_lead; the pipeline reaches the gate only through EditionPolicyEnforcer.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const router = require("../form-edition-policy.routes");
const authorizeRoles = require("../../../middleware/authorizeRoles");
const authenticate = require("../../../middleware/authenticate");
const { EVIDENCE_ROLES } = require("../editionPolicy.constants");

const routes = () => router.stack.filter((layer) => layer.route).map((layer) => `${Object.keys(layer.route.methods)[0].toUpperCase()} ${layer.route.path}`);

test("only the listing, the gate answer and the automatic check are exposed: nobody submits evidence or decides by hand", () => {
  assert.deepEqual(routes().sort(), ["GET /editions", "GET /gate", "POST /auto-check"].sort());
});

test("the allowed roles are exactly admin and team_lead", () => {
  assert.deepEqual([...EVIDENCE_ROLES], ["admin", "team_lead"]);
});

test("every route sits behind authenticate and the exact-role guard (router.use runs first)", () => {
  const guards = router.stack.filter((layer) => !layer.route);
  assert.equal(guards.length, 2);
  assert.equal(guards[0].handle, authenticate, "authentication first");
  assert.equal(router.stack.indexOf(guards[1]) < router.stack.findIndex((layer) => layer.route), true, "the role guard is registered before any route");
});

function runGuard(role, guard) {
  let status = null;
  let nexted = false;
  guard({ user: role === null ? undefined : { role } }, { status(code) { status = code; return { json() {} }; } }, () => { nexted = true; });
  return { status, nexted };
}

test("the role guard lets admin and team_lead through and refuses every other role, including super_admin", () => {
  const guard = router.stack.filter((layer) => !layer.route)[1].handle;
  for (const role of ["admin", "team_lead"]) assert.deepEqual(runGuard(role, guard), { status: null, nexted: true }, role);
  for (const role of ["super_admin", "case_manager", "attorney", "paralegal", "finance", "hr", "client", "user", "reviewer", "employer", "professor", "", "ADMIN", "Admin", "admin ", null]) {
    const result = runGuard(role, guard);
    assert.equal(result.nexted, false, `${JSON.stringify(role)} must not pass`);
    assert.equal(result.status, 403, `${JSON.stringify(role)} gets 403`);
  }
});

test("the guard is the exact-match authorizeRoles, NOT a permission check (which admits super_admin and wildcard holders)", () => {
  const guard = router.stack.filter((layer) => !layer.route)[1].handle;
  // a wildcard / super_admin permission holder with another role is still refused
  assert.equal(runGuard("case_manager", guard).nexted, false);
  const withWildcard = { user: { role: "case_manager", permissions: ["*", "form-edition:*"] } };
  let nexted = false;
  guard(withWildcard, { status() { return { json() {} }; } }, () => { nexted = true; });
  assert.equal(nexted, false, "permissions never grant access to this API");
  assert.equal(typeof authorizeRoles("admin"), "function");
  const source = fs.readFileSync(path.join(__dirname, "..", "form-edition-policy.routes.js"), "utf8");
  const code = source.split("\n").filter((line) => !line.trim().startsWith("//")).join("\n");
  assert.equal(/authorizePermissions/.test(code), false, "authorizePermissions must not be used on this router");
});

// ---- enforcement (0b-2): pipeline files reach the gate ONLY through EditionPolicyEnforcer ----
const SRC = path.join(__dirname, "..", "..", "..");
function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, files);
    else if (entry.name.endsWith(".js")) files.push(full);
  }
  return files;
}
const rel = (file) => path.relative(SRC, file).split(path.sep).join("/");
// code only: comments may talk about the module; what matters is what a file actually imports
const codeOf = (file) => fs.readFileSync(file, "utf8").split(/\r?\n/).filter((line) => !line.trim().startsWith("//")).join("\n");

test("nothing outside the form-edition-policy module imports the gate, the store or the evidence service directly (the enforcer is the only door)", () => {
  const offenders = [];
  for (const file of walk(SRC)) {
    const name = rel(file);
    if (name.startsWith("modules/form-edition-policy/")) continue;
    if (/EditionPolicyGate|EvidenceService|EditionPolicyStore/.test(codeOf(file))) offenders.push(name);
  }
  assert.deepEqual(offenders, []);
});

test("pipeline files (import, lifecycle, registry, mapping, generation, forms) mention only the enforcer", () => {
  for (const dir of ["modules/uscis-forms", "modules/uscis-form-import", "modules/uscis-lifecycle", "modules/form-registry", "modules/form-mapping", "modules/form-generation"]) {
    for (const file of walk(path.join(SRC, dir))) {
      if (file.includes(`${path.sep}tests${path.sep}`)) continue;
      const code = codeOf(file).replace(/EditionPolicyEnforcer/g, "").replace(/form-edition-policy\/EditionPolicyEnforcer/g, "");
      assert.equal(/EditionPolicyGate|EvidenceService|EditionPolicyStore|FormEditionDecision|FormEditionSource/.test(code), false, `${rel(file)} must use the enforcer only`);
    }
  }
});

test("the router is registered once, under /form-edition-policy", () => {
  const index = fs.readFileSync(path.join(SRC, "routes", "index.js"), "utf8");
  assert.equal((index.match(/router\.use\("\/form-edition-policy"/g) || []).length, 1);
  assert.match(index, /router\.use\("\/form-edition-policy", require\("\.\.\/modules\/form-edition-policy\/form-edition-policy\.routes"\)\);/);
});
