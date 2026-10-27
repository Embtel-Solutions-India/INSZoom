import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import BrandMark from "./BrandMark";
import libertyImg from "../assets/admin-login-liberty.webp";

const COLUMNS = [
  {
    title: "Visa Categories",
    links: [
      { label: "EB-1A Extraordinary Ability", to: "/eligibility?src=Footer%20%E2%80%94%20EB-1A" },
      { label: "EB-2 National Interest Waiver", to: "/eligibility?src=Footer%20%E2%80%94%20EB-2%20NIW" },
      { label: "O-1A Extraordinary Ability", to: "/eligibility?src=Footer%20%E2%80%94%20O-1A" },
      { label: "EB-5 Immigrant Investor", to: "/eligibility?src=Footer%20%E2%80%94%20EB-5" },
      { label: "H-1B & L-1A Work Visas", to: "/eligibility?src=Footer%20%E2%80%94%20H-1B" },
    ],
  },
  {
    title: "Company",
    links: [
      { label: "How It Works", to: "/#process" },
      { label: "About Immiglance", to: "/#about" },
      { label: "FAQ", to: "/#faq" },
      { label: "Free Case Evaluation", to: "/eligibility?src=Footer" },
    ],
  },
  {
    title: "Resources",
    links: [
      { label: "Latest USCIS Forms", to: "/forms" },
      { label: "Book a Consultation", to: "/consultation/book" },
    ],
  },
  {
    title: "Legal",
    links: [
      { label: "Privacy Policy", to: "/privacy-policy" },
      { label: "Terms & Conditions", to: "/terms-and-conditions" },
    ],
  },
];

// The big wordmark rises into view from below the first time it scrolls onto the screen.
function RisingWordmark() {
  const ref = useRef(null);
  // No animation for visitors who ask for reduced motion (or browsers without IntersectionObserver): show it straight away.
  const [shown, setShown] = useState(() => typeof IntersectionObserver === "undefined" || Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches));
  useEffect(() => {
    const node = ref.current;
    if (!node || shown) return undefined;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { setShown(true); observer.disconnect(); }
    }, { threshold: 0.35 });
    observer.observe(node);
    return () => observer.disconnect();
  }, [shown]);
  return (
    <div ref={ref} className="mt-10 overflow-hidden">
      <p
        aria-hidden="true"
        className={"select-none text-center font-wordmark text-[11vw] font-light uppercase leading-[0.95] tracking-[0.08em] text-primary transition-all duration-1000 ease-out xl:text-[8.5rem] " + (shown ? "translate-y-0 opacity-100" : "translate-y-full opacity-0")}
      >
        Immiglance
      </p>
    </div>
  );
}

// The bottom of every public Landing page: link columns, the legal pages, the disclaimer and the copyright line.
export default function SiteFooter() {
  return (
    <footer className="border-t border-border bg-white">
      <div className="mx-auto max-w-7xl overflow-hidden px-5 pt-14 sm:px-6 lg:px-8">
        <div
          role="img"
          aria-label="New York harbour with the Statue of Liberty"
          className="h-56 w-full rounded-3xl border border-border bg-no-repeat sm:h-80"
          style={{ backgroundImage: `url(${libertyImg})`, backgroundPosition: "30% 55%", backgroundSize: "cover" }}
        />
        <RisingWordmark />
      </div>
      <div className="mx-auto max-w-7xl px-5 py-14 sm:px-6 lg:px-8">
        <div className="grid gap-10 lg:grid-cols-[1.4fr_2.6fr]">
          <div className="max-w-sm">
            <Link to="/" className="inline-flex items-center gap-2 no-underline">
              <BrandMark size="w-9 h-9" />
              <span className="font-sans text-xl font-extrabold tracking-tight text-foreground">Immiglance</span>
            </Link>
            <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
              A case evaluation &amp; client portal platform for employment-based and investor immigration, from your first questionnaire to a filed petition.
            </p>
            <Link to="/eligibility?src=Footer" className="mt-6 inline-flex rounded-lg bg-primary px-5 py-2.5 text-sm font-bold text-primary-foreground no-underline transition hover:opacity-85">
              Start Free Evaluation
            </Link>
          </div>

          <div className="grid grid-cols-2 gap-8 sm:grid-cols-4">
            {COLUMNS.map((column) => (
              <nav key={column.title} aria-label={column.title}>
                <p className="mb-4 text-xs font-bold uppercase tracking-widest text-foreground">{column.title}</p>
                <ul className="space-y-2.5">
                  {column.links.map((link) => (
                    <li key={link.label}>
                      <Link to={link.to} className="text-sm text-muted-foreground no-underline transition hover:text-foreground hover:underline">{link.label}</Link>
                    </li>
                  ))}
                </ul>
              </nav>
            ))}
          </div>
        </div>

        <div className="mt-12 border-t border-border pt-8">
          <p className="max-w-4xl text-xs leading-relaxed text-muted-foreground">
            Immiglance is not a law firm and does not provide legal advice. Where legal services are provided, they are provided exclusively by an independent, attorney-supervised law firm. Information on this site is general and is not a guarantee of any outcome.
          </p>
          <div className="mt-5 text-sm text-muted-foreground">
            &copy; {Math.max(2026, new Date().getFullYear())} Immiglance. All Rights Reserved. Developed by{" "}
            <a href="https://embtelsolutions.com/" target="_blank" rel="noopener noreferrer" className="font-medium text-foreground hover:underline">
              Embtel Solutions
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
