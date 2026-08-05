import { Suspense, lazy } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import MainLayout from "./layout/MainLayout";
import ProtectedRoute, { BlockEmployeeRoute } from "./components/ProtectedRoute";
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

          {/* Protected: must be logged in. An invited-employee account's
              whole world is its own case's checklist — /dashboard,
              /dashboard/profile, and /dashboard/messages are wrapped in
              BlockEmployeeRoute alongside the rest so an employee can only
              ever land on /dashboard/documents (see ProtectedRoute.jsx). */}
          <Route element={<ProtectedRoute />}>
            <Route element={<BlockEmployeeRoute />}>
              <Route path="/dashboard"           element={<Dashboard />} />
              <Route path="/dashboard/profile"   element={<Profile />} />
              <Route path="/dashboard/messages"  element={<Messages />} />
              <Route path="/dashboard/plan"      element={<PlanSelection />} />
              <Route path="/dashboard/filing-type" element={<FilingTypeSelection />} />
              <Route path="/dashboard/payments" element={<Payments />} />
              <Route path="/dashboard/payments/success" element={<PaymentSuccess />} />
              <Route path="/dashboard/payments/cancel" element={<PaymentCancel />} />
            </Route>

            <Route path="/dashboard/documents" element={<Documents />} />
            {/* Optional caseId — lets an employer account open one specific
                sponsored case's checklist, or an employee account open its
                own. Absent for every other account type/flow, which keeps
                using useMyCase() exactly as before. */}
            <Route path="/dashboard/documents/:caseId" element={<Documents />} />
            <Route path="/dashboard/document-review" element={<DocumentReview />} />
          </Route>
        </Route>

        {/* Standalone, no MainLayout/navbar — but still requires login, so
            ProtectedRoute is reused here on its own (outside MainLayout)
            rather than skipped. Also employee-blocked: intake is a new-case
            flow, not part of an invited employee's world. */}
        <Route element={<ProtectedRoute />}>
          <Route element={<BlockEmployeeRoute />}>
            <Route path="/dashboard/intake" element={<Intake />} />
          </Route>
        </Route>

        {/* Standalone, no MainLayout/navbar — the quiz is a full-screen
            questionnaire flow, same reasoning as /dashboard/intake above.
            BlockIfHasCase has no auth dependency of its own (unlike
            ProtectedRoute), so it's reused here exactly as it was inside
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
