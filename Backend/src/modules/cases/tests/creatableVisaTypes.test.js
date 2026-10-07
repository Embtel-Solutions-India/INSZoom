// GET /cases/visa-types feeds the Admin "Create case" dropdown: it must list every case type createCase accepts (so a type added to the
// registry is selectable with no frontend change) and surface registry types that createCase would reject. Pure - models stubbed.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const VisaFormMapping = require("../../../models/VisaFormMapping");
const { VISA_CATEGORIES } = require("../../../config/visaCategories");
const controller = require("../case.controller");

async function call(registryTypes) {
  const original = VisaFormMapping.distinct;
  VisaFormMapping.distinct = async () => registryTypes;
  try {
    let body;
    await controller.listCreatableVisaTypes({ user: { role: "admin" } }, { json: (value) => { body = value; } }, (error) => { throw error; });
    return body;
  } finally {
    VisaFormMapping.distinct = original;
  }
}

test("lists every creatable case type with its structure and forms", async () => {
  const body = await call(["H-1B", "Brand New Visa"]);
  assert.equal(body.data.length, Object.keys(VISA_CATEGORIES).length);
  const byType = new Map(body.data.map((entry) => [entry.visaType, entry]));
  assert.equal(byType.get("GC-NVC").noForms, true);
  assert.equal(byType.get("GC-NVC").formCount, 0);
  assert.equal(byType.get("GC-NVC").caseStructure, "single");
  assert.equal(byType.get("PERM").noForms, true);
  assert.equal(byType.get("H-1B").caseStructure, "employer_employee");
  assert.ok(byType.get("H-1B").formCount > 0);
});

test("a registry type createCase cannot create is reported, not silently dropped", async () => {
  const body = await call(["H-1B", "Brand New Visa", "Another Gap"]);
  assert.deepEqual(body.unmapped, ["Another Gap", "Brand New Visa"]);
});

test("the route is declared before /:id", () => {
  const routes = fs.readFileSync(path.join(__dirname, "..", "case.routes.js"), "utf8");
  assert.ok(routes.indexOf('"/visa-types"') > -1 && routes.indexOf('"/visa-types"') < routes.indexOf('router.get("/:id"'));
});
