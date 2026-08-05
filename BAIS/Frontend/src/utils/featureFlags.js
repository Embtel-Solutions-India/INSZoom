import { useAuth } from "../context/AuthContext";

// Resolution order for any flag, checked fresh on every read (session/local
// overrides can change between renders via other tabs/URLs, so nothing here
// is cached beyond the browser's own storage):
//   1. URL override      ?ff=name        (forces on)  — persisted to sessionStorage
//                         ?ff=-name       (forces off) — so it survives client-side
//                                                        navigation within the tab
//   2. sessionStorage override (same shape, set by #1, or by hand for a quick test)
//   3. localStorage override   (per-browser, persists across sessions — for QA)
//   4. Server default   user.features[name]   (delivered once on /auth/me;
//                        flips for every user on next refresh, no rebuild —
//                        this is the production kill switch)
//   5. Fail-safe: false — an absent/unreachable flag always resolves OFF,
//      never open, so a config outage can't silently turn on new behavior.
const STORAGE_PREFIX = "bais:ff:";

function applyUrlOverrides() {
  if (typeof window === "undefined") return;
  const params = new URLSearchParams(window.location.search);
  const raw = params.get("ff");
  if (!raw) return;
  raw.split(",").forEach((token) => {
    const trimmed = token.trim();
    if (!trimmed) return;
    const forceOff = trimmed.startsWith("-");
    const name = forceOff ? trimmed.slice(1) : trimmed;
    if (!name) return;
    try {
      window.sessionStorage.setItem(STORAGE_PREFIX + name, forceOff ? "off" : "on");
    } catch {
      // sessionStorage unavailable (privacy mode, etc.) — override just won't persist
    }
  });
}

function readOverride(name) {
  if (typeof window === "undefined") return undefined;
  try {
    const session = window.sessionStorage.getItem(STORAGE_PREFIX + name);
    if (session === "on") return true;
    if (session === "off") return false;
  } catch {
    // ignore — fall through to localStorage/server default
  }
  try {
    const local = window.localStorage.getItem(STORAGE_PREFIX + name);
    if (local === "on") return true;
    if (local === "off") return false;
  } catch {
    // ignore
  }
  return undefined;
}

applyUrlOverrides();

// Standalone resolver for call sites without a React tree (rare — prefer
// useFeatureFlag below in components).
export function isFeatureEnabled(name, serverFeatures) {
  const override = readOverride(name);
  if (override !== undefined) return override;
  return Boolean(serverFeatures?.[name]);
}

export function useFeatureFlag(name) {
  const auth = useAuth();
  return isFeatureEnabled(name, auth?.user?.features);
}
