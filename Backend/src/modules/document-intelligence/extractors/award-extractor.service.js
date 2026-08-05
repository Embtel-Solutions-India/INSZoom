const genericExtractor = require("./generic-extractor.service");

async function extract({ document, buffer }) {
  return genericExtractor.extract({ document, buffer, documentType: "award" });
}

module.exports = { extract };
