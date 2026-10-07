const BLOCKED_KEYS = new Set(["__proto__", "constructor", "prototype"]);

// Form-data maps are KEYED BY FIELD NAME: a USCIS PDF field is "form1[0].#subform[0].Pt1Line1_FamilyName[0]" and its
// stored id is "part1.form10Subform0...". Those keys legitimately contain dots, and dropping them (as every other
// dotted key is dropped, to stop Mongo path injection) silently emptied the whole map - a form "saved" successfully
// while nothing reached the database and the downloaded PDF came out blank. Inside these containers only the real
// threats stay blocked ($-operators and prototype keys); the services that receive them write by template-resolved
// field id and ignore any key that is not a field of the form.
const DOT_KEY_CONTAINERS = new Set(["fieldValues", "filledData"]);

function sanitizeValue(value, allowDots = false) {
  if (Array.isArray(value)) return value.map((item) => sanitizeValue(item, allowDots));
  if (!value || typeof value !== "object") return value;
  const clean = {};
  Object.entries(value).forEach(([key, child]) => {
    if (BLOCKED_KEYS.has(key) || key.startsWith("$") || (key.includes(".") && !allowDots)) return;
    clean[key] = sanitizeValue(child, allowDots || DOT_KEY_CONTAINERS.has(key));
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
module.exports.sanitizeValue = sanitizeValue;
