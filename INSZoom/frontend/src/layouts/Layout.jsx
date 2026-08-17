import { Outlet, useNavigate, useLocation } from 'react-router-dom'
import { useState, useRef, useEffect } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { useNotifications } from '../contexts/NotificationContext'
import { requestPermissionAndGetToken } from '../services/notificationService'
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
  RefreshCw
} from 'lucide-react'

const Layout = () => {
  const { user, logout, hasRole, getSidebarMenuItems } = useAuth()
  const { notifications, unreadCount, unreadMessageCount, fetchNotifications, markAsRead, markAllAsRead } = useNotifications()
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
    <div className="min-h-screen bg-gray-100 flex">
      {/* Mobile sidebar backdrop */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed lg:sticky lg:top-0 inset-y-0 left-0 z-50 w-64 h-screen bg-white text-gray-700 border-r border-gray-200 transform transition-transform duration-300 ease-in-out flex flex-col shrink-0 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        }`}
      >
        <div className="flex items-center justify-between gap-3 px-5 py-5 border-b border-gray-100 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-lg bg-navy-800 flex items-center justify-center text-white font-bold text-sm shrink-0">
              I
            </div>
            <div className="min-w-0">
              <h1 className="text-sm font-bold text-gray-900 leading-tight truncate">Immigratia</h1>
              <p className="text-[10px] font-medium text-gray-400 tracking-wide uppercase truncate">Internal CRM</p>
            </div>
          </div>
          <button
            onClick={() => setSidebarOpen(false)}
            className="lg:hidden text-gray-400 hover:text-gray-700"
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
                    ? 'bg-primary-50 text-primary-700 font-semibold'
                    : 'text-gray-600 font-medium hover:bg-gray-50 hover:text-gray-900'
                }`}
              >
                <Icon className={`w-[1.1rem] h-[1.1rem] shrink-0 ${active ? 'text-primary-600' : 'text-gray-400'}`} />
                <span className="truncate">{item.label}</span>
                {item.path === '/messages' && unreadMessageCount > 0 && (
                  <span className={`ml-auto min-w-[1.15rem] h-[1.15rem] px-1 flex items-center justify-center text-[10px] font-semibold rounded-full ${
                    active ? 'bg-primary-600 text-white' : 'bg-gray-200 text-gray-700'
                  }`}>
                    {unreadMessageCount > 99 ? '99+' : unreadMessageCount}
                  </span>
                )}
              </button>
            )
          })}
        </nav>

        <div className="shrink-0 p-3 border-t border-gray-100">
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-gray-500 hover:bg-red-50 hover:text-red-600 transition-colors duration-150"
          >
            <LogOut className="w-4 h-4" />
            <span>Logout</span>
          </button>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0 bg-gray-100">
        {/* Header */}
        <header className="sticky top-0 z-30 bg-white border-b border-gray-200">
          <div className="flex items-center gap-4 px-6 py-3">
            <div className="flex items-center gap-3 shrink-0">
              <button
                onClick={() => setSidebarOpen(true)}
                className="lg:hidden text-gray-600 hover:text-gray-900"
              >
                <Menu className="w-6 h-6" />
              </button>
              <h2 className="text-base font-semibold text-gray-900 hidden md:block">
                {filteredMenuItems.find(item => isActive(item.path))?.label || 'Dashboard'}
              </h2>
            </div>

            {/* Global search */}
            <form onSubmit={handleSearchSubmit} className="flex-1 max-w-md hidden sm:block">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="text"
                  value={searchValue}
                  onChange={(e) => setSearchValue(e.target.value)}
                  placeholder="Search cases, clients, companies…"
                  className="w-full pl-9 pr-3 py-2 text-sm bg-gray-50 border border-gray-200 text-gray-900 rounded-lg focus:ring-2 focus:ring-primary-500/40 focus:border-primary-500 outline-none transition-all"
                />
              </div>
            </form>

            <div className="flex items-center gap-3 ml-auto shrink-0">
              <span className="hidden lg:block text-xs text-gray-400">
                Snapshot · {snapshotDate}
              </span>
              <button
                onClick={() => window.location.reload()}
                className="hidden sm:flex items-center gap-1.5 bg-primary-600 text-white text-xs font-medium px-3 py-2 rounded-lg hover:bg-primary-700 transition-colors"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Refresh
              </button>
              {/* Notifications */}
              <div className="relative" ref={notificationRef}>
                <button
                  onClick={() => {
                    const nextOpen = !notificationsOpen
                    setNotificationsOpen(nextOpen)
                    if (nextOpen) fetchNotifications()
                  }}
                  className="relative p-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  <Bell className="w-5 h-5" />
                  {unreadCount > 0 && (
                    <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center px-1">
                      {unreadCount > 99 ? '99+' : unreadCount}
                    </span>
                  )}
                </button>

                {notificationsOpen && (
                  <div className="absolute right-0 mt-2 w-80 bg-white rounded-lg shadow-lg border border-gray-200 z-50">
                    {/* Header row */}
                    <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
                      <h3 className="font-semibold text-gray-900">Notifications</h3>
                      {unreadCount > 0 && (
                        <button
                          onClick={() => markAllAsRead()}
                          className="text-xs font-medium text-primary-600 hover:text-primary-700"
                        >
                          Mark all read
                        </button>
                      )}
                    </div>

                    {pushPermission === 'default' && (
                      <div className="px-4 py-2.5 border-b border-gray-200 bg-primary-50/60 flex items-center justify-between gap-3">
                        <p className="text-xs text-gray-600 leading-snug">Get notified instantly, even when this tab isn't open.</p>
                        <button
                          onClick={enablePush}
                          disabled={enablingPush}
                          className="shrink-0 text-xs font-semibold text-white bg-primary-600 hover:bg-primary-700 px-2.5 py-1 rounded-md disabled:opacity-60"
                        >
                          {enablingPush ? 'Enabling…' : 'Enable'}
                        </button>
                      </div>
                    )}

                    {/* Notification list */}
                    {notifications.length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-8">
                        <Bell className="w-8 h-8 text-gray-300" />
                        <p className="text-sm text-gray-500 mt-2">No notifications yet</p>
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
                                className={`flex items-start px-4 py-3 hover:bg-gray-50 cursor-pointer ${
                                  !notification.isRead ? 'border-l-2 border-gray-400 bg-primary-50/30' : ''
                                }`}
                              >
                                <Icon className={`w-4 h-4 shrink-0 mt-0.5 ${color}`} />
                                <div className="flex-1 ml-3 min-w-0">
                                  <p className={`text-sm ${
                                    !notification.isRead ? 'font-medium text-gray-900' : 'text-gray-600'
                                  }`}>
                                    {notification.title}
                                  </p>
                                  <p className="text-xs text-gray-500 truncate">
                                    {notification.message}
                                  </p>
                                  {notification.caseId && (
                                    <p className="text-xs text-primary-600">
                                      {notification.caseId.caseNumber} · {notification.caseId.clientName}
                                    </p>
                                  )}
                                  <p className="text-xs text-gray-400">
                                    {timeAgo(notification.createdAt)}
                                  </p>
                                </div>
                                {!notification.isRead && (
                                  <span className="w-2 h-2 bg-gray-500 rounded-full shrink-0 mt-1.5 ml-2" />
                                )}
                              </div>
                            )
                          })}
                        </div>

                        {/* Footer */}
                        <div className="border-t border-gray-200 px-4 py-2">
                          <p className="text-xs text-gray-400 text-center">
                            Showing latest 15 notifications
                          </p>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>

              {/* User menu */}
              <div className="flex items-center gap-3 pl-4 border-l border-gray-200">
                <div className="text-right hidden sm:block">
                  <p className="text-sm font-medium text-gray-900">{user?.name}</p>
                  <p className="text-xs text-gray-600 capitalize">{user?.role?.replace('_', ' ')}</p>
                </div>
                <div className="w-9 h-9 bg-navy-800 rounded-full flex items-center justify-center text-white font-semibold text-sm">
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
