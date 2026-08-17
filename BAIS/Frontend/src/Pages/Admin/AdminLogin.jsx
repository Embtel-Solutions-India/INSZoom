import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { IconUsers, IconFileText, IconCalendar, IconBarChart } from "../../utils/iconComponents";

// super_admin is a HIGHER privilege than admin, not a different one — it must
// never be locked out of the same portal a plain admin can reach.
const ADMIN_PORTAL_ROLES = ["admin", "super_admin"];

const EyeIcon = () => (
  <svg width="17" height="17" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"
      d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/>
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"
      d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/>
  </svg>
);
const EyeOffIcon = () => (
  <svg width="17" height="17" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"
      d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21"/>
  </svg>
);

export default function AdminLogin() {
  const { user, authLoading, login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw]     = useState(false);
  const [error, setError]       = useState("");
  const [loading, setLoading]   = useState(false);
  const [show, setShow]         = useState(false);

  useEffect(() => {
    document.title = "Admin Login | BAIS Portal";
    const t = setTimeout(() => setShow(true), 60);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (!authLoading && ADMIN_PORTAL_ROLES.includes(user?.role)) navigate("/admin/portal", { replace: true });
  }, [user, authLoading]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!email || !password) { setError("Please enter your email and password."); return; }
    setError(""); setLoading(true);

    try {
      const loggedInUser = await login(email, password);
      if (!ADMIN_PORTAL_ROLES.includes(loggedInUser.role)) {
        setError("You are not authorized to access the Admin Portal.");
        setLoading(false);
        return;
      }
      navigate("/admin/portal", { replace: true });
    } catch (err) {
      setError(err.message || "Invalid credentials. Please check your email and password.");
    } finally {
      setPassword("");
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex bg-slate-950">

      {/* ── Left: Login Form ── */}
      <div className={`flex-1 flex flex-col justify-center px-8 sm:px-12 lg:px-20 py-12 bg-slate-900
        transition-all duration-500 ${show ? "translate-x-0 opacity-100" : "-translate-x-8 opacity-0"}`}
        style={{ transitionTimingFunction: "cubic-bezier(0.22,1,0.36,1)" }}>

        <div className="w-full max-w-md mx-auto">

          {/* Logo + Badge */}
          <div className="flex items-center gap-3 mb-10">
            <div className="w-11 h-11 rounded-xl bg-linear-to-br from-[#1D9E75] to-teal-600
              flex items-center justify-center shadow-lg">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="white">
                <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
              </svg>
            </div>
            <div>
              <p className="text-lg font-extrabold text-white leading-none">BAIS</p>
              <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-400">Admin Portal</p>
            </div>
          </div>

          <div className="mb-8">
            <h1 className="text-2xl sm:text-3xl font-extrabold text-white mb-2">Admin Sign In</h1>
            <p className="text-slate-400 text-sm">Restricted access — authorized personnel only.</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">

            {/* Email */}
            <div>
              <label className="block text-xs font-semibold text-slate-400 mb-2 uppercase tracking-wider">
                Admin Email
              </label>
              <input
                type="email" id="admin-login-email" name="email" value={email} onChange={(e) => setEmail(e.target.value)}
                placeholder="admin@bais.com" autoComplete="email" required
                className="w-full px-4 py-3 text-sm bg-slate-800 border border-slate-700 rounded-xl
                  text-white placeholder-slate-500 outline-none
                  focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 transition-all"
              />
            </div>

            {/* Password */}
            <div>
              <label className="block text-xs font-semibold text-slate-400 mb-2 uppercase tracking-wider">
                Password
              </label>
              <div className="relative">
                <input
                  type={showPw ? "text" : "password"} id="admin-login-password" name="password" value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••" autoComplete="current-password" required
                  className="w-full px-4 py-3 pr-12 text-sm bg-slate-800 border border-slate-700 rounded-xl
                    text-white placeholder-slate-500 outline-none
                    focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 transition-all"
                />
                <button type="button" onClick={() => setShowPw(!showPw)}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition cursor-pointer">
                  {showPw ? <EyeOffIcon /> : <EyeIcon />}
                </button>
              </div>
            </div>

            {/* Submit */}
            <button type="submit" disabled={loading}
              className="w-full py-3.5 bg-linear-to-r from-[#1D9E75] to-teal-600
                text-white text-sm font-bold rounded-xl shadow-lg shadow-emerald-900/40
                hover:from-emerald-600 hover:to-teal-700 transition-all duration-200
                active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer mt-2">
              {loading ? "Authenticating…" : "Access Admin Portal"}
            </button>

            {/* Error */}
            {error && (
              <div role="alert" className="flex items-start gap-2.5 px-4 py-3 bg-red-500/10
                border border-red-500/30 rounded-xl text-sm text-red-400">
                <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24"
                  className="shrink-0 mt-0.5">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"
                    d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>
                </svg>
                {error}
              </div>
            )}
          </form>

          <p className="mt-10 text-center text-xs text-slate-600">
            © {new Date().getFullYear()} Bay Area Immigration Services (BAIS) · Admin Panel
          </p>
        </div>
      </div>

      {/* ── Right: Brand Panel ── */}
      <div className={`hidden lg:flex flex-1 flex-col items-center justify-center
        bg-linear-to-br from-[#1D9E75] via-teal-700 to-slate-900 px-16 py-12 relative overflow-hidden
        transition-all duration-500 ${show ? "translate-x-0 opacity-100" : "translate-x-8 opacity-0"}`}
        style={{ transitionTimingFunction: "cubic-bezier(0.22,1,0.36,1)" }}>

        <div className="absolute inset-0 opacity-10"
          style={{ backgroundImage: "radial-gradient(circle at 30% 70%, white 1px, transparent 1px), radial-gradient(circle at 70% 30%, white 1px, transparent 1px)", backgroundSize: "60px 60px" }} aria-hidden="true"/>

        <div className="relative text-center max-w-sm">
          <div className="w-20 h-20 rounded-3xl bg-white/15 border border-white/20
            flex items-center justify-center mx-auto mb-8 shadow-2xl">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="white">
              <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
            </svg>
          </div>

          <h2 className="text-3xl font-extrabold text-white mb-4 leading-tight">
            BAIS Admin Portal
          </h2>
          <p className="text-white/70 text-sm leading-relaxed mb-10">
            Manage users, review documents, track appointments, and oversee all immigration cases
            from one secure dashboard.
          </p>

          {[
            { icon: IconUsers, label: "User Management" },
            { icon: IconFileText, label: "Document Review" },
            { icon: IconCalendar, label: "Appointment Tracking" },
            { icon: IconBarChart, label: "Case Analytics" },
          ].map(({ icon: Icon, label }) => (
            <div key={label} className="flex items-center gap-3 mb-3 bg-white/10 border border-white/15
              rounded-xl px-4 py-3 text-left">
              <Icon size={20} className="text-white/90" />
              <span className="text-white/90 text-sm font-semibold">{label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
