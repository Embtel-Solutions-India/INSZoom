import { useEffect, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { tokenStore } from "../../services/api";
import { useAuth } from "../../context/AuthContext";

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

    navigate(role === "admin" ? "/admin/portal" : "/dashboard", { replace: true });
  }, []);

  return (
    <div className="flex items-center justify-center min-h-screen bg-[#f3f4f6]">
      <div className="flex flex-col items-center gap-4">
        <div className="w-10 h-10 rounded-full border-4 border-emerald-200 border-t-emerald-600 animate-spin" />
        <p className="text-sm text-slate-500 font-medium">Completing sign-in…</p>
      </div>
    </div>
  );
}
