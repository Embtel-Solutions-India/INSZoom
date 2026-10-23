import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { isEmployeeAccount } from "../utils/auth";
import { useMyCase, useMyProfile } from "../hooks/useMyCaseProfile";
import { resolveDisplayVisa } from "../utils/visaDisplay";
import { resolveCaseStatusLabel } from "../utils/caseStatusLabel";
import ThemeToggle from "../components/ThemeToggle";
import BrandMark from "../components/BrandMark";
import EnablePushButton from "../components/EnablePushButton";
import { useBranding } from "../utils/branding";

const NAV_ITEMS = [
  { label: "Overview",   to: "/dashboard",           icon: OverviewIcon },
  { label: "Tasks",      to: "/dashboard/tasks",     icon: TasksIcon },
  { label: "Profile",    to: "/dashboard/profile",   icon: ProfileIcon },
  { label: "Documents",  to: "/dashboard/documents", icon: DocumentsIcon },
  { label: "Messages",   to: "/dashboard/messages",  icon: MessagesIcon },
  { label: "Latest USCIS Forms", to: "/dashboard/forms", icon: FormsIcon },
];

export default function PortalLayout() {
  const branding = useBranding();
  // Desktop-only hide/show of the sidebar (same as the Admin portal); remembered per browser.
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem("sidebarCollapsed") === "1"; } catch { return false; }
  });
  const toggleCollapsed = () => setCollapsed((prev) => {
    try { localStorage.setItem("sidebarCollapsed", prev ? "0" : "1"); } catch { /* the choice just is not remembered */ }
    return !prev;
  });
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();

  // Close the mobile drawer whenever the route changes.
  useEffect(() => { setMobileOpen(false); }, [location.pathname]);

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
    ? NAV_ITEMS.filter((item) => ["Overview", "Documents", "Profile", "Messages", "Latest USCIS Forms"].includes(item.label))
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

      {/* ── Sidebar (drawer below lg, static from lg up): the same design as the Admin portal ── */}
      <aside
        className={`fixed lg:sticky lg:top-0 inset-y-0 left-0 z-50 w-64 h-screen bg-sidebar text-sidebar-foreground border-r border-sidebar-border transform transition-[transform,margin] duration-300 ease-in-out flex flex-col shrink-0 ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        } ${collapsed ? "lg:-translate-x-full lg:-ml-64" : "lg:translate-x-0 lg:ml-0"}`}
      >
        <div className="flex items-center justify-between gap-3 px-5 py-5 border-b border-sidebar-border shrink-0">
          <Link to="/" className="flex items-center gap-3 min-w-0 no-underline">
            <BrandMark size="w-9 h-9" />
            <div className="min-w-0">
              <h1 className="text-sm font-bold text-sidebar-foreground leading-tight truncate">{branding.displayName}</h1>
              <p className="text-[10px] font-medium text-muted-foreground tracking-wide uppercase truncate">Client Portal</p>
            </div>
          </Link>
          <button type="button" onClick={() => setMobileOpen(false)} aria-label="Close navigation" className="lg:hidden text-muted-foreground hover:text-sidebar-foreground">
            <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        <nav className="flex-1 min-h-0 overflow-y-auto p-3 space-y-0.5 pb-4">
          {visibleNavItems.map(({ label, to, icon: Icon }) => (
            <NavLink
              key={label}
              to={to}
              end={to === "/dashboard"}
              className={({ isActive }) =>
                `relative w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm no-underline transition-colors duration-150 ${
                  isActive
                    ? "bg-primary/10 text-primary font-medium before:absolute before:left-0 before:top-1.5 before:bottom-1.5 before:w-0.5 before:rounded-full before:bg-primary"
                    : "text-sidebar-foreground/90 hover:bg-sidebar-accent hover:text-sidebar-foreground"
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <Icon className={`w-4 h-4 shrink-0 ${isActive ? "text-primary" : "text-muted-foreground"}`} />
                  <span className="truncate">{label}</span>
                </>
              )}
            </NavLink>
          ))}
        </nav>

        <div className="shrink-0 p-3 border-t border-sidebar-border">
          <button
            type="button"
            onClick={handleLogout}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground transition-colors duration-150"
          >
            <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
            <span>Logout</span>
          </button>
        </div>
      </aside>

      {/* ── Main column ── */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Top bar */}
        <header className="h-16 shrink-0 sticky top-0 z-30 border-b border-border bg-card flex items-center gap-2 sm:gap-3 px-3 sm:px-6">
          <button
            type="button"
            onClick={() => {
              if (window.matchMedia("(min-width: 1024px)").matches) toggleCollapsed();
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
      {/* Its floating button would sit on top of the Messages composer's Send button. */}
      {!location.pathname.startsWith("/dashboard/messages") && <EnablePushButton />}
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
function FormsIcon(props) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><path d="M14 2v6h6" /><path d="M8 13h8M8 17h8" /></svg>;
}
function DocumentsIcon(props) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}><path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>;
}
function MessagesIcon(props) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}><path d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" /></svg>;
}
