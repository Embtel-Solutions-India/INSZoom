const { validationResult } = require("express-validator");
const leadService = require("./lead.service");

function validationFailed(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({ success: false, message: "Validation failed", errors: errors.array() });
    return true;
  }
  return false;
}

exports.createPublicLead = async (req, res, next) => {
  try {
    if (validationFailed(req, res)) return;
    const result = await leadService.createLead(req.body, req);
    res.status(201).json({
      success: true,
      message: "Consultation lead received",
      lead: result.lead,
      email: result.email,
    });
  } catch (error) {
    next(error);
  }
};
