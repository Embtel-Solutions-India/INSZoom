import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { authApi } from "../../services/api";
import PasswordField from "../../components/auth/PasswordField";

const LockIcon = () => (
  <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.6"
      d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/>
  </svg>
);

export default function AcceptInvite() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") || "";
  const { acceptInvite } = useAuth();

  const [status, setStatus] = useState("checking"); // checking | valid | invalid
  const [invite, setInvite] = useState(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    document.title = "Accept Invitation | Immiglance";
    if (!token) {
      setStatus("invalid");
      return;
    }
    authApi.getInviteDetails(token)
      .then((data) => {
        setInvite(data);
        setStatus("valid");
      })
      .catch(() => setStatus("invalid"));
  }, [token]);

  const handleSubmit = async () => {
    setError("");
    if (password.length < 8) { setError("Password must be at least 8 characters."); return; }
    if (password !== confirmPassword) { setError("Passwords do not match."); return; }

    setSubmitting(true);
    try {
      await acceptInvite(token, password, confirmPassword, username.trim() || undefined);
      navigate("/dashboard", { replace: true });
    } catch (err) {
      setError(err.message || "Unable to activate your account. The link may have expired.");
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-6 py-10">
      <div className="w-full max-w-md bg-card rounded-2xl shadow-xl p-8">
        <div className="flex items-center gap-2.5 mb-7">
          <div className="w-9 h-9 rounded-xl bg-primary
            flex items-center justify-center shadow-sm">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" className="text-primary-foreground" aria-hidden="true">
              <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
            </svg>
          </div>
          <div>
            <p className="text-lg font-bold text-foreground leading-none">Immiglance</p>
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">Immigration Portal</p>
          </div>
        </div>

        {status === "checking" && (
          <p className="text-sm text-muted-foreground">Checking your invitation…</p>
        )}

        {status === "invalid" && (
          <>
            <h1 className="text-xl font-serif font-bold text-foreground mb-2">Invalid or expired link</h1>
            <p className="text-sm text-muted-foreground mb-6">
              This invitation link is no longer valid. Ask whoever invited you to send a new one, or log in if you've already activated your account.
            </p>
            <button onClick={() => navigate("/login")}
              className="w-full py-3 bg-primary hover:opacity-90 text-primary-foreground text-sm font-bold rounded-xl transition-all duration-200 cursor-pointer">
              Go to Login
            </button>
          </>
        )}

        {status === "valid" && (
          <>
            <h1 className="text-xl font-serif font-bold text-foreground mb-1">Create your account</h1>
            <p className="text-sm text-muted-foreground mb-6">
              {invite?.name ? `Welcome, ${invite.name}. ` : ""}Set a password for <span className="font-semibold text-foreground">{invite?.email}</span> to activate your account and get started.
            </p>

            {invite?.caseNumber && (
              <div className="mb-5">
                <label className="block text-xs font-semibold text-muted-foreground mb-1.5">Case ID</label>
                <div className="w-full px-4 py-2.5 rounded-xl border border-border bg-secondary text-sm font-semibold text-foreground">
                  {invite.caseNumber}
                </div>
              </div>
            )}

            <form onSubmit={(e) => { e.preventDefault(); handleSubmit(); }}>
            <div className="mb-5">
              <label className="block text-xs font-semibold text-muted-foreground mb-1.5">
                Username <span className="text-muted-foreground font-normal">(optional — defaults to your email prefix)</span>
              </label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="e.g. john.doe"
                autoComplete="username"
                className="w-full px-4 py-2.5 rounded-xl border border-border bg-card text-sm text-foreground outline-none focus:border-ring focus:ring-2 focus:ring-ring/15"
              />
              <p className="mt-1 text-xs text-muted-foreground">You can log in with your Case ID, email, or username + password.</p>
            </div>
            <PasswordField icon={<LockIcon />} name="password" placeholder="Password"
              value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
            <PasswordField icon={<LockIcon />} name="confirmPassword" placeholder="Confirm Password"
              value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} autoComplete="new-password" />

            {error && (
              <div role="alert" className="mb-4 text-sm text-destructive bg-destructive/10 border border-destructive/30 rounded-xl px-4 py-3">
                {error}
              </div>
            )}

            <button type="submit" disabled={submitting}
              className="w-full py-3 bg-primary hover:opacity-90 text-primary-foreground text-sm font-bold rounded-xl
                transition-all duration-200 active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer">
              {submitting ? "Activating…" : "Activate Account"}
            </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
