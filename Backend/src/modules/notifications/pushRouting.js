// Decides WHICH browser app a push notification is delivered to, and WHERE a click on it lands.
//
// Every portal is a separate origin with its own service worker and its own FCM token:
//   admin.immiglance.com     internal team (super admin, admin, team lead, case manager, ...)
//   attorney.immiglance.com  attorneys
//   client.immiglance.com    clients / employers / employees / beneficiaries
//   immiglance.com           public landing site (never a notification target)
// A person who has once opened another origin in the same browser has a token there too. Without routing, one notification popped up
// on every one of those origins, and the click opened the person's link on whichever origin showed it - a path that origin does not
// have, i.e. a blank page. Pure functions only (no DB, no network) so the behaviour is easy to test.
const { portalUrl, PRODUCTION } = require("../email/portalUrls");

const CLIENT_PORTAL_ROLES = new Set(["client", "user", "employer", "employee", "beneficiary", "professor"]);
const LOCAL_PORT_PORTAL = { 3002: "admin", 5174: "attorney", 5173: "landing", 5175: "client" };
const LOCAL_HOST = /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])$/i;
const PORTALS = ["admin", "attorney", "client", "landing"];

// The one portal a user's notifications belong to. null = role unknown (callers then keep the previous, unrouted behaviour).
function portalForRole(role) {
  if (!role || typeof role !== "string") return null;
  if (role === "attorney") return "attorney";
  if (CLIENT_PORTAL_ROLES.has(role)) return "client";
  return "admin";
}

function parseOrigin(raw) {
  if (typeof raw !== "string" || !raw.trim()) return null;
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url;
  } catch {
    return null;
  }
}

// Which portal an origin is (null = not one of ours).
function portalForOrigin(raw) {
  const url = parseOrigin(raw);
  if (!url) return null;
  if (LOCAL_HOST.test(url.hostname)) return LOCAL_PORT_PORTAL[url.port] || null;
  for (const portal of PORTALS) {
    for (const known of new Set([PRODUCTION[portal], portalUrl(portal)])) {
      const knownUrl = parseOrigin(known);
      if (knownUrl && knownUrl.host === url.host) return portal;
    }
  }
  return null;
}

// What gets stored on a device token: the bare origin of a recognised portal, anything else (a forged / unknown Origin header) nothing.
function sanitizeOrigin(raw) {
  const url = parseOrigin(raw);
  return url && portalForOrigin(raw) ? url.origin : undefined;
}

// Call sites write one link for a notification that several roles receive, and some of those paths exist in only one portal (or in none:
// the pre-split "/admin/portal?tab=leads", "/appointments", "/payments/<id>"). This maps a link to the page that really exists in the
// RECIPIENT's portal. A link that is already valid is returned untouched, so it is safe to apply twice. `caseId` lets a case-less
// path (messages, appointments) open that case. Never throws.
const OBJECT_ID = "[a-f0-9]{24}";
function normalizeLinkPath(portal, link, { caseId } = {}) {
  if (typeof link !== "string" || !link.startsWith("/")) return link;
  const path = link.split(/[?#]/)[0].replace(/\/+$/, "") || "/";
  const caseRef = caseId ? String(caseId._id || caseId) : "";
  const hasCase = new RegExp(`^${OBJECT_ID}$`, "i").test(caseRef);
  if (portal === "admin") {
    if (/^\/admin\/portal(?:\/|$)/i.test(path)) return "/leads";
    // appointments come from consultation bookings: staff review them on the Leads page; an invoice opens its case
    if (/^\/appointments(?:\/|$)/.test(path)) return "/leads";
    if (new RegExp(`^/payments/${OBJECT_ID}$`, "i").test(path)) return hasCase ? `/crm-cases/${caseRef}` : "/dashboard";
    const caseMatch = new RegExp(`^/cases/(${OBJECT_ID})(?:/.*)?$`, "i").exec(path);
    if (caseMatch) return `/crm-cases/${caseMatch[1]}`;
    if (path === "/cases") return "/crm-cases";
    // "/messages/<conversation id>": Admin's route takes the CASE id
    if (new RegExp(`^/messages/${OBJECT_ID}$`, "i").test(path)) return hasCase ? `/messages/${caseRef}` : "/messages";
  } else if (portal === "client") {
    if (/^\/appointments(?:\/|$)/.test(path) || new RegExp(`^/payments/${OBJECT_ID}$`, "i").test(path) || path === "/dashboard/payments") return "/dashboard";
    if (new RegExp(`^/messages/${OBJECT_ID}$`, "i").test(path)) return "/dashboard/messages";
    if (path === "/dashboard/employer") return "/dashboard/profile";
  } else if (portal === "attorney") {
    if (/^\/appointments(?:\/|$)/.test(path) || /^\/payments(?:\/|$)/.test(path)) return "/dashboard";
    if (new RegExp(`^/messages/${OBJECT_ID}$`, "i").test(path)) return hasCase ? `/messages/${caseRef}` : "/messages";
  }
  return link;
}

// The link to store for `role`'s notification (role unknown -> as given).
function resolveLinkForRole(role, link, ctx) {
  try {
    const portal = portalForRole(role);
    return portal ? normalizeLinkPath(portal, link, ctx) : link;
  } catch {
    return link;
  }
}

// Splits a user's tokens into one group per destination origin. Tokens registered on another portal's origin are left out; tokens with
// no recorded origin (registered before origins were stored) go to the user's own portal origin, which still opens the right place.
function planDeliveries({ role, tokens, link }) {
  const portal = portalForRole(role);
  if (!portal) return null;
  const path = normalizeLinkPath(portal, link);
  const groups = new Map();
  for (const entry of tokens || []) {
    const tokenPortal = entry.origin ? portalForOrigin(entry.origin) : portal;
    if (tokenPortal !== portal) continue;
    const base = (entry.origin && parseOrigin(entry.origin)?.origin) || portalUrl(portal);
    if (!groups.has(base)) groups.set(base, []);
    groups.get(base).push(entry.token);
  }
  return {
    portal,
    link: path,
    groups: [...groups].map(([base, list]) => ({
      tokens: list,
      url: typeof path === "string" && path.startsWith("/") ? `${base}${path}` : base,
    })),
  };
}

module.exports = { portalForRole, portalForOrigin, sanitizeOrigin, normalizeLinkPath, resolveLinkForRole, planDeliveries };
