// The golden-set review API (plan Phase 2): the answer key that later decides whether the AI helper may propose mappings.
//   GET  /api/golden-set/summary              - progress, per-form progress, the plan's bar, sign-off state, who the reviewer is and whether YOU can answer
//   GET  /api/golden-set/entries              - ?formCode=&status=unanswered|right|wrong|unsure&search=&offset=&limit=   (plain wording only)
//   PUT  /api/golden-set/entries/:id/review   - { verdict: right|wrong|unsure, correction?, note? }                      (named reviewer only)
//   POST /api/golden-set/sign-off             - { confirm: true }                                                          (named reviewer only)
//   GET  /api/golden-set/export.csv           - the whole set as a spreadsheet, with the reviewer's answers
// Reading: super_admin, admin, team_lead and the reviewer. Answering and signing off: only the reviewer address(es) in GOLDEN_SET_REVIEWERS (default admin@immiglance.com).
const router = require("express").Router();
const authenticate = require("../../../middleware/authenticate");
const { hasRole } = require("../../authorization/rbac.service");
const { getGoldenSetService } = require("../golden/GoldenSetService");
const { toCsv } = require("../golden/exportCsv");

const READ_ROLES = ["super_admin", "admin", "team_lead"];

const handle = (fn) => async (req, res, next) => {
  try {
    res.json({ success: true, data: await fn(req) });
  } catch (error) {
    next(error);
  }
};

const mayRead = (req, res, next) => (hasRole(req.user, READ_ROLES) || getGoldenSetService().canReview(req.user) ? next() : res.status(403).json({ success: false, message: "Not allowed to view the golden set" }));

router.use(authenticate, mayRead);

router.get("/summary", handle((req) => getGoldenSetService().summary(req.user)));
router.get("/entries", handle((req) => getGoldenSetService().list(req.query)));
router.put("/entries/:id/review", handle((req) => getGoldenSetService().setReview(req.params.id, req.body || {}, req.user)));
router.post("/sign-off", handle((req) => getGoldenSetService().signOff(req.user, req.body || {})));

router.get("/export.csv", async (req, res, next) => {
  try {
    const rows = await getGoldenSetService().exportRows();
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="golden-set-review.csv"');
    res.send(`﻿${toCsv(rows)}`);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
