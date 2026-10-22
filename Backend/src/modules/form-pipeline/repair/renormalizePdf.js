// Strategy renormalize_pdf: the stored PDF of a PENDING edition cannot be loaded or exposes fewer fillable fields than were scanned from it (an XFA / object-stream layout
// qpdf has not flattened). Normalizes the stored bytes again, PROVES the result keeps every scanned field name, and only then points the edition at it.
//   - never a live edition (Rule B: repairs work on drafts; the active edition is never mutated in place);
//   - the candidate is checked BEFORE anything changes; if it would lose a field the repair stops with the edition exactly as it was;
//   - the new bytes go to a NEW storage key, the original object is kept untouched;
//   - verify() re-reads the edition and the stored bytes, re-certifies, and requires the checks that failed to pass now; on any doubt it puts the pointers back, restores the
//     previous certification report and removes the new object it created - the edition is exactly as it was.
const crypto = require("crypto");
const { refuses, failedChecksOf, safe } = require("./guard");

const NAME = "renormalize_pdf";
// symptoms of "the PDF layout, not the mapping": unloadable, no fields, fewer fields than scanned
const UNLOADABLE = /0 fillable fields|failed to parse|invalid object|not a valid pdf|expected instance of|xfa|encrypted|could not (?:load|parse)|has \d+ fields but \d+ were scanned/i;
const sha256 = (buffer) => crypto.createHash("sha256").update(buffer).digest("hex");
const nameOf = (field) => field.pdfFieldName || field.fieldName || field.originalName;

function defaults(deps = {}) {
  return {
    Template: deps.Template || require("../../../models/USCISFormTemplate"),
    storage: deps.storage || require("../../uploads/storage.service"),
    normalize: deps.normalize || require("../../../utils/normalizePdf").normalizePdf,
    loadFieldNames: deps.loadFieldNames || (async (buffer) => {
      const { PDFDocument } = require("pdf-lib");
      return (await PDFDocument.load(buffer, { ignoreEncryption: true })).getForm().getFields().map((field) => field.getName());
    }),
    certify: deps.certify || ((template) => require("../../form-mapping/services/FormCertificationService").certify(template, { previous: null })),
    now: deps.now || (() => new Date()),
  };
}

function createRenormalizePdfStrategy(deps = {}) {
  const state = new WeakMap(); // error -> what repair() changed, for verify() / rollback
  const d = () => defaults(deps);

  const matches = safe((error) => {
    if (refuses(error)) return false;
    const failed = failedChecksOf(error);
    if (failed.length) return failed.some((check) => (check.name === "pdf_fillable" || check.name === "fill_roundtrip") && UNLOADABLE.test(check.detail));
    return UNLOADABLE.test(String(error?.message || "")) && /\bpdf\b/i.test(String(error?.message || ""));
  });

  async function templateOf(error, context) {
    const id = error.templateId || context?.job?.artifacts?.newTemplateId;
    if (!id) throw new Error("no pending edition is recorded for this job, so there is nothing to repair");
    const template = await d().Template.findById(id);
    if (!template) throw new Error("the pending edition no longer exists");
    if (template.status === "active") throw new Error("refusing to repair a live edition");
    return template;
  }

  async function repair(error, context) {
    const { Template, storage, normalize, loadFieldNames, now } = d();
    const template = await templateOf(error, context);
    const fromKey = template.pdfStorageKey || template.artifacts?.form?.storageKey;
    if (!fromKey) throw new Error("the edition has no stored PDF");
    const original = await storage.readBuffer(fromKey);
    const expected = (template.formFields || []).map(nameOf).filter(Boolean);
    const candidate = await normalize(original);
    if (!Buffer.isBuffer(candidate) || candidate.subarray(0, 5).toString() !== "%PDF-") throw new Error("normalizing did not produce a PDF");
    const fromSha = sha256(original);
    const toSha = sha256(candidate);
    if (fromSha === toSha) throw new Error("nothing to repair: normalizing produced identical bytes");
    // VERIFY BEFORE CHANGING ANYTHING: the candidate must expose every scanned field name
    const names = new Set(await loadFieldNames(candidate));
    const missing = expected.filter((name) => !names.has(name));
    if (!names.size) throw new Error("the normalized PDF still exposes 0 fillable fields");
    if (missing.length) throw new Error(`the normalized PDF would lose ${missing.length} of ${expected.length} fields (e.g. ${missing[0]}); nothing was changed`);

    const toKey = `${String(fromKey).replace(/\.pdf$/i, "")}.repaired-${toSha.slice(0, 12)}.pdf`;
    const stored = await storage.storeImmutableBuffer(toKey, candidate);
    const record = { strategy: NAME, at: now(), fromKey, toKey, fromSha256: fromSha, sha256: toSha };
    // what to put back, captured BEFORE the pointers change
    const previousCertification = JSON.parse(JSON.stringify(template.importMetadata?.validationSummary?.certification ?? null));
    const previous = { pdfStorageKey: template.pdfStorageKey, storageKey: template.artifacts?.form?.storageKey, storagePath: template.artifacts?.form?.storagePath, checksum: template.artifacts?.form?.checksum, fileSize: template.artifacts?.form?.fileSize };
    await Template.updateOne({ _id: template._id, status: { $ne: "active" } }, {
      $set: { pdfStorageKey: toKey, "artifacts.form.storageKey": toKey, "artifacts.form.storagePath": toKey, "artifacts.form.checksum": toSha, "artifacts.form.fileSize": candidate.length },
      $push: { "importMetadata.validationSummary.repairs": record },
    });
    state.set(error, {
      templateId: template._id, record, createdObject: stored?.duplicate === false, previousCertification, previous,
      target: failedChecksOf(error).filter((check) => check.name === "pdf_fillable" || check.name === "fill_roundtrip").map((check) => check.name),
    });
  }

  async function rollback(snapshot, reason) {
    const { Template, storage } = d();
    try {
      const set = { pdfStorageKey: snapshot.previous.pdfStorageKey, "artifacts.form.storageKey": snapshot.previous.storageKey, "artifacts.form.storagePath": snapshot.previous.storagePath, "artifacts.form.checksum": snapshot.previous.checksum, "artifacts.form.fileSize": snapshot.previous.fileSize };
      const update = { $set: set, $pull: { "importMetadata.validationSummary.repairs": { toKey: snapshot.record.toKey } } };
      // the certification report goes back to what it was - or is removed again when there was none before the repair
      if (snapshot.previousCertification) set["importMetadata.validationSummary.certification"] = snapshot.previousCertification;
      else update.$unset = { "importMetadata.validationSummary.certification": "" };
      await Template.updateOne({ _id: snapshot.templateId }, update);
      if (snapshot.createdObject) await storage.deleteObject(snapshot.record.toKey).catch(() => false); // only the object this repair created; the original is never deleted
    } catch (error) {
      return `${reason}; ROLLBACK ALSO FAILED (${error.message}) - the edition may point at the repaired copy, check it`;
    }
    return reason;
  }

  async function verify(error) {
    const snapshot = state.get(error);
    if (!snapshot) return "FAILED: repair() recorded nothing to verify";
    const { Template, storage, loadFieldNames, certify } = d();
    try {
      const template = await Template.findById(snapshot.templateId);
      if (!template || template.pdfStorageKey !== snapshot.record.toKey) return await rollback(snapshot, "FAILED: the edition does not point at the repaired copy");
      const bytes = await storage.readBuffer(snapshot.record.toKey);
      if (sha256(bytes) !== snapshot.record.sha256) return await rollback(snapshot, "FAILED: the stored repaired copy does not match its checksum");
      const names = new Set(await loadFieldNames(bytes));
      const expected = (template.formFields || []).map(nameOf).filter(Boolean);
      const missing = expected.filter((name) => !names.has(name));
      if (missing.length) return await rollback(snapshot, `FAILED: the repaired copy is missing ${missing.length} field(s) (e.g. ${missing[0]})`);
      if (snapshot.target.length) {
        const report = await certify(template);
        const still = snapshot.target.filter((name) => !(report.checks || []).find((check) => check.name === name && check.passed));
        if (still.length) return await rollback(snapshot, `FAILED: ${still.join(", ")} still fail${still.length === 1 ? "s" : ""} after the repair`);
        return `repaired: ${snapshot.target.join(" and ")} pass now; ${names.size} fields in the PDF, all ${expected.length} scanned field names present; stored as ${snapshot.record.toKey} (the original object is kept)`;
      }
      return `repaired: the normalized PDF exposes ${names.size} fields, all ${expected.length} scanned field names present; stored as ${snapshot.record.toKey} (the original object is kept)`;
    } catch (failure) {
      return await rollback(snapshot, `FAILED: ${failure.message}`);
    }
  }

  return { name: NAME, matches, repair, verify };
}

module.exports = { createRenormalizePdfStrategy, NAME, UNLOADABLE };
