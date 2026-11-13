const router = require("express").Router();
const authenticate = require("../../middleware/authenticate");
const authorizeRoles = require("../../middleware/authorizeRoles");
const service = require("./caseInvoice.service");

// Mounted at /api/case-invoices. Internal team only (never clients, employers or attorneys).
// A case's invoices are LINKS (the Invoice URL of its GoHighLevel card + any added here); there is no invoice file upload any more.
const staff = [authenticate, authorizeRoles(...service.STAFF_ROLES)];

router.get("/:caseId/employee-payments", ...staff, async (req, res, next) => {
  try {
    res.json({ success: true, data: await service.employeePayments(req.params.caseId, req.user) });
  } catch (error) {
    next(error);
  }
});

router.get("/:caseId/urls", ...staff, async (req, res, next) => {
  try {
    res.json({ success: true, data: await service.listUrls(req.params.caseId, req.user) });
  } catch (error) {
    next(error);
  }
});

router.post("/:caseId/urls", ...staff, async (req, res, next) => {
  try {
    res.status(201).json({ success: true, data: await service.addUrl(req.params.caseId, req.body, req.user) });
  } catch (error) {
    next(error);
  }
});

router.delete("/:caseId/urls", ...staff, async (req, res, next) => {
  try {
    res.json({ success: true, data: await service.removeUrl(req.params.caseId, String(req.query.url || ""), req.user) });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
