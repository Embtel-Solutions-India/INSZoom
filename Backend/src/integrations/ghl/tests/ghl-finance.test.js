// GoHighLevel money -> case finance (US dollars). DB-free: the Case model and every GoHighLevel call are stubbed.
const test = require("node:test");
const assert = require("node:assert/strict");
const Case = require("../../../models/Case");
const fin = require("../ghlFinance");

const IDS = { uscis_fee: "f-uscis", qb_amount_paid: "f-paid", qb_invoice_no: "f-inv" };
const field = (id, value) => ({ id, fieldValueString: value });

test("amounts are read as plain US dollars, in any common typing", () => {
  assert.equal(fin.parseMoney("50"), 50);
  assert.equal(fin.parseMoney(" $1,200.50 "), 1200.5);
  assert.equal(fin.parseMoney("1 200"), 1200);
  assert.equal(fin.parseMoney(10000), 10000, "the card's Value is already dollars: never divided or multiplied by 100");
  assert.equal(fin.parseMoney("12.345"), 12.35);
  for (const bad of ["", "abc", "-5", "1e3", null, undefined, NaN]) assert.equal(fin.parseMoney(bad), null, String(bad));
});

test("Value is the total, USCIS Fee and QB Amount Paid come from their fields, a blank field is 0", () => {
  const o = { monetaryValue: 100, customFields: [field("f-uscis", "50"), field("f-paid", "90"), field("f-inv", " INV-7 ")] };
  assert.deepEqual(fin.financeFromOpportunity(o, IDS), { totalAmount: 100, uscisFee: 50, amountPaid: 90, invoiceNo: "INV-7" });
  assert.deepEqual(fin.financeFromOpportunity({ monetaryValue: 10000, customFields: [] }, IDS), { totalAmount: 10000, uscisFee: 0, amountPaid: 0, invoiceNo: "" });
  assert.deepEqual(fin.financeFromOpportunity({}, IDS), { totalAmount: 0, uscisFee: 0, amountPaid: 0, invoiceNo: "" });
});

test("a card with no money leaves a case without finance alone; a change is recorded once; an unchanged card writes nothing", async (t) => {
  const writes = [];
  t.mock.method(Case, "updateOne", async (filter, update) => { writes.push(update.$set); return { modifiedCount: 1 }; });
  const none = await fin.applyFinance({ _id: "c1" }, { totalAmount: 0, uscisFee: 0, amountPaid: 0, invoiceNo: "" });
  assert.equal(none.changed, false);
  assert.equal(writes.length, 0);

  const first = await fin.applyFinance({ _id: "c1" }, { totalAmount: 100, uscisFee: 50, amountPaid: 90, invoiceNo: "" });
  assert.equal(first.changed, true);
  assert.equal(writes[0]["finance.totalAmount"], 100);
  assert.equal(writes[0]["finance.amountPaid"], 90);
  assert.equal(writes[0]["finance.source"], "ghl");
  assert.ok(writes[0]["finance.lastPaymentAt"], "the first payment is dated");

  const same = await fin.applyFinance({ _id: "c1", finance: { totalAmount: 100, uscisFee: 50, amountPaid: 90, invoiceNo: "" } }, { totalAmount: 100, uscisFee: 50, amountPaid: 90, invoiceNo: "" });
  assert.equal(same.changed, false);
  assert.equal(writes.length, 1, "no write when nothing changed (the reconcile pass runs every 30 seconds)");

  const paid = await fin.applyFinance({ _id: "c1", finance: { totalAmount: 100, amountPaid: 90 } }, { totalAmount: 100, uscisFee: 50, amountPaid: 100, invoiceNo: "" });
  assert.equal(paid.changed, true);
  assert.ok(writes[1]["finance.lastPaymentAt"], "a larger amount paid dates a new payment");

  const refunded = await fin.applyFinance({ _id: "c1", finance: { totalAmount: 100, amountPaid: 100 } }, { totalAmount: 100, uscisFee: 0, amountPaid: 60, invoiceNo: "" });
  assert.equal(refunded.changed, true);
  assert.equal("finance.lastPaymentAt" in writes[2], false, "a lower amount is recorded but is not a new payment");
});

test("a sync never throws, whatever goes wrong", async () => {
  const result = await fin.syncCaseFinance({ _id: "c1" }, { id: "o1", monetaryValue: 5, customFields: [] }, { client: { async get() { throw new Error("down"); } } });
  assert.equal(result.changed, false);
  assert.ok(result.error);
  assert.deepEqual(await fin.syncCaseFinance(null, null), { changed: false });
});

test("the finance figures are never part of a client-side case response", () => {
  const caseService = require("../../../modules/cases/case.service");
  for (const role of ["client", "employer", "employee", "beneficiary"]) {
    const out = caseService.serializeCaseForUser({ _id: "c1", caseNumber: "B1", finance: { totalAmount: 100, amountPaid: 50 } }, { role });
    assert.equal("finance" in out, false, role);
  }
  assert.equal(caseService.serializeCaseForUser({ _id: "c1", finance: { totalAmount: 100 } }, { role: "admin" }).finance.totalAmount, 100);
});
