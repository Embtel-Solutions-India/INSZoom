const SENSITIVE_KEY = /(password|passwd|pwd|credential|access.?token|refresh.?token|authorization|cookie|session|secret|api.?key|client.?secret|private.?key|passport.?number|ssn|alien.?number|a.?number|date.?of.?birth|dob|phone|email|address|document.?contents?)/i;

function redactString(value) {
  if (typeof value !== "string") return value;
  return value
    .replace(/(authorization\s*[:=]\s*bearer\s+)[^\s,;]+/gi, "$1[REDACTED]")
    .replace(/([?&](?:token|access_token|refresh_token|password|secret|api_key)=)[^&\s]+/gi, "$1[REDACTED]");
}

function redact(value, key = "") {
  if (SENSITIVE_KEY.test(key)) return "[REDACTED]";
  if (value instanceof Error) return serializeError(value);
  if (typeof value === "string") return redactString(value);
  if (Array.isArray(value)) return value.map((item) => redact(item, key));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([childKey, childValue]) => [childKey, redact(childValue, childKey)]));
  }
  return value;
}

function serializeError(error) {
  if (!error) return undefined;
  return {
    name: error.name,
    message: redactString(error.message),
    code: error.code,
    status: error.status || error.statusCode,
    stack: redactString(error.stack),
  };
}

function normalizeMeta(meta = {}) {
  return redact(meta);
}

function log(level, message, meta = {}) {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...normalizeMeta(meta),
  };
  const line = JSON.stringify(entry);
  if (level === "error" || level === "fatal") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

module.exports = {
  debug: (message, meta) => {
    if (process.env.LOG_LEVEL === "debug") log("debug", message, meta);
  },
  info: (message, meta) => log("info", message, meta),
  warn: (message, meta) => log("warn", message, meta),
  error: (message, meta) => log("error", message, meta),
  fatal: (message, meta) => log("fatal", message, meta),
  redact,
  serializeError,
};
