import { useEffect } from "react";
import Navbar from "../components/Navbar";
import { Outlet } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { tokenStore } from "../services/api";
import { STAFF_ROLES, redirectToOwnPortal } from "../utils/portalRedirect";

export default function MainLayout() {
  const { authStatus, sessionContext } = useAuth();

  // This layout backs the public marketing site (home, pricing, etc.) — an
  // anonymous visitor browses it freely, and AuthGate never wraps it. But an
  // already-authenticated staff/attorney session has no reason to see it:
  // previously, a failed off-domain portal redirect (see portalRedirect.js's
  // history) could strand a staff session here with the navbar showing them
  // "logged in" on what looks like the client portal's own marketing page —
  // confusing and wrong. Bounce them the same way AuthGate would, without
  // otherwise gating this layout for anyone who isn't already authenticated.
  const role = sessionContext?.role;
  const needsOwnPortal = authStatus === "authenticated" && (STAFF_ROLES.includes(role) || role === "attorney");
  useEffect(() => {
    if (needsOwnPortal) redirectToOwnPortal(role, tokenStore.getAccess());
  }, [needsOwnPortal, role]);

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Navbar />
      <main className="flex-1">
        <Outlet />
      </main>
    </div>
  );
}
