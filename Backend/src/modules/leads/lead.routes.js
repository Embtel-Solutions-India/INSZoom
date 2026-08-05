const router = require("express").Router();
const { body } = require("express-validator");
const ctrl = require("./lead.controller");

const leadRules = [
  body("fullName").optional().trim().notEmpty(),
  body("name").optional().trim().notEmpty(),
  body().custom((value) => {
    if (String(value.fullName || value.name || "").trim()) return true;
    throw new Error("Full name is required");
  }),
  body("email").isEmail().normalizeEmail().withMessage("Valid email is required"),
  body("phone").trim().notEmpty().withMessage("Phone number is required"),
];

router.post("/public", leadRules, ctrl.createPublicLead);

module.exports = router;
