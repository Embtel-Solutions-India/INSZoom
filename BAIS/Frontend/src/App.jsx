import { Suspense, lazy } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import MainLayout from "./layout/MainLayout";
import AuthGate from "./components/AuthGate";
import BlockIfHasCase from "./components/eligibility/BlockIfHasCase";
import PageLoader from "./components/PageLoader";

const Home = lazy(() => import("./Pages/Dashboard/Home"));
const Dashboard = lazy(() => import("./Pages/Dashboard/Dashboard"));
const Profile = lazy(() => import("./Pages/Dashboard/Profile"));
const Documents = lazy(() => import("./Pages/Dashboard/Documents"));
const About = lazy(() => import("./Pages/Dashboard/About"));
const Payments = lazy(() => import("./Pages/Dashboard/Payments"));
const DocumentReview = lazy(() => import("./Pages/Dashboard/DocumentReview"));
const Intake = lazy(() => import("./Pages/Dashboard/Intake"));
const FilingTypeSelection = lazy(() => import("./Pages/Dashboard/FilingTypeSelection"));
const PlanSelection = lazy(() => import("./Pages/Dashboard/PlanSelection"));
const Messages = lazy(() => import("./Pages/Dashboard/Messages"));
const HowItWorks = lazy(() => import("./Pages/Dashboard/HowItWorks"));
const Offers = lazy(() => import("./Pages/Dashboard/Offers"));
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
const EligibilityIntro = lazy(() => import("./Pages/Eligibility/EligibilityIntro"));
const EligibilityQuiz = lazy(() => import("./Pages/Eligibility/EligibilityQuiz"));
const EligibilityResults = lazy(() => import("./Pages/Eligibility/EligibilityResults"));
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
          <Route path="/about" element={<About />} />
          <Route path="/how-it-works" element={<HowItWorks />} />
          <Route path="/offers" element={<Offers />} />

          {/* Public eligibility intro + free consultation booking — no
              ProtectedRoute, reachable by anonymous prospects. /eligibility
              is wrapped in BlockIfHasCase so a client who already has a case
              (or an invited employee) can't retake the quiz by URL/stale
              link — see components/eligibility/BlockIfHasCase.jsx. Results
              stays open since it's the read-only outcome of a quiz just
              taken. The quiz itself (/eligibility/quiz) is standalone below,
              same pattern as /dashboard/intake — it's a questionnaire flow,
              not a browsing page, so it shouldn't render with the global Navbar. */}
          <Route element={<BlockIfHasCase />}>
            <Route path="/eligibility" element={<EligibilityIntro />} />
          </Route>
          <Route path="/eligibility/results/:leadId?" element={<EligibilityResults />} />
          <Route path="/consultation/book/:leadId?" element={<BookConsultation />} />
          <Route path="/consultation/booking/:token" element={<ManageBooking />} />

          {/* PHASE 3: routing based on auth + case status is now decided
              exclusively by AuthGate (src/components/AuthGate.jsx), which
              calls GET /api/auth/session-context. It supersedes both
              ProtectedRoute (auth check) and BlockEmployeeRoute (confines an
              invited employee to /dashboard/documents) for every route
              listed here — AuthGate itself redirects an employee-role
              session to /dashboard/documents, so nesting BlockEmployeeRoute
              on top would be redundant. ProtectedRoute/BlockEmployeeRoute
              are left defined in components/ProtectedRoute.jsx (not removed
              as files) but are no longer used in this route tree. */}
          <Route element={<AuthGate />}>
            <Route path="/dashboard"           element={<Dashboard />} />
            <Route path="/dashboard/profile"   element={<Profile />} />
            <Route path="/dashboard/messages"  element={<Messages />} />
            <Route path="/dashboard/plan"      element={<PlanSelection />} />
            <Route path="/dashboard/filing-type" element={<FilingTypeSelection />} />
            <Route path="/dashboard/payments" element={<Payments />} />
            <Route path="/dashboard/payments/success" element={<PaymentSuccess />} />
            <Route path="/dashboard/payments/cancel" element={<PaymentCancel />} />

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
