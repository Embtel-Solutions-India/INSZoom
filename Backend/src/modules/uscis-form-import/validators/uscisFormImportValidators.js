function validateSystemImport(req, res, next) {
  const pdfUrl = req.body?.pdfUrl || req.body?.url;
  if (!pdfUrl) return res.status(400).json({ success: false, message: "pdfUrl is required" });
  if (!/^https:\/\/.+/i.test(String(pdfUrl))) return res.status(400).json({ success: false, message: "pdfUrl must be an HTTPS URL" });
  return next();
}

function normalizeImportBody(req, _res, next) {
  req.body = {
    ...(req.body || {}),
    formType: req.body?.formType || req.body?.formCode || req.body?.formNumber,
    provider: req.body?.provider || "uscis",
  };
  return next();
}

module.exports = {
  normalizeImportBody,
  validateSystemImport,
};
