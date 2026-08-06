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
app.use(morgan(env.nodeEnv === "production" ? "combined" : "dev", {
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
