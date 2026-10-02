const router = require("express").Router({ mergeParams: true });
const { body } = require("express-validator");
const authenticate = require("../../middleware/authenticate");
const authorizeRoles = require("../../middleware/authorizeRoles");
const authorizePermissions = require("../../middleware/authorizePermissions");
const validate = require("../../middleware/validate");
const ctrl = require("./information-request.controller");
const { ITEM_KINDS, DOCUMENT_CATEGORIES } = require("./information-request.service");

// Staff only - same roles/permission as the legacy employment-workflow request endpoint.
const staffRoles = ["super_admin", "admin", "team_lead", "case_manager"];
const guard = [authenticate, authorizeRoles(...staffRoles), authorizePermissions("cases:update")];

const hasTwoOptions = (value, { req }) =>
  req.body.itemKind !== "select" || (Array.isArray(value) && value.map((item) => String(item).trim()).filter(Boolean).length >= 2);

router.get("/recipients", ...guard, ctrl.listRecipients);
router.get("/", ...guard, ctrl.list);
router.post(
  "/",
  ...guard,
  body("recipientId").isString().trim().notEmpty().withMessage("Recipient is required"),
  body("name").isString().trim().isLength({ min: 2, max: 200 }).withMessage("Item name must be 2-200 characters"),
  body("itemKind").isIn(ITEM_KINDS).withMessage("Unsupported request type"),
  body("documentCategory").optional({ values: "falsy" }).isIn(DOCUMENT_CATEGORIES),
  body("description").optional({ values: "falsy" }).isString().isLength({ max: 2000 }),
  body("dueDate").optional({ values: "falsy" }).isISO8601(),
  body("options").optional().isArray({ max: 50 }),
  body("options.*").optional().isString().isLength({ min: 1, max: 200 }),
  body("options").custom(hasTwoOptions).withMessage("A select question needs at least two options"),
  validate,
  ctrl.create
);

router.hasTwoOptions = hasTwoOptions;
module.exports = router;
