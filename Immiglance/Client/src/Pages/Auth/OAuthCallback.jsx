import { useEffect, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { tokenStore } from "../../services/api";
import { useAuth } from "../../context/AuthContext";
import { STAFF_ROLES, ADMIN_URL } from "../../utils/portalRedirect";

// Ported from Immiglance/Landing — the backend's /auth/google/callback
// redirects here now (this app's origin is env.clientUrl on the backend),
// instead of forwarding through Landing's CrossAppRedirect first. A staff
// account reaching this page (e.g. by mistake) still gets bounced to Admin
// rather than treated as a client login.
export default function OAuthCallback() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { setUserFromOAuth } = useAuth();
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    const error = params.get("error");
    if (error) {
      navigate("/login?error=" + error, { replace: true });
      return;
    }

    const accessToken  = params.get("accessToken");
    const userId       = params.get("userId");
    const email        = params.get("email");
    const displayName  = params.get("displayName");
    const role         = params.get("role");

    if (!accessToken || !userId) {
      navigate("/login?error=invalid_callback", { replace: true });
      return;
    }

    tokenStore.set(accessToken);
    setUserFromOAuth({ _id: userId, email, displayName, role });

    // Staff roles go straight to Admin (external — Google login has no
    // role gate the way Admin's own login does, so any staff account
    // landing here must be redirected off this origin entirely). Client
    // roles navigate to a protected route; AuthGate then checks
    // session-context and redirects to /dashboard, /onboarding/intake,
    // /waiting-for-approval, or /consultation/book as appropriate.
    if (STAFF_ROLES.includes(role)) {
      window.location.href = ADMIN_URL;
    } else {
      navigate("/dashboard", { replace: true });
    }
  }, []);

  return (
    <div className="flex items-center justify-center min-h-screen bg-background">
      <div className="flex flex-col items-center gap-4">
        <div className="w-10 h-10 rounded-full border-4 border-emerald-200 border-t-emerald-600 animate-spin" />
        <p className="text-sm text-muted-foreground font-medium">Completing sign-in…</p>
      </div>
    </div>
  );
}
