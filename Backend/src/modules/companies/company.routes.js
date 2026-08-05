const router = require("express").Router();
const { body, query } = require("express-validator");
const authenticate = require("../../middleware/authenticate");
const authorizeRoles = require("../../middleware/authorizeRoles");
const authorizePermissions = require("../../middleware/authorizePermissions");
const validate = require("../../middleware/validate");
const ctrl = require("./company.controller");

const readRoles = ["super_admin", "admin", "team_lead", "case_manager"];
const writeRoles = ["super_admin", "admin"];
const adminRoles = ["super_admin", "admin"];
const statuses = ["active", "inactive", "prospect", "on_hold", "archived"];

const companyRules = [
  body("name").optional().trim().isLength({ min: 2 }).withMessage("Company name must be at least 2 characters"),
  body("companyName").optional().trim().isLength({ min: 2 }).withMessage("Company name must be at least 2 characters"),
  body("contact.email").optional().isEmail().normalizeEmail(),
  body("email").optional().isEmail().normalizeEmail(),
  body("status").optional().isIn(statuses).withMessage("Invalid company status"),
];

router.get("/dashboard", authenticate, authorizeRoles(...readRoles), authorizePermissions("companies:read"), ctrl.getDashboard);
router.get(
  "/",
  authenticate,
  authorizeRoles(...readRoles),
  authorizePermissions("companies:read"),
  query("status").optional().isIn(statuses),
  validate,
  ctrl.getCompanies
);
router.post("/", authenticate, authorizeRoles(...adminRoles), authorizePermissions("companies:create"), body("name").optional(), companyRules, validate, ctrl.createCompany);
router.get("/:id", authenticate, authorizeRoles(...readRoles), authorizePermissions("companies:read"), ctrl.getCompany);
router.put("/:id", authenticate, authorizeRoles(...writeRoles), authorizePermissions("companies:update"), companyRules, validate, ctrl.updateCompany);
router.delete("/:id", authenticate, authorizeRoles(...adminRoles), authorizePermissions("companies:delete"), ctrl.deleteCompany);
router.put("/:id/status", authenticate, authorizeRoles(...adminRoles), authorizePermissions("companies:update"), body("status").isIn(statuses), validate, ctrl.updateStatus);
router.post("/:id/notes", authenticate, authorizeRoles(...writeRoles), authorizePermissions("companies:update"), body("note").notEmpty(), validate, ctrl.addNote);
router.get("/:id/dashboard", authenticate, authorizeRoles(...readRoles), authorizePermissions("companies:read"), ctrl.getDashboard);
router.get("/:id/related", authenticate, authorizeRoles(...readRoles), authorizePermissions("companies:read"), ctrl.getRelated);

module.exports = router;
