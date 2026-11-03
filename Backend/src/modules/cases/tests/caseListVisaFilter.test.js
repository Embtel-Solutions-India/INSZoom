// Case list visa filter (2026-11-04): an employer / family matter is listed under a visa when ANY of its employee / beneficiary cases has it
// (a TN matter with an H-1B employee shows under H-1B), for every staff role. DB-free: the real filter builder, Case.distinct stubbed.
const test = require("node:test");
const assert = require("node:assert/strict");
const { Types } = require("mongoose");
const Case = require("../../../models/Case");
const caseService = require("../case.service");

const oid = () => new Types.ObjectId();
const staff = (role) => ({ _id: oid(), role });
const listQuery = (extra = {}) => ({ excludeChildCases: "true", ...extra });

// children: [{ parentCase, visaType }]; distinct("parentCase", filter) answers like MongoDB would for the visa / role / status conditions used
function stubChildren(t, children) {
  const calls = [];
  t.mock.method(Case, "distinct", async (field, filter) => {
    calls.push({ field, filter });
    const pattern = filter.visaType?.$regex ? new RegExp(filter.visaType.$regex, filter.visaType.$options) : null;
    return children.filter((child) => (!pattern || pattern.test(child.visaType)) && (!filter.visaCategory || filter.visaCategory === child.visaCategory)).map((child) => child.parentCase);
  });
  const writes = t.mock.method(Case, "updateMany", async () => ({}));
  return { calls, writes };
}

test("TN matter with an H-1B employee: listed under H-1B (with the direct H-1B matches), not under H-2B - for every staff role", async (t) => {
  const tnMatter = oid();
  const { writes } = stubChildren(t, [{ parentCase: tnMatter, visaType: "TN" }, { parentCase: tnMatter, visaType: "H-1B" }]);
  for (const role of ["admin", "super_admin", "team_lead", "case_manager"]) {
    const h1b = await caseService.resolveStaffListFilter(listQuery({ visaType: "H-1B" }), staff(role));
    const text = JSON.stringify(h1b);
    assert.ok(text.includes(String(tnMatter)), `${role}: the TN matter is included under H-1B`);
    assert.ok(text.includes('"visaType":{"$regex":"H-1B"'), `${role}: cases that are H-1B themselves still match`);
    assert.ok(text.includes('"caseRole":{"$nin":["employee","beneficiary"]}'), `${role}: employee cases stay inside their matter`);
    const h2b = JSON.stringify(await caseService.resolveStaffListFilter(listQuery({ visaType: "H-2B" }), staff(role)));
    assert.ok(!h2b.includes(String(tnMatter)), `${role}: not under H-2B`);
  }
  assert.equal(writes.mock.callCount(), 0, "listing never writes to cases");
});

test("the other filters still apply to the listed rows (status), and a visa category works the same way", async (t) => {
  const matter = oid();
  stubChildren(t, [{ parentCase: matter, visaType: "O-1", visaCategory: "employment" }]);
  const filter = await caseService.resolveStaffListFilter(listQuery({ visaType: "O-1", status: "active" }), staff("team_lead"));
  assert.equal(filter.$and[0].status, "active", "status narrows the rows");
  const byCategory = JSON.stringify(await caseService.resolveStaffListFilter(listQuery({ visaCategory: "employment" }), staff("admin")));
  assert.ok(byCategory.includes(String(matter)));
});

test("no employee has the visa: exactly the plain visa filter (direct matches only); no visa chosen: the list is unchanged", async (t) => {
  const { calls } = stubChildren(t, []);
  const filter = await caseService.resolveStaffListFilter(listQuery({ visaType: "E-2" }), staff("admin"));
  assert.deepEqual(filter.$and[1], { $or: [{ visaType: { $regex: "E-2", $options: "i" } }] });
  calls.length = 0;
  const plain = await caseService.resolveStaffListFilter(listQuery(), staff("case_manager"));
  assert.equal(calls.length, 0, "no visa and no search: no roll-up query at all (case managers see every case)");
  assert.equal(JSON.stringify(plain).includes("assignedCaseManager"), false);
});

test("a search for an employee still lists their employer's matter, and never writes to cases", async (t) => {
  const matter = oid();
  const { writes } = stubChildren(t, [{ parentCase: matter, visaType: "H-1B" }]);
  const filter = await caseService.resolveStaffListFilter(listQuery({ search: "Santosh" }), staff("case_manager"));
  assert.ok(JSON.stringify(filter).includes(String(matter)));
  assert.equal(writes.mock.callCount(), 0);
});
