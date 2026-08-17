const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const compression = require("compression");
const cookieParser = require("cookie-parser");
const rateLimit = require("express-rate-limit");
const env = require("./config/env");
const routes = require("./routes");
const errorHandler = require("./middleware/errorHandler");
const requestContext = require("./middleware/requestContext");
const sanitizeRequest = require("./middleware/sanitizeRequest");
const paymentController = require("./modules/payments/payment.controller");
const logger = require("./utils/logger");
const { perfMiddleware } = require("./utils/perfTimer");

const app = express();

// Almost every real deployment target for this app (Render/Railway/Heroku-
// style PaaS, or a self-managed Nginx in front of Node) terminates TLS at a
// reverse proxy one hop in front of this process. Without this, Express never
// sees the connection as secure (req.secure is always false, req.protocol is
// always "http"), and req.ip resolves to the proxy's address instead of the
// client's for every request, including rate-limiting below. Only enabled in
// production so local dev (no proxy in front) behaves exactly as before;
// override TRUST_PROXY_HOPS if the real topology has a different hop count.
if (env.nodeEnv === "production") {
  app.set("trust proxy", Number(process.env.TRUST_PROXY_HOPS || 1));
}

// Firebase Auth (which needed same-origin-allow-popups for its popup/redirect
// window.opener flow) has been removed — back to Helmet's stricter default
// COOP. Re-relax this only if a future OAuth popup flow proves it's needed.
app.use(helmet());
app.use(compression());
app.use(requestContext);
app.use(perfMiddleware);
app.use(
  cors({
    origin: env.clientOrigins,
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "Idempotency-Key", "X-Payment-Request-Id", "X-Request-Id", "X-Correlation-Id", "x-api-key", "x-internal-api-key"],
  })
);

app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
}));
app.use(morgan(env.nodeEnv === "production" ? ":method :safe-url :status :res[content-length] :response-time ms" : "dev", {
  tokens: {
    "safe-url": (req) => String(req.originalUrl || req.url || "").split("?")[0],
  },
  stream: { write: (message) => logger.info("http_access", { message: message.trim() }) },
}));
app.post("/api/payments/webhook/stripe", express.raw({ type: "application/json" }), paymentController.handleStripeWebhook);
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(sanitizeRequest);

app.get("/api/health", (req, res) => {
  res.json({ status: "ok", service: "immigration-crm-backend", timestamp: new Date().toISOString() });
});

app.use("/api", routes);
app.use((req, res) => res.status(404).json({ success: false, message: "Route not found" }));
app.use(errorHandler);

module.exports = app;
