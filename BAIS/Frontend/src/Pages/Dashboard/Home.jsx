import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import bgVideo from "../../assets/videos/bgvideo.mp4";
import questionnaireInterfaceImage from "../../assets/images/client-portal/questionnaire-interface.jpg";
import scanDocumentsImage from "../../assets/images/client-portal/Scan-documents.webp";
import expertSystemImage from "../../assets/images/client-portal/expert-system.jpg";
import { useAuth } from "../../context/AuthContext";
import BenefitCard from "../../components/BenefitCard";
import ScrollReveal from "../../components/ScrollReveal";
import StartAssessmentButton from "../../components/StartAssessmentButton";
import StepShowcase from "../../components/StepShowcase";
import ConsultationSection from "../../components/ConsultationSection";
import useHasCase from "../../hooks/useHasCase";
import {
  IconCheckmark,
  IconShield,
  IconClock,
  IconUsers,
  IconDocument,
  IconGlobe,
  IconUpload,
  IconStar,
  IconTrendingUp,
  IconAward,
  IconListCheck,
  IconArrowRight,
  IconLandmark,
  IconScale,
  IconLock,
  IconCalendar,
  IconPhone,
} from "../../utils/iconComponents";

/* ─── Services data ──────────────────────────────────────────────────────────── */
const SERVICES = [
  {
    icon: (
      <svg width="32" height="32" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.6"
          d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
      </svg>
    ),
    color: "from-blue-500 to-cyan-500", badge: "bg-blue-100 text-blue-700",
    label: "Temporary Visa", tagline: "Non-Immigrant Entry",
    desc: "The non-immigrant visa covers a broad range of categories for entering the U.S. for work, study, tourism, or other temporary purposes without intent to permanently relocate.",
  },
  {
    icon: (
      <svg width="32" height="32" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.6"
          d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"/>
      </svg>
    ),
    color: "from-emerald-500 to-teal-500", badge: "bg-emerald-100 text-emerald-700",
    label: "Permanent Visa", tagline: "Green Card & LPR",
    desc: "For people looking to settle down in the United States by obtaining legal permanent residency. We guide you through every step of the EB or family-based petition process.",
  },
  {
    icon: (
      <svg width="32" height="32" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.6"
          d="M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/>
      </svg>
    ),
    color: "from-violet-500 to-purple-600", badge: "bg-violet-100 text-violet-700",
    label: "Business Visa", tagline: "B-1 / B-2 Visa",
    desc: "For people who want to visit the U.S. for a short duration for business-related reasons such as conferences, negotiations, client meetings, or training sessions.",
  },
  {
    icon: (
      <svg width="32" height="32" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.6"
          d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z"/>
      </svg>
    ),
    color: "from-orange-500 to-amber-500", badge: "bg-orange-100 text-orange-700",
    label: "Work Visa", tagline: "H-1B / L-1 / O-1",
    desc: "For people who want to get started on working in the U.S. in a variety of fields and professions. We handle H-1B, L-1, O-1, TN, and other employment-based petitions.",
  },
  {
    icon: (
      <svg width="32" height="32" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.6"
          d="M12 14l9-5-9-5-9 5 9 5zm0 0l6.16-3.422a12.083 12.083 0 01.665 6.479A11.952 11.952 0 0112 20.055a11.952 11.952 0 00-6.824-2.998 12.078 12.078 0 01.665-6.479L12 14z"/>
      </svg>
    ),
    color: "from-pink-500 to-rose-500", badge: "bg-pink-100 text-pink-700",
    label: "Student Visa", tagline: "F-1 / M-1 / J-1",
    desc: "Specialised support for students pursuing education in the U.S. — F-1, M-1, J-1 visas, I-20 guidance, SEVIS registration, and OPT/CPT authorisation.",
  },
  {
    icon: (
      <svg width="32" height="32" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.6"
          d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z"/>
      </svg>
    ),
    color: "from-teal-500 to-cyan-600", badge: "bg-teal-100 text-teal-700",
    label: "Family Visa", tagline: "IR / F Category",
    desc: "Reunite families across borders. Spousal visas, parent petitions, sibling sponsorships, and derivative beneficiary adjustments handled with care and precision.",
  },
];

/* ─── Why Choose Us data ─────────────────────────────────────────────────────── */
const WHY_US = [
  { icon: IconAward, title: "15+ Years Experience",   desc: "Over a decade of successful immigration case management across all visa categories." },
  { icon: IconCheckmark, title: "98% Success Rate",        desc: "Our meticulous documentation process results in one of the highest approval rates in the industry." },
  { icon: IconUsers, title: "Personalised Support",   desc: "Every client gets a dedicated consultant who guides them from consultation to visa approval." },
  { icon: IconClock, title: "Fast Processing",         desc: "We prioritise urgent cases and work with premium processing options to meet your timeline." },
  { icon: IconGlobe, title: "Global Network",          desc: "Strong relationships with US embassies and USCIS offices across India and the US." },
  { icon: IconShield, title: "Secure & Confidential",  desc: "Your documents and personal data are handled with bank-grade security and complete confidentiality." },
];

/* ─── Live stats data ────────────────────────────────────────────────────────── */
const STATS = [
  { value: 1200, suffix: "+", label: "Applications Processed" },
  { value: 98,   suffix: "%", label: "Success Rate" },
  { value: 30,   suffix: "+", label: "Countries Served" },
  { value: 15,   suffix: "+", label: "Years Experience" },
];

/* ─── Success stories data ───────────────────────────────────────────────────── */
const STORIES = [
  { initials: "RM", name: "Rahul Mehta",    country: "India",    visa: "Student Visa (F-1)",      color: "from-indigo-500 to-blue-600",
    review: "BAIS made my F-1 application seamless. Guided through every document and received visa in just 3 weeks!" },
  { initials: "PS", name: "Priya Sharma",   country: "India",    visa: "Work Visa (H-1B)",        color: "from-violet-500 to-purple-600",
    review: "The H-1B process felt overwhelming until I found BAIS. My consultant knew exactly what was needed." },
  { initials: "CR", name: "Carlos Rivera",  country: "Mexico",   visa: "Business Visa (B-1/B-2)", color: "from-orange-500 to-amber-500",
    review: "I needed a B-1 visa urgently. BAIS processed everything within days. Exceptional service!" },
  { initials: "AI", name: "Ananya Iyer",    country: "India",    visa: "Permanent Visa",          color: "from-emerald-500 to-teal-600",
    review: "After 2 rejections, BAIS helped me get my Green Card. Their attention to detail is unmatched." },
];

/* ─── FAQ data ───────────────────────────────────────────────────────────────── */
const FAQS = [
  { q: "How long does a US visa application take?",
    a: "Processing times vary by visa type. Student visas (F-1) typically take 3–8 weeks, while work visas (H-1B) can take 3–6 months. With premium processing, some cases resolve in 15 business days. We assess your timeline and recommend the fastest available route." },
  { q: "What documents are needed for a US visa?",
    a: "Core documents include a valid passport, completed DS-160 form, visa fee receipt, and type-specific supporting documents — such as an I-20 for students, an employment offer letter for work visas, or financial proof for visitor visas. We provide every client a personalised document checklist." },
  { q: "What if my visa application is rejected?",
    a: "A rejection is not the end. Our team analyses the refusal reason, strengthens your application, and prepares a reapplication strategy. We have successfully guided many clients through reapplication after initial refusals — often with full approval." },
  { q: "Can I change my visa type while inside the US?",
    a: "Yes — this is called Change of Status (COS). You can apply to switch from one non-immigrant category to another without leaving the US. BAIS specialises in COS cases, particularly for H-1B, OPT-to-H1B, L-1, and similar transitions." },
  { q: "Do I need to visit your office in person?",
    a: "Not necessarily. We handle most clients fully remotely via video consultation, email, and our secure online portal. In-person visits to our Fremont, CA office are available but not required." },
];

/* ─── Animated stat counter ──────────────────────────────────────────────────── */
function StatCounter({ value, suffix }) {
  const [count, setCount] = useState(0);
  const ref = useRef(null);
  const started = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting && !started.current) {
        started.current = true;
        const duration = 2000;
        const start = performance.now();
        const tick = (now) => {
          const progress = Math.min((now - start) / duration, 1);
          const eased = 1 - Math.pow(1 - progress, 3);
          setCount(Math.floor(eased * value));
          if (progress < 1) requestAnimationFrame(tick);
          else setCount(value);
        };
        requestAnimationFrame(tick);
      }
    }, { threshold: 0.4 });
    observer.observe(el);
    return () => observer.disconnect();
  }, [value]);

  return <span ref={ref}>{count.toLocaleString()}{suffix}</span>;
}

/* ─── FAQ Accordion ─────────────────────────────────────────────────────────── */
function FAQAccordion() {
  const [open, setOpen] = useState(null);
  return (
    <div className="space-y-3">
      {FAQS.map(({ q, a }, i) => (
        <div key={i} className={`rounded-2xl border transition-all duration-200 overflow-hidden
          ${open === i ? "border-emerald-200 shadow-sm" : "border-slate-200"}`}>
          <button onClick={() => setOpen(open === i ? null : i)}
            className="w-full flex items-center justify-between px-6 py-5 text-left
              hover:bg-slate-50 transition-colors cursor-pointer gap-4">
            <span className={`font-bold text-sm sm:text-base leading-snug
              ${open === i ? "text-[#1D9E75]" : "text-slate-800"}`}>{q}</span>
            <span className={`shrink-0 w-6 h-6 rounded-full flex items-center justify-center transition-all duration-200
              ${open === i ? "bg-emerald-100 text-emerald-600 rotate-180" : "bg-slate-100 text-slate-500"}`}>
              <svg width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 9l-7 7-7-7"/>
              </svg>
            </span>
          </button>
          {open === i && (
            <div className="px-6 pb-5 text-sm text-slate-600 leading-relaxed border-t border-slate-100 pt-4 bg-emerald-50/30">
              {a}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/* ─── Shared footer ──────────────────────────────────────────────────────────── */
function SiteFooter() {
  return (
    <footer className="bg-slate-950 text-slate-400">
      <div className="max-w-6xl mx-auto px-6 sm:px-10 py-12">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-10 mb-10">
          <div className="lg:col-span-1">
            <div className="flex items-center gap-2.5 mb-4">
              <div className="w-9 h-9 rounded-xl bg-linear-to-br from-[#1D9E75] to-teal-600
                flex items-center justify-center shadow-sm">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="white">
                  <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
                </svg>
              </div>
              <div>
                <p className="text-base font-extrabold text-white leading-none">BAIS</p>
                <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">Immigration Portal</p>
              </div>
            </div>
            <p className="text-xs text-slate-500 leading-relaxed">
              Bay Area Immigration Services (BAIS) — trusted Bay Area immigration experts since 2008.
            </p>
          </div>

          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-slate-300 mb-4">Quick Links</p>
            <ul className="space-y-2.5">
              {[
                { label: "Home",       to: "/"                    },
                { label: "About Us",   to: "/about"               },
                { label: "Dashboard",  to: "/dashboard"           },
                { label: "My Profile", to: "/dashboard/profile"   },
                { label: "Documents",  to: "/dashboard/documents" },
              ].map(({ label, to }) => (
                <li key={label}>
                  <Link to={to} className="text-sm text-slate-400 hover:text-emerald-400 transition-colors no-underline">
                    {label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-slate-300 mb-4">Services</p>
            <ul className="space-y-2.5">
              {["Temporary Visa","Permanent Visa","Business Visa","Work Visa","Student Visa (F-1)","Family Visa","Change of Status"].map((s) => (
                <li key={s}><span className="text-sm text-slate-400">{s}</span></li>
              ))}
            </ul>
          </div>

          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-slate-300 mb-4">Contact Us</p>
            <div className="space-y-4 text-xs text-slate-400 leading-relaxed">
              <div>
                <p className="font-semibold text-slate-300 mb-1">Office</p>
                <p>39159 Paseo Padre Pkwy STE 115,<br/>Fremont, CA 94538, United States</p>
              </div>
              <div className="space-y-1.5">
                {[
                  { href: "tel:+15107708700",                        text: "(510) 770-8700" },
                  { href: "mailto:info@bayareaimmigrationservices.com", text: "info@bayareaimmigrationservices.com" },
                ].map(({ href, text }) => (
                  <a key={text} href={href}
                    className="flex items-center gap-2 hover:text-emerald-400 transition-colors no-underline">
                    <svg width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      {href.startsWith("mailto")
                        ? <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/>
                        : <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498A1 1 0 0121 17.72V19a2 2 0 01-2 2H17C9.716 21 3 14.284 3 7V5z"/>}
                    </svg>
                    {text}
                  </a>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="border-t border-slate-800 pt-6 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-500">
          <p>© {new Date().getFullYear()} Bay Area Immigration Services (BAIS). All rights reserved.</p>
          <div className="flex gap-5">
            <span className="hover:text-slate-300 transition-colors cursor-pointer">Privacy Policy</span>
            <span className="hover:text-slate-300 transition-colors cursor-pointer">Terms of Service</span>
            <span className="hover:text-slate-300 transition-colors cursor-pointer">Disclaimer</span>
          </div>
        </div>
      </div>
    </footer>
  );
}

/* ─── Main Page ──────────────────────────────────────────────────────────────── */
export default function Home() {
  const [paused, setPaused] = useState(false);
  const { user } = useAuth();
  const navigate = useNavigate();
  const { hasCase } = useHasCase();

  useEffect(() => {
    document.title = "BAIS | Bay Area Immigration Services — Study, Work & Live Abroad";
  }, []);

  return (
    <div className="min-h-screen bg-[#f8fafc]">

      {/* ══ HERO VIDEO ══ */}
      <section className="relative w-full h-[calc(100vh-5rem)] min-h-130 overflow-hidden">
        <video autoPlay loop muted playsInline preload="metadata" aria-hidden="true"
          className="absolute inset-0 w-full h-full object-cover z-0">
          <source src={bgVideo} type="video/mp4" />
        </video>
        <div className="absolute inset-0 bg-black/55 z-10" aria-hidden="true" />
        <div className="absolute inset-0 z-20 flex flex-col justify-center items-start px-6 sm:px-10 md:px-16 lg:px-24">
          <div className="max-w-2xl w-full">
            <span className="inline-block mb-4 px-4 py-1.5 rounded-full bg-white/10 border border-white/25
              backdrop-blur-sm text-xs sm:text-sm font-semibold text-white/90 tracking-widest uppercase">
              Trusted Immigration Experts
            </span>
            <h1 className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-extrabold text-white leading-[1.1] tracking-tight mb-5">
              Study, Work<br className="hidden sm:block" /> &amp; Live Abroad.
            </h1>
            <p className="text-base sm:text-lg md:text-xl text-white/80 leading-relaxed max-w-xl mb-8">
              We provide complete guidance for US visa applications, documentation,
              and approval processes. Start your journey with trusted immigration experts.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 sm:gap-4">
              {hasCase ? (
                <Link to="/dashboard"
                  className="inline-flex items-center justify-center gap-2 px-7 py-3.5 text-base
                    font-bold rounded-xl transition-all duration-200 active:scale-95 no-underline cursor-pointer
                    bg-[#1D9E75] hover:bg-[#0F6E56] text-white shadow-lg shadow-black/30">
                  Continue My Case
                  <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M9 5l7 7-7 7" />
                  </svg>
                </Link>
              ) : (
                <StartAssessmentButton className="shadow-lg shadow-black/30" pageSource="Home Page">
                  Start Free Assessment
                </StartAssessmentButton>
              )}
              <button
                onClick={() => user
                  ? document.getElementById("services")?.scrollIntoView({ behavior: "smooth" })
                  : navigate("/signup")
                }
                className="inline-flex items-center justify-center gap-2 px-7 py-3.5
                  bg-white/10 hover:bg-white/20 text-white text-base font-bold rounded-xl
                  border border-white/35 hover:border-white/55 backdrop-blur-sm transition-all duration-200 active:scale-95 cursor-pointer">
                Get Started Free
                <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M9 5l7 7-7 7"/>
                </svg>
              </button>
              {!user && (
                <Link to="/login"
                  className="inline-flex items-center justify-center px-7 py-3.5
                    bg-white/10 hover:bg-white/20 text-white text-base font-semibold
                    border border-white/35 hover:border-white/55 rounded-xl
                    backdrop-blur-sm transition-all duration-200 no-underline">
                  Sign In to Portal
                </Link>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-5 mt-10 text-white/60 text-xs sm:text-sm">
              {[
                { path: "M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z", label: "SSL Secured" },
                { path: "M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z", label: "10,000+ Visas Approved" },
                { path: "M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z", label: "Expert Consultants" },
              ].map(({ path, label }) => (
                <span key={label} className="flex items-center gap-1.5">
                  <svg width="14" height="14" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path d={path}/></svg>
                  {label}
                </span>
              ))}
            </div>
          </div>
        </div>
        <div className="absolute bottom-0 left-0 right-0 h-28 bg-linear-to-t from-black/40 to-transparent z-20 pointer-events-none" aria-hidden="true"/>
      </section>

      {/* ══ LIVE STATS COUNTER ══ */}
      <section className="bg-linear-to-r from-[#1D9E75] via-teal-600 to-emerald-700 py-14 sm:py-16">
        <div className="max-w-6xl mx-auto px-6 sm:px-10">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-6 sm:gap-8 text-center">
            {STATS.map(({ value, suffix, label }) => (
              <div key={label} className="flex flex-col items-center">
                <p className="text-4xl sm:text-5xl font-extrabold text-white tracking-tight leading-none">
                  <StatCounter value={value} suffix={suffix} />
                </p>
                <p className="text-white/80 text-sm sm:text-base font-semibold mt-2">{label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ══ THE JOURNEY SECTION - SaaS Style Steps ══ */}
      <section className="bg-white">
        {/* Step 1: Eligibility Questionnaire */}
        <StepShowcase
          stepNumber={1}
          title="Answer Your Eligibility Questionnaire"
          description="Start by telling us about your background, education, work experience, and immigration goals. Our AI-guided quiz takes just 10-15 minutes and recommends the best visa categories for your situation."
          features={[
            "AI-guided questionnaire tailored to your profile",
            "Immediate visa recommendations",
            "No documents required to start",
            "100% confidential assessment",
          ]}
          ctaText={hasCase ? "Go to My Dashboard" : "Start Questionnaire"}
          ctaLink={hasCase ? "/dashboard" : "/eligibility?src=Home%20Page"}
          imageSrc={questionnaireInterfaceImage}
          imageAlt="Questionnaire Interface"
          imagePosition="right"
        />

        {/* Step 2: Upload Documents */}
        <StepShowcase
          stepNumber={2}
          title="Upload Your Documents Securely"
          description="Securely upload all required documents — passport, degrees, employment letters, financial proof, and more. Our system tells you exactly what's needed for your visa type, with drag-and-drop ease."
          features={[
            "Bank-grade encryption for all uploads",
            "Real-time document verification",
            "Guided document checklist",
            "Mobile-friendly upload interface",
          ]}
          ctaText="Upload Documents"
          ctaLink="/dashboard/documents"
          imageSrc={scanDocumentsImage}
          imageAlt="Secure Document Upload"
          imagePosition="left"
        />

        {/* Step 3: Expert Review & Filing */}
        <StepShowcase
          stepNumber={3}
          title="Get Expert Review & USCIS Filing"
          description="Our immigration attorneys review every detail, prepare your complete application package, and file it with USCIS. You track everything in real-time — no surprises, total transparency."
          features={[
            "Personal case manager assigned",
            "Attorney-led legal review",
            "Complete USCIS filing handled",
            "Real-time status notifications",
          ]}
          ctaText="Book Consultation"
          ctaLink="#appointment"
          imageSrc={expertSystemImage}
          imageAlt="Expert Review Process"
          imagePosition="right"
        />
      </section>

      {/* ══ WHY OUR PROCESS SECTION ══ */}
      <section className="py-16 sm:py-24 bg-linear-to-b from-slate-50 to-white">
        <div className="max-w-6xl mx-auto px-6 sm:px-10">
          <div className="text-center mb-16">
            <ScrollReveal>
              <span className="inline-block mb-3 text-xs font-bold uppercase tracking-widest text-[#1D9E75]">Why BAIS Works</span>
              <h2 className="text-3xl sm:text-4xl font-extrabold text-slate-900 mb-4">
                Built for Success
              </h2>
              <p className="text-slate-600 text-lg max-w-2xl mx-auto">
                Every feature designed to make your visa journey faster, simpler, and more successful
              </p>
            </ScrollReveal>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[
              {
                icon: IconCheckmark,
                title: "100% Guided Process",
                desc: "Step-by-step guidance at every stage. You always know what's happening and why.",
              },
              {
                icon: IconShield,
                title: "Secure Document Upload",
                desc: "Enterprise-grade encryption protects all your documents and personal information.",
              },
              {
                icon: IconUsers,
                title: "Expert Review",
                desc: "Experienced attorneys review every case. Personalized guidance from day one.",
              },
              {
                icon: IconClock,
                title: "Real-Time Updates",
                desc: "Track your case status, receive notifications, and communicate instantly.",
              },
              {
                icon: IconTrendingUp,
                title: "98% Success Rate",
                desc: "Rigorous documentation means higher approval rates. Proven track record.",
              },
              {
                icon: IconGlobe,
                title: "Global Support",
                desc: "Offices in India and USA. Support in multiple languages and time zones.",
              },
            ].map((item, idx) => (
              <ScrollReveal key={idx} delay={idx * 50}>
                <BenefitCard icon={item.icon} title={item.title} description={item.desc} />
              </ScrollReveal>
            ))}
          </div>
        </div>
      </section>

      {/* ══ GUIDED PROCESS SECTION ══ */}
      <section className="py-1 px-6 sm:px-10 max-w-6xl mx-auto">
        {/* Removed - replaced with SaaS-style steps above */}
      </section>

      {/* ══ WHY CHOOSE US ══ */}
      <section className="min-h-145 flex flex-col justify-center py-16 sm:py-20 bg-slate-50">
        <div className="max-w-6xl mx-auto px-6 sm:px-10 w-full">
          <div className="text-center mb-12">
            <ScrollReveal>
              <span className="inline-block mb-3 text-xs font-bold uppercase tracking-widest text-[#1D9E75]">Why BAIS</span>
              <h2 className="text-3xl sm:text-4xl font-extrabold text-slate-900">Why Choose Us?</h2>
              <p className="text-slate-500 mt-3 max-w-xl mx-auto text-sm sm:text-base">
                Thousands of clients trust BAIS for their most important immigration decisions.
              </p>
            </ScrollReveal>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {WHY_US.map(({ icon: Icon, title, desc }, idx) => (
              <ScrollReveal key={title} delay={idx * 50}>
                <BenefitCard icon={Icon} title={title} description={desc} />
              </ScrollReveal>
            ))}
          </div>
        </div>
      </section>

      {/* ══ OUR SERVICES (auto-scroll) ══ */}
      <section id="services" className="min-h-145 flex flex-col justify-center py-16 sm:py-20 bg-slate-900 overflow-hidden">
        <div className="max-w-6xl mx-auto px-6 sm:px-10 mb-10 w-full">
          <span className="inline-block mb-3 text-xs font-bold uppercase tracking-widest text-emerald-400">
            What We Offer
          </span>
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
            <h2 className="text-3xl sm:text-4xl font-extrabold text-white">Our Services</h2>
            <p className="text-slate-400 text-sm max-w-sm">Hover a card to pause. We cover every major US visa category.</p>
          </div>
        </div>

        <div className="relative"
          onMouseEnter={() => setPaused(true)}
          onMouseLeave={() => setPaused(false)}>
          <div className="absolute left-0 top-0 bottom-0 w-16 sm:w-24 bg-linear-to-r from-slate-900 to-transparent z-10 pointer-events-none" aria-hidden="true"/>
          <div className="absolute right-0 top-0 bottom-0 w-16 sm:w-24 bg-linear-to-l from-slate-900 to-transparent z-10 pointer-events-none" aria-hidden="true"/>
          <div
            className="flex gap-5 px-6"
            style={{
              width: "max-content",
              animation: "scrollTrack 28s linear infinite",
              animationPlayState: paused ? "paused" : "running",
            }}
          >
            {[...SERVICES, ...SERVICES].map((s, i) => (
              <div key={i}
                className="w-72 sm:w-80 shrink-0 bg-slate-800 border border-slate-700 rounded-2xl p-6
                  hover:border-slate-500 transition-all duration-300 cursor-default">
                <div className={`w-14 h-14 rounded-2xl bg-linear-to-br ${s.color}
                  flex items-center justify-center text-white mb-5 shadow-lg`}>
                  {s.icon}
                </div>
                <span className={`inline-block text-[0.68rem] font-bold px-2.5 py-1 rounded-full ${s.badge} mb-3`}>
                  {s.tagline}
                </span>
                <h3 className="text-lg font-extrabold text-white mb-2">{s.label}</h3>
                <p className="text-slate-400 text-sm leading-relaxed">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="text-center mt-10 flex flex-col sm:flex-row items-center justify-center gap-3">
          <StartAssessmentButton size="lg" pageSource="Home Page">Not sure which visa fits? Take the free assessment</StartAssessmentButton>
          <Link to="/about"
            className="inline-flex items-center gap-2 px-7 py-3 bg-emerald-600 hover:bg-emerald-700
              text-white text-sm font-bold rounded-xl transition-all duration-200 no-underline active:scale-95">
            Learn More About Our Services
            <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M9 5l7 7-7 7"/>
            </svg>
          </Link>
        </div>

        <style>{`@keyframes scrollTrack { 0% { transform: translateX(0); } 100% { transform: translateX(-50%); } }`}</style>
      </section>

      {/* ══ SUCCESS STORIES ══ */}
      <section className="py-16 sm:py-20 bg-[#f8fafc]">
        <div className="max-w-6xl mx-auto px-6 sm:px-10">
          <div className="text-center mb-12">
            <span className="inline-block mb-3 text-xs font-bold uppercase tracking-widest text-[#1D9E75]">Real Clients · Real Results</span>
            <h2 className="text-3xl sm:text-4xl font-extrabold text-slate-900">Success Stories</h2>
            <p className="text-slate-500 mt-3 max-w-xl mx-auto text-sm sm:text-base">
              Thousands of clients have achieved their American dream with BAIS. Here are just a few of their stories.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {STORIES.map(({ initials, name, country, visa, color, review }) => (
              <div key={name} className="bg-white rounded-2xl p-6 border border-slate-100 shadow-sm
                hover:shadow-lg hover:-translate-y-1 transition-all duration-300 flex flex-col">
                {/* Stars */}
                <div className="flex gap-1 mb-4">
                  {[...Array(5)].map((_, i) => (
                    <svg key={i} width="16" height="16" viewBox="0 0 24 24" fill="#F59E0B">
                      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
                    </svg>
                  ))}
                </div>
                {/* Review */}
                <p className="text-slate-600 text-sm leading-relaxed flex-1 mb-5 italic">"{review}"</p>
                {/* Client */}
                <div className="flex items-center gap-3 pt-4 border-t border-slate-100">
                  <div className={`w-11 h-11 rounded-full bg-linear-to-br ${color}
                    flex items-center justify-center text-white text-sm font-extrabold shrink-0`}>
                    {initials}
                  </div>
                  <div className="min-w-0">
                    <p className="font-bold text-slate-800 text-sm leading-tight">{name}</p>
                    <p className="text-xs text-slate-400">{country}</p>
                  </div>
                  <span className="ml-auto text-[0.65rem] font-bold px-2.5 py-1 rounded-full
                    bg-emerald-50 text-emerald-700 border border-emerald-200 shrink-0 text-right leading-tight">
                    {visa}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ══ FAQ ══ */}
      <section className="py-16 sm:py-20 bg-white">
        <div className="max-w-3xl mx-auto px-6 sm:px-10">
          <div className="text-center mb-12">
            <span className="inline-block mb-3 text-xs font-bold uppercase tracking-widest text-[#1D9E75]">Got Questions?</span>
            <h2 className="text-3xl sm:text-4xl font-extrabold text-slate-900">Frequently Asked Questions</h2>
            <p className="text-slate-500 mt-3 text-sm sm:text-base">Everything you need to know before starting your visa journey.</p>
          </div>
          <FAQAccordion />
        </div>
      </section>

      {/* ══ CERTIFICATIONS & TRUST ══ */}
      <section className="py-14 sm:py-16 bg-slate-50 border-y border-slate-100">
        <div className="max-w-6xl mx-auto px-6 sm:px-10">
          <div className="text-center mb-10">
            <span className="inline-block mb-3 text-xs font-bold uppercase tracking-widest text-[#1D9E75]">Licensed & Compliant</span>
            <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-900">Certifications & Legal Compliance</h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-5 mb-10">
            {[
              { icon: IconLandmark, title: "Registered Immigration Consultants", desc: "Our consultants are fully registered and compliant with US immigration regulations and USCIS guidelines." },
              { icon: IconScale, title: "Legal & Regulatory Compliance", desc: "We operate in full compliance with US immigration law, GDPR data standards, and international client protection norms." },
              { icon: IconLock, title: "Data Protected & Secure", desc: "Your documents and personal information are encrypted and stored securely — we never share your data with third parties." },
            ].map(({ icon: Icon, title, desc }) => (
              <div key={title} className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm flex flex-col items-start gap-4">
                <div className="w-12 h-12 rounded-xl bg-emerald-50 border border-emerald-200
                  flex items-center justify-center shrink-0">
                  <Icon size={22} className="text-[#1D9E75]" />
                </div>
                <div>
                  <h3 className="font-extrabold text-slate-800 text-sm mb-1">{title}</h3>
                  <p className="text-xs text-slate-500 leading-relaxed">{desc}</p>
                </div>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap items-center justify-center gap-4">
            {["SSL Encrypted Portal", "USCIS Compliant Process", "Confidential Consultations", "No Hidden Fees", "ISO-Standard Documentation"].map((badge) => (
              <span key={badge} className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200
                rounded-full text-xs font-bold text-slate-600 shadow-sm">
                <svg width="12" height="12" fill="#1D9E75" viewBox="0 0 24 24">
                  <path d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"/>
                </svg>
                {badge}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* ══ CTA ══ */}
      <section className="py-20 sm:py-24 bg-linear-to-br from-[#0f4d39] via-teal-700 to-blue-900 relative overflow-hidden">
        <div className="absolute inset-0 opacity-5 pointer-events-none"
          style={{ backgroundImage: "radial-gradient(circle, white 1px, transparent 1px)", backgroundSize: "40px 40px" }} aria-hidden="true"/>
        <div className="relative max-w-3xl mx-auto px-6 sm:px-10 text-center">
          <span className="inline-block mb-5 px-5 py-1.5 rounded-full bg-emerald-500/20 border border-emerald-500/30
            text-xs font-bold tracking-widest uppercase text-emerald-400">
            Start Your Journey Today
          </span>
          <h2 className="text-4xl sm:text-5xl font-extrabold text-white leading-tight tracking-tight mb-6">
            Ready to Move<br className="hidden sm:block"/> to the USA?
          </h2>
          <p className="text-white/70 text-base sm:text-lg leading-relaxed max-w-xl mx-auto mb-10">
            Join thousands of clients who trusted BAIS to navigate their Bay Area immigration journey.
            Let our experts guide you — from first consultation to visa approval.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <button
              onClick={() => document.getElementById("appointment")?.scrollIntoView({ behavior: "smooth" })}
              className="inline-flex items-center gap-2.5 px-8 py-4 bg-[#1D9E75] hover:bg-[#0F6E56]
                text-white text-base font-extrabold rounded-xl shadow-lg shadow-emerald-900/40
                transition-all duration-200 cursor-pointer active:scale-95">
              <IconCalendar size={18} className="text-white" /> Book Free Consultation
            </button>
            <a href="tel:+15107708700"
              className="inline-flex items-center gap-2.5 px-8 py-4
                bg-white/10 hover:bg-white/20 text-white text-base font-bold
                border border-white/25 hover:border-white/40 rounded-xl
                backdrop-blur-sm transition-all duration-200 no-underline">
              <IconPhone size={18} className="text-white" /> Call Us Now
            </a>
          </div>
          <p className="text-white/40 text-xs mt-8">No obligation · Free first consultation · Response within 24 hours</p>
        </div>
      </section>

      {/* ══ MAKE AN APPOINTMENT ══ */}
      <ConsultationSection source="Home Page" />

      {/* ══ FOOTER ══ */}
      <SiteFooter />
    </div>
  );
}
