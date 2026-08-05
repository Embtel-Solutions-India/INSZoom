const Case = require("../../models/Case");
const PaymentLedgerEntry = require("../../models/PaymentLedgerEntry");
const PaymentRequest = require("../../models/PaymentRequest");
const Payment = require("../../models/Payment");
const paymentGateway = require("./payment.gateway");
const paymentService = require("./payment.service");
const receiptService = require("./payment-receipt.service");

async function getPaymentOr404(id, user) {
  const payment = await paymentService.populatePaymentQuery(Payment.findById(id));
  if (!payment) {
    const error = new Error("Payment not found");
    error.status = 404;
    throw error;
  }
  if (!(await paymentService.canAccessPayment(user, payment))) {
    const error = new Error("You do not have permission to view this payment");
    error.status = 403;
    throw error;
  }
  return payment;
}

exports.getPaymentSummary = async (req, res, next) => {
  try {
    const caseData = await Case.findOne({ user: req.user._id }).sort({ createdAt: -1 });
    if (!caseData) {
      return res.json({
        success: true,
        hasCase: false,
        hasPaymentPlan: false,
        status: "not_started",
        paymentStatus: "not_started",
        packageName: "No payment plan",
        currency: "usd",
        baseAmount: 0,
        totalAmount: 0,
        totalFee: 0,
        amountPaid: 0,
        paidAmount: 0,
        remainingAmount: 0,
        discountAmount: 0,
        transactions: [],
        paymentHistory: [],
        paymentSchedule: [],
        invoices: [],
        refunds: [],
      });
    }
    const payment = await paymentService.getOrCreateClientPayment(req.user, caseData, req);
    res.json(payment);
  } catch (error) {
    next(error);
  }
};

exports.getPayments = async (req, res, next) => {
  try {
    const filter = await paymentService.buildPaymentFilter(req.query, req.user);
    const page = Math.max(Number(req.query.page || 1), 1);
    const limit = Math.min(Math.max(Number(req.query.limit || 50), 1), 200);
    const allowedSortFields = new Set(["createdAt", "updatedAt", "paymentDate", "remainingAmount", "amountPaid", "invoiceNumber"]);
    const sortBy = allowedSortFields.has(req.query.sortBy) ? req.query.sortBy : "createdAt";
    const sortOrder = req.query.sortOrder === "asc" ? 1 : -1;
    const [payments, total] = await Promise.all([
      paymentService.populatePaymentQuery(Payment.find(filter).sort({ [sortBy]: sortOrder }).skip((page - 1) * limit).limit(limit)),
      Payment.countDocuments(filter),
    ]);
    res.json({
      success: true,
      count: payments.length,
      total,
      payments,
      pagination: { page, limit, totalPages: Math.ceil(total / limit) || 1 },
    });
  } catch (error) {
    next(error);
  }
};

exports.getPayment = async (req, res, next) => {
  try {
    const payment = await getPaymentOr404(req.params.id, req.user);
    res.json({ success: true, payment });
  } catch (error) {
    next(error);
  }
};

exports.createPayment = async (req, res, next) => {
  try {
    if (!paymentService.canManagePayments(req.user)) return res.status(403).json({ success: false, message: "Finance access required" });
    const payment = await paymentService.createPayment(req.body, req.user, req);
    res.status(201).json({ success: true, payment });
  } catch (error) {
    next(error);
  }
};

exports.updatePayment = async (req, res, next) => {
  try {
    if (!paymentService.canManagePayments(req.user)) return res.status(403).json({ success: false, message: "Finance access required" });
    const payment = await getPaymentOr404(req.params.id, req.user);
    const allowedFields = ["paymentStatus", "status", "nextPaymentAmount", "nextPaymentDueDate", "paymentSchedule", "taxRate", "notes"];
    const changes = {};
    allowedFields.forEach((field) => {
      if (Object.prototype.hasOwnProperty.call(req.body, field)) {
        changes[field] = { from: payment[field], to: req.body[field] };
        payment[field] = field === "nextPaymentDueDate" && req.body[field] ? new Date(req.body[field]) : req.body[field];
      }
    });
    payment.auditHistory.push({ action: "update", performedBy: req.user._id, changes, ipAddress: req.ip, userAgent: req.headers["user-agent"] });
    await payment.save();
    await paymentService.writeAuditLog("update", payment, req.user, changes, req);
    res.json({ success: true, payment });
  } catch (error) {
    next(error);
  }
};

exports.addPayment = async (req, res, next) => {
  try {
    if (!paymentService.canRecordManualPayments(req.user)) return res.status(403).json({ success: false, message: "Manual payment access requires Finance, Admin, or Team Lead authority" });
    const payment = await getPaymentOr404(req.params.id, req.user);
    const updated = await paymentService.addManualPayment(payment, req.body, req.user, req);
    res.json({ success: true, payment: updated });
  } catch (error) {
    next(error);
  }
};

exports.createPartialCheckoutSession = async (req, res, next) => {
  try {
    const caseData = await Case.findOne({ user: req.user._id }).sort({ createdAt: -1 });
    if (!caseData) return res.status(404).json({ success: false, message: "No case found" });
    const payment = await paymentService.getOrCreateClientPayment(req.user, caseData, req);
    if (payment.remainingAmount <= 0) return res.status(400).json({ success: false, message: "Payment is already completed" });
    const transaction = await paymentService.createPendingTransaction(payment, req.body, req);
    if (transaction.checkoutUrl && transaction.stripeSessionId) {
      return res.json({
        url: transaction.checkoutUrl,
        sessionId: transaction.stripeSessionId,
        paymentRequestId: transaction.paymentRequestId,
        idempotencyKey: transaction.idempotencyKey,
        status: transaction.status,
        recovered: true,
      });
    }
    const session = await paymentGateway.createCheckoutSession({ payment, transaction, user: req.user, caseData });
    await paymentService.attachCheckoutSession(payment, transaction, session);
    res.json({
      url: session.url,
      sessionId: session.sessionId,
      disabled: session.disabled,
      message: session.message,
      paymentRequestId: transaction.paymentRequestId,
      idempotencyKey: transaction.idempotencyKey,
      status: transaction.status,
    });
  } catch (error) {
    next(error);
  }
};

exports.recoverPaymentRequest = async (req, res, next) => {
  try {
    const result = await paymentService.recoverPaymentRequest(req.params.requestId || req.query.requestId, req.user);
    if (!result) return res.status(404).json({ success: false, message: "Payment request not found" });
    res.json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
};

exports.confirmCheckoutSession = async (req, res, next) => {
  const sessionId = req.body.sessionId || req.query.session_id || req.query.sessionId;
  try {
    const payment = await paymentService.confirmCheckoutSession(sessionId, req.user, req);
    res.json({ success: true, payment });
  } catch (error) {
    if (error.status && error.status < 500) return next(error);
    try {
      const payment = sessionId ? await Payment.findOne({ "transactions.stripeSessionId": sessionId }) : null;
      if (payment && (await paymentService.canAccessPayment(req.user, payment))) {
        await paymentService.writeAuditLog("checkout_confirmation_degraded", payment, req.user, { sessionId, error: error.message }, req);
        return res.json({
          success: true,
          degraded: true,
          message: "Payment confirmation is being reconciled. Showing the latest available payment state.",
          payment,
        });
      }
    } catch {
      // Fall through to the original error handler for unrecoverable failures.
    }
    next(error);
  }
};

exports.refundPayment = async (req, res, next) => {
  try {
    const payment = await getPaymentOr404(req.params.id, req.user);
    const refunded = await paymentService.refundPayment(payment, req.body, req.user, req);
    res.json({ success: true, payment: refunded });
  } catch (error) {
    next(error);
  }
};

exports.reconcilePayment = async (req, res, next) => {
  try {
    if (!paymentService.canManagePayments(req.user)) return res.status(403).json({ success: false, message: "Finance access required" });
    const payment = await getPaymentOr404(req.params.id, req.user);
    const reconciled = await paymentService.reconcilePayment(payment, req.body, req.user, req);
    res.json({ success: true, payment: reconciled });
  } catch (error) {
    next(error);
  }
};

exports.getInvoices = async (req, res, next) => {
  try {
    const payment = await getPaymentOr404(req.params.id, req.user);
    res.json({ success: true, invoices: payment.invoices || [] });
  } catch (error) {
    next(error);
  }
};

exports.getTransactions = async (req, res, next) => {
  try {
    const payment = await getPaymentOr404(req.params.id, req.user);
    res.json({ success: true, transactions: payment.transactions || [], paymentHistory: payment.paymentHistory || [] });
  } catch (error) {
    next(error);
  }
};

exports.getReceipt = async (req, res, next) => {
  try {
    const payment = await getPaymentOr404(req.params.id, req.user);
    const receipt = await paymentService.getReceipt(payment, req.params.transactionId, req.user);
    if (!receipt) return res.status(404).json({ success: false, message: "Receipt not available yet" });
    res.json({ success: true, ...receipt });
  } catch (error) {
    next(error);
  }
};

exports.downloadReceipt = async (req, res, next) => {
  try {
    const payment = await getPaymentOr404(req.params.id, req.user);
    const result = await paymentService.getReceipt(payment, req.params.transactionId, req.user);
    if (!result) return res.status(404).json({ success: false, message: "Receipt not available yet" });
    const buffer = await receiptService.generateReceipt({ payment, ...result });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${result.receipt.receiptNumber}.pdf"`);
    res.send(buffer);
  } catch (error) {
    next(error);
  }
};

exports.getGatewayConfiguration = async (req, res, next) => {
  try {
    res.json({ success: true, stripe: paymentGateway.configurationStatus() });
  } catch (error) {
    next(error);
  }
};

exports.getLedger = async (req, res, next) => {
  try {
    if (!paymentService.canManagePayments(req.user)) return res.status(403).json({ success: false, message: "Finance access required" });
    const filter = {};
    if (req.params.id) filter.paymentId = req.params.id;
    const ledger = await PaymentLedgerEntry.find(filter).sort({ createdAt: -1 }).limit(Math.min(Number(req.query.limit || 100), 500));
    res.json({ success: true, count: ledger.length, ledger });
  } catch (error) {
    next(error);
  }
};

exports.getPaymentRequests = async (req, res, next) => {
  try {
    if (!paymentService.canManagePayments(req.user)) return res.status(403).json({ success: false, message: "Finance access required" });
    const filter = {};
    if (req.query.status) filter.status = req.query.status;
    if (req.query.paymentId) filter.paymentId = req.query.paymentId;
    const requests = await PaymentRequest.find(filter).sort({ createdAt: -1 }).limit(Math.min(Number(req.query.limit || 100), 500));
    res.json({ success: true, count: requests.length, requests });
  } catch (error) {
    next(error);
  }
};

exports.reconciliationScan = async (req, res, next) => {
  try {
    if (!paymentService.canManagePayments(req.user)) return res.status(403).json({ success: false, message: "Finance access required" });
    const result = await paymentService.reconciliationScan(req.query, req.user);
    res.json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
};

exports.getWebhookMonitor = async (req, res, next) => {
  try {
    if (!paymentService.canManagePayments(req.user)) return res.status(403).json({ success: false, message: "Finance access required" });
    const payments = await Payment.find({ webhookEvents: { $exists: true, $ne: [] } })
      .select("invoiceNumber webhookEvents replayProtection lifecycleStatus paymentStatus")
      .sort({ updatedAt: -1 })
      .limit(Math.min(Number(req.query.limit || 50), 200));
    res.json({ success: true, count: payments.length, payments });
  } catch (error) {
    next(error);
  }
};

exports.getFinanceStats = async (req, res, next) => {
  try {
    const stats = await paymentService.financeStats(req.query, req.user);
    res.json({ success: true, stats });
  } catch (error) {
    next(error);
  }
};

exports.generateRevenueReport = async (req, res, next) => {
  try {
    const stats = await paymentService.financeStats(req.body, req.user);
    res.status(201).json({
      success: true,
      report: {
        reportType: req.body.reportType || "custom",
        period: { startDate: req.body.startDate, endDate: req.body.endDate },
        ...stats,
        generatedBy: req.user._id,
        generatedAt: new Date(),
      },
    });
  } catch (error) {
    next(error);
  }
};

exports.handleStripeWebhook = async (req, res) => {
  try {
    const event = paymentGateway.constructWebhookEvent(req.body, req.headers["stripe-signature"]);
    await paymentService.applyWebhookEvent(event, req);
    res.json({ received: true });
  } catch (error) {
    res.status(error.status === 503 ? 503 : 400).json({ success: false, message: `Webhook Error: ${error.message}` });
  }
};
