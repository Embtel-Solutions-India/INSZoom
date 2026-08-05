const Referral = require("../../models/Referral");
const User = require("../../models/User");
const { generateUniqueReferralCode } = require("../../utils/referralCode");

const REFERRAL_DISCOUNT_PERCENT = Number(process.env.REFERRAL_DISCOUNT_PERCENT || 10);

async function getMyReferral(req, res, next) {
  try {
    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    if (!user.referralCode) {
      user.referralCode = await generateUniqueReferralCode(User);
      await user.save();
    }

    const successfulReferrals = await Referral.countDocuments({ referrer: user._id, status: "rewarded" });
    res.json({
      success: true,
      referralCode: user.referralCode,
      discountPercent: REFERRAL_DISCOUNT_PERCENT,
      discountAvailable: Boolean(user.referralDiscountAvailable),
      discountReason: user.referralDiscountReason || "",
      referralRewardCount: user.referralRewardCount || 0,
      successfulReferrals,
      referredWithCode: user.referredWithCode || "",
    });
  } catch (error) {
    next(error);
  }
}

async function validateCode(req, res, next) {
  try {
    const code = String(req.params.code || "").trim().toUpperCase();
    if (!code) return res.json({ success: true, valid: false, reason: "empty" });

    const owner = await User.findOne({ referralCode: code }).select("_id displayName name");
    if (!owner) return res.json({ success: true, valid: false, reason: "not_found" });
    if (owner._id.toString() === req.user._id.toString()) return res.json({ success: true, valid: false, reason: "own_code" });

    return res.json({ success: true, valid: true, discountPercent: REFERRAL_DISCOUNT_PERCENT });
  } catch (error) {
    next(error);
  }
}

module.exports = { getMyReferral, validateCode };
