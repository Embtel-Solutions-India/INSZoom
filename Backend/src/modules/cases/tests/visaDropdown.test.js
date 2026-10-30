// DB-free: the one visa dropdown list shared by every portal (config/visaDropdown.js).
// Run with: node --test src/modules/cases/tests/visaDropdown.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const dropdown = require("../../../config/visaDropdown");
const { VISA_CATEGORIES } = require("../../../config/visaCategories");

// the registry as GET /cases/visa-types serves it (same fields), built without a database
const registry = () => Object.entries(VISA_CATEGORIES).map(([visaType, category]) => ({
  visaType, label: category.label || visaType, caseStructure: category.caseStructure, subTypes: category.subTypes || [], noForms: Boolean(category.noForms), hasChecklist: true,
}));

// one curated entry in the Admin source: { value: 'x', label: 'Y' } or { value: 'x', label: 'Y', canonicalLabel: 'Z' } (a label may contain an escaped quote)
const ENTRY = /\{ value: '([^']+)', label: '((?:[^'\\]|\\.)*)'(?:, canonicalLabel: '((?:[^'\\]|\\.)*)')? \}/g;
const unescape = (text) => text.replace(/\\'/g, "'");

test("Admin's fallback copy of the curated list is identical to the backend list, so the two can never drift apart", (t) => {
  const adminFile = path.join(__dirname, "../../../../../Admin/frontend/src/utils/visaOptions.js");
  if (!fs.existsSync(adminFile)) return t.skip("Admin source is not deployed next to the backend");
  const text = fs.readFileSync(adminFile, "utf8").replace(/\r\n/g, "\n");
  const block = text.slice(text.indexOf("export const VISA_TYPE_OPTIONS = ["), text.indexOf("// The dropdown = the curated options above"));
  const parsed = [...block.matchAll(ENTRY)].map((m) => ({ value: m[1], label: unescape(m[2]), ...(m[3] ? { canonicalLabel: unescape(m[3]) } : {}) }));
  assert.ok(parsed.length > 40, "the Admin list was parsed");
  assert.deepEqual(dropdown.VISA_TYPE_OPTIONS, parsed, "Admin/frontend/src/utils/visaOptions.js and Backend/src/config/visaDropdown.js must hold the same curated list");
});

test("the dropdown is the curated options plus every other creatable case type, with no duplicates", () => {
  const options = dropdown.mergeRegistryOptions(registry());
  const values = options.map((o) => o.value);
  assert.equal(new Set(values).size, values.length, "no option is listed twice");
  assert.ok(options.length >= dropdown.VISA_TYPE_OPTIONS.length);
  assert.ok(options.some((o) => o.fromRegistry), "types only the registry knows are merged in");
  assert.ok(!options.some((o) => o.caseStructure === "family" && o.fromRegistry), "family structures are only reachable through the family workflow");
});

test("a case type with no checklist yet is not offered", () => {
  const types = registry().map((t) => (t.visaType === "H-1B" ? { ...t, hasChecklist: false } : t));
  const options = dropdown.mergeRegistryOptions(types);
  assert.ok(!options.some((o) => dropdown.optionKey(o.canonicalLabel || o.label) === "h1b"));
});

test("'Add employee' lists the employer-matter visas with the dropdown's own labels - Admin and the client portal see the same thing", () => {
  const types = registry();
  const options = dropdown.mergeRegistryOptions(types);
  const employer = dropdown.employerEmployeeOptions(options, types);
  const h1b = employer.find((o) => o.visaType === "H-1B");
  assert.equal(h1b.label, "H-1B", "the short dropdown label, not the registry's 'H-1B Specialty Occupation'");
  assert.deepEqual(h1b.subTypes, VISA_CATEGORIES["H-1B"].subTypes);
  assert.ok(employer.every((o) => VISA_CATEGORIES[o.visaType].caseStructure === "employer_employee"));
  // same order as the dropdown
  const order = options.map((o) => dropdown.registryEntryFor(o, types)?.visaType).filter(Boolean);
  const positions = employer.map((o) => order.indexOf(o.visaType));
  assert.deepEqual(positions, [...positions].sort((a, b) => a - b));
});

test("no employer-matter visa is ever lost from 'Add employee'", () => {
  const types = registry();
  const employer = dropdown.employerEmployeeOptions(dropdown.mergeRegistryOptions(types), types).map((o) => o.visaType).sort();
  const expected = Object.entries(VISA_CATEGORIES).filter(([, c]) => c.caseStructure === "employer_employee").map(([v]) => v).sort();
  assert.deepEqual(employer, expected);
});
