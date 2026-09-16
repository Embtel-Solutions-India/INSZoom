import { Suspense, lazy } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import MainLayout from "./layout/MainLayout";
import PortalLayout from "./layout/PortalLayout";
import AuthGate from "./components/AuthGate";
import BlockIfHasCase from "./components/eligibility/BlockIfHasCase";
import PageLoader from "./components/PageLoader";

const Home = lazy(() => import("./Pages/Dashboard/Home"));
const Dashboard = lazy(() => import("./Pages/Dashboard/Dashboard"));
const Profile = lazy(() => import("./Pages/Dashboard/Profile"));
const Documents = lazy(() => import("./Pages/Dashboard/Documents"));
const Payments = lazy(() => import("./Pages/Dashboard/Payments"));
const DocumentReview = lazy(() => import("./Pages/Dashboard/DocumentReview"));
const Intake = lazy(() => import("./Pages/Dashboard/Intake"));
const FilingTypeSelection = lazy(() => import("./Pages/Dashboard/FilingTypeSelection"));
const PlanSelection = lazy(() => import("./Pages/Dashboard/PlanSelection"));
const Messages = lazy(() => import("./Pages/Dashboard/Messages"));
const QuickBooks = lazy(() => import("./Pages/Dashboard/QuickBooks"));
const FedEx = lazy(() => import("./Pages/Dashboard/FedEx"));
const Login = lazy(() => import("./Pages/Auth/Login"));
const Register = lazy(() => import("./Pages/Auth/Register"));
const PaymentSuccess = lazy(() => import("./Pages/Dashboard/PaymentSuccess"));
const PaymentCancel = lazy(() => import("./Pages/Dashboard/PaymentCancel"));
const OAuthCallback = lazy(() => import("./Pages/Auth/OAuthCallback"));
const AcceptInvite = lazy(() => import("./Pages/Auth/AcceptInvite"));
const ForgotPassword = lazy(() => import("./Pages/Auth/ForgotPassword"));
const ResetPassword = lazy(() => import("./Pages/Auth/ResetPassword"));
const AdminLogin = lazy(() => import("./Pages/Admin/AdminLogin"));
const AdminPortal = lazy(() => import("./Pages/Admin/AdminPortal"));
const EligibilityQuiz = lazy(() => import("./Pages/Eligibility/EligibilityQuiz"));
const BookConsultation = lazy(() => import("./Pages/Consultation/BookConsultation"));
const ManageBooking = lazy(() => import("./Pages/Consultation/ManageBooking"));
const LegacyHolding = lazy(() => import("./Pages/Auth/LegacyHolding"));

export default function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={<PageLoader />}>
      <Routes>

        {/* Layout wrapper */}
        <Route element={<MainLayout />}>
          <Route path="/" element={<Home />} />
        </Route>

        {/* /eligibility used to be a separate category/visa picker page
            (shown with the navbar) before the quiz itself. That picker is
            now the first two steps of the single continuous quiz below —
            redirect old links/bookmarks straight there. */}
        <Route path="/eligibility" element={<Navigate to="/eligibility/quiz" replace />} />

        {/* Client portal — themed sidebar + top-bar shell (PortalLayout)
            instead of the marketing Navbar. PHASE 3: routing based on auth +
            case status is still decided exclusively by AuthGate
            (src/components/AuthGate.jsx), which calls
            GET /api/auth/session-context. It supersedes both ProtectedRoute
            (auth check) and BlockEmployeeRoute (confines an invited employee
            to /dashboard/documents) for every route listed here — AuthGate
            itself redirects an employee-role session to
            /dashboard/documents, so nesting BlockEmployeeRoute on top would
            be redundant. ProtectedRoute/BlockEmployeeRoute are left defined
            in components/ProtectedRoute.jsx (not removed as files) but are
            no longer used in this route tree. */}
        <Route element={<AuthGate />}>
          <Route element={<PortalLayout />}>
            <Route path="/dashboard"           element={<Dashboard />} />
            <Route path="/dashboard/profile"   element={<Profile />} />
            <Route path="/dashboard/messages"  element={<Messages />} />
            <Route path="/dashboard/plan"      element={<PlanSelection />} />
            <Route path="/dashboard/filing-type" element={<FilingTypeSelection />} />
            <Route path="/dashboard/payments" element={<Payments />} />
            <Route path="/dashboard/payments/success" element={<PaymentSuccess />} />
            <Route path="/dashboard/payments/cancel" element={<PaymentCancel />} />
            <Route path="/dashboard/quickbooks" element={<QuickBooks />} />
            <Route path="/dashboard/fedex" element={<FedEx />} />

            <Route path="/dashboard/documents" element={<Documents />} />
            {/* Optional caseId — lets an employer account open one specific
                sponsored case's checklist, or an employee account open its
                own. Absent for every other account type/flow, which keeps
                using useMyCase() exactly as before. */}
            <Route path="/dashboard/documents/:caseId" element={<Documents />} />
            <Route path="/dashboard/document-review" element={<DocumentReview />} />
          </Route>
        </Route>

        {/* Standalone, no MainLayout/navbar — still requires login and
            case-status routing, both now owned by AuthGate (see above). */}
        <Route element={<AuthGate />}>
          <Route path="/onboarding/intake" element={<Intake />} />
        </Route>
        {/* Legacy URL — Register.jsx (brand-new signup) and Offers.jsx (a
            "continue" CTA) still navigate here directly by habit/comment
            ("can't have a case yet"). Forwards to the one canonical,
            AuthGate-aware intake route above rather than duplicating
            <Intake/> under two paths with two different routing checks. */}
        <Route path="/dashboard/intake" element={<Navigate to="/onboarding/intake" replace />} />

        {/* Public — reachable even for an unauthenticated or errored
            session, per Phase 3 Part E. Deliberately outside AuthGate. */}
        <Route path="/legacy-holding" element={<LegacyHolding />} />

        {/* Standalone, no MainLayout/navbar — the quiz is a full-screen
            questionnaire flow, same reasoning as /onboarding/intake above.
            BlockIfHasCase has no auth dependency of its own (unlike
            AuthGate), so it's reused here exactly as it was inside
            MainLayout — just outside the layout wrapper now. */}
        <Route element={<BlockIfHasCase />}>
          <Route path="/eligibility/quiz" element={<EligibilityQuiz />} />
        </Route>
        {/* Consultation booking previously lived under MainLayout (navbar +
            its own EligibilityShell stacked). It immediately follows a
            completed quiz (no results screen in between — see
            EligibilityQuiz.jsx) and is also linked to from the logged-in
            intake flow (Intake.jsx, as /consultation/book?leadId=...), so —
            unlike the quiz above — it's deliberately left unguarded by
            BlockIfHasCase, exactly as before; only the navbar is removed.
            ManageBooking is reached via an emailed token link independent of
            login state and was already unguarded. */}
        <Route path="/consultation/book/:leadId?" element={<BookConsultation />} />
        <Route path="/consultation/booking/:token" element={<ManageBooking />} />

        {/* Auth pages WITHOUT navbar */}
        <Route path="/login"          element={<Login />} />
        <Route path="/signup"         element={<Register />} />
        <Route path="/accept-invite"  element={<AcceptInvite />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password"  element={<ResetPassword />} />
        <Route path="/auth/callback"  element={<OAuthCallback />} />

        {/* Admin pages WITHOUT navbar */}
        <Route path="/admin"          element={<AdminLogin />} />
        <Route path="/admin/portal"   element={<AdminPortal />} />

      </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
