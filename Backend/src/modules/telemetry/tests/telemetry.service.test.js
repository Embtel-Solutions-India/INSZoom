const assert = require("node:assert/strict");
const test = require("node:test");
const { isAllowedName, stripDeniedKeys, hashIp } = require("../telemetry.service");

test("isAllowedName accepts every documented event namespace", () => {
  ["quiz.started", "quiz.completed", "lead.created", "consultation.booked", "case.updated", "doc.uploaded"]
    .forEach((name) => assert.equal(isAllowedName(name), true, `${name} should be allowed`));
});

test("isAllowedName rejects an unknown namespace", () => {
  assert.equal(isAllowedName("totally.unknown.event"), false);
  assert.equal(isAllowedName("admin.delete_everything"), false);
  assert.equal(isAllowedName(""), false);
  assert.equal(isAllowedName(undefined), false);
});

test("stripDeniedKeys removes PII keys (case-insensitive) at any depth", () => {
  const input = {
    quizType: "eb1a",
    step: 1,
    email: "person@example.com",
    Nested: { Phone: "555-1234", safeField: "keep me" },
    contacts: [{ Name: "Jane Doe", zip: "94105" }],
  };
  const cleaned = stripDeniedKeys(input);
  assert.equal(cleaned.quizType, "eb1a");
  assert.equal(cleaned.step, 1);
  assert.equal("email" in cleaned, false);
  assert.equal("Phone" in cleaned.Nested, false);
  assert.equal(cleaned.Nested.safeField, "keep me");
  assert.equal("Name" in cleaned.contacts[0], false);
  assert.equal(cleaned.contacts[0].zip, "94105");
});

test("stripDeniedKeys is a safe no-op on primitives, arrays of primitives, null/undefined", () => {
  assert.equal(stripDeniedKeys("hello"), "hello");
  assert.equal(stripDeniedKeys(42), 42);
  assert.equal(stripDeniedKeys(null), null);
  assert.equal(stripDeniedKeys(undefined), undefined);
  assert.deepEqual(stripDeniedKeys([1, 2, 3]), [1, 2, 3]);
});

test("hashIp never returns the raw input and is deterministic for the same input", () => {
  const hash1 = hashIp("203.0.113.42");
  const hash2 = hashIp("203.0.113.42");
  assert.notEqual(hash1, "203.0.113.42");
  assert.equal(hash1, hash2);
  assert.match(hash1, /^[0-9a-f]{64}$/); // sha256 hex digest
});

test("hashIp returns different hashes for different IPs and empty string for no IP", () => {
  assert.notEqual(hashIp("203.0.113.42"), hashIp("203.0.113.43"));
  assert.equal(hashIp(""), "");
  assert.equal(hashIp(undefined), "");
});
