// Phase 1 (Generic FORM_COMPONENT slicing) - pure, DB-free unit tests for
// the page-range expansion/validation logic that every render/download path
// now goes through via ComponentPageResolver. No live PDF/DB needed - these
// only exercise expandPageRanges' own math and validation rules.
const assert = require("node:assert/strict");
const test = require("node:test");
const { expandPageRanges, componentPageError } = require("../services/ComponentPageResolver");

const CTX = { parentFormCode: "I-129", componentCode: "I129_TEST" };

test("Test A - single range expands to every page in order", () => {
  const pages = expandPageRanges([{ startPage: 13, endPage: 20 }], 38, CTX);
  assert.deepEqual(pages, [13, 14, 15, 16, 17, 18, 19, 20]);
});

test("Test B - multiple ranges expand, dedupe, and preserve ascending order", () => {
  const pages = expandPageRanges(
    [{ startPage: 13, endPage: 20 }, { startPage: 25, endPage: 27 }],
    38,
    CTX
  );
  assert.deepEqual(pages, [13, 14, 15, 16, 17, 18, 19, 20, 25, 26, 27]);
});

test("Test B2 - out-of-order input ranges still produce ascending output", () => {
  const pages = expandPageRanges(
    [{ startPage: 25, endPage: 27 }, { startPage: 13, endPage: 20 }],
    38,
    CTX
  );
  assert.deepEqual(pages, [13, 14, 15, 16, 17, 18, 19, 20, 25, 26, 27]);
});

test("Test B3 - overlapping ranges dedupe rather than repeating pages", () => {
  const pages = expandPageRanges(
    [{ startPage: 13, endPage: 20 }, { startPage: 18, endPage: 22 }],
    38,
    CTX
  );
  assert.deepEqual(pages, [13, 14, 15, 16, 17, 18, 19, 20, 21, 22]);
});

test("Test C - empty pageRanges throws a controlled error, never a silent full-document fallback", () => {
  assert.throws(
    () => expandPageRanges([], 38, CTX),
    (error) => error.code === "COMPONENT_PAGE_RESOLUTION_FAILED" && error.status === 422
  );
});

test("Test C2 - endPage before startPage throws a controlled error", () => {
  assert.throws(
    () => expandPageRanges([{ startPage: 20, endPage: 13 }], 38, CTX),
    (error) => error.code === "COMPONENT_PAGE_RESOLUTION_FAILED"
  );
});

test("Test C3 - a range exceeding the real PDF's page count throws a controlled error", () => {
  assert.throws(
    () => expandPageRanges([{ startPage: 13, endPage: 50 }], 38, CTX),
    (error) => error.code === "COMPONENT_PAGE_RESOLUTION_FAILED" && /50/.test(error.message) && /38/.test(error.message)
  );
});

test("Test C4 - non-integer/zero startPage throws a controlled error", () => {
  assert.throws(() => expandPageRanges([{ startPage: 0, endPage: 5 }], 38, CTX), (error) => error.code === "COMPONENT_PAGE_RESOLUTION_FAILED");
  assert.throws(() => expandPageRanges([{ startPage: "13", endPage: undefined }], 38, CTX), (error) => error.code === "COMPONENT_PAGE_RESOLUTION_FAILED");
});

test("componentPageError carries structured details for debugging", () => {
  const error = componentPageError("test message", { parentFormCode: "I-129", componentCode: "I129_H", totalPages: 38 });
  assert.equal(error.code, "COMPONENT_PAGE_RESOLUTION_FAILED");
  assert.equal(error.details.parentFormCode, "I-129");
  assert.equal(error.details.componentCode, "I129_H");
});
