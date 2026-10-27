import { useState, useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import BrandMark from "./BrandMark";
import { useBranding } from "../utils/branding";
import { getSessionId } from "../utils/eligibilitySession";

// Login/Signup now live entirely in the Client app (a different origin) —
// see Immiglance/Client/src/Pages/Auth/. "Sign In" is a plain
// cross-origin navigation, not a same-app route, mirroring the existing
// VITE_ADMIN_URL/VITE_ATTORNEY_PORTAL_URL pattern (utils/portalRedirect.js).
// VITE_CLIENT_URL already exists for CrossAppRedirect.jsx's own use.
const CLIENT_URL = import.meta.env.VITE_CLIENT_URL || "http://localhost:5175";

// The quiz's anonymous sessionId lives in this origin's sessionStorage,
// which Client's origin can never read directly — carried over as a URL
// param instead so a visitor who already took the quiz here doesn't lose
// that association if they log in/sign up from this link. Safe to always
// send: a sessionId with no matching Lead is just a no-op (see
// Backend/src/modules/auth/auth.service.js's findLinkableLead).
function clientLoginUrl() {
  return `${CLIENT_URL}/login?sessionId=${encodeURIComponent(getSessionId())}`;
}

const LINKS = [
  { label: "For Individuals", to: "/#individuals" },
  { label: "For Businesses", to: "/#businesses" },
  { label: "How It Works", to: "/#process" },
  { label: "Latest Forms", to: "/forms" },
  { label: "About Us", to: "/#about" },
];

const MenuIcon = () => (
  <svg width="22" height="22" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h16" />
  </svg>
);
const XIcon = () => (
  <svg width="22" height="22" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
  </svg>
);

// Landing is the pre-authentication marketing site — every authenticated
// destination lives in the Client app (a separate origin), so this navbar never
// varies by auth state: section links, Sign In and Start Free Evaluation.
export default function Navbar() {
  const branding = useBranding();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 4);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Close mobile menu on route change
  useEffect(() => { setMenuOpen(false); }, [location.pathname, location.hash]);

  return (
    <nav className={`sticky top-0 z-50 bg-white/95 backdrop-blur-sm transition-shadow duration-200 ${scrolled ? "shadow-sm shadow-black/10" : ""} border-b border-border`}>
      <div className="mx-auto flex h-18 max-w-7xl items-center justify-between gap-6 px-5 sm:px-6 lg:px-8">
        <Link to="/" className="flex min-w-0 shrink-0 items-center gap-2 no-underline">
          <BrandMark size="w-8 h-8" />
          <span className="truncate font-sans text-lg font-extrabold tracking-tight text-foreground">{branding.displayName}</span>
        </Link>

        <div className="hidden items-center gap-1 lg:flex">
          {LINKS.map((link) => (
            <Link key={link.label} to={link.to} className="rounded-lg px-3.5 py-2 text-sm font-semibold text-foreground/80 no-underline transition hover:bg-secondary hover:text-foreground">
              {link.label}
            </Link>
          ))}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <a href={clientLoginUrl()} className="hidden rounded-lg px-4 py-2 text-sm font-semibold text-foreground no-underline transition hover:bg-secondary sm:flex">
            Sign In
          </a>
          <Link
            to="/eligibility?src=Navbar"
            className="whitespace-nowrap rounded-lg bg-primary px-3.5 py-2 text-xs font-bold text-primary-foreground no-underline shadow-sm transition hover:opacity-85 active:scale-95 sm:px-5 sm:text-sm"
          >
            Get Started
          </Link>
          <button
            type="button"
            onClick={() => setMenuOpen((open) => !open)}
            className="flex h-10 w-10 items-center justify-center rounded-lg border border-border text-foreground transition hover:bg-secondary lg:hidden"
            aria-label="Toggle menu"
            aria-expanded={menuOpen}
          >
            {menuOpen ? <XIcon /> : <MenuIcon />}
          </button>
        </div>
      </div>

      {menuOpen && (
        <div className="space-y-1 border-t border-border bg-white px-4 py-3 shadow-lg shadow-black/5 lg:hidden">
          {LINKS.map((link) => (
            <Link key={link.label} to={link.to} className="block rounded-lg px-4 py-3 text-sm font-semibold text-foreground no-underline hover:bg-secondary">
              {link.label}
            </Link>
          ))}
          <a href={clientLoginUrl()} className="block rounded-lg border border-border px-4 py-3 text-center text-sm font-semibold text-foreground no-underline hover:bg-secondary">
            Sign In
          </a>
        </div>
      )}
    </nav>
  );
}
