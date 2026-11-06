// PUT /api/cases/:id/finance - edit a case's payment figures from Immiglance (US dollars). Saved at once, counted by every Admin analytics screen, and sent to the
// case's GoHighLevel card (Value, USCIS Fee, QB Amount Paid, QB Invoice No.) through the outbound queue. Staff only; the person must be able to open the case.
const caseService = require("../cases/case.service");
const finance = require("./caseFinance.service");

exports.updateCaseFinance = async (req, res, next) => {
  try {
    await caseService.getAccessibleCaseOrThrow(req.params.id, req.user, { omit: caseService.CASE_OMIT_HISTORY }); // 404 / 403 exactly like opening the case
    const result = await finance.editCaseFinance(req.params.id, req.body || {}, req.user);
    if (result.changed) {
      const caseData = await require("../../models/Case").findById(req.params.id).select("caseNumber clientName").lean();
      await caseService.writeAuditLog("update_payment_figures", caseData, req.user, { before: result.before, after: result.after, sentToGoHighLevel: result.ghl.queued }, req).catch(() => null);
    }
    const fresh = await finance.forCase(req.params.id);
    res.json({ success: true, changed: result.changed, finance: fresh, ghl: result.ghl });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ success: false, code: error.code, message: error.message });
    next(error);
  }
};
