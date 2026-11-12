// The reconcile fast path: an opportunity that provably matches its case costs no queries; anything that differs takes the full path. Pure, DB-free.
const test = require("node:test");
const assert = require("node:assert/strict");
const { isUnchanged } = require("../ghlReconcileService");

const moneyIds = { uscis_fee: "f-fee", qb_amount_paid: "f-paid", qb_invoice_no: "f-inv" };
const mapping = { unifiedStageKey: "case_onboarded" };
const baseCase = () => ({
  _id: "c1", caseRole: "single", clientName: "Asha Rao", clientEmail: "asha@example.com", user: "u1", finance: { totalAmount: 100, uscisFee: 10, amountPaid: 5, invoiceNo: "INV1" },
  integrations: { ghl: { opportunityId: "O1", pipelineId: "P1", pipelineStageId: "S1", unifiedStageKey: "case_onboarded", opportunityStatus: "open", role: "individual", sync: { state: "synced" }, flags: {} } },
});
const baseOpp = () => ({
  id: "O1", name: "Asha Rao", pipelineId: "P1", pipelineStageId: "S1", status: "open", monetaryValue: 100, contact: { email: "asha@example.com" },
  customFields: [{ id: "f-fee", fieldValueString: "10" }, { id: "f-paid", fieldValueString: "5" }, { id: "f-inv", fieldValueString: "INV1" }],
});
const unchanged = (mutate) => { const existing = baseCase(); const opportunity = baseOpp(); mutate?.({ existing, opportunity }); return isUnchanged({ existing, opportunity, mapping, moneyIds }); };

test("an opportunity that matches its case in every respect is unchanged (no queries needed)", () => {
  assert.equal(unchanged(), true);
});

test("each kind of difference takes the full path", () => {
  assert.equal(unchanged(({ opportunity }) => { opportunity.pipelineStageId = "S2"; }), false, "stage moved in GHL");
  assert.equal(unchanged(({ opportunity }) => { opportunity.pipelineId = "P2"; }), false, "moved to the other pipeline");
  assert.equal(unchanged(({ opportunity }) => { opportunity.status = "abandoned"; }), false, "status changed");
  assert.equal(unchanged(({ opportunity }) => { opportunity.name = "Asha R. Rao"; }), false, "card renamed (an individual case follows its card)");
  assert.equal(unchanged(({ existing }) => { existing.integrations.ghl.flags.deletedInGhl = true; }), false, "a deleted-in-GHL flag that may need clearing");
  assert.equal(unchanged(({ existing }) => { existing.integrations.ghl.sync.state = "pending"; }), false, "an outbound change is still pending");
  assert.equal(unchanged(({ existing }) => { existing.integrations.ghl.sync.state = "failed"; }), false);
  assert.equal(unchanged(({ opportunity }) => { opportunity.monetaryValue = 250; }), false, "the card's Value changed");
  assert.equal(unchanged(({ opportunity }) => { opportunity.customFields[1].fieldValueString = "99"; }), false, "QB Amount Paid changed");
  assert.equal(unchanged(({ existing }) => { existing.clientEmail = ""; existing.user = undefined; }), false, "an e-mail GHL has can be filled in");
  assert.equal(unchanged(({ opportunity }) => { delete opportunity.customFields; }), false, "the list did not carry the figures: read the card");
});

test("rules that must not change: an employee card is not renamed from the card; a pending local money edit is not compared; an unmapped stage is never fast", () => {
  assert.equal(unchanged(({ existing, opportunity }) => { existing.caseRole = "employee"; existing.integrations.ghl.role = "employee"; opportunity.name = "Employer, Employee"; }), true);
  assert.equal(unchanged(({ existing, opportunity }) => { existing.finance.pendingPush = true; opportunity.monetaryValue = 999; }), true, "a local edit still on its way is left alone");
  assert.equal(isUnchanged({ existing: baseCase(), opportunity: baseOpp(), mapping: null, moneyIds }), false);
  assert.equal(isUnchanged({ existing: { ...baseCase(), integrations: {} }, opportunity: baseOpp(), mapping, moneyIds }), false);
  assert.equal(unchanged(({ existing }) => { existing.finance = undefined; }), false, "money on the card but none recorded yet");
});
