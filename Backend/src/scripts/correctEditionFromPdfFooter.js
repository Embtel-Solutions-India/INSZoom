#!/usr/bin/env node
// node src/scripts/correctEditionFromPdfFooter.js --formCode I-589            # dry run (default): reads, reports, writes nothing
// node src/scripts/correctEditionFromPdfFooter.js --formCode I-589 --apply    # writes
//
// Corrects the ACTIVE edition of ONE form whose stored edition date is wrong (typically an import date saved by the version backfill) to the edition USCIS prints
// in the footer of the stored PDF itself - nothing else is used as a source. Everything that carries the edition follows, in the one naming format
// <form>_<yyyy-mm-dd>: editionDate, version, registryId, the stored file ("government/uscis/<FORM>/<yyyy-mm-dd>/<sha256>/<form>_<yyyy-mm-dd>.pdf"), the date source and the
// certification's version label.
//
// Safety: the stored PDF is copied to the new name and the copy is verified byte for byte BEFORE the template is pointed at it; the old file is kept (nothing is
// deleted); the template update is guarded on its current version, so a concurrent change makes it do nothing; the script refuses (writes nothing) when the PDF
// prints no unambiguous edition, when another template of that form already has the new version (unique formCode+version), or when there is not exactly one active
// template (unless --relabelRetiredDuplicate and that other template is retired with no case forms: then only ITS label moves aside, e.g. "2025-01-20-manual-upload").
// Mapping versions keep their old (immutable) formVersion label - they are found through the template, never through that label. Idempotent.
const crypto = require("crypto");
const { extractEditionDate, readPdfText } = require("../modules/uscis-form-import/services/FormMetadataService");

const iso = (date) => (date ? new Date(date).toISOString().slice(0, 10) : null);
const sha256 = (buffer) => crypto.createHash("sha256").update(buffer).digest("hex");
const slug = (formCode) => String(formCode).toLowerCase().replace(/[^a-z0-9-]+/g, "-");

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (!argv[index].startsWith("--")) continue;
    const next = argv[index + 1];
    args[argv[index].slice(2)] = next && !next.startsWith("--") ? next : true;
  }
  return args;
}

/** Every path in `value` whose string equals the old version or contains "/<old>/" - what else carries the wrong edition (reported, not changed). */
function pathsMentioning(value, needle, prefix = "", found = [], depth = 0) {
  if (depth > 6 || value === null || value === undefined) return found;
  if (typeof value === "string") { if (value === needle || value.includes(`/${needle}/`)) found.push(prefix); return found; }
  if (value instanceof Date) return found;
  if (Array.isArray(value)) { if (value.length <= 50) value.forEach((item, i) => pathsMentioning(item, needle, `${prefix}[${i}]`, found, depth + 1)); return found; }
  if (typeof value === "object") for (const [key, item] of Object.entries(value)) pathsMentioning(item, needle, prefix ? `${prefix}.${key}` : key, found, depth + 1);
  return found;
}

/** Pure planning step (no I/O) so it can be tested: what would change for this template given the footer edition. */
function planCorrection({ template, footerEdition, collision, relabelRetired = false, collisionCaseForms = 0 }) {
  const formCode = template.formCode;
  const oldVersion = String(template.version);
  const newVersion = footerEdition;
  const fileName = `${slug(formCode)}_${newVersion}.pdf`;
  const oldKey = template.pdfStorageKey;
  const keyMatch = String(oldKey || "").match(/^(.*)\/([^/]+)\/([0-9a-f]{64})\/([^/]+)$/);
  const alreadyKey = keyMatch && keyMatch[2] === newVersion && keyMatch[4] === fileName;
  const plan = { formCode, oldVersion, newVersion, oldEditionDate: iso(template.editionDate), steps: [], refuse: null };
  if (oldVersion === newVersion && iso(template.editionDate) === newVersion && template.importMetadata?.editionDateSource === "pdf" && alreadyKey) { plan.alreadyCorrect = true; return plan; }
  if (collision && relabelRetired && collision.status === "retired" && collisionCaseForms === 0) {
    // the same edition was uploaded by hand earlier and has since been retired; only its LABEL moves aside (nothing deleted, nothing re-pointed)
    const label = `${newVersion}-${String(collision.importMetadata?.source || "retired").replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`;
    plan.relabel = { _id: collision._id, fromVersion: collision.version, toVersion: label, fromRegistryId: collision.registryId || null, toRegistryId: collision.registryId ? `${formCode}:${label}` : null };
  } else if (collision) { plan.refuse = `another ${formCode} template already has version ${newVersion} (status ${collision.status}, source ${collision.importMetadata?.source || "?"}); the unique formCode+version index would reject the change`; return plan; }
  if (!keyMatch) { plan.refuse = `the stored file key does not have the expected shape: ${oldKey}`; return plan; }
  plan.newKey = `${keyMatch[1]}/${newVersion}/${keyMatch[3]}/${fileName}`;
  plan.set = {
    editionDate: new Date(`${newVersion}T00:00:00.000Z`),
    version: newVersion,
    "importMetadata.editionDateSource": "pdf",
    pdfStorageKey: plan.newKey,
    "artifacts.form.storageKey": plan.newKey,
  };
  if (template.registryId) plan.set.registryId = `${formCode}:${newVersion}`;
  if (template.pdfTemplatePath) plan.set.pdfTemplatePath = plan.newKey;
  if (template.localPdfPath) plan.set.localPdfPath = plan.newKey;
  if (template.artifacts?.form?.storagePath) plan.set["artifacts.form.storagePath"] = plan.newKey;
  if (template.importMetadata?.validationSummary?.certification?.version === oldVersion) plan.set["importMetadata.validationSummary.certification.version"] = newVersion;
  return plan;
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (!args.formCode || args.help) { console.log("usage: node src/scripts/correctEditionFromPdfFooter.js --formCode I-589 [--relabelRetiredDuplicate] [--apply]"); return args.help ? 0 : 2; }
  require("dotenv").config();
  const mongoose = require("mongoose");
  const env = require("../config/env");
  const USCISFormTemplate = require("../models/USCISFormTemplate");
  const storageService = require("../modules/uploads/storage.service");
  await mongoose.connect(env.mongoUri || process.env.MONGODB_URI, { autoIndex: false, autoCreate: false, serverSelectionTimeoutMS: 15000 });
  try {
    const formCode = String(args.formCode).toUpperCase();
    const active = await USCISFormTemplate.find({ formCode, status: "active" }).select("-formFields -definition -mappingGraph -sections -pages -formStructure").lean();
    if (active.length !== 1) { console.log(`REFUSED: expected exactly one active ${formCode} template, found ${active.length}`); return 1; }
    const template = active[0];
    const buffer = await storageService.readBuffer(template.pdfStorageKey);
    const footer = extractEditionDate(await readPdfText(buffer));
    console.log(`${formCode}: stored version ${template.version}, edition ${iso(template.editionDate)}, source ${template.importMetadata?.editionDateSource || "none"}`);
    console.log(`stored PDF ${template.pdfStorageKey} (${buffer.length} bytes, sha256 ${sha256(buffer).slice(0, 16)}...) - footer edition: ${iso(footer) || "NONE / AMBIGUOUS"}`);
    if (!footer) { console.log("REFUSED: the stored PDF prints no unambiguous edition in its footer"); return 1; }
    const footerEdition = iso(footer);
    const collision = await USCISFormTemplate.findOne({ formCode, version: footerEdition, _id: { $ne: template._id } }).select("formCode version registryId status importMetadata.source").lean();
    const CaseForm = require("../models/CaseForm");
    const collisionCaseForms = collision ? await CaseForm.countDocuments({ formTemplateId: collision._id }) : 0;
    const plan = planCorrection({ template, footerEdition, collision, relabelRetired: Boolean(args.relabelRetiredDuplicate), collisionCaseForms });
    console.log("also mentions the old version (reported, not changed):", JSON.stringify(pathsMentioning(template, String(template.version)).filter((p) => !Object.keys(plan.set || {}).includes(p))));
    if (plan.alreadyCorrect) { console.log("Nothing to do: already correct."); return 0; }
    if (plan.refuse) { console.log(`REFUSED: ${plan.refuse}`); return 1; }
    console.log("PLAN:", JSON.stringify({ relabelRetiredDuplicate: plan.relabel || undefined, copyFile: { from: template.pdfStorageKey, to: plan.newKey }, setOnTemplate: plan.set }, null, 1));
    if (!args.apply) { console.log("Dry run: nothing written. Re-run with --apply."); return 0; }

    if (plan.relabel) {
      const moved = await USCISFormTemplate.updateOne({ _id: plan.relabel._id, version: plan.relabel.fromVersion, status: "retired" }, { $set: { version: plan.relabel.toVersion, ...(plan.relabel.toRegistryId ? { registryId: plan.relabel.toRegistryId } : {}) } });
      if (moved.modifiedCount !== 1) throw new Error("the retired duplicate could not be relabelled; nothing else was changed");
      console.log(`relabelled retired duplicate ${plan.relabel.fromVersion} -> ${plan.relabel.toVersion} (registryId ${plan.relabel.fromRegistryId} -> ${plan.relabel.toRegistryId})`);
    }
    const stored = await storageService.storeImmutableBuffer(plan.newKey, buffer);
    const copy = await storageService.readBuffer(stored.key);
    if (sha256(copy) !== sha256(buffer)) throw new Error("the copied file does not match the original; the template was not changed");
    const result = await USCISFormTemplate.updateOne({ _id: template._id, version: template.version }, { $set: plan.set });
    const after = await USCISFormTemplate.findById(template._id).select("version editionDate pdfStorageKey importMetadata.editionDateSource").lean();
    console.log("updated:", JSON.stringify({ matched: result.matchedCount, modified: result.modifiedCount }), "now:", JSON.stringify({ version: after.version, editionDate: iso(after.editionDate), key: after.pdfStorageKey, source: after.importMetadata?.editionDateSource }));
    if (after.version !== footerEdition || iso(after.editionDate) !== footerEdition) { console.log("WARNING: the stored values do not match the plan"); return 1; }
    console.log("Done. The old file was kept. A running server picks the change up when its template cache expires (up to 5 minutes).");
    return 0;
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) main().then((code) => process.exit(code), (error) => { console.error("failed:", error.message); process.exit(1); });

module.exports = { planCorrection, pathsMentioning, main };
