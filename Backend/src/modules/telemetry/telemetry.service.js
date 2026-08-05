const crypto = require("node:crypto");
const TelemetryEvent = require("../../models/TelemetryEvent");

// Only these funnel-event namespaces are ever persisted. An unknown event
// name is dropped silently (see track()) — the public endpoint always
// returns 202 either way, so this allow-list is never leaked to a caller
// probing for valid event names.
const ALLOWED_NAME_PREFIXES = ["quiz.", "lead.", "consultation.", "case.", "doc."];

// Recursively stripped from `properties` (case-insensitive key match) before
// persisting — telemetry is product analytics, not a second copy of PII.
const DENIED_PROPERTY_KEYS = new Set([
  "email", "phone", "phonenumber", "password", "ssn", "dob", "dateofbirth",
  "name", "fullname", "firstname", "lastname", "address", "passportnumber",
  "ip", "ipaddress", "creditcard", "cardnumber", "token", "authorization",
]);

const IP_HASH_SALT = process.env.TELEMETRY_IP_SALT || "dev-telemetry-ip-salt-change-me";

function hashIp(ip) {
  if (!ip) return "";
  return crypto.createHash("sha256").update(`${IP_HASH_SALT}:${ip}`).digest("hex");
}

function stripDeniedKeys(value) {
  if (Array.isArray(value)) return value.map(stripDeniedKeys);
  if (!value || typeof value !== "object") return value;
  const clean = {};
  Object.entries(value).forEach(([key, child]) => {
    if (DENIED_PROPERTY_KEYS.has(key.toLowerCase())) return;
    clean[key] = stripDeniedKeys(child);
  });
  return clean;
}

function isAllowedName(name) {
  return typeof name === "string" && ALLOWED_NAME_PREFIXES.some((prefix) => name.startsWith(prefix));
}

// Fire-and-forget safe: a telemetry failure must never break the caller's
// request. Returns null (silently) for an unknown event name or on any
// persistence error — never throws.
async function track({ name, sessionId, userId, properties, utm, source, ip } = {}) {
  try {
    if (!isAllowedName(name)) return null;
    const event = await TelemetryEvent.create({
      name,
      sessionId: sessionId || "",
      userId: userId || null,
      properties: stripDeniedKeys(properties || {}),
      utm: utm || {},
      source: ["web", "api", "system"].includes(source) ? source : "web",
      ipHash: hashIp(ip),
    });
    return event;
  } catch (error) {
    console.error("Telemetry track failed (non-fatal):", error.message);
    return null;
  }
}

async function query({ name, from, to, groupBy } = {}) {
  const match = {};
  if (name) match.name = name;
  if (from || to) {
    match.occurredAt = {};
    if (from) match.occurredAt.$gte = new Date(from);
    if (to) match.occurredAt.$lte = new Date(to);
  }

  const groupField = groupBy === "day"
    ? { $dateToString: { format: "%Y-%m-%d", date: "$occurredAt" } }
    : "$name";

  const rows = await TelemetryEvent.aggregate([
    { $match: match },
    { $group: { _id: groupField, count: { $sum: 1 } } },
    { $sort: { _id: 1 } },
  ]);

  const total = rows.reduce((sum, row) => sum + row.count, 0);
  return { total, groups: rows.map((row) => ({ key: row._id, count: row.count })) };
}

module.exports = { track, query, isAllowedName, stripDeniedKeys, hashIp, ALLOWED_NAME_PREFIXES };
