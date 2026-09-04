import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import OfferCard from "../../components/OfferCard";
import StartAssessmentButton from "../../components/StartAssessmentButton";
import {
  ATTORNEY_REVIEW_PACKAGE,
  FULL_ATTORNEY_FILING_PACKAGE,
  SELF_FILING_PACKAGE,
  getPriceRangesByTier,
  formatCentsRange,
} from "../../config/pricingCatalog";
import { PLANS } from "../../config/planConfig";
import { leadsApi, referralApi, tokenStore } from "../../services/api";
import { useMyCase, useMyProfile } from "../../hooks/useMyCaseProfile";
import {
  IconGift,
  IconSparkles,
  IconUsers,
  IconArrowRight,
  IconHandThumbsUp,
  IconCelebrate,
} from "../../utils/iconComponents";

/* ── Offers/Services data — single source of truth, priced from the catalog.
   Actual price depends on visa type, so this page shows a range (lowest to
   highest across all visa types) rather than one fixed number — the exact
   price for a case is only shown once a visa type is known, via the
   questionnaire/case flow, never selected directly from this page. ──── */
const TIER_RANGES = getPriceRangesByTier();
const OFFERS = [
  {
    icon: IconSparkles,
    tier: SELF_FILING_PACKAGE,
    title: SELF_FILING_PACKAGE,
    description: "Guided self-file kit with templates, checklists, and optional attorney review.",
    price: formatCentsRange(TIER_RANGES[SELF_FILING_PACKAGE].min, TIER_RANGES[SELF_FILING_PACKAGE].max),
    features: PLANS.find((p) => p.id === SELF_FILING_PACKAGE)?.features || [],
  },
  {
    icon: IconGift,
    tier: ATTORNEY_REVIEW_PACKAGE,
    title: ATTORNEY_REVIEW_PACKAGE,
    description: "Package includes full document review and a one-hour attorney consultation.",
    price: formatCentsRange(TIER_RANGES[ATTORNEY_REVIEW_PACKAGE].min, TIER_RANGES[ATTORNEY_REVIEW_PACKAGE].max),
    features: PLANS.find((p) => p.id === ATTORNEY_REVIEW_PACKAGE)?.features || [],
  },
  {
    icon: IconHandThumbsUp,
    tier: FULL_ATTORNEY_FILING_PACKAGE,
    title: FULL_ATTORNEY_FILING_PACKAGE,
    description: "End-to-end attorney-led filing, USCIS forms, and case management.",
    price: formatCentsRange(TIER_RANGES[FULL_ATTORNEY_FILING_PACKAGE].min, TIER_RANGES[FULL_ATTORNEY_FILING_PACKAGE].max),
    features: PLANS.find((p) => p.id === FULL_ATTORNEY_FILING_PACKAGE)?.features || [],
  },
];

/* ── Referral benefits data ──────────────────────────────────────────────────── */
const REFERRAL_BENEFITS = [
  {
    icon: IconUsers,
    title: "Refer Your Friend",
    description: "Earn a 10% reward credit for every successful referral when your friend completes their visa application with us.",
  },
  {
    icon: IconGift,
    title: "Your Friend Saves",
    description: "Your friend gets 10% discount on their first visa application package. Win-win!",
  },
  {
    icon: IconSparkles,
    title: "Unlimited Earning",
    description: "No limits on how many friends you can refer. Keep earning rewards for every successful referral.",
  },
  {
    icon: IconArrowRight,
    title: "Easy Process",
    description: "Share your unique referral code, your friend signs up, and get rewarded when they complete their application.",
  },
];

export default function Offers() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [referral, setReferral] = useState(null);
  const [copied, setCopied] = useState(false);
  const isLoggedIn = !!tokenStore.getAccess();

  // Package selection only ever happens through the questionnaire/case flow —
  // this page's CTA just routes: to the intake questionnaire if the visitor
  // hasn't selected a visa type / has no case yet, or to their dashboard if
  // they've already decided a visa type and service plan.
  const { data: myCase } = useMyCase({ enabled: isLoggedIn });
  const { data: myProfile } = useMyProfile({ enabled: isLoggedIn });
  const visaType = myProfile?.visaType || myProfile?.assessmentRecommendedVisa || myCase?.visaType || "";
  const hasDecided = isLoggedIn && Boolean(myCase?._id) && Boolean(visaType) && Boolean(myCase?.plan?.tier);
  const goToNextStep = () => navigate(hasDecided ? "/dashboard" : "/dashboard/intake");

  useEffect(() => {
    window.scrollTo(0, 0);
    // Best-effort: load the logged-in user's real referral code.
    referralApi.me().then(setReferral).catch(() => setReferral(null));
  }, []);

  const referralCode = referral?.referralCode || "Sign in to get your code";
  const referralLink = referral?.referralCode
    ? `${window.location.origin}/signup?ref=${referral.referralCode}`
    : `${window.location.origin}/signup`;

  const copyReferral = async () => {
    if (!referral?.referralCode) { navigate("/login"); return; }
    try {
      await navigator.clipboard.writeText(referralLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard unavailable */ }
  };

  const shareWhatsApp = () => {
    const text = encodeURIComponent(
      `Get 10% off your US visa package with BAIS! Use my referral link: ${referralLink}`
    );
    window.open(`https://wa.me/?text=${text}`, "_blank");
  };

  const handleContactRequest = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await leadsApi.create({
        fullName: "Website Contact",
        email,
        phone: "Not provided",
        visaType: "Not specified",
        message: "Contact request submitted from the Offers page.",
        source: "Offers Page — Contact Request",
      });
      // The backend persists the lead and sends the internal notification
      // email itself - the client never needs an email address/mailto link.
      alert("Thank you! We'll contact you shortly.");
      setEmail("");
    } catch (error) {
      alert(error.message || "Unable to send your request. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-linear-to-b from-slate-50 via-white to-slate-50">
      {/* ── Hero Section ────────────────────────────────────────────────────────── */}
      <section className="pt-16 sm:pt-24 pb-12 px-5 sm:px-8 max-w-6xl mx-auto">
        <div className="text-center max-w-3xl mx-auto mb-16 animate-[fadeIn_0.6s_ease-out]">
          <h1 className="text-4xl sm:text-5xl font-extrabold text-slate-900 mb-4 leading-tight">
            Our Offers & Packages
          </h1>
          <p className="text-lg text-slate-600 leading-relaxed mb-8">
            Flexible, affordable visa assistance packages designed for every immigration need and budget.
          </p>
          <StartAssessmentButton size="lg" pageSource="Offers Page">Not sure which package fits? Take the free assessment</StartAssessmentButton>
        </div>
      </section>

      {/* ── Services/Offers Grid ────────────────────────────────────────────────── */}
      <section className="px-5 sm:px-8 max-w-6xl mx-auto mb-20">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {OFFERS.map((offer, idx) => (
            <div
              key={idx}
              className="animate-[fadeIn_0.6s_ease-out]"
              style={{ animationDelay: `${idx * 0.15}s` }}
            >
              <OfferCard
                {...offer}
                cta={goToNextStep}
                ctaText="Get Started"
              />
            </div>
          ))}
        </div>
      </section>

      {/* ── Refer a Friend Section ──────────────────────────────────────────────── */}
      <section className="py-16 sm:py-24 px-5 sm:px-8 max-w-6xl mx-auto">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
          {/* Left: Referral Benefits */}
          <div className="animate-[fadeIn_0.6s_ease-out]">
            <h2 className="text-3xl sm:text-4xl font-extrabold text-slate-900 mb-6">
              Refer a Friend
            </h2>
            <p className="text-slate-600 mb-8 leading-relaxed">
              Know someone who needs visa assistance? Share your unique referral code and earn rewards for every successful referral. Help your friends while earning!
            </p>

            <div className="space-y-4">
              {REFERRAL_BENEFITS.map((benefit, idx) => (
                <div key={idx} className="flex gap-4 group p-4 rounded-lg hover:bg-slate-50 transition-colors">
                  <div className="shrink-0">
                    <benefit.icon size={24} className="text-emerald-600 group-hover:text-emerald-700 transition-colors" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-slate-900 mb-1">{benefit.title}</h3>
                    <p className="text-sm text-slate-600">{benefit.description}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Right: Referral CTA Card */}
          <div className="animate-[fadeIn_0.6s_ease-out]" style={{ animationDelay: "0.15s" }}>
            <div className="p-8 sm:p-10 rounded-2xl bg-linear-to-br from-emerald-600 to-teal-600 text-white">
              <h3 className="text-2xl font-bold mb-4">Your Referral Code</h3>
              <div className="mb-6 p-4 bg-white/20 rounded-lg backdrop-blur">
                <p className="text-sm text-emerald-100 mb-2">Your unique code:</p>
                <p className="text-2xl font-mono font-bold break-all">{referralCode}</p>
                {referral?.successfulReferrals > 0 && (
                  <p className="text-xs text-emerald-100 mt-2 flex items-center gap-1.5">
                    <IconCelebrate size={14} className="text-emerald-100" /> {referral.successfulReferrals} successful referral(s) so far
                  </p>
                )}
              </div>
              <p className="text-emerald-100 text-sm mb-6 leading-relaxed">
                Share your link with friends. When they sign up and complete their application, you both get 10% off!
              </p>
              <button onClick={copyReferral} className="w-full px-4 py-3 rounded-lg bg-white text-emerald-600 font-bold hover:bg-emerald-50 transition-colors mb-3">
                {copied ? "Copied!" : referral?.referralCode ? "Copy Referral Link" : "Sign in to get your code"}
              </button>
              <button onClick={shareWhatsApp} className="w-full px-4 py-3 rounded-lg border-2 border-white text-white font-bold hover:bg-white/10 transition-colors">
                Share on WhatsApp
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* ── Special Offer Banner ────────────────────────────────────────────────── */}
      <section className="py-12 px-5 sm:px-8 bg-linear-to-r from-emerald-600 via-teal-600 to-emerald-600">
        <div className="max-w-4xl mx-auto text-center text-white">
          <h2 className="text-2xl sm:text-3xl font-extrabold mb-4 flex items-center justify-center gap-2.5">
            <IconCelebrate size={26} className="text-white shrink-0" /> Limited Time Offer: 20% Off Your First Consultation
          </h2>
          <p className="text-emerald-100 mb-6 text-lg">
            Use code <span className="font-mono font-bold bg-white/20 px-3 py-1 rounded">WELCOME20</span> when booking your consultation
          </p>
          <button
            type="button"
            onClick={goToNextStep}
            className="inline-block px-8 py-3 rounded-lg bg-white text-emerald-600 font-bold hover:bg-emerald-50 transition-colors"
          >
            Claim Your Discount
          </button>
        </div>
      </section>

      {/* ── FAQ Section ─────────────────────────────────────────────────────────── */}
      <section className="py-16 sm:py-24 px-5 sm:px-8 max-w-3xl mx-auto">
        <h2 className="text-3xl sm:text-4xl font-extrabold text-slate-900 mb-12 text-center">
          Questions About Our Offers?
        </h2>

        <div className="space-y-4">
          {[
            {
              q: "Can I switch packages later?",
              a: "Absolutely! You can upgrade or change packages anytime. We'll credit any payments toward your new package.",
            },
            {
              q: "Do packages include all visa types?",
              a: "Our packages cover all common visa categories. Specialized categories (EB-1A, O-1) may have premium pricing. Contact us for exact quotes.",
            },
            {
              q: "Are there payment plans available?",
              a: "Yes! We offer flexible payment plans for larger packages. Discuss options with our team during consultation.",
            },
            {
              q: "What's your success rate guarantee?",
              a: "We work with best-effort practices and have a 95%+ success rate. If your case is denied, we offer reapplication support at a reduced rate.",
            },
            {
              q: "Can I get a custom package?",
              a: "Yes! Contact our team at info@bayareaimmigrationservices.com to discuss your specific needs and create a custom package.",
            },
          ].map((faq, idx) => (
            <FAQItem key={idx} q={faq.q} a={faq.a} />
          ))}
        </div>
      </section>

      {/* ── Contact Section ─────────────────────────────────────────────────────── */}
      <section className="py-16 sm:py-24 px-5 sm:px-8 max-w-4xl mx-auto">
        <div className="p-8 sm:p-12 rounded-2xl bg-slate-900 text-white text-center">
          <h2 className="text-3xl sm:text-4xl font-extrabold mb-4">Still Have Questions?</h2>
          <p className="text-slate-300 mb-8 text-lg max-w-2xl mx-auto">
            Our team is ready to help. Contact us for a free 15-minute consultation.
          </p>
          <form onSubmit={handleContactRequest} className="flex flex-col sm:flex-row gap-3 max-w-lg mx-auto">
            <input
              type="email"
              placeholder="your@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="flex-1 px-4 py-3 rounded-lg bg-white text-slate-900 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
            <button
              type="submit"
              disabled={loading}
              className="px-6 py-3 rounded-lg bg-emerald-600 text-white font-bold hover:bg-emerald-700 transition-colors disabled:opacity-50"
            >
              {loading ? "Sending..." : "Contact Us"}
            </button>
          </form>
        </div>
      </section>
    </div>
  );
}

/**
 * FAQ Item Component
 */
function FAQItem({ q, a }) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="rounded-xl border border-slate-200 bg-white hover:border-emerald-200 transition-all duration-200 overflow-hidden">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between px-6 py-4 text-left hover:bg-slate-50 transition-colors gap-4"
      >
        <span className="font-semibold text-slate-800">{q}</span>
        <span
          className={`shrink-0 w-6 h-6 rounded-full flex items-center justify-center bg-slate-100 text-slate-500 transition-transform duration-200 ${
            isOpen ? "rotate-180 bg-emerald-100 text-emerald-600" : ""
          }`}
        >
          <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 9l-7 7-7-7" />
          </svg>
        </span>
      </button>
      {isOpen && (
        <div className="px-6 pb-4 text-sm text-slate-600 leading-relaxed border-t border-slate-100 pt-4 bg-slate-50/50">
          {a}
        </div>
      )}
    </div>
  );
}
