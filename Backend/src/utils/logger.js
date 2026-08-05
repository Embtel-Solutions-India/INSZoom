function serializeError(error) {
  if (!error) return undefined;
  return {
    name: error.name,
    message: error.message,
    code: error.code,
    status: error.status || error.statusCode,
    stack: error.stack,
  };
}

function normalizeMeta(meta = {}) {
  const output = {};
  Object.entries(meta || {}).forEach(([key, value]) => {
    if (value instanceof Error) output[key] = serializeError(value);
    else output[key] = value;
  });
  return output;
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
  serializeError,
};
