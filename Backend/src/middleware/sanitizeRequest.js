const BLOCKED_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function sanitizeValue(value) {
  if (Array.isArray(value)) return value.map(sanitizeValue);
  if (!value || typeof value !== "object") return value;
  const clean = {};
  Object.entries(value).forEach(([key, child]) => {
    if (BLOCKED_KEYS.has(key) || key.startsWith("$") || key.includes(".")) return;
    clean[key] = sanitizeValue(child);
  });
  return clean;
}

function sanitizeRequest(req, res, next) {
  if (req.body && typeof req.body === "object") req.body = sanitizeValue(req.body);
  if (req.query && typeof req.query === "object") req.query = sanitizeValue(req.query);
  if (req.params && typeof req.params === "object") req.params = sanitizeValue(req.params);
  next();
}

module.exports = sanitizeRequest;
