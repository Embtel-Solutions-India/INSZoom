require("dotenv").config({ path: __dirname + "/../.env" });
const mongoose = require("mongoose");
const APPLY = process.argv.includes("--apply");
const T = "L-1A Extension";
(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 15000 });
  const root = __dirname + "/../src/";
  const VFM = require(root + "models/VisaFormMapping");
  const Tpl = require(root + "models/USCISFormTemplate");
  const Pkg = require(root + "models/PackageDefinition");
  const host = new URL(process.env.MONGODB_URI.replace(/\/\/[^@]*@/, "//x@")).host;
  console.log(APPLY ? "APPLY" : "DRY RUN", "db:", mongoose.connection.name, "host:", host);

  // 1) the new case type's form-mapping rows (only rows for this type; nothing else is touched)
  const { mappings } = require(root + "modules/form-registry/seeds/visaFormMappings.seed");
  const ENTRIES = require(root + "modules/form-registry/seeds/checklistMappings.seed").ENTRIES;
  const rows = mappings.filter((m) => m.visaType === T);
  console.log("rows to upsert:", rows.map((r) => r.formNumber).join(", "));
  for (const m of rows) {
    const exists = await VFM.exists({ visaType: m.visaType, formNumber: m.formNumber, componentType: m.componentType });
    console.log("  ", m.formNumber, m.componentType, exists ? "exists" : "new");
    if (APPLY) await VFM.findOneAndUpdate({ visaType: m.visaType, formNumber: m.formNumber, componentType: m.componentType }, { $set: m }, { upsert: true, runValidators: true, setDefaultsOnInsert: true });
  }
  for (const e of ENTRIES.filter((x) => x.visaType === T)) {
    if (APPLY) { const r = await VFM.updateOne({ visaType: e.visaType, formNumber: e.formNumber }, { $set: { checklistMappings: e.checklistMappings } }); if (!r.matchedCount) console.log("  checklist mapping: no row for", e.formNumber); }
  }

  // 2) templates that serve L-1A also list L-1A Extension (additive)
  const tpls = await Tpl.find({ visaTypes: "L-1A", status: "active" }).select("formCode visaTypes").lean();
  console.log("templates serving L-1A:", tpls.map((t) => `${t.formCode}${t.visaTypes.includes(T) ? "(has)" : ""}`).join(", "));
  if (APPLY) await Tpl.updateMany({ visaTypes: "L-1A", status: "active" }, { $addToSet: { visaTypes: T } });

  // 3) petition package: clone of L-1A's under its own key
  const base = await Pkg.findOne({ key: "L-1A" }).lean();
  console.log("L-1A package:", base ? "found" : "MISSING", "| extension package:", (await Pkg.exists({ key: T })) ? "exists" : "new");
  if (APPLY && base) { const { _id, createdAt, updatedAt, __v, ...rest } = base; await Pkg.findOneAndUpdate({ key: T }, { $set: { ...rest, key: T, visaType: T, displayName: "L-1A Extension Intracompany Transferee Petition" } }, { upsert: true }); }

  console.log("rows for type now:", await VFM.countDocuments({ visaType: T }));
  await mongoose.disconnect();
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });
