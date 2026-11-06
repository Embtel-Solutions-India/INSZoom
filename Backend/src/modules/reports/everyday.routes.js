const router = require("express").Router();
const authenticate = require("../../middleware/authenticate");
const authorizeRoles = require("../../middleware/authorizeRoles");
const service = require("./everyday.service");

// Mounted at /api/reports/everyday. Everyone on the internal team may read everybody's points; writes only ever touch the caller's OWN current work day.
const team = authorizeRoles(...service.INTERNAL_ROLES); // write: no super admin
const readers = authorizeRoles(...service.READER_ROLES); // read: the super admin too (see service.visibleRolesFor for who sees whom)
const handle = (fn) => async (req, res, next) => {
  try {
    res.json({ success: true, data: await fn(req) });
  } catch (error) {
    next(error);
  }
};

router.get("/me", authenticate, team, handle((req) => service.getMine(req.user)));
router.put("/me", authenticate, team, handle((req) => service.saveMine(req.user, req.body)));
router.post("/me/dismiss", authenticate, team, handle((req) => service.dismissMine(req.user, req.body?.kind)));
router.get("/board", authenticate, readers, handle((req) => service.board({ period: req.query.period, role: req.query.role, page: req.query.page }, req.user)));
router.get("/", authenticate, readers, handle((req) => service.listForDate({ date: req.query.date, staff: /^[a-f0-9]{24}$/i.test(req.query.staff || "") ? req.query.staff : undefined }, req.user)));

module.exports = router;
