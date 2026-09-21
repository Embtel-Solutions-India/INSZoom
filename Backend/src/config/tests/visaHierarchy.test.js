const assert = require("node:assert/strict");
const { test } = require("node:test");
const { getParentVisa, resolveWithHierarchyFallback } = require("../visaHierarchy");

test("getParentVisa resolves one hop for a known child", () => {
  assert.equal(getParentVisa("P-1A"), "P-1");
  assert.equal(getParentVisa("P-1"), "P");
  assert.equal(getParentVisa("EB-2 NIW"), "EB-2");
});

test("getParentVisa returns null for a root or unknown visa", () => {
  assert.equal(getParentVisa("H-1B"), null);
  assert.equal(getParentVisa("P"), null);
  assert.equal(getParentVisa("Some Unregistered Visa"), null);
});

test("resolveWithHierarchyFallback never advances past a visa with a non-empty result", async () => {
  const lookup = async (visaType) => (visaType === "L-1A" ? ["I-129"] : []);
  const { result, resolvedVisaType, usedFallback } = await resolveWithHierarchyFallback("L-1A", lookup, (r) => !r.length);
  assert.deepEqual(result, ["I-129"]);
  assert.equal(resolvedVisaType, "L-1A");
  assert.equal(usedFallback, false);
});

test("resolveWithHierarchyFallback walks a multi-level chain (P-1S -> P-1 -> P) until it finds a non-empty result", async () => {
  const lookup = async (visaType) => (visaType === "P" ? ["I-129"] : []);
  const { result, resolvedVisaType, chain, usedFallback } = await resolveWithHierarchyFallback("P-1S", lookup, (r) => !r.length);
  assert.deepEqual(result, ["I-129"]);
  assert.equal(resolvedVisaType, "P");
  assert.equal(usedFallback, true);
  assert.deepEqual(chain, ["P-1S", "P-1", "P"]);
});

test("resolveWithHierarchyFallback reports unresolved when the whole chain is empty", async () => {
  const lookup = async () => [];
  const { unresolved, resolvedVisaType } = await resolveWithHierarchyFallback("EB-2", lookup, (r) => !r.length);
  assert.equal(unresolved, true);
  assert.equal(resolvedVisaType, null);
});
