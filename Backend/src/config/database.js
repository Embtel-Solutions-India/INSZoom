const mongoose = require("mongoose");
const env = require("./env");
const logger = require("../utils/logger");

let queryProfilerInstalled = false;

function installQueryProfiler() {
  if (queryProfilerInstalled || env.nodeEnv === "production" || process.env.PERF_LOGS === "false") return;
  queryProfilerInstalled = true;
  const originalExec = mongoose.Query.prototype.exec;
  mongoose.Query.prototype.exec = async function profiledExec(...args) {
    const startedAt = Date.now();
    try {
      return await originalExec.apply(this, args);
    } finally {
      const durationMs = Date.now() - startedAt;
      if (durationMs >= Number(process.env.PERF_QUERY_LOG_THRESHOLD_MS || 25)) {
        logger.info("mongodb_query_performance", {
          collection: this.model?.collection?.name,
          op: this.op,
          durationMs,
          filter: this.getFilter?.(),
          fields: this._fields,
          options: this.getOptions?.(),
        });
      }
    }
  };
}

async function connectDB() {
  installQueryProfiler();
  const conn = await mongoose.connect(env.mongoUri, {
    maxPoolSize: Number(process.env.MONGO_MAX_POOL_SIZE || 25),
    minPoolSize: Number(process.env.MONGO_MIN_POOL_SIZE || 2),
    serverSelectionTimeoutMS: Number(process.env.MONGO_SERVER_SELECTION_TIMEOUT_MS || 10000),
    socketTimeoutMS: Number(process.env.MONGO_SOCKET_TIMEOUT_MS || 45000),
    maxIdleTimeMS: Number(process.env.MONGO_MAX_IDLE_TIME_MS || 60000),
  });
  logger.info("mongodb_connected", { host: conn.connection.host });
  return conn;
}

module.exports = connectDB;
