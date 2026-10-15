const assert = require("node:assert/strict");
const test = require("node:test");
const { retryUntilSuccess, isTransient } = require("../resilientRetry");

const noSleep = () => Promise.resolve();

test("retries a transient failure until it succeeds, rotating through the variants", async () => {
  const seen = [];
  const result = await retryUntilSuccess(({ attempt, variant }) => {
    seen.push(variant);
    if (attempt < 3) { const error = new Error("bad gateway"); error.status = 502; throw error; }
    return `ok-${variant}`;
  }, { attempts: 5, variants: ["a", "b", "c"], sleepFn: noSleep });
  assert.equal(result, "ok-c");
  assert.deepEqual(seen, ["a", "b", "c"]);
});

test("treats 400 / 403 / 413 / 429 / 5xx and network errors as retryable", () => {
  [400, 403, 413, 429, 500, 502, 503, 504].forEach((status) => assert.equal(isTransient({ status }), true, String(status)));
  ["ECONNRESET", "ETIMEDOUT", "ENOTFOUND"].forEach((code) => assert.equal(isTransient({ code }), true, code));
});

test("a permanent failure stops immediately (retrying can never help)", async () => {
  let calls = 0;
  await assert.rejects(retryUntilSuccess(() => { calls += 1; const error = new Error("not standalone"); error.code = "USCIS_FORM_NOT_STANDALONE"; throw error; }, { attempts: 5, sleepFn: noSleep }), /not standalone/);
  assert.equal(calls, 1);
});

test("is bounded: after the last attempt the last error is thrown, never swallowed", async () => {
  let calls = 0;
  await assert.rejects(retryUntilSuccess(() => { calls += 1; const error = new Error(`fail ${calls}`); error.status = 503; throw error; }, { attempts: 4, sleepFn: noSleep }), /fail 4/);
  assert.equal(calls, 4);
});

test("onRetry is told about every retry (for logging)", async () => {
  const retries = [];
  await retryUntilSuccess(({ attempt }) => { if (attempt < 3) throw Object.assign(new Error("x"), { status: 500 }); return 1; }, { attempts: 3, sleepFn: noSleep, onRetry: (info) => retries.push(info.attempt) });
  assert.deepEqual(retries, [1, 2]);
});
