import { useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { LayoutDashboard, Briefcase, MessageSquare, CheckCircle, Scale, LogOut, Menu, X, Moon, Sun } from 'lucide-react'
import { useAuth } from '../auth/AuthContext'
import { useTheme } from '../context/ThemeContext'
import NotificationBell from '../components/NotificationBell'
import useUnreadCounts from '../hooks/useUnreadCounts'

// Same sidebar/header shape as Admin/Immiglance's own Layout.jsx — same
// design tokens (src/index.css, copied verbatim), same component classes
// (.card/.btn-primary/.input-field), same fonts. This app is a peer of
// those two portals, not a differently-branded one.
const NAV = [
  { path: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { path: '/cases', label: 'My Cases', icon: Briefcase },
  { path: '/messages', label: 'Messages', icon: MessageSquare, unreadKey: 'messages' },
  { path: '/tasks', label: 'Tasks', icon: CheckCircle },
]

export default function AppLayout() {
  const { user, logout } = useAuth()
  const { isDark, toggleTheme } = useTheme()
  const navigate = useNavigate()
  const location = useLocation()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const unread = useUnreadCounts()

  const isActive = (path) => location.pathname === path || location.pathname.startsWith(`${path}/`)

  const handleLogout = async () => {
    await logout()
    navigate('/login', { replace: true })
  }

  return (
    <div className="min-h-screen bg-background flex">
      {sidebarOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-40 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      <aside
        className={`fixed lg:sticky lg:top-0 inset-y-0 left-0 z-50 w-64 h-screen bg-sidebar text-sidebar-foreground border-r border-sidebar-border transform transition-transform duration-300 ease-in-out flex flex-col shrink-0 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        }`}
      >
        <div className="flex items-center justify-between gap-3 px-5 py-5 border-b border-sidebar-border shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-lg bg-sidebar-primary flex items-center justify-center text-sidebar-primary-foreground shrink-0">
              <Scale className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h1 className="text-sm font-bold text-sidebar-foreground leading-tight truncate">Attorney Portal</h1>
              <p className="text-[10px] font-medium text-muted-foreground tracking-wide uppercase truncate">Immiglance</p>
            </div>
          </div>
          <button onClick={() => setSidebarOpen(false)} className="lg:hidden text-muted-foreground hover:text-sidebar-foreground">
            <X className="w-5 h-5" />
          </button>
        </div>

        <nav className="flex-1 min-h-0 overflow-y-auto p-3 space-y-0.5 pb-4">
          {NAV.map(({ path, label, icon: Icon, unreadKey }) => {
            const active = isActive(path)
            const count = unreadKey ? unread[unreadKey] : 0
            return (
              <button
                key={path}
                onClick={() => { navigate(path); setSidebarOpen(false) }}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-[0.925rem] transition-colors duration-150 ${
                  active
                    ? 'bg-sidebar-primary text-sidebar-primary-foreground font-semibold'
                    : 'text-sidebar-foreground/80 font-medium hover:bg-sidebar-accent hover:text-sidebar-foreground'
                }`}
              >
                <Icon className={`w-[1.1rem] h-[1.1rem] shrink-0 ${active ? 'text-sidebar-primary-foreground' : 'text-muted-foreground'}`} />
                <span className="truncate">{label}</span>
                {count > 0 && (
                  <span className={`ml-auto min-w-[1.15rem] h-[1.15rem] px-1 flex items-center justify-center text-[10px] font-semibold rounded-full ${
                    active ? 'bg-sidebar-primary-foreground/20 text-sidebar-primary-foreground' : 'bg-sidebar-accent text-sidebar-accent-foreground'
                  }`}>
                    {count > 99 ? '99+' : count}
                  </span>
                )}
              </button>
            )
          })}
        </nav>

        <div className="shrink-0 p-3 border-t border-sidebar-border">
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-sidebar-foreground/70 hover:bg-destructive/10 hover:text-destructive transition-colors duration-150"
          >
            <LogOut className="w-4 h-4" />
            <span>Logout</span>
          </button>
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0 bg-background">
        <header className="sticky top-0 z-30 bg-card border-b border-border">
          <div className="flex items-center gap-4 px-6 py-3">
            <div className="flex items-center gap-3 shrink-0">
              <button onClick={() => setSidebarOpen(true)} className="lg:hidden text-muted-foreground hover:text-foreground">
                <Menu className="w-6 h-6" />
              </button>
              <h2 className="text-base font-semibold text-foreground hidden md:block">
                {NAV.find((item) => isActive(item.path))?.label || 'Dashboard'}
              </h2>
              <span className="hidden md:inline-flex items-center gap-1.5 text-[11px] font-semibold text-secondary-foreground bg-secondary border border-border rounded-full px-2.5 py-1 capitalize">
                Attorney Portal
              </span>
            </div>

            <div className="flex items-center gap-3 ml-auto shrink-0">
              <button
                onClick={toggleTheme}
                title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
                className="p-2 text-muted-foreground hover:text-foreground hover:bg-secondary rounded-lg transition-colors"
              >
                {isDark ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
              </button>

              <NotificationBell />

              <div className="flex items-center gap-3 pl-4 border-l border-border">
                <div className="text-right hidden sm:block">
                  <p className="text-sm font-medium text-foreground">{user?.displayName || user?.name}</p>
                  <p className="text-xs text-muted-foreground">Attorney</p>
                </div>
                <div className="w-9 h-9 bg-primary rounded-full flex items-center justify-center text-primary-foreground font-semibold text-sm">
                  {(user?.displayName || user?.name || user?.email || 'A').charAt(0).toUpperCase()}
                </div>
              </div>
            </div>
          </div>
        </header>

        <main className="flex-1 overflow-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
