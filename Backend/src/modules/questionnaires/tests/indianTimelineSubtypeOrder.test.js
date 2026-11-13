// Indian Timeline Cases: the subtype list of EVERY visa type is alphabetical (so related subtypes such as the Adult ones and the Minor ones sit together), in the backend registry and in
// the Admin New-case picker, and the picker offers exactly the subtypes that the registry and the filing types define (nothing dropped, nothing extra).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const visaCategories = require("../../../config/visaCategories");
const filingTypes = require("../../../config/filingTypes");

const byName = (a, b) => a.localeCompare(b, "en", { sensitivity: "base" });
// Admin picker key -> backend visa type code
const PICKER_TO_VISA = { oci: "OCI", indianetourist: "INDIAN-E-TOURIST-VISA", renunciation: "RENUNCIATION", indianpassportrenewal: "INDIAN-PASSPORT-RENEWAL", uspassportminor: "US-PASSPORT-MINOR" };

function adminPicker() {
  const text = fs.readFileSync(path.join(__dirname, "../../../../../Admin/frontend/src/utils/visaOptions.js"), "utf8");
  const start = text.indexOf("export const INDIAN_TIMELINE_SUBTYPES = {");
  const end = text.indexOf("\n}", start);
  assert.ok(start >= 0 && end > start, "the Admin picker object exists");
  const picker = {};
  let key = "";
  for (const line of text.slice(start, end).split(/\r?\n/)) {
    const k = line.match(/^  ([a-z]+): \[/);
    if (k) { key = k[1]; picker[key] = []; }
    for (const m of line.matchAll(/value: '([A-Za-z0-9_]+)', label: '([^']*)'/g)) picker[key].push({ value: m[1], label: m[2] });
  }
  return picker;
}

test("every Indian Timeline visa type lists its subtypes alphabetically (registry and Admin picker)", () => {
  const picker = adminPicker();
  assert.deepEqual(Object.keys(picker).sort(), Object.keys(PICKER_TO_VISA).sort(), "the picker covers every Indian Timeline visa type");
  for (const [pickerKey, visaType] of Object.entries(PICKER_TO_VISA)) {
    const registry = visaCategories.VISA_CATEGORIES[visaType].subTypes;
    assert.deepEqual(registry, [...registry].sort(byName), `${visaType}: registry subtypes are alphabetical`);
    const labels = picker[pickerKey].map((entry) => entry.label);
    assert.deepEqual(labels, [...labels].sort(byName), `${pickerKey}: picker subtypes are alphabetical`);
    assert.deepEqual(labels, registry, `${pickerKey}: the picker lists exactly the registry's subtypes, in the same order`);
  }
});

test("the picker offers every Indian Timeline filing type, each under its own visa type (none dropped)", () => {
  const picker = adminPicker();
  const indian = filingTypes.listFilingTypes().filter((item) => item.section === "indian_timeline");
  assert.equal(indian.length, 16);
  for (const item of indian) {
    const pickerKey = Object.keys(PICKER_TO_VISA).find((key) => PICKER_TO_VISA[key] === item.visaType);
    assert.ok(pickerKey, `${item.key}: its visa type is in the picker`);
    const entry = picker[pickerKey].find((candidate) => candidate.value === item.key);
    assert.ok(entry, `${item.key} is offered under ${pickerKey}`);
    assert.equal(entry.label, item.label, `${item.key}: same label in the picker and the filing type`);
  }
  assert.equal(Object.values(picker).flat().length, indian.length, "no extra picker entries");
});
