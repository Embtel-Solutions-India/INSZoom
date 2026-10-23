const router = require("express").Router();
const rateLimit = require("express-rate-limit");
const logger = require("../../utils/logger");
const service = require("./public-forms.service");

// Public and read-only: the blank official USCIS forms, nothing case- or client-specific. Own limiter, like the other public routes.
const limiter = rateLimit({ windowMs: 60 * 1000, max: 120, standardHeaders: true, legacyHeaders: false });
router.use(limiter);

router.get("/", async (req, res, next) => {
  try {
    res.set("Cache-Control", "public, max-age=300");
    res.json({ success: true, data: await service.listForms() });
  } catch (error) {
    next(error);
  }
});

router.get("/:formCode/pdf", async (req, res, next) => {
  try {
    const pdf = await service.readFormPdf(req.params.formCode);
    if (!pdf) return res.status(404).json({ success: false, message: "This form is not available." });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${pdf.filename}"`);
    res.setHeader("Cache-Control", "public, max-age=3600");
    return res.send(pdf.buffer);
  } catch (error) {
    logger.error?.("public_form_pdf_unavailable", { formCode: req.params.formCode, code: error?.code });
    return res.status(502).json({ success: false, message: "This form could not be opened right now. Please try again." });
  }
});

module.exports = router;
