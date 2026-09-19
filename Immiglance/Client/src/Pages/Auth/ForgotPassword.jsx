import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { authApi } from "../../services/api";

const MailIcon = () => (
  <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.6"
      d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/>
  </svg>
);

function Field({ icon, type = "text", name, placeholder, value, onChange, autoComplete }) {
  return (
    <div className="relative flex items-center w-full mb-4">
      <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none flex items-center z-10">
        {icon}
      </span>
      <input
        type={type}
        id={name}
        name={name}
        placeholder={placeholder}
        value={value}
        onChange={onChange}
        autoComplete={autoComplete}
        className="w-full pl-10 pr-4 py-3 text-sm text-foreground placeholder-muted-foreground
          border border-border rounded-xl bg-card outline-none box-border
          hover:border-ring/50
          focus:border-ring focus:ring-2 focus:ring-ring/15
          transition-all duration-150"
      />
    </div>
  );
}

export default function ForgotPassword() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  useEffect(() => { document.title = "Forgot Password | Immiglance"; }, []);

  const handleSubmit = async () => {
    setError("");
    if (!email.includes("@")) { setError("Enter a valid email address."); return; }
    setSubmitting(true);
    try {
      // Always shows the same neutral confirmation, whether or not the
      // email exists — the backend response is identical either way.
      await authApi.forgotPassword(email);
      setSent(true);
    } catch (err) {
      setError(err.message || "Unable to send reset instructions right now. Please try again.");
    } finally {
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

        {!sent ? (
          <>
            <h1 className="text-xl font-serif font-bold text-foreground mb-1">Forgot your password?</h1>
            <p className="text-sm text-muted-foreground mb-6">
              Enter the email address on your account and we'll send you a link to reset your password.
            </p>

            <form onSubmit={(e) => { e.preventDefault(); handleSubmit(); }}>
            <Field icon={<MailIcon />} type="email" name="email" placeholder="Email address"
              value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />

            {error && (
              <div role="alert" className="mb-4 text-sm text-destructive bg-destructive/10 border border-destructive/30 rounded-xl px-4 py-3">
                {error}
              </div>
            )}

            <button type="submit" disabled={submitting}
              className="w-full py-3 bg-primary hover:opacity-90 text-primary-foreground text-sm font-bold rounded-xl
                transition-all duration-200 active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer">
              {submitting ? "Sending…" : "Send Reset Link"}
            </button>
            </form>

            <button onClick={() => navigate("/login")}
              className="w-full mt-3 py-3 bg-card border border-border text-foreground
                text-sm font-semibold rounded-xl hover:bg-secondary
                transition-all duration-200 cursor-pointer">
              Back to Login
            </button>
          </>
        ) : (
          <>
            <h1 className="text-xl font-serif font-bold text-foreground mb-2">Check your email</h1>
            <p className="text-sm text-muted-foreground mb-6">
              If an account exists for <span className="font-semibold text-foreground">{email}</span>, we've sent password reset instructions to it. The link expires in 1 hour.
            </p>
            <button onClick={() => navigate("/login")}
              className="w-full py-3 bg-primary hover:opacity-90 text-primary-foreground text-sm font-bold rounded-xl transition-all duration-200 cursor-pointer">
              Back to Login
            </button>
          </>
        )}
      </div>
    </div>
  );
}
