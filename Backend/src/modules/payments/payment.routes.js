const router = require("express").Router();
const { body } = require("express-validator");
const rateLimit = require("express-rate-limit");
const authenticate = require("../../middleware/authenticate");
const authorizeRoles = require("../../middleware/authorizeRoles");
const authorizePermissions = require("../../middleware/authorizePermissions");
const validate = require("../../middleware/validate");
const ctrl = require("./payment.controller");

const paymentReadRoles = ["super_admin", "admin", "team_lead", "case_manager", "client", "user"];
const financeRoles = ["super_admin", "admin"];
const manualPaymentRoles = [...financeRoles, "team_lead"];
const checkoutLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "Too many payment attempts. Please wait and try again." },
});

router.get("/summary", authenticate, authorizePermissions("payments:read"), ctrl.getPaymentSummary);
router.post(
  "/create-partial-checkout-session",
  checkoutLimiter,
  authenticate,
  authorizePermissions("payments:create"),
  body("amount").isFloat({ gt: 0 }),
  body("amountUnit").optional().isIn(["cents", "dollars"]),
  body("scheduleKey").optional().isIn(["pay_in_full", "two_installments", "four_installments", "custom"]),
  body("paymentRequestId").optional().isString().isLength({ min: 8, max: 200 }),
  validate,
  ctrl.createPartialCheckoutSession
);
router.post(
  "/confirm-checkout-session",
  checkoutLimiter,
  authenticate,
  authorizePermissions("payments:read"),
  body("sessionId").isString().matches(/^cs_(test|live)_[A-Za-z0-9]+$/),
  validate,
  ctrl.confirmCheckoutSession
);
router.get("/dashboard/stats", authenticate, authorizeRoles("admin", "super_admin", "team_lead"), authorizePermissions("payments:report"), ctrl.getFinanceStats);
router.get("/gateway/configuration", authenticate, authorizeRoles(...financeRoles), authorizePermissions("payments:report"), ctrl.getGatewayConfiguration);
router.get("/requests", authenticate, authorizeRoles(...financeRoles), authorizePermissions("payments:report"), ctrl.getPaymentRequests);
router.get("/requests/:requestId", authenticate, authorizePermissions("payments:read"), ctrl.recoverPaymentRequest);
router.get("/ledger", authenticate, authorizeRoles(...financeRoles), authorizePermissions("payments:report"), ctrl.getLedger);
router.get("/webhooks/monitor", authenticate, authorizeRoles(...financeRoles), authorizePermissions("payments:report"), ctrl.getWebhookMonitor);
router.get("/reconciliation/scan", authenticate, authorizeRoles(...financeRoles), authorizePermissions("payments:report"), ctrl.reconciliationScan);
router.get("/reports", authenticate, authorizeRoles(...financeRoles), authorizePermissions("payments:report"), ctrl.getFinanceStats);
router.post("/reports", authenticate, authorizeRoles(...financeRoles), authorizePermissions("payments:report"), ctrl.generateRevenueReport);
router.get("/", authenticate, authorizeRoles(...paymentReadRoles), authorizePermissions("payments:read"), ctrl.getPayments);
router.post(
  "/",
  authenticate,
  authorizeRoles(...financeRoles),
  authorizePermissions("payments:create"),
  body("caseId").optional().isMongoId(),
  body("taxRate").optional().isFloat({ min: 0, max: 1 }),
  body("currency").optional().isLength({ min: 3, max: 3 }).isAlpha(),
  validate,
  ctrl.createPayment
);
router.get("/:id", authenticate, authorizeRoles(...paymentReadRoles), authorizePermissions("payments:read"), ctrl.getPayment);
router.put("/:id", authenticate, authorizeRoles(...financeRoles), authorizePermissions("payments:update"), ctrl.updatePayment);
router.post("/:id/payment", authenticate, authorizeRoles(...manualPaymentRoles), authorizePermissions("payments:update"), ctrl.addPayment);
router.post(
  "/:id/refund",
  authenticate,
  authorizeRoles(...financeRoles),
  authorizePermissions("payments:update"),
  body("amount").optional().isFloat({ gt: 0 }),
  body("amountCents").optional().isInt({ gt: 0 }),
  body("reason").isString().trim().isLength({ min: 3, max: 500 }),
  validate,
  ctrl.refundPayment
);
router.post("/:id/reconcile", authenticate, authorizeRoles(...financeRoles), authorizePermissions("payments:update"), ctrl.reconcilePayment);
router.get("/:id/invoices", authenticate, authorizeRoles(...paymentReadRoles), authorizePermissions("payments:read"), ctrl.getInvoices);
router.get("/:id/transactions", authenticate, authorizeRoles(...paymentReadRoles), authorizePermissions("payments:read"), ctrl.getTransactions);
router.get("/:id/ledger", authenticate, authorizeRoles(...financeRoles), authorizePermissions("payments:report"), ctrl.getLedger);
router.get("/:id/receipt/:transactionId?", authenticate, authorizeRoles(...paymentReadRoles), authorizePermissions("payments:read"), ctrl.getReceipt);
router.get("/:id/receipt/:transactionId/download", authenticate, authorizeRoles(...paymentReadRoles), authorizePermissions("payments:read"), ctrl.downloadReceipt);

module.exports = router;
