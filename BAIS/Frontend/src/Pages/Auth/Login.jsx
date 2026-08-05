import { useState, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { authApi } from "../../services/api";

export default function Login() {
  const [email,       setEmail]       = useState("");
  const [password,    setPassword]    = useState("");
  const [error,       setError]       = useState("");
  const [loading,     setLoading]     = useState(false);
  const [mounted,     setMounted]     = useState(false);
  const [pendingInvite, setPendingInvite] = useState(false);
  const [resendingInvite, setResendingInvite] = useState(false);
  const [resendSent, setResendSent] = useState(false);

  const { login, loginWithGoogle } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    document.title = "Login | BAIS Immigration Portal";
    const t = setTimeout(() => setMounted(true), 60);
    return () => clearTimeout(t);
  }, []);

  const handleLogin = async () => {
    if (!email || !password) { setError("Please enter your email and password."); return; }
    setError(""); setPendingInvite(false); setResendSent(false); setLoading(true);
    try {
      await login(email, password);
      navigate("/dashboard");
    } catch (err) {
      const msg = (err.message || "").toLowerCase();
      if (err.code === "PENDING_INVITE") {
        setPendingInvite(true);
      } else if (msg.includes("user-not-found") || msg.includes("no user") || msg.includes("invalid-credential") || msg.includes("invalid credential")) {
        setError("No account found with this email. Please check your email or sign up.");
      } else if (msg.includes("wrong-password") || msg.includes("wrong password") || msg.includes("incorrect password")) {
        setError("Incorrect password. Please try again or reset your password.");
      } else if (msg.includes("too-many-requests") || msg.includes("too many")) {
        setError("Too many failed attempts. Please wait a moment before trying again.");
      } else if (msg.includes("network") || msg.includes("offline")) {
        setError("Network issue. Please check your internet connection and try again.");
      } else {
        setError("Unable to log in. Please check your credentials and try again.");
      }
    } finally { setLoading(false); }
  };

  const handleResendInvite = async () => {
    setResendingInvite(true);
    try {
      await authApi.resendInvite(email);
      setResendSent(true);
    } finally {
      setResendingInvite(false);
    }
  };

  const handleGoogle = async () => {
    setError(""); setLoading(true);
    try {
      const u = await loginWithGoogle();
      navigate(u?.role === "admin" ? "/admin/portal" : "/dashboard");
    } catch (err){
      console.error(err);
      setError("Unable to continue with Google. Please try again or use email login.");
    } finally { setLoading(false); }
  };

  const handleKey = (e) => { if (e.key === "Enter") handleLogin(); };

  return (
    <div className="min-h-screen flex flex-col md:flex-row bg-[#f3f4f6] font-[Inter,system-ui,sans-serif]">

      {/* ── Left — Form Panel ── */}
      <div
        className={`
          flex-1 flex flex-col justify-center
          px-6 sm:px-12 md:px-14 lg:px-20 py-12
          bg-white md:rounded-none
          shadow-xl md:shadow-[2px_0_24px_rgba(0,0,0,0.06)]
          transition-all duration-500
          ${mounted ? "translate-x-0 opacity-100" : "-translate-x-10 opacity-0"}
        `}
        style={{ transitionTimingFunction: "cubic-bezier(0.22,1,0.36,1)" }}
      >
        <div className="w-full max-w-sm mx-auto">
          {/* Logo */}
          <div className="flex items-center gap-2.5 mb-8">
            <div className="w-9 h-9 rounded-xl bg-linear-to-br from-[#1D9E75] to-teal-600
              flex items-center justify-center shadow-sm">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="white" aria-hidden="true">
                <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
              </svg>
            </div>
            <div>
              <p className="text-lg font-extrabold text-slate-800 leading-none">BAIS</p>
              <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest">Immigration Portal</p>
            </div>
          </div>

          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 mb-1">Welcome back</h1>
          <p className="text-sm text-slate-500 mb-7">Sign in to your account to continue</p>

          {/* Google */}
          <button
            onClick={handleGoogle}
            disabled={loading}
            className="flex items-center justify-center gap-3 w-full py-3 mb-5
              bg-white border border-slate-200 rounded-xl text-sm font-semibold text-slate-700
              hover:bg-slate-50 hover:border-slate-300 hover:shadow-md
              transition-all duration-200 active:scale-[0.98] disabled:opacity-60 cursor-pointer"
          >
            <GoogleIcon />
            Continue with Google
          </button>

          {/* Divider */}
          <div className="flex items-center gap-3 mb-5">
            <span className="flex-1 h-px bg-slate-200" />
            <span className="text-xs text-slate-400 font-medium whitespace-nowrap">Or sign in with email</span>
            <span className="flex-1 h-px bg-slate-200" />
          </div>

          {/* Email */}
          <FieldWrap icon={<MailIcon />}>
            <input
              type="email"
              name="email"
              placeholder="Email address"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={handleKey}
              autoComplete="email"
              className="w-full pl-10 pr-4 py-3 text-sm text-slate-800 placeholder-slate-400
                border border-slate-200 rounded-xl bg-white outline-none
                hover:border-slate-300 focus:border-[#1D9E75] focus:ring-2 focus:ring-[#1D9E75]/15
                transition-all duration-150"
            />
          </FieldWrap>

          {/* Password */}
          <FieldWrap icon={<LockIcon />}>
            <input
              type="password"
              name="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={handleKey}
              autoComplete="current-password"
              className="w-full pl-10 pr-4 py-3 text-sm text-slate-800 placeholder-slate-400
                border border-slate-200 rounded-xl bg-white outline-none
                hover:border-slate-300 focus:border-[#1D9E75] focus:ring-2 focus:ring-[#1D9E75]/15
                transition-all duration-150"
            />
          </FieldWrap>

          {/* Forgot */}
          <div className="text-right mb-5 -mt-1">
            <Link to="/forgot-password" className="text-xs text-[#1a7abf] hover:underline font-medium">
              Forgot password?
            </Link>
          </div>

          {/* Invited-but-passwordless employee tried to log in with their
              invited email — guide them to activation via a resend, never
              exposing the invite token itself. */}
          {pendingInvite && (
            <div role="alert" className="mb-4 px-4 py-3 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-800">
              {resendSent ? (
                <p>A new invitation has been sent to <span className="font-semibold">{email}</span>. Check your email to set your password.</p>
              ) : (
                <>
                  <p className="mb-2">You've been invited — set your password to continue instead of logging in.</p>
                  <button type="button" onClick={handleResendInvite} disabled={resendingInvite}
                    className="text-sm font-bold text-amber-900 underline disabled:opacity-60 cursor-pointer">
                    {resendingInvite ? "Sending…" : "Resend invitation email"}
                  </button>
                </>
              )}
            </div>
          )}

          {/* Error */}
          {error && (
            <div role="alert" className="flex items-start gap-2 mb-4 px-4 py-3
              bg-red-50 border border-red-200 rounded-xl text-sm text-red-600">
              <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24" className="shrink-0 mt-0.5" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>
              </svg>
              {error}
            </div>
          )}

          {/* Login button */}
          <button
            onClick={handleLogin}
            disabled={loading}
            className="w-full py-3 mb-3 bg-[#1D9E75] hover:bg-[#0F6E56]
              text-white text-sm font-bold rounded-xl
              shadow-sm shadow-emerald-200 hover:shadow-md hover:shadow-emerald-300
              transition-all duration-200 active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer"
          >
            {loading ? "Signing in…" : "Sign In"}
          </button>

          {/* Sign up */}
          <button
            onClick={() => navigate("/signup")}
            className="w-full py-3 bg-white border border-slate-200 text-slate-700
              text-sm font-semibold rounded-xl hover:bg-slate-50 hover:border-slate-300
              transition-all duration-200 cursor-pointer"
          >
            New user? Create account
          </button>

          <p className="mt-8 text-center text-xs text-slate-400">
            © BAIS &nbsp;·&nbsp; info@bayareaimmigrationservices.com
          </p>
        </div>
      </div>

      {/* ── Right — Brand Panel (hidden on mobile) ── */}
      <div
        className={`
          hidden md:flex flex-1 flex-col items-center justify-center
          px-10 py-12 text-center
          bg-linear-to-br from-[#1D9E75] via-[#1a7abf] to-[#1756d1]
          transition-all duration-500
          ${mounted ? "translate-x-0 opacity-100" : "translate-x-10 opacity-0"}
        `}
        style={{ transitionTimingFunction: "cubic-bezier(0.22,1,0.36,1)" }}
      >
        <div className="max-w-sm">
          {/* Large brand */}
          <p className="text-7xl lg:text-8xl font-light text-white tracking-[0.2em] mb-4
            animate-[fadeUp_0.5s_ease_forwards_0.2s] opacity-0">
            BAIS
          </p>
          <p className="text-base text-white/90 leading-relaxed mb-6
            animate-[fadeUp_0.5s_ease_forwards_0.4s] opacity-0">
            Welcome to the <strong className="font-semibold">BAIS Client Portal</strong> —{" "}
            your secure gateway to Bay Area immigration services.
          </p>
          <span className="inline-block px-5 py-2 border border-white/40 rounded-full
            text-sm text-white/80 tracking-widest font-medium
            animate-[fadeUp_0.5s_ease_forwards_0.6s] opacity-0">
            Secure · Trusted · Official
          </span>

          {/* Stats */}
          <div className="grid grid-cols-3 gap-4 mt-12 animate-[fadeUp_0.5s_ease_forwards_0.8s] opacity-0">
            {[
              { num: "10K+", label: "Visas Approved" },
              { num: "15+",  label: "Years Experience" },
              { num: "98%",  label: "Success Rate" },
            ].map(({ num, label }) => (
              <div key={label} className="bg-white/10 rounded-2xl px-3 py-4 border border-white/20">
                <p className="text-2xl font-extrabold text-white">{num}</p>
                <p className="text-xs text-white/70 mt-0.5 leading-tight">{label}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      <style>{`
        @keyframes fadeUp {
          to { opacity: 1; transform: translateY(0); }
          from { opacity: 0; transform: translateY(20px); }
        }
      `}</style>
    </div>
  );
}

/* ── Shared field wrapper ── */
function FieldWrap({ icon, children }) {
  return (
    <div className="relative mb-4">
      <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none flex items-center z-10">
        {icon}
      </span>
      {children}
    </div>
  );
}

/* ── Icons ── */
function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.08 17.74 9.5 24 9.5z"/>
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.31-8.16 2.31-6.26 0-11.57-3.59-13.46-8.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
    </svg>
  );
}
function MailIcon() {
  return (
    <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.6" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/>
    </svg>
  );
}
function LockIcon() {
  return (
    <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.6" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/>
    </svg>
  );
}
