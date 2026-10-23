// The origin every link in an EMAIL points at. Emails always carry the real production addresses - never localhost - even when the
// backend runs on a developer machine:
//   admin     https://admin.immiglance.com       (case manager / team lead / admin / super admin)
//   attorney  https://attorney.immiglance.com
//   client    https://client.immiglance.com
//   landing   https://immiglance.com             (consultation booking / public site)
// An environment value (ADMIN_PORTAL_URL, ATTORNEY_PORTAL_URL, CLIENT_URL, LANDING_URL) is honoured only when it is a real, non-local
// address (e.g. a staging domain); a localhost / 127.0.0.1 value is ignored. Used for EMAIL links only - env.clientUrl itself (OAuth
// redirects, CORS) is untouched.
const PRODUCTION = {
  admin: "https://admin.immiglance.com",
  attorney: "https://attorney.immiglance.com",
  client: "https://client.immiglance.com",
  landing: "https://immiglance.com",
};
const ENV_KEY = { admin: "ADMIN_PORTAL_URL", attorney: "ATTORNEY_PORTAL_URL", client: "CLIENT_URL", landing: "LANDING_URL" };

const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:\d+)?(?=[/?#]|$)/i;
const trimSlash = (url) => String(url || "").trim().replace(/\/+$/, "");

function portalUrl(portal) {
  const configured = trimSlash(process.env[ENV_KEY[portal]]);
  if (configured && /^https?:\/\//i.test(configured) && !LOCAL_ORIGIN.test(configured)) return configured;
  return PRODUCTION[portal];
}

// Which portal a local dev origin stood for: 3002 Admin, 5174 Attorney, anything else (5173, 5175, ...) the client portal.
const LOCAL_PORT_PORTAL = { 3002: "admin", 5174: "attorney" };
const LOCAL_ORIGIN_GLOBAL = /https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:\d+)?(?![\w.-])/gi;

// Last line of defence for finished email text: any localhost link that slipped in from a call site becomes the production address.
function productionizeLinks(text) {
  if (typeof text !== "string" || !text) return text;
  return text.replace(LOCAL_ORIGIN_GLOBAL, (match, _host, port) => portalUrl(LOCAL_PORT_PORTAL[String(port || "").slice(1)] || "client"));
}

// An email only ever links to the recipient's OWN portal (client -> Client, internal team -> Admin, attorney -> Attorney). A link on
// either of the other two portals - whatever a call site or an admin-written template put there - becomes `fallback`, the
// recipient's own landing page. Public pages (the landing site, USCIS) are not portal origins and are left alone.
const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function confineToPortal(text, portal, fallback) {
  if (typeof text !== "string" || !text || !fallback || !ENV_KEY[portal]) return text;
  const own = new Set([portalUrl(portal), PRODUCTION[portal]]);
  const foreign = Object.keys(ENV_KEY)
    .filter((other) => other !== portal && other !== "landing")
    .flatMap((other) => [portalUrl(other), PRODUCTION[other]])
    .filter((origin) => !own.has(origin));
  if (!foreign.length) return text;
  const pattern = new RegExp(`(?:${[...new Set(foreign)].map(escapeRegex).join("|")})(?![\\w.-])(?:[/?#][^\\s"'<>)]*)?`, "gi");
  return text.replace(pattern, fallback);
}

module.exports = { portalUrl, productionizeLinks, confineToPortal, PRODUCTION };
