const { FEE_SCHEDULE } = require("../../config/visaFeeSchedule");

// GET /api/fee-schedule
exports.list = async (req, res, next) => {
  try {
    res.json({ success: true, count: FEE_SCHEDULE.length, feeSchedule: FEE_SCHEDULE });
  } catch (e) { next(e); }
};
