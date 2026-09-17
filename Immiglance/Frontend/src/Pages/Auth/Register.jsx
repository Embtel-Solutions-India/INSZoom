import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { authApi } from "../../services/api";
import PasswordField from "../../components/auth/PasswordField";
import loginBackground from "../../assets/admin-login-liberty.png";
import loginBackgroundWebp from "../../assets/admin-login-liberty.webp";

const STAFF_ROLES = ["super_admin", "admin", "team_lead", "case_manager"];
const ADMIN_URL = import.meta.env.VITE_ADMIN_URL || "http://localhost:3002";

/* ── Icons ── */
const UserIcon = () => (
  <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.6"
      d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"/>
  </svg>
);
const PhoneIcon = () => (
  <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.6"
      d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498A1 1 0 0121 17.72V19a2 2 0 01-2 2H17C9.716 21 3 14.284 3 7V5z"/>
  </svg>
);
const MailIcon = () => (
  <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.6"
      d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/>
  </svg>
);
const LockIcon = () => (
  <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.6"
      d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/>
  </svg>
);
const GiftIcon = () => (
  <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.6"
      d="M12 8v13m0-13a4 4 0 10-4-4 4 4 0 004 4zm0 0a4 4 0 114-4 4 4 0 01-4 4zM5 8h14v3H5V8zm1 3h12v9a1 1 0 01-1 1H7a1 1 0 01-1-1v-9z"/>
  </svg>
);
const CheckIcon = () => (
  <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.2" d="M5 13l4 4L19 7"/>
  </svg>
);
const ArrowRightIcon = () => (
  <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.2" d="M9 5l7 7-7 7"/>
  </svg>
);
const GoogleIcon = () => (
  <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
    <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.08 17.74 9.5 24 9.5z"/>
    <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
    <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
    <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.31-8.16 2.31-6.26 0-11.57-3.59-13.46-8.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
  </svg>
);
const PhoneCallIcon = () => (
  <svg width="22" height="22" fill="none" stroke="#3b9cf6" viewBox="0 0 24 24" aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8"
      d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498A1 1 0 0121 17.72V19a2 2 0 01-2 2H17C9.716 21 3 14.284 3 7V5z"/>
  </svg>
);
const MapPinIcon = () => (
  <svg width="22" height="22" fill="none" stroke="#6366f1" viewBox="0 0 24 24" aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8"
      d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"/>
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8"
      d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"/>
  </svg>
);

/* ── Reusable input field ── */
function Field({ icon, type = "text", placeholder, value, onChange, rightEl, name, autoComplete }) {
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
        className="w-full pl-10 pr-10 py-3 text-sm text-foreground placeholder-muted-foreground
          border border-border rounded-xl bg-card outline-none box-border
          hover:border-ring/50
          focus:border-ring focus:ring-2 focus:ring-ring/15
          transition-all duration-150"
      />
      {rightEl && (
        <span className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center">
          {rightEl}
        </span>
      )}
    </div>
  );
}

/* ── Contact info card ── */
function ContactCard({ icon, title, lines, animClass }) {
  return (
    <div className={`
      ${animClass}
      flex items-start gap-4 w-full
      px-5 py-4 bg-card border border-border rounded-2xl
      shadow-sm
      hover:shadow-md hover:-translate-y-0.5
      transition-all duration-250
    `}>
      <div className="w-12 h-12 rounded-2xl bg-accent flex items-center justify-center shrink-0">
        {icon}
      </div>
      <div>
        <p className="text-[15px] font-semibold text-foreground mb-1">{title}</p>
        {lines.map((line, i) => (
          typeof line === "string"
            ? <p key={i} className="text-[13px] text-muted-foreground leading-relaxed my-0.5">{line}</p>
            : <span key={i}>{line}</span>
        ))}
      </div>
    </div>
  );
}

/* ── Main component ── */
export default function Register() {
  const navigate = useNavigate();
  const { signup, loginWithGoogle, googleRedirectUser, clearGoogleRedirectUser, googleAuthError, clearGoogleAuthError, user, authLoading } = useAuth();

  const [form,    setForm]    = useState({ fullName: "", phone: "", email: "", password: "", confirmPassword: "", referralCode: "" });
  const [error,   setError]   = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);
  const [pendingInvite, setPendingInvite] = useState(false);
  const [resendingInvite, setResendingInvite] = useState(false);
  const [resendSent, setResendSent] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  useEffect(() => {
    document.title = "Sign Up | Immiglance";
    // Prefill referral code from a shared link (?ref=CODE)
    const ref = new URLSearchParams(window.location.search).get("ref");
    if (ref) setForm((f) => ({ ...f, referralCode: ref.trim().toUpperCase() }));
  }, []);

  // signInWithRedirect leaves this page and comes back to it after Google
  // completes - pick up the result here instead of inline in handleGoogle,
  // mirroring exactly where the old popup flow's `navigate()` call was.
  // PHASE 3: routing is now decided exclusively by AuthGate
  // (src/components/AuthGate.jsx) via GET /api/auth/session-context — this
  // just lands the session on a protected route (AuthGate handles staff vs.
  // client vs. no-case routing from there), rather than assuming "new user."
  useEffect(() => {
    if (!googleRedirectUser) return;
    clearGoogleRedirectUser();
    navigate("/dashboard", { replace: true });
  }, [googleRedirectUser, navigate, clearGoogleRedirectUser]);

  useEffect(() => {
    if (!googleAuthError) return;
    setError(googleAuthError);
    setGoogleLoading(false);
    clearGoogleAuthError();
  }, [googleAuthError, clearGoogleAuthError]);

  // Staff-only guard (not broadened to clients like Login.jsx's twin effect):
  // handleSubmit below deliberately shows a "Account created!" message for
  // 1.6s before its own navigate() fires, and a client-covering version of
  // this effect would fire the instant signup() sets `user` - well before
  // that pause elapses - cutting the confirmation message short. Staff have
  // no such pause to protect, so this branch is safe to resolve immediately.
  // PHASE 3: inlines the same STAFF_ROLES check AuthGate itself uses,
  // since postLoginDest.js's getPostLoginDest is deprecated.
  useEffect(() => {
    if (!user || authLoading) return;
    if (STAFF_ROLES.includes(user.role)) window.location.href = ADMIN_URL;
  }, [user, authLoading]);

  const set = (field) => (e) => setForm({ ...form, [field]: e.target.value });

  async function handleSubmit() {
    const { fullName, phone, email, password, confirmPassword, referralCode } = form;
    setError(""); setSuccess(""); setPendingInvite(false); setResendSent(false);
    if (!fullName || !phone || !email || !password || !confirmPassword) { setError("All fields are required."); return; }
    if (!/^\+?[\d\s\-]{8,15}$/.test(phone)) { setError("Enter a valid phone number."); return; }
    if (!email.includes("@")) { setError("Enter a valid email address."); return; }
    if (password.length < 8) { setError("Password must be at least 8 characters."); return; }
    if (password !== confirmPassword) { setError("Passwords do not match."); return; }

    setLoading(true);
    try {
      await signup(fullName, email, password, referralCode.trim().toUpperCase() || undefined, phone);
      setSuccess("Account created! Redirecting…");
      // A brand-new signup can't have a case yet - go straight to the
      // intake wizard rather than /dashboard (which would just bounce here
      // a beat later via Dashboard.jsx's own loadCase() check anyway).
      setTimeout(() => navigate("/dashboard/intake", { replace: true }), 1600);
    } catch (err) {
      const msg = (err.message || "").toLowerCase();
      if (err.code === "PENDING_INVITE") {
        setPendingInvite(true);
      } else if (msg.includes("email-already-in-use") || msg.includes("already in use") || msg.includes("already registered")) {
        setError("This email address is already registered. Please log in to your existing account.");
      } else if (msg.includes("invalid-email") || msg.includes("invalid email")) {
        setError("The email address entered is not valid. Please check and try again.");
      } else if (msg.includes("weak-password") || msg.includes("weak password")) {
        setError("Your password is too weak. Please choose a stronger password (at least 8 characters).");
      } else if (msg.includes("network") || msg.includes("offline")) {
        setError("Network issue. Please check your internet connection and try again.");
      } else {
        setError("Something went wrong while creating your account. Please try again.");
      }
      setLoading(false);
    }
  }

  async function handleResendInvite() {
    setResendingInvite(true);
    try {
      await authApi.resendInvite(form.email);
      setResendSent(true);
    } finally {
      setResendingInvite(false);
    }
  }

  async function handleGoogle() {
    setError(""); setGoogleLoading(true);
    try {
      // On most browsers this triggers a full-page redirect to Google -
      // this component unmounts here on success, and the result is handled
      // by the useEffect above once Google redirects back to this page. On
      // Edge it opens a popup instead and resolves inline (see firebase.js's
      // redirectWillLoseState) - no separate handling needed here either
      // way, since context sets googleRedirectUser in both cases.
      await loginWithGoogle();
    } catch (err) {
      // auth/popup-closed-by-user means the user dismissed the popup (Edge
      // path only) - not an error worth surfacing.
      if (err?.code === "auth/popup-closed-by-user" || err?.code === "auth/cancelled-popup-request") {
        setGoogleLoading(false);
        return;
      }
      console.error("Google sign-in error:", err?.code, err?.message);
      setError("Unable to continue with Google. Please try again or use email sign-up.");
      setGoogleLoading(false);
    }
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-background text-foreground">
      <style>{`
        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(20px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .card-anim-1 { opacity: 0; animation: fadeUp 0.5s ease forwards 0.2s; }
        .card-anim-2 { opacity: 0; animation: fadeUp 0.5s ease forwards 0.4s; }
      `}</style>

      <picture>
        <source srcSet={loginBackgroundWebp} type="image/webp" />
        <img
          src={loginBackground}
          alt=""
          width={1672}
          height={941}
          decoding="async"
          className="absolute inset-0 h-full w-full object-cover"
        />
      </picture>
      <div className="absolute inset-0 bg-primary/[0.14]" />
      <div className="absolute inset-0 bg-slate-900/10" />
      <div className="absolute inset-y-0 right-0 w-1/2 bg-gradient-to-l from-white/54 to-transparent" />
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 78% 42% at 18% 100%, rgba(255,255,255,0.96) 0%, rgba(246,250,255,0.88) 34%, rgba(229,240,255,0.54) 58%, rgba(229,240,255,0.18) 74%, rgba(229,240,255,0) 92%)",
        }}
      />
      <div
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(0deg, rgba(255,255,255,0.88) 0%, rgba(248,251,255,0.72) 12%, rgba(236,246,255,0.42) 24%, rgba(236,246,255,0.16) 36%, rgba(236,246,255,0) 52%)",
        }}
      />

      <div className="relative z-10 flex min-h-screen flex-col px-5 py-8 sm:px-10 sm:py-10 lg:flex-row lg:px-14 xl:px-[72px]">
        <div className="flex justify-center pb-6 lg:flex-1 lg:flex-col lg:justify-end lg:pb-2 lg:pr-8">
          <div className="flex items-center gap-3">
            <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground shadow-lg shadow-primary/20">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
              </svg>
            </div>
            <div>
              <p className="text-xl font-black uppercase tracking-[0.28em] text-foreground sm:text-2xl">Immiglance</p>
              <p className="mt-1 text-sm font-black uppercase tracking-[0.26em] text-primary">Client Portal</p>
            </div>
          </div>
        </div>

        <section className="flex flex-1 items-center justify-center lg:justify-end lg:pr-8 xl:pr-14">
          <div className="w-full max-w-[464px] rounded-[18px] bg-card/90 px-6 pb-9 pt-9 shadow-[0_24px_70px_rgba(92,124,173,0.22)] ring-1 ring-card/85 backdrop-blur-md sm:px-10 sm:pb-11 sm:pt-11 lg:px-14">
            <h1 className="text-2xl sm:text-3xl font-serif font-bold text-foreground mb-1 text-center">Create your account</h1>
            <p className="text-sm text-muted-foreground mb-6 text-center">Join our clients on their immigration journey</p>

            <form onSubmit={(e) => { e.preventDefault(); handleSubmit(); }}>
            {/* Name + Phone row — stacks on very small screens */}
            <div className="flex flex-col sm:flex-row gap-0 sm:gap-4">
              <div className="flex-1">
                <Field icon={<UserIcon />} name="full-name" placeholder="Full Name"
                  value={form.fullName} onChange={set("fullName")} autoComplete="name" />
              </div>
              <div className="flex-1">
                <Field icon={<PhoneIcon />} name="phone" type="tel" placeholder="Phone Number"
                  value={form.phone} onChange={set("phone")} autoComplete="tel" />
              </div>
            </div>

            <Field icon={<MailIcon />} type="email" name="email" placeholder="Email Address"
              value={form.email} onChange={set("email")} autoComplete="email" />

            <PasswordField
              icon={<LockIcon />} name="password"
              placeholder="Password" value={form.password} onChange={set("password")}
              autoComplete="new-password"
            />

            <PasswordField
              icon={<LockIcon />} name="confirmPassword"
              placeholder="Confirm Password" value={form.confirmPassword} onChange={set("confirmPassword")}
              autoComplete="new-password"
            />

            {/* Optional referral code — gives both you and your friend 10% off */}
            <Field
              icon={<GiftIcon />} name="referral-code" placeholder="Referral Code (optional)"
              value={form.referralCode}
              onChange={(e) => setForm({ ...form, referralCode: e.target.value.toUpperCase() })}
              autoComplete="off"
            />
            {form.referralCode && (
              <p className="-mt-2 mb-4 text-xs text-primary font-semibold flex items-center gap-1.5">
                <GiftIcon /> You'll get 10% off your package — and your referrer earns a reward too.
              </p>
            )}

            {success && (
              <div role="status" className="mb-4 text-sm text-accent-foreground bg-accent border border-accent-foreground/20 rounded-xl px-4 py-3 flex items-center gap-2">
                <CheckIcon /> {success}
              </div>
            )}

            {/* Divider */}
            <div className="flex items-center gap-2.5 mb-4 text-xs text-muted-foreground">
              <span className="flex-1 h-px bg-border" />
              <span className="font-medium whitespace-nowrap">or sign up with</span>
              <span className="flex-1 h-px bg-border" />
            </div>

            {/* Google */}
            <button type="button" onClick={handleGoogle} disabled={loading || googleLoading}
              className="flex items-center justify-center gap-2.5 w-full py-3 mb-3
                bg-card border border-border rounded-xl text-sm font-semibold text-foreground
                hover:bg-secondary transition-all duration-200 active:scale-[0.98] disabled:opacity-60 cursor-pointer">
              {googleLoading ? "Redirecting to Google…" : (
                <>
                  <GoogleIcon />
                  Continue with Google
                </>
              )}
            </button>

            {/* Submit */}
            <button type="submit" disabled={loading || googleLoading}
              className="w-full py-3 bg-primary hover:opacity-90
                text-primary-foreground text-sm font-bold rounded-xl
                shadow-sm transition-all duration-200 active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer">
              {loading ? "Creating account…" : "Create Account"}
            </button>
            </form>

            {/* Invited-but-passwordless employee tried to sign up with their
                invited email — guide them to activation instead of a dead
                409. The token never appears here; only a fresh invite email
                is (re)sent. */}
            {pendingInvite && (
              <div role="alert" className="mt-3 mb-1 text-sm text-accent-foreground bg-accent border border-accent-foreground/20 rounded-xl px-4 py-3">
                {resendSent ? (
                  <p>A new invitation has been sent to <span className="font-semibold">{form.email}</span>. Check your email to set your password.</p>
                ) : (
                  <>
                    <p className="mb-2">You've been invited to Immiglance already — set your password to continue instead of creating a new account.</p>
                    <button type="button" onClick={handleResendInvite} disabled={resendingInvite}
                      className="text-sm font-bold underline disabled:opacity-60 cursor-pointer">
                      {resendingInvite ? "Sending…" : "Resend invitation email"}
                    </button>
                  </>
                )}
              </div>
            )}

            {/* Inline error below submit */}
            {error && (
              <div role="alert" className="mt-3 mb-1 text-sm text-destructive bg-destructive/10 border border-destructive/30 rounded-xl px-4 py-3 flex items-start gap-2">
                <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24" className="shrink-0 mt-0.5" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>
                </svg>
                {error}
              </div>
            )}

            {/* Login redirect */}
            <button type="button" onClick={() => navigate("/login")}
              className="w-full py-3 bg-card border border-border text-foreground
                text-sm font-semibold rounded-xl hover:bg-secondary
                transition-all duration-200 cursor-pointer">
              <span className="inline-flex items-center gap-1.5">Already have an account? Sign in <ArrowRightIcon /></span>
            </button>

            <div className="my-8 h-px bg-gradient-to-r from-transparent via-border to-transparent" />

            <div className="flex flex-col gap-3">
              <ContactCard animClass="card-anim-1" icon={<PhoneCallIcon />} title="Call Us" lines={["(510) 770-8700"]} />
              <ContactCard
                animClass="card-anim-2"
                icon={<MapPinIcon />}
                title="Visit Us"
                lines={["39159 Paseo Padre Pkwy STE 115, Fremont, CA 94538, United States"]}
              />
            </div>

            <p className="mt-6 text-center text-xs text-muted-foreground">© 2026 Immiglance</p>
          </div>
        </section>
      </div>
    </main>
  );
}
