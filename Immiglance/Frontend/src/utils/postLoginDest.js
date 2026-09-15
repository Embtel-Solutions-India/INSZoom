/**
 * PHASE 3 ARCHITECTURE CHANGE
 *
 * Post-login routing is now handled exclusively by the AuthGate component
 * (src/components/AuthGate.jsx), which calls GET /api/auth/session-context.
 *
 * This file is retained for reference but its functions are no longer called.
 * It will be removed in a future cleanup phase.
 *
 * Previous behavior:
 * - getPostLoginDest(user): routed staff to INSZoom, clients to /dashboard
 * - resolvePostLoginDest(user): added an async casesApi.my() call to check
 *   whether a client has a case, then routed to /dashboard or /dashboard/intake
 *
 * Both of these responsibilities now belong to AuthGate.
 */

export function getPostLoginDest() {
  console.warn("[postLoginDest] This function is deprecated. Use AuthGate instead.");
  return { external: false, url: "/dashboard" };
}

export async function resolvePostLoginDest() {
  console.warn("[resolvePostLoginDest] This function is deprecated. Use AuthGate instead.");
  return "/dashboard";
}
