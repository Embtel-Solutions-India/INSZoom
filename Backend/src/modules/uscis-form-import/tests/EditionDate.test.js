// The edition date is resolved once, at import: yyyy-mm-dd, taken from the file itself when it prints one, the USCIS page otherwise - never silently "today".
const assert = require("node:assert/strict");
const test = require("node:test");
const { resolveEdition, normalizeVersion, isoDate, parseEditionDate } = require("../services/FormMetadataService");

const d = (value) => new Date(`${value}T00:00:00.000Z`);

test("version is always yyyy-mm-dd of the edition date (the stored file is <form>_<yyyy-mm-dd>.pdf)", () => {
  const edition = resolveEdition({ printed: d("2026-09-09") });
  assert.equal(edition.version, "2026-09-09");
  assert.equal(`${"I-129".toLowerCase()}_${edition.version}.pdf`, "i-129_2026-09-09.pdf");
  assert.equal(isoDate(parseEditionDate("07/22/2025")), "2025-07-22");
});

test("a date-shaped version passed by a caller is normalised; a deliberate label is kept", () => {
  assert.equal(normalizeVersion("07/22/2025"), "2025-07-22");
  assert.equal(normalizeVersion("2026-9-9"), "2026-09-09");
  assert.equal(normalizeVersion("2026-09-09"), "2026-09-09");
  assert.equal(normalizeVersion("3.0"), "3.0");
  assert.equal(normalizeVersion(""), "");
});

test("the date printed on the PDF wins; the page date is kept separately for like-with-like comparison", () => {
  const edition = resolveEdition({ printed: d("2026-09-15"), page: d("2026-07-28") });
  assert.equal(isoDate(edition.editionDate), "2026-09-15");
  assert.equal(edition.editionDateSource, "pdf");
  assert.equal(isoDate(edition.publishedEditionDate), "2026-07-28");
  assert.equal(edition.version, "2026-09-15");
});

test("without a printed date the page edition is used; with neither the import date is used and marked", () => {
  const fromPage = resolveEdition({ page: d("2026-07-28") });
  assert.equal(fromPage.editionDateSource, "uscis_page");
  assert.equal(fromPage.version, "2026-07-28");
  const none = resolveEdition({ now: d("2026-10-14") });
  assert.equal(none.editionDate, undefined);
  assert.equal(none.editionDateSource, "import_date");
  assert.equal(none.version, "2026-10-14");
});
