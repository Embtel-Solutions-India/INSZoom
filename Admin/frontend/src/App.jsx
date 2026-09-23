import { Suspense, lazy } from 'react'
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './contexts/AuthContext'
import { NotificationProvider } from './contexts/NotificationContext'
import { SocketProvider } from './contexts/SocketContext'
import { ThemeProvider } from './contexts/ThemeContext'
import ErrorBoundary from './components/ErrorBoundary'
import ProtectedRoute from './components/ProtectedRoute'
import PageLoader from './components/PageLoader'
import Layout from './layouts/Layout'

const Login = lazy(() => import('./pages/Login'))
const SSOHandler = lazy(() => import('./pages/SSOHandler'))
const Dashboard = lazy(() => import('./pages/Dashboard'))
const Leaderboard = lazy(() => import('./pages/Leaderboard'))
const EODReports = lazy(() => import('./pages/EODReports'))
const Leads = lazy(() => import('./pages/Leads'))
const CRMCases = lazy(() => import('./pages/CRMCases'))
const CRMCaseDetail = lazy(() => import('./pages/CRMCaseDetail'))
const Messaging = lazy(() => import('./pages/Messaging'))
const PaymentsOverview = lazy(() => import('./pages/PaymentsOverview'))
const Settings = lazy(() => import('./pages/Settings'))
const Companies = lazy(() => import('./pages/Companies'))
const Analytics = lazy(() => import('./pages/Analytics'))
const USCISForms = lazy(() => import('./pages/USCISForms'))
const CaseManagers = lazy(() => import('./pages/CaseManagers'))
const CaseManagerDetails = lazy(() => import('./pages/CaseManagerDetails'))
const TaskDashboard = lazy(() => import('./pages/TaskDashboard'))
const MyTasks = lazy(() => import('./pages/MyTasks'))
const TeamTasks = lazy(() => import('./pages/TeamTasks'))
const TaskDetails = lazy(() => import('./pages/TaskDetails'))
const TaskCalendar = lazy(() => import('./pages/TaskCalendar'))
const QuestionnaireTemplates = lazy(() => import('./pages/QuestionnaireTemplates'))
const Teams = lazy(() => import('./pages/Teams'))

function App() {
  return (
    <ErrorBoundary>
    <ThemeProvider>
    <Router>
      <AuthProvider>
        <SocketProvider>
        <NotificationProvider>
          <Suspense fallback={<PageLoader />}>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/auth/sso" element={<SSOHandler />} />
            {/* Layout (sidebar/header shell) must never mount before auth
                resolves - it's the dashboard "chrome" itself, and used to sit
                outside any auth check, so it rendered immediately on "/"
                while AuthContext's session check was still pending, then
                ProtectedRoute (only applied per-child-route below) redirected
                to /login a moment later - a visible dashboard-then-login
                flash. Wrapping Layout in the same ProtectedRoute used
                everywhere else (module omitted, so only the
                loading/authenticated check applies) mirrors how
                Attorney/RequireAttorney and Immiglance Client/AuthGate both
                already gate their own layout component, and blocks the
                Outlet's children from rendering at all until auth is known. */}
            <Route
              path="/"
              element={
                <ProtectedRoute>
                  <Layout />
                </ProtectedRoute>
              }
            >
              <Route index element={<Navigate to="/dashboard" replace />} />
              <Route 
                path="dashboard" 
                element={
                  <ProtectedRoute module="dashboard">
                    <Dashboard />
                  </ProtectedRoute>
                } 
              />
              <Route
                path="leads"
                element={
                  <ProtectedRoute module="leads">
                    <Leads />
                  </ProtectedRoute>
                }
              />
              <Route
                path="crm-cases"
                element={
                  <ProtectedRoute module="cases">
                    <CRMCases />
                  </ProtectedRoute>
                }
              />
              <Route 
                path="crm-cases/:id" 
                element={
                  <ProtectedRoute module="cases">
                    <CRMCaseDetail />
                  </ProtectedRoute>
                } 
              />
              <Route
                path="messages"
                element={
                  <ProtectedRoute module="messaging">
                    <Messaging />
                  </ProtectedRoute>
                }
              />
              <Route
                path="messages/:caseId"
                element={
                  <ProtectedRoute module="messaging">
                    <Messaging />
                  </ProtectedRoute>
                }
              />
              <Route
                path="messages/user/:userId"
                element={
                  <ProtectedRoute module="messaging">
                    <Messaging />
                  </ProtectedRoute>
                }
              />
              <Route
                path="companies"
                element={
                  <ProtectedRoute module="companies">
                    <Companies />
                  </ProtectedRoute>
                }
              />
              <Route
                path="leaderboard"
                element={
                  <ProtectedRoute module="reports">
                    <Leaderboard />
                  </ProtectedRoute>
                } 
              />
              <Route
                path="analytics"
                element={
                  <ProtectedRoute module="reports">
                    <Analytics />
                  </ProtectedRoute>
                }
              />
              <Route
                path="uscis-forms"
                element={
                  <ProtectedRoute module="cases">
                    <USCISForms />
                  </ProtectedRoute>
                }
              />
              <Route
                path="case-managers"
                element={
                  <ProtectedRoute module="case-managers">
                    <CaseManagers />
                  </ProtectedRoute>
                }
              />
              <Route
                path="case-managers/:id"
                element={
                  <ProtectedRoute module="case-managers">
                    <CaseManagerDetails />
                  </ProtectedRoute>
                }
              />
              <Route 
                path="eod-reports" 
                element={
                  <ProtectedRoute module="reports">
                    <EODReports />
                  </ProtectedRoute>
                } 
              />
              <Route 
                path="payments" 
                element={
                  <ProtectedRoute module="payments">
                    <PaymentsOverview />
                  </ProtectedRoute>
                } 
              />
              <Route path="users/*" element={<Navigate to="/dashboard" replace />} />
              <Route path="staff-profile/:userId" element={<Navigate to="/dashboard" replace />} />
              <Route 
                path="settings" 
                element={
                  <ProtectedRoute module="settings">
                    <Settings />
                  </ProtectedRoute>
                } 
              />
              <Route
                path="questionnaires"
                element={
                  <ProtectedRoute module="questionnaires">
                    <QuestionnaireTemplates />
                  </ProtectedRoute>
                }
              />
              <Route
                path="tasks"
                element={
                  <ProtectedRoute module="dashboard">
                    <TaskDashboard />
                  </ProtectedRoute>
                }
              />
              <Route
                path="tasks/my-tasks"
                element={
                  <ProtectedRoute module="dashboard">
                    <MyTasks />
                  </ProtectedRoute>
                }
              />
              <Route
                path="tasks/all"
                element={
                  <ProtectedRoute module="dashboard">
                    <MyTasks mode="all" />
                  </ProtectedRoute>
                }
              />
              <Route
                path="tasks/team-tasks"
                element={
                  <ProtectedRoute module="dashboard">
                    <TeamTasks />
                  </ProtectedRoute>
                }
              />
              <Route
                path="tasks/calendar"
                element={
                  <ProtectedRoute module="dashboard">
                    <TaskCalendar />
                  </ProtectedRoute>
                }
              />
              <Route
                path="tasks/create"
                element={
                  <ProtectedRoute module="dashboard">
                    <TaskDetails />
                  </ProtectedRoute>
                }
              />
              <Route
                path="tasks/:id"
                element={
                  <ProtectedRoute module="dashboard">
                    <TaskDetails />
                  </ProtectedRoute>
                }
              />
              <Route
                path="teams"
                element={
                  <ProtectedRoute module="teams" requiredRoles={['super_admin', 'admin', 'team_lead']}>
                    <Teams />
                  </ProtectedRoute>
                }
              />
            </Route>
          </Routes>
          </Suspense>
        </NotificationProvider>
        </SocketProvider>
      </AuthProvider>
    </Router>
    </ThemeProvider>
    </ErrorBoundary>
  )
}

export default App
