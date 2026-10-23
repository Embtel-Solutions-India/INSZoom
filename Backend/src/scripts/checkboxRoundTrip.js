#!/usr/bin/env node
// READ-ONLY proof that a ticked checkbox survives save -> stored answer -> downloaded PDF, on EVERY live form.
// For every live (active) template it ticks every checkbox through the REAL Admin save adapter (the exact value the autosave sends), puts those answers on a case form in memory,
// renders the real stored PDF with the real renderer, re-opens the result and counts which boxes are ticked. Nothing is written to the database or storage.
//   node src/scripts/checkboxRoundTrip.js [--forms I-129,I-907] [--out report.json]
const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");

async function loadAdapter() {
  const file = process.env.ADAPTER_FILE || path.resolve(__dirname, "../../../Admin/frontend/src/utils/PDFFieldChangeAdapter.js");
  return import(pathToFileURL(file).href);
}

/** Pure. What the page sends to the server for a ticked box, step by step: the DOM change, then the autosave re-sending the stored answer. */
function savedValueForTick(adapter, field) {
  const name = field.fieldId || field.fieldName;
  const meta = { [name]: {} };
  const dom = adapter.convert({ target: { name, type: "checkbox", checked: true, value: "on" } }, "case-form", {}, { fieldMetaByName: meta });
  const first = dom.error ? "" : dom.value;
  const resend = adapter.convert({ fieldName: name, fieldType: field.fieldType || field.type || "checkbox", value: first }, "case-form", {}, { fieldMetaByName: meta });
  return { dom: first, saved: resend.error ? "" : resend.value };
}

async function main(argv) {
  const get = (flag) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : null; };
  const adapter = await loadAdapter();
  const mongoose = require("mongoose");
  await require("../config/database")();
  const { readOnlyDb } = require("./lib/readOnlyDb");
  const db = readOnlyDb(mongoose.connection.db);
  const FormMappingService = require("../modules/form-mapping/services/FormMappingService");
  const MappingResolver = require("../modules/form-mapping/services/MappingResolver");
  const PDFRenderer = require("../modules/form-generation/services/PDFRenderer");
  const { PDFDocument } = require("pdf-lib");
  const only = (get("--forms") || "").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
  const heads = await db.collection("uscisformtemplates").find({ status: "active", ...(only.length ? { formCode: { $in: only } } : {}) }, { projection: { formCode: 1, version: 1 } }).sort({ formCode: 1 }).toArray();
  const report = [];
  for (const head of heads) {
    const row = { formCode: head.formCode, version: head.version };
    try {
      const template = await db.collection("uscisformtemplates").findOne({ _id: head._id });
      const mappingVersion = await db.collection("uscismappingversions").findOne(template.activeMappingVersionId ? { _id: template.activeMappingVersionId } : { template: template._id, status: "active" }, { sort: { mappingVersion: -1 } });
      const working = JSON.parse(JSON.stringify(template));
      FormMappingService.applyMappingGraph(working, mappingVersion || {});
      const boxes = (working.formFields || []).filter((f) => String(f.fieldType || f.type) === "checkbox" && !f.keepBlank);
      const filledData = {};
      const fieldValues = {};
      let wrongSaved = 0;
      for (const field of boxes) {
        const id = field.fieldId || field.fieldName;
        const { saved } = savedValueForTick(adapter, field);
        if (saved !== "Yes") wrongSaved += 1;
        if (saved) { MappingResolver.setPath(filledData, id, saved); fieldValues[id] = saved; }
      }
      row.checkboxes = boxes.length;
      row.savedAsTicked = Object.keys(fieldValues).length;
      row.savedWrong = wrongSaved;
      const rendered = await PDFRenderer.render({ caseForm: { filledData, fieldValues }, template: working, watermark: null, flatten: false });
      const pdf = await PDFDocument.load(rendered.buffer, { ignoreEncryption: true, updateMetadata: false });
      const form = pdf.getForm();
      const protectedNames = new Set((rendered.renderReport?.protectedFields || []).map((p) => p.pdfField));
      let on = 0; const off = []; let noField = 0;
      for (const field of boxes) {
        const id = field.fieldId || field.fieldName;
        if (!(id in fieldValues)) continue;
        const pdfName = field.pdfFieldName || field.fieldName;
        let widget = null;
        try { widget = form.getField(pdfName); } catch { widget = null; }
        if (!widget) { noField += 1; continue; }
        if (typeof widget.isChecked === "function" && widget.isChecked()) on += 1;
        else off.push({ id: String(id).slice(-60), why: protectedNames.has(pdfName) ? "protected (barcode/signature)" : "not ticked" });
      }
      row.renderedOn = on;
      row.notTicked = off.length;
      row.noPdfField = noField;
      row.notTickedSample = off.slice(0, 5);
      row.renderFailures = (rendered.renderReport?.failedFieldWrites || []).length;
    } catch (error) {
      row.error = String(error.code || error.message).slice(0, 200);
    }
    report.push(row);
    process.stderr.write(`${row.formCode}: ${row.error ? "ERROR " + row.error : `${row.renderedOn}/${row.savedAsTicked} ticked`}\n`);
  }
  const out = get("--out");
  if (out) fs.writeFileSync(out, JSON.stringify(report, null, 1));
  console.log(JSON.stringify(report.map((r) => ({ f: r.formCode, boxes: r.checkboxes, saved: r.savedAsTicked, wrongSaved: r.savedWrong, on: r.renderedOn, off: r.notTicked, noField: r.noPdfField, fail: r.renderFailures, error: r.error })), null, 0));
  await mongoose.disconnect();
  return 0;
}

module.exports = { savedValueForTick };
if (require.main === module) main(process.argv.slice(2)).then((c) => process.exit(c)).catch((e) => { console.error("failed:", e.message); process.exit(1); });
