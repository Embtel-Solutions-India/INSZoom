import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import useHasCase from "../../hooks/useHasCase";
import SiteFooter from "../../components/SiteFooter";
import StartAssessmentButton from "../../components/StartAssessmentButton";
import { leadsApi } from "../../services/api";
import libertyImg from "../../assets/admin-login-liberty.webp";
import {
  IconSparkles,
  IconUsers,
  IconArrowRight,
  IconSchool,
  IconBriefcase,
  IconIdCard,
  IconStar,
  IconGlobe,
  IconDollarSign,
  IconSuitcase,
  IconBuilding,
} from "../../utils/iconComponents";

/* ── Content ─────────────────────────────────────────────────────────────────── */
const CATEGORIES = [
  { code: "EB-1A", title: "Extraordinary Ability", desc: "Self-petition green card for individuals with extraordinary ability.", icon: IconStar },
  { code: "EB-1B", title: "Outstanding Researcher / Professor", desc: "Employer-sponsored green card for internationally recognized researchers and professors.", icon: IconSchool },
  { code: "EB-2 NIW", title: "National Interest Waiver", desc: "Green card for advanced-degree professionals whose work benefits the U.S. national interest.", icon: IconGlobe },
  { code: "O-1A", title: "Extraordinary Ability (Temporary)", desc: "Nonimmigrant work visa for individuals with extraordinary ability, sponsored by an employer or agent.", icon: IconSparkles },
  { code: "EB-5", title: "Immigrant Investor", desc: "Green card through a qualifying investment in a U.S. business that creates jobs.", icon: IconDollarSign },
  { code: "E-2", title: "Treaty Investor", desc: "Visa for treaty-country nationals investing a substantial amount in a U.S. business they direct and develop.", icon: IconBriefcase },
  { code: "H-1B", title: "Specialty Occupation", desc: "Employer-sponsored work visa for professionals in a specialty occupation.", icon: IconSuitcase },
  { code: "L-1A", title: "Intracompany Transferee (Executive/Manager)", desc: "Visa for executives and managers transferring within a multinational company.", icon: IconBuilding },
];

const STATS = [
  { value: "8", label: "Guided steps from first quiz to filed petition" },
  { value: "8", label: "Visa and green card categories covered" },
  { value: "1", label: "Secure portal for tasks, documents and messages" },
  { value: "24/7", label: "Access to your case from any device" },
];

// Three audiences, each with a crop of the same hero photograph (background-position picks the part of the picture).
const AUDIENCES = [
  { title: "Individuals", desc: "Self-petitions and employer-sponsored cases for professionals, researchers, founders and investors.", position: "6% 16%", size: "320%", cta: "Check your eligibility" },
  { title: "Families", desc: "Keep spouses, parents and children organised on one case, with every document and form in one place.", position: "36% 78%", size: "300%", cta: "Start a family evaluation" },
  { title: "Businesses", desc: "H-1B, L-1 and O-1 petitions for employers, with a clear view of every employee case.", position: "58% 70%", size: "280%", cta: "Talk to our team" },
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

const PILLARS = [
  { title: "Attorney-managed review", desc: "Every evaluation is reviewed by our attorney-managed case team before any recommendation is made." },
  { title: "One secure portal", desc: "Your case timeline, tasks, and documents live in one place — not scattered across email threads." },
  { title: "Built for your category", desc: "A dedicated questionnaire for EB-1, EB-2 NIW, O-1, EB-5, E-2, H-1B, and L-1A cases." },
];

const INDIVIDUAL_FEATURES = [
  { title: "Attorney-managed review", desc: "Every evaluation is reviewed by our attorney-managed case team before any recommendation is made." },
  { title: "Auto-filled USCIS forms", desc: "Upload documents once. Matching form fields are filled for you, always visible and editable before anything is finalized." },
  { title: "Live tracking in one portal", desc: "See your status, tasks and messages from any device, so you always know what happens next." },
];
const INDIVIDUAL_SERVICES = [
  { num: "01", title: "Green cards", desc: "EB-1A, EB-1B, EB-2 NIW and EB-5 petitions." },
  { num: "02", title: "Work visas", desc: "O-1A, H-1B and L-1A for professionals and executives." },
  { num: "03", title: "Investor visas", desc: "E-2 treaty investor and EB-5 immigrant investor cases." },
];
const BUSINESS_FEATURES = [
  { title: "One view of every employee case", desc: "Track each petition for your company on a single, secure platform." },
  { title: "Employer and employee questionnaires", desc: "Each side completes a guided questionnaire built for its role in the case." },
  { title: "Prepared and reviewed forms", desc: "Our team prepares, reviews and refines every USCIS form your petition requires." },
];
const BUSINESS_SERVICES = [
  { num: "01", title: "H-1B petitions", desc: "Specialty-occupation workers sponsored by your company." },
  { num: "02", title: "L-1 transfers", desc: "Executives and managers moving within a multinational." },
  { num: "03", title: "O-1 and green card sponsorship", desc: "Extraordinary-ability and employment-based permanent residency." },
];

const WHO_WE_HELP = [
  { icon: IconSchool, label: "Students", desc: "F-1 & J-1 visas, I-20 support, OPT/CPT" },
  { icon: IconUsers, label: "Families", desc: "Spousal, parent & sibling petitions" },
  { icon: IconBriefcase, label: "Corporate", desc: "H-1B, L-1, O-1 employer petitions" },
  { icon: IconIdCard, label: "Green Card", desc: "EB & family-based permanent residency" },
];

const FAQS = [
  { q: "Can I switch packages later?", a: "Absolutely! You can upgrade or change packages anytime. We'll credit any payments toward your new package." },
  { q: "Do packages include all visa types?", a: "Our packages cover all common visa categories. Specialized categories (EB-1A, O-1) may have premium pricing. Contact us for exact quotes." },
  { q: "Are there payment plans available?", a: "Yes! We offer flexible payment plans for larger packages. Discuss options with our team during consultation." },
  { q: "What's your success rate guarantee?", a: "We work with best-effort practices and have a 95%+ success rate. If your case is denied, we offer reapplication support at a reduced rate." },
  { q: "Can I get a custom package?", a: "Yes! Message our team through the portal or call us to discuss your specific needs and create a custom package." },
];

/* ── Small pieces ────────────────────────────────────────────────────────────── */
const ArrowRight = ({ size = 16 }) => (
  <svg width={size} height={size} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M9 5l7 7-7 7" />
  </svg>
);

const ShieldGlyph = () => (
  <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><path d="M9 12l2 2 4-4" /></svg>
);
const LayersGlyph = () => (
  <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2l9 5-9 5-9-5 9-5z" /><path d="M3 12l9 5 9-5" /><path d="M3 17l9 5 9-5" /></svg>
);
const ClockGlyph = () => (
  <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
);
const FEATURE_GLYPHS = [ShieldGlyph, LayersGlyph, ClockGlyph];

function Eyebrow({ children }) {
  return <p className="mb-4 text-xs font-semibold uppercase tracking-[0.2em] text-primary">/{children}</p>;
}

function SectionHeading({ eyebrow, title, children, className = "" }) {
  return (
    <div className={`max-w-2xl ${className}`}>
      <Eyebrow>{eyebrow}</Eyebrow>
      <h2 className="font-display text-4xl font-normal leading-[1.12] tracking-normal text-foreground sm:text-5xl">{title}</h2>
      {children && <p className="mt-4 text-base leading-relaxed text-muted-foreground">{children}</p>}
    </div>
  );
}

function PhotoCrop({ position, size, className = "" }) {
  return (
    <div
      role="img"
      aria-label="New York harbour with the Statue of Liberty"
      className={`bg-no-repeat ${className}`}
      style={{ backgroundImage: `url(${libertyImg})`, backgroundPosition: position, backgroundSize: size }}
    />
  );
}

// Manifest-style split: the photo stays put on one side while the text scrolls on the other (sticky from lg up).
function StickyBlock({ id, eyebrow, title, intro, features, servicesTitle, services, position, size, flip, cta }) {
  return (
    <section id={id} className="scroll-mt-20 border-t border-border">
      <div className="mx-auto grid max-w-7xl gap-12 px-5 py-20 sm:px-6 lg:grid-cols-[5fr_6fr] lg:gap-20 lg:px-8 lg:py-28">
        <div className={flip ? "lg:order-2" : ""}>
          <div className="lg:sticky lg:top-28">
            <PhotoCrop position={position} size={size} className="aspect-4/5 w-full rounded-3xl border border-border" />
          </div>
        </div>
        <div className={flip ? "lg:order-1" : ""}>
          <Eyebrow>{eyebrow}</Eyebrow>
          <h2 className="font-display text-4xl font-normal leading-[1.12] tracking-normal text-foreground sm:text-5xl">{title}</h2>
          <p className="mt-5 max-w-xl text-base leading-relaxed text-muted-foreground">{intro}</p>
          <ul className="mt-12 space-y-10">
            {features.map((feature, index) => {
              const Glyph = FEATURE_GLYPHS[index % FEATURE_GLYPHS.length];
              return (
                <li key={feature.title} className="flex items-start gap-5">
                  <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><Glyph /></span>
                  <div>
                    <h3 className="font-display text-2xl font-normal text-foreground">{feature.title}</h3>
                    <p className="mt-2 max-w-md text-base leading-relaxed text-muted-foreground">{feature.desc}</p>
                  </div>
                </li>
              );
            })}
          </ul>
          <div className="mt-10">{cta}</div>
          <h3 className="mt-20 font-display text-4xl font-normal tracking-normal text-foreground">{servicesTitle}</h3>
          <ol className="mt-8 space-y-6">
            {services.map((service) => (
              <li key={service.num} className="flex items-start gap-5">
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-border bg-white font-display text-xl italic text-primary">{service.num}</span>
                <div>
                  <h4 className="font-display text-2xl font-normal text-foreground">{service.title}</h4>
                  <p className="mt-1 max-w-md text-base leading-relaxed text-muted-foreground">{service.desc}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}

function FAQItem({ q, a }) {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-white transition-colors hover:border-primary/40">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        aria-expanded={isOpen}
        className="flex w-full cursor-pointer items-center justify-between gap-4 px-5 py-4 text-left transition-colors hover:bg-secondary/60"
      >
        <span className="font-semibold text-foreground">{q}</span>
        <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-secondary text-primary transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}>
          <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 9l-7 7-7-7" />
          </svg>
        </span>
      </button>
      {isOpen && <div className="border-t border-border bg-secondary/40 px-5 py-4 text-sm leading-relaxed text-muted-foreground">{a}</div>}
    </div>
  );
}

function ContactResultModal({ status, message, onClose }) {
  const isError = status === "error";
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 backdrop-blur-sm" onClick={onClose} role="presentation">
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        className="w-full max-w-sm animate-[homeModalIn_0.18s_ease-out] rounded-2xl border border-border bg-white p-7 text-center shadow-2xl shadow-black/20"
      >
        <div className={`mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full ${isError ? "bg-destructive/10 text-destructive" : "bg-primary/10 text-primary"}`}>
          {isError ? (
            <svg width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.29 3.86l-8.18 14.18A2 2 0 004 21h16a2 2 0 001.89-2.96L13.71 3.86a2 2 0 00-3.42 0z" />
            </svg>
          ) : (
            <svg width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          )}
        </div>
        <h3 className="mb-2 font-display text-xl font-normal text-foreground">{isError ? "Something went wrong" : "You're all set"}</h3>
        <p className="mb-6 text-sm leading-relaxed text-muted-foreground">{message}</p>
        <button type="button" onClick={onClose} className="w-full cursor-pointer rounded-lg bg-primary px-6 py-3 font-bold text-primary-foreground transition-colors hover:opacity-90">
          OK
        </button>
      </div>
      <style>{`@keyframes homeModalIn { from { opacity: 0; transform: scale(0.96) translateY(4px); } to { opacity: 1; transform: scale(1) translateY(0); } }`}</style>
    </div>
  );
}

/* ── Page ────────────────────────────────────────────────────────────────────── */
export default function Home() {
  const { user } = useAuth();
  const { hasCase } = useHasCase();
  const { hash } = useLocation();

  const [email, setEmail] = useState("");
  const [contactLoading, setContactLoading] = useState(false);
  const [contactResult, setContactResult] = useState(null);

  useEffect(() => {
    document.title = "Immiglance | Attorney-Managed Case Evaluation & Client Portal";
  }, []);

  // The navbar and footer link to sections of this page as "/#section"; the router does not scroll to them by itself.
  useEffect(() => {
    if (!hash) return;
    const target = document.getElementById(hash.slice(1));
    if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [hash]);

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
      // The backend persists the lead (it shows up in the admin portal's
      // Leads inbox) and sends the internal notification email itself — the
      // client never needs an email address/mailto link.
      setContactResult({
        status: "success",
        message: "Thanks for reaching out — a member of our team will be in touch with you shortly.",
      });
      setEmail("");
    } catch (error) {
      setContactResult({
        status: "error",
        message: error.message || "We couldn't send your request. Please try again.",
      });
    } finally {
      setContactLoading(false);
    }
  };

  const primaryCta = (source, size) =>
    hasCase ? (
      <Link
        to="/dashboard"
        className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-7 py-3.5 text-base font-bold text-primary-foreground no-underline shadow-lg shadow-primary/20 transition-all duration-200 hover:opacity-90 active:scale-95"
      >
        Continue My Case <ArrowRight />
      </Link>
    ) : (
      <StartAssessmentButton pageSource={source} size={size}>Start Free Case Evaluation</StartAssessmentButton>
    );

  return (
    <div className="bg-white">
      {/* ══ HERO ══ */}
      <section className="relative overflow-hidden border-b border-border bg-white">
        <div className="h-60 w-full overflow-hidden sm:h-80 lg:absolute lg:inset-0 lg:h-auto">
          <img src={libertyImg} alt="" className="h-full w-full object-cover object-left" />
        </div>
        <div className="pointer-events-none absolute inset-x-0 top-40 hidden h-20 bg-linear-to-b from-transparent to-white sm:top-60 max-lg:block lg:hidden" aria-hidden="true" />
        <div className="pointer-events-none absolute inset-0 hidden bg-linear-to-r from-white/0 via-white/55 to-white/90 lg:block" aria-hidden="true" />

        <div className="relative mx-auto max-w-7xl px-5 pb-20 pt-8 sm:px-6 lg:flex lg:justify-end lg:px-8 lg:py-28">
          <div className="lg:w-[52%]">
            <span className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-white/90 px-4 py-1.5 text-xs font-semibold text-primary shadow-sm">
              <span className="h-1.5 w-1.5 rounded-full bg-primary" aria-hidden="true" />
              Attorney-managed case evaluation &amp; client portal
            </span>
            <h1 className="mt-6 font-display text-5xl font-normal leading-[1.1] tracking-normal text-foreground sm:text-7xl">
              Immigration Law, <em className="italic text-primary">Done Better.</em>
            </h1>
            <p className="mt-6 max-w-xl text-base leading-relaxed text-foreground/80 sm:text-lg">
              Immiglance is where clients complete a guided case evaluation and track their EB-1, EB-2 NIW, O-1, EB-5, E-2, H-1B, or L-1A case from first questionnaire to filing — with tasks, documents, and secure messaging in one portal.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              {primaryCta("Home Page")}
              <a
                href="#process"
                className="inline-flex items-center justify-center rounded-xl border border-border bg-white px-7 py-3.5 text-base font-semibold text-foreground no-underline transition-all duration-200 hover:bg-secondary"
              >
                See How It Works
              </a>
            </div>
            {!user && <p className="mt-4 text-sm text-muted-foreground">No account needed to start — takes about 8 minutes.</p>}
            <dl className="mt-10 grid grid-cols-2 gap-x-6 gap-y-6 border-t border-border/80 pt-8 sm:grid-cols-4">
              {STATS.map((stat) => (
                <div key={stat.label}>
                  <dt className="font-display text-3xl font-normal text-primary">{stat.value}</dt>
                  <dd className="mt-1 text-xs leading-snug text-muted-foreground">{stat.label}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-6 max-w-xl text-[0.7rem] leading-relaxed text-muted-foreground">
              Immiglance is not a law firm and does not provide legal advice. Where legal services are provided, they are provided exclusively by an independent, attorney-supervised law firm.
            </p>
          </div>
        </div>
      </section>

      {/* ══ TRUST STRIP ══ */}
      <section className="border-b border-border bg-white">
        <div className="mx-auto flex max-w-7xl flex-col items-center gap-5 px-5 py-8 sm:px-6 lg:flex-row lg:justify-between lg:px-8">
          <p className="shrink-0 text-xs font-bold uppercase tracking-[0.2em] text-muted-foreground">Cases we prepare</p>
          <ul className="flex flex-wrap items-center justify-center gap-x-8 gap-y-3 lg:justify-end">
            {CATEGORIES.map((category) => (
              <li key={category.code} className="font-display text-xl font-normal text-foreground/70">{category.code}</li>
            ))}
          </ul>
        </div>
      </section>

      {/* ══ WHO WE SERVE ══ */}
      <section className="mx-auto max-w-7xl px-5 py-20 sm:px-6 lg:px-8 lg:py-28">
        <SectionHeading eyebrow="WHO WE SERVE" title="One platform for every kind of case.">
          Whether you are filing for yourself, your family or your company, your case starts the same way: a free, guided evaluation.
        </SectionHeading>
        <div className="mt-12 grid gap-6 md:grid-cols-3">
          {AUDIENCES.map((audience) => (
            <Link
              key={audience.title}
              to={`/eligibility?src=${encodeURIComponent(`Home Page — ${audience.title}`)}`}
              className="group overflow-hidden rounded-2xl border border-border bg-white no-underline transition-all duration-300 hover:-translate-y-1 hover:border-primary/40 hover:shadow-xl hover:shadow-primary/10"
            >
              <PhotoCrop position={audience.position} size={audience.size} className="h-52 w-full transition-transform duration-500 group-hover:scale-105" />
              <div className="relative bg-white p-6">
                <h3 className="font-display text-2xl font-normal text-foreground">{audience.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{audience.desc}</p>
                <span className="mt-5 inline-flex items-center gap-2 text-sm font-bold text-primary">{audience.cta} <ArrowRight size={14} /></span>
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* ══ VISA CATEGORIES ══ */}
      <section id="visas" className="scroll-mt-20 border-t border-border">
        <div className="mx-auto max-w-7xl px-5 py-20 sm:px-6 lg:px-8 lg:py-28">
          <div className="flex flex-col justify-between gap-6 lg:flex-row lg:items-end">
            <SectionHeading eyebrow="VISA CATEGORIES" title="Which category fits your case?">
              Choose a category to begin a tailored evaluation, or tell us you're not sure and we'll recommend one for you.
            </SectionHeading>
            <Link to="/eligibility?src=Home%20Page%20—%20Not%20Sure" className="inline-flex items-center gap-2 text-sm font-bold text-primary no-underline hover:opacity-80">
              Not sure which category fits? Let us recommend one <ArrowRight size={14} />
            </Link>
          </div>
          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {CATEGORIES.map(({ code, title, desc, icon: Icon }) => (
              <Link
                key={code}
                to={`/eligibility?src=${encodeURIComponent(`Home Page — ${code}`)}`}
                className="group flex flex-col rounded-2xl border border-border bg-white p-6 no-underline transition-all duration-300 hover:-translate-y-1 hover:border-primary hover:shadow-lg hover:shadow-primary/10"
              >
                <div className="mb-5 flex items-center justify-between">
                  <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 transition-colors group-hover:bg-primary">
                    <Icon size={22} className="text-primary transition-colors group-hover:text-primary-foreground" />
                  </span>
                  <span className="rounded-full bg-secondary px-3 py-1 text-[0.7rem] font-bold text-foreground">{code}</span>
                </div>
                <h3 className="text-base font-bold leading-snug text-foreground">{title}</h3>
                <p className="mt-2 flex-1 text-sm leading-relaxed text-muted-foreground">{desc}</p>
                <span className="mt-5 inline-flex items-center gap-1.5 text-sm font-bold text-primary opacity-0 transition-opacity group-hover:opacity-100">Start evaluation <ArrowRight size={13} /></span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* ══ INDIVIDUALS ══ */}
      <StickyBlock
        id="individuals"
        eyebrow="INDIVIDUAL IMMIGRATION"
        title={<>Why clients <em className="italic text-primary">trust us?</em></>}
        intro="Whether you are filing for yourself or your family, the platform and your case team work together so you always know where you stand."
        features={INDIVIDUAL_FEATURES}
        servicesTitle={<>Our <em className="italic text-primary">Services</em></>}
        services={INDIVIDUAL_SERVICES}
        position="6% 16%"
        size="330%"
        cta={primaryCta("Home Page — Individuals")}
      />

      {/* ══ BUSINESSES ══ */}
      <StickyBlock
        id="businesses"
        eyebrow="BUSINESS IMMIGRATION"
        title={<>Sponsor your workforce <em className="italic text-primary">with confidence.</em></>}
        intro="Employers get a clear view of every petition, and every employee gets a guided path through their part of the case."
        features={BUSINESS_FEATURES}
        servicesTitle={<>Business <em className="italic text-primary">Services</em></>}
        services={BUSINESS_SERVICES}
        position="40% 74%"
        size="300%"
        flip
        cta={(
          <Link to="/eligibility?src=Home%20Page%20%E2%80%94%20Businesses" className="inline-flex items-center justify-center gap-2 rounded-xl border border-border bg-white px-7 py-3.5 text-base font-bold text-foreground no-underline transition-all duration-200 hover:bg-secondary">
            Start a business evaluation <ArrowRight />
          </Link>
        )}
      />

      {/* ══ PROCESS ══ */}
      <section id="process" className="scroll-mt-20 border-t border-border">
        <div className="mx-auto max-w-7xl px-5 py-20 sm:px-6 lg:px-8 lg:py-28">
          <SectionHeading eyebrow="HOW IT WORKS" title="From your first quiz to your filed petition.">
            A closer look at everything that happens between saying hello and having your petition filed with USCIS.
          </SectionHeading>
          <ol className="mt-14 grid gap-x-12 gap-y-10 md:grid-cols-2">
            {FULL_PROCESS.map(({ num, title, desc }) => (
              <li key={num} className="flex gap-5 border-t border-border pt-6">
                <span className="font-display text-4xl font-normal leading-none text-primary/30">{num}</span>
                <div>
                  <h3 className="text-lg font-bold text-foreground">{title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{desc}</p>
                </div>
              </li>
            ))}
          </ol>
          <div className="mt-12">{primaryCta("Home Page — Full Process")}</div>
        </div>
      </section>

      {/* ══ WHY IMMIGLANCE ══ */}
      <section className="border-t border-border bg-secondary/40">
        <div className="mx-auto max-w-7xl px-5 py-20 sm:px-6 lg:px-8 lg:py-24">
          <SectionHeading eyebrow="WHY IMMIGLANCE" title="Clear, careful and organised." />
          <div className="mt-12 grid gap-6 md:grid-cols-3">
            {PILLARS.map((pillar, index) => (
              <div key={pillar.title} className="rounded-2xl border border-border bg-white p-7">
                <span className="flex h-11 w-11 items-center justify-center rounded-full bg-primary font-display text-lg font-normal text-primary-foreground">{index + 1}</span>
                <h3 className="mt-5 text-lg font-bold text-foreground">{pillar.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{pillar.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ══ ABOUT ══ */}
      <section id="about" className="scroll-mt-20 border-t border-border">
        <div className="mx-auto max-w-7xl px-5 py-20 sm:px-6 lg:px-8 lg:py-28">
          <Eyebrow>OUR STORY</Eyebrow>
          <h2 className="max-w-4xl font-display text-4xl font-normal leading-[1.12] tracking-normal text-foreground sm:text-6xl">
            Immiglance was built to rewrite how immigration is <em className="italic text-primary">experienced.</em>
          </h2>
          <div className="mt-8 max-w-2xl space-y-4 text-lg leading-relaxed text-muted-foreground">
            <p>
              <strong className="text-foreground">Immiglance</strong> provides expert support to individuals, families, and the corporate sector for both immigrant and non-immigrant visa petitions. We specialize in preparing and organizing all required documentation for every US visa category.
            </p>
            <p>
              After careful review, we submit the finalized petition directly to the <strong className="text-foreground">U.S. Citizenship &amp; Immigration Services (USCIS)</strong>. From the first consultation to the moment you hold your visa, our dedicated consultants and attorneys stand with you every step of the way.
            </p>
          </div>
          <div className="mt-8">{primaryCta("Home Page — Our Story")}</div>
          <div className="mt-16 grid grid-cols-2 gap-4 lg:grid-cols-4">
            {WHO_WE_HELP.map(({ icon: Icon, label, desc }) => (
              <div key={label} className="rounded-2xl border border-border bg-white p-6 transition-all duration-300 hover:border-primary/40 hover:shadow-lg hover:shadow-primary/10">
                <span className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10"><Icon size={22} className="text-primary" /></span>
                <p className="font-display text-2xl text-foreground">{label}</p>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ══ FAQ + CONTACT ══ */}
      <section id="faq" className="scroll-mt-20 border-t border-border">
        <div className="mx-auto grid max-w-7xl gap-12 px-5 py-20 sm:px-6 lg:grid-cols-2 lg:px-8 lg:py-28">
          <div>
            <SectionHeading eyebrow="FAQ" title="Frequently asked questions" className="mb-8" />
            <div className="space-y-3">
              {FAQS.map((faq) => <FAQItem key={faq.q} q={faq.q} a={faq.a} />)}
            </div>
          </div>
          <div className="flex flex-col justify-center rounded-3xl border border-border bg-secondary/50 p-7 sm:p-10">
            <h2 className="font-display text-2xl font-normal text-foreground sm:text-3xl">Still have questions?</h2>
            <p className="mb-6 mt-3 leading-relaxed text-muted-foreground">
              Our team is ready to help. Leave your email and we'll reach out for a free 15-minute consultation.
            </p>
            <form onSubmit={handleContactRequest} className="flex flex-col gap-3 sm:flex-row">
              <input
                type="email"
                placeholder="your@email.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="min-w-0 flex-1 rounded-lg border border-border bg-white px-4 py-3 text-foreground outline-none transition-all placeholder:text-muted-foreground hover:border-ring/50 focus:border-ring focus:ring-2 focus:ring-ring/15"
              />
              <button
                type="submit"
                disabled={contactLoading}
                className="cursor-pointer rounded-lg bg-primary px-6 py-3 font-bold text-primary-foreground transition-colors hover:opacity-90 disabled:opacity-50"
              >
                {contactLoading ? "Sending…" : "Contact Us"}
              </button>
            </form>
          </div>
        </div>
      </section>

      {/* ══ CLOSING CTA ══ */}
      <section className="px-5 pb-20 sm:px-6 lg:px-8 lg:pb-28">
        <div className="mx-auto max-w-7xl rounded-3xl bg-primary px-6 py-20 text-center text-primary-foreground sm:px-12 sm:py-28">
          <p className="mb-5 text-xs font-semibold uppercase tracking-[0.2em] text-primary-foreground/80">/LET'S BEGIN</p>
          <h2 className="mx-auto max-w-3xl font-display text-5xl font-normal leading-[1.1] tracking-normal sm:text-7xl">
            Let's Build a Case For <em className="italic text-primary-foreground/80">Your Future.</em>
          </h2>
          <p className="mx-auto mt-6 max-w-xl text-lg leading-relaxed text-primary-foreground/80">
            We help you figure it out. Then we work tirelessly to achieve your immigration goals.
          </p>
          <div className="mt-10 flex justify-center">
            {hasCase ? (
              <Link to="/dashboard" className="inline-flex items-center justify-center gap-2 rounded-xl bg-white px-8 py-4 text-base font-bold uppercase tracking-wide text-primary no-underline transition hover:opacity-90">Continue My Case</Link>
            ) : (
              <Link to="/eligibility/quiz?src=Home%20Page%20%E2%80%94%20Closing" className="inline-flex items-center justify-center gap-2 rounded-xl bg-white px-8 py-4 text-base font-bold uppercase tracking-wide text-primary no-underline transition hover:opacity-90">Request a Free Evaluation</Link>
            )}
          </div>
        </div>
      </section>

      <SiteFooter />

      {contactResult && <ContactResultModal status={contactResult.status} message={contactResult.message} onClose={() => setContactResult(null)} />}
    </div>
  );
}
