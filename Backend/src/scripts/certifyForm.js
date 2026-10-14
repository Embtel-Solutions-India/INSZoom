// node src/scripts/certifyForm.js I-824 [--apply]
// Code-only production readiness for a form that is already imported: builds its mapping from the verified rules (--apply saves + activates it when valid),
// writes a backup snapshot, then runs the automatic certification and prints the report. Exit code 1 when certification fails.
require("dotenv").config();
const mongoose = require("mongoose");
const env = require("../config/env");
const User = require("../models/User");
const USCISFormTemplate = require("../models/USCISFormTemplate");
const PartyFieldMappingService = require("../modules/form-mapping/services/PartyFieldMappingService");
const FormCertificationService = require("../modules/form-mapping/services/FormCertificationService");
const MappingGraphService = require("../modules/form-mapping/services/MappingGraphService");
const { retryUntilSuccess } = require("../utils/resilientRetry");
const { deriveVisaTypesFromRegistry } = require("../modules/uscis-form-import/seeds/deriveVisaTypesFromRegistry");

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const codes = args.filter((arg) => !arg.startsWith("--")).map((code) => code.toUpperCase());

(async () => {
  await mongoose.connect(env.mongoUri);
  const actor = (await User.findOne({ role: { $in: ["super_admin", "admin"] } }).sort({ createdAt: 1 })) || { role: "super_admin" };
  let allPassed = true;
  for (const code of codes) {
    let template = await USCISFormTemplate.findOne({ formCode: code, status: "active" }).sort({ editionDate: -1 });
    if (!template) { console.log(code, "no active template"); allPassed = false; continue; }
    // scope the template to every visa type the registry assigns this form to (otherwise a case of that type never gets the form provisioned)
    if (apply) {
      const derived = await deriveVisaTypesFromRegistry(code);
      const merged = Array.from(new Set([...(template.visaTypes || []), ...derived]));
      if (merged.length !== (template.visaTypes || []).length) { template.visaTypes = merged; await template.save(); console.log(code, "visa types:", merged.join(", ")); }
    }
    await FormCertificationService.backupTemplate(template, await MappingGraphService.loadCurrentGraph(template).catch(() => null));
    const mapping = await retryUntilSuccess(() => PartyFieldMappingService.apply(template, actor, { ip: "script", headers: {} }, { dryRun: !apply }), { attempts: 4, label: code });
    console.log(code, "mapping:", JSON.stringify({ ...mapping, byConcept: undefined, unmatchedCandidates: undefined }));
    template = await USCISFormTemplate.findById(template._id);
    const report = await FormCertificationService.certify(template, { persist: apply });
    console.log(JSON.stringify(report, null, 1));
    if (!report.passed) allPassed = false;
  }
  await mongoose.disconnect();
  process.exit(allPassed ? 0 : 1);
})().catch((error) => { console.error("Failed:", error.stack || error.message); process.exit(1); });
