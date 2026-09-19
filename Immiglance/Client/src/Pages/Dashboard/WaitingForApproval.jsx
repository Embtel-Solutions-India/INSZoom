import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import ThemeToggle from "../../components/ThemeToggle";

// Landed on by AuthGate.jsx when journeyState is WAITING_FOR_CASE or
// CASE_REJECTED — a client whose consultation is booked/completed/approved
// but doesn't have a Case yet either way. Standalone, no PortalLayout
// (there's no case to show a sidebar for), matching Intake.jsx's/
// BookConsultation.jsx's minimal-header pattern. journeyState renders
// distinct copy for the two states even though they land on the same
// page/component — the state itself stays separable for a future
// rejection-specific flow without needing a backend change.
export default function WaitingForApproval() {
  const { sessionContext, logout } = useAuth();
  const navigate = useNavigate();
  const isRejected = sessionContext?.journeyState === "CASE_REJECTED";

  useEffect(() => {
    document.title = "Your Application | Immiglance";
  }, []);

  const handleLogout = async () => {
    await logout();
    navigate("/login");
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="border-b border-border">
        <div className="mx-auto max-w-2xl px-6 py-5 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center shrink-0">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-primary-foreground">
                <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" />
                <polyline points="16 7 22 7 22 13" />
              </svg>
            </div>
            <span className="text-sm font-bold text-foreground">Immiglance</span>
          </div>
          <div className="flex items-center gap-3">
            <ThemeToggle />
            <button type="button" onClick={handleLogout} className="text-sm font-semibold text-muted-foreground hover:text-foreground transition">
              Log out
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center px-6 py-14">
        <div className="w-full max-w-lg text-center">
          <div className={`w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-6 ${isRejected ? "bg-destructive/10" : "bg-primary/10"}`}>
            {isRejected ? (
              <svg width="26" height="26" fill="none" stroke="currentColor" viewBox="0 0 24 24" className="text-destructive"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
            ) : (
              <svg width="26" height="26" fill="none" stroke="currentColor" viewBox="0 0 24 24" className="text-primary"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            )}
          </div>

          {isRejected ? (
            <>
              <h1 className="text-2xl font-bold text-foreground mb-3">We're unable to move forward right now</h1>
              <p className="text-muted-foreground text-sm leading-relaxed mb-2">
                After reviewing your consultation, our team wasn't able to proceed with your case at this time.
              </p>
              <p className="text-muted-foreground text-sm leading-relaxed">
                If you have questions about this decision, please reach out to our team directly.
              </p>
            </>
          ) : (
            <>
              <h1 className="text-2xl font-bold text-foreground mb-3">Your consultation has been booked</h1>
              <p className="text-muted-foreground text-sm leading-relaxed mb-2">
                Thank you for completing your assessment. Our team will review your consultation and contact you shortly.
              </p>
              <p className="text-muted-foreground text-sm leading-relaxed">
                Your case has not yet been created. Once your consultation is reviewed and your case is approved, you'll be able to access your case portal here.
              </p>
            </>
          )}

          <p className="text-xs text-muted-foreground mt-8">© 2026 Immiglance</p>
        </div>
      </main>
    </div>
  );
}
