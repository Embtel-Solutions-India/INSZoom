const leaderboardService = require("./leaderboard.service");

// GET /api/leaderboard?board=case_managers|team_leads|attorneys|clients&period=today|this_week|this_month|all_time
// Always computed live. (`role=case_manager|team_lead|attorney` is still
// accepted for older callers.)
const LEGACY_ROLE_TO_BOARD = { case_manager: "case_managers", team_lead: "team_leads", attorney: "attorneys", client: "clients" };

async function list(req, res, next) {
  try {
    const board = req.query.board || LEGACY_ROLE_TO_BOARD[req.query.role] || "case_managers";
    const result = await leaderboardService.getLeaderboard({ board, period: req.query.period || "this_month" });
    res.json({ success: true, ...result, data: result.rows, leaderboard: result.rows });
  } catch (error) {
    next(error);
  }
}

// Kept for the old "Calculate Performance" button: there is nothing to
// calculate any more (boards are live), so it simply returns the live board.
async function calculate(req, res, next) {
  req.query = { ...req.query, period: req.body?.period || req.query.period, board: req.body?.board || req.query.board };
  return list(req, res, next);
}

module.exports = { calculate, list };
