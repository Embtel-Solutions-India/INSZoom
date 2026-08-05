const { PASSPORT_FIELDS } = require("../schemas/passport-extraction.schema");

function normalizeConfidence(confidence) {
  return Math.max(0, Math.min(100, Number(confidence) || 0));
}

function normalizeField(field) {
  if (field && typeof field === "object" && Object.prototype.hasOwnProperty.call(field, "value")) {
    return {
      value: field.value === undefined ? null : field.value,
      confidence: normalizeConfidence(field.confidence),
    };
  }
  return {
    value: field === undefined ? null : field,
    confidence: field === undefined || field === null || field === "" ? 0 : 70,
  };
}

function normalizePassportExtractionDto(response = {}) {
  const sourceFields = response.fields || response.extractedData || response.passport || response;
  const fields = {};
  PASSPORT_FIELDS.forEach((key) => {
    fields[key] = normalizeField(sourceFields[key]);
  });
  return {
    fields,
    rawText: response.rawText || "",
    entities: {
      passport: PASSPORT_FIELDS.reduce((acc, key) => {
        acc[key] = fields[key].value;
        return acc;
      }, {}),
      validation: response.validation || {},
    },
    evidenceCategories: ["Identity"],
    overallConfidence: normalizeConfidence(response.overallConfidence || averageConfidence(fields)),
    raw: response,
  };
}

function averageConfidence(fields) {
  const values = Object.values(fields || {});
  if (!values.length) return 0;
  return Math.round(values.reduce((sum, field) => sum + normalizeConfidence(field.confidence), 0) / values.length);
}

module.exports = {
  normalizePassportExtractionDto,
};
