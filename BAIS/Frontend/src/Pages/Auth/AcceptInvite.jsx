import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { authApi } from "../../services/api";

const LockIcon = () => (
  <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.6"
      d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/>
  </svg>
);

function Field({ icon, type = "text", placeholder, value, onChange, autoComplete }) {
  return (
    <div className="relative flex items-center w-full mb-4">
      <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none flex items-center z-10">
        {icon}
      </span>
      <input
        type={type}
        placeholder={placeholder}
        value={value}
        onChange={onChange}
        autoComplete={autoComplete}
        className="w-full pl-10 pr-4 py-3 text-sm text-slate-800 placeholder-slate-400
          border border-slate-200 rounded-xl bg-white outline-none box-border
          hover:border-slate-300
          focus:border-[#1D9E75] focus:ring-2 focus:ring-[#1D9E75]/15
          transition-all duration-150"
      />
    </div>
  );
}

export default function AcceptInvite() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") || "";
  const { acceptInvite } = useAuth();

  const [status, setStatus] = useState("checking"); // checking | valid | invalid
  const [invite, setInvite] = useState(null);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    document.title = "Accept Invitation | BAIS Immigration Portal";
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
      await acceptInvite(token, password, confirmPassword);
      navigate("/dashboard", { replace: true });
    } catch (err) {
      setError(err.message || "Unable to activate your account. The link may have expired.");
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#f3f4f6] px-6 py-10">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-xl p-8">
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

        {status === "checking" && (
          <p className="text-sm text-slate-500">Checking your invitation…</p>
        )}

        {status === "invalid" && (
          <>
            <h1 className="text-xl font-bold text-slate-900 mb-2">Invalid or expired link</h1>
            <p className="text-sm text-slate-500 mb-6">
              This invitation link is no longer valid. Ask whoever invited you to send a new one, or log in if you've already activated your account.
            </p>
            <button onClick={() => navigate("/login")}
              className="w-full py-3 bg-[#1D9E75] hover:bg-[#0F6E56] text-white text-sm font-bold rounded-xl transition-all duration-200 cursor-pointer">
              Go to Login
            </button>
          </>
        )}

        {status === "valid" && (
          <>
            <h1 className="text-xl font-bold text-slate-900 mb-1">Create your account</h1>
            <p className="text-sm text-slate-500 mb-6">
              {invite?.name ? `Welcome, ${invite.name}. ` : ""}Set a password for <span className="font-semibold text-slate-700">{invite?.email}</span> to activate your account and get started.
            </p>

            <Field icon={<LockIcon />} type="password" placeholder="Password"
              value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
            <Field icon={<LockIcon />} type="password" placeholder="Confirm Password"
              value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} autoComplete="new-password" />

            {error && (
              <div role="alert" className="mb-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
                {error}
              </div>
            )}

            <button onClick={handleSubmit} disabled={submitting}
              className="w-full py-3 bg-[#1D9E75] hover:bg-[#0F6E56] text-white text-sm font-bold rounded-xl
                transition-all duration-200 active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer">
              {submitting ? "Activating…" : "Activate Account"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
