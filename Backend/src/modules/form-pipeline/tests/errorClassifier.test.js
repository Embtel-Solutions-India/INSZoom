// Phase 1: failure classification, message sanitizing and backoff are pure. DB-free.
const test = require("node:test");
const assert = require("node:assert/strict");
const { classifyError, sanitizeMessage, backoffMs, errorSignature, LeaseLostError } = require("../errorClassifier");
const { ERROR_CLASSES, LIMITS } = require("../pipeline.constants");

const cls = (error) => classifyError(error).class;

test("network failures, timeouts, throttling and server errors are transient (retried with backoff)", () => {
  for (const error of [
    Object.assign(new Error("connect ECONNRESET"), { code: "ECONNRESET" }), Object.assign(new Error("x"), { code: "ETIMEDOUT" }), Object.assign(new Error("aborted"), { name: "AbortError" }),
    Object.assign(new Error("Bad Gateway"), { status: 502 }), Object.assign(new Error("slow down"), { statusCode: 429 }), new Error("fetch failed"), new Error("request timed out after 15000 ms"),
    Object.assign(new Error("dup"), { code: 11000 }),
  ]) assert.equal(cls(error), ERROR_CLASSES.TRANSIENT, error.message);
});

test("a missing or invalid PDF, or a page that does not exist, is BLOCKED (not retried quickly)", () => {
  for (const error of [
    Object.assign(new Error("Could not locate a current PDF for I-9 on uscis.gov"), { statusCode: 422, code: "USCIS_PDF_UNRESOLVED" }),
    Object.assign(new Error("x"), { code: "USCIS_FORM_NOT_STANDALONE", statusCode: 422 }), Object.assign(new Error("not found"), { status: 404 }), new Error("Invalid PDF: no fillable fields"),
    new Error("PDF is encrypted"),
  ]) assert.equal(cls(error), ERROR_CLASSES.BLOCKED, error.message);
  assert.equal(cls(Object.assign(new Error("forbidden"), { status: 403 })), ERROR_CLASSES.TRANSIENT, "an auth hiccup is not a bad PDF");
});

test("an edition-policy hold is HELD, a lost lease is LEASE_LOST, a declared repairable error is REPAIRABLE", () => {
  assert.equal(cls(Object.assign(new Error("held"), { name: "EditionPolicyHeldError", code: "EDITION_POLICY_HELD", status: 409 })), ERROR_CLASSES.HELD);
  assert.equal(cls(new LeaseLostError()), ERROR_CLASSES.LEASE_LOST);
  assert.equal(classifyError(new LeaseLostError()).retryable, false);
  assert.equal(cls(Object.assign(new Error("normalization changed the field count"), { repairable: true })), ERROR_CLASSES.REPAIRABLE);
});

test("an unknown error is transient but flagged unknown, so the attempt limit can dead-letter it", () => {
  const result = classifyError(new Error("something odd"));
  assert.deepEqual([result.class, result.unknown, result.retryable], [ERROR_CLASSES.TRANSIENT, true, true]);
});

test("sanitizeMessage removes secrets, connection strings, tokens and stack lines, and caps the length", () => {
  assert.equal(sanitizeMessage(new Error("failed at mongodb://user:pw@host:27017/db?authSource=admin now")), "failed at [database-uri] now");
  assert.equal(sanitizeMessage("GET https://x.test/a?key=AIzaSyABC123&b=1 failed"), "GET https://x.test/a?key=[redacted]&b=1 failed");
  assert.equal(sanitizeMessage("Authorization: Bearer abcdefghijklmnop1234"), "Authorization=[redacted]");
  assert.equal(sanitizeMessage("token=abc123 and password: hunter2"), "token=[redacted] and password=[redacted]");
  assert.equal(sanitizeMessage("id 0123456789abcdef0123456789abcdef0123 seen"), "id [redacted] seen");
  assert.equal(sanitizeMessage(new Error("first line\n    at Object.<anonymous> (file.js:1:1)\n    at next")), "first line");
  assert.equal(sanitizeMessage("word ".repeat(100)).length, 300);
  assert.equal(sanitizeMessage(undefined), "undefined".slice(0, 0) + "");
});

test("backoff grows exponentially, is capped, and jitters within +/-20%", () => {
  const fixed = (value) => () => value;
  assert.equal(backoffMs(1, { random: fixed(0.5) }), 60000);
  assert.equal(backoffMs(2, { random: fixed(0.5) }), 120000);
  assert.equal(backoffMs(3, { random: fixed(0.5) }), 240000);
  assert.equal(backoffMs(30, { random: fixed(0.5) }), LIMITS.backoffMaxMs, "capped");
  assert.equal(backoffMs(1, { random: fixed(0) }), 48000, "-20%");
  assert.equal(backoffMs(1, { random: fixed(1) }), 72000, "+20%");
  const seen = new Set(Array.from({ length: 50 }, () => backoffMs(4)));
  assert.ok(seen.size > 10, "real randomness spreads retries");
});

test("the error signature that dedupes alerts is stage + class + code", () => {
  assert.equal(errorSignature({ stage: "import", classification: { class: "transient", code: "HTTP_502" } }), "import|transient|HTTP_502");
});
