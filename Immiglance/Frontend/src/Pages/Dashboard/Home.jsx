import { useEffect } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import useHasCase from "../../hooks/useHasCase";
import StartAssessmentButton from "../../components/StartAssessmentButton";

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

const TRUST_ITEMS = [
  "Every evaluation is reviewed by our attorney-managed case team before any recommendation is made.",
  "Your case timeline, tasks, and documents live in one secure portal — not scattered across email threads.",
  "Built for EB-1, EB-2 NIW, O-1, EB-5, E-2, H-1B, and L-1A — with a dedicated questionnaire for each.",
];

export default function Home() {
  const { user } = useAuth();
  const { hasCase } = useHasCase();

  useEffect(() => {
    document.title = "Immiglance | Attorney-Managed Case Evaluation & Client Portal";
  }, []);

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
          <Link
            to="/how-it-works"
            className="inline-flex items-center justify-center px-7 py-3.5 text-base font-semibold rounded-xl
              border border-border text-foreground hover:bg-secondary transition-all duration-200 no-underline"
          >
            View Demo Portal
          </Link>
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
