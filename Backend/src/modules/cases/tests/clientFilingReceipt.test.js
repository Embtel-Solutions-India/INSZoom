// The USCIS receipt number the client portal's "Track your case" card shows: only a valid number, nothing else of the filing. DB-free.
const test = require("node:test");
const assert = require("node:assert/strict");
const { clientFilingReceipt } = require("../case.service");

test("a valid receipt number is cleaned and shared alone; anything else shares nothing", () => {
  assert.deepEqual(clientFilingReceipt({ receiptNumber: "ioe 958-9707612", filingFeeCents: 100, carrier: "fedex" }), { receiptNumber: "IOE9589707612" });
  for (const bad of [undefined, null, {}, { receiptNumber: "" }, { receiptNumber: "IOE123" }, { receiptNumber: "123456789012" }]) assert.equal(clientFilingReceipt(bad), null);
});
