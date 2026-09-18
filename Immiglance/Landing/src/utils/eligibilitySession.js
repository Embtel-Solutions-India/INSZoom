// Session + UTM capture for the public eligibility quiz. sessionId persists
// in sessionStorage (survives the intro -> quiz -> results navigation within
// one browser tab, cleared on tab close) so every telemetry event and the
// final submit share one correlation id; UTM params are captured once from
// the URL on first landing and carried the same way.
const SESSION_KEY = "eligibility_session_id";
const UTM_KEY = "eligibility_utm";

function generateId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `sess-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function getSessionId() {
  let id = sessionStorage.getItem(SESSION_KEY);
  if (!id) {
    id = generateId();
    sessionStorage.setItem(SESSION_KEY, id);
  }
  return id;
}

export function captureUtmFromUrl() {
  const existing = sessionStorage.getItem(UTM_KEY);
  const params = new URLSearchParams(window.location.search);
  const fromUrl = {
    source: params.get("utm_source") || undefined,
    medium: params.get("utm_medium") || undefined,
    campaign: params.get("utm_campaign") || undefined,
    term: params.get("utm_term") || undefined,
    content: params.get("utm_content") || undefined,
  };
  const hasUrlUtm = Object.values(fromUrl).some(Boolean);
  if (hasUrlUtm) {
    sessionStorage.setItem(UTM_KEY, JSON.stringify(fromUrl));
    return fromUrl;
  }
  if (existing) {
    try { return JSON.parse(existing); } catch { /* fall through */ }
  }
  return {};
}
