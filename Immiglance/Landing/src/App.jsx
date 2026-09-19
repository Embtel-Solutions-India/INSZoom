import { Suspense, lazy } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import MainLayout from "./layout/MainLayout";
import BlockIfHasCase from "./components/eligibility/BlockIfHasCase";
import PageLoader from "./components/PageLoader";
import CrossAppRedirect from "./components/CrossAppRedirect";

// Landing = the public marketing site plus the anonymous eligibility quiz.
// Carved out of the pre-split Immiglance/Frontend/src/App.jsx; every route
// below is byte-for-byte the same path/element pairing it had there.
//
// Login/Register/Forgot-Reset-Password/Accept-Invite/OAuth-callback moved
// to the Client app (a different origin) so that app is a fully
// self-contained portal exactly like Admin's and Attorney's, instead of
// Landing rendering auth UI and handing a session back cross-origin. This
// app no longer performs any authentication at all — see Navbar.jsx's
// "Client Login" link and the forwarding routes near the bottom of this
// file.
//
// Home is the real public homepage rendered at "/" — it lived under
// Pages/Dashboard/ before the split purely as a misnomer (it is marketing
// copy: visa categories, how-it-works, FAQ, contact form), so it moved to
// Pages/Marketing/ here. The authenticated case-overview screen is a
// different file (Dashboard.jsx) and lives in Client.
const Home = lazy(() => import("./Pages/Marketing/Home"));
const LegacyHolding = lazy(() => import("./Pages/Auth/LegacyHolding"));
const EligibilityQuiz = lazy(() => import("./Pages/Eligibility/EligibilityQuiz"));
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
        </Route>

        {/* /eligibility used to be a separate category/visa picker page
            (shown with the navbar) before the quiz itself. That picker is
            now the first two steps of the single continuous quiz below —
            redirect old links/bookmarks straight there. */}
        <Route path="/eligibility" element={<Navigate to="/eligibility/quiz" replace />} />

        {/* Public — reachable even for an unauthenticated or errored
            session, per Phase 3 Part E. Deliberately outside AuthGate
            (which now lives in the Client app entirely). */}
        <Route path="/legacy-holding" element={<LegacyHolding />} />

        {/* Standalone, no MainLayout/navbar — the quiz is a full-screen
            questionnaire flow. BlockIfHasCase has no auth dependency of its
            own (unlike AuthGate), so it is reused here exactly as before. */}
        <Route element={<BlockIfHasCase />}>
          <Route path="/eligibility/quiz" element={<EligibilityQuiz />} />
        </Route>

        {/* Consultation booking immediately follows a completed quiz (no
            results screen in between — see EligibilityQuiz.jsx) and is also
            linked to from the logged-in intake flow (Intake.jsx, now in
            Client, as /consultation/book?leadId=...), so — unlike the
            quiz above — it is deliberately left unguarded by BlockIfHasCase,
            exactly as before. ManageBooking is reached via an emailed token
            link independent of login state and was already unguarded. */}
        <Route path="/consultation/book/:leadId?" element={<BookConsultation />} />
        <Route path="/consultation/booking/:token" element={<ManageBooking />} />

        {/* Repository-split shim — these paths all moved to the Client app
            (a different origin): the auth pages (Login/Register/Forgot-
            Reset-Password/Accept-Invite/OAuth-callback) as well as the
            already-authenticated /dashboard, /onboarding/* routes. Forward
            the browser there rather than 404, so old bookmarks/emailed
            links keep working. No token or session state is handed over —
            see components/CrossAppRedirect.jsx. Navbar.jsx's own "Client
            Login" link already goes straight to Client's /login and never
            round-trips through here. */}
        <Route path="/login"           element={<CrossAppRedirect />} />
        <Route path="/signup"          element={<CrossAppRedirect />} />
        <Route path="/accept-invite"   element={<CrossAppRedirect />} />
        <Route path="/forgot-password" element={<CrossAppRedirect />} />
        <Route path="/reset-password"  element={<CrossAppRedirect />} />
        <Route path="/auth/callback"   element={<CrossAppRedirect />} />
        <Route path="/dashboard/*"     element={<CrossAppRedirect />} />
        <Route path="/dashboard"       element={<CrossAppRedirect />} />
        <Route path="/onboarding/*"    element={<CrossAppRedirect />} />

      </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
