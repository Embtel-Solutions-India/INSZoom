const AuditLog = require("../../models/AuditLog");
const Case = require("../../models/Case");
const User = require("../../models/User");
const Payment = require("../../models/Payment");
const PaymentLedgerEntry = require("../../models/PaymentLedgerEntry");
const PaymentRequest = require("../../models/PaymentRequest");
const caseService = require("../cases/case.service");
const notificationService = require("../notifications/notification.service");
const realtimeGateway = require("../realtime/realtime.gateway");
const { dashboardCacheBump } = require("../../config/redis");
const workflowService = require("../workflows/workflow.service");
const { normalizeRole } = require("../authorization/roleHierarchy");
const pricingService = require("./pricing.service");
const paymentGateway = require("./payment.gateway");
const { normalizePackageName } = require("../../config/packages");
const logger = require("../../utils/logger");

const FINANCE_ROLES = ["super_admin", "admin"];
const MANUAL_PAYMENT_ROLES = [...FINANCE_ROLES, "team_lead"];
const READ_ROLES = ["super_admin", "admin", "team_lead", "case_manager"];
const SETTLED_STATUSES = new Set(["paid", "succeeded", "partial", "partially_paid", "refunded", "partially_refunded"]);

function roleOf(user) {
  return normalizeRole(user?.role);
}

function sameId(left, right) {
  const leftId = left?._id || left;
  const rightId = right?._id || right;
  return leftId && rightId && leftId.toString() === rightId.toString();
}

function canManagePayments(user) {
  return FINANCE_ROLES.includes(roleOf(user));
}

function canRecordManualPayments(user) {
  return MANUAL_PAYMENT_ROLES.includes(roleOf(user));
}

function hasSettlementStatus(status) {
  return SETTLED_STATUSES.has(status);
}

async function canAccessPayment(user, payment) {
  if (!user || !payment) return false;
  const role = roleOf(user);
  if (READ_ROLES.includes(role) && ["super_admin", "admin"].includes(role)) return true;
  if (sameId(payment.user, user._id)) return true;
  if (payment.caseId || payment.case) {
    const caseData = await Case.findById(payment.caseId || payment.case);
    return caseService.canAccessCase(user, caseData);
  }
  if (role === "team_lead" && sameId(payment.teamId, user.teamId)) return true;
  return false;
}

function addAuditEntry(payment, action, user, changes = {}, req) {
  payment.auditHistory.push({
    action,
    performedBy: user?._id,
    performedAt: new Date(),
    changes,
    ipAddress: req?.ip,
    userAgent: req?.headers?.["user-agent"],
  });
}

function getPaymentRequestId(payload = {}, req) {
  return payload.paymentRequestId || payload.requestId || req?.headers?.["x-payment-request-id"] || req?.headers?.["idempotency-key"];
}

function buildIdempotencyKey(payment, amount, requestId, payload = {}) {
  return payload.idempotencyKey || requestId || `payment_${payment._id}_${amount}_${payload.scheduleKey || payment.planKey || "custom"}`;
}

async function writeLedgerEntry(payment, entry, user, req) {
  return PaymentLedgerEntry.create({
    paymentId: payment._id,
    invoiceNumber: payment.invoiceNumber,
    currency: payment.currency,
    balanceAfter: payment.remainingAmount,
    createdBy: user?._id,
    ipAddress: req?.ip,
    userAgent: req?.headers?.["user-agent"],
    ...entry,
  }).catch((error) => {
    if (error?.code === 11000) return null;
    throw error;
  });
}

function recordNonBlockingPaymentIssue(payment, action, error, req, changes = {}) {
  addAuditEntry(payment, action, null, { ...changes, error: error?.message || String(error) }, req);
}

function transitionPayment(payment, lifecycleStatus, reason) {
  const allowed = {
    draft: ["pending", "processing", "authorized", "succeeded", "failed", "cancelled", "expired"],
    pending: ["processing", "authorized", "succeeded", "failed", "cancelled", "expired"],
    processing: ["authorized", "succeeded", "failed", "partially_refunded", "refunded", "cancelled", "expired"],
    authorized: ["succeeded", "failed", "cancelled", "expired"],
    succeeded: ["partially_refunded", "refunded"],
    failed: ["pending", "processing", "cancelled"],
    partially_refunded: ["refunded"],
    refunded: [],
    cancelled: [],
    expired: [],
  };
  const current = payment.lifecycleStatus || "draft";
  if (current !== lifecycleStatus && allowed[current] && !allowed[current].includes(lifecycleStatus)) {
    if (["succeeded", "partially_refunded", "refunded"].includes(current) && ["pending", "processing", "failed", "expired", "cancelled"].includes(lifecycleStatus)) {
      return;
    }
    const error = new Error(`Invalid payment transition from ${current} to ${lifecycleStatus}${reason ? `: ${reason}` : ""}`);
    error.status = 409;
    throw error;
  }
  payment.lifecycleStatus = lifecycleStatus;
  if (lifecycleStatus === "succeeded") {
    payment.paymentStatus = payment.remainingAmount > 0 ? "partially_paid" : "paid";
    payment.status = payment.paymentStatus === "paid" ? "paid" : "partial";
  } else if (lifecycleStatus === "partially_refunded" || lifecycleStatus === "refunded") {
    payment.paymentStatus = lifecycleStatus;
    payment.status = lifecycleStatus;
  } else if (["pending", "processing", "authorized", "failed", "cancelled", "expired", "draft"].includes(lifecycleStatus)) {
    payment.paymentStatus = lifecycleStatus === "draft" ? "not_started" : lifecycleStatus;
    payment.status = payment.paymentStatus;
  }
}

function sanitizeGatewayResponse(data = {}) {
  const paymentIntent = typeof data.payment_intent === "object" ? data.payment_intent : undefined;
  return {
    id: data.id,
    object: data.object,
    status: data.status,
    payment_status: data.payment_status,
    payment_intent: paymentIntent?.id || data.payment_intent,
    amount_total: data.amount_total,
    amount_received: data.amount_received,
    amount: data.amount,
    amount_refunded: data.amount_refunded,
    currency: data.currency,
    customer: typeof data.customer === "string" ? data.customer : data.customer?.id,
    payment_method_types: data.payment_method_types,
    metadata: data.metadata,
    created: data.created,
    livemode: data.livemode,
    last_payment_error: data.last_payment_error ? {
      code: data.last_payment_error.code,
      decline_code: data.last_payment_error.decline_code,
      message: data.last_payment_error.message,
      type: data.last_payment_error.type,
    } : undefined,
  };
}

async function acquirePaymentRequest(payment, payload, amount, user, req) {
  const requestId = getPaymentRequestId(payload, req) || `req_${payment._id}_${amount}_${Date.now()}`;
  const idempotencyKey = buildIdempotencyKey(payment, amount, requestId, payload);
  const existing = await PaymentRequest.findOne({ $or: [{ requestId }, { idempotencyKey }] });
  if (existing) {
    existing.duplicateCount += 1;
    existing.lastSeenAt = new Date();
    await existing.save();
    return { request: existing, duplicate: true };
  }
  try {
    const request = await PaymentRequest.create({
      requestId,
      idempotencyKey,
      paymentId: payment._id,
      userId: user?._id,
      amount,
      currency: payment.currency,
      status: "received",
      ipAddress: req?.ip,
      userAgent: req?.headers?.["user-agent"],
    });
    return { request, duplicate: false };
  } catch (error) {
    if (error?.code !== 11000) throw error;
    const request = await PaymentRequest.findOne({ $or: [{ requestId }, { idempotencyKey }] });
    if (!request) throw error;
    request.duplicateCount += 1;
    request.lastSeenAt = new Date();
    await request.save();
    return { request, duplicate: true };
  }
}

function normalizeAmountInput(payload, field = "amount") {
  if (payload[`${field}Cents`] !== undefined) return Math.round(Number(payload[`${field}Cents`]));
  if (payload.amountUnit === "cents") return Math.round(Number(payload[field] || 0));
  return Math.round(Number(payload[field] || 0) * 100);
}

async function writeAuditLog(action, payment, user, changes, req) {
  await AuditLog.create({
    userId: user?._id,
    action,
    entityType: "payment",
    entityId: payment?._id?.toString(),
    changes,
    ipAddress: req?.ip,
    userAgent: req?.headers?.["user-agent"],
    description: `${action} payment ${payment?.invoiceNumber || payment?._id}`,
  }).catch(() => {});
}

async function buildPaymentFilter(query, user) {
  const filter = {};
  if (query.status) filter.paymentStatus = query.status;
  if (query.paymentStatus) filter.paymentStatus = query.paymentStatus;
  if (query.package) filter.package = query.package;
  if (query.caseId) filter.caseId = query.caseId;
  if (query.invoiceNumber) filter.invoiceNumber = query.invoiceNumber;
  if (query.companyId) filter.companyId = query.companyId;
  if (query.currency) filter.currency = String(query.currency).toLowerCase();
  if (query.search) {
    filter.$or = [
      { invoiceNumber: { $regex: query.search, $options: "i" } },
      { packageName: { $regex: query.search, $options: "i" } },
      { clientPortalId: { $regex: query.search, $options: "i" } },
      { "transactions.gatewayTransactionId": { $regex: query.search, $options: "i" } },
    ];
  }
  if (query.from || query.to) {
    filter.createdAt = {};
    if (query.from) filter.createdAt.$gte = new Date(query.from);
    if (query.to) filter.createdAt.$lte = new Date(query.to);
  }

  const role = roleOf(user);
  if (["super_admin", "admin"].includes(role)) return filter;
  if (role === "team_lead" && user.teamId) {
    filter.teamId = user.teamId;
    return filter;
  }
  if (query.caseId) {
    // A non-admin/non-team-lead role scoping the payment list to a specific
    // case must actually be allowed to see that case — otherwise a
    // case_manager (or client) could read another case's payment records
    // just by passing ?caseId=<not theirs>. Mirrors documents' equivalent
    // check in document.service.js's buildDocumentFilter.
    const caseData = await Case.findById(query.caseId);
    if (!caseData || !caseService.canAccessCase(user, caseData)) {
      const error = new Error("You do not have permission to view payments for this case");
      error.status = 403;
      throw error;
    }
    return filter;
  }
  const caseFilter = caseService.buildCaseFilter({}, user);
  const caseIds = await Case.find(caseFilter).distinct("_id");
  const accessFilter = [{ user: user._id }, { caseId: { $in: caseIds } }, { case: { $in: caseIds } }];
  if (filter.$or) {
    filter.$and = [{ $or: filter.$or }, { $or: accessFilter }];
    delete filter.$or;
  } else {
    filter.$or = accessFilter;
  }
  return filter;
}

async function resolvePaymentContext(payload, user) {
  const caseId = payload.caseId || payload.case;
  if (!caseId) return {};
  const caseData = await Case.findById(caseId);
  if (!caseData) {
    const error = new Error("Case not found");
    error.status = 404;
    throw error;
  }
  if (user && !canManagePayments(user) && !caseService.canAccessCase(user, caseData)) {
    const error = new Error("Not authorized to access this case payment");
    error.status = 403;
    throw error;
  }
  return {
    caseData,
    caseId: caseData._id,
    user: caseData.user || caseData.clientProfile || payload.user,
    clientPortalId: caseData.clientPortalId,
    companyId: caseData.companyId,
    teamId: caseData.teamId,
  };
}

function generateInvoice({ subtotal, discountAmount = 0, taxAmount = 0, total, dueDate, currency = "usd", organization, client, caseId, billingItems = [], notes }) {
  return {
    invoiceNumber: `INV-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    status: "issued",
    issuedAt: new Date(),
    dueDate,
    subtotal,
    discountAmount,
    taxAmount,
    total,
    currency,
    organization,
    client,
    caseId,
    billingItems,
    notes,
  };
}

async function createPayment(payload, user, req) {
  const context = await resolvePaymentContext(payload, user);
  const casePlan = context.caseData?.plan || {};
  const price = pricingService.resolveBasePrice(context.caseData?.visaType || payload.visaType, payload.packageKey || payload.package || casePlan.tier);
  const baseAmount = payload.baseAmount ?? casePlan.amount ?? price.baseAmount;
  const discounted = pricingService.applyDiscounts(baseAmount, payload.discounts || []);
  const taxAmount = pricingService.calculateTax({ subtotal: discounted.totalAmount, taxRate: payload.taxRate || 0 });
  const totalAmount = payload.totalAmount ?? payload.totalFee ?? discounted.totalAmount + taxAmount;
  const planKey = payload.planKey || payload.scheduleKey || "pay_in_full";
  const paymentSchedule = payload.paymentSchedule || pricingService.buildInstallmentSchedule(totalAmount, planKey, payload.dueDate ? new Date(payload.dueDate) : new Date());
  const invoice = generateInvoice({
    subtotal: discounted.totalAmount,
    discountAmount: discounted.discountAmount,
    taxAmount,
    total: totalAmount,
    dueDate: paymentSchedule[0]?.dueDate,
    currency: (payload.currency || price.currency || "usd").toLowerCase(),
    organization: payload.companyId || context.companyId,
    client: payload.user || context.user || user?._id,
    caseId: context.caseId || payload.caseId,
    billingItems: payload.billingItems?.length ? payload.billingItems : [{
      code: payload.packageKey || casePlan.tier || price.packageKey,
      description: payload.packageName || price.packageName || "Immigration services",
      quantity: 1,
      unitAmount: baseAmount,
      amount: baseAmount,
      taxable: Number(payload.taxRate || 0) > 0,
    }],
    notes: payload.notes,
  });

  const payment = await Payment.create({
    ...payload,
    user: payload.user || context.user || user?._id,
    case: context.caseId || payload.case,
    caseId: context.caseId || payload.caseId,
    clientPortalId: payload.clientPortalId || context.clientPortalId,
    companyId: payload.companyId || context.companyId,
    teamId: payload.teamId || context.teamId,
    invoiceNumber: payload.invoiceNumber || invoice.invoiceNumber,
    invoices: [invoice],
    package: payload.package || context.caseData?.package || price.packageKey,
    packageKey: payload.packageKey || casePlan.tier || price.packageKey,
    packageName: payload.packageName || normalizePackageName(payload.packageKey || casePlan.tier) || price.packageName,
    pricingVersion: price.pricingVersion,
    baseAmount,
    subtotalAmount: discounted.totalAmount,
    discountAmount: discounted.discountAmount,
    taxAmount,
    taxRate: payload.taxRate || 0,
    totalAmount,
    totalFee: totalAmount,
    amountPaid: payload.amountPaid || payload.paidAmount || 0,
    paidAmount: payload.paidAmount || payload.amountPaid || 0,
    remainingAmount: totalAmount - (payload.paidAmount || payload.amountPaid || 0),
    currency: (payload.currency || price.currency || "usd").toLowerCase(),
    planKey,
    nextPaymentAmount: paymentSchedule.find((item) => item.status !== "paid")?.amount,
    nextPaymentDueDate: paymentSchedule.find((item) => item.status !== "paid")?.dueDate,
    paymentSchedule,
    assignedBy: user?._id || payload.assignedBy,
    legacySource: payload.legacySource || "shared",
  });
  addAuditEntry(payment, "create", user, payload, req);
  await payment.save();
  await writeLedgerEntry(payment, {
    entryType: "invoice",
    direction: "debit",
    amount: totalAmount,
    provider: "manual",
    description: `Invoice generated ${payment.invoiceNumber}`,
  }, user, req);
  await notifyPayment(payment, user, "payment_created", req);
  await writeAuditLog("create", payment, user, payload, req);
  return payment;
}

async function getOrCreateClientPayment(user, caseData, req) {
  let payment = await Payment.findOne({ user: user._id, caseId: caseData._id, packageKey: { $ne: "premium_processing_i907" } });
  if (!payment) {
    payment = await createPayment({
      caseId: caseData._id,
      user: user._id,
      package: caseData.package,
      packageKey: caseData.plan?.tier,
      baseAmount: caseData.plan?.amount,
      totalAmount: caseData.plan?.amount,
      packageName: normalizePackageName(caseData.plan?.tier),
      legacySource: "BAIS",
    }, user, req);
  } else if ((payment.amountPaid || 0) <= 0 && caseData.plan?.amount && payment.totalAmount !== caseData.plan.amount) {
    const tier = caseData.plan?.tier || payment.packageKey;
    payment.package = caseData.package || payment.package;
    payment.packageKey = tier || payment.packageKey;
    payment.packageName = normalizePackageName(tier) || payment.packageName;
    payment.baseAmount = caseData.plan.amount;
    payment.subtotalAmount = caseData.plan.amount;
    payment.totalAmount = caseData.plan.amount;
    payment.totalFee = caseData.plan.amount;
    payment.remainingAmount = caseData.plan.amount;
    payment.currency = (caseData.plan.currency || payment.currency || "usd").toLowerCase();
    payment.paymentSchedule = pricingService.buildInstallmentSchedule(caseData.plan.amount, payment.planKey || "pay_in_full", new Date());
    payment.nextPaymentAmount = payment.paymentSchedule.find((item) => item.status !== "paid")?.amount;
    payment.nextPaymentDueDate = payment.paymentSchedule.find((item) => item.status !== "paid")?.dueDate;
    payment.invoices = [generateInvoice({ subtotal: caseData.plan.amount, total: caseData.plan.amount, dueDate: payment.nextPaymentDueDate })];
    addAuditEntry(payment, "sync_case_plan", user, { casePlan: caseData.plan }, req);
    await payment.save();
  }
  if (payment) {
    const previousBalance = {
      status: payment.status,
      paymentStatus: payment.paymentStatus,
      amountPaid: payment.amountPaid || 0,
      remainingAmount: payment.remainingAmount || 0,
    };
    recalculatePayment(payment);
    const staleBalance =
      previousBalance.amountPaid !== (payment.amountPaid || 0)
      || previousBalance.remainingAmount !== (payment.remainingAmount || 0)
      || previousBalance.paymentStatus !== payment.paymentStatus
      || previousBalance.status !== payment.status;
    if (staleBalance) {
      addAuditEntry(payment, "repair_payment_balance", user, { previousBalance }, req);
      await payment.save();
      await syncCasePlanPayment(payment).catch(() => null);
    }
  }
  if (
    payment
    && (payment.amountPaid || payment.paidAmount || 0) <= 0
    && (
      hasSettlementStatus(payment.status)
      || hasSettlementStatus(payment.paymentStatus)
      || hasSettlementStatus(caseData.plan?.paymentStatus)
      || ((payment.totalAmount || payment.totalFee || 0) > 0 && (payment.remainingAmount || 0) <= 0)
    )
  ) {
    payment.status = "not_started";
    payment.paymentStatus = "not_started";
    payment.lifecycleStatus = "draft";
    payment.paymentDate = undefined;
    payment.remainingAmount = payment.totalAmount || payment.totalFee || caseData.plan?.amount || 0;
    addAuditEntry(payment, "repair_unverified_paid_status", user, { previousCasePlanStatus: caseData.plan?.paymentStatus }, req);
    await payment.save();
    if (caseData.plan?.paymentStatus && (hasSettlementStatus(caseData.plan.paymentStatus) || caseData.plan.remainingAmount === 0)) {
      caseData.plan.paymentStatus = "not_started";
      caseData.plan.paidAt = undefined;
      caseData.plan.remainingAmount = payment.remainingAmount;
      await caseData.save().catch(() => null);
    }
  }
  return payment;
}

function recalculatePayment(payment) {
  const paid = payment.transactions.filter((txn) => txn.status === "paid").reduce((sum, txn) => sum + (txn.amount || 0), 0);
  const refunded = payment.refunds.filter((refund) => refund.status === "succeeded").reduce((sum, refund) => sum + (refund.amount || 0), 0);
  const netPaid = Math.max(paid - refunded, 0);
  payment.amountPaid = paid;
  payment.paidAmount = paid;
  payment.refundedAmount = refunded;
  payment.remainingAmount = Math.max((payment.totalAmount || payment.totalFee || 0) - netPaid, 0);
  if (refunded >= paid && paid > 0) payment.paymentStatus = "refunded";
  else if (refunded > 0) payment.paymentStatus = "partially_refunded";
  else if (payment.remainingAmount <= 0 && paid > 0) payment.paymentStatus = "paid";
  else if (paid > 0) payment.paymentStatus = "partially_paid";
  else payment.paymentStatus = payment.paymentStatus || "not_started";
  payment.status = payment.paymentStatus === "partially_paid" ? "partial" : payment.paymentStatus;
  const next = payment.paymentSchedule.find((item) => item.status !== "paid" && item.status !== "cancelled");
  payment.nextPaymentAmount = next?.amount;
  payment.nextPaymentDueDate = next?.dueDate;
  payment.paymentDate = payment.transactions.filter((txn) => txn.paidAt).sort((left, right) => new Date(right.paidAt) - new Date(left.paidAt))[0]?.paidAt;
  if (payment.caseId || payment.case) {
    payment._casePlanSync = {
      paymentStatus: payment.paymentStatus,
      paidAmount: payment.amountPaid,
      remainingAmount: payment.remainingAmount,
      paidAt: payment.paymentStatus === "paid" ? new Date() : undefined,
    };
  }
}

async function syncCasePlanPayment(payment) {
  if (!payment?._casePlanSync || !(payment.caseId || payment.case)) return;
  const caseId = payment.caseId || payment.case;
  if (payment.packageKey === "premium_processing_i907") {
    const caseData = await Case.findById(caseId).catch(() => null);
    const addon = caseData?.addons?.find((item) => String(item.payment) === String(payment._id) || item.key === "premium_processing_i907");
    if (addon) {
      addon.paymentStatus = payment.paymentStatus === "paid" ? "paid" : payment.paymentStatus || addon.paymentStatus;
      if (payment.paymentStatus === "paid") {
        addon.status = "waiting_for_information";
        addon.paidAt = addon.paidAt || new Date();
        if (!addon.history?.some((item) => item.status === "waiting_for_information")) {
          addon.history.push({ status: "waiting_for_information", note: "Premium Processing payment received; I-907 information requested." });
        }
        caseData.timeline.push({
          type: "addon",
          title: "I-907 Prepared",
          description: "Premium Processing payment received. I-907 preparation can begin after remaining information is collected.",
          metadata: { addonKey: addon.key, paymentId: payment._id },
          createdAt: new Date(),
        });
      }
      await caseData.save().catch(() => {});
    }
    payment._casePlanSync = undefined;
    return;
  }
  const update = {
    "plan.paymentStatus": payment._casePlanSync.paymentStatus,
    "plan.paidAmount": payment._casePlanSync.paidAmount,
    "plan.remainingAmount": payment._casePlanSync.remainingAmount,
  };
  if (payment._casePlanSync.paidAt) update["plan.paidAt"] = payment._casePlanSync.paidAt;
  await Case.findByIdAndUpdate(caseId, { $set: update }).catch(() => {});
  payment._casePlanSync = undefined;
}

function validateManualPayment(payment, payload) {
  const amount = normalizeAmountInput(payload);
  if (!Number.isFinite(amount) || amount <= 0) {
    const error = new Error("Amount must be greater than zero");
    error.status = 400;
    throw error;
  }
  if (amount > payment.remainingAmount) {
    const error = new Error(`Payment cannot exceed the remaining balance of $${(payment.remainingAmount / 100).toFixed(2)}`);
    error.status = 400;
    throw error;
  }
  if (payload.transactionId) {
    const existing = payment.transactions.find((transaction) =>
      transaction.transactionId === payload.transactionId || transaction.gatewayTransactionId === payload.transactionId
    );
    if (existing) return { amount, existing };
  }
  return { amount, existing: null };
}

async function addManualPayment(payment, payload, user, req) {
  const { amount, existing } = validateManualPayment(payment, payload);
  if (existing) return payment;
  payment.transactions.push({
    amount,
    currency: payment.currency,
    gateway: payload.gateway || "manual",
    paymentMethod: payload.paymentMethod || "manual",
    transactionId: payload.transactionId,
    gatewayTransactionId: payload.transactionId,
    label: payload.notes || "Manual payment",
    status: "paid",
    paidAt: new Date(),
  });
  const txn = payment.transactions[payment.transactions.length - 1];
  payment.paymentHistory.push({
    amount,
    paymentDate: new Date(),
    paymentMethod: payload.paymentMethod || "manual",
    transactionId: payload.transactionId,
    notes: payload.notes,
  });
  markSchedulePaid(payment, amount);
  recalculatePayment(payment);
  transitionPayment(payment, "succeeded", "manual payment recorded");
  addAuditEntry(payment, "add_payment", user, payload, req);
  await payment.save();
  await syncCasePlanPayment(payment);
  await writeLedgerEntry(payment, {
    transactionId: txn._id,
    entryType: "charge",
    direction: "credit",
    amount,
    provider: payload.gateway || "manual",
    providerObjectId: payload.transactionId,
    description: payload.notes || "Manual payment",
  }, user, req);
  await notifyPayment(payment, user, "payment_received", req);
  await publishPaymentUpdate(payment, "payment.completed", req);
  await writeAuditLog("add_payment", payment, user, payload, req);
  return payment;
}

function markSchedulePaid(payment, amount) {
  let remaining = amount;
  for (const item of payment.paymentSchedule) {
    if (remaining <= 0) break;
    if (item.status === "paid") continue;
    if (remaining >= item.amount) {
      item.status = "paid";
      item.paidAt = new Date();
      remaining -= item.amount;
    }
  }
}

async function createPendingTransaction(payment, payload, req) {
  const amount = normalizeAmountInput(payload);
  if (!Number.isFinite(amount) || amount < 100) {
    const error = new Error("Minimum payment amount is $1");
    error.status = 400;
    throw error;
  }
  if (amount > payment.remainingAmount) {
    const error = new Error(`You can only pay up to $${(payment.remainingAmount / 100).toFixed(2)}`);
    error.status = 400;
    throw error;
  }
  const lockActive = payment.processingLock?.lockedUntil && new Date(payment.processingLock.lockedUntil) > new Date();
  if (lockActive) {
    const activeTransaction = payment.transactions.find((item) =>
      item.paymentRequestId === payment.processingLock.requestId
      && ["pending", "processing", "requires_action"].includes(item.status)
    );
    if (activeTransaction) return activeTransaction;
  }
  const requestedPlanKey = payload.scheduleKey || payment.planKey || "pay_in_full";
  if (["pay_in_full", "two_installments", "four_installments"].includes(requestedPlanKey) && payment.amountPaid <= 0 && payment.planKey !== requestedPlanKey) {
    payment.planKey = requestedPlanKey;
    payment.paymentSchedule = pricingService.buildInstallmentSchedule(payment.totalAmount || payment.totalFee || payment.remainingAmount, requestedPlanKey, new Date());
    payment.nextPaymentAmount = payment.paymentSchedule.find((item) => item.status !== "paid")?.amount;
    payment.nextPaymentDueDate = payment.paymentSchedule.find((item) => item.status !== "paid")?.dueDate;
  }
  const { request, duplicate } = await acquirePaymentRequest(payment, payload, amount, req?.user, req);
  const idempotencyKey = request.idempotencyKey;
  let txn = payment.transactions.find((item) => item.paymentRequestId === request.requestId || item.idempotencyKey === idempotencyKey);
  if (!txn) {
    if (duplicate && request.transactionId) {
      txn = payment.transactions.id(request.transactionId);
      if (txn) return txn;
    }
    transitionPayment(payment, "pending", "checkout request created");
    payment.processingLock = {
      requestId: request.requestId,
      lockedAt: new Date(),
      lockedUntil: new Date(Date.now() + 10 * 60 * 1000),
    };
    payment.transactions.push({
      amount,
      currency: payment.currency,
      gateway: "stripe",
      status: "pending",
      paymentRequestId: request.requestId,
      scheduleKey: requestedPlanKey,
      installment: payload.installment,
      label: payload.label || "Payment",
      idempotencyKey,
    });
    await payment.save();
    txn = payment.transactions[payment.transactions.length - 1];
    request.transactionId = txn._id;
    request.status = "processing";
    await request.save();
  }
  return txn;
}

async function attachCheckoutSession(payment, transaction, session) {
  transaction.stripeSessionId = session.sessionId;
  transaction.checkoutUrl = session.url;
  transaction.status = session.disabled ? transaction.status : "processing";
  if (transaction.paymentRequestId) {
    await PaymentRequest.findOneAndUpdate(
      { requestId: transaction.paymentRequestId },
      {
        status: session.disabled ? "failed" : "requires_action",
        gatewaySessionId: session.sessionId,
        gatewayResponse: session,
      }
    );
  }
  await payment.save();
}

function findTransactionForWebhook(payment, data, metadata = {}) {
  if (metadata.transactionId) {
    const txn = payment.transactions.id(metadata.transactionId);
    if (txn) return txn;
  }
  const paymentIntentId = data.payment_intent || data.id;
  if (paymentIntentId) {
    return payment.transactions.find((txn) => txn.stripePaymentIntentId === paymentIntentId || txn.gatewayTransactionId === paymentIntentId);
  }
  if (metadata.paymentRequestId) {
    return payment.transactions.find((txn) => txn.paymentRequestId === metadata.paymentRequestId);
  }
  return null;
}

function validateGatewaySettlement(payment, txn, data) {
  if (!txn) {
    const error = new Error("Stripe event could not be matched to a payment transaction");
    error.status = 409;
    error.code = "PAYMENT_TRANSACTION_NOT_FOUND";
    throw error;
  }
  const gatewayAmount = Number(data.amount_total ?? data.amount_received ?? data.amount ?? 0);
  const gatewayCurrency = String(data.currency || payment.currency || "").toLowerCase();
  if (gatewayAmount && gatewayAmount !== Number(txn.amount)) {
    payment.reconciliation = {
      ...(payment.reconciliation || {}),
      status: "mismatch",
      notes: `Gateway amount ${gatewayAmount} did not match transaction amount ${txn.amount}`,
    };
    const error = new Error("Stripe payment amount does not match the expected transaction amount");
    error.status = 409;
    error.code = "PAYMENT_AMOUNT_MISMATCH";
    throw error;
  }
  if (gatewayCurrency && gatewayCurrency !== String(payment.currency || "").toLowerCase()) {
    const error = new Error("Stripe payment currency does not match the invoice currency");
    error.status = 409;
    error.code = "PAYMENT_CURRENCY_MISMATCH";
    throw error;
  }
}

function ensureReceipt(payment, txn) {
  if (!txn || payment.receipts.some((receipt) => receipt.transactionId?.toString() === txn._id.toString())) return;
  payment.receipts.push({
    receiptNumber: `RCT-${payment.invoiceNumber}-${txn._id.toString().slice(-8).toUpperCase()}`,
    transactionId: txn._id,
    amount: txn.amount,
    issuedAt: new Date(),
    downloadUrl: `/api/payments/${payment._id}/receipt/${txn._id}/download`,
  });
}

async function markTransactionSucceeded(payment, txn, data, event, req) {
  if (!txn || ["paid", "succeeded"].includes(txn.status)) return;
  validateGatewaySettlement(payment, txn, data);
  txn.status = "paid";
  txn.stripePaymentIntentId = data.payment_intent || data.id || txn.stripePaymentIntentId;
  txn.gatewayTransactionId = data.payment_intent || data.id || txn.gatewayTransactionId;
  txn.providerResponse = sanitizeGatewayResponse(data);
  txn.paidAt = new Date();
  payment.paymentHistory.push({ amount: txn.amount, paymentDate: new Date(), paymentMethod: "stripe", transactionId: txn.gatewayTransactionId, notes: event.type });
  ensureReceipt(payment, txn);
  markSchedulePaid(payment, txn.amount);
  recalculatePayment(payment);
  transitionPayment(payment, payment.remainingAmount > 0 ? "processing" : "succeeded", event.type);
  recalculatePayment(payment);
  return {
    transactionId: txn._id,
    entryType: "charge",
    direction: "credit",
    amount: txn.amount,
    provider: "stripe",
    providerEventId: event.id,
    providerObjectId: txn.gatewayTransactionId,
    description: "Stripe payment succeeded",
    metadata: { eventType: event.type },
    paymentRequestId: txn.paymentRequestId,
    gatewaySessionId: txn.stripeSessionId,
    gatewayPaymentIntentId: txn.stripePaymentIntentId,
    gatewayResponse: sanitizeGatewayResponse(data),
  };
}

async function completePaymentRequest(settlement) {
  if (!settlement?.paymentRequestId) return;
  await PaymentRequest.findOneAndUpdate(
    { requestId: settlement.paymentRequestId },
    {
      status: "completed",
      gatewaySessionId: settlement.gatewaySessionId,
      gatewayPaymentIntentId: settlement.gatewayPaymentIntentId,
      gatewayResponse: settlement.gatewayResponse,
    }
  );
}

async function markCheckoutSessionConfirmed(payment, txn, session, req) {
  const paymentIntent = typeof session.payment_intent === "object" ? session.payment_intent : null;
  const event = {
    id: `checkout_return_${session.id}`,
    type: "checkout.session.completed",
  };
  const data = {
    ...session,
    id: session.id,
    payment_intent: paymentIntent?.id || session.payment_intent,
    metadata: {
      ...(session.metadata || {}),
      paymentId: payment._id.toString(),
      transactionId: txn?._id?.toString() || session.metadata?.transactionId,
    },
  };

  if (!payment.webhookEvents.some((item) => item.eventId === event.id) && !payment.replayProtection?.processedEventIds?.includes(event.id)) {
    payment.webhookEvents.push({ eventId: event.id, type: event.type, status: "processing", receivedAt: new Date() });
  }

  const webhookEntry = payment.webhookEvents.find((item) => item.eventId === event.id);
  let ledgerEntry;
  try {
    ledgerEntry = await markTransactionSucceeded(payment, txn, data, event, req);
  } catch (error) {
    if (webhookEntry) webhookEntry.status = "failed";
    payment.reconciliation = {
      ...(payment.reconciliation || {}),
      status: "mismatch",
      notes: error.message,
    };
    addAuditEntry(payment, "checkout_settlement_rejected", null, { sessionId: session.id, code: error.code, error: error.message }, req);
    await payment.save();
    throw error;
  }
  payment.processingLock = undefined;
  addAuditEntry(payment, "checkout_return_confirmed", null, { sessionId: session.id, paymentStatus: payment.paymentStatus }, req);
  await payment.save();
  if (ledgerEntry) {
    await completePaymentRequest(ledgerEntry);
    await writeLedgerEntry(payment, ledgerEntry, null, req);
  }
  if (webhookEntry) {
    webhookEntry.status = "processed";
    webhookEntry.processedAt = new Date();
  }
  payment.replayProtection = payment.replayProtection || {};
  payment.replayProtection.processedEventIds = [...new Set([...(payment.replayProtection.processedEventIds || []), event.id])];
  payment.replayProtection.lastWebhookAt = new Date();
  await payment.save();
  await syncCasePlanPayment(payment).catch((error) => recordNonBlockingPaymentIssue(payment, "case_plan_sync_failed", error, req, { sessionId: session.id }));
  await notifyPayment(payment, null, "payment_webhook", req).catch((error) => {
    recordNonBlockingPaymentIssue(payment, "payment_notification_failed", error, req, { sessionId: session.id });
    return payment.save().catch(() => null);
  });
  await publishPaymentUpdate(payment, "payment.completed", req);
  return payment;
}

async function confirmCheckoutSession(sessionId, user, req) {
  if (!sessionId) {
    const error = new Error("Stripe session id is required");
    error.status = 400;
    throw error;
  }

  const payment = await Payment.findOne({ "transactions.stripeSessionId": sessionId });
  if (!payment) {
    const error = new Error("Payment session not found");
    error.status = 404;
    throw error;
  }
  if (!(await canAccessPayment(user, payment))) {
    const error = new Error("You do not have permission to confirm this payment");
    error.status = 403;
    throw error;
  }

  const txn = payment.transactions.find((item) => item.stripeSessionId === sessionId);
  if (txn && ["paid", "succeeded"].includes(txn.status)) {
    recalculatePayment(payment);
    await payment.save();
    await syncCasePlanPayment(payment);
    return payment;
  }

  // This is the one confirmed synchronous external API call in the client
  // portal's request paths — Payments.jsx awaits this on every page load
  // where paymentStatus is processing/pending. Logged on both outcomes so a
  // slow/degraded Stripe endpoint shows up as its own measured stage instead
  // of just "the payments page was slow."
  let session;
  const stripeCallStartedAt = Date.now();
  try {
    session = await paymentGateway.retrieveCheckoutSession(sessionId);
    logger.info("stripe_external_call_performance", {
      operation: "retrieveCheckoutSession",
      durationMs: Date.now() - stripeCallStartedAt,
      outcome: "success",
    });
  } catch (error) {
    logger.info("stripe_external_call_performance", {
      operation: "retrieveCheckoutSession",
      durationMs: Date.now() - stripeCallStartedAt,
      outcome: "error",
    });
    addAuditEntry(payment, "checkout_return_retrieve_failed", user, { sessionId, message: error.message }, req);
    await payment.save();
    return payment;
  }
  if (!session) return payment;

  const paymentIntent = typeof session.payment_intent === "object" ? session.payment_intent : null;
  const paid =
    session.payment_status === "paid" ||
    paymentIntent?.status === "succeeded";

  if (paid) {
    const confirmed = await markCheckoutSessionConfirmed(payment, txn, session, req);
    return Payment.findById(confirmed._id);
  }

  if (txn) {
    txn.providerResponse = sanitizeGatewayResponse(session);
    if (session.status === "expired") {
      txn.status = "expired";
      transitionPayment(payment, "expired", "checkout return");
    } else if (session.payment_status === "unpaid") {
      txn.status = "processing";
      transitionPayment(payment, "processing", "checkout return");
      recalculatePayment(payment);
    }
  }
  await payment.save();
  return payment;
}

async function markTransactionFailed(payment, txn, data, event) {
  if (!txn || ["paid", "succeeded"].includes(txn.status)) return;
  txn.status = "failed";
  txn.failureReason = data.last_payment_error?.message || data.failure_message || event.type;
  txn.providerResponse = sanitizeGatewayResponse(data);
  txn.retryCount = (txn.retryCount || 0) + 1;
  txn.nextRetryAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  transitionPayment(payment, "failed", event.type);
  if (txn.paymentRequestId) {
    await PaymentRequest.findOneAndUpdate({ requestId: txn.paymentRequestId }, { status: "failed", gatewayResponse: sanitizeGatewayResponse(data) });
  }
}

async function applyWebhookEvent(event, req) {
  const data = event.data?.object || {};
  const metadata = data.metadata || {};
  const { paymentId } = metadata;
  const payment = paymentId
    ? await Payment.findById(paymentId)
    : await Payment.findOne({ $or: [{ "transactions.stripePaymentIntentId": data.payment_intent || data.id }, { "transactions.stripeSessionId": data.id }] });
  if (!payment) return null;
  if (payment.webhookEvents.some((item) => item.eventId === event.id && item.status === "processed") || payment.replayProtection?.processedEventIds?.includes(event.id)) return payment;
  let webhookEntry = payment.webhookEvents.find((item) => item.eventId === event.id);
  if (!webhookEntry) {
    payment.webhookEvents.push({ eventId: event.id, type: event.type, status: "processing", receivedAt: new Date() });
    webhookEntry = payment.webhookEvents[payment.webhookEvents.length - 1];
  }
  const txn = findTransactionForWebhook(payment, data, metadata);
  let ledgerEntry;
  const additionalLedgerEntries = [];

  const checkoutPaid = event.type !== "checkout.session.completed" || data.payment_status === "paid";
  if (checkoutPaid && ["checkout.session.completed", "checkout.session.async_payment_succeeded", "payment_intent.succeeded", "invoice.payment_succeeded"].includes(event.type)) {
    try {
      ledgerEntry = await markTransactionSucceeded(payment, txn, data, event, req);
    } catch (error) {
      webhookEntry.status = "failed";
      payment.reconciliation = {
        ...(payment.reconciliation || {}),
        status: "mismatch",
        notes: error.message,
      };
      addAuditEntry(payment, "webhook_settlement_rejected", null, { eventId: event.id, code: error.code, error: error.message }, req);
      await payment.save();
      throw error;
    }
  }
  if (event.type === "payment_intent.created" && txn && !["paid", "succeeded"].includes(txn.status)) txn.status = "processing";
  if (event.type === "payment_intent.processing" && txn && !["paid", "succeeded"].includes(txn.status)) {
    txn.status = "processing";
    transitionPayment(payment, "processing", event.type);
  }
  if (event.type === "payment_intent.amount_capturable_updated" && txn && !["paid", "succeeded"].includes(txn.status)) {
    txn.status = "authorized";
    transitionPayment(payment, "authorized", event.type);
  }
  if (event.type === "checkout.session.expired" && txn && txn.status === "pending") {
    txn.status = "expired";
    transitionPayment(payment, "expired", event.type);
  }
  if (["checkout.session.async_payment_failed", "payment_intent.payment_failed", "invoice.payment_failed"].includes(event.type)) await markTransactionFailed(payment, txn, data, event);
  if (event.type === "charge.refunded") {
    const gatewayRefunds = data.refunds?.data || [];
    for (const gatewayRefund of gatewayRefunds) {
      if (payment.refunds.some((refund) => refund.gatewayRefundId === gatewayRefund.id)) continue;
      payment.refunds.push({
        amount: gatewayRefund.amount,
        currency: gatewayRefund.currency || payment.currency,
        reason: gatewayRefund.reason || "stripe_refund",
        status: gatewayRefund.status === "succeeded" ? "succeeded" : "pending",
        transactionId: txn?._id?.toString(),
        gatewayRefundId: gatewayRefund.id,
        processedAt: gatewayRefund.status === "succeeded" ? new Date() : undefined,
      });
      additionalLedgerEntries.push({
        transactionId: txn?._id,
        entryType: "refund",
        direction: "debit",
        amount: gatewayRefund.amount,
        provider: "stripe",
        providerEventId: gatewayRefund.id,
        providerObjectId: gatewayRefund.id,
        description: "Stripe refund processed",
        metadata: { eventType: event.type },
      });
    }
    recalculatePayment(payment);
    transitionPayment(payment, payment.refundedAmount >= payment.amountPaid ? "refunded" : "partially_refunded", event.type);
  }
  if (["refund.created", "refund.updated", "refund.failed"].includes(event.type)) {
    let refund = payment.refunds.find((item) => item.gatewayRefundId === data.id);
    if (!refund) {
      payment.refunds.push({
        amount: data.amount,
        currency: data.currency || payment.currency,
        reason: data.reason || "stripe_refund",
        status: "pending",
        transactionId: metadata.transactionId,
        gatewayRefundId: data.id,
      });
      refund = payment.refunds[payment.refunds.length - 1];
    }
    refund.status = data.status === "succeeded" ? "succeeded" : data.status === "failed" || event.type === "refund.failed" ? "failed" : "pending";
    refund.processedAt = refund.status === "succeeded" ? new Date() : refund.processedAt;
    if (refund.status === "succeeded") {
      additionalLedgerEntries.push({
        transactionId: refund.transactionId,
        entryType: "refund",
        direction: "debit",
        amount: refund.amount,
        provider: "stripe",
        providerEventId: data.id,
        providerObjectId: data.id,
        description: "Stripe refund processed",
        metadata: { eventType: event.type },
      });
    }
    recalculatePayment(payment);
    if (refund.status === "succeeded") transitionPayment(payment, payment.refundedAmount >= payment.amountPaid ? "refunded" : "partially_refunded", event.type);
  }
  payment.processingLock = undefined;
  addAuditEntry(payment, "webhook", null, { type: event.type, eventId: event.id }, req);
  await payment.save();
  if (ledgerEntry) {
    await completePaymentRequest(ledgerEntry);
    await writeLedgerEntry(payment, ledgerEntry, null, req);
  }
  for (const entry of additionalLedgerEntries) await writeLedgerEntry(payment, entry, null, req);
  webhookEntry.status = "processed";
  webhookEntry.processedAt = new Date();
  payment.replayProtection = payment.replayProtection || {};
  payment.replayProtection.processedEventIds = [...new Set([...(payment.replayProtection.processedEventIds || []), event.id])];
  payment.replayProtection.lastWebhookAt = new Date();
  await payment.save();
  await syncCasePlanPayment(payment).catch((error) => recordNonBlockingPaymentIssue(payment, "case_plan_sync_failed", error, req, { eventId: event.id }));
  await notifyPayment(payment, null, "payment_webhook", req).catch(async (error) => {
    recordNonBlockingPaymentIssue(payment, "payment_notification_failed", error, req, { eventId: event.id });
    await payment.save().catch(() => null);
  });
  const workflowEvent = ["checkout.session.async_payment_failed", "payment_intent.payment_failed", "invoice.payment_failed"].includes(event.type)
    ? "payment.failed"
    : ledgerEntry
      ? "payment.completed"
      : "payment.updated";
  await publishPaymentUpdate(payment, workflowEvent, req);
  return payment;
}

async function refundPayment(payment, payload, user, req) {
  if (!canManagePayments(user)) {
    const error = new Error("Not authorized to refund payments");
    error.status = 403;
    throw error;
  }
  const amount = payload.amount || payload.amountCents
    ? normalizeAmountInput(payload)
    : payment.amountPaid - payment.refundedAmount;
  if (!Number.isFinite(amount) || amount <= 0 || amount > payment.amountPaid - payment.refundedAmount) {
    const error = new Error("Invalid refund amount");
    error.status = 400;
    throw error;
  }
  const sourceTransaction = payload.transactionId
    ? payment.transactions.id(payload.transactionId)
    : [...payment.transactions].reverse().find((transaction) => ["paid", "succeeded"].includes(transaction.status));
  let gatewayRefund;
  const gateway = sourceTransaction?.gateway || payload.gateway || "manual";
  if (gateway === "stripe") {
    gatewayRefund = await paymentGateway.createRefund({
      paymentIntentId: sourceTransaction?.stripePaymentIntentId,
      amount,
      reason: payload.reason,
      idempotencyKey: payload.idempotencyKey || `refund_${payment._id}_${sourceTransaction?._id}_${amount}`,
      metadata: {
        paymentId: payment._id.toString(),
        transactionId: sourceTransaction?._id?.toString() || "",
        invoiceNumber: payment.invoiceNumber || "",
      },
    });
  }
  payment.refunds.push({
    amount,
    currency: payment.currency,
    reason: payload.reason,
    status: gatewayRefund?.status === "succeeded" || gateway !== "stripe" ? "succeeded" : "pending",
    transactionId: sourceTransaction?._id?.toString() || payload.transactionId,
    gatewayRefundId: gatewayRefund?.id || payload.gatewayRefundId,
    requestedBy: user._id,
    processedAt: gatewayRefund?.status === "succeeded" || gateway !== "stripe" ? new Date() : undefined,
  });
  recalculatePayment(payment);
  transitionPayment(payment, payment.refundedAmount >= payment.amountPaid ? "refunded" : "partially_refunded", "manual refund");
  addAuditEntry(payment, "refund", user, payload, req);
  await payment.save();
  await writeLedgerEntry(payment, {
    entryType: "refund",
    direction: "debit",
    amount,
    provider: gateway,
    providerEventId: gatewayRefund?.id,
    providerObjectId: gatewayRefund?.id || payload.gatewayRefundId,
    description: payload.reason || "Manual refund",
  }, user, req);
  await notifyPayment(payment, user, "payment_refunded", req);
  await publishPaymentUpdate(payment, "payment.refunded", req);
  await writeAuditLog("refund", payment, user, payload, req);
  return payment;
}

async function reconcilePayment(payment, payload, user, req) {
  payment.reconciliation = {
    status: payload.status || "matched",
    gatewayBalanceTransactionId: payload.gatewayBalanceTransactionId,
    gatewayFeeAmount: payload.gatewayFeeAmount || 0,
    netAmount: payload.netAmount,
    reconciledAt: new Date(),
    reconciledBy: user._id,
    notes: payload.notes,
  };
  addAuditEntry(payment, "reconcile", user, payload, req);
  await payment.save();
  await writeLedgerEntry(payment, {
    entryType: "reconciliation",
    direction: "debit",
    amount: payload.gatewayFeeAmount || 0,
    provider: "manual",
    description: payload.notes || "Manual reconciliation",
    metadata: payload,
  }, user, req);
  await writeAuditLog("reconcile", payment, user, payload, req);
  return payment;
}

async function notifyPayment(payment, actor, eventType, req) {
  const caseData = payment.caseId || payment.case
    ? await Case.findById(payment.caseId || payment.case).select("assignedCaseManager assignedTeamLead")
    : null;
  const recipients = [...new Set([
    payment.user,
    caseData?.assignedCaseManager,
    caseData?.assignedTeamLead,
  ].filter(Boolean).map(String))];
  const latestTransaction = [...(payment.transactions || [])].reverse().find((transaction) => ["paid", "succeeded", "failed"].includes(transaction.status));

  // Email is client-facing only - staff recipients (assignedCaseManager/
  // assignedTeamLead, also in `recipients` above) get the in-app
  // notification but never this email; only the actual payer does.
  const clientUserId = payment.user ? String(payment.user) : null;
  const wantsPaymentEmail = clientUserId && (eventType === "payment_created" || payment.paymentStatus === "failed");
  let clientEmailFields = {};
  if (wantsPaymentEmail) {
    const clientUser = await User.findById(clientUserId).select("name displayName email").catch(() => null);
    if (clientUser?.email) {
      const amountLabel = typeof payment.totalAmount === "number" ? `$${payment.totalAmount.toFixed(2)}` : undefined;
      clientEmailFields = payment.paymentStatus === "failed"
        ? { emailTemplate: "payment-failed", emailTo: clientUser.email, emailData: { clientName: clientUser.name || clientUser.displayName, caseNumber: payment.invoiceNumber, amount: amountLabel } }
        : { emailTemplate: "payment-required", emailTo: clientUser.email, emailData: { clientName: clientUser.name || clientUser.displayName, caseNumber: payment.invoiceNumber, amount: amountLabel, dueDate: payment.dueDate ? new Date(payment.dueDate).toLocaleDateString() : undefined } };
    }
  }

  await Promise.all(recipients.map((userId) => notificationService.createNotification({
    userId,
    type: eventType === "payment_refunded" ? "refund_processed" : eventType === "payment_created" ? "invoice_generated" : payment.paymentStatus === "failed" ? "payment_failed" : "payment_received",
    category: "payment",
    title: eventType === "payment_refunded" ? "Payment Refunded" : eventType === "payment_created" ? "Invoice Created" : "Payment Updated",
    message: `Invoice ${payment.invoiceNumber}: ${payment.paymentStatus}`,
    caseId: payment.caseId,
    paymentId: payment._id,
    link: `/payments/${payment._id}`,
    priority: payment.paymentStatus === "overdue" ? "high" : "medium",
    metadata: { paymentId: payment._id, eventType },
    dedupeKey: `payment:${payment._id}:${eventType}:${latestTransaction?._id || payment.paymentStatus}:${payment.amountPaid}:${payment.refundedAmount}`,
    ...(userId === clientUserId ? clientEmailFields : {}),
  }, actor, req)));
}

async function publishPaymentUpdate(payment, eventName, req) {
  const payload = {
    paymentId: payment._id,
    caseId: payment.caseId || payment.case,
    invoiceNumber: payment.invoiceNumber,
    paymentStatus: payment.paymentStatus,
    lifecycleStatus: payment.lifecycleStatus,
    amountPaid: payment.amountPaid,
    refundedAmount: payment.refundedAmount,
    remainingAmount: payment.remainingAmount,
    totalAmount: payment.totalAmount,
    currency: payment.currency,
    updatedAt: payment.updatedAt || new Date(),
  };
  realtimeGateway.emitToUser(payment.user, "payment:updated", payload);
  for (const role of ["admin", "super_admin", "team_lead", "case_manager"]) {
    realtimeGateway.emitToRole(role, "payment:updated", payload);
  }
  // Every payment update goes through here — bump the shared dashboard cache
  // generation so revenue/payment aggregates never outlive a real change.
  dashboardCacheBump().catch(() => {});
  if (eventName === "payment.completed" || eventName === "payment.failed") {
    await workflowService.triggerWorkflow(eventName, {
      entityId: payment.caseId || payment.case || payment._id,
      caseId: payment.caseId || payment.case,
      paymentId: payment._id,
      invoiceNumber: payment.invoiceNumber,
      paymentStatus: payment.paymentStatus,
      amount: payment.amountPaid,
      currency: payment.currency,
    }, null, req).catch((error) => recordNonBlockingPaymentIssue(payment, "payment_workflow_failed", error, req, { eventName }));
  }
}

async function financeStats(query = {}, user) {
  const filter = user ? await buildPaymentFilter(query, user) : {};
  if (!user && (query.from || query.to)) {
    filter.createdAt = {};
    if (query.from) filter.createdAt.$gte = new Date(query.from);
    if (query.to) filter.createdAt.$lte = new Date(query.to);
  }
  const payments = await Payment.find(filter);
  const totalRevenue = payments.reduce((sum, payment) => sum + (payment.amountPaid || payment.paidAmount || 0), 0);
  const pendingRevenue = payments.reduce((sum, payment) => sum + (payment.remainingAmount || 0), 0);
  const refundedAmount = payments.reduce((sum, payment) => sum + (payment.refundedAmount || 0), 0);
  const overduePayments = payments.filter((payment) => payment.paymentStatus === "overdue").length;
  return {
    totalRevenue,
    pendingRevenue,
    pendingAmount: pendingRevenue,
    refundedAmount,
    overduePayments,
    overdueAmount: payments.filter((payment) => payment.paymentStatus === "overdue").reduce((sum, payment) => sum + (payment.remainingAmount || 0), 0),
    pendingPayments: payments.filter((payment) => ["not_started", "pending", "processing", "partially_paid", "partial", "overdue"].includes(payment.paymentStatus)).length,
    failedPayments: payments.filter((payment) => payment.paymentStatus === "failed").length,
    activeInvoices: payments.filter((payment) => (payment.remainingAmount || 0) > 0).length,
    totalPayments: payments.length,
    paymentRate: payments.length ? Math.round((payments.filter((payment) => payment.paymentStatus === "paid").length / payments.length) * 100) : 0,
  };
}

async function recoverPaymentRequest(requestId, user) {
  const request = await PaymentRequest.findOne({ requestId });
  if (!request) return null;
  const payment = request.paymentId ? await Payment.findById(request.paymentId) : null;
  if (payment && !(await canAccessPayment(user, payment))) {
    const error = new Error("You do not have permission to view this payment request");
    error.status = 403;
    throw error;
  }
  return { request, payment };
}

async function getReceipt(payment, transactionId, user) {
  if (!(await canAccessPayment(user, payment))) {
    const error = new Error("You do not have permission to view this receipt");
    error.status = 403;
    throw error;
  }
  const transaction = transactionId ? payment.transactions.id(transactionId) : payment.transactions.find((txn) => ["paid", "succeeded"].includes(txn.status));
  if (!transaction) return null;
  let receipt = payment.receipts.find((item) => item.transactionId?.toString() === transaction._id.toString());
  if (!receipt) {
    receipt = {
      receiptNumber: `RCT-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      transactionId: transaction._id,
      amount: transaction.amount,
      issuedAt: new Date(),
    };
    payment.receipts.push(receipt);
    await payment.save();
  }
  return { receipt, transaction };
}

async function reconciliationScan(query = {}, user) {
  const filter = user ? await buildPaymentFilter(query, user) : {};
  if (!user && query.status) filter.paymentStatus = query.status;
  const payments = await Payment.find(filter);
  const issues = [];
  for (const payment of payments) {
    const successfulTransactions = payment.transactions.filter((txn) => ["paid", "succeeded"].includes(txn.status));
    const computedPaid = successfulTransactions.reduce((sum, txn) => sum + (txn.amount || 0), 0);
    if (computedPaid !== payment.amountPaid) issues.push({ paymentId: payment._id, invoiceNumber: payment.invoiceNumber, type: "amount_mismatch", expected: computedPaid, actual: payment.amountPaid });
    const duplicateIntents = successfulTransactions.map((txn) => txn.stripePaymentIntentId).filter(Boolean);
    if (new Set(duplicateIntents).size !== duplicateIntents.length) issues.push({ paymentId: payment._id, invoiceNumber: payment.invoiceNumber, type: "duplicate_gateway_intent" });
    if (payment.lifecycleStatus === "processing" && payment.updatedAt < new Date(Date.now() - 60 * 60 * 1000)) issues.push({ paymentId: payment._id, invoiceNumber: payment.invoiceNumber, type: "stale_processing_state" });
  }
  return { checked: payments.length, issues };
}

async function reconcilePendingPayments(limit = 50) {
  if (!paymentGateway.configurationStatus().required.STRIPE_SECRET_KEY) return { checked: 0, updated: 0, skipped: true };
  const payments = await Payment.find({
    transactions: {
      $elemMatch: {
        stripeSessionId: { $exists: true, $ne: "" },
        status: { $in: ["pending", "processing", "requires_action"] },
      },
    },
  }).sort({ updatedAt: 1 }).limit(Math.min(Math.max(Number(limit) || 50, 1), 200));
  let updated = 0;
  for (const payment of payments) {
    const transaction = payment.transactions.find((item) =>
      item.stripeSessionId && ["pending", "processing", "requires_action"].includes(item.status)
    );
    if (!transaction) continue;
    try {
      const checkoutSession = await paymentGateway.retrieveCheckoutSession(transaction.stripeSessionId);
      const paymentIntent = typeof checkoutSession?.payment_intent === "object" ? checkoutSession.payment_intent : null;
      if (checkoutSession?.payment_status === "paid" || paymentIntent?.status === "succeeded") {
        await markCheckoutSessionConfirmed(payment, transaction, checkoutSession);
        updated += 1;
      } else if (checkoutSession?.status === "expired") {
        transaction.status = "expired";
        payment.processingLock = undefined;
        transitionPayment(payment, "expired", "scheduled reconciliation");
        await payment.save();
        updated += 1;
      }
    } catch (error) {
      addAuditEntry(payment, "scheduled_reconciliation_failed", null, { sessionId: transaction.stripeSessionId, error: error.message });
      await payment.save().catch(() => null);
    }
  }
  return { checked: payments.length, updated, skipped: false };
}

function populatePaymentQuery(query) {
  return query.populate([
    { path: "user", select: "name displayName email role" },
    { path: "caseId", select: "caseNumber caseId clientName clientEmail visaType package plan status stage createdAt updatedAt questionnaireData" },
    { path: "case", select: "caseNumber caseId clientName clientEmail visaType package plan status stage createdAt updatedAt questionnaireData" },
  ]);
}

module.exports = {
  addManualPayment,
  applyWebhookEvent,
  attachCheckoutSession,
  buildPaymentFilter,
  canAccessPayment,
  canManagePayments,
  canRecordManualPayments,
  confirmCheckoutSession,
  createPayment,
  createPendingTransaction,
  financeStats,
  getReceipt,
  getOrCreateClientPayment,
  populatePaymentQuery,
  recoverPaymentRequest,
  reconcilePayment,
  reconciliationScan,
  reconcilePendingPayments,
  refundPayment,
  recalculatePayment,
  sanitizeGatewayResponse,
  validateGatewaySettlement,
  validateManualPayment,
  writeLedgerEntry,
  writeAuditLog,
};
