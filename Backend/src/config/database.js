const mongoose = require("mongoose");
const env = require("./env");
const logger = require("../utils/logger");

let queryProfilerInstalled = false;

// Previously this whole profiler no-op'd whenever NODE_ENV === "production",
// which is exactly why the 1,128,456ms notification query never got logged
// in prod. It now stays on everywhere (still disableable via PERF_LOGS=false)
// with a higher default threshold in production so normal request-path
// queries don't get noisy — only genuinely slow ones are logged either way.
function installQueryProfiler() {
  if (queryProfilerInstalled || process.env.PERF_LOGS === "false") return;
  queryProfilerInstalled = true;
  const defaultThresholdMs = env.nodeEnv === "production" ? 500 : 25;
  const thresholdMs = Number(process.env.PERF_QUERY_LOG_THRESHOLD_MS || defaultThresholdMs);
  const includeQueryDetails = process.env.PERF_LOG_QUERY_DETAILS === "true"
    && env.nodeEnv !== "production";
  const originalExec = mongoose.Query.prototype.exec;
  mongoose.Query.prototype.exec = async function profiledExec(...args) {
    const startedAt = Date.now();
    try {
      return await originalExec.apply(this, args);
    } finally {
      const durationMs = Date.now() - startedAt;
      if (durationMs >= thresholdMs) {
        const metadata = {
          collection: this.model?.collection?.name,
          op: this.op,
          durationMs,
        };
        if (includeQueryDetails) {
          metadata.filterKeys = Object.keys(this.getFilter?.() || {});
          metadata.fieldKeys = Object.keys(this._fields || {});
          metadata.optionKeys = Object.keys(this.getOptions?.() || {});
        }
        logger.info("mongodb_query_performance", metadata);
      }
    }
  };
}

// This duration includes pool checkout wait, server selection, network, server
// execution and BSON hydration all together (see mongodb_query_performance
// above) — it can't tell those apart on its own. These CMAP pool-monitoring
// listeners are emitted by the driver for every checkout regardless of driver
// config, and expose the pool-wait component (event.durationMS) directly, so
// a slow query can now be attributed to "waiting for a free connection" vs.
// "the operation itself was slow" without touching any client code.
const POOL_WAIT_WARN_MS = Number(process.env.MONGO_POOL_WAIT_WARN_MS || 250);

function installPoolDiagnostics(client) {
  // Not listening for the driver's own "connectionPoolCreated" event here:
  // mongoose.connect() creates the pool internally before this function gets
  // a chance to attach listeners, so that event has always already fired by
  // this point. Pool config is logged directly from connectDB() instead.
  client.on("connectionCheckedOut", (event) => {
    if (event.durationMS >= POOL_WAIT_WARN_MS) {
      logger.warn("mongodb_pool_checkout_wait", { waitMs: event.durationMS, address: event.address });
    }
  });
  client.on("connectionCheckOutFailed", (event) => {
    logger.error("mongodb_pool_checkout_failed", { reason: event.reason, waitMs: event.durationMS, address: event.address });
  });
  // GET /api/uscis-forms/case/:caseId was observed taking ~90-101s and
  // failing with MongoNetworkTimeoutError. Confirmed live against this
  // cluster: individual queries execute in single-digit milliseconds
  // server-side (verified with explain()) - the delay is connections dying
  // silently mid-pool (this fires with reason "error", not the normal
  // "idle"/"poolClosed" reasons) and the driver only discovering it once an
  // operation on that connection stalls for the full socketTimeoutMS, then
  // silently retries once (retryReads' default behavior) and can stall for
  // socketTimeoutMS again before surfacing - two arrivals at the old 45s
  // socketTimeoutMS is exactly the observed ~90s. These events are the
  // direct evidence trail for that failure mode without logging secrets.
  client.on("connectionClosed", (event) => {
    if (event.reason && event.reason !== "poolClosed" && event.reason !== "idle") {
      logger.warn("mongodb_connection_closed", { connectionId: event.connectionId, reason: event.reason, address: event.address });
    }
  });
  client.on("serverHeartbeatFailed", (event) => {
    logger.error("mongodb_heartbeat_failed", { durationMS: event.durationMS, error: event.failure?.message });
  });
}

// Confirmed via mongodb_pool_checkout_wait in production logs: a single case
// populate query alone (case.service.js's populateCaseQuery, used by
// /api/cases/my among others) fans out to 16 concurrent populate queries,
// each checking out its own pool connection. Two users hitting a
// populate-heavy case endpoint at the same moment can already demand ~32
// connections — well past the old default of 25 — before background jobs
// draw any connections of their own. 50 gives realistic headroom for a
// handful of concurrent populate-heavy requests plus background-job usage
// without guessing at a much larger number; MONGO_MAX_POOL_SIZE still
// overrides this for the actual production instance count/traffic.
// socketTimeoutMS was 45000. Confirmed live against this cluster (a shared/
// free-tier Atlas replica set - reverse DNS on the shard hosts resolves to
// "...-m0-...") that connections intermittently die mid-pool without the
// driver noticing immediately; the app only finds out when a query on that
// dead connection stalls for the full socket timeout. With retryReads'
// default single automatic retry, a dead connection costs socketTimeoutMS
// TWICE before the app sees an error - 45000 x 2 = 90000ms, matching the
// reported ~90-101s stalls exactly. Lowering this to 15000 bounds the same
// worst case to ~30s instead of ~90s; it does not fix cluster-side
// instability (see mongodb_connection_closed/mongodb_heartbeat_failed below
// for that evidence trail - the durable fix is moving off the shared/free
// tier), but it stops a single bad connection from holding a user-facing
// request open for a minute and a half. connectTimeoutMS/waitQueueTimeoutMS
// were previously unset (driver defaults), so a brand-new connection attempt
// or a pool-checkout wait had no explicit bound of their own either.
async function connectDB() {
  installQueryProfiler();
  const poolOptions = {
    maxPoolSize: Number(process.env.MONGO_MAX_POOL_SIZE || 50),
    minPoolSize: Number(process.env.MONGO_MIN_POOL_SIZE || 2),
    serverSelectionTimeoutMS: Number(process.env.MONGO_SERVER_SELECTION_TIMEOUT_MS || 10000),
    socketTimeoutMS: Number(process.env.MONGO_SOCKET_TIMEOUT_MS || 15000),
    connectTimeoutMS: Number(process.env.MONGO_CONNECT_TIMEOUT_MS || 10000),
    waitQueueTimeoutMS: Number(process.env.MONGO_WAIT_QUEUE_TIMEOUT_MS || 10000),
    maxIdleTimeMS: Number(process.env.MONGO_MAX_IDLE_TIME_MS || 60000),
  };
  const conn = await mongoose.connect(env.mongoUri, poolOptions);
  installPoolDiagnostics(mongoose.connection.getClient());
  mongoose.connection.on("error", (error) => logger.error("mongodb_connection_error", { error }));
  mongoose.connection.on("disconnected", () => logger.warn("mongodb_disconnected"));
  mongoose.connection.on("reconnected", () => logger.info("mongodb_reconnected"));
  logger.info("mongodb_connected", { host: conn.connection.host, pool: poolOptions });
  return conn;
}

async function disconnectDB() {
  if (mongoose.connection.readyState === 0) return;
  await mongoose.connection.close();
}

module.exports = connectDB;
module.exports.disconnectDB = disconnectDB;
