import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { authApi } from "../../services/api";

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
const EnvelopeIcon = () => (
  <svg width="22" height="22" fill="none" stroke="#3b82f6" viewBox="0 0 24 24" aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8"
      d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/>
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
      <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none flex items-center z-10">
        {icon}
      </span>
      <input
        type={type}
        name={name}
        placeholder={placeholder}
        value={value}
        onChange={onChange}
        autoComplete={autoComplete}
        className="w-full pl-10 pr-10 py-3 text-sm text-slate-800 placeholder-slate-400
          border border-slate-200 rounded-xl bg-white outline-none box-border
          hover:border-slate-300
          focus:border-[#1D9E75] focus:ring-2 focus:ring-[#1D9E75]/15
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
      px-5 py-4 bg-white border border-slate-100 rounded-2xl
      shadow-[0_4px_16px_rgba(0,0,0,0.06)]
      hover:shadow-[0_8px_24px_rgba(0,0,0,0.10)] hover:-translate-y-0.5
      transition-all duration-250
    `}>
      <div className="w-12 h-12 rounded-2xl bg-blue-50 flex items-center justify-center shrink-0">
        {icon}
      </div>
      <div>
        <p className="text-[15px] font-semibold text-slate-900 mb-1">{title}</p>
        {lines.map((line, i) => (
          typeof line === "string"
            ? <p key={i} className="text-[13px] text-slate-600 leading-relaxed my-0.5">{line}</p>
            : <span key={i}>{line}</span>
        ))}
      </div>
    </div>
  );
}

/* ── Main component ── */
export default function Register() {
  const navigate = useNavigate();
  const { signup, loginWithGoogle } = useAuth();

  const [form,    setForm]    = useState({ fullName: "", phone: "", email: "", password: "", confirmPassword: "", referralCode: "" });
  const [error,   setError]   = useState("");
  const [success, setSuccess] = useState("");
  const [show,    setShow]    = useState(false);
  const [loading, setLoading] = useState(false);
  const [pendingInvite, setPendingInvite] = useState(false);
  const [resendingInvite, setResendingInvite] = useState(false);
  const [resendSent, setResendSent] = useState(false);

  useEffect(() => {
    document.title = "Sign Up | BAIS Immigration Portal";
    const t = setTimeout(() => setShow(true), 60);
    // Prefill referral code from a shared link (?ref=CODE)
    const ref = new URLSearchParams(window.location.search).get("ref");
    if (ref) setForm((f) => ({ ...f, referralCode: ref.trim().toUpperCase() }));
    return () => clearTimeout(t);
  }, []);

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
      setTimeout(() => navigate("/dashboard"), 1600);
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
    setError(""); setLoading(true);
    try {
      const u = await loginWithGoogle();
      navigate(u?.role === "admin" ? "/admin/portal" : "/dashboard");
    } catch {
      setError("Unable to continue with Google. Please try again or use email sign-up.");
      setLoading(false);
    }
  }

  return (
    <>
      <style>{`
        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(20px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .card-anim-1 { opacity: 0; animation: fadeUp 0.5s ease forwards 0.2s; }
        .card-anim-2 { opacity: 0; animation: fadeUp 0.5s ease forwards 0.4s; }
        .card-anim-3 { opacity: 0; animation: fadeUp 0.5s ease forwards 0.6s; }
      `}</style>

      <div className="min-h-screen flex flex-col md:flex-row bg-[#f3f4f6]">

        {/* ══ LEFT — Form Card ══ */}
        <div
          className={`
            flex-1 flex flex-col justify-start
            px-6 sm:px-10 md:px-12 lg:px-16 py-8 md:py-10
            bg-white
            shadow-xl md:shadow-[2px_0_24px_rgba(0,0,0,0.06)]
            transition-all duration-500
            ${show ? "translate-x-0 opacity-100" : "-translate-x-10 opacity-0"}
          `}
          style={{ transitionTimingFunction: "cubic-bezier(0.22,1,0.36,1)" }}
        >
          <div className="w-full max-w-md mx-auto">
            {/* Logo */}
            <div className="flex items-center gap-2.5 mb-7">
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

            <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 mb-1">Create your account</h1>
            <p className="text-sm text-slate-500 mb-6">Join thousands of clients on their Bay Area immigration journey</p>

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

            <Field icon={<MailIcon />} type="email" placeholder="Email Address"
              value={form.email} onChange={set("email")} autoComplete="email" />

            <Field
              icon={<LockIcon />} type="password"
              placeholder="Password" value={form.password} onChange={set("password")}
              autoComplete="new-password"
            />

            <Field
              icon={<LockIcon />} type="password"
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
              <p className="-mt-2 mb-4 text-xs text-emerald-600 font-semibold flex items-center gap-1.5">
                <GiftIcon /> You'll get 10% off your package — and your referrer earns a reward too.
              </p>
            )}

            {success && (
              <div role="status" className="mb-4 text-sm text-green-700 bg-green-50 border border-green-200 rounded-xl px-4 py-3 flex items-center gap-2">
                <CheckIcon /> {success}
              </div>
            )}

            {/* Divider */}
            <div className="flex items-center gap-2.5 mb-4 text-xs text-slate-400">
              <span className="flex-1 h-px bg-slate-200" />
              <span className="font-medium whitespace-nowrap">or sign up with</span>
              <span className="flex-1 h-px bg-slate-200" />
            </div>

            {/* Google */}
            <button onClick={handleGoogle} disabled={loading}
              className="flex items-center justify-center gap-2.5 w-full py-3 mb-3
                bg-white border border-slate-200 rounded-xl text-sm font-semibold text-slate-700
                hover:bg-slate-50 hover:border-slate-300 hover:shadow-md
                transition-all duration-200 active:scale-[0.98] disabled:opacity-60 cursor-pointer">
              <GoogleIcon />
              Continue with Google
            </button>

            {/* Submit */}
            <button onClick={handleSubmit} disabled={loading}
              className="w-full py-3 bg-[#1D9E75] hover:bg-[#0F6E56]
                text-white text-sm font-bold rounded-xl
                shadow-sm shadow-emerald-200 hover:shadow-md
                transition-all duration-200 active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer">
              {loading ? "Creating account…" : "Create Account"}
            </button>

            {/* Invited-but-passwordless employee tried to sign up with their
                invited email — guide them to activation instead of a dead
                409. The token never appears here; only a fresh invite email
                is (re)sent. */}
            {pendingInvite && (
              <div role="alert" className="mt-3 mb-1 text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
                {resendSent ? (
                  <p>A new invitation has been sent to <span className="font-semibold">{form.email}</span>. Check your email to set your password.</p>
                ) : (
                  <>
                    <p className="mb-2">You've been invited to BAIS already — set your password to continue instead of creating a new account.</p>
                    <button type="button" onClick={handleResendInvite} disabled={resendingInvite}
                      className="text-sm font-bold text-amber-900 underline disabled:opacity-60 cursor-pointer">
                      {resendingInvite ? "Sending…" : "Resend invitation email"}
                    </button>
                  </>
                )}
              </div>
            )}

            {/* Inline error below submit */}
            {error && (
              <div role="alert" className="mt-3 mb-1 text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-3 flex items-start gap-2">
                <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24" className="shrink-0 mt-0.5" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>
                </svg>
                {error}
              </div>
            )}

            {/* Login redirect */}
            <button onClick={() => navigate("/login")}
              className="w-full py-3 bg-white border border-slate-200 text-slate-700
                text-sm font-semibold rounded-xl hover:bg-slate-50 hover:border-slate-300
                transition-all duration-200 cursor-pointer">
              <span className="inline-flex items-center gap-1.5">Already have an account? Sign in <ArrowRightIcon /></span>
            </button>

            <p className="mt-6 text-center text-xs text-slate-400">
              © BAIS · info@bayareaimmigrationservices.com
            </p>
          </div>
        </div>

        {/* ══ RIGHT — Contact Info Panel (hidden on mobile) ══ */}
        <div
          className={`
            hidden md:flex flex-1 flex-col gap-4 items-start justify-center
            px-8 lg:px-12 py-10 bg-[#f3f4f6]
            transition-all duration-500
            ${show ? "translate-x-0 opacity-100" : "translate-x-10 opacity-0"}
          `}
          style={{ transitionTimingFunction: "cubic-bezier(0.22,1,0.36,1)" }}
        >
          <div className="w-full max-w-sm">
            <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-5">Get in Touch</p>

            <ContactCard
              animClass="card-anim-1"
              icon={<PhoneCallIcon />}
              title="Call Us"
              lines={["(510) 770-8700"]}
            />

            <div className="mt-4">
              <ContactCard
                animClass="card-anim-2"
                icon={<EnvelopeIcon />}
                title="Email Us"
                lines={["info@bayareaimmigrationservices.com"]}
              />
            </div>

            <div className="mt-4">
              <ContactCard
                animClass="card-anim-3"
                icon={<MapPinIcon />}
                title="Visit Us"
                lines={[
                  "39159 Paseo Padre Pkwy STE 115, Fremont, CA 94538, United States",
                ]}
              />
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
