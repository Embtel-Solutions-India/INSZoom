import { useState, useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import ThemeToggle from "./ThemeToggle";
import BrandMark from "./BrandMark";

/* ── Icons ─────────────────────────────────────────────────────────────────── */
const MenuIcon = () => (
  <svg width="22" height="22" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h16"/>
  </svg>
);
const XIcon = () => (
  <svg width="22" height="22" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"/>
  </svg>
);

// Landing is the pre-authentication marketing site — every authenticated
// destination (Dashboard, Documents, Profile, Messages, Payments) now lives
// entirely in the Client app (a separate origin, see repository-split docs),
// so this navbar never varies by auth state: it always shows Client Login +
// Start Free Evaluation + the theme toggle, never a profile/logout dropdown
// pointing at routes that don't exist here anymore.
export default function Navbar() {
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  // Shadow on scroll
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 4);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Close mobile menu on route change
  useEffect(() => { setMenuOpen(false); }, [location.pathname]);

  return (
    <nav
      className={`sticky top-0 z-50 bg-card/95 backdrop-blur-sm transition-shadow duration-200
        ${scrolled ? "shadow-md shadow-black/5" : "border-b border-border"}`}
    >
      <div className="mx-auto flex h-18 max-w-7xl items-center justify-between gap-3 px-5 sm:px-6 lg:px-8">

        {/* ── Logo ── */}
        <Link to="/" className="flex items-center gap-2 shrink-0 group no-underline min-w-0">
          <BrandMark size="w-8 h-8" />
          <span className="text-lg font-sans font-extrabold tracking-tight text-foreground">Immiglance</span>
        </Link>

        {/* ── Always the same: Client Login + Start Free Evaluation + theme
            toggle — never conditioned on auth state. ── */}
        <div className="flex items-center gap-2 shrink-0 ml-auto">

          <ThemeToggle className="hidden sm:inline-flex" />

          <Link
            to="/login"
            className="hidden sm:flex text-sm font-semibold px-4 py-2 rounded-lg
              text-foreground hover:text-primary transition-all no-underline"
          >
            Client Login
          </Link>
          <Link
            to="/eligibility?src=Navbar"
            className="text-sm font-bold px-4 py-2 rounded-lg
              bg-primary text-primary-foreground shadow-sm hover:opacity-90
              transition-all no-underline active:scale-95"
          >
            Start Free Evaluation
          </Link>

          {/* Mobile hamburger */}
          <button
            onClick={() => setMenuOpen((o) => !o)}
            className="lg:hidden flex items-center justify-center w-9 h-9 rounded-lg
              border border-border text-muted-foreground hover:bg-secondary transition"
            aria-label="Toggle menu"
          >
            {menuOpen ? <XIcon /> : <MenuIcon />}
          </button>
        </div>
      </div>

      {/* ── Mobile menu ── */}
      {menuOpen && (
        <div className="lg:hidden border-t border-border bg-card px-4 py-3 space-y-1
          shadow-lg shadow-black/5">

          <div className="flex items-center justify-between px-4 py-2">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">Appearance</span>
            <ThemeToggle />
          </div>

          <div className="flex gap-2 pt-1">
            <Link to="/login"
              className="flex-1 text-center text-sm font-semibold py-2.5 rounded-xl border
                border-border text-foreground hover:bg-secondary transition no-underline">
              Client Login
            </Link>
            <Link to="/eligibility?src=Navbar"
              className="flex-1 text-center text-sm font-bold py-2.5 rounded-xl
                bg-primary text-primary-foreground
                hover:opacity-90 transition no-underline">
              Start Free Evaluation
            </Link>
          </div>
        </div>
      )}
    </nav>
  );
}
