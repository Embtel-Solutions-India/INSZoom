import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import ConsultationSection from "../../components/ConsultationSection";
import {
  IconPhone,
  IconMail,
  IconSchool,
  IconUsers,
  IconBriefcase,
  IconIdCard,
  IconAward,
  IconZap,
  IconUser,
  IconDollarSign,
  IconGlobe,
  IconClock,
  IconMessageCircle,
  IconFileText,
  IconRocket,
  IconHandshake,
  IconArrowRight,
} from "../../utils/iconComponents";

/* ─── Google Reviews data ────────────────────────────────────────────────────── */
const REVIEWS = [
  {
    name: "Arvind Ganesh",
    ago: "1 month ago",
    text: "BAIS helps me with my immigration needs for my businesses. They have a knowledgeable and friendly team led by experienced industry leaders. I have been working with them for the last 10 years — not faced a single rejection from USCIS. Success rate has been 100%. I would recommend BAIS to any small to large business.",
    initials: "AG",
    color: "bg-blue-500",
  },
  {
    name: "Krishnaveni Raja",
    ago: "1 month ago",
    text: "Excellent and Responsive Service! The team was incredibly prompt in replying to all my inquiries, which made the entire process feel smooth and stress-free. Highly recommend for anyone looking for efficient immigration paperwork!",
    initials: "KR",
    color: "bg-rose-500",
  },
  {
    name: "Narendran D.",
    ago: "3 months ago",
    text: "I had a great experience with BAIS while processing my visa. They guided me through every step and made it smooth and stress-free. They assigned a dedicated case manager who was absolutely outstanding — very supportive, knowledgeable, and quick to respond. I definitely recommend BAIS to anyone looking for reliable visa assistance.",
    initials: "ND",
    color: "bg-emerald-600",
  },
  {
    name: "Kim Cheung",
    ago: "4 months ago",
    text: "Very responsive and excellent service! The team handled my verification and documentation swiftly and professionally. Highly recommend Bay Area Immigration Services (BAIS) for anyone who needs reliable and fast immigration support!",
    initials: "KC",
    color: "bg-violet-600",
  },
  {
    name: "Kamrul Islam Rabbi",
    ago: "5 months ago",
    text: "Submitting my EB1A under BAIS was a big, right decision in my life. They supported and helped me at every moment and finally my EB1A approval came through. I am very grateful to them and wish them continued success.",
    initials: "KI",
    color: "bg-orange-500",
  },
  {
    name: "Prabha Karan",
    ago: "5 months ago",
    text: "My O-1B approval process was managed with excellent professionalism. The team was always responsive and ensured every document was perfectly prepared. Their expertise gave me complete confidence throughout the process. I truly appreciate their excellent service.",
    initials: "PK",
    color: "bg-teal-600",
  },
  {
    name: "Mahin Sidiki",
    ago: "5 months ago",
    text: "A heartfelt thank you to the BAIS team for continuous support and guidance throughout our immigration process. Your expertise and dedication made this journey smooth and stress-free. Thank you very much once again for all the support throughout our journey.",
    initials: "MS",
    color: "bg-pink-600",
  },
  {
    name: "Raja Raja",
    ago: "5 months ago",
    text: "Service is very good. Free consultation, quick response, and completely confidential. The team was professional and helped me understand every step of the process clearly. Very satisfied with the outcome.",
    initials: "RR",
    color: "bg-cyan-600",
  },
];

/* ─── Star rating ────────────────────────────────────────────────────────────── */
function Stars() {
  return (
    <div className="flex gap-0.5" aria-label="5 stars">
      {Array(5).fill(0).map((_, i) => (
        <svg key={i} width="14" height="14" viewBox="0 0 24 24" fill="#FBBC04">
          <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
        </svg>
      ))}
    </div>
  );
}

/* ─── Google G logo ──────────────────────────────────────────────────────────── */
function GoogleLogo() {
  return (
    <svg width="20" height="20" viewBox="0 0 48 48">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.08 17.74 9.5 24 9.5z"/>
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.31-8.16 2.31-6.26 0-11.57-3.59-13.46-8.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
    </svg>
  );
}

/* ─── Footer (shared) ────────────────────────────────────────────────────────── */
function SiteFooter() {
  return (
    <footer className="bg-slate-950 text-slate-400">
      <div className="max-w-6xl mx-auto px-6 sm:px-10 py-12">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-10 mb-10">
          <div>
            <div className="flex items-center gap-2.5 mb-4">
              <div className="w-9 h-9 rounded-xl bg-linear-to-br from-[#1D9E75] to-teal-600 flex items-center justify-center">
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
                { label: "Home",       to: "/" },
                { label: "About Us",   to: "/about" },
                { label: "Dashboard",  to: "/dashboard" },
                { label: "My Profile", to: "/dashboard/profile" },
                { label: "Documents",  to: "/dashboard/documents" },
              ].map(({ label, to }) => (
                <li key={label}>
                  <Link to={to} className="text-sm text-slate-400 hover:text-emerald-400 transition-colors no-underline">{label}</Link>
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
            <div className="space-y-3 text-xs text-slate-400 leading-relaxed">
              <div>
                <p className="font-semibold text-slate-300 mb-0.5">Office</p>
                <p>39159 Paseo Padre Pkwy STE 115, Fremont, CA 94538, United States</p>
              </div>
              <div className="space-y-1">
                <a href="tel:+15107708700" className="flex items-center gap-2 hover:text-emerald-400 transition-colors no-underline"><IconPhone size={14} className="text-slate-400" /> (510) 770-8700</a>
                <a href="mailto:info@bayareaimmigrationservices.com" className="flex items-center gap-2 hover:text-emerald-400 transition-colors no-underline"><IconMail size={14} className="text-slate-400" /> info@bayareaimmigrationservices.com</a>
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

/* ─── Main Component ─────────────────────────────────────────────────────────── */
export default function About() {
  const [expanded, setExpanded] = useState(null);

  useEffect(() => {
    document.title = "About Us | BAIS Immigration Services";
  }, []);

  return (
    <div className="min-h-screen bg-[#f8fafc]">

      {/* ══ HERO ══ */}
      <section className="relative bg-linear-to-br from-[#1D9E75] via-teal-600 to-blue-700 text-white overflow-hidden">
        <div className="absolute -top-24 -right-24 w-96 h-96 rounded-full bg-white/5 pointer-events-none" aria-hidden="true"/>
        <div className="absolute -bottom-32 -left-16 w-72 h-72 rounded-full bg-white/5 pointer-events-none" aria-hidden="true"/>
        <div className="relative max-w-6xl mx-auto px-6 sm:px-10 py-20 sm:py-28 text-center">
          <span className="inline-block mb-5 px-5 py-1.5 rounded-full bg-white/15 border border-white/25
            text-xs font-bold tracking-widest uppercase">
            Est. 2008 · Fremont, USA
          </span>
          <h1 className="text-4xl sm:text-5xl md:text-6xl font-extrabold leading-tight tracking-tight mb-6">
            Bay Area<br className="hidden sm:block"/>
            <span className="text-white/80">Immigration Services</span>
          </h1>
          <p className="text-base sm:text-lg text-white/80 leading-relaxed max-w-2xl mx-auto mb-10">
            Expert immigration support for students, families, and the corporate sector —
            specialising in all US visa categories and Change of Status cases.
          </p>
          <div className="grid grid-cols-3 gap-3 sm:gap-6 max-w-lg mx-auto">
            {[
              { num: "10,000+", label: "Visas Approved" },
              { num: "15+",    label: "Years Experience" },
              { num: "98%",    label: "Success Rate" },
            ].map(({ num, label }) => (
              <div key={label} className="bg-white/10 border border-white/20 rounded-2xl py-4 px-2 sm:px-4">
                <p className="text-lg sm:text-2xl md:text-3xl font-extrabold leading-tight break-words">{num}</p>
                <p className="text-[10px] sm:text-xs text-white/65 mt-1 leading-tight">{label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ══ ABOUT THE COMPANY ══ */}
      <section className="max-w-6xl mx-auto px-6 sm:px-10 py-16 sm:py-20">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-16 items-center">
          <div>
            <span className="inline-block mb-4 text-xs font-bold uppercase tracking-widest text-[#1D9E75]">
              Who We Are
            </span>
            <h2 className="text-3xl sm:text-4xl font-extrabold text-slate-900 leading-tight mb-6">
              Your Trusted Partner<br className="hidden sm:block"/> for Bay Area Immigration
            </h2>
            <div className="space-y-4 text-slate-600 leading-relaxed text-[15px]">
              <p>
                <strong className="text-slate-800">Bay Area Immigration Services (BAIS)</strong> provides
                expert support to individuals, families, and the corporate sector for both immigrant and
                non-immigrant visa petitions. We specialise in preparing and organising all required
                documentation for every US visa category.
              </p>
              <p>
                After careful review, we submit the finalised petition directly to the{" "}
                <strong className="text-slate-800">U.S. Citizenship &amp; Immigration Services (USCIS)</strong>.
                Our team stays current with the latest immigration policies, changing processing times,
                and legal updates — so you don't have to.
              </p>
              <p>
                From the first consultation to the moment you hold your visa, our dedicated consultants
                stand with you every step of the way — for students pursuing their American dream, families
                seeking reunification, and professionals advancing their careers in the U.S.
              </p>
            </div>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link to="/signup"
                className="inline-flex items-center gap-2 px-6 py-3 bg-[#1D9E75] hover:bg-[#0F6E56]
                  text-white text-sm font-bold rounded-xl shadow-sm shadow-emerald-200
                  transition-all duration-200 no-underline active:scale-95">
                Get Started
                <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M9 5l7 7-7 7"/>
                </svg>
              </Link>
              <a href="#cos"
                className="inline-flex items-center gap-2 px-6 py-3 bg-white border border-slate-200
                  hover:border-slate-300 text-slate-700 text-sm font-semibold rounded-xl
                  transition-all duration-200 no-underline hover:bg-slate-50">
                Change of Status <IconArrowRight size={14} />
              </a>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            {[
              { icon: IconSchool, iconColor: "text-blue-600", label: "Students",   desc: "F-1 & J-1 visas, I-20 support, OPT/CPT",  bg: "bg-blue-50",    border: "border-blue-100"    },
              { icon: IconUsers, iconColor: "text-pink-600", label: "Families",  desc: "Spousal, parent & sibling petitions",      bg: "bg-pink-50",    border: "border-pink-100"    },
              { icon: IconBriefcase, iconColor: "text-violet-600", label: "Corporate",  desc: "H-1B, L-1, O-1 employer petitions",        bg: "bg-violet-50",  border: "border-violet-100"  },
              { icon: IconIdCard, iconColor: "text-emerald-600", label: "Green Card", desc: "EB & family-based permanent residency",     bg: "bg-emerald-50", border: "border-emerald-100" },
            ].map(({ icon: Icon, iconColor, label, desc, bg, border }) => (
              <div key={label}
                className={`${bg} border ${border} rounded-2xl p-5
                  hover:shadow-md hover:-translate-y-0.5 transition-all duration-200`}>
                <Icon size={28} className={`${iconColor} block mb-3`} />
                <p className="font-bold text-slate-800 text-sm mb-1">{label}</p>
                <p className="text-xs text-slate-500 leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ══ CHANGE OF STATUS — HERO BLOCK ══ */}
      <section id="cos" className="bg-slate-900 text-white py-16 sm:py-20">
        <div className="max-w-6xl mx-auto px-6 sm:px-10">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
            <div>
              <span className="inline-block mb-4 px-4 py-1.5 rounded-full bg-emerald-500/20
                border border-emerald-400/30 text-xs font-bold tracking-widest uppercase text-emerald-300">
                Specialised Service
              </span>
              <h2 className="text-3xl sm:text-4xl font-extrabold leading-tight mb-5">
                Change of Status Services —<br className="hidden sm:block"/>
                <span className="text-emerald-400">Keep Your Visa Status Safe</span>
              </h2>
              <p className="text-slate-300 text-[15px] leading-relaxed mb-5">
                Worried about your visa status or approaching deadlines? A delay, incorrect filing, or wrong
                strategy can lead to status gaps, denials, or long-term immigration complications that are
                difficult to fix later.
              </p>
              <p className="text-slate-400 text-sm leading-relaxed mb-5">
                Whether you're moving from <strong className="text-white">F-1 to H-1B</strong>,{" "}
                <strong className="text-white">B1/B2 to F-1</strong>,{" "}
                <strong className="text-white">H-1B to O-1</strong>, or transitioning to a better
                immigration pathway, every Change of Status must be handled with precision and within
                strict USCIS timelines. Even a small error can impact your ability to stay and work in the U.S.
              </p>
              <p className="text-slate-400 text-sm leading-relaxed">
                BAIS brings proven experience in handling Change of Status cases with accuracy and
                compliance. We assess your situation, recommend the right approach, and manage the
                filing process end-to-end — ensuring everything is submitted correctly and on time.
              </p>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-1 gap-4">
              {[
                { icon: IconAward, stat: "15+",       label: "Years of Experience",      desc: "Handling complex U.S. immigration cases with a proven track record of success." },
                { icon: IconZap, stat: "< 24 hrs",  label: "Fast Response Time",       desc: "Get clarity when you need it most — rapid consultation scheduling, day or night." },
                { icon: IconUser, stat: "1:1",        label: "Dedicated Case Manager",   desc: "Personal attention from someone who truly understands your unique immigration situation." },
                { icon: IconDollarSign, stat: "Fair",       label: "Affordable Fees",          desc: "Competitive, transparent pricing compared to most immigration law firms." },
              ].map(({ icon: Icon, stat, label, desc }) => (
                <div key={label}
                  className="flex items-start gap-4 bg-slate-800 border border-slate-700 rounded-2xl p-5
                    hover:border-slate-500 transition-all duration-200">
                  <div className="w-12 h-12 rounded-xl bg-emerald-500/15 border border-emerald-500/30
                    flex items-center justify-center shrink-0">
                    <Icon size={20} className="text-emerald-400" />
                  </div>
                  <div>
                    <p className="text-lg font-extrabold text-emerald-400">{stat}</p>
                    <p className="font-bold text-white text-sm">{label}</p>
                    <p className="text-xs text-slate-400 mt-0.5 leading-relaxed">{desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ══ COMMON STRUGGLES ══ */}
      <section className="max-w-6xl mx-auto px-6 sm:px-10 py-16 sm:py-20">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-start">
          <div>
            <span className="inline-block mb-4 text-xs font-bold uppercase tracking-widest text-red-500">
              Common Challenges
            </span>
            <h2 className="text-3xl sm:text-4xl font-extrabold text-slate-900 mb-4">
              Common Struggles People<br className="hidden sm:block"/> Face with Change of Status
            </h2>
            <p className="text-slate-500 text-sm leading-relaxed mb-8">
              You're not alone. Many professionals encounter these same issues when navigating visa status changes.
            </p>
            <ul className="space-y-3">
              {[
                "Sudden layoffs leaving very limited time to act on your status",
                "Stress of maintaining lawful status to avoid deportation risk",
                "Fear of visa denials due to documentation or paperwork errors",
                "Uncertainty about which visa option best fits your situation",
                "Complex USCIS rules and frequently changing processing timelines",
                "Losing employer sponsorship mid-process without a backup plan",
              ].map((item, i) => (
                <li key={i} className="flex items-start gap-3">
                  <span className="w-5 h-5 rounded-full bg-red-100 text-red-600 flex items-center justify-center shrink-0 mt-0.5 text-xs font-bold">
                    !
                  </span>
                  <span className="text-sm text-slate-600 leading-relaxed">{item}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="bg-linear-to-br from-emerald-50 to-teal-50 border border-emerald-100 rounded-2xl p-8">
            <h3 className="text-xl font-extrabold text-slate-900 mb-3">
              Your Options Don't End with a Layoff
            </h3>
            <p className="text-slate-600 text-sm leading-relaxed mb-5">
              At BAIS, we specialise in helping professionals, families, and students transition
              smoothly from one visa status to another. Whether you're moving from{" "}
              <strong>H-1B to B-2 after a layoff</strong>, or from <strong>F-1 OPT to H-1B</strong>,
              our experts guide you at every step.
            </p>
            <p className="text-slate-600 text-sm leading-relaxed mb-6">
              If you're currently on an H-1B or F-1 visa and looking for greater flexibility, the
              <strong> O-1 visa, EB-1A, or EB-2 NIW</strong> could be your next step. These pathways
              offer freedom from lottery limits, reduced dependency on employer sponsorship, and
              long-term career stability based on your professional achievements.
            </p>
            <div className="flex flex-col sm:flex-row gap-3">
              <a href="#appointment"
                className="inline-flex items-center justify-center gap-2 px-6 py-3
                  bg-[#1D9E75] hover:bg-[#0F6E56] text-white text-sm font-bold rounded-xl
                  transition-all duration-200 no-underline active:scale-95">
                Book Free Consultation
              </a>
              <a href="tel:+15107708700"
                className="inline-flex items-center justify-center gap-2 px-6 py-3
                  bg-white border border-emerald-200 text-emerald-700 text-sm font-semibold rounded-xl
                  hover:bg-emerald-50 transition-all duration-200 no-underline">
                <IconPhone size={16} /> Call Now
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* ══ WHO WE HELP ══ */}
      <section className="bg-slate-900 py-16 sm:py-20">
        <div className="max-w-6xl mx-auto px-6 sm:px-10">
          <div className="text-center mb-12">
            <span className="inline-block mb-3 text-xs font-bold uppercase tracking-widest text-emerald-400">
              Coverage
            </span>
            <h2 className="text-3xl sm:text-4xl font-extrabold text-white">Who We Help</h2>
            <p className="text-slate-400 mt-3 max-w-xl mx-auto text-sm">
              Our expertise covers a wide range of visa status change scenarios.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[
              { icon: IconBriefcase, title: "Laid-Off H-1B Workers",     desc: "Urgent change to B-2 or F-1 to maintain legal status in the U.S. post-layoff."          },
              { icon: IconSchool, title: "Students on OPT",           desc: "Smooth transition from F-1 OPT to H-1B or other employment-based work visas."             },
              { icon: IconGlobe, title: "L-1 / H-1B Holders",        desc: "Exploring Green Card pathways including EB-1A, EB-2 NIW, and EB-3 sponsorships."          },
              { icon: IconUsers, title: "Families",               desc: "Dependent status changes including H-4, L-2, and other family derivative categories."    },
              { icon: IconClock, title: "Professionals on Notice",   desc: "Limited filing windows requiring immediate, expert action to protect your legal status."   },
              { icon: IconAward, title: "EB-1A / O-1 Candidates",    desc: "High-achievers seeking visa options that bypass lottery limits and employer dependency."   },
            ].map(({ icon: Icon, title, desc }) => (
              <div key={title}
                className="bg-slate-800 border border-slate-700 rounded-2xl p-6
                  hover:border-emerald-500/40 hover:bg-slate-750 transition-all duration-200">
                <Icon size={28} className="text-emerald-400 block mb-4" />
                <h3 className="font-extrabold text-white text-base mb-2">{title}</h3>
                <p className="text-sm text-slate-400 leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ══ HOW WE MAKE IT EASIER ══ */}
      <section className="max-w-6xl mx-auto px-6 sm:px-10 py-16 sm:py-20">
        <div className="text-center mb-12">
          <span className="inline-block mb-3 text-xs font-bold uppercase tracking-widest text-[#1D9E75]">
            Our Process
          </span>
          <h2 className="text-3xl sm:text-4xl font-extrabold text-slate-900">
            How BAIS Makes Change of Status Easier
          </h2>
          <p className="text-slate-500 mt-3 max-w-xl mx-auto text-sm">
            Our streamlined process ensures your status change is handled professionally and efficiently.
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {[
            { step: "01", icon: IconMessageCircle, title: "Personal Consultation", desc: "We assess your exact situation and recommend the best possible visa option tailored to your circumstances." },
            { step: "02", icon: IconFileText, title: "Paperwork Done Right",  desc: "No guesswork, no missed details, no risk of rejection. Our experienced team handles all documentation meticulously." },
            { step: "03", icon: IconRocket, title: "Quick Action",          desc: "Time is critical — our team ensures filings are completed within USCIS deadlines to protect your status." },
            { step: "04", icon: IconHandshake, title: "Ongoing Guidance",      desc: "From filing to approval, we stay by your side providing updates and support throughout the entire process." },
          ].map(({ step, icon: Icon, title, desc }) => (
            <div key={step} className="relative bg-white border border-slate-100 rounded-2xl p-6 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-200">
              <span className="absolute top-4 right-4 text-[0.68rem] font-extrabold text-slate-300">{step}</span>
              <Icon size={32} className="text-[#1D9E75] block mb-4" />
              <h3 className="font-extrabold text-slate-800 text-base mb-2">{title}</h3>
              <p className="text-sm text-slate-500 leading-relaxed">{desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ══ GOOGLE REVIEWS ══ */}
      <section className="bg-[#f1f5f9] py-16 sm:py-20">
        <div className="max-w-6xl mx-auto px-6 sm:px-10">
          <div className="text-center mb-10">
            <div className="flex items-center justify-center gap-3 mb-4">
              <GoogleLogo />
              <span className="text-lg font-extrabold text-slate-800">Google Reviews</span>
            </div>
            <div className="flex items-center justify-center gap-2 mb-1">
              <Stars />
              <span className="text-2xl font-extrabold text-slate-900">5.0</span>
            </div>
            <p className="text-sm text-slate-500">198 verified reviews · Rated Excellent</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {REVIEWS.map((r) => (
              <div key={r.name}
                className="bg-white border border-slate-100 rounded-2xl p-5 shadow-sm
                  hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 flex flex-col">
                <div className="flex items-center gap-3 mb-3">
                  <div className={`w-10 h-10 rounded-full ${r.color} flex items-center justify-center
                    text-white text-sm font-extrabold shrink-0`}>
                    {r.initials}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-slate-800 truncate">{r.name}</p>
                    <p className="text-xs text-slate-400">{r.ago}</p>
                  </div>
                  <GoogleLogo />
                </div>
                <Stars />
                <p className="text-xs text-slate-600 leading-relaxed mt-3 flex-1 line-clamp-5">{r.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ══ BOOK CONSULTATION ══ */}
      <ConsultationSection source="About Us Page" />

      {/* ══ FOOTER ══ */}
      <SiteFooter />
    </div>
  );
}
