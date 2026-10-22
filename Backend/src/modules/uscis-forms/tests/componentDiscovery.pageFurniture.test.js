// Phase 7.1: the page-header strip used when a re-registered continuation sheet is compared with the same sheet of the previous edition. The original regexes had
// lost their backslashes (`d+` instead of `\d+`), so they matched nothing and a running header alone made two identical sheets look different.
const assert = require("node:assert/strict");
const test = require("node:test");
const { stripPageFurniture, textSimilarity } = require("../services/USCISFormComponentDiscoveryService");

// the old, broken expression, kept only to prove the new test would have failed on it
const OLD_BROKEN = (text) => text.replace(/Page d+ of d+|Form I-d+ Edition [d/]+/g, "");

const body = "Part 9 Additional Beneficiary Information Complete this sheet for each additional beneficiary Family Name Given Name Date of Birth Country of Birth Country of Citizenship";
const oldPage = `${body} Page 37 of 38 Form I-129 Edition 02/27/26`;
const newPage = `${body} Page 39 of 40 Form I-129 Edition 09/09/26`;

test("page numbers and the edition footer are removed from the text that is compared", () => {
  assert.equal(stripPageFurniture("a Page 3 of 38 b").replace(/\s+/g, " "), "a b");
  assert.equal(stripPageFurniture("a Form I-129 Edition 09/09/26 b").replace(/\s+/g, " "), "a b");
  assert.doesNotMatch(stripPageFurniture(oldPage), /Page|Edition/);
});

test("the form code is generic, not only I-: G-28, N-400, I-864EZ and EOIR-29 footers are removed too", () => {
  for (const footer of ["Form G-28 Edition 09/17/18", "Form N-400 Edition 01/20/25", "Form I-864EZ Edition 08/24/26", "Form EOIR-29 Edition 02/01/26"]) {
    assert.equal(stripPageFurniture(`x ${footer} y`).replace(/\s+/g, " "), "x y", footer);
  }
});

test("two identical sheets with different running headers compare as the same (this fails with the old regexes)", () => {
  assert.ok(textSimilarity(stripPageFurniture(oldPage), stripPageFurniture(newPage)) >= 0.99);
  // the old expression leaves the header tokens in, so the same two sheets score lower
  assert.ok(textSimilarity(OLD_BROKEN(oldPage), OLD_BROKEN(newPage)) < textSimilarity(stripPageFurniture(oldPage), stripPageFurniture(newPage)));
  assert.equal(OLD_BROKEN("Page 3 of 38"), "Page 3 of 38", "the old expression removed nothing");
});

test("a real content change still shows as a difference", () => {
  const changed = "Section 7 Totally Different Subject Matter Unrelated Wording Appears Here Instead Of The Old Sheet Page 39 of 40";
  assert.ok(textSimilarity(stripPageFurniture(oldPage), stripPageFurniture(changed)) < 0.7);
});

test("empty or missing text never throws", () => {
  assert.equal(stripPageFurniture(undefined), "");
  assert.equal(stripPageFurniture(null), "");
});
