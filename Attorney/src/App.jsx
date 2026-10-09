import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { AuthProvider, useAuth } from './auth/AuthContext'
import { SocketProvider } from './context/SocketContext'
import { ThemeProvider } from './context/ThemeContext'
import ThemeSync from './context/ThemeSync'
import RequireAttorney from './auth/RequireAttorney'
import LoginPage from './auth/LoginPage'
import SSOHandler from './auth/SSOHandler'
import AppLayout from './layout/AppLayout'
import Dashboard from './pages/Dashboard'
import CaseListPage from './pages/Cases/CaseListPage'
import CaseDetailLayout from './pages/Cases/CaseDetail/CaseDetailLayout'
import OverviewTab from './pages/Cases/CaseDetail/OverviewTab'
import DocumentsTab from './pages/Cases/CaseDetail/DocumentsTab'
import ChecklistsTab from './pages/Cases/CaseDetail/ChecklistsTab'
import PetitionTab from './pages/Cases/CaseDetail/PetitionTab'
import TrackingTab from './pages/Cases/CaseDetail/TrackingTab'
import FeedbackTab from './pages/Cases/CaseDetail/FeedbackTab'
import TimelineTab from './pages/Cases/CaseDetail/TimelineTab'
import MessagesPage from './pages/Messages/MessagesPage'
import MessageThreadPage from './pages/Messages/MessageThreadPage'
import TasksPage from './pages/Tasks/TasksPage'
import usePushNotifications from './hooks/usePushNotifications'

function PushRegistrar() {
  usePushNotifications()
  return null
}

// BUG (fixed): "/" and the "*" catch-all used to unconditionally
// <Navigate to="/dashboard" replace /> before AuthContext's own silent-
// refresh check (authApi.me(), which resolves the 7-day refresh cookie)
// had finished - so opening the app unauthenticated visibly hit
// "/dashboard" first, then got bounced to "/login" by RequireAttorney a
// moment later. This is the actual decision point: wait for the same
// `loading` flag RequireAttorney already gates on, then go straight to the
// right place once - authenticated -> /dashboard, not authenticated ->
// /login. No intermediate hop through /dashboard ever happens now.
function EntryRedirect() {
  const { user, loading } = useAuth()
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    )
  }
  return <Navigate to={user?.role === 'attorney' ? '/dashboard' : '/login'} replace />
}

export default function App() {
  return (
    <BrowserRouter>
      <ThemeProvider>
        <AuthProvider>
        <ThemeSync />
        <SocketProvider>
          <PushRegistrar />
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/auth/sso" element={<SSOHandler />} />

            <Route element={<RequireAttorney />}>
              <Route element={<AppLayout />}>
                <Route path="/dashboard" element={<Dashboard />} />
                <Route path="/cases" element={<CaseListPage />} />
                {/* Messages is top-level only — never nested under a case's
                    own tab navigation (see MessageThreadPage's header comment). */}
                <Route path="/messages" element={<MessagesPage />} />
                <Route path="/messages/:caseId" element={<MessageThreadPage />} />
                <Route path="/tasks" element={<TasksPage />} />
                <Route path="/cases/:caseId" element={<CaseDetailLayout />}>
                  <Route index element={<Navigate to="overview" replace />} />
                  <Route path="overview" element={<OverviewTab />} />
                  <Route path="documents" element={<DocumentsTab />} />
                  <Route path="checklists" element={<ChecklistsTab />} />
                  <Route path="petition" element={<PetitionTab />} />
                  <Route path="tracking" element={<TrackingTab />} />
                  <Route path="feedback" element={<FeedbackTab />} />
                  <Route path="timeline" element={<TimelineTab />} />
                </Route>
              </Route>
            </Route>

            <Route path="/" element={<EntryRedirect />} />
            <Route path="*" element={<EntryRedirect />} />
          </Routes>
        </SocketProvider>
        </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  )
}
