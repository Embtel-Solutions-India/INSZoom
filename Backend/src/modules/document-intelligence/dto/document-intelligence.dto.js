function pickAllowed(body = {}, allowed = []) {
  return allowed.reduce((payload, key) => {
    if (Object.prototype.hasOwnProperty.call(body, key)) payload[key] = body[key];
    return payload;
  }, {});
}

function reviewFieldDto(body = {}) {
  return pickAllowed(body, ["fieldId", "key", "value", "reason", "status"]);
}

function extractionQueryDto(query = {}) {
  return pickAllowed(query, ["caseId", "documentId", "documentType", "status", "reviewStatus", "confidenceBand", "page", "limit"]);
}

module.exports = {
  extractionQueryDto,
  reviewFieldDto,
};
