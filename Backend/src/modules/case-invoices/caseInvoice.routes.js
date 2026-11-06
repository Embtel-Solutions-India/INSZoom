const router = require("express").Router();
const authenticate = require("../../middleware/authenticate");
const authorizeRoles = require("../../middleware/authorizeRoles");
const upload = require("../uploads/upload.middleware");
const { sendFile } = require("../../utils/fileResponse");
const service = require("./caseInvoice.service");

// Mounted at /api/case-invoices. Internal team only (never clients, employers or attorneys).
const staff = [authenticate, authorizeRoles(...service.STAFF_ROLES)];

router.get("/:caseId/employee-payments", ...staff, async (req, res, next) => {
  try {
    res.json({ success: true, data: await service.employeePayments(req.params.caseId, req.user) });
  } catch (error) {
    next(error);
  }
});

router.get("/:caseId", ...staff, async (req, res, next) => {
  try {
    res.json({ success: true, data: await service.list(req.params.caseId, req.user) });
  } catch (error) {
    next(error);
  }
});

router.post("/:caseId", ...staff, upload.single("file"), async (req, res, next) => {
  try {
    res.status(201).json({ success: true, data: await service.add(req.params.caseId, req.file, req.body, req.user) });
  } catch (error) {
    next(error);
  }
});

router.get("/:caseId/:invoiceId/file", ...staff, async (req, res, next) => {
  try {
    const { invoice, buffer } = await service.read(req.params.caseId, req.params.invoiceId, req.user);
    sendFile(res, { buffer, fileName: invoice.fileName, mimeType: invoice.mimeType, disposition: req.query.download === "1" ? "attachment" : "inline" });
  } catch (error) {
    next(error);
  }
});

router.delete("/:caseId/:invoiceId", ...staff, async (req, res, next) => {
  try {
    res.json({ success: true, data: await service.remove(req.params.caseId, req.params.invoiceId, req.user) });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
