import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import useHasCase from "../../hooks/useHasCase";
import { useMyCase, useMyProfile } from "../../hooks/useMyCaseProfile";
import StartAssessmentButton from "../../components/StartAssessmentButton";
import OfferCard from "../../components/OfferCard";
import {
  ATTORNEY_REVIEW_PACKAGE,
  FULL_ATTORNEY_FILING_PACKAGE,
  SELF_FILING_PACKAGE,
  getPriceRangesByTier,
  formatCentsRange,
} from "../../config/pricingCatalog";
import { PLANS } from "../../config/planConfig";
import { leadsApi, referralApi, tokenStore } from "../../services/api";
import {
  IconGift,
  IconSparkles,
  IconUsers,
  IconArrowRight,
  IconHandThumbsUp,
  IconCelebrate,
  IconSchool,
  IconBriefcase,
  IconIdCard,
} from "../../utils/iconComponents";

const CATEGORIES = [
  { code: "EB-1A", title: "Extraordinary Ability", desc: "Self-petition green card for individuals with extraordinary ability." },
  { code: "EB-1B", title: "Outstanding Researcher / Professor", desc: "Employer-sponsored green card for internationally recognized researchers and professors." },
  { code: "EB-2 NIW", title: "National Interest Waiver", desc: "Green card for advanced-degree professionals whose work benefits the U.S. national interest." },
  { code: "O-1A", title: "Extraordinary Ability (Temporary)", desc: "Nonimmigrant work visa for individuals with extraordinary ability, sponsored by an employer or agent." },
  { code: "EB-5", title: "Immigrant Investor", desc: "Green card through a qualifying investment in a U.S. business that creates jobs." },
  { code: "E-2", title: "Treaty Investor", desc: "Visa for treaty-country nationals investing a substantial amount in a U.S. business they direct and develop." },
  { code: "H-1B", title: "Specialty Occupation", desc: "Employer-sponsored work visa for professionals in a specialty occupation." },
  { code: "L-1A", title: "Intracompany Transferee (Executive/Manager)", desc: "Visa for executives and managers transferring within a multinational company." },
];

const HOW_IT_WORKS = [
  {
    title: "Complete your free case evaluation",
    desc: "Answer a short questionnaire tailored to the visa or green card category you're pursuing.",
    icon: (
      <svg width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
        <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
    ),
  },
  {
    title: "Attorney reviews your profile",
    desc: "Our attorney-managed team reviews your answers and recommends the strongest strategy for your case.",
    icon: (
      <svg width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
        <path d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
      </svg>
    ),
  },
  {
    title: "Track everything in your portal",
    desc: "See tasks, upload documents, and message your case team — all in one place, anytime.",
    icon: (
      <svg width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
        <path d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
      </svg>
    ),
  },
];

const FULL_PROCESS = [
  { num: "01", title: "Free Eligibility Quiz", desc: "Answer a short, guided questionnaire about your background and goals. In minutes, we match you to the visa or green card categories you're most likely to qualify for." },
  { num: "02", title: "Free Consultation", desc: "Talk through your results with an attorney-managed case consultant — no cost, no obligation, and no pressure to commit." },
  { num: "03", title: "Case Assignment", desc: "Once you move forward, a dedicated case manager is assigned to your file — the same person who guides you from here through filing." },
  { num: "04", title: "Client Dashboard Access", desc: "Your case lives in one secure portal: track status, see what's next, message your team, and manage documents from any device." },
  { num: "05", title: "Detailed Questionnaire", desc: "Complete a deep, category-specific questionnaire built for your exact case type. Answers auto-save, so nothing is ever lost." },
  { num: "06", title: "Document Upload & Auto-Fill", desc: "Upload your supporting documents securely. Matching fields are auto-filled for you — always visible and editable before anything is finalized." },
  { num: "07", title: "Form Preparation & Review", desc: "Your case manager and our attorneys prepare, review, and refine every official USCIS form your petition requires." },
  { num: "08", title: "Petition Assembly & Filing", desc: "Your complete petition — cover letter, exhibits, and forms — is assembled, printed, and filed with USCIS. You get tracking and a copy of everything submitted." },
];

const TRUST_ITEMS = [
  "Every evaluation is reviewed by our attorney-managed case team before any recommendation is made.",
  "Your case timeline, tasks, and documents live in one secure portal — not scattered across email threads.",
  "Built for EB-1, EB-2 NIW, O-1, EB-5, E-2, H-1B, and L-1A — with a dedicated questionnaire for each.",
];

/* ── Who we help ─────────────────────────────────────────────────────────────── */
const WHO_WE_HELP = [
  { icon: IconSchool, label: "Students", desc: "F-1 & J-1 visas, I-20 support, OPT/CPT" },
  { icon: IconUsers, label: "Families", desc: "Spousal, parent & sibling petitions" },
  { icon: IconBriefcase, label: "Corporate", desc: "H-1B, L-1, O-1 employer petitions" },
  { icon: IconIdCard, label: "Green Card", desc: "EB & family-based permanent residency" },
];

/* ── Packages — priced from the catalog. Actual price depends on visa type, so
   this shows a range (lowest to highest across all visa types) rather than a
   fixed number; the exact price for a case is only shown once a visa type is
   known, via the questionnaire/case flow, never selected directly here. ──── */
const TIER_RANGES = getPriceRangesByTier();
const OFFERS = [
  {
    icon: IconSparkles,
    title: SELF_FILING_PACKAGE,
    description: "Guided self-file kit with templates, checklists, and optional attorney review.",
    price: formatCentsRange(TIER_RANGES[SELF_FILING_PACKAGE].min, TIER_RANGES[SELF_FILING_PACKAGE].max),
    features: PLANS.find((p) => p.id === SELF_FILING_PACKAGE)?.features || [],
  },
  {
    icon: IconGift,
    title: ATTORNEY_REVIEW_PACKAGE,
    description: "Package includes full document review and a one-hour attorney consultation.",
    price: formatCentsRange(TIER_RANGES[ATTORNEY_REVIEW_PACKAGE].min, TIER_RANGES[ATTORNEY_REVIEW_PACKAGE].max),
    features: PLANS.find((p) => p.id === ATTORNEY_REVIEW_PACKAGE)?.features || [],
  },
  {
    icon: IconHandThumbsUp,
    title: FULL_ATTORNEY_FILING_PACKAGE,
    description: "End-to-end attorney-led filing, USCIS forms, and case management.",
    price: formatCentsRange(TIER_RANGES[FULL_ATTORNEY_FILING_PACKAGE].min, TIER_RANGES[FULL_ATTORNEY_FILING_PACKAGE].max),
    features: PLANS.find((p) => p.id === FULL_ATTORNEY_FILING_PACKAGE)?.features || [],
  },
];

/* ── Referral benefits ───────────────────────────────────────────────────────── */
const REFERRAL_BENEFITS = [
  { icon: IconUsers, title: "Refer Your Friend", description: "Earn a 10% reward credit for every successful referral when your friend completes their visa application with us." },
  { icon: IconGift, title: "Your Friend Saves", description: "Your friend gets 10% discount on their first visa application package. Win-win!" },
  { icon: IconSparkles, title: "Unlimited Earning", description: "No limits on how many friends you can refer. Keep earning rewards for every successful referral." },
  { icon: IconArrowRight, title: "Easy Process", description: "Share your unique referral code, your friend signs up, and get rewarded when they complete their application." },
];

/* ── FAQ ──────────────────────────────────────────────────────────────────────── */
const FAQS = [
  { q: "Can I switch packages later?", a: "Absolutely! You can upgrade or change packages anytime. We'll credit any payments toward your new package." },
  { q: "Do packages include all visa types?", a: "Our packages cover all common visa categories. Specialized categories (EB-1A, O-1) may have premium pricing. Contact us for exact quotes." },
  { q: "Are there payment plans available?", a: "Yes! We offer flexible payment plans for larger packages. Discuss options with our team during consultation." },
  { q: "What's your success rate guarantee?", a: "We work with best-effort practices and have a 95%+ success rate. If your case is denied, we offer reapplication support at a reduced rate." },
  { q: "Can I get a custom package?", a: "Yes! Message our team through the portal or call us to discuss your specific needs and create a custom package." },
];

function FAQItem({ q, a }) {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <div className="rounded-xl border border-border bg-card hover:border-primary/30 transition-all duration-200 overflow-hidden">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between px-6 py-4 text-left hover:bg-secondary transition-colors gap-4 cursor-pointer"
      >
        <span className="font-semibold text-foreground">{q}</span>
        <span
          className={`shrink-0 w-6 h-6 rounded-full flex items-center justify-center bg-secondary text-muted-foreground transition-transform duration-200 ${
            isOpen ? "rotate-180 bg-accent text-accent-foreground" : ""
          }`}
        >
          <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 9l-7 7-7-7" />
          </svg>
        </span>
      </button>
      {isOpen && (
        <div className="px-6 pb-4 text-sm text-muted-foreground leading-relaxed border-t border-border pt-4 bg-secondary/50">
          {a}
        </div>
      )}
    </div>
  );
}

export default function Home() {
  const { user } = useAuth();
  const { hasCase } = useHasCase();
  const navigate = useNavigate();
  const isLoggedIn = !!tokenStore.getAccess();

  const [email, setEmail] = useState("");
  const [contactLoading, setContactLoading] = useState(false);
  const [referral, setReferral] = useState(null);
  const [copied, setCopied] = useState(false);

  // Package selection only ever happens through the questionnaire/case
  // flow — the Packages section's CTA just routes: to the intake
  // questionnaire if the visitor hasn't selected a visa type / has no case
  // yet, or to their dashboard if they've already decided a visa type and
  // service plan.
  const { data: myCase } = useMyCase({ enabled: isLoggedIn });
  const { data: myProfile } = useMyProfile({ enabled: isLoggedIn });
  const visaType = myProfile?.visaType || myProfile?.assessmentRecommendedVisa || myCase?.visaType || "";
  const hasDecidedPlan = isLoggedIn && Boolean(myCase?._id) && Boolean(visaType) && Boolean(myCase?.plan?.tier);
  const goToNextStep = () => navigate(hasDecidedPlan ? "/dashboard" : "/dashboard/intake");

  useEffect(() => {
    document.title = "Immiglance | Attorney-Managed Case Evaluation & Client Portal";
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
      `Get 10% off your US visa package with Immiglance! Use my referral link: ${referralLink}`
    );
    window.open(`https://wa.me/?text=${text}`, "_blank");
  };

  const handleContactRequest = async (e) => {
    e.preventDefault();
    setContactLoading(true);
    try {
      await leadsApi.create({
        fullName: "Website Contact",
        email,
        phone: "Not provided",
        visaType: "Not specified",
        message: "Contact request submitted from the Home page.",
        source: "Home Page — Contact Request",
      });
      // The backend persists the lead and sends the internal notification
      // email itself — the client never needs an email address/mailto link.
      alert("Thank you! We'll contact you shortly.");
      setEmail("");
    } catch (error) {
      alert(error.message || "Unable to send your request. Please try again.");
    } finally {
      setContactLoading(false);
    }
  };

  return (
    <div className="bg-background">
      {/* ══ HERO ══ */}
      <section className="max-w-7xl mx-auto px-5 sm:px-6 lg:px-8 pt-16 sm:pt-24 pb-16">
        <span className="inline-block mb-6 px-4 py-1.5 rounded-full bg-secondary text-xs font-semibold text-muted-foreground">
          Attorney-managed case evaluation &amp; client portal
        </span>
        <h1 className="text-4xl sm:text-6xl font-serif font-bold text-foreground leading-[1.05] tracking-tight mb-6 max-w-3xl">
          Your immigration case, at a glance.
        </h1>
        <p className="text-base sm:text-lg text-muted-foreground leading-relaxed max-w-2xl mb-8">
          Immiglance is where clients complete a guided case evaluation and track their EB-1, EB-2 NIW, O-1,
          EB-5, E-2, H-1B, or L-1A case from first questionnaire to filing — with tasks, documents, and secure
          messaging in one portal.
        </p>
        <div className="flex flex-col sm:flex-row gap-3">
          {hasCase ? (
            <Link
              to="/dashboard"
              className="inline-flex items-center justify-center gap-2 px-7 py-3.5 text-base font-bold rounded-xl
                bg-primary text-primary-foreground shadow-lg shadow-black/10 hover:opacity-90 transition-all
                duration-200 active:scale-95 no-underline"
            >
              Continue My Case
              <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M9 5l7 7-7 7" />
              </svg>
            </Link>
          ) : (
            <StartAssessmentButton pageSource="Home Page">
              Start Free Case Evaluation
            </StartAssessmentButton>
          )}
          <a
            href="#process"
            className="inline-flex items-center justify-center px-7 py-3.5 text-base font-semibold rounded-xl
              border border-border text-foreground hover:bg-secondary transition-all duration-200 no-underline"
          >
            See How It Works
          </a>
        </div>
        {!user && (
          <p className="text-sm text-muted-foreground mt-4">No account needed to start — takes about 8 minutes.</p>
        )}
      </section>

      {/* ══ CATEGORY GRID ══ */}
      <section className="max-w-7xl mx-auto px-5 sm:px-6 lg:px-8 pb-16">
        <h2 className="text-2xl sm:text-3xl font-serif font-bold text-foreground mb-2">
          Which category fits your case?
        </h2>
        <p className="text-muted-foreground mb-8 max-w-2xl">
          Choose a category to begin a tailored evaluation, or tell us you're not sure and we'll recommend one for you.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          {CATEGORIES.map(({ code, title, desc }) => (
            <Link
              key={code}
              to={`/eligibility?src=${encodeURIComponent(`Home Page — ${code}`)}`}
              className="rounded-lg border border-card-border bg-card p-5 hover:border-primary/40 hover:shadow-sm
                transition-all no-underline flex flex-col"
            >
              <span className="inline-block self-start mb-3 px-2.5 py-1 rounded-md bg-secondary text-[0.7rem]
                font-bold text-foreground">
                {code}
              </span>
              <h3 className="font-bold text-foreground text-base mb-1.5 leading-snug">{title}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">{desc}</p>
            </Link>
          ))}
        </div>
        <Link
          to="/eligibility?src=Home%20Page%20—%20Not%20Sure"
          className="inline-flex items-center gap-2 text-sm font-semibold text-primary hover:opacity-80 no-underline"
        >
          Not sure which category fits? Let us recommend one
          <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M9 5l7 7-7 7" />
          </svg>
        </Link>
      </section>

      {/* ══ HOW IT WORKS ══ */}
      <section className="border-t border-border">
        <div className="max-w-7xl mx-auto px-5 sm:px-6 lg:px-8 py-16">
          <h2 className="text-2xl sm:text-3xl font-serif font-bold text-foreground mb-10">How Immiglance works</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-8 mb-12">
            {HOW_IT_WORKS.map(({ title, desc, icon }) => (
              <div key={title}>
                <div className="w-11 h-11 rounded-lg bg-accent text-accent-foreground flex items-center
                  justify-center mb-4">
                  {icon}
                </div>
                <h3 className="font-bold text-foreground mb-1.5">{title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>

          <div className="border-t border-border pt-8 grid grid-cols-1 sm:grid-cols-3 gap-6">
            {TRUST_ITEMS.map((item) => (
              <div key={item} className="flex items-start gap-3">
                <span className="mt-0.5 shrink-0 w-5 h-5 rounded-full bg-primary/10 text-primary flex items-center
                  justify-center">
                  <svg width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7" />
                  </svg>
                </span>
                <p className="text-sm text-muted-foreground leading-relaxed">{item}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ══ THE COMPLETE JOURNEY ══ */}
      <section id="process" className="border-t border-border">
        <div className="max-w-7xl mx-auto px-5 sm:px-6 lg:px-8 py-16">
          <h2 className="text-2xl sm:text-3xl font-serif font-bold text-foreground mb-2">
            From your first quiz to your filed petition
          </h2>
          <p className="text-muted-foreground mb-10 max-w-2xl">
            A closer look at everything that happens between saying hello and having your petition filed with USCIS.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            {FULL_PROCESS.map(({ num, title, desc }) => (
              <div
                key={num}
                className="rounded-lg border border-card-border bg-card p-5 flex flex-col"
              >
                <span className="inline-block self-start mb-3 px-2.5 py-1 rounded-md bg-secondary text-[0.7rem]
                  font-bold text-foreground">
                  {num}
                </span>
                <h3 className="font-bold text-foreground text-base mb-1.5 leading-snug">{title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
          {hasCase ? (
            <Link
              to="/dashboard"
              className="inline-flex items-center justify-center gap-2 px-7 py-3.5 text-base font-bold rounded-xl
                bg-primary text-primary-foreground shadow-lg shadow-black/10 hover:opacity-90 transition-all
                duration-200 active:scale-95 no-underline"
            >
              Continue My Case
              <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M9 5l7 7-7 7" />
              </svg>
            </Link>
          ) : (
            <StartAssessmentButton pageSource="Home Page — Full Process">
              Start Free Case Evaluation
            </StartAssessmentButton>
          )}
        </div>
      </section>

      {/* ══ ABOUT US ══ */}
      <section id="about" className="border-t border-border">
        <div className="max-w-7xl mx-auto px-5 sm:px-6 lg:px-8 py-16">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
            <div>
              <h2 className="text-2xl sm:text-3xl font-serif font-bold text-foreground mb-4">
                Who we are
              </h2>
              <div className="space-y-4 text-muted-foreground leading-relaxed text-[15px]">
                <p>
                  <strong className="text-foreground">Immiglance</strong> provides expert support
                  to individuals, families, and the corporate sector for both immigrant and
                  non-immigrant visa petitions. We specialize in preparing and organizing all
                  required documentation for every US visa category.
                </p>
                <p>
                  After careful review, we submit the finalized petition directly to the{" "}
                  <strong className="text-foreground">U.S. Citizenship &amp; Immigration Services (USCIS)</strong>.
                  From the first consultation to the moment you hold your visa, our dedicated
                  consultants and attorneys stand with you every step of the way.
                </p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              {WHO_WE_HELP.map(({ icon: Icon, label, desc }) => (
                <div key={label} className="rounded-lg border border-card-border bg-card p-5">
                  <Icon size={26} className="text-primary mb-3" />
                  <p className="font-bold text-foreground text-sm mb-1">{label}</p>
                  <p className="text-xs text-muted-foreground leading-relaxed">{desc}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ══ PACKAGES ══ */}
      <section id="packages" className="border-t border-border">
        <div className="max-w-7xl mx-auto px-5 sm:px-6 lg:px-8 py-16">
          <h2 className="text-2xl sm:text-3xl font-serif font-bold text-foreground mb-2">
            Packages built for every budget
          </h2>
          <p className="text-muted-foreground mb-10 max-w-2xl">
            Flexible, affordable visa assistance packages. Exact pricing depends on your visa type
            and is confirmed once your case is set up.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {OFFERS.map((offer, idx) => (
              <OfferCard key={idx} {...offer} cta={goToNextStep} ctaText="Get Started" />
            ))}
          </div>
        </div>
      </section>

      {/* ══ REFER A FRIEND ══ */}
      <section className="border-t border-border bg-secondary/40">
        <div className="max-w-7xl mx-auto px-5 sm:px-6 lg:px-8 py-16">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
            <div>
              <h2 className="text-2xl sm:text-3xl font-serif font-bold text-foreground mb-4">
                Refer a friend
              </h2>
              <p className="text-muted-foreground mb-8 leading-relaxed">
                Know someone who needs visa assistance? Share your unique referral code and earn
                rewards for every successful referral. Help your friends while earning!
              </p>
              <div className="space-y-4">
                {REFERRAL_BENEFITS.map((b) => (
                  <div key={b.title} className="flex gap-4">
                    <div className="shrink-0">
                      <b.icon size={22} className="text-primary" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-foreground text-sm mb-0.5">{b.title}</h3>
                      <p className="text-sm text-muted-foreground">{b.description}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="p-8 sm:p-10 rounded-2xl bg-primary text-primary-foreground">
              <h3 className="text-xl font-bold mb-4">Your Referral Code</h3>
              <div className="mb-6 p-4 bg-primary-foreground/20 rounded-lg backdrop-blur">
                <p className="text-sm text-primary-foreground/80 mb-2">Your unique code:</p>
                <p className="text-2xl font-mono font-bold break-all">{referralCode}</p>
                {referral?.successfulReferrals > 0 && (
                  <p className="text-xs text-primary-foreground/80 mt-2 flex items-center gap-1.5">
                    <IconCelebrate size={14} className="text-primary-foreground/80" /> {referral.successfulReferrals} successful referral(s) so far
                  </p>
                )}
              </div>
              <p className="text-primary-foreground/80 text-sm mb-6 leading-relaxed">
                Share your link with friends. When they sign up and complete their application,
                you both get 10% off!
              </p>
              <button onClick={copyReferral} className="w-full px-4 py-3 rounded-lg bg-card text-primary font-bold hover:bg-accent transition-colors mb-3 cursor-pointer">
                {copied ? "Copied!" : referral?.referralCode ? "Copy Referral Link" : "Sign in to get your code"}
              </button>
              <button onClick={shareWhatsApp} className="w-full px-4 py-3 rounded-lg border-2 border-primary-foreground text-primary-foreground font-bold hover:bg-primary-foreground/10 transition-colors cursor-pointer">
                Share on WhatsApp
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* ══ FAQ + CONTACT ══ */}
      <section id="faq" className="border-t border-border">
        <div className="max-w-7xl mx-auto px-5 sm:px-6 lg:px-8 py-16">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
            <div>
              <h2 className="text-2xl sm:text-3xl font-serif font-bold text-foreground mb-8">
                Frequently asked questions
              </h2>
              <div className="space-y-3">
                {FAQS.map((faq) => (
                  <FAQItem key={faq.q} q={faq.q} a={faq.a} />
                ))}
              </div>
            </div>
            <div>
              <div className="p-8 sm:p-10 rounded-2xl bg-primary text-primary-foreground h-full flex flex-col justify-center">
                <h2 className="text-xl sm:text-2xl font-bold mb-3">Still have questions?</h2>
                <p className="text-primary-foreground/80 mb-6 leading-relaxed">
                  Our team is ready to help. Leave your email and we'll reach out for a free
                  15-minute consultation.
                </p>
                <form onSubmit={handleContactRequest} className="flex flex-col sm:flex-row gap-3">
                  <input
                    type="email"
                    placeholder="your@email.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    className="flex-1 px-4 py-3 rounded-lg bg-card text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary-foreground/40"
                  />
                  <button
                    type="submit"
                    disabled={contactLoading}
                    className="px-6 py-3 rounded-lg bg-accent text-accent-foreground font-bold hover:opacity-90 transition-colors disabled:opacity-50 cursor-pointer"
                  >
                    {contactLoading ? "Sending…" : "Contact Us"}
                  </button>
                </form>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ══ FOOTER ══ */}
      <footer className="border-t border-border">
        <div className="max-w-7xl mx-auto px-5 sm:px-6 lg:px-8 py-8 flex flex-col sm:flex-row items-center
          justify-between gap-3 text-sm text-muted-foreground">
          <div className="flex items-center gap-4">
            <span>Immiglance © {new Date().getFullYear()}</span>
            <Link to="/admin" className="hover:text-foreground transition-colors no-underline">Staff Login</Link>
          </div>
          <span>A case evaluation &amp; client portal platform.</span>
        </div>
      </footer>
    </div>
  );
}
