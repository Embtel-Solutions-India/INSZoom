const router = require("./extractor-router.service");
const genericExtractor = require("./generic-extractor.service");

module.exports = {
  EVIDENCE_HINTS: router.EVIDENCE_HINTS,
  FIELD_SCHEMAS: genericExtractor.FIELD_SCHEMAS,
  extract: router.extract,
  getExtractor: router.getExtractor,
};
