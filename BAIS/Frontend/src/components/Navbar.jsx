import { useState, useEffect, useRef } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { isEmployeeAccount } from "../utils/auth";
import NotificationBell from "./NotificationBell";

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
const ChevronDown = () => (
  <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 9l-7 7-7-7"/>
  </svg>
);
const UserIcon = () => (
  <svg width="15" height="15" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"
      d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"/>
  </svg>
);
const DocsIcon = () => (
  <svg width="15" height="15" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"
      d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
  </svg>
);
const DashIcon = () => (
  <svg width="15" height="15" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"
      d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"/>
  </svg>
);
const LogoutIcon = () => (
  <svg width="15" height="15" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"
      d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"/>
  </svg>
);

const MsgIcon = () => (
  <svg width="15" height="15" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"
      d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"/>
  </svg>
);

/* ── Nav links config ───────────────────────────────────────────────────────── */
// The employer/employee flow now lives entirely inside the Documents page
// (checklist + handoff popup) — there is no separate Employer Workspace nav
// destination anymore.
// hideForEmployee: true marks a destination BlockEmployeeRoute redirects an
// invited-employee account away from anyway (see ProtectedRoute.jsx) — kept
// off an employee's nav entirely rather than shown-then-redirected.
const NAV_LINKS = [
  { label: "Home",      to: "/"                    },
  { label: "How It Works", to: "/how-it-works"     },
  { label: "Dashboard", to: "/dashboard"            },
  { label: "Documents", to: "/dashboard/documents", authOnly: true, employeeOnly: true },
  { label: "Profile",   to: "/dashboard/profile",   authOnly: true, employeeOnly: true },
  { label: "Offers",    to: "/offers"              },
  { label: "Messages",  to: "/dashboard/messages", authOnly: true, hideForEmployee: true },
  { label: "About Us",  to: "/about"               },
  { label: "Payments",  to: "/dashboard/payments", authOnly: true, hideForEmployee: true },
];

const CASE_REQUIRED_LINKS = new Set(["Dashboard", "Messages", "Payments"]);

function visibleNavLinks(user, hasCase) {
  const restricted = isEmployeeAccount(user);
  return NAV_LINKS.filter((link) => {
    if (restricted) return ["Dashboard", "Documents", "Profile"].includes(link.label);
    if (CASE_REQUIRED_LINKS.has(link.label) && !hasCase) return false;
    return (!link.authOnly || !!user)
      && (!link.roles || link.roles.includes(user?.role))
      && !link.employeeOnly
      && (!link.hideForEmployee || !restricted);
  });
}

export default function Navbar() {
  const { user, logout, authStatus, authLoading, sessionContext } = useAuth();
  const location           = useLocation();
  const navigate           = useNavigate();
  const [menuOpen,  setMenuOpen]  = useState(false);
  const [dropOpen,  setDropOpen]  = useState(false);
  const [scrolled,  setScrolled]  = useState(false);
  const dropRef = useRef(null);

  const isActive = (to) => location.pathname === to;
  // Perf fix: previously fetched its own copy of sessionContext via a
  // separate useEffect/authApi.sessionContext() call, independent of
  // AuthContext's own /auth/me fetch — now reads the single shared
  // sessionContext AuthContext already fetches. `authLoading` replaces the
  // old sessionHasCaseLoading local state as the "don't know yet" signal:
  // defaults true (not false) while it's in flight so nav-link visibility
  // doesn't assume "no case" and hide Dashboard/Messages/Payments for the
  // whole duration of every page load, not just briefly. sessionContext is a
  // UI hint for which tabs to show, never a security gate (ProtectedRoute/
  // backend routes remain the real access control), so defaulting optimistic
  // here is safe.
  const hasCase = Boolean(sessionContext?.hasCase || isEmployeeAccount(user) || (user && authLoading));
  // Auth-state race (see AuthContext.jsx's own "Phase 12 fix (P12-C2)" comment,
  // which documents ProtectedRoute having this same problem): `user` is null
  // both while verifySession() is still in flight (authStatus "loading") and
  // when it fails due to a slow/unreachable backend (authStatus "error") -
  // neither means the user is actually logged out. Rendering Login/Sign Up
  // off `user` alone showed the wrong navbar for the entire loading window on
  // a slow backend, not just a brief flash.
  const authResolving = authStatus === "loading" || authStatus === "error";

  // Shadow on scroll
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 4);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e) => {
      if (dropRef.current && !dropRef.current.contains(e.target)) setDropOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Close mobile menu on route change
  useEffect(() => { setMenuOpen(false); setDropOpen(false); }, [location.pathname]);

  const handleLogout = async () => {
    await logout();
    setDropOpen(false);
    navigate("/login");
  };

  // Derive initials & display name from Firebase user
  const displayName = user?.displayName || user?.email?.split("@")[0] || "User";
  const initials    = displayName.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();
  const emailShort  = user?.email?.length > 26 ? user.email.slice(0, 24) + "…" : user?.email;

  return (
    <nav
      className={`sticky top-0 z-50 bg-white/95 backdrop-blur-sm transition-shadow duration-200
        ${scrolled ? "shadow-md shadow-slate-200/60" : "border-b border-slate-100"}`}
    >
      <div className="mx-auto flex h-18 max-w-7xl items-center justify-between gap-3 px-5 sm:px-6 lg:px-8">

        {/* ── Logo ── */}
        <Link to="/" className="flex items-center gap-2.5 shrink-0 group no-underline min-w-0">
          <div className="w-9 h-9 rounded-xl bg-linear-to-br from-[#1D9E75] to-teal-600
            flex items-center justify-center shadow-sm group-hover:shadow-md transition">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="white">
              <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
            </svg>
          </div>
          <div className="flex flex-col leading-none">
            <span className="text-[1.05rem] font-extrabold text-slate-800 tracking-tight">BAIS</span>
            <span className="text-[0.56rem] font-semibold text-slate-400 uppercase tracking-widest hidden sm:block">
              Immigration Portal
            </span>
          </div>
        </Link>

        {/* ── Desktop nav links ── */}
        <div className="hidden lg:flex min-w-0 flex-1 items-center justify-center gap-0.5 xl:gap-1">
          {visibleNavLinks(user, hasCase).map(({ label, to }) => (
            <Link
              key={label}
              to={to}
              className={`text-[0.82rem] font-semibold px-2.5 py-2 xl:px-3 rounded-lg transition-all no-underline whitespace-nowrap
                ${isActive(to)
                  ? "bg-emerald-50 text-emerald-700"
                  : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"}`}
            >
              {label}
            </Link>
          ))}
        </div>

        {/* ── Auth section ── */}
        <div className="flex items-center gap-2 shrink-0 ml-auto">

          {authResolving ? (
            /* ── Auth state still resolving (loading, or backend error) ──
               Neither Login/Sign Up nor the profile dropdown - both would be
               a guess. A fixed-size placeholder avoids the header jumping
               once the real state resolves a moment later. */
            <div className="w-9 h-9" aria-hidden="true" />
          ) : user ? (
            /* ── Logged in: profile dropdown ── */
            <div className="flex items-center gap-2">
              <NotificationBell />
              <div className="relative" ref={dropRef}>
              <button
                onClick={() => setDropOpen((o) => !o)}
                className={`flex max-w-36 items-center gap-2 px-2.5 py-1.5 xl:max-w-44 xl:px-3 rounded-xl border transition-all
                  ${dropOpen
                    ? "bg-emerald-50 border-emerald-200 shadow-sm"
                    : "bg-slate-50 border-slate-200 hover:bg-slate-100 hover:border-slate-300"}`}
              >
                {/* Avatar */}
                <div className="w-7 h-7 rounded-full bg-linear-to-br from-[#1D9E75] to-teal-600
                  flex items-center justify-center text-[0.65rem] font-extrabold text-white shrink-0">
                  {initials}
                </div>
                <span className="text-[0.82rem] min-w-0 font-semibold text-slate-700 hidden sm:block truncate">
                  {displayName}
                </span>
                <span className={`text-slate-400 transition-transform duration-200 ${dropOpen ? "rotate-180" : ""}`}>
                  <ChevronDown />
                </span>
              </button>

              {/* Dropdown */}
              {dropOpen && (
                <div className="absolute right-0 mt-2 w-60 bg-white rounded-2xl border border-slate-200
                  shadow-xl shadow-slate-200/70 overflow-hidden z-50
                  animate-[fadeDown_0.15s_ease_forwards]">

                  {/* User info header */}
                  <div className="px-4 py-3.5 border-b border-slate-100 bg-slate-50">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-linear-to-br from-[#1D9E75] to-teal-600
                        flex items-center justify-center text-sm font-extrabold text-white shrink-0">
                        {initials}
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-bold text-slate-800 truncate">{displayName}</p>
                        <p className="text-xs text-slate-400 truncate">{emailShort}</p>
                      </div>
                    </div>
                  </div>

                  {/* Menu items */}
                  <div className="py-1.5">
                    <DropItem to="/dashboard/profile" icon={<UserIcon />} label="My Profile"
                      sub="View & edit your details" />
                    {hasCase && (
                      <DropItem to="/dashboard/documents" icon={<DocsIcon />} label="My Documents"
                        sub="Upload & manage files" />
                    )}
                    {["super_admin", "admin", "team_lead", "case_manager"].includes(user?.role) && (
                      <DropItem to="/dashboard/document-review" icon={<DocsIcon />} label="Document Review"
                        sub="Confirm auto-filled fields" />
                    )}
                    {hasCase && (
                      <DropItem to="/dashboard" icon={<DashIcon />} label="Dashboard"
                        sub="Case overview" />
                    )}
                  </div>

                  {/* Logout */}
                  <div className="border-t border-slate-100 py-1.5">
                    <button
                      onClick={handleLogout}
                      className="w-full flex items-center gap-3 px-4 py-2.5 text-sm font-semibold
                        text-red-600 hover:bg-red-50 transition-colors text-left"
                    >
                      <span className="w-7 h-7 rounded-lg bg-red-50 flex items-center justify-center shrink-0">
                        <LogoutIcon />
                      </span>
                      Sign Out
                    </button>
                  </div>
                </div>
              )}
            </div>
            </div>

          ) : (
            /* ── Not logged in: Login + Sign Up ── */
            <>
              <Link
                to="/login"
                className="hidden sm:flex text-sm font-semibold px-4 py-2 rounded-lg border border-slate-300
                  text-slate-700 hover:bg-slate-50 hover:border-slate-400 transition-all no-underline"
              >
                Login
              </Link>
              <Link
                to="/signup"
                className="text-sm font-bold px-4 py-2 rounded-lg
                  bg-linear-to-r from-[#1D9E75] to-teal-600
                  text-white shadow-sm shadow-emerald-200 hover:shadow-md hover:from-emerald-600 hover:to-teal-700
                  transition-all no-underline active:scale-95"
              >
                Sign Up
              </Link>
            </>
          )}

          {/* Mobile hamburger */}
          <button
            onClick={() => setMenuOpen((o) => !o)}
            className="lg:hidden flex items-center justify-center w-9 h-9 rounded-lg
              border border-slate-200 text-slate-600 hover:bg-slate-100 transition"
            aria-label="Toggle menu"
          >
            {menuOpen ? <XIcon /> : <MenuIcon />}
          </button>
        </div>
      </div>

      {/* ── Mobile menu ── */}
      {menuOpen && (
        <div className="lg:hidden border-t border-slate-100 bg-white px-4 py-3 space-y-1
          shadow-lg shadow-slate-200/50">

          {/* Nav links */}
          {visibleNavLinks(user, hasCase).map(({ label, to }) => (
            <Link
              key={label}
              to={to}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold no-underline transition
                ${isActive(to) ? "bg-emerald-50 text-emerald-700" : "text-slate-600 hover:bg-slate-100"}`}
            >
              {label}
            </Link>
          ))}

          <div className="border-t border-slate-100 pt-2 mt-2 space-y-1">
            {authResolving ? null : user ? (
              <>
                {/* User info chip */}
                <div className="flex items-center gap-3 px-4 py-2.5 bg-slate-50 rounded-xl mb-1">
                  <div className="w-9 h-9 rounded-full bg-linear-to-br from-[#1D9E75] to-teal-600
                    flex items-center justify-center text-sm font-extrabold text-white shrink-0">
                    {initials}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-slate-800 truncate">{displayName}</p>
                    <p className="text-xs text-slate-400 truncate">{emailShort}</p>
                  </div>
                </div>
                <MobileItem to="/dashboard/profile" icon={<UserIcon />} label="My Profile" />
                {hasCase && <MobileItem to="/dashboard/documents" icon={<DocsIcon />} label="My Documents" />}
                {["super_admin", "admin", "team_lead", "case_manager"].includes(user?.role) && (
                  <MobileItem to="/dashboard/document-review" icon={<DocsIcon />} label="Document Review" />
                )}
                <button
                  onClick={handleLogout}
                  className="w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm
                    font-semibold text-red-600 hover:bg-red-50 transition text-left mt-1"
                >
                  <span className="w-6 h-6 rounded-md bg-red-50 flex items-center justify-center shrink-0">
                    <LogoutIcon />
                  </span>
                  Sign Out
                </button>
              </>
            ) : (
              <div className="flex gap-2 pt-1">
                <Link to="/login"
                  className="flex-1 text-center text-sm font-semibold py-2.5 rounded-xl border
                    border-slate-300 text-slate-700 hover:bg-slate-50 transition no-underline">
                  Login
                </Link>
                <Link to="/signup"
                  className="flex-1 text-center text-sm font-bold py-2.5 rounded-xl
                    bg-linear-to-r from-[#1D9E75] to-teal-600 text-white
                    hover:from-emerald-600 hover:to-teal-700 transition no-underline">
                  Sign Up
                </Link>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Keyframe for dropdown animation */}
      <style>{`
        @keyframes fadeDown {
          from { opacity: 0; transform: translateY(-6px); }
          to   { opacity: 1; transform: translateY(0);    }
        }
      `}</style>
    </nav>
  );
}

/* ── Dropdown item ─────────────────────────────────────────────────────────── */
function DropItem({ to, icon, label, sub }) {
  const location = useLocation();
  const active   = location.pathname === to;
  return (
    <Link
      to={to}
      className={`flex items-center gap-3 px-4 py-2.5 text-sm transition-colors no-underline
        ${active ? "bg-emerald-50" : "hover:bg-slate-50"}`}
    >
      <span className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0
        ${active ? "bg-emerald-100 text-emerald-600" : "bg-slate-100 text-slate-500"}`}>
        {icon}
      </span>
      <div className="min-w-0">
        <p className={`font-semibold leading-tight ${active ? "text-emerald-700" : "text-slate-700"}`}>{label}</p>
        {sub && <p className="text-xs text-slate-400 truncate">{sub}</p>}
      </div>
    </Link>
  );
}

/* ── Mobile menu item ──────────────────────────────────────────────────────── */
function MobileItem({ to, icon, label }) {
  const location = useLocation();
  const active   = location.pathname === to;
  return (
    <Link
      to={to}
      className={`flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-semibold no-underline transition
        ${active ? "bg-emerald-50 text-emerald-700" : "text-slate-600 hover:bg-slate-100"}`}
    >
      <span className={`w-6 h-6 rounded-md flex items-center justify-center shrink-0
        ${active ? "bg-emerald-100 text-emerald-600" : "bg-slate-100 text-slate-500"}`}>
        {icon}
      </span>
      {label}
    </Link>
  );
}
