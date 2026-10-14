// Adds one visa type to every ACTIVE form template that already serves a sibling visa type (additive $addToSet - nothing is removed or replaced).
//   node scripts/add-visatype-to-templates.js --visa "L-1A Extension" --like "L-1A"            (dry run: lists what would change, writes nothing)
//   node scripts/add-visatype-to-templates.js --visa "L-1A Extension" --like "L-1A" --apply      (writes)
// Why: a case type's forms are found through the registry (VisaFormMapping) AND each template's own visaTypes scope. A newer form edition
// (or an import that skipped the registry scoping) can lack the visa type, so the case reports "no active USCIS form templates".
// The running backend caches templates for up to 5 minutes (USCIS_TEMPLATE_CACHE_TTL_MS); changes show up after that or on restart.
require("dotenv").config({ path: __dirname + "/../.env" });
const mongoose = require("mongoose");

const arg = (name) => { const i = process.argv.indexOf(`--${name}`); return i > -1 ? process.argv[i + 1] : undefined; };
const APPLY = process.argv.includes("--apply");
const VISA = arg("visa");
const LIKE = arg("like");

(async () => {
  if (!VISA || !LIKE) throw new Error('usage: --visa "<new visa type>" --like "<existing visa type>" [--apply]');
  const env = require("../src/config/env");
  await mongoose.connect(env.mongoUri, { serverSelectionTimeoutMS: 15000 });
  const Template = require("../src/models/USCISFormTemplate");
  const VisaFormMapping = require("../src/models/VisaFormMapping");

  // only forms the registry really lists for the new visa type are touched
  const rows = await VisaFormMapping.find({ visaType: VISA, active: true }).select("formNumber formTemplateFormCode").lean();
  const codes = new Set(rows.map((row) => String(row.formTemplateFormCode || row.formNumber).toUpperCase()));
  const candidates = await Template.find({ status: "active", visaTypes: LIKE }).select("formCode version visaTypes").lean();
  const targets = candidates.filter((t) => codes.has(String(t.formCode).toUpperCase()) && !t.visaTypes.includes(VISA));

  console.log(APPLY ? "APPLY" : "DRY RUN", "| db:", mongoose.connection.name);
  console.log(`registry lists ${VISA} for: ${[...codes].join(", ") || "(nothing)"}`);
  console.log(`active templates serving ${LIKE}: ${candidates.map((t) => `${t.formCode}${t.visaTypes.includes(VISA) ? "(already has)" : ""}`).join(", ") || "(none)"}`);
  console.log("will add to:", targets.map((t) => `${t.formCode} ${t.version} [${t.visaTypes.length} -> ${t.visaTypes.length + 1} visa types]`).join(" | ") || "(nothing to do)");

  if (APPLY && targets.length) {
    const result = await Template.updateMany({ _id: { $in: targets.map((t) => t._id) } }, { $addToSet: { visaTypes: VISA } });
    console.log("updated:", result.modifiedCount);
  } else if (!APPLY && targets.length) {
    console.log("re-run with --apply to write.");
  }
  await mongoose.disconnect();
})().catch((error) => { console.error("ERR", error.message); process.exit(1); });
