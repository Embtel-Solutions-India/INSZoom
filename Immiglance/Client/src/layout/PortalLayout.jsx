import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { isEmployeeAccount } from "../utils/auth";
import { useMyCase, useMyProfile } from "../hooks/useMyCaseProfile";
import { resolveDisplayVisa } from "../utils/visaDisplay";
import { resolveCaseStatusLabel } from "../utils/caseStatusLabel";
import ThemeToggle from "../components/ThemeToggle";

const NAV_ITEMS = [
  { label: "Overview",   to: "/dashboard",           icon: OverviewIcon },
  { label: "Tasks",      to: "/dashboard/tasks",     icon: TasksIcon },
  { label: "Profile",    to: "/dashboard/profile",   icon: ProfileIcon },
  { label: "Documents",  to: "/dashboard/documents", icon: DocumentsIcon },
  { label: "Messages",   to: "/dashboard/messages",  icon: MessagesIcon },
];

export default function PortalLayout() {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();

  // Close the mobile drawer whenever the route changes.
  useEffect(() => { setMobileOpen(false); }, [location.pathname]);

  // On mobile the drawer is always full-width labels; "collapsed" only applies from lg up.
  const slim = collapsed;
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const { data: rawCase } = useMyCase();
  const { data: profileData = {} } = useMyProfile();
  const caseData = rawCase?.case || rawCase?.data?.case || rawCase;

  const displayName = profileData.firstName
    ? `${profileData.firstName}${profileData.lastName ? " " + profileData.lastName : ""}`
    : user?.displayName || user?.email?.split("@")[0] || "Client";

  const visaLabel = resolveDisplayVisa(caseData || {}) || caseData?.visaCategory || "Case";
  const caseRef = caseData?.caseId || caseData?._id?.slice?.(-8)?.toUpperCase() || "—";
  const isEmployee = isEmployeeAccount(user);

  const visibleNavItems = isEmployee
    ? NAV_ITEMS.filter((item) => ["Overview", "Documents", "Profile", "Messages"].includes(item.label))
    : NAV_ITEMS;

  const handleLogout = async () => {
    await logout();
    navigate("/login");
  };

  return (
    <div className="min-h-screen flex bg-background">
      {mobileOpen && (
        <div className="fixed inset-0 bg-black/50 z-40 lg:hidden" onClick={() => setMobileOpen(false)} />
      )}

      {/* ── Sidebar (drawer below lg, static from lg up) ── */}
      <aside
        className={`fixed lg:sticky lg:top-0 inset-y-0 left-0 z-50 h-screen w-64 ${slim ? "lg:w-16" : "lg:w-64"}
          shrink-0 border-r border-sidebar-border bg-sidebar transform transition-all duration-200 flex flex-col
          ${mobileOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"}`}
      >
        <div className="h-16 flex items-center gap-2.5 px-4 border-b border-sidebar-border">
          <Link to="/" className="flex items-center gap-2.5 no-underline min-w-0">
            <div className="w-8 h-8 rounded-full bg-sidebar-primary flex items-center justify-center shrink-0">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-sidebar-primary-foreground">
                <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" />
                <polyline points="16 7 22 7 22 13" />
              </svg>
            </div>
            <span className={`font-bold text-sidebar-foreground truncate ${slim ? "lg:hidden" : ""}`}>Immiglance</span>
          </Link>
        </div>

        <p className={`px-4 pt-5 pb-2 text-[0.68rem] font-bold uppercase tracking-widest text-muted-foreground ${slim ? "lg:hidden" : ""}`}>
          Case Portal
        </p>

        <nav className="flex-1 px-2.5 py-2 space-y-1 overflow-y-auto">
          {visibleNavItems.map(({ label, to, icon: Icon }) => (
            <NavLink
              key={label}
              to={to}
              end={to === "/dashboard"}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-semibold no-underline transition-colors
                ${isActive ? "bg-sidebar-primary text-sidebar-primary-foreground" : "text-sidebar-foreground hover:bg-sidebar-accent"}`
              }
              title={slim ? label : undefined}
            >
              <Icon className="w-[18px] h-[18px] shrink-0" />
              <span className={`truncate ${slim ? "lg:hidden" : ""}`}>{label}</span>
            </NavLink>
          ))}
        </nav>
      </aside>

      {/* ── Main column ── */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Top bar */}
        <header className="h-16 shrink-0 sticky top-0 z-30 border-b border-border bg-card flex items-center gap-2 sm:gap-3 px-3 sm:px-6">
          <button
            type="button"
            onClick={() => {
              if (window.matchMedia("(min-width: 1024px)").matches) setCollapsed((c) => !c);
              else setMobileOpen((o) => !o);
            }}
            aria-label="Toggle navigation"
            className="w-9 h-9 flex items-center justify-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors shrink-0"
          >
            <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
              <path d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>

          <div className="min-w-0 flex-1 sm:flex-none">
            <p className="mono text-sm font-bold text-foreground truncate">{caseRef}</p>
            <p className="text-xs text-muted-foreground truncate">{visaLabel} — {displayName}</p>
          </div>

          <div className="sm:ml-auto flex items-center gap-1 sm:gap-2 shrink-0">
            <span className="hidden sm:inline-block px-3 py-1.5 rounded-full bg-secondary text-xs font-bold text-foreground">
              {resolveCaseStatusLabel(caseData)}
            </span>
            <ThemeToggle />
            <button
              type="button"
              onClick={handleLogout}
              aria-label="Log out"
              className="w-9 h-9 flex items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
            >
              <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
                <path d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
            </button>
          </div>
        </header>

        <main className="flex-1 min-w-0 overflow-x-hidden">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

/* ── Sidebar icons ── */
function OverviewIcon(props) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></svg>;
}
function TasksIcon(props) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}><path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" /></svg>;
}
function ProfileIcon(props) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}><path d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>;
}
function DocumentsIcon(props) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}><path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>;
}
function MessagesIcon(props) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}><path d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" /></svg>;
}
