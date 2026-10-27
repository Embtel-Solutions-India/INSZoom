// DB-free: "Supplement", "Supp." and "Sup" are one word to the form fetcher - every spelling of a supplement resolves to the same official address.
const assert = require("node:assert/strict");
const test = require("node:test");
const { aliasKey, pageUrlFor } = require("../config/formSourceAliases");
const { describeForm } = require("../services/SourceResolver");

test("every spelling of I-485A resolves to uscis.gov/i-485supa", () => {
  for (const spelling of ["I-485A", "I-485 Supplement A", "I-485 Sup A", "I-485 Supp. A", "I-485 SUP. A", "i-485supa", "I-485SUPA"]) {
    assert.equal(aliasKey(spelling), "I-485A", spelling);
    assert.equal(pageUrlFor(spelling), "https://www.uscis.gov/i-485supa", spelling);
    assert.equal(describeForm(spelling).pdfSlugs[0], "i-485supa", spelling);
  }
});

test("other supplements follow the same rule", () => {
  assert.equal(aliasKey("I-485 Sup J"), "I-485J");
  assert.equal(describeForm("I-918 Sup B").pdfSlugs[0], "i-918supb");
  assert.equal(describeForm("I-918 Supplement B").letter, "B");
  assert.equal(describeForm("I-918 Supp. B").base, "I-918");
});

test("the shared form-code search also finds a supplement written with the abbreviation", () => {
  const { SHARED_SCAN } = require("../config/formCodePattern");
  const found = [..."See Form I-485 Sup A and Form I-485 Supplement J.".toUpperCase().matchAll(new RegExp(SHARED_SCAN, "g"))].map((match) => match[1]);
  assert.deepEqual(found, ["I-485 SUP A", "I-485 SUPPLEMENT J"]);
});

test("small letters work too: sup, supp, supp. and supplement in any case", () => {
  for (const spelling of ["i-485 sup a", "i-485 supp a", "i-485 supp. a", "i-485 sup. a", "i-485 supplement a", "I-485 sUp A", "i-485supa", "I-485 SUPP.A"]) {
    assert.equal(aliasKey(spelling), "I-485A", spelling);
    assert.equal(describeForm(spelling).pdfSlugs[0], "i-485supa", spelling);
  }
  assert.equal(aliasKey("i-918 sup b"), "I-918SUPB");
});

test("an EOIR form requested BY CODE is importable; the text scan and the catalog sync still skip it", () => {
  const patterns = require("../config/formCodePattern");
  assert.equal(patterns.isStandaloneFormCode("EOIR-29", "importer", "on"), true);
  assert.equal(patterns.isStandaloneFormCode("EOIR-29", "importer", "off"), false, "with the switch off nothing changes");
  assert.equal(patterns.isStandaloneFormCode("EOIR-29", "sync", "on"), false, "the catalog sync keeps skipping EOIR forms");
  assert.equal(patterns.isStandaloneFormCode("EOIR-ABC", "importer", "on"), false);
  const found = [..."not EOIR-29, H-1B".matchAll(patterns.scanPattern("on"))].map((match) => match[1]);
  assert.deepEqual(found, [], "a mention of EOIR-29 in running text is still not a catalog form");
});

test("a supplement written glued with SUP (I-918SUPA, I-485SUPJ) is a standalone form code", () => {
  const patterns = require("../config/formCodePattern");
  for (const code of ["I-918SUPA", "I-918SUPB", "I-485SUPJ", "I-485SUPA"]) {
    assert.equal(patterns.isStandaloneFormCode(code, "importer", "on"), true, code);
    assert.equal(patterns.isStandaloneFormCode(code, "sync", "on"), true, code);
  }
  assert.equal(patterns.isStandaloneFormCode("I-918SUPAB", "importer", "on"), false);
  assert.equal(patterns.isStandaloneFormCode("I-918SUPA", "importer", "off"), false, "with the switch off nothing changes");
});
