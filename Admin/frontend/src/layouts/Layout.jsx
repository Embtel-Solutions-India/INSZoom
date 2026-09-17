import { Outlet, useNavigate, useLocation } from 'react-router-dom'
import { useState, useRef, useEffect } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { useNotifications } from '../contexts/NotificationContext'
import { useTheme } from '../contexts/ThemeContext'
import { requestPermissionAndGetToken } from '../services/notificationService'
import BrandMark from '../components/BrandMark'
import {
  LayoutDashboard,
  Briefcase,
  Users,
  FileText,
  DollarSign,
  Scale,
  GraduationCap,
  Brain,
  MessageSquare,
  BarChart3,
  Settings,
  Bell,
  LogOut,
  Menu,
  X,
  ChevronDown,
  UserPlus,
  FileUp,
  XCircle,
  AlertOctagon,
  ArrowRight,
  CheckCircle,
  AlertTriangle,
  Search,
  RefreshCw,
  Moon,
  Sun
} from 'lucide-react'

const Layout = () => {
  const { user, logout, hasRole, getSidebarMenuItems } = useAuth()
  const { notifications, unreadCount, unreadMessageCount, fetchNotifications, markAsRead, markAllAsRead } = useNotifications()
  const { isDark, toggleTheme } = useTheme()
  const navigate = useNavigate()
  const location = useLocation()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const [searchValue, setSearchValue] = useState('')
  const [pushPermission, setPushPermission] = useState(
    typeof Notification !== 'undefined' ? Notification.permission : 'unsupported'
  )
  const [enablingPush, setEnablingPush] = useState(false)
  const notificationRef = useRef(null)

  // User-driven only — this button click is the ONLY place the browser's
  // permission prompt fires from; nothing here runs automatically on
  // mount/login (see notificationService.js's initializeNotifications,
  // which only silently re-registers an already-granted permission).
  const enablePush = async () => {
    setEnablingPush(true)
    try {
      await requestPermissionAndGetToken()
    } finally {
      setPushPermission(typeof Notification !== 'undefined' ? Notification.permission : 'unsupported')
      setEnablingPush(false)
    }
  }

  const snapshotDate = new Date().toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  })

  const handleSearchSubmit = (e) => {
    e.preventDefault()
    if (!searchValue.trim()) return
    navigate(`/crm-cases?q=${encodeURIComponent(searchValue.trim())}`)
  }

  const filteredMenuItems = getSidebarMenuItems()

  const handleLogout = async () => {
    await logout()
    navigate('/login')
  }

  const isActive = (path) => location.pathname === path || location.pathname.startsWith(path + '/')

  // Close the notifications dropdown when clicking outside of it
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (notificationRef.current && !notificationRef.current.contains(e.target)) {
        setNotificationsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const timeAgo = (date) => {
    const seconds = Math.floor((new Date() - new Date(date)) / 1000)
    if (seconds < 60) return 'just now'
    if (seconds < 3600) return Math.floor(seconds / 60) + 'm ago'
    if (seconds < 86400) return Math.floor(seconds / 3600) + 'h ago'
    if (seconds < 604800) return Math.floor(seconds / 86400) + 'd ago'
    return new Date(date).toLocaleDateString()
  }

  const NOTIFICATION_ICONS = {
    new_client_submission: { Icon: UserPlus, color: 'text-blue-500' },
    new_document_uploaded: { Icon: FileUp, color: 'text-blue-500' },
    payment_received: { Icon: DollarSign, color: 'text-green-500' },
    payment_overdue: { Icon: AlertTriangle, color: 'text-red-500' },
    ai_extraction_complete: { Icon: Brain, color: 'text-purple-500' },
    ai_qa_failed: { Icon: XCircle, color: 'text-red-500' },
    uscis_form_update: { Icon: FileText, color: 'text-amber-500' },
    expert_letter_signed: { Icon: CheckCircle, color: 'text-blue-500' },
    case_stage_changed: { Icon: ArrowRight, color: 'text-blue-500' },
    message_received: { Icon: MessageSquare, color: 'text-blue-500' },
    rfe_received: { Icon: AlertOctagon, color: 'text-red-600' }
  }

  const getNotificationIcon = (type) =>
    NOTIFICATION_ICONS[type] || { Icon: Bell, color: 'text-gray-400' }

  const handleNotificationClick = (notification) => {
    if (!notification.isRead) markAsRead(notification._id)
    if (notification.link) navigate(notification.link)
    setNotificationsOpen(false)
  }

  return (
    <div className="min-h-screen bg-background flex">
      {/* Mobile sidebar backdrop */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed lg:sticky lg:top-0 inset-y-0 left-0 z-50 w-64 h-screen bg-sidebar text-sidebar-foreground border-r border-sidebar-border transform transition-transform duration-300 ease-in-out flex flex-col shrink-0 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        }`}
      >
        <div className="flex items-center justify-between gap-3 px-5 py-5 border-b border-sidebar-border shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <BrandMark size="w-9 h-9" />
            <div className="min-w-0">
              <h1 className="text-sm font-bold text-sidebar-foreground leading-tight truncate">Immiglance</h1>
              <p className="text-[10px] font-medium text-muted-foreground tracking-wide uppercase truncate">Internal CRM</p>
            </div>
          </div>
          <button
            onClick={() => setSidebarOpen(false)}
            className="lg:hidden text-muted-foreground hover:text-sidebar-foreground"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <nav className="flex-1 min-h-0 overflow-y-auto p-3 space-y-0.5 pb-4">
          {filteredMenuItems.map((item) => {
            const Icon = item.icon
            const active = isActive(item.path)
            return (
              <button
                key={item.path}
                onClick={() => {
                  navigate(item.path)
                  setSidebarOpen(false)
                }}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-[0.925rem] transition-colors duration-150 ${
                  active
                    ? 'bg-sidebar-primary text-sidebar-primary-foreground font-semibold'
                    : 'text-sidebar-foreground/80 font-medium hover:bg-sidebar-accent hover:text-sidebar-foreground'
                }`}
              >
                <Icon className={`w-[1.1rem] h-[1.1rem] shrink-0 ${active ? 'text-sidebar-primary-foreground' : 'text-muted-foreground'}`} />
                <span className="truncate">{item.label}</span>
                {item.path === '/messages' && unreadMessageCount > 0 && (
                  <span className={`ml-auto min-w-[1.15rem] h-[1.15rem] px-1 flex items-center justify-center text-[10px] font-semibold rounded-full ${
                    active ? 'bg-sidebar-primary-foreground/20 text-sidebar-primary-foreground' : 'bg-sidebar-accent text-sidebar-accent-foreground'
                  }`}>
                    {unreadMessageCount > 99 ? '99+' : unreadMessageCount}
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

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0 bg-background">
        {/* Header */}
        <header className="sticky top-0 z-30 bg-card border-b border-border">
          <div className="flex items-center gap-4 px-6 py-3">
            <div className="flex items-center gap-3 shrink-0">
              <button
                onClick={() => setSidebarOpen(true)}
                className="lg:hidden text-muted-foreground hover:text-foreground"
              >
                <Menu className="w-6 h-6" />
              </button>
              <h2 className="text-base font-semibold text-foreground hidden md:block">
                {filteredMenuItems.find(item => isActive(item.path))?.label || 'Dashboard'}
              </h2>
              <span className="hidden md:inline-flex items-center gap-1.5 text-[11px] font-semibold text-secondary-foreground bg-secondary border border-border rounded-full px-2.5 py-1 capitalize">
                {user?.role?.replace('_', ' ')} Portal
              </span>
            </div>

            {/* Global search */}
            <form onSubmit={handleSearchSubmit} className="flex-1 max-w-md hidden sm:block">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <input
                  type="text"
                  value={searchValue}
                  onChange={(e) => setSearchValue(e.target.value)}
                  placeholder="Search cases, clients, companies…"
                  className="w-full pl-9 pr-3 py-2 text-sm bg-background border border-input text-foreground placeholder:text-muted-foreground rounded-md focus:ring-2 focus:ring-ring focus:border-ring outline-none transition-all"
                />
              </div>
            </form>

            <div className="flex items-center gap-3 ml-auto shrink-0">
              <span className="hidden lg:block text-xs text-muted-foreground font-mono">
                Snapshot · {snapshotDate}
              </span>
              <button
                onClick={() => window.location.reload()}
                className="hidden sm:flex items-center gap-1.5 bg-primary text-primary-foreground text-xs font-medium px-3 py-2 rounded-lg transition-colors"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Refresh
              </button>
              {/* Theme toggle - matches the reference portal's moon/sun switch */}
              <button
                onClick={toggleTheme}
                title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
                className="p-2 text-muted-foreground hover:text-foreground hover:bg-secondary rounded-lg transition-colors"
              >
                {isDark ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
              </button>
              {/* Notifications */}
              <div className="relative" ref={notificationRef}>
                <button
                  onClick={() => {
                    const nextOpen = !notificationsOpen
                    setNotificationsOpen(nextOpen)
                    if (nextOpen) fetchNotifications()
                  }}
                  className="relative p-2 text-muted-foreground hover:text-foreground hover:bg-secondary rounded-lg transition-colors"
                >
                  <Bell className="w-5 h-5" />
                  {unreadCount > 0 && (
                    <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] bg-destructive text-destructive-foreground text-[10px] font-bold rounded-full flex items-center justify-center px-1">
                      {unreadCount > 99 ? '99+' : unreadCount}
                    </span>
                  )}
                </button>

                {notificationsOpen && (
                  <div className="absolute right-0 mt-2 w-80 bg-popover rounded-lg shadow-none border border-border z-50">
                    {/* Header row */}
                    <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                      <h3 className="font-semibold text-popover-foreground">Notifications</h3>
                      {unreadCount > 0 && (
                        <button
                          onClick={() => markAllAsRead()}
                          className="text-xs font-medium text-primary hover:opacity-80"
                        >
                          Mark all read
                        </button>
                      )}
                    </div>

                    {pushPermission === 'default' && (
                      <div className="px-4 py-2.5 border-b border-border bg-accent flex items-center justify-between gap-3">
                        <p className="text-xs text-accent-foreground leading-snug">Get notified instantly, even when this tab isn't open.</p>
                        <button
                          onClick={enablePush}
                          disabled={enablingPush}
                          className="shrink-0 text-xs font-semibold text-primary-foreground bg-primary px-2.5 py-1 rounded-md disabled:opacity-60"
                        >
                          {enablingPush ? 'Enabling…' : 'Enable'}
                        </button>
                      </div>
                    )}

                    {/* Notification list */}
                    {notifications.length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-8">
                        <Bell className="w-8 h-8 text-muted-foreground/50" />
                        <p className="text-sm text-muted-foreground mt-2">No notifications yet</p>
                      </div>
                    ) : (
                      <>
                        <div className="max-h-[380px] overflow-y-auto">
                          {notifications.slice(0, 15).map((notification) => {
                            const { Icon, color } = getNotificationIcon(notification.type)
                            return (
                              <div
                                key={notification._id}
                                onClick={() => handleNotificationClick(notification)}
                                className={`flex items-start px-4 py-3 hover:bg-secondary cursor-pointer ${
                                  !notification.isRead ? 'border-l-2 border-primary bg-accent/40' : ''
                                }`}
                              >
                                <Icon className={`w-4 h-4 shrink-0 mt-0.5 ${color}`} />
                                <div className="flex-1 ml-3 min-w-0">
                                  <p className={`text-sm ${
                                    !notification.isRead ? 'font-medium text-popover-foreground' : 'text-muted-foreground'
                                  }`}>
                                    {notification.title}
                                  </p>
                                  <p className="text-xs text-muted-foreground truncate">
                                    {notification.message}
                                  </p>
                                  {notification.caseId && (
                                    <p className="text-xs text-primary font-mono">
                                      {notification.caseId.caseNumber} · {notification.caseId.clientName}
                                    </p>
                                  )}
                                  <p className="text-xs text-muted-foreground/70">
                                    {timeAgo(notification.createdAt)}
                                  </p>
                                </div>
                                {!notification.isRead && (
                                  <span className="w-2 h-2 bg-primary rounded-full shrink-0 mt-1.5 ml-2" />
                                )}
                              </div>
                            )
                          })}
                        </div>

                        {/* Footer */}
                        <div className="border-t border-border px-4 py-2">
                          <p className="text-xs text-muted-foreground text-center">
                            Showing latest 15 notifications
                          </p>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>

              {/* User menu */}
              <div className="flex items-center gap-3 pl-4 border-l border-border">
                <div className="text-right hidden sm:block">
                  <p className="text-sm font-medium text-foreground">{user?.name}</p>
                  <p className="text-xs text-muted-foreground capitalize">{user?.role?.replace('_', ' ')}</p>
                </div>
                <div className="w-9 h-9 bg-primary rounded-full flex items-center justify-center text-primary-foreground font-semibold text-sm">
                  {user?.name?.charAt(0) || 'U'}
                </div>
              </div>
            </div>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}

export default Layout
