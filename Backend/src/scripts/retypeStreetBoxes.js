#!/usr/bin/env node
// The importer used to type every PDF box whose name contains "number" as numeric, so "Street Number and Name" boxes rejected every real address ("must be numeric"), and an
// apartment number ("4B") or an international postal code ("SW1A 1AA") was rejected the same way. The importer is fixed (PDFFieldScannerService.inferTextSemanticType); this
// corrects the address boxes already stored in the form templates: street, apartment / suite / floor number, and postal code (a plain US ZIP code stays numeric).
//
//   node src/scripts/retypeStreetBoxes.js                       # DRY RUN (default): counts the boxes per form, writes nothing
//   node src/scripts/retypeStreetBoxes.js --apply               # one atomic update per template (active, review and draft editions)
//   node src/scripts/retypeStreetBoxes.js --only I-130,I-129    # limit to some forms        --skip I-131   # leave some forms out
//
// What changes, for a box whose PDF name is a street, an apartment / suite / floor number or a postal code and whose type is "number": its type becomes text (fieldType / type / semanticType, and the numeric flags of its
// validation are removed), in every place the template keeps a copy of it (the field list, the definition, the form structure and rendering questions, the PDF field map and
// the form nodes of the stored mapping view). Nothing else about the box changes. The stored mapping VERSIONS are history and are not touched (an edge only remembers the box's old type).
// Idempotent: a second run finds nothing. A retired or archived edition is left as it is.
// the PDF names of the address boxes that hold text ("Street..." / "AptSteFlrNumber", "Apt_Ste_Flr_Number", "AptNumber", "Apartment Number" / "PostalCode", "ZIPPostalCode")
const ADDRESS_NAMES = "Street|AptSteFlr|Apt_Ste_Flr|AptNumber|Apartment Number|Postal";
const TYPE_KEYS = ["fieldType", "type", "semanticType"];

// the arrays of a template that hold a copy of a box, with the key that carries the PDF name and the keys that carry the type
const COPIES = [
  { path: "formFields", name: "pdfFieldName", types: TYPE_KEYS, validation: true },
  { path: "definition.fields", name: "pdfFieldName", types: TYPE_KEYS, validation: true },
  { path: "formStructure.questions", name: "fieldName", types: ["type", "fieldType"], validation: true },
  { path: "definition.formStructure.questions", name: "fieldName", types: ["type", "fieldType"], validation: true },
  { path: "definition.metadata.formStructure.questions", name: "fieldName", types: ["type", "fieldType"], validation: true },
  { path: "definition.questions", name: "fieldName", types: ["type", "fieldType"], validation: true },
  { path: "renderingConfiguration.structure.questions", name: "fieldName", types: ["type", "fieldType"], validation: true },
  { path: "pdfFieldMappings", name: "pdfField", types: ["type"] },
  { path: "mappingConfiguration.nodes.form", name: "pdfField", types: ["type"] },
  { path: "mappingGraph.nodes.form", name: "pdfField", types: ["type"] },
];

/** Pure. The update document and array filters for one template; `present` limits it to the arrays the template really has. */
function buildUpdate(present = COPIES.map((copy) => copy.path)) {
  const set = {};
  const unset = {};
  const arrayFilters = [];
  COPIES.filter((copy) => present.includes(copy.path)).forEach((copy, index) => {
    const id = `b${index}`;
    arrayFilters.push({ [`${id}.${copy.name}`]: { $regex: ADDRESS_NAMES, $options: "i" }, $or: copy.types.map((key) => ({ [`${id}.${key}`]: "number" })) });
    copy.types.forEach((key) => { set[`${copy.path}.$[${id}].${key}`] = "text"; });
    if (copy.validation) { unset[`${copy.path}.$[${id}].validation.numeric`] = ""; unset[`${copy.path}.$[${id}].validationRules.numeric`] = ""; }
  });
  return { update: { $set: set, ...(Object.keys(unset).length ? { $unset: unset } : {}) }, arrayFilters };
}

/** Pure. How many boxes of this template match, per copy (used by the dry run and the check after the update). */
function countMatches(template) {
  const out = {};
  for (const copy of COPIES) {
    const value = copy.path.split(".").reduce((node, key) => (node == null ? undefined : node[key]), template);
    if (!Array.isArray(value)) continue;
    out[copy.path] = value.filter((item) => item && new RegExp(ADDRESS_NAMES, "i").test(String(item[copy.name] || "")) && copy.types.some((key) => item[key] === "number")).length;
  }
  return out;
}

async function main(argv = process.argv.slice(2)) {
  const apply = argv.includes("--apply");
  const list = (flag) => { const at = argv.indexOf(flag); return at >= 0 ? String(argv[at + 1] || "").split(",").map((code) => code.trim().toUpperCase()).filter(Boolean) : []; };
  const only = list("--only");
  const skip = list("--skip");
  require("dotenv").config();
  const mongoose = require("mongoose");
  const env = require("../config/env");
  await mongoose.connect(env.mongoUri || process.env.MONGODB_URI, { autoIndex: false, autoCreate: false, serverSelectionTimeoutMS: 15000 });
  try {
    const collection = mongoose.connection.db.collection("uscisformtemplates");
    const heads = await collection.find({ status: { $in: ["active", "review", "draft"] } }, { projection: { formCode: 1, version: 1, status: 1 } }).toArray();
    let boxes = 0;
    let templates = 0;
    let exit = 0;
    for (const head of heads.sort((a, b) => `${a.formCode}${a.version}`.localeCompare(`${b.formCode}${b.version}`))) {
      const code = String(head.formCode).toUpperCase();
      if ((only.length && !only.includes(code)) || skip.includes(code)) continue;
      const projection = Object.fromEntries(COPIES.map((copy) => [copy.path, 1]));
      const doc = await collection.findOne({ _id: head._id }, { projection });
      const before = countMatches(doc);
      const total = before.formFields || 0;
      if (!Object.values(before).some(Boolean)) continue;
      templates += 1;
      boxes += total;
      console.log(`${head.formCode} ${head.version} [${head.status}]: ${total} address box(es) typed number; copies: ${JSON.stringify(before)}`);
      if (!apply) continue;
      const { update, arrayFilters } = buildUpdate(Object.keys(before));
      const result = await collection.updateOne({ _id: head._id }, update, { arrayFilters });
      const after = countMatches(await collection.findOne({ _id: head._id }, { projection }));
      const left = Object.values(after).reduce((sum, n) => sum + n, 0);
      console.log(`   updated ${result.modifiedCount ? "yes" : "no"}; address boxes still typed number: ${left}`);
      if (left) exit = 1;
    }
    console.log(`\n${apply ? "UPDATED" : "DRY RUN"}: ${boxes} box(es) in ${templates} template(s)${apply ? "" : " - nothing written; re-run with --apply"}`);
    return exit;
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) main().then((code) => process.exit(code), (error) => { console.error("failed:", error.stack || error.message); process.exit(1); });

module.exports = { buildUpdate, countMatches, COPIES };
