const assert = require("node:assert/strict");
const test = require("node:test");
const { lint, escapeRegExp } = require("../copyLint.service");

const TERMS = ["guaranteed", "approved", "100% success", "legal advice", "visa approval"];

test("copyLint: blocks a hard-prohibited term with word-boundary matching", () => {
  const result = lint("Your visa is guaranteed approved with our help!", TERMS);
  assert.equal(result.clean, false);
  assert.equal(result.severity, "block");
  assert.equal(result.violations.length, 2);
  assert.ok(result.violations.some((v) => v.term === "guaranteed"));
  assert.ok(result.violations.some((v) => v.term === "approved"));
});

test("copyLint: clean marketing copy passes with zero violations", () => {
  const result = lint("We help clients prepare their immigration paperwork carefully and accurately.", TERMS);
  assert.equal(result.clean, true);
  assert.equal(result.severity, "none");
  assert.deepEqual(result.violations, []);
});

test("copyLint: word-boundary matching does not false-positive on substrings", () => {
  // "approved" must not match inside "disapproved" or "approvedly" etc.
  const result = lint("The claim was disapproved by the reviewer.", ["approved"]);
  assert.equal(result.clean, true);
});

test("copyLint: matches a multi-word phrase term", () => {
  const result = lint("We offer a 100% success rate on every filing.", ["100% success"]);
  assert.equal(result.clean, false);
  assert.equal(result.violations[0].term, "100% success");
});

test("copyLint: soft terms produce a warn severity, not block", () => {
  const result = lint("You may be eligible for this visa category.", [], ["eligible"]);
  assert.equal(result.clean, false);
  assert.equal(result.severity, "warn");
  assert.equal(result.violations[0].severity, "warn");
});

test("copyLint: hard terms always outrank soft terms in overall severity", () => {
  const result = lint("You are eligible and this is guaranteed.", ["guaranteed"], ["eligible"]);
  assert.equal(result.severity, "block");
  assert.equal(result.violations.length, 2);
});

test("copyLint: case-insensitive matching", () => {
  const result = lint("GUARANTEED results!", ["guaranteed"]);
  assert.equal(result.clean, false);
});

test("copyLint: is diacritic-insensitive", () => {
  const result = lint("Garantía approvéd results", ["approved"]);
  assert.equal(result.clean, false);
});

test("copyLint: empty text and empty term list are both safe no-ops", () => {
  assert.equal(lint("", TERMS).clean, true);
  assert.equal(lint("guaranteed approved", []).clean, true);
  assert.equal(lint(undefined, TERMS).clean, true);
});

test("copyLint: escapeRegExp neutralizes regex metacharacters in a term", () => {
  const escaped = escapeRegExp("a.b*c?");
  assert.equal(new RegExp(escaped).test("a.b*c?"), true);
  assert.equal(new RegExp(escaped).test("axbyc"), false);
});

test("copyLint: terms are compiled from escaped literals, never as user regex (ReDoS-safety)", () => {
  const adversarialTerm = "(a+)+$";
  const start = process.hrtime.bigint();
  const result = lint("a".repeat(40) + "X", [adversarialTerm]);
  const ms = Number(process.hrtime.bigint() - start) / 1e6;
  assert.ok(ms < 50, `lint() with an adversarial term took ${ms}ms — should be near-instant since terms are escaped literals`);
  assert.equal(result.clean, true); // the literal string "(a+)+$" never appears in the text
});

test("copyLint: performance — a ~5,000 word string lints in under 20ms", () => {
  const words = [];
  while (words.length < 5000) words.push("sentence");
  const longText = `${words.join(" ")} this text also mentions guaranteed approval near the end.`;
  const start = process.hrtime.bigint();
  const result = lint(longText, TERMS);
  const ms = Number(process.hrtime.bigint() - start) / 1e6;
  assert.ok(ms < 20, `lint() on ~5000 words took ${ms}ms, expected < 20ms`);
  assert.equal(result.clean, false);
});
