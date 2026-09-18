import { Suspense, lazy } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import PortalLayout from "./layout/PortalLayout";
import AuthGate from "./components/AuthGate";
import PageLoader from "./components/PageLoader";
import CrossAppRedirect from "./components/CrossAppRedirect";
import SSOHandler from "./components/SSOHandler";

// Client = the authenticated client application. Carved out of the
// pre-split Immiglance/Frontend/src/App.jsx; every route below is
// byte-for-byte the same path/element pairing it had there, with the public
// half moved to the Landing app.
const Dashboard = lazy(() => import("./Pages/Dashboard/Dashboard"));
const Tasks = lazy(() => import("./Pages/Dashboard/Tasks"));
const Profile = lazy(() => import("./Pages/Dashboard/Profile"));
const Documents = lazy(() => import("./Pages/Dashboard/Documents"));
const Payments = lazy(() => import("./Pages/Dashboard/Payments"));
const DocumentReview = lazy(() => import("./Pages/Dashboard/DocumentReview"));
const Intake = lazy(() => import("./Pages/Dashboard/Intake"));
const BookConsultation = lazy(() => import("./Pages/Dashboard/BookConsultation"));
const FilingTypeSelection = lazy(() => import("./Pages/Dashboard/FilingTypeSelection"));
const PlanSelection = lazy(() => import("./Pages/Dashboard/PlanSelection"));
const Messages = lazy(() => import("./Pages/Dashboard/Messages"));
const QuickBooks = lazy(() => import("./Pages/Dashboard/QuickBooks"));
const FedEx = lazy(() => import("./Pages/Dashboard/FedEx"));
const PaymentSuccess = lazy(() => import("./Pages/Dashboard/PaymentSuccess"));
const PaymentCancel = lazy(() => import("./Pages/Dashboard/PaymentCancel"));

export default function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={<PageLoader />}>
      <Routes>

        {/* Landing point for Landing(5173)'s cross-origin session handoff —
            see components/SSOHandler.jsx and CrossAppRedirect.jsx. Public:
            the token itself is the credential, verified against the backend
            inside SSOHandler before any session is established. */}
        <Route path="/auth/sso" element={<SSOHandler />} />

        {/* Client portal — themed sidebar + top-bar shell (PortalLayout).
            PHASE 3: routing based on auth + case status is still decided
            exclusively by AuthGate (src/components/AuthGate.jsx), which calls
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
            <Route path="/dashboard/tasks"     element={<Tasks />} />
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

        {/* Standalone, no PortalLayout chrome — still requires login and
            case-status routing, both owned by AuthGate (see above).
            /consultation/book specifically lives here (not forwarded to
            Landing like the rest of /consultation/*) — Intake.jsx's
            submitEvaluation() navigates straight here after creating the
            Lead, so a client never leaves this app between intake and
            booking. AuthGate's own isPreCaseBookingPath check is what lets
            a still-case-less client reach it without bouncing back to
            intake. */}
        <Route element={<AuthGate />}>
          <Route path="/onboarding/intake" element={<Intake />} />
          <Route path="/consultation/book" element={<BookConsultation />} />
        </Route>
        {/* Legacy URL — Register.jsx (brand-new signup, now in the Landing
            app) still navigates here directly by habit/comment ("can't have
            a case yet"). Forwards to the one canonical, AuthGate-aware
            intake route above rather than duplicating <Intake/> under two
            paths with two different routing checks. */}
        <Route path="/dashboard/intake" element={<Navigate to="/onboarding/intake" replace />} />

        {/* Repository-split shim — every public/pre-authentication path
            ("/", "/login", "/signup", "/accept-invite", "/forgot-password",
            "/reset-password", "/auth/callback", "/legacy-holding",
            "/eligibility/*", the rest of "/consultation/*" besides
            "/consultation/book" above — e.g. "/consultation/booking/:token",
            reached via an emailed token link independent of login state)
            moved to the Landing app on a different origin. AuthGate's own
            <Navigate to="/login" /> / "/accept-invite" / "/legacy-holding"
            redirects are unmodified; this catch-all is what forwards them to
            Landing instead of 404-ing. No token or session state is handed
            over — see components/CrossAppRedirect.jsx. */}
        <Route path="*" element={<CrossAppRedirect />} />

      </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
