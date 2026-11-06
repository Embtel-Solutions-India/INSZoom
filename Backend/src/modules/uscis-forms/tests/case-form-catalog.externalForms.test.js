const assert = require("node:assert/strict");
const test = require("node:test");
const catalog = require("../case-form-catalog.service");
const USCISFormTemplate = require("../../../models/USCISFormTemplate");
const VisaFormMapping = require("../../../models/VisaFormMapping");
const USCISFormComponentDefinition = require("../../../models/USCISFormComponentDefinition");

// DB-free: the models' queries are stubbed. A Case Manager's form catalogue offers the two DOL ETA-9089 forms (fetched from dol.gov by the pipeline) like any USCIS form,
// and still never offers another DOL / DOS form.
const chain = (rows) => ({ select: () => ({ lean: async () => rows }) });
const template = (formCode, sourceUrl, extra = {}) => ({ _id: `t-${formCode}`, formCode, title: formCode, status: "active", mappingStatus: "active", officialStatus: "current", editionDate: new Date("2026-11-07"), version: "v1", artifacts: { form: { sourceUrl } }, ...extra });

async function entriesFor({ templates, mappings = [] }) {
  const original = { t: USCISFormTemplate.find, m: VisaFormMapping.find, c: USCISFormComponentDefinition.find };
  USCISFormTemplate.find = () => chain(templates);
  VisaFormMapping.find = () => chain(mappings);
  USCISFormComponentDefinition.find = () => chain([]);
  catalog.clearCache();
  try { return await catalog.loadEntries(); } finally { USCISFormTemplate.find = original.t; VisaFormMapping.find = original.m; USCISFormComponentDefinition.find = original.c; catalog.clearCache(); }
}

test("the two DOL forms are selectable and provisionable; a USCIS form is unchanged; another DOL form is still excluded", async () => {
  const dol = "https://www.dol.gov/sites/dolgov/files/ETA/oflc/pdfs/ETA-9089-AppendixA-Expires02-28-29.pdf";
  const entries = await entriesFor({
    templates: [template("ETA-9089A", dol), template("ETA-9089FD", "https://www.dol.gov/sites/dolgov/files/ETA/oflc/pdfs/ETA-9089-Final-Determination-Expires02-28-29.pdf"), template("I-485", "https://www.uscis.gov/sites/default/files/document/forms/i-485.pdf"), template("ETA-9035", "https://www.dol.gov/x.pdf")],
    mappings: [{ formNumber: "ETA-9035", agency: "DOL", visaType: "H-2B" }],
  });
  const byCode = Object.fromEntries(entries.filter((entry) => entry.kind === "form").map((entry) => [entry.formCode, entry]));
  for (const code of ["ETA-9089A", "ETA-9089FD"]) {
    assert.equal(byCode[code].selectable, true, code);
    assert.equal(byCode[code].provisionable, true, code);
    assert.equal(byCode[code].availability, "ready", code);
    assert.equal(byCode[code].agency, "DOL", code);
  }
  assert.equal(byCode["I-485"].agency, "USCIS");
  assert.equal(byCode["I-485"].selectable, true);
  assert.equal(byCode["ETA-9035"], undefined, "any other DOL form is still not offered");
});

test("a form with no agency signal and no external entry is still unverified and not selectable", async () => {
  const entries = await entriesFor({ templates: [template("ZZ-1", "https://example.org/x.pdf")] });
  const zz = entries.find((entry) => entry.formCode === "ZZ-1");
  assert.equal(zz.selectable, false);
  assert.equal(zz.agency, "unverified");
});
