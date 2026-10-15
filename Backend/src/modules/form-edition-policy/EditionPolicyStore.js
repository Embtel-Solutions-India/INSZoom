// The persistence the evidence service and the gate use (Release 0b-1). Kept behind a small interface so the service is tested with an in-memory
// fake and the real Mongoose models are only touched when an admin / team lead actually submits evidence or records a decision.
//
// Reads of USCISFormTemplate use a light projection (never formFields / definition / mappingGraph: up to ~16 MB on I-129).

const FormEditionSource = require("../../models/FormEditionSource");
const FormEditionDecision = require("../../models/FormEditionDecision");
const FormEditionAuditEvent = require("../../models/FormEditionAuditEvent");
const USCISFormTemplate = require("../../models/USCISFormTemplate");

const TEMPLATE_PROJECTION = {
  formCode: 1, version: 1, editionDate: 1, status: 1, mappingStatus: 1, officialPdfUrl: 1, pdfStorageKey: 1,
  "artifacts.form.sourceUrl": 1,
  "importMetadata.checksum": 1, "importMetadata.editionDateSource": 1, "importMetadata.publishedEditionDate": 1,
  "lifecycle.sourcePageUrl": 1, "lifecycle.sourceChecksum": 1,
};

function conflict(message) {
  const error = new Error(message);
  error.status = 409;
  error.code = "DECISION_VERSION_CONFLICT";
  return error;
}

const mongoStore = {
  async findDecision(formCode, editionIdentifier) {
    return FormEditionDecision.findOne({ formCode, editionIdentifier }).lean();
  },

  /** expectedVersion null = the row must not exist yet; otherwise the row must still be at that version (optimistic concurrency). */
  async saveDecision(row, expectedVersion) {
    if (expectedVersion === null || expectedVersion === undefined) {
      if (await FormEditionDecision.exists({ formCode: row.formCode, editionIdentifier: row.editionIdentifier })) throw conflict("a decision for this edition was recorded meanwhile; reload and try again");
      const created = await FormEditionDecision.create({ ...row, version: 1 });
      return created.toObject();
    }
    const updated = await FormEditionDecision.findOneAndUpdate(
      { formCode: row.formCode, editionIdentifier: row.editionIdentifier, version: expectedVersion },
      { $set: { ...row, version: expectedVersion + 1 } },
      { new: true, lean: true }
    );
    if (!updated) throw conflict("this edition's decision changed meanwhile; reload and try again");
    return updated;
  },

  async listDecisions() {
    return FormEditionDecision.find({}).lean();
  },

  async insertSnapshot(snapshot) {
    const created = await FormEditionSource.create(snapshot);
    return created.toObject();
  },

  async insertEvent(event) {
    const created = await FormEditionAuditEvent.create(event);
    return created.toObject();
  },

  async listEvents(evidenceCaseId) {
    return FormEditionAuditEvent.find({ evidenceCaseId }).sort({ seq: 1 }).lean();
  },

  async findSnapshot(id) {
    return FormEditionSource.findById(id).lean();
  },

  async findTemplates(formCode) {
    return USCISFormTemplate.find({ formCode }, TEMPLATE_PROJECTION).lean();
  },

  async listTemplates() {
    return USCISFormTemplate.find({}, TEMPLATE_PROJECTION).sort({ formCode: 1 }).lean();
  },
};

module.exports = { mongoStore, TEMPLATE_PROJECTION };
