const router = require("express").Router();
const authenticate = require("../../middleware/authenticate");
const authorizeRoles = require("../../middleware/authorizeRoles");
const authorizePermissions = require("../../middleware/authorizePermissions");
const ctrl = require("./billing.controller");

const billingRoles = ["super_admin", "admin", "team_lead"];
const financeRoles = ["super_admin", "admin"];

router.get("/dashboard", authenticate, authorizeRoles(...billingRoles), authorizePermissions("billing:report"), ctrl.getDashboard);
router.get("/invoices", authenticate, authorizeRoles(...billingRoles), authorizePermissions("billing:read"), ctrl.listInvoices);
router.get("/ledger", authenticate, authorizeRoles(...financeRoles), authorizePermissions("billing:report"), ctrl.getLedger);
router.get("/requests", authenticate, authorizeRoles(...financeRoles), authorizePermissions("billing:report"), ctrl.getRequests);
router.get("/reconciliation/scan", authenticate, authorizeRoles(...financeRoles), authorizePermissions("billing:reconcile"), ctrl.reconciliationScan);
router.get("/reports", authenticate, authorizeRoles(...billingRoles), authorizePermissions("billing:report"), ctrl.getReports);

module.exports = router;
