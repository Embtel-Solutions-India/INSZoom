import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider } from './auth/AuthContext'
import { ThemeProvider } from './context/ThemeContext'
import RequireAttorney from './auth/RequireAttorney'
import LoginPage from './auth/LoginPage'
import SSOHandler from './auth/SSOHandler'
import AppLayout from './layout/AppLayout'
import Dashboard from './pages/Dashboard'
import CaseListPage from './pages/Cases/CaseListPage'
import CaseDetailLayout from './pages/Cases/CaseDetail/CaseDetailLayout'
import OverviewTab from './pages/Cases/CaseDetail/OverviewTab'
import DocumentsTab from './pages/Cases/CaseDetail/DocumentsTab'
import FormsTab from './pages/Cases/CaseDetail/FormsTab'
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

export default function App() {
  return (
    <BrowserRouter>
      <ThemeProvider>
        <AuthProvider>
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
                  <Route path="forms" element={<FormsTab />} />
                  <Route path="petition" element={<PetitionTab />} />
                  <Route path="tracking" element={<TrackingTab />} />
                  <Route path="feedback" element={<FeedbackTab />} />
                  <Route path="timeline" element={<TimelineTab />} />
                </Route>
              </Route>
            </Route>

            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  )
}
