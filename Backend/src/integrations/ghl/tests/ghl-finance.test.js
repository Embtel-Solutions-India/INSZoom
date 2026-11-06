// GoHighLevel money -> case finance (US dollars). DB-free: the Case model and every GoHighLevel call are stubbed.
const test = require("node:test");
const assert = require("node:assert/strict");
const Case = require("../../../models/Case");
const fin = require("../ghlFinance");

const IDS = { uscis_fee: "f-uscis", qb_amount_paid: "f-paid", qb_invoice_no: "f-inv" };
const field = (id, value) => ({ id, fieldValueString: value });

test("amounts are read as plain US dollars, in any common typing", () => {
  assert.equal(fin.parseMoney("50"), 50);
  assert.equal(fin.parseMoney(" $1,200.50 "), 1201, "whole dollars: cents are rounded");
  assert.equal(fin.parseMoney("1 200"), 1200);
  assert.equal(fin.parseMoney(10000), 10000, "the card's Value is already dollars: never divided or multiplied by 100");
  assert.equal(fin.parseMoney("12.345"), 12);
  assert.equal(fin.parseMoney("0.4"), 0);
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

// ---- editing from Immiglance (two-way) ----
const findByIdOf = (doc) => () => ({ select: () => ({ lean: async () => doc }) });

test("an edit in Immiglance is validated, keeps the figures it did not touch, and is queued for GoHighLevel while the card's older figures are held back", async (t) => {
  const env = require("../../../config/env");
  const aux = require("../ghlAuxOutbound");
  const finance = require("../../../modules/finance/caseFinance.service");
  const writes = [];
  t.mock.method(Case, "updateOne", async (filter, update) => { writes.push(update); return { modifiedCount: 1, matchedCount: 1 }; });
  const original = { enabled: env.ghl.enabled, token: env.ghl.token };
  Object.assign(env.ghl, { enabled: true, token: "t" });
  t.after(() => Object.assign(env.ghl, original));
  const queued = [];
  t.mock.method(aux, "queueJob", async (caseId, type) => { queued.push([String(caseId), type]); return null; });

  const card = { _id: "c1", caseNumber: "B1", finance: { totalAmount: 100, uscisFee: 50, amountPaid: 90, invoiceNo: "INV-1", source: "ghl" }, integrations: { ghl: { opportunityId: "o1" } } };
  t.mock.method(Case, "findById", findByIdOf(card));
  await assert.rejects(() => finance.editCaseFinance("c1", { amountPaid: "-5" }, { _id: "u" }), /Amount paid must be an amount/);
  await assert.rejects(() => finance.editCaseFinance("c1", { totalAmount: "abc" }, { _id: "u" }), /Total fees/);
  await assert.rejects(() => finance.editCaseFinance("c1", { totalAmount: 1e12 }, { _id: "u" }), /too large/);

  const result = await finance.editCaseFinance("c1", { amountPaid: "$1,000.50" }, { _id: "u" });
  assert.equal(result.changed, true);
  assert.deepEqual(result.after, { totalAmount: 100, uscisFee: 50, amountPaid: 1001, invoiceNo: "INV-1" }, "only the amount paid changed (rounded to whole dollars)");
  assert.equal(writes[0].$set["finance.pendingPush"], true, "held back from GoHighLevel's older figures until sent");
  assert.equal(writes[0].$set["finance.source"], "ghl");
  assert.equal(writes[0].$push["finance.history"].$each[0].paidDelta, 911, "the history records the signed change");
  assert.deepEqual(queued, [["c1", "push_finance"]]);
  assert.equal(result.ghl.queued, true);

  const same = await finance.editCaseFinance("c1", { amountPaid: 90 }, { _id: "u" });
  assert.equal(same.changed, false, "nothing changed: nothing written, nothing sent");
});

test("a case with no GoHighLevel card is edited and counted locally (source crm) and nothing is queued; an employer matter is refused", async (t) => {
  const aux = require("../ghlAuxOutbound");
  const finance = require("../../../modules/finance/caseFinance.service");
  const writes = [];
  t.mock.method(Case, "updateOne", async (filter, update) => { writes.push(update); return { modifiedCount: 1 }; });
  const queued = [];
  t.mock.method(aux, "queueJob", async (...args) => { queued.push(args); return null; });
  t.mock.method(Case, "findById", findByIdOf({ _id: "c2", caseNumber: "B2", integrations: {} }));
  const result = await finance.editCaseFinance("c2", { totalAmount: 500, uscisFee: 0, amountPaid: 100 }, { _id: "u" });
  assert.equal(result.changed, true);
  assert.equal(writes[0].$set["finance.source"], "crm");
  assert.equal(writes[0].$set["finance.pendingPush"], false);
  assert.equal(queued.length, 0);

  Case.findById.mock.mockImplementation(findByIdOf({ _id: "c3", caseRole: "principal", caseStructure: "employer_employee" }));
  await assert.rejects(() => finance.editCaseFinance("c3", { totalAmount: 5 }, { _id: "u" }), /employer matter/);
});

test("GoHighLevel's older figures never overwrite an edit that is still on its way", async () => {
  const result = await fin.syncCaseFinance({ _id: "c1", finance: { totalAmount: 500, pendingPush: true } }, { id: "o1", monetaryValue: 100, customFields: [] }, { client: { async get() { throw new Error("must not even be asked"); } } });
  assert.deepEqual(result, { changed: false, skipped: "push_pending" });
});

test("the push sends the case's CURRENT figures to the card as Value + fields, clears the marker, and sends again if edited while sending", async (t) => {
  const opportunities = require("../ghlOpportunityService");
  fin._resetFieldCache();
  const sent = [];
  t.mock.method(opportunities, "updateOpportunity", async (id, body) => { sent.push({ id, body }); });
  const docs = [
    { finance: { totalAmount: 100, uscisFee: 50, amountPaid: 90, invoiceNo: "INV-1", updatedAt: new Date("2026-11-06T10:00:00Z") }, integrations: { ghl: { opportunityId: "o1" } } },
    { finance: { totalAmount: 100, uscisFee: 50, amountPaid: 95, invoiceNo: "INV-1", updatedAt: new Date("2026-11-06T10:00:05Z") }, integrations: { ghl: { opportunityId: "o1" } } },
  ];
  let read = 0;
  t.mock.method(Case, "findById", () => ({ select: () => ({ lean: async () => docs[Math.min(read++, docs.length - 1)] }) }));
  const updates = [];
  // the first marker-clear finds the case edited again (no match), the second succeeds
  t.mock.method(Case, "updateOne", async (filter, update) => { updates.push(update); return updates.filter((u) => u.$set && u.$set["finance.pendingPush"] === false).length === 1 ? { modifiedCount: 0, matchedCount: 0 } : { modifiedCount: 1, matchedCount: 1 }; });
  const client = { async get() { return { customFields: [{ fieldKey: "opportunity.uscis_fee", id: "f-uscis" }, { fieldKey: "opportunity.qb_amount_paid", id: "f-paid" }, { fieldKey: "opportunity.qb_invoice_no", id: "f-inv" }] }; } };
  const outcome = await fin.runPushFinance({ caseId: "c1" }, client);
  assert.equal(outcome, "done");
  assert.equal(sent.length, 2, "sent again because the figures changed while sending");
  assert.deepEqual(sent[0].body, { monetaryValue: 100, customFields: [{ id: "f-uscis", field_value: "50" }, { id: "f-paid", field_value: "90" }, { id: "f-inv", field_value: "INV-1" }] });
  assert.equal(sent[1].body.customFields[1].field_value, "95", "the second send carries the newest amount");
  assert.equal(sent[1].id, "o1");
});

test("a case that has no card (any more) is skipped and stops holding anything back", async (t) => {
  t.mock.method(Case, "findById", findByIdOf({ finance: { totalAmount: 5 }, integrations: {} }));
  const updates = [];
  t.mock.method(Case, "updateOne", async (filter, update) => { updates.push(update); return { modifiedCount: 1 }; });
  assert.equal(await fin.runPushFinance({ caseId: "c9" }, {}), "skipped");
  assert.equal(updates[0].$set["finance.pendingPush"], false);
});
