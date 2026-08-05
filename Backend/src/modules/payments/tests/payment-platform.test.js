const assert = require("node:assert/strict");
const test = require("node:test");

const AuditLog = require("../../../models/AuditLog");
const Payment = require("../../../models/Payment");
const PaymentLedgerEntry = require("../../../models/PaymentLedgerEntry");
const PaymentRequest = require("../../../models/PaymentRequest");
const workflowService = require("../../workflows/workflow.service");
const gateway = require("../payment.gateway");
const paymentService = require("../payment.service");
const receiptService = require("../payment-receipt.service");
const router = require("../payment.routes");

const ADMIN_USER = { _id: "reconciliation-test-admin", role: "admin" };

// These tests exercise the real settlement code path (confirmCheckoutSession /
// markCheckoutSessionConfirmed / applyWebhookEvent) end to end, the same way a
// browser return from Stripe or a webhook delivery would, without touching a
// real MongoDB or Stripe. Payment.findOne/findById and .save() are monkey-
// patched onto the single in-memory document under test; .save() still runs
// real Mongoose validation (so the schema's pre("validate") hook fires exactly
// as it would in production) it just skips the actual DB write. Every other
// side effect the settlement path reaches (ledger writes, audit log, workflow
// triggers) is stubbed so the test is fast and deterministic.
function installPaymentPersistenceMocks(paymentDoc) {
  const originals = {
    findOne: Payment.findOne,
    findById: Payment.findById,
    save: Payment.prototype.save,
    ledgerCreate: PaymentLedgerEntry.create,
    requestFindOneAndUpdate: PaymentRequest.findOneAndUpdate,
    auditCreate: AuditLog.create,
    triggerWorkflow: workflowService.triggerWorkflow,
    retrieveCheckoutSession: gateway.retrieveCheckoutSession,
  };
  const ledgerEntries = [];
  Payment.findOne = async () => paymentDoc;
  Payment.findById = async () => paymentDoc;
  Payment.prototype.save = async function realValidateNoDbWrite() {
    await this.validate();
    return this;
  };
  PaymentLedgerEntry.create = async (entry) => {
    ledgerEntries.push(entry);
    return entry;
  };
  PaymentRequest.findOneAndUpdate = async () => null;
  AuditLog.create = async () => null;
  workflowService.triggerWorkflow = async () => [];
  return { ledgerEntries, originals };
}

function restorePaymentPersistenceMocks(originals) {
  Payment.findOne = originals.findOne;
  Payment.findById = originals.findById;
  Payment.prototype.save = originals.save;
  PaymentLedgerEntry.create = originals.ledgerCreate;
  PaymentRequest.findOneAndUpdate = originals.requestFindOneAndUpdate;
  AuditLog.create = originals.auditCreate;
  workflowService.triggerWorkflow = originals.triggerWorkflow;
  gateway.retrieveCheckoutSession = originals.retrieveCheckoutSession;
}

test("confirmCheckoutSession settles a full payment without any webhook, and does not double-credit on retry", async () => {
  const payment = new Payment({
    totalAmount: 50000,
    currency: "usd",
    paymentSchedule: [{ amount: 50000, status: "pending" }],
    transactions: [{ amount: 50000, currency: "usd", gateway: "stripe", status: "pending", stripeSessionId: "cs_test_full1" }],
  });
  const { ledgerEntries, originals } = installPaymentPersistenceMocks(payment);
  gateway.retrieveCheckoutSession = async (sessionId) => ({
    id: sessionId,
    payment_status: "paid",
    amount_total: 50000,
    currency: "usd",
    status: "complete",
    payment_intent: { id: "pi_test_full1", status: "succeeded" },
  });
  try {
    const settled = await paymentService.confirmCheckoutSession("cs_test_full1", ADMIN_USER, {});
    const txn = settled.transactions.find((item) => item.stripeSessionId === "cs_test_full1");
    assert.equal(txn.status, "paid", "transaction must be marked paid");
    assert.equal(settled.amountPaid, 50000);
    assert.equal(settled.paidAmount, 50000);
    assert.equal(settled.remainingAmount, 0);
    assert.equal(settled.paymentStatus, "paid");
    assert.equal(ledgerEntries.length, 1, "exactly one ledger entry must be created");
    assert.equal(ledgerEntries[0].amount, 50000);
    assert.equal(ledgerEntries[0].direction, "credit");

    // Re-invoke with the same session id — simulates the success page reloading
    // or the user hitting back/forward, without a webhook ever having fired.
    const settledAgain = await paymentService.confirmCheckoutSession("cs_test_full1", ADMIN_USER, {});
    assert.equal(settledAgain.amountPaid, 50000, "must not double-credit on retry");
    assert.equal(ledgerEntries.length, 1, "must not write a second ledger entry on retry");
  } finally {
    restorePaymentPersistenceMocks(originals);
  }
});

test("webhook settlement uses the same routine as return-verify and is idempotent with a prior return-verify settlement", async () => {
  const payment = new Payment({
    totalAmount: 50000,
    currency: "usd",
    paymentSchedule: [{ amount: 50000, status: "pending" }],
    transactions: [{ amount: 50000, currency: "usd", gateway: "stripe", status: "pending", stripeSessionId: "cs_test_wh1" }],
  });
  const { ledgerEntries, originals } = installPaymentPersistenceMocks(payment);
  gateway.retrieveCheckoutSession = async (sessionId) => ({
    id: sessionId,
    payment_status: "paid",
    amount_total: 50000,
    currency: "usd",
    status: "complete",
    payment_intent: { id: "pi_test_wh1", status: "succeeded" },
  });
  try {
    // Return-verify settles first, exactly as it must in dev without `stripe listen`.
    await paymentService.confirmCheckoutSession("cs_test_wh1", ADMIN_USER, {});
    assert.equal(payment.amountPaid, 50000);
    assert.equal(ledgerEntries.length, 1);

    // The webhook for the same payment_intent arrives afterward (Stripe retry,
    // or `stripe listen` was also running). Must settle via the exact same
    // markTransactionSucceeded routine and must not double-credit.
    const event = {
      id: "evt_test_wh1",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_test_wh1",
          payment_status: "paid",
          amount_total: 50000,
          currency: "usd",
          payment_intent: "pi_test_wh1",
          metadata: {},
        },
      },
    };
    const afterWebhook = await paymentService.applyWebhookEvent(event, {});
    assert.equal(afterWebhook.amountPaid, 50000, "webhook must not double-credit a session return-verify already settled");
    assert.equal(ledgerEntries.length, 1, "webhook must not write a second ledger entry for an already-settled transaction");
  } finally {
    restorePaymentPersistenceMocks(originals);
  }
});

test("an installment (partial) payment settles correctly and computes the remaining balance", async () => {
  const payment = new Payment({
    totalAmount: 100000,
    currency: "usd",
    planKey: "two_installments",
    paymentSchedule: [
      { amount: 50000, status: "pending", installment: 1 },
      { amount: 50000, status: "pending", installment: 2 },
    ],
    transactions: [{ amount: 50000, currency: "usd", gateway: "stripe", status: "pending", stripeSessionId: "cs_test_partial1" }],
  });
  const { ledgerEntries, originals } = installPaymentPersistenceMocks(payment);
  gateway.retrieveCheckoutSession = async (sessionId) => ({
    id: sessionId,
    payment_status: "paid",
    amount_total: 50000,
    currency: "usd",
    status: "complete",
    payment_intent: { id: "pi_test_partial1", status: "succeeded" },
  });
  try {
    const settled = await paymentService.confirmCheckoutSession("cs_test_partial1", ADMIN_USER, {});
    assert.equal(settled.amountPaid, 50000);
    assert.equal(settled.remainingAmount, 50000);
    assert.equal(settled.paymentStatus, "partially_paid");
    assert.equal(settled.status, "partial");
    assert.equal(ledgerEntries.length, 1);
  } finally {
    restorePaymentPersistenceMocks(originals);
  }
});

test("an unpaid checkout session never settles and never reports false success", async () => {
  const payment = new Payment({
    totalAmount: 50000,
    currency: "usd",
    paymentSchedule: [{ amount: 50000, status: "pending" }],
    transactions: [{ amount: 50000, currency: "usd", gateway: "stripe", status: "pending", stripeSessionId: "cs_test_unpaid1" }],
  });
  const { ledgerEntries, originals } = installPaymentPersistenceMocks(payment);
  gateway.retrieveCheckoutSession = async (sessionId) => ({
    id: sessionId,
    payment_status: "unpaid",
    status: "open",
    currency: "usd",
    payment_intent: { id: "pi_test_unpaid1", status: "requires_payment_method" },
  });
  try {
    const result = await paymentService.confirmCheckoutSession("cs_test_unpaid1", ADMIN_USER, {});
    const txn = result.transactions.find((item) => item.stripeSessionId === "cs_test_unpaid1");
    assert.notEqual(txn.status, "paid");
    assert.equal(result.amountPaid, 0);
    assert.equal(ledgerEntries.length, 0, "an unpaid session must never create a ledger entry");
  } finally {
    restorePaymentPersistenceMocks(originals);
  }
});

test("an expired checkout session is marked expired, not paid", async () => {
  const payment = new Payment({
    totalAmount: 50000,
    currency: "usd",
    paymentSchedule: [{ amount: 50000, status: "pending" }],
    transactions: [{ amount: 50000, currency: "usd", gateway: "stripe", status: "pending", stripeSessionId: "cs_test_expired1" }],
  });
  const { originals } = installPaymentPersistenceMocks(payment);
  gateway.retrieveCheckoutSession = async (sessionId) => ({
    id: sessionId,
    status: "expired",
    currency: "usd",
    payment_intent: null,
  });
  try {
    const result = await paymentService.confirmCheckoutSession("cs_test_expired1", ADMIN_USER, {});
    const txn = result.transactions.find((item) => item.stripeSessionId === "cs_test_expired1");
    assert.equal(txn.status, "expired");
    assert.equal(result.amountPaid, 0);
  } finally {
    restorePaymentPersistenceMocks(originals);
  }
});

function registeredRoutes() {
  return router.stack
    .filter((layer) => layer.route)
    .map((layer) => ({
      path: layer.route.path,
      methods: Object.keys(layer.route.methods).filter((method) => layer.route.methods[method]),
    }));
}

test("payment balance uses net paid amount after refunds", () => {
  const payment = new Payment({
    totalAmount: 100000,
    transactions: [{ amount: 100000, status: "paid" }],
    refunds: [{ amount: 25000, status: "succeeded" }],
  });
  paymentService.recalculatePayment(payment);
  assert.equal(payment.amountPaid, 100000);
  assert.equal(payment.refundedAmount, 25000);
  assert.equal(payment.remainingAmount, 25000);
  assert.equal(payment.paymentStatus, "partially_refunded");
});

test("payment model does not allow paid status without settled funds", async () => {
  const payment = new Payment({
    totalAmount: 100000,
    amountPaid: 0,
    paidAmount: 0,
    status: "paid",
    paymentStatus: "paid",
  });
  await payment.validate();
  assert.equal(payment.status, "not_started");
  assert.equal(payment.paymentStatus, "not_started");
  assert.equal(payment.lifecycleStatus, "draft");
});

test("gateway settlement rejects amount and currency mismatches", () => {
  const payment = new Payment({ totalAmount: 50000, currency: "usd" });
  const transaction = { amount: 50000 };
  assert.throws(
    () => paymentService.validateGatewaySettlement(payment, transaction, { amount_total: 49900, currency: "usd" }),
    (error) => error.code === "PAYMENT_AMOUNT_MISMATCH"
  );
  assert.throws(
    () => paymentService.validateGatewaySettlement(payment, transaction, { amount_total: 50000, currency: "eur" }),
    (error) => error.code === "PAYMENT_CURRENCY_MISMATCH"
  );
});

test("webhook verification cannot fall back to unsigned payloads", () => {
  const previous = process.env.STRIPE_WEBHOOK_SECRET;
  delete process.env.STRIPE_WEBHOOK_SECRET;
  try {
    assert.throws(
      () => gateway.constructWebhookEvent(Buffer.from("{}"), "signature"),
      (error) => error.code === "STRIPE_WEBHOOK_SECRET_MISSING"
    );
  } finally {
    if (previous === undefined) delete process.env.STRIPE_WEBHOOK_SECRET;
    else process.env.STRIPE_WEBHOOK_SECRET = previous;
  }
});

test("financial schemas preserve idempotency and immutable ledger constraints", () => {
  assert.equal(PaymentRequest.schema.path("idempotencyKey").options.unique, true);
  const ledgerIndexes = PaymentLedgerEntry.schema.indexes();
  assert.ok(ledgerIndexes.some(([fields, options]) => fields.providerEventId === 1 && fields.entryType === 1 && options.unique));
  assert.ok(Payment.schema.path("invoices.billingItems"));
  assert.ok(Payment.schema.path("refunds.gatewayRefundId"));
});

test("enterprise payment routes expose reconciliation, configuration, refunds, and receipt downloads", () => {
  const routes = registeredRoutes();
  for (const [method, path] of [
    ["post", "/confirm-checkout-session"],
    ["get", "/gateway/configuration"],
    ["get", "/reconciliation/scan"],
    ["post", "/:id/refund"],
    ["get", "/:id/receipt/:transactionId/download"],
  ]) {
    assert.ok(routes.some((route) => route.path === path && route.methods.includes(method)), `${method.toUpperCase()} ${path} is missing`);
  }
});

test("payment list population includes case billing summary fields", () => {
  let populateSpec;
  const query = {
    populate(spec) {
      populateSpec = spec;
      return this;
    },
  };
  paymentService.populatePaymentQuery(query);
  const casePopulation = populateSpec.find((entry) => entry.path === "caseId");
  assert.match(casePopulation.select, /caseNumber/);
  assert.match(casePopulation.select, /clientName/);
  assert.match(casePopulation.select, /status/);
  assert.match(casePopulation.select, /plan/);
});

test("team leads can record manual case payments without finance-wide authority", () => {
  assert.equal(paymentService.canRecordManualPayments({ role: "team_lead" }), true);
  assert.equal(paymentService.canRecordManualPayments({ role: "case_manager" }), false);
  assert.equal(paymentService.canManagePayments({ role: "team_lead" }), false);
});

test("manual payments reject overpayment and safely identify duplicate submissions", () => {
  const payment = new Payment({
    totalAmount: 100000,
    remainingAmount: 60000,
    transactions: [{ amount: 10000, status: "paid", transactionId: "manual-request-1" }],
  });
  assert.throws(
    () => paymentService.validateManualPayment(payment, { amount: 700, amountUnit: "dollars" }),
    (error) => error.status === 400 && /remaining balance/i.test(error.message)
  );
  const duplicate = paymentService.validateManualPayment(payment, {
    amount: 100,
    amountUnit: "dollars",
    transactionId: "manual-request-1",
  });
  assert.ok(duplicate.existing);
});

test("receipt service generates a valid PDF without sensitive card data", async () => {
  const payment = new Payment({
    invoiceNumber: "INV-TEST-1",
    packageName: "Attorney Review",
    totalAmount: 100000,
    amountPaid: 50000,
    remainingAmount: 50000,
    currency: "usd",
  });
  const transaction = payment.transactions.create({
    amount: 50000,
    status: "paid",
    gateway: "stripe",
    gatewayTransactionId: "pi_test",
    label: "Installment 1",
  });
  const receipt = { receiptNumber: "RCT-TEST-1", issuedAt: new Date() };
  const pdf = await receiptService.generateReceipt({ payment, transaction, receipt });
  assert.equal(pdf.subarray(0, 4).toString(), "%PDF");
});
