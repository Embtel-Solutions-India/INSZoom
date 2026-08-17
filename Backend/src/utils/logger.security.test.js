const test = require("node:test");
const assert = require("node:assert/strict");
const { redact } = require("./logger");

test("logger redacts credentials, tokens, and immigration PII recursively", () => {
  const result = redact({
    password: "never-log-this",
    nested: { refreshToken: "refresh-secret", passportNumber: "P123456" },
    filter: { email: "client@example.com", caseId: "safe-id" },
    url: "/api/auth/refresh?token=secret-value&safe=1",
  });

  assert.equal(result.password, "[REDACTED]");
  assert.equal(result.nested.refreshToken, "[REDACTED]");
  assert.equal(result.nested.passportNumber, "[REDACTED]");
  assert.equal(result.filter.email, "[REDACTED]");
  assert.equal(result.filter.caseId, "safe-id");
  assert.match(result.url, /token=\[REDACTED\]/);
  assert.doesNotMatch(JSON.stringify(result), /never-log-this|refresh-secret|P123456|client@example.com|secret-value/);
});
