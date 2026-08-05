const Payment = require("../../models/Payment");
const PaymentLedgerEntry = require("../../models/PaymentLedgerEntry");
const PaymentRequest = require("../../models/PaymentRequest");
const paymentService = require("../payments/payment.service");

exports.getDashboard = async (req, res, next) => {
  try {
    const stats = await paymentService.financeStats(req.query, req.user);
    const reconciliation = await paymentService.reconciliationScan(req.query, req.user);
    const filter = await paymentService.buildPaymentFilter(req.query, req.user);
    const recentPayments = await paymentService.populatePaymentQuery(Payment.find(filter).sort({ updatedAt: -1 }).limit(10));
    res.json({ success: true, stats, reconciliation, recentPayments });
  } catch (error) {
    next(error);
  }
};

exports.listInvoices = async (req, res, next) => {
  try {
    const filter = await paymentService.buildPaymentFilter(req.query, req.user);
    if (req.query.invoiceStatus) filter["invoices.status"] = req.query.invoiceStatus;
    const payments = await Payment.find(filter).select("invoiceNumber invoices user caseId companyId paymentStatus lifecycleStatus amountPaid remainingAmount totalAmount currency").sort({ createdAt: -1 });
    const invoices = payments.flatMap((payment) => (payment.invoices || []).map((invoice) => ({
      paymentId: payment._id,
      invoiceNumber: invoice.invoiceNumber || payment.invoiceNumber,
      invoice,
      paymentStatus: payment.paymentStatus,
      lifecycleStatus: payment.lifecycleStatus,
      amountPaid: payment.amountPaid,
      remainingAmount: payment.remainingAmount,
      totalAmount: payment.totalAmount,
      currency: payment.currency,
    })));
    res.json({ success: true, count: invoices.length, invoices });
  } catch (error) {
    next(error);
  }
};

exports.getLedger = async (req, res, next) => {
  try {
    const filter = {};
    if (req.query.paymentId) filter.paymentId = req.query.paymentId;
    if (req.query.entryType) filter.entryType = req.query.entryType;
    const ledger = await PaymentLedgerEntry.find(filter).sort({ createdAt: -1 }).limit(Math.min(Number(req.query.limit || 100), 500));
    res.json({ success: true, count: ledger.length, ledger });
  } catch (error) {
    next(error);
  }
};

exports.getRequests = async (req, res, next) => {
  try {
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
    const result = await paymentService.reconciliationScan(req.query, req.user);
    res.json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
};

exports.getReports = async (req, res, next) => {
  try {
    const stats = await paymentService.financeStats(req.query, req.user);
    const paymentFilter = await paymentService.buildPaymentFilter(req.query, req.user);
    const paymentIds = paymentService.canManagePayments(req.user) ? null : await Payment.find(paymentFilter).distinct("_id");
    const ledger = await PaymentLedgerEntry.aggregate([
      ...(paymentIds ? [{ $match: { paymentId: { $in: paymentIds } } }] : []),
      { $group: { _id: "$entryType", amount: { $sum: "$amount" }, count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]);
    res.json({ success: true, stats, ledger });
  } catch (error) {
    next(error);
  }
};
