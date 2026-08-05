import { Suspense, lazy } from 'react'
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './contexts/AuthContext'
import { NotificationProvider } from './contexts/NotificationContext'
import { SocketProvider } from './contexts/SocketContext'
import ErrorBoundary from './components/ErrorBoundary'
import ProtectedRoute from './components/ProtectedRoute'
import PageLoader from './components/PageLoader'
import Layout from './layouts/Layout'

const Login = lazy(() => import('./pages/Login'))
const Dashboard = lazy(() => import('./pages/Dashboard'))
const Leaderboard = lazy(() => import('./pages/Leaderboard'))
const StaffProfile = lazy(() => import('./pages/StaffProfile'))
const EODReports = lazy(() => import('./pages/EODReports'))
const Leads = lazy(() => import('./pages/Leads'))
const CRMCases = lazy(() => import('./pages/CRMCases'))
const CRMCaseDetail = lazy(() => import('./pages/CRMCaseDetail'))
const Messaging = lazy(() => import('./pages/Messaging'))
const PaymentsOverview = lazy(() => import('./pages/PaymentsOverview'))
const Settings = lazy(() => import('./pages/Settings'))
const Users = lazy(() => import('./pages/Users'))
const Companies = lazy(() => import('./pages/Companies'))
const Documents = lazy(() => import('./pages/Documents'))
const CreateUser = lazy(() => import('./pages/CreateUser'))
const EditUser = lazy(() => import('./pages/EditUser'))
const UserActivity = lazy(() => import('./pages/UserActivity'))
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

function App() {
  return (
    <ErrorBoundary>
    <Router>
      <AuthProvider>
        <SocketProvider>
        <NotificationProvider>
          <Suspense fallback={<PageLoader />}>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/" element={<Layout />}>
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
                path="documents"
                element={
                  <ProtectedRoute module="documents">
                    <Documents />
                  </ProtectedRoute>
                }
              />
              <Route
                path="documents/:caseId"
                element={
                  <ProtectedRoute module="documents">
                    <Documents />
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
              <Route 
                path="users" 
                element={
                  <ProtectedRoute module="users">
                    <Users />
                  </ProtectedRoute>
                } 
              />
              <Route 
                path="users/create" 
                element={
                  <ProtectedRoute module="users">
                    <CreateUser />
                  </ProtectedRoute>
                } 
              />
              <Route 
                path="users/:id/edit" 
                element={
                  <ProtectedRoute module="users">
                    <EditUser />
                  </ProtectedRoute>
                } 
              />
              <Route 
                path="users/:id/activity" 
                element={
                  <ProtectedRoute module="users">
                    <UserActivity />
                  </ProtectedRoute>
                } 
              />
              <Route 
                path="staff-profile/:userId" 
                element={
                  <ProtectedRoute module="users">
                    <StaffProfile />
                  </ProtectedRoute>
                } 
              />
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
            </Route>
          </Routes>
          </Suspense>
        </NotificationProvider>
        </SocketProvider>
      </AuthProvider>
    </Router>
    </ErrorBoundary>
  )
}

export default App
