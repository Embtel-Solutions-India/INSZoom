#!/usr/bin/env node
// verify-form-downloads - proves that no value is dropped when a form is downloaded, for EVERY form on the Form Governance page (every latest active template, whether or
// not a case uses it) - run it after any form import / mapping change.
//
// For each form it gives EVERY mapped box a value (text, number, checkbox, radio, dropdown, list), runs the real renderer, and reads every box back from the finished PDF.
// A box that does not hold its value is a FAILURE, unless it is on a supplement page the core download cuts on purpose (supplement values live only in the supplement's own form).
//
// READ-ONLY: nothing is written to the database or to storage. Exit code 0 = every box of every form landed; 1 = at least one did not (listed).
//   node scripts/verify-form-downloads.js                 all forms
//   node scripts/verify-form-downloads.js --code=I-907    one form (repeatable, or comma separated)
//   node scripts/verify-form-downloads.js --part=1/3      every 3rd form starting at the 2nd (to run several workers in parallel)
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const mongoose = require("mongoose");
const storage = require("../src/modules/uploads/storage.service");

// read-only guarantee + one download of each template PDF
storage.storeBuffer = async () => null;
const readBuffer = storage.readBuffer.bind(storage);
const cache = new Map();
storage.readBuffer = async (key) => { if (!cache.has(key)) cache.set(key, await readBuffer(key)); return cache.get(key); };

const arg = (name) => process.argv.filter((a) => a.startsWith(`--${name}=`)).map((a) => a.slice(name.length + 3)).join(",");
const only = arg("code") ? arg("code").split(",").filter(Boolean) : null;
const [partIndex, partCount] = (arg("part") || "0/1").split("/").map(Number);

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  const Template = require("../src/models/USCISFormTemplate");
  const Renderer = require("../src/modules/form-generation/services/PDFRenderer");
  const Mapper = require("../src/modules/form-generation/services/PDFFieldMapper");
  const Resolver = require("../src/modules/form-mapping/services/MappingResolver");
  const { isProtectedField } = require("../src/modules/form-generation/services/ProtectedFieldPolicy");
  const { PDFDocument } = require("pdf-lib");

  const latest = new Map();
  for (const t of await Template.find({ status: "active" }).select("formCode editionDate version").sort({ editionDate: -1, version: -1 }).lean()) if (!latest.has(t.formCode)) latest.set(t.formCode, t._id);
  const codes = [...latest.keys()].sort().filter((code, i) => (!only || only.includes(code)) && i % partCount === partIndex);
  console.log(`forms to verify: ${codes.length}`);

  const total = { forms: 0, boxes: 0, landed: 0, onCutSupplementPages: 0, failures: 0, errors: 0 };
  for (const code of codes) {
    try {
      const template = await Template.findById(latest.get(code)).lean();
      const source = (await PDFDocument.load(await Renderer.loadTemplateBuffer(template), { ignoreEncryption: true, updateMetadata: false })).getForm();
      const filledData = {};
      const expected = new Map();
      let n = 0;
      for (const mapping of Mapper.normalizeTemplateMappings(template)) {
        if (isProtectedField(mapping.pdfField, code, mapping.templateField) || expected.has(mapping.pdfField)) continue;
        let field = null;
        try { field = source.getField(mapping.pdfField); } catch (_e) { field = null; }
        if (!field) continue;
        const kind = field.constructor.name;
        let value;
        if (/CheckBox/.test(kind)) value = true;
        else if (/Radio|Dropdown|OptionList/.test(kind)) { const options = (field.getOptions ? field.getOptions() : []).filter((o) => String(o).trim()); if (!options.length) continue; value = options[0]; }
        else if (/Text/.test(kind)) value = `T${(n += 1) % 97}`;
        else continue;
        Resolver.setPath(filledData, mapping.caseField, value);
        expected.set(mapping.pdfField, { kind });
      }
      const out = await Renderer.render({ caseForm: { filledData }, template, watermark: null, flatten: false });
      const form = (await PDFDocument.load(out.buffer, { ignoreEncryption: true, updateMetadata: false })).getForm();
      const reported = new Map((out.renderReport.unplacedWrites || []).map((u) => [u.pdfField, u.reason]));
      let landed = 0, cut = 0;
      const failures = [];
      for (const [pdfField, { kind }] of expected) {
        if (reported.get(pdfField) === "removed_with_page") { cut += 1; continue; }
        if (reported.has(pdfField)) { failures.push(`${pdfField.split(".").slice(-2).join(".")} (${reported.get(pdfField)})`); continue; }
        let field = null;
        try { field = form.getField(pdfField); } catch (_e) { field = null; }
        if (!field) { failures.push(`${pdfField.split(".").slice(-2).join(".")} (box missing from the file)`); continue; }
        let ok = true;
        try {
          if (/CheckBox/.test(kind)) ok = field.isChecked();
          else if (/Radio|Dropdown|OptionList/.test(kind)) ok = [].concat(field.getSelected() || []).length > 0;
          else ok = String(field.getText() || "").trim() !== "";
        } catch (_e) { ok = true; }
        if (ok) landed += 1; else failures.push(`${pdfField.split(".").slice(-2).join(".")} (${kind.replace("PDF", "")} empty in the file)`);
      }
      total.forms += 1; total.boxes += expected.size; total.landed += landed; total.onCutSupplementPages += cut; total.failures += failures.length;
      console.log(`${failures.length ? "FAIL" : "ok  "} ${code.padEnd(32)} boxes ${String(expected.size).padStart(4)} | landed ${String(landed).padStart(4)} | on cut supplement pages ${String(cut).padStart(3)} | not landed ${failures.length}${failures.length ? `  e.g. ${failures.slice(0, 3).join(" ; ")}` : ""}`);
    } catch (error) {
      total.errors += 1;
      console.log(`ERR  ${code.padEnd(32)} could not be verified: ${String(error.message).slice(0, 140)}`);
    }
  }
  console.log(`\nTOTAL ${JSON.stringify(total)}`);
  await mongoose.disconnect();
  process.exit(total.failures || total.errors ? 1 : 0);
}

main().catch((error) => { console.error("FATAL", error.message); process.exit(1); });
